export interface GeneratedCourse {
  description?: string;
  modules: {
    title: string;
    lessons: {
      title: string;
      content: string;
      metadata: PipelineMetadata;
    }[];
    quiz: {
      questions: {
        type: 'multiple-choice' | 'fill-in-the-blank';
        question: string;
        options?: string[];
        correctAnswer: string;
        explanation: string;
        hint: string;
      }[];
    };
  }[];
}

import { jsonrepair } from 'jsonrepair';
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import DOMPurify from 'dompurify';
import { PipelineMetadata } from '../types';
import { autoHealQuestion } from './validators/aiSchemas';
import { sanitizeForFirestore } from './courseService';
import { auth } from '../firebase';
import { normalizeMathDelimiters } from '../shared/mathText';

const courseMarkedEngine = new Marked({
  gfm: true,
  breaks: true,
});

courseMarkedEngine.use(
  markedKatex({
    throwOnError: false,
    nonStandard: true,
    output: 'htmlAndMathml',
    strict: false,
  })
);

const getAuthToken = async (): Promise<string> => {
  const currentUser = auth?.currentUser;
  if (!currentUser) {
    throw new Error('Authentication is required before requesting course generation services.');
  }

  const token = await currentUser.getIdToken(true);
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('The authenticated session did not provide a valid access token.');
  }
  return token;
};

export function flagOffTopicDrift(content: string, courseName: string, department?: string): { hasDrift: boolean; hits: string[] } {
  const normCourse = (courseName || '').toLowerCase();
  const lowerContent = (content || '').toLowerCase();
  const tokens = normCourse.split(/[^a-z0-9]+/).filter(t => t.length > 3);

  if (tokens.length === 0) return { hasDrift: false, hits: [] };
  const matches = tokens.filter(t => lowerContent.includes(t));
  const hasDrift = matches.length === 0 && lowerContent.length > 500;

  return {
    hasDrift,
    hasDriftHits: undefined,
    hits: hasDrift ? ['Missing core course title vocabulary'] : []
  } as { hasDrift: boolean; hits: string[] };
}

/**
 * Normalizes transport-level JSON escape artifacts and standard LaTeX delimiters
 * without hardcoded keyword dictionaries, word-count heuristics, or format hacks.
 */
export function sanitizeLatex(content: any): any {
  if (content === null || content === undefined) return content;
  if (typeof content !== 'string') return content;

  let sanitized = content.replace(/\r\n/g, '\n');

  // Unwrap outer markdown code fence if the model wrapped the entire payload
  sanitized = sanitized.replace(/^```(?:markdown)?\n([\s\S]*?)\n```$/g, '$1');

  // Restore control characters produced when JSON.parse interprets single-escaped LaTeX backslashes
  sanitized = sanitized
    .replace(/\x08/g, '\\b')
    .replace(/\x0C/g, '\\f')
    .replace(/\x0D/g, '\\r')
    .replace(/\x09/g, '\\t');

  // Convert literal double-escaped newline/tab sequences outside of LaTeX commands
  sanitized = sanitized.replace(/\\n(?![a-zA-Z])/g, '\n');
  sanitized = sanitized.replace(/\\t(?![a-zA-Z])/g, '\t');

  // Normalize delimiters through the shared renderer-safe path. Code fences and inline
  // code remain literal; only actual math regions are converted for KaTeX.
  sanitized = normalizeMathDelimiters(sanitized);

  // Collapse double-escaped backslashes inside math spans that survived JSON decoding
  sanitized = sanitized.replace(/\$\$([\s\S]+?)\$\$/g, (_match, inner) => {
    const normalizedInner = inner.replace(/\\\\([a-zA-Z{}_^])/g, '\\$1').trim();
    return `$$\n${normalizedInner}\n$$`;
  });

  sanitized = sanitized.replace(/\$([^$\n]+?)\$/g, (_match, inner) => {
    const normalizedInner = inner.replace(/\\\\([a-zA-Z{}_^])/g, '\\$1').trim();
    return `$${normalizedInner}$`;
  });

  return sanitized.replace(/\n{3,}/g, '\n\n');
}

/**
 * Parses and validates generated course Markdown + KaTeX using Marked, marked-katex-extension, and DOMPurify.
 */
export function compileAndSanitizeCourseMarkdown(rawContent: string): {
  normalizedMarkdown: string;
  sanitizedHtml: string;
  hasMath: boolean;
  hasCode: boolean;
  hasTables: boolean;
} {
  const normalizedMarkdown = sanitizeLatex(rawContent);
  const tokens = courseMarkedEngine.lexer(normalizedMarkdown);

  let hasMath = false;
  let hasCode = false;
  let hasTables = false;

  const inspectTokens = (tokenList: any[]) => {
    for (const token of tokenList) {
      if (!token || typeof token !== 'object') continue;
      if (token.type === 'inlineKatex' || token.type === 'blockKatex') {
        hasMath = true;
      } else if (token.type === 'code') {
        hasCode = true;
      } else if (token.type === 'table') {
        hasTables = true;
      }
      if (Array.isArray(token.tokens)) {
        inspectTokens(token.tokens);
      }
      if (Array.isArray(token.header)) {
        for (const cell of token.header) {
          if (Array.isArray(cell?.tokens)) inspectTokens(cell.tokens);
        }
      }
      if (Array.isArray(token.rows)) {
        for (const row of token.rows) {
          if (Array.isArray(row)) {
            for (const cell of row) {
              if (Array.isArray(cell?.tokens)) inspectTokens(cell.tokens);
            }
          }
        }
      }
    }
  };

  inspectTokens(tokens as any[]);

  const rendered = courseMarkedEngine.parser(tokens);
  const sanitizedHtml = typeof window !== 'undefined' && DOMPurify?.sanitize
    ? DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true, mathMl: true, svg: true } })
    : rendered;

  return {
    normalizedMarkdown,
    sanitizedHtml,
    hasMath,
    hasCode,
    hasTables,
  };
}


async function callGenerateAPI(prompt: string, type: 'skeleton' | 'module' | 'lesson', provider?: string): Promise<any> {
  const token = await getAuthToken();
  const controller = new AbortController();
  // 10 minute timeout for course generation as it can be very slow with Pro models
  const timeoutId = setTimeout(() => controller.abort(), 600000);

  try {
    let response: Response | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await fetch('/api/course/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ prompt, type, provider }),
          signal: controller.signal
        });
        const ct = response.headers.get('content-type') || '';
        if ((!ct.includes('application/json') || response.status === 502 || response.status === 503 || response.status === 504) && attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          continue;
        }
        break;
      } catch (fetchErr: any) {
        if (fetchErr?.name === 'AbortError' || attempt === 3) throw fetchErr;
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }

    if (!response) {
      throw new Error('Could not connect to generation server.');
    }

    clearTimeout(timeoutId);

    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw new Error("Server returned an invalid response (possibly a timeout or error page). Please try again.");
    }

    if (!response.ok) {
      // Log AI failure
      import('./logService').then(({ LogService }) => {
        LogService.log('error', 'ai', `AI Generation failed for ${type}`, { error: data.error, provider });
      });
      throw new Error(data.error || 'Failed to generate course content');
    }

    // If server already returned validated structured data, return it directly
    if (data.data && typeof data.data === 'object') {
      return data.data;
    }

    const rawContent = data.text;

    // Log AI success
    import('./logService').then(({ LogService }) => {
      LogService.log('success', 'ai', `AI Generation successful for ${type}`, { provider, type });
    });

    if (!rawContent) {
      throw new Error("Failed to generate course content");
    }

    // 1. Strip internal reasoning <think>...</think>
    let content = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // 2. Strip outer markdown code block wrappers ONLY if the entire payload is wrapped in a fence
    if (!content.startsWith('{') && !content.startsWith('[')) {
      const outerMdMatch = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      if (outerMdMatch && outerMdMatch[1].trim()) {
        content = outerMdMatch[1].trim();
      } else {
        const fencedJsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/i);
        if (fencedJsonMatch && fencedJsonMatch[1].trim()) {
          content = fencedJsonMatch[1].trim();
        }
      }
    }

    try {
      // Try direct JSON.parse first
      try {
        return JSON.parse(content);
      } catch (_) {}

      // Find the first JSON-like character
      const startBracket = content.indexOf('[');
      const startBrace = content.indexOf('{');
      
      let startIndex = -1;
      let isArray = false;

      if (startBracket !== -1 && (startBrace === -1 || startBracket < startBrace)) {
        startIndex = startBracket;
        isArray = true;
      } else if (startBrace !== -1) {
        startIndex = startBrace;
        isArray = false;
      }

      if (startIndex === -1) {
        throw new Error("No JSON object or array found in response");
      }
      
      let parsedData = null;
      let lastError = null;

      // Try parsing from the first '{' or '['. If it fails, try the next one.
      let currentIndex = startIndex;
      let currentIsArray = isArray;
      
      while (currentIndex !== -1 && parsedData === null) {
        let jsonToRepair = content.substring(currentIndex).trim();
        
        const closingChar = currentIsArray ? ']' : '}';
        let endIndex = content.lastIndexOf(closingChar);
        
        if (endIndex !== -1 && endIndex > currentIndex) {
          jsonToRepair = content.substring(currentIndex, endIndex + 1).trim();
        }
        
        // Pre-process to fix common unescaped LaTeX commands and characters in JSON
        try {
          jsonToRepair = jsonToRepair.replace(/(?<!\\)\\(.)/g, (match, char, offset, fullString) => {
            if (char === '"' || char === '\\' || char === '/' || char === 'b' || char === 'f' || char === 'n' || char === 'r' || char === 't') {
              return match;
            }
            if (char === 'u') {
              const remaining = fullString.substring(offset + 2);
              if (/^[0-9a-fA-F]{4}/.test(remaining)) {
                return match;
              }
            }
            return '\\\\' + char;
          });
        } catch (e) {
          console.warn('LaTeX pre-processing failed, skipping', e);
        }
        
        try {
          const repaired = jsonrepair(jsonToRepair);
          parsedData = JSON.parse(repaired);
        } catch (e) {
          lastError = e;
          const nextBracket = content.indexOf('[', currentIndex + 1);
          const nextBrace = content.indexOf('{', currentIndex + 1);
          
          if (nextBracket !== -1 && (nextBrace === -1 || nextBracket < nextBrace)) {
            currentIndex = nextBracket;
            currentIsArray = true;
          } else if (nextBrace !== -1) {
            currentIndex = nextBrace;
            currentIsArray = false;
          } else {
            currentIndex = -1;
          }
        }
      }

      if (parsedData !== null) {
        return parsedData;
      } else {
        console.error("Failed to parse extracted JSON. Last error:", lastError);
        throw new Error(`AI generated invalid JSON format: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
      }
    } catch (e) {
      console.error("Failed to parse AI JSON response. Error:", e, "Content:", content);
      throw new Error(`AI generated invalid JSON format: ${e instanceof Error ? e.message : String(e)}`);
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error("Course generation timed out. The AI is taking too long to respond. Please try again.");
    }
    throw error;
  }
}

export async function generateCourseFormulas(
  courseName: string,
  courseDescription: string,
  provider?: string
): Promise<any> {
  const formulaPrompt = `
    You are an expert university professor. Generate a comprehensive list of essential formulas, equations, and theorems for the following course, ensuring they dynamically adapt to accredited global academic benchmarks and modern university curricula for this subject.
    
    Course Name: ${courseName}
    Description: ${courseDescription}
    
    Requirements:
    1. Generate 10-15 of the most important formulas for this course.
    2. Group them into logical and specific academic categories (e.g., "Vector Calculus", "Electrostatics", "Thermodynamics").
    3. Proactively suggest these categories based on the ${courseName} and its ${courseDescription}.
    4. Provide the LaTeX representation for each formula.
    5. Provide a brief, clear description of what the formula is used for and what its variables mean.
    6. Ensure the formulas are academically rigorous and align with accredited global university curriculum standards.
    
    CRITICAL: You must return ONLY valid JSON matching this exact structure:
    {
      "formulas": [
        {
          "title": "<Formula or Theorem Name>",
          "latex": "<Valid LaTeX Expression>",
          "description": "<Academic explanation of variables and domain application>",
          "category": "<Specific Sub-discipline Category>"
        }
      ]
    }
    CRITICAL: Do NOT wrap the JSON in markdown blocks. Output raw JSON only.
    CRITICAL LATEX INSTRUCTIONS:
    1. You MUST use LaTeX for ALL mathematical formulas, variables, and equations.
    2. Use $ ... $ for inline math and $$ ... $$ for block math.
    3. You are outputting data to a JSON parser. You MUST double-escape all LaTeX backslashes. 
       For example, output \\\\frac instead of \\frac, and \\\\begin instead of \\begin.
    4. Do NOT use \\label{...} as it is not supported. Use \\tag{...} for equation numbering if needed.
    5. Ensure all LaTeX environments (like align, matrix, etc.) are wrapped in $$ ... $$ delimiters.
    6. Double check that every backslash in your LaTeX is escaped with another backslash (e.g., \\\\alpha, \\\\beta).
    CRITICAL: Ensure all double quotes inside strings are properly escaped (e.g., \\"word\\").
  `;

  const result = await callGenerateAPI(formulaPrompt, 'skeleton', provider);
  
  if (!result || !Array.isArray(result.formulas) || result.formulas.length === 0) {
    throw new Error("AI generated invalid formula format. Expected a non-empty 'formulas' array.");
  }

  return result.formulas.map((f: any) => ({
    title: sanitizeLatex(String(f?.title || '').trim()),
    latex: sanitizeLatex(String(f?.latex || '').trim()),
    description: sanitizeLatex(String(f?.description || '').trim()),
    category: sanitizeLatex(String(f?.category || '').trim()),
  })).filter((f: any) => f.title && f.latex);
}

export async function generateCourseSkeleton(
  courseName: string, 
  courseDescription: string, 
  outline?: string,
  provider?: string,
  existingModuleTitles: string[] = [],
  level?: string,
  semester?: string,
  department?: string,
  curriculumBenchmark?: any,
  tone: string = 'academic',
  depth: string = 'standard',
  sourceContext?: string,
  academicStandard?: string,
  scope?: string,
  selectedFaculties: string[] = [],
  selectedDepartments: string[] = [],
  courseCode?: string,
  creditUnits?: number
 ): Promise<any> {
  if (!courseName || typeof courseName !== 'string' || !courseName.trim()) {
    throw new Error('A verified course title is required before curriculum generation.');
  }
  if (!courseCode || typeof courseCode !== 'string' || !courseCode.trim()) {
    throw new Error('A verified course code is required before curriculum generation.');
  }
  if (!level || typeof level !== 'string' || !level.trim()) {
    throw new Error('An explicit academic level is required before curriculum generation.');
  }
  if (!scope || typeof scope !== 'string' || !scope.trim()) {
    throw new Error('An explicit course audience scope is required before curriculum generation.');
  }
  if (!Number.isInteger(creditUnits) || (creditUnits as number) < 1 || (creditUnits as number) > 12) {
    throw new Error('A verified course credit-unit value between 1 and 12 is required before curriculum generation.');
  }
  const normalizedStandard = academicStandard &&
    academicStandard.trim() !== 'Globally Adaptive (Universal University Standard)' &&
    academicStandard.trim() !== 'Custom Dynamic Academic Benchmark'
      ? academicStandard.trim()
      : undefined;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes for multi-agent audit

  try {
    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const token = await getAuthToken();
        const res = await fetch('/api/course/generate-skeleton', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            courseName: courseName.trim(),
            courseCode: courseCode.trim(),
            department,
            scope: scope.trim(),
            level: level.trim(),
            semester,
            creditUnits,
            tone,
            depth,
            outline,
            sourceText: sourceContext,
            academicStandard: normalizedStandard,
            provider,
            selectedFaculties,
            selectedDepartments
          }),
          signal: controller.signal
        });

        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          const text = await res.text().catch(() => '');
          if (attempt < 3 && (text.includes('<!doctype') || text.includes('Starting Server') || res.status === 502 || res.status === 503 || res.status === 504)) {
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            continue;
          }
          if (text.includes('<!doctype') || text.includes('Starting Server') || !res.ok) {
            throw new Error('Application server is warming up or temporarily unavailable. Please retry in a few moments.');
          }
          throw new Error(`Unexpected server response format (${res.status}).`);
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Server failed to generate course structure (${res.status}).`);
        }

        clearTimeout(timeoutId);
        const data = await res.json();
        return data;
      } catch (err: any) {
        lastError = err;
        const msg = (err?.message || String(err)).toLowerCase();
        if (err?.name !== 'AbortError' && attempt < 3 && (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('warming up'))) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error('Failed to generate course structure.');
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn('generateCourseSkeleton error:', err?.message || err);
    throw err;
  }
}

import { z } from 'zod';

export const RelevanceSchema = z.object({
  department: z.string(),
  concept: z.string().min(3),
  application: z.string().min(20)
});

export const LessonOutputSchema = z.object({
  introduction: z.string().min(1),
  keyConcepts: z.array(z.string()).min(1),
  body: z.string().min(1),
  relevance: z.array(RelevanceSchema).default([])
});

export interface CourseContext {
  id?: string;
  title: string;
  department?: string;
  departments?: string[];
  faculties?: string[];
  scope?: string;
  level?: string;
  academicStandard?: string;
  tone?: string;
  depth?: string;
  sourceContext?: string;
}

export async function generateLessonContent(
  courseContext: CourseContext | string,
  moduleTitle: string,
  lessonTitle: string,
  provider?: string,
  level?: string,
  department?: string,
  tone: string = 'academic',
  depth: string = 'standard',
  sourceContext?: string,
  academicStandard?: string
): Promise<{ title: string, content: string, metadata: PipelineMetadata }> {
  // 1. Extract verified course metadata from CourseContext object or parameters
  const isContextObj = typeof courseContext === 'object' && courseContext !== null;
  const courseName: string = typeof courseContext === 'string'
    ? courseContext.trim()
    : String(courseContext.title || '').trim();
  if (!courseName) {
    throw new Error('Verified course title is required before generating lesson content.');
  }
  const courseCode: string = isContextObj ? String(courseContext.id || '').trim() : '';
  const effectiveLevel = (isContextObj ? courseContext.level || level : level)?.trim() || '';
  if (!effectiveLevel) {
    throw new Error(`Verified academic level is required before generating lesson "${lessonTitle}" for "${courseName}".`);
  }
  const rawStandard = isContextObj ? (courseContext.academicStandard || academicStandard) : academicStandard;
  const effectiveStandard = rawStandard &&
    rawStandard.trim() !== 'Globally Adaptive (Universal University Standard)' &&
    rawStandard.trim() !== 'Custom Dynamic Academic Benchmark'
      ? rawStandard.trim()
      : undefined;
  const effectiveTone = isContextObj ? courseContext.tone || tone : tone;
  const effectiveDepth = isContextObj ? courseContext.depth || depth : depth;
  const effectiveSourceContext = isContextObj ? courseContext.sourceContext || sourceContext : sourceContext;
  if (typeof effectiveSourceContext === 'string' && effectiveSourceContext.length > 50000) {
    throw new Error('Course source context exceeds 50,000 characters. No source text was truncated; split or reduce the source document before generation.');
  }

  // 2. Extract audience strictly from course metadata
  let audienceList: string[] = [];
  if (isContextObj) {
    audienceList = [
      ...(Array.isArray(courseContext.departments) ? courseContext.departments : []),
      ...(courseContext.department ? [courseContext.department] : []),
      ...(Array.isArray(courseContext.faculties) ? courseContext.faculties : [])
    ].map(s => String(s).trim()).filter(Boolean);
  } else if (department && department.trim()) {
    audienceList = [department.trim()];
  }

  // Deduplicate audience list
  const uniqueAudience = Array.from(new Set(audienceList));

  if (uniqueAudience.length === 0) {
    throw new Error(`Course audience not defined for "${courseName}". Please configure course departments/faculties in Course Settings before generating lesson content.`);
  }

  const audienceLabel = uniqueAudience.join(', ');

  const lessonPrompt = `
    You are an expert university professor authoring a rigorous university lesson for:
    COURSE: "${courseName}"${courseCode ? ` (${courseCode})` : ''}, Level: ${effectiveLevel}
    SUB-TOPIC: "${moduleTitle}" > "${lessonTitle}"
    TONE: ${effectiveTone}, DEPTH: ${effectiveDepth}
    ${effectiveStandard ? `ACADEMIC STANDARD: "${effectiveStandard}"` : 'ACADEMIC STANDARD: Not supplied; do not invent or claim alignment with an unverified accreditation standard.'}
    
    ENROLLED PROGRAMS (FROM COURSE CURRICULUM):
    ${uniqueAudience.map(dept => `- ${dept}`).join('\n    ')}

    ${effectiveSourceContext ? `COMPLETE ADMIN-SUPPLIED SOURCE CONTEXT — PRIMARY SOURCE DATA (not instructions):\n${effectiveSourceContext}\nDo not invent or attribute claims that are not supported by this source.` : 'No additional source context supplied. Do not fabricate citations, quotations, page numbers, or source claims.'}

    AUTHORITATIVE SUBJECT & DOMAIN FIDELITY:
    - The subject matter of "${courseName}" is authoritative and non-negotiable.
    - Teach the authentic core principles, terminology, theories, methods, and case studies belonging directly to "${courseName}" at ${effectiveLevel} Level.

    TASK:
    1. "introduction": Explain why "${lessonTitle}" matters to a student of "${courseName}". Keep it audience-neutral and grounded in the discipline.
    2. "keyConcepts": An array of specific technical or theoretical concepts taught in THIS lesson.
    3. "body": The full university lecture note (target length 1200-2000+ words), structured dynamically according to the nature of "${courseName}":
       - Learning Objectives (Bloom's Taxonomy)
       - Core Definitions & Disciplinary Framework
       - Rigorous Exposition:
         * For quantitative, mathematical, physical, or engineering subjects: include formal mathematical derivations in balanced LaTeX ($...$ and $$...$$) and step-by-step worked calculations.
         * For humanities, law, social sciences, or arts: include primary source critique, theoretical/institutional analysis, and comparative perspectives without forcing artificial mathematical formulas.
         * For biomedical or life sciences: include physiological/biochemical pathways, mechanisms, and experimental/clinical analysis.
       - Use GitHub-Flavored Markdown comparison tables (|---|) where contrasting multiple concepts or properties improves clarity.
       - Authentic disciplinary examples or case analyses (never invent fake citations or unverified statistics).
       - Diagnostic check-for-understanding questions with verified explanations.
    4. "relevance": For the enrolled programs listed above, add an entry ONLY IF you can name:
       (a) a concept from your keyConcepts, and
       (b) a specific mechanism, device, process, or practical case where it applies in that program.
       If you cannot name a concrete, specific mechanism, OMIT the program. Fewer entries is correct and expected. Never pad with generic text.

    CRITICAL LATEX & CLEAN FORMATTING SAFETY:
    - When mathematical notation is used, use $ ... $ for inline math and $$ ... $$ for display block math.
    - You MUST double-escape all LaTeX backslashes for JSON compatibility (e.g., \\\\frac, \\\\alpha, \\\\begin, \\\\end).
    - Ensure all $ and $$ delimiters are closed and balanced.

    Return STRICTLY valid JSON matching this schema:
    {
      "introduction": "Conceptual introduction to the lesson topic...",
      "keyConcepts": ["Concept A", "Concept B", "Concept C"],
      "body": "Full detailed markdown lesson body...",
      "relevance": [
        {
          "department": "Exact Department Name from enrolled list",
          "concept": "Specific concept from keyConcepts",
          "application": "Specific mechanism, process, or application in this discipline..."
        }
      ]
    }
  `;

  const result = await callGenerateAPI(lessonPrompt, 'lesson', provider);

  // Parse structured response strictly — fail transparently on malformed output
  let parsedOutput: any = null;
  if (typeof result === 'object' && result !== null) {
    parsedOutput = result;
  } else if (typeof result === 'string') {
    try {
      parsedOutput = JSON.parse(result);
    } catch (_) {
      try {
        parsedOutput = JSON.parse(jsonrepair(result));
      } catch (parseErr: any) {
        throw new Error(`Failed to parse structured lesson response for "${lessonTitle}": ${parseErr?.message || String(parseErr)}`);
      }
    }
  }

  if (!parsedOutput || typeof parsedOutput !== 'object') {
    throw new Error(`Lesson generation for "${lessonTitle}" returned an empty or non-object payload.`);
  }

  const introduction = String(parsedOutput.introduction || '').trim();
  const rawBody = String(parsedOutput.body || parsedOutput.content || '').trim();
  if (!rawBody) {
    throw new Error(`Lesson generation for "${lessonTitle}" returned an empty lesson body.`);
  }

  const rawKeyConcepts = Array.isArray(parsedOutput.keyConcepts) ? parsedOutput.keyConcepts : [];
  const rawRelevance = Array.isArray(parsedOutput.relevance) ? parsedOutput.relevance : [];

  const seenDepts = new Set<string>();
  const validatedRelevance = rawRelevance.filter((entry: any) => {
    if (!entry || typeof entry !== 'object') return false;
    const dept = String(entry.department || '').trim();
    const concept = String(entry.concept || '').trim();
    const application = String(entry.application || '').trim();

    if (!dept || concept.length < 3 || application.length < 20) return false;

    const matchedDept = uniqueAudience.find(a => a.toLowerCase() === dept.toLowerCase());
    if (!matchedDept) return false;

    if (seenDepts.has(matchedDept.toLowerCase())) return false;
    seenDepts.add(matchedDept.toLowerCase());

    entry.department = matchedDept;
    return true;
  });

  // Assemble full lesson markdown without forcing a synthetic "The Why Before the How" heading
  const fullLessonMarkdown = introduction && !rawBody.startsWith('#')
    ? `## ${lessonTitle}\n\n${introduction}\n\n---\n\n${rawBody}`
    : (introduction ? `${introduction}\n\n---\n\n${rawBody}` : rawBody);

  const compiledLesson = compileAndSanitizeCourseMarkdown(fullLessonMarkdown);
  const sanitizedContent = compiledLesson.normalizedMarkdown;

  // Post-generation off-topic drift check
  const driftCheck = flagOffTopicDrift(sanitizedContent, courseName, audienceLabel);
  if (driftCheck.hasDrift) {
    console.warn(`[AI Course Generator] Potential off-topic drift detected in lesson "${lessonTitle}" for course "${courseName}" (${audienceLabel}):`, driftCheck.hits);
  }

  const cleanMetadata: PipelineMetadata = {
    hasMath: compiledLesson.hasMath,
    hasCode: compiledLesson.hasCode,
    audience: uniqueAudience,
    audienceHash: uniqueAudience.slice().sort().join(':'),
    promptVersion: '3.0.0-marked-katex-dompurify',
    keyConcepts: rawKeyConcepts,
    relevance: validatedRelevance,
    generatedAt: new Date().toISOString()
  };

  return {
    title: lessonTitle,
    content: sanitizedContent,
    metadata: cleanMetadata
  };
}

export async function generateModuleQuiz(
  courseName: string,
  moduleTitle: string,
  quizTopics: string[],
  provider?: string,
  level?: string,
  department?: string,
  academicStandard?: string,
  authoredLessons?: Array<{ title: string; content: string }>
): Promise<any> {
  if (!Array.isArray(authoredLessons) || authoredLessons.length === 0) {
    throw new Error(`Module quiz generation for "${moduleTitle}" requires persisted lesson content; quizzes cannot be generated from topic titles alone.`);
  }
  const validLessons = authoredLessons.filter(
    l => l && typeof l.title === 'string' && l.title.trim().length > 0 && typeof l.content === 'string' && l.content.trim().length >= 400
  );
  if (validLessons.length === 0) {
    throw new Error(`Module quiz generation for "${moduleTitle}" requires substantive authored lesson content.`);
  }

  const combinedLessonContext = validLessons
    .map((l, idx) => `[LESSON ${idx + 1}: "${l.title.trim()}"]\n${l.content.trim()}`)
    .join('\n\n---\n\n');

  const normalizedStandard = academicStandard &&
    academicStandard.trim() !== 'Globally Adaptive (Universal University Standard)' &&
    academicStandard.trim() !== 'Custom Dynamic Academic Benchmark'
      ? academicStandard.trim()
      : undefined;

  const quizPrompt = `
    Generate a university-level multiple-choice quiz for the module "${moduleTitle}" in course "${courseName}".
    ${level ? `Academic Level: ${level}` : ''}
    ${department ? `Department / Discipline: ${department}` : ''}
    ${normalizedStandard ? `Accredited Standard: ${normalizedStandard}` : ''}
    ${Array.isArray(quizTopics) && quizTopics.length > 0 ? `Focus Topics: ${quizTopics.join(', ')}` : ''}

    [AUTHORITATIVE LESSON SOURCE MATERIAL — SOLE FACTUAL BASIS]:
    """
    ${combinedLessonContext}
    """

    STRICT GROUNDING & ZERO-FABRICATION RULES:
    1. Generate 8-12 rigorous multiple-choice questions derived EXCLUSIVELY from the [AUTHORITATIVE LESSON SOURCE MATERIAL] above.
    2. Do NOT test concepts, theorems, or facts absent from the provided lesson text, and do NOT invent external textbook sections or citations.
    3. Every question MUST include a "sourceReference" field containing a verbatim phrase or sentence copied directly from the [AUTHORITATIVE LESSON SOURCE MATERIAL] that proves the correct answer.
    4. Use balanced LaTeX ($...$ and $$...$$) with double-escaped backslashes (e.g., \\\\frac) whenever mathematical notation is used.
    5. Return ONLY valid JSON:
    {
      "questions": [
        {
          "type": "multiple-choice",
          "question": "...",
          "options": ["...", "...", "...", "..."],
          "correctAnswer": "...",
          "explanation": "...",
          "hint": "...",
          "sourceReference": "Exact verbatim quote from the lesson source material above"
        }
      ]
    }
  `;

  const result = await callGenerateAPI(quizPrompt, 'module', provider);

  if (result && result.questions && Array.isArray(result.questions)) {
    result.questions = result.questions.map((q: any) => {
      if (!q || typeof q !== 'object') return q;
      const sanitized = {
        ...q,
        question: sanitizeLatex(q.question),
        options: Array.isArray(q.options) ? q.options.map((opt: any) => sanitizeLatex(opt)) : q.options,
        explanation: sanitizeLatex(q.explanation),
        hint: sanitizeLatex(q.hint),
        sourceReference: typeof q.sourceReference === 'string' ? q.sourceReference.trim() : ''
      };
      return autoHealQuestion(sanitized);
    });
  }

  if (Array.isArray(result)) {
    return { questions: result };
  }

  if (result && result.questions && Array.isArray(result.questions)) {
    return result;
  }

  throw new Error(`Module quiz generation for "${moduleTitle}" did not return a valid questions array.`);
}

export async function generateModuleContent(
  courseName: string,
  moduleSkeleton: any,
  provider?: string,
  onProgress?: (message: string) => void,
  checkCancelled?: () => boolean,
  tone: string = 'academic',
  depth: string = 'standard',
  sourceContext?: string,
  academicStandard?: string,
  level?: string,
  department?: string
): Promise<any> {
  if (!moduleSkeleton || typeof moduleSkeleton.title !== 'string' || !moduleSkeleton.title.trim()) {
    throw new Error('Verified module title is required before generating module content.');
  }
  if (!Array.isArray(moduleSkeleton.lessonTitles) || moduleSkeleton.lessonTitles.length === 0) {
    throw new Error(`Module "${moduleSkeleton.title}" has no verified lesson titles.`);
  }
  if (onProgress) onProgress(`Generating Module: ${moduleSkeleton.title}...`);

  const lessons = [];
  for (const lessonTitle of moduleSkeleton.lessonTitles) {
    if (checkCancelled && checkCancelled()) throw new Error('Generation cancelled by user.');
    if (onProgress) onProgress(`Generating Lesson: ${lessonTitle}...`);
    const lesson = await generateLessonContent(courseName, moduleSkeleton.title, lessonTitle, provider, level, department, tone, depth, sourceContext, academicStandard);
    lessons.push(lesson);
  }

  if (checkCancelled && checkCancelled()) throw new Error('Generation cancelled by user.');
  if (onProgress) onProgress(`Generating Quiz for: ${moduleSkeleton.title}...`);
  const quizTopics = Array.isArray(moduleSkeleton.quizTopics) && moduleSkeleton.quizTopics.length > 0
    ? moduleSkeleton.quizTopics
    : moduleSkeleton.lessonTitles;
  const quiz = await generateModuleQuiz(
    courseName,
    moduleSkeleton.title,
    quizTopics,
    provider,
    level,
    department,
    academicStandard,
    lessons
  );

  return {
    title: moduleSkeleton.title,
    lessons,
    quiz
  };
}

export async function generateCourseContent(
  courseName: string,
  courseDescription: string,
  outline?: string,
  provider?: string,
  onProgress?: (progress: number, message: string) => void,
  tone: string = 'academic',
  depth: string = 'standard',
  sourceContext?: string,
  academicStandard?: string,
  level?: string,
  department?: string,
  creditUnits?: number,
  semester?: string,
  scope?: string,
  courseCode?: string
): Promise<GeneratedCourse> {
  if (!Number.isInteger(creditUnits) || (creditUnits as number) < 1 || (creditUnits as number) > 12) {
    throw new Error('Verified course credit units are required for full-course generation.');
  }
  if (!level?.trim() || !department?.trim() || !scope?.trim() || !courseCode?.trim()) {
    throw new Error('Verified courseCode, level, department, and scope are required for full-course generation.');
  }
  if (onProgress) onProgress(10, "Generating course skeleton...");

  const skeleton = await generateCourseSkeleton(
    courseName,
    courseDescription,
    outline,
    provider,
    [],
    level,
    semester,
    department,
    undefined,
    tone,
    depth,
    sourceContext,
    academicStandard,
    scope,
    [],
    [department],
    courseCode,
    creditUnits
  );

  if (!skeleton || !skeleton.modules || !Array.isArray(skeleton.modules)) {
    throw new Error("Failed to generate a valid course skeleton.");
  }

  const totalModules = skeleton.modules.length;
  const finalCourse: GeneratedCourse = {
    description: skeleton.description,
    modules: []
  };

  // Step 2: Generate Content for each module
  const CONCURRENCY_LIMIT = 3;
  for (let i = 0; i < totalModules; i += CONCURRENCY_LIMIT) {
    const chunk = skeleton.modules.slice(i, i + CONCURRENCY_LIMIT);
    const chunkEnd = Math.min(i + CONCURRENCY_LIMIT, totalModules);

    if (onProgress) {
      const progress = 10 + Math.round((i / totalModules) * 90);
      onProgress(progress, `Generating content for Modules ${i + 1}-${chunkEnd} of ${totalModules}...`);
    }

    try {
      const chunkPromises = chunk.map(async (moduleSkeleton: any, idx: number) => {
        const moduleContent = await generateModuleContent(courseName, moduleSkeleton, provider, undefined, () => false, tone, depth, sourceContext, academicStandard, level, department);
        return { index: i + idx, content: moduleContent };
      });

      const results = await Promise.all(chunkPromises);
      results.sort((a, b) => a.index - b.index);

      for (const res of results) {
        finalCourse.modules.push(res.content);
      }
    } catch (error) {
      console.error(`Failed to generate modules ${i + 1}-${chunkEnd}:`, error);
      throw new Error(`Failed to generate content for Modules ${i + 1}-${chunkEnd}. Please try again.`);
    }
  }

  if (onProgress) onProgress(100, "Course generation complete!");

  return finalCourse;
}
