import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import katex from 'katex';
import { 
  DomainBrief, 
  DisciplinePedagogyType, 
  CourseSkeleton, 
  OutlineCriticRubric, 
  deriveCurriculumParameters,
  inspectAndNormalizeMathUnicode,
  isBareDiagramOrFragment,
  normalizeLessonMarkdownContent,
  MathUnicodeNormalizationEvent
} from '../src/shared/courseSchemas.js';
import { LATEX_INSTRUCTION } from '../src/shared/prompts.js';

function katexStrictDiagnosticPolicy(errorCode: string): 'error' | 'ignore' {
  if (errorCode === 'unknownSymbol' || errorCode === 'unicodeTextInMathMode') {
    return 'error';
  }
  return 'ignore';
}

const curriculumMarkedValidator = new Marked({
  gfm: true,
  breaks: true,
});

curriculumMarkedValidator.use(
  markedKatex({
    throwOnError: true,
    nonStandard: true,
    output: 'htmlAndMathml',
    strict: katexStrictDiagnosticPolicy,
  })
);

export interface CurriculumGenerationOptions {
  courseId: string;
  courseName: string;
  courseCode?: string;
  department?: string;
  level?: string;
  semester?: string;
  tone?: string;
  depth?: string;
  creditUnits?: number;
  scope?: string;
  selectedFaculties?: string[];
  selectedDepartments?: string[];
  outline?: string;
  sourceText?: string;
  researchContext?: string;
  academicStandard?: string;
}

/**
 * Lesson syntax and structural validator powered by Marked AST + direct katex.renderToString() + marked-katex-extension.
 * Enforces balanced KaTeX delimiters, valid AST tokenization (>= 3 headings & >= 3 substantive prose blocks),
 * equation-level katex.renderToString({ throwOnError: true }) verification, and valid markdown table structure.
 */
export function validateLessonSyntax(
  content: string,
  pedagogyType: DisciplinePedagogyType = 'STEM_MATHEMATICAL'
): {
  isValid: boolean;
  errors: string[];
  normalizationEvents?: MathUnicodeNormalizationEvent[];
} {
  const errors: string[] = [];
  if (!content || typeof content !== 'string') {
    return { isValid: false, errors: ['Lesson content is empty or null.'] };
  }

  const unicodeInspection = inspectAndNormalizeMathUnicode(content, 'lesson_validation');
  const trimmed = normalizeLessonMarkdownContent(unicodeInspection.normalizedText);

  if (unicodeInspection.unsupportedCharacters.length > 0) {
    const formatted = unicodeInspection.unsupportedCharacters
      .map((item) => `'${item.glyph}' (${item.codePoint})`)
      .join(', ');
    errors.push(`Unsupported mathematical Unicode character(s) inside LaTeX delimiters cannot be safely normalized: ${formatted}. Use standard LaTeX syntax.`);
  }

  if (trimmed.length < 800) {
    errors.push(`Lesson content is too brief (${trimmed.length} chars). Expected a comprehensive university lesson (>= 800 chars).`);
  }

  if (isBareDiagramOrFragment(trimmed)) {
    errors.push('Lesson content consists only of a bare diagram/code snippet without substantive university academic prose and section headings.');
  }

  if (/viewBox=\\"|xmlns=\\"/.test(trimmed)) {
    errors.push('Lesson content contains raw unescaped JSON attribute quotes (\\").');
  }

  // 0. Code Fence Balance Check
  const codeFenceMatches = trimmed.match(/^```/gm) || [];
  if (codeFenceMatches.length % 2 !== 0) {
    errors.push(`Unbalanced markdown code fences (\`\`\`). Found ${codeFenceMatches.length} fence markers.`);
  }

  // 1. KaTeX Display Math & Direct katex.renderToString() Equation Verification
  const withoutCodeFences = trimmed.replace(/```[\s\S]*?```/g, '');
  const displayMathMatches = withoutCodeFences.match(/(?<!\\)\$\$/g) || [];
  if (displayMathMatches.length % 2 !== 0) {
    errors.push(`Unbalanced display math delimiters ($$). Found ${displayMathMatches.length} occurrences (must be an even number).`);
  }

  const beginMatches = withoutCodeFences.match(/\\begin\{([a-zA-Z*]+)\}/g) || [];
  const endMatches = withoutCodeFences.match(/\\end\{([a-zA-Z*]+)\}/g) || [];
  if (beginMatches.length !== endMatches.length) {
    errors.push(`Mismatched LaTeX environment tags: found ${beginMatches.length} \\begin{} vs ${endMatches.length} \\end{}.`);
  }

  // Verify extracted $$ ... $$ display equations directly with katex.renderToString
  const displayBlocks = withoutCodeFences.match(/(?<!\\)\$\$([\s\S]*?)(?<!\\)\$\$/g) || [];
  for (const rawBlock of displayBlocks) {
    const mathExpr = rawBlock.slice(2, -2).trim();
    if (!mathExpr) continue;
    try {
      katex.renderToString(mathExpr, {
        throwOnError: true,
        displayMode: true,
        strict: katexStrictDiagnosticPolicy
      });
    } catch (kErr: any) {
      errors.push(`KaTeX display equation syntax error: ${kErr?.message || String(kErr)}`);
    }
  }

  // Verify extracted $ ... $ inline equations directly with katex.renderToString (ignoring escaped \$ currency)
  const withoutDisplay = withoutCodeFences.replace(/(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$/g, '').replace(/`[^`\n]+`/g, '');
  const inlineBlocks = withoutDisplay.match(/(?<!\\|\$)\$(?!\$)((?:\\\$|[^$\n])+?)(?<!\\|\$)\$(?!\$)/g) || [];
  for (const rawInline of inlineBlocks) {
    const mathExpr = rawInline.slice(1, -1).trim();
    if (!mathExpr) continue;
    // Skip currency ranges like "$100 and $200" that are not LaTeX math
    if (/^\d[\d,.]*\s+[a-zA-Z]/.test(mathExpr) && !/[\\^_{}=]/.test(mathExpr)) continue;
    try {
      katex.renderToString(mathExpr, {
        throwOnError: true,
        displayMode: false,
        strict: katexStrictDiagnosticPolicy
      });
    } catch (kErr: any) {
      errors.push(`KaTeX inline equation syntax error in "$${mathExpr}$": ${kErr?.message || String(kErr)}`);
    }
  }

  // 2. AST Parse, Structural Heading/Prose Check & KaTeX Compilation Validation via Marked
  try {
    const tokens = curriculumMarkedValidator.lexer(trimmed);
    let headingCount = 0;
    let substantiveBlockCount = 0;
    for (const token of tokens as any[]) {
      if (token.type === 'heading') headingCount++;
      if (token.type === 'paragraph' || token.type === 'list' || token.type === 'blockquote' || token.type === 'table') {
        substantiveBlockCount++;
      }
    }
    if (headingCount < 3) {
      errors.push(`Insufficient structural section headings (found ${headingCount}, expected at least 3 '##' section headings).`);
    }
    if (substantiveBlockCount < 3) {
      errors.push(`Insufficient academic prose blocks (found ${substantiveBlockCount}, expected at least 3 substantive paragraphs/tables/lists).`);
    }
    curriculumMarkedValidator.parser(tokens);
  } catch (astErr: any) {
    errors.push(`Markdown/KaTeX compilation error: ${astErr?.message || String(astErr)}`);
  }

  // 3. Markdown Table Check (Math-Aware)
  const lines = trimmed.split('\n');
  let inTable = false;
  let tableHeaderCols = 0;
  let tableRowIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (rawLine.startsWith('|') && rawLine.endsWith('|')) {
      const maskedLine = rawLine
        .replace(/\\\|/g, '__ESCAPED_PIPE__')
        .replace(/\$\$[\s\S]*?\$\$/g, '__DISPLAY_MATH__')
        .replace(/\$[^\$]*?\$/g, '__INLINE_MATH__');

      const cols = maskedLine.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (!inTable) {
        inTable = true;
        tableHeaderCols = cols.length;
        tableRowIndex = 0;
      } else {
        tableRowIndex++;
        if (tableRowIndex === 1 && maskedLine.includes('---')) {
          // Valid GFM table separator
        } else if (cols.length !== tableHeaderCols && cols.length > 0) {
          if (Math.abs(cols.length - tableHeaderCols) > 2) {
            errors.push(`Markdown table column count mismatch at line ${i + 1}: header has ${tableHeaderCols} columns, but row has ${cols.length}.`);
            break;
          }
        }
      }
    } else {
      inTable = false;
      tableHeaderCols = 0;
    }
  }

  // 4. Diagram & Visualization Integrity Check
  const mermaidBlocks = trimmed.match(/```mermaid[\s\S]*?```/gi) || [];
  for (const block of mermaidBlocks) {
    if (/quadrantChart/i.test(block) && /(origin|circle|tangent|radius|slope|x\^2|y\^2|coordinate|axis)/i.test(block)) {
      errors.push('Invalid mathematical visualization: Mermaid quadrantChart was used for Cartesian geometry/curves. Use ```function-plot or ```svg instead.');
      break;
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    normalizationEvents: unicodeInspection.events
  };
}

/**
 * Stage 0: Grounding Prompt
 * Retrieves course-level references (textbook TOCs, university syllabi) and classifies pedagogy type.
 */
export function buildDomainBriefPrompt(options: CurriculumGenerationOptions): string {
  const { courseName, courseCode, department, level, outline, sourceText, researchContext } = options;
  if (typeof level !== 'string' || !level.trim()) {
    throw new Error('An explicit academic level is required; curriculum generation will not assume 100 Level.');
  }
  const normalizedLevel = level.trim();
  const departmentContext = typeof department === 'string' && department.trim()
    ? department.trim()
    : 'not supplied; do not infer a department';
  return `Analyze the course title "${courseName}" ${courseCode ? `(Code: ${courseCode})` : ''} at Academic Level "${normalizedLevel} Level" within the department "${departmentContext}".
${outline && outline.trim() ? `\n[ADMIN-PROVIDED SYLLABUS OUTLINE (MANDATORY PRIMARY AUTHORITY)]:\n${outline.trim()}\n` : ''}
${sourceText && sourceText.trim() ? `\n[COMPLETE ADMIN-SUPPLIED SOURCE MATERIAL — PRIMARY AUTHORITY]:\n${sourceText}\n` : ''}
${researchContext && researchContext.trim() ? `\n[RETRIEVED ACADEMIC EVIDENCE — SUPPLEMENTARY, SOURCE-ATTRIBUTED]:\n${researchContext}\n` : '\n[RESEARCH STATUS]: No retrieved academic evidence was supplied. Do not invent sources, citations, textbook editions, institutional syllabi, or evidence claims.\n'}

[GROUNDING & COURSE-LEVEL TAXONOMY TASK]:
1. Identify the primary authoritative academic discipline.
2. Determine the Pedagogy Type based on the nature of the discipline:
   - "STEM_MATHEMATICAL": Physical sciences, engineering, mathematics, computer science (emphasizes formal derivations, quantitative models, KaTeX equations, physical laws).
   - "HUMANITIES_LAW_ARTS": History, philosophy, literature, law, languages (emphasizes primary source analysis, textual critique, legal precedence, ethical discourse).
   - "SOCIAL_SCIENCES_BUSINESS": Economics, finance, management, sociology, psychology (emphasizes empirical methodology, behavioral/market case studies, statistical interpretation).
   - "BIOMEDICAL_LIFE_SCIENCES": Biology, medicine, pharmacology, biochemistry (emphasizes biochemical pathways, physiological mechanisms, clinical implications).
   - "GENERAL_FOUNDATIONS": Interdisciplinary survey or academic study skills.
3. Calibrate the "courseLevelFramework" specifically to "${normalizedLevel} Level" university expectations:
   - 100 Level: First-year foundational principles, introductory concepts, fundamental definitions, and broad disciplinary orientation.
   - 200 Level: Second-year core analytical methods, intermediate theory, and structured problem-solving.
   - 300 Level: Third-year upper-division specialized mechanisms, rigorous derivations, and applied systems analysis.
   - 400 / 500 Level: Advanced senior/graduate-level synthesis, complex mathematical/theoretical modeling, and research-grade case studies.
4. List 3-5 sub-disciplines relevant to "${courseName}" at ${normalizedLevel} Level.
5. List 8-14 core course topics that define the syllabus of this course at ${normalizedLevel} Level:
   - CRITICAL: If an [ADMIN-PROVIDED SYLLABUS OUTLINE] is present above, you MUST extract and include EVERY topic, unit, and theme from the admin's outline into "coreCourseTopics", ordered logically for ${normalizedLevel} Level.
   - If no admin outline is provided, derive the standard accredited university syllabus topics for "${courseName}" (${courseCode || ''}) at ${normalizedLevel} Level.
6. Identify canonical references only when a specific title/author/edition or institutional source is explicitly present in the admin-supplied material or retrieved evidence above. Do not infer or invent references. Include source URLs where available; return an empty array when no such reference is present.
7. Formulate 3-4 foundational axioms/principles that establish the core framework for orientation in Module 1.

Return strictly a JSON object:
{
  "primaryDomain": "Authoritative academic discipline",
  "subDisciplines": ["Sub-discipline 1", "Sub-discipline 2", "Sub-discipline 3"],
  "pedagogyType": "STEM_MATHEMATICAL",
  "courseLevelFramework": "${normalizedLevel} Level University Curriculum Standard",
  "canonicalCourseReferences": ["Exact source-attributed references found in admin-supplied or retrieved material; empty array when no reference is present"],
  "foundationalAxioms": [
    "Foundational Principle 1",
    "Foundational Principle 2",
    "Foundational Principle 3"
  ],
  "coreCourseTopics": [
    "Core Topic 1",
    "Core Topic 2",
    "Core Topic 3",
    "Core Topic 4",
    "Core Topic 5",
    "Core Topic 6"
  ]
}`;
}

/**
 * Stage 1: Dynamic Syllabus Skeleton Generator Prompt
 * Derives module count from credits and term length, and enforces the domain-agnostic Module 1 Orientation Rule.
 */
export function buildCurriculumSkeletonPrompt(
  domainBrief: DomainBrief,
  options: CurriculumGenerationOptions,
  feedbackCritique?: string
): string {
  const {
    courseName,
    courseCode,
    level,
    semester,
    tone = 'academic',
    depth = 'standard',
    creditUnits,
    scope,
    selectedFaculties = [],
    selectedDepartments = [],
    outline,
    sourceText,
    researchContext,
    academicStandard
  } = options;

  if (typeof level !== 'string' || !level.trim()) {
    throw new Error('An explicit academic level is required; curriculum generation will not assume 100 Level.');
  }
  if (typeof scope !== 'string' || !scope.trim()) {
    throw new Error('An explicit course audience scope is required; department scope will not be assumed.');
  }

  const normalizedLevel = level.trim();
  const normalizedSemester = typeof semester === 'string' && semester.trim()
    ? semester.trim()
    : 'not supplied; do not infer a semester';
  const normalizedAcademicStandard = typeof academicStandard === 'string' && academicStandard.trim()
    ? academicStandard.trim()
    : 'not supplied; do not infer an accreditation or university standard';
  if (typeof creditUnits !== 'number' || !Number.isInteger(creditUnits) || creditUnits <= 0) {
    throw new Error('Verified course credit units are required; curriculum workload will not be inferred from an AI recommendation.');
  }
  const params = deriveCurriculumParameters(normalizedLevel, semester, creditUnits, depth);
  const normalizedScope = scope.trim().toUpperCase();

  let levelCalibrationDirective = '';
  if (normalizedLevel.includes('100')) {
    levelCalibrationDirective = `ACADEMIC LEVEL CALIBRATION (100 LEVEL — FIRST-YEAR UNDERGRADUATE):
- Assume students are entering the discipline from secondary/high-school foundations.
- Prioritize conceptual clarity, fundamental laws/definitions, step-by-step introductory derivations, and foundational terminology before intermediate applications.
- Do NOT jump into graduate-level or 400-level specialized research topics unless explicitly requested in the Admin Outline.`;
  } else if (normalizedLevel.includes('200')) {
    levelCalibrationDirective = `ACADEMIC LEVEL CALIBRATION (200 LEVEL — SECOND-YEAR LOWER-DIVISION CORE):
- Build upon 100-level introductory prerequisites with structured analytical methods, core disciplinary theorems/frameworks, and standard quantitative/qualitative problem sets.`;
  } else if (normalizedLevel.includes('300')) {
    levelCalibrationDirective = `ACADEMIC LEVEL CALIBRATION (300 LEVEL — THIRD-YEAR UPPER-DIVISION):
- Emphasize rigorous theoretical mechanisms, multi-variable/system-level analysis, formal derivations, and specialized domain applications.`;
  } else if (normalizedLevel.includes('400') || normalizedLevel.includes('500')) {
    levelCalibrationDirective = `ACADEMIC LEVEL CALIBRATION (${normalizedLevel} LEVEL — SENIOR / ADVANCED CAPSTONE):
- Deliver advanced theoretical synthesis, complex modeling, edge-case analysis, and professional/research-grade case studies.`;
  } else {
    levelCalibrationDirective = `ACADEMIC LEVEL CALIBRATION (${normalizedLevel} LEVEL):
- Calibrate prerequisite assumptions, theoretical rigor, and topic progression strictly to ${normalizedLevel} Level university standards.`;
  }

  let audienceDirective = '';
  if (normalizedScope === 'GLOBAL' || normalizedScope === 'PUBLIC' || normalizedScope === 'ALL') {
    audienceDirective = `AUDIENCE: MULTIDISCIPLINARY COHORT.
- Pedagogical Directive: Teach the core discipline of "${domainBrief.primaryDomain}" with clear conceptual scaffolding, intuitive analogies, and accessible real-world examples before introducing complex formal models.`;
  } else if (normalizedScope === 'FACULTY') {
    const facs = selectedFaculties.length > 0 ? selectedFaculties.join(', ') : 'Faculty scope; specific faculty not supplied';
    audienceDirective = `AUDIENCE: FACULTY-WIDE (${facs}).
- Pedagogical Directive: Anchor concepts and case studies in interdisciplinary technical applications relevant across ${facs}, emphasizing practical problem-solving in ${domainBrief.primaryDomain}.`;
  } else {
    const depts = selectedDepartments.length > 0 ? selectedDepartments.join(', ') : 'Department scope; specific department not supplied';
    audienceDirective = `AUDIENCE: DEPARTMENTAL SPECIALISTS (${depts}).
- Pedagogical Directive: Teach "${domainBrief.primaryDomain}" with full theoretical rigor, discipline-standard formulations, formal proofs, and specialized professional case studies.`;
  }

  const hasAdminOutline = Boolean(outline && outline.trim().length > 0);

  return `You are an expert university curriculum committee chair in ${domainBrief.primaryDomain}.
Design a complete, comprehensive ${normalizedLevel} Level university syllabus skeleton for "${courseName}" ${courseCode ? `(${courseCode})` : ''}.

AUTHORITATIVE DOMAIN: ${domainBrief.primaryDomain}
PEDAGOGY TYPE: ${domainBrief.pedagogyType}
TARGET ACADEMIC LEVEL: ${normalizedLevel} Level (${domainBrief.courseLevelFramework || 'not supplied; do not infer'})
GROUNDING REFERENCES: ${domainBrief.canonicalCourseReferences.join('; ')}
${researchContext && researchContext.trim() ? `SUPPLEMENTARY RETRIEVED ACADEMIC EVIDENCE (do not treat as an official university syllabus):\n${researchContext}\n` : 'No retrievable academic evidence was supplied; do not invent citations or claims of external verification.'}
REQUIRED CORE TOPICS: ${domainBrief.coreCourseTopics.join(', ')}

${levelCalibrationDirective}

${audienceDirective}
${hasAdminOutline ? `
[MANDATORY ADMIN-PROVIDED COURSE OUTLINE / SYLLABUS]:
"""
${outline!.trim()}
"""
STRICT OUTLINE ADHERENCE DIRECTIVE:
- The Admin has provided an explicit syllabus outline above.
- You MUST faithfully incorporate EVERY module, unit, and topic from the Admin-Provided Course Outline into the generated modules and lessons.
- Do NOT omit, replace, or ignore any topic specified in the Admin's outline. Expand each topic into well-structured lessons appropriate for ${normalizedLevel} Level.` : ''}

[CRITICAL CURRICULUM ARCHITECTURE RULES]:
1. DYNAMIC MODULE COUNT: ${hasAdminOutline ? `Structure the modules to faithfully cover all units in the Admin-Provided Outline (generating at least ${params.minModules} modules, or matching the structural divisions of the Admin Outline).` : `Generate between ${params.minModules} and ${params.maxModules} full academic modules to provide genuine ${normalizedLevel} Level depth for a ${params.credits}-credit course.`}
2. DOMAIN-AGNOSTIC MODULE 1 ORIENTATION RULE:
   - Module 1 MUST establish the history, scope, foundational taxonomy, and core theoretical framework of the discipline at ${normalizedLevel} Level${hasAdminOutline ? ', integrating the introductory topics of the Admin Outline' : ''}.
   - Ground Module 1 in the domain's foundational axioms: ${domainBrief.foundationalAxioms.join('; ')}.
3. PROGRESSIVE TAXONOMY & PREREQUISITES:
   - Organize modules so foundational mechanisms and prerequisite concepts precede complex applications, derivations, and specialized topics calibrated for ${normalizedLevel} Level.
4. BLOOM'S TAXONOMY LEARNING OUTCOMES:
   - Formulate 5-8 measurable "learningOutcomes" covering Bloom's taxonomy (Remember, Understand, Apply, Analyze, Evaluate, Create).
   - Map each module to the relevant learning outcome indices.
5. LESSONS PER MODULE:
   - Provide 3 to 5 distinct, well-titled lessons per module covering the required core topics without superficial skipping.

${feedbackCritique ? `\n[AUDIT FEEDBACK FROM PREVIOUS REVIEW TO REMEDY]:\n${feedbackCritique}\n` : ''}

Level: ${normalizedLevel} Level
Semester: ${normalizedSemester}
Tone: ${tone}
Depth: ${depth}
Academic Standard: ${normalizedAcademicStandard}
${sourceText ? `COMPLETE ADMIN-SUPPLIED SOURCE MATERIAL:\n${sourceText}` : ''}

Return strictly a JSON object:
{
  "pedagogicalReasoning": "Curriculum architecture rationale grounded in ${domainBrief.canonicalCourseReferences.join(' and ')} for ${normalizedLevel} Level",
  "description": "Comprehensive ${normalizedLevel} Level course overview rooted in ${domainBrief.primaryDomain}",
  "pedagogyType": "${domainBrief.pedagogyType}",
  "creditHours": ${params.credits},
  "learningOutcomes": [
    { "outcome": "Demonstrate understanding of the foundational taxonomy...", "bloomLevel": "Understand" },
    { "outcome": "Analyze and calculate quantitative relationships...", "bloomLevel": "Analyze" }
  ],
  "modules": [
    {
      "title": "Module 1 Title (Foundations & Discipline Scope)",
      "isFoundationModule": true,
      "lessonTitles": ["Lesson 1 Title", "Lesson 2 Title", "Lesson 3 Title", "Lesson 4 Title"],
      "quizTopics": ["Concept 1", "Concept 2"],
      "learningOutcomeIds": ["0", "1"]
    }
  ]
}`;
}

/**
 * Stage 2: Outline Critic Prompt with Rubric
 * Audits syllabus skeleton across 4 axes: Coverage, Foundations Orientation, Prerequisite Sequencing, Workload Density.
 */
export function buildOutlineCriticPrompt(
  domainBrief: DomainBrief,
  proposedSkeleton: CourseSkeleton,
  options: CurriculumGenerationOptions
): string {
  const { courseName, courseCode, level, outline, researchContext } = options;
  if (typeof level !== 'string' || !level.trim()) {
    throw new Error('An explicit academic level is required for curriculum auditing.');
  }
  const normalizedLevel = level.trim();
  const moduleSummary = (proposedSkeleton.modules || []).map((m, idx) => 
    `Module ${idx + 1}: "${m.title}" -> Lessons: ${(m.lessonTitles || m.topics || []).join(', ')}`
  ).join('\n');

  return `You are a strict University Academic Accreditation Auditor & Subject Matter Critic.
Evaluate the proposed syllabus for "${courseName}" ${courseCode ? `(${courseCode})` : ''} at Academic Level "${normalizedLevel} Level" against the authoritative discipline "${domainBrief.primaryDomain}".

EXPECTED CANONICAL TOPICS (From Benchmark Syllabi & Domain Brief):
- ${domainBrief.coreCourseTopics.join('\n- ')}
${outline && outline.trim() ? `\nMANDATORY ADMIN-PROVIDED SYLLABUS OUTLINE (MUST BE 100% COVERED):\n"""\n${outline.trim()}\n"""\n` : ''}
${researchContext && researchContext.trim() ? `\nSUPPLEMENTARY SOURCE-ATTRIBUTED RESEARCH CONTEXT (not an official syllabus):\n${researchContext}\n` : ''}
PROPOSED SYLLABUS OUTLINE (${proposedSkeleton.modules?.length || 0} Modules):
${moduleSummary}

[AUDIT RUBRIC AXES]:
1. COVERAGE SCORE (0-100): Are all expected core topics of ${domainBrief.primaryDomain} AND 100% of the topics in the Admin-Provided Syllabus Outline (if provided) represented in the proposed syllabus? Any topic from the Admin Outline that is missing MUST be listed in "missingTopics" and reduce "coverageScore".
2. FOUNDATIONS ORIENTATION SCORE (0-100): Does Module 1 properly establish the history, scope, taxonomy, and core conceptual framework of the discipline for ${normalizedLevel} Level students?
3. PREREQUISITE & LEVEL SEQUENCING SCORE (0-100): Is the pedagogical progression logical for ${normalizedLevel} Level? Do foundational concepts precede advanced applications without inappropriate level jumps?
4. WORKLOAD BALANCE & DENSITY (0-100): Does the module count (${proposedSkeleton.modules?.length || 0}) and lesson count provide legitimate ${normalizedLevel} Level university depth without superficial rushing or bloated repetition?
5. INTERNAL CONSISTENCY (0-100): Are module titles, lesson titles, learning-outcome mappings, quiz topics, course scope, and the stated pedagogy internally aligned? Penalize contradictory sequencing, duplicated modules/lessons, orphaned or invalid learning-outcome references, quiz topics not covered by lessons, and descriptions that conflict with the proposed structure. A high score requires coherent naming, scope, terminology, and assessment alignment.

Return strictly a JSON object:
{
  "isValid": true,
  "coverageScore": 90,
  "foundationsScore": 95,
  "workloadBalanceScore": 90,
  "sequencingScore": 95,
  "consistencyScore": 95,
  "confidenceState": "verified",
  "coveredTopics": ["List of core/admin topics covered in the modules"],
  "missingTopics": ["Any admin outline or core topics omitted, if any"],
  "sequencingErrors": ["Any prerequisite or academic level calibration violations, if any"],
  "genericFillerDetected": false,
  "reasoning": "Summary evaluation explaining the scores, admin outline fidelity, and ${normalizedLevel} Level alignment"
}`;
}

/**
 * Stage 3: Domain-Adaptive Lesson Generator Prompt
 * Configures lesson style dynamically based on Pedagogy Type (STEM vs Humanities vs Business vs Biomedical).
 */
export function buildLessonPrompt(
  topicTitle: string,
  moduleTitle: string,
  moduleOrder: number,
  domainBrief: DomainBrief,
  options: CurriculumGenerationOptions,
  learningOutcomeText?: string
): string {
  const { courseName, department, level, tone = 'academic', depth = 'standard',
    scope, academicStandard, sourceText, researchContext } = options;
  if (typeof level !== 'string' || !level.trim()) {
    throw new Error('An explicit academic level is required for lesson generation.');
  }
  const audience = Array.from(new Set([
    ...(Array.isArray(options.selectedDepartments) ? options.selectedDepartments : []),
    ...(options.department ? [options.department] : []),
    ...(Array.isArray(options.selectedFaculties) ? options.selectedFaculties : [])
  ].map(v => String(v).trim()).filter(Boolean))).join(', ') ||
    (typeof department === 'string' && department.trim() ? department.trim() : 'Department not supplied; do not infer');

  const normalizedDepth = typeof depth === 'string' ? depth.trim().toLowerCase() : 'standard';
  const depthDirectives: Record<string, string> = {
    introductory: 'FOUNDATIONAL DEPTH: Start from first principles. Provide one fully explained worked example, one guided practice, one independent no-hint exercise, and at least two reasoning checks. Avoid unnecessary advanced extensions.',
    standard: 'COMPREHENSIVE DEPTH: Provide a complete university-level treatment with at least two distinct worked examples, guided and independent practice, at least three reasoning checks, explicit assumptions and limitations, and discipline-relevant applications.',
    'deep-dive': 'ADVANCED / ANALYTICAL DEPTH: Provide deeper theoretical treatment with at least three distinct worked examples, including a non-routine or boundary case where appropriate; at least four reasoning checks; explicit derivation or analytical justification; model limitations; and links between concepts. Do not add unsupported topics to increase length.'
  };
  const depthDirective = depthDirectives[normalizedDepth] || depthDirectives.standard;
  const selectedSource = selectRelevantLessonSource(sourceText || '', topicTitle, moduleTitle);

  const disciplineDirectives: Record<DomainBrief['pedagogyType'], string> = {
    STEM_MATHEMATICAL: 'Build physical intuition, state governing assumptions, derive equations from established laws, define symbols and SI units, explain mathematical transformations, and check numerical reasonableness. Never invent experimental values.',
    HUMANITIES_LAW_ARTS: 'Build historical/textual context, compare interpretations, demonstrate argument structure and primary-source analysis. Formal development means an interpretive method or evidentiary argument, not an artificial mathematical derivation. Distinguish facts from interpretation.',
    SOCIAL_SCIENCES_BUSINESS: 'Explain theoretical mechanisms, assumptions, research design, causal logic, statistical methods and limits of evidence. Never fabricate datasets, study findings or company results.',
    BIOMEDICAL_LIFE_SCIENCES: 'Explain structures, mechanisms, pathways, regulation, causal relationships and evidence quality. Use equations only when appropriate. Never invent clinical outcomes, reference values or treatment guidance.',
    GENERAL_FOUNDATIONS: 'Prioritise definitions, conceptual relationships, evidence and discipline-appropriate examples. Select formal reasoning appropriate to the subject; do not force mathematics.'
  };

  return `Create a university lesson for "${topicTitle}" in Module ${moduleOrder}: "${moduleTitle}" of "${courseName}".

ACADEMIC CONTEXT
Discipline: ${domainBrief.primaryDomain}
Discipline engine: ${domainBrief.pedagogyType}
Audience: ${audience}
Level: ${level}
Standard: ${typeof academicStandard === 'string' && academicStandard.trim() ? academicStandard.trim() : 'not supplied; do not infer an accreditation or university standard'}
Tone/depth: ${tone} / ${depth}
DEPTH REQUIREMENTS: ${depthDirective}
Scope: ${typeof scope === 'string' && scope.trim() ? scope.trim() : 'not supplied; do not infer an audience scope'}
Target learning outcome: ${learningOutcomeText || 'Derive measurable objectives only from approved course outcomes and this topic.'}
${selectedSource ? `TOPIC-RELEVANT EXCERPTS FROM THE ADMIN-SUPPLIED SOURCE (primary grounding):\n${selectedSource}` : 'No topic-matched admin source excerpt was selected. Do not fabricate quotations, citations, page numbers, textbooks or empirical findings.'}
${researchContext && researchContext.trim() ? `\nSUPPLEMENTARY RETRIEVED ACADEMIC EVIDENCE (source-attributed; verify claims before treating as settled):\n${researchContext}\n` : ''}

DISCIPLINE ENGINE
${disciplineDirectives[domainBrief.pedagogyType]}

UNIVERSAL MASTERY FRAMEWORK
Organise learning around Understand → Explore → Apply → Verify → Master. This is a learning sequence, not ten compulsory long chapters. Keep every component proportionate to the topic.

For the Markdown 'content' field, include at least three meaningful level-2 headings and at least 800 characters of substantive academic prose. Headings should reflect the discipline and topic, not generic filler.

Return BOTH readable Markdown in "content" and structured data in "instructionalContent".

STRUCTURED CONTENT RULES
- frameworkVersion must be "understand-explore-apply-verify-master-v1"; disciplineEngine must be "${domainBrief.pedagogyType}".
- learningObjectives: 2-5 measurable capabilities aligned to approved outcomes.
- prerequisites: genuine prerequisites with reason and readiness check; [] if none.
- conceptIntroduction: intuition before technical detail.
- deepExplanation: mechanisms, assumptions, relationships and boundaries.
- formalDevelopment: relevant derivation, proof, argument, causal mechanism, research method or analytical framework.
- workedExamples: ${normalizedDepth === 'deep-dive' ? 'at least three' : normalizedDepth === 'standard' ? 'at least two' : 'at least one'} distinct discipline-appropriate examples with problem, ordered reasoning, solution and a genuine reasonableness/logic check.
- applications and misconceptions: include only defensible items; otherwise return [] and explain why in applicationRationale or misconceptionRationale.
- guidedPractice: at least one exercise with progressive hints, approach, answer and explanation.
- independentPractice: at least one new no-hint exercise with answer/explanation for later reveal.
- knowledgeChecks: ${normalizedDepth === 'deep-dive' ? 'at least four' : normalizedDepth === 'standard' ? 'at least three' : 'at least two'} reasoning checks, not recall alone.
- mastery.targetLevel: appropriate target 1-5 for this lesson; it is not evidence that any student has achieved that level.
- mastery.criteria: observable evidence required before advancement.
- mastery.retentionPrompts: later active-retrieval prompts.

ACADEMIC INTEGRITY
Do not invent syllabus topics, facts, laws, equations, numerical data, case studies, source references or verification claims. State assumptions and limits. Ensure examples, units, derivations and explanations are internally consistent. Qualify insufficiently grounded information. Use balanced LaTeX delimiters.

STRICT JSON
Return one valid JSON object only with top-level keys "title", "pedagogicalReasoning", "content", "instructionalContent".
instructionalContent must follow this shape:
{
 "frameworkVersion":"understand-explore-apply-verify-master-v1",
 "disciplineEngine":"${domainBrief.pedagogyType}",
 "learningObjectives":["..."],
 "prerequisites":[{"concept":"...","whyNeeded":"...","readinessCheck":"..."}],
 "conceptIntroduction":"...",
 "deepExplanation":"...",
 "formalDevelopment":"...",
 "workedExamples":[{"title":"...","exampleType":"numerical","problem":"...","reasoningSteps":["...","..."],"solution":"...","verification":"..."}],
 "applications":[{"context":"...","conceptConnection":"...","constraintsOrAssumptions":"..."}],
 "applicationRationale":"...",
 "misconceptions":[{"misconception":"...","whyItIsWrong":"...","correction":"..."}],
 "misconceptionRationale":"...",
 "guidedPractice":[{"prompt":"...","hints":["..."],"expectedApproach":"...","expectedAnswer":"...","explanation":"...","diagnosticSignals":["..."]}],
 "independentPractice":[{"prompt":"...","hints":[],"expectedApproach":"...","expectedAnswer":"...","explanation":"...","diagnosticSignals":["..."]}],
 "knowledgeChecks":[{"prompt":"...","responseMode":"explain","expectedReasoning":"...","answerOrRubric":"...","misconceptionSignals":["..."],"difficulty":2,"learningOutcome":"..."}],
 "mastery":{"targetLevel":3,"criteria":["..."],"retentionPrompts":["..."]}
}
These are schema illustrations, not course facts. Return strict JSON without fences or commentary.`;
}

/** Select complete relevant source blocks rather than an arbitrary document prefix. */
function selectRelevantLessonSource(sourceText: string, topicTitle: string, moduleTitle: string, maxChars = 10000): string {
  if (!sourceText.trim()) return '';
  const stopWords = new Set(['the','and','for','with','from','into','that','this','are','was','were','their','there','about','through','using','course','lesson','module','introduction','fundamentals','principles']);
  const terms = [...new Set((topicTitle + ' ' + moduleTitle).toLowerCase().match(/[a-z0-9]{3,}/g) || [])].filter(term => !stopWords.has(term));
  const blocks = sourceText.split(/\n\s*\n|(?<=\.)\s+(?=[A-Z0-9])/).map((text, index) => ({ text: text.trim(), index })).filter(block => block.text.length > 0);
  if (terms.length === 0 || blocks.length === 0) return '';
  const ranked = blocks.map(block => ({ ...block, hits: terms.filter(term => block.text.toLowerCase().includes(term)).length })).filter(block => block.hits > 0).sort((a, b) => b.hits - a.hits || a.index - b.index);
  const selected: typeof ranked = []; let usedChars = 0;
  for (const block of ranked) { const cost = block.text.length + 2; if (usedChars + cost > maxChars) continue; selected.push(block); usedChars += cost; }
  selected.sort((a, b) => a.index - b.index);
  if (selected.length === 0) return 'No source paragraph matched the lesson and module terminology. Do not attribute specific claims to the uploaded source without direct support.';
  return selected.map((block, index) => '[Matched source excerpt ' + (index + 1) + ']\n' + block.text).join('\n\n');
}

/** Builds a module assessment prompt using persisted lesson content as its evidence base. */
export function buildModuleQuizPrompt(options: {
  courseName: string;
  courseCode?: string;
  moduleTitle: string;
  moduleOrder: number;
  level: string;
  department: string;
  academicStandard?: string;
  quizTopics: string[];
  lessons: Array<{ title: string; content: string }>;
}): string {
  const { courseName, courseCode, moduleTitle, moduleOrder, level, department, academicStandard, quizTopics, lessons } = options;
  const approvedQuizTopics = Array.isArray(quizTopics)
    ? [...new Set(quizTopics.map(topic => String(topic).trim()).filter(Boolean))]
    : [];
  if (approvedQuizTopics.length === 0) {
    throw new Error('Module ' + moduleTitle + ' has no approved quiz topics; quiz generation cannot infer them.');
  }
  if (approvedQuizTopics.length > 20) {
    throw new Error('Module ' + moduleTitle + ' has ' + approvedQuizTopics.length +
      ' quiz topics. Split the module into smaller assessable modules; one module quiz supports at most 20 approved topics.');
  }
  if (!Array.isArray(lessons) || lessons.length === 0 || lessons.some(lesson => typeof lesson.content !== 'string' || !lesson.content.trim())) {
    throw new Error('Module ' + moduleTitle + ' has no complete generated lesson material to ground its quiz.');
  }
  const lessonEvidence = lessons.map((lesson, index) => 'LESSON ' + (index + 1) + ': ' + lesson.title + '\n' + lesson.content).join('\n\n');
  if (lessonEvidence.length > 50000) {
    throw new Error('Module ' + moduleTitle + ' lesson material exceeds the 50,000-character quiz evidence limit. No lesson content was truncated.');
  }
  return [
    'Create a source-grounded university module quiz for ' + courseName + ' ' + (courseCode || ''),
    'MODULE ' + moduleOrder + ': ' + moduleTitle,
    'ACADEMIC LEVEL: ' + level,
    'DEPARTMENT: ' + department,
    'ACADEMIC STANDARD: ' + (academicStandard && academicStandard.trim() ? academicStandard.trim() : 'not supplied; do not infer an accreditation standard'),
    '',
    'APPROVED QUIZ TOPICS (every topic must be assessed):',
    ...approvedQuizTopics.map((topic, index) => (index + 1) + '. ' + topic),
    '',
    'COMPLETE GENERATED LESSON MATERIAL — THE ONLY AUTHORIZED QUESTION EVIDENCE:',
    lessonEvidence,
    '',
    'ASSESSMENT REQUIREMENTS',
    '- Generate between ' + Math.max(8, approvedQuizTopics.length) + ' and 20 distinct multiple-choice questions.',
    '- Every question must be answerable from the supplied generated lessons; do not introduce unsupported facts, formulas, cases, values, or source claims.',
    '- Cover every approved quiz topic at least once. Set quizTopic to the exact approved topic text. Order questions by approved topic order and cover every topic once before assigning a second question to any topic.',
    '- Calibrate to ' + level + '; assess conceptual understanding, application and analysis, not rote recall alone.',
    '- Use exactly four distinct options per question and exactly one defensible correct option.',
    '- correctOptionIndex is zero-based and must point to the correct option.',
    '- Explain why the keyed answer is supported by the lesson material; do not claim independent academic verification.',
    '- Provide a progressive hint that helps without directly giving away the answer.',
    '- Assign difficulty 1-5 and Bloom level from Remember, Understand, Apply, Analyze, Evaluate, Create.',
    '- Give each question a unique id and set sourceReference to the exact title of a supplied lesson.',
    '- If a topic cannot be fairly assessed from the supplied lessons, explain the limitation in pedagogicalReasoning; never invent missing evidence.',
    '',
    'Return one valid JSON object only:',
    '{',
    '  "pedagogicalReasoning": "Explain how the questions cover the approved topics and generated lesson material, including any unsupported gaps.",',
    '  "questions": [',
    '    {',
    '      "id": "q1",',
    '      "quizTopic": "Exact approved topic",',
    '      "question": "Question grounded in a supplied lesson",',
    '      "options": ["Option A", "Option B", "Option C", "Option D"],',
    '      "correctOptionIndex": 0,',
    '      "explanation": "Evidence-based explanation grounded in the supplied lesson",',
    '      "hint": "Progressive hint that does not reveal the answer",',
    '      "difficulty": 2,',
    '      "bloomLevel": "Understand",',
    '      "sourceReference": "Exact supplied lesson title"',
    '    }',
    '  ]',
    '}'
  ].join('\n');
}
