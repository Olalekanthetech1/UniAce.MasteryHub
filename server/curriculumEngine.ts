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
  const { courseName, courseCode, department, level, outline, sourceText } = options;
  if (typeof level !== 'string' || !level.trim()) {
    throw new Error('An explicit academic level is required; curriculum generation will not assume 100 Level.');
  }
  const normalizedLevel = level.trim();
  const departmentContext = typeof department === 'string' && department.trim()
    ? department.trim()
    : 'not supplied; do not infer a department';
  return `Analyze the course title "${courseName}" ${courseCode ? `(Code: ${courseCode})` : ''} at Academic Level "${normalizedLevel} Level" within the department "${departmentContext}".
${outline && outline.trim() ? `\n[ADMIN-PROVIDED SYLLABUS OUTLINE (MANDATORY PRIMARY AUTHORITY)]:\n${outline.trim()}\n` : ''}
${sourceText && sourceText.trim() ? `\n[SOURCE REFERENCE MATERIAL]:\n${sourceText.substring(0, 2000)}\n` : ''}

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
6. Identify 2-3 canonical reference textbooks or standard university syllabus benchmarks appropriate for ${normalizedLevel} Level.
7. Formulate 3-4 foundational axioms/principles that establish the core framework for orientation in Module 1.

Return strictly a JSON object:
{
  "primaryDomain": "Authoritative academic discipline",
  "subDisciplines": ["Sub-discipline 1", "Sub-discipline 2", "Sub-discipline 3"],
  "pedagogyType": "STEM_MATHEMATICAL",
  "courseLevelFramework": "${normalizedLevel} Level University Curriculum Standard",
  "canonicalCourseReferences": ["Only references explicitly present in the supplied source material; return an empty array when none are supplied"],
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
${sourceText ? `Source Reference: ${sourceText.substring(0, 3000)}` : ''}

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
  const { courseName, courseCode, level, outline } = options;
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
PROPOSED SYLLABUS OUTLINE (${proposedSkeleton.modules?.length || 0} Modules):
${moduleSummary}

[AUDIT RUBRIC AXES]:
1. COVERAGE SCORE (0-100): Are all expected core topics of ${domainBrief.primaryDomain} AND 100% of the topics in the Admin-Provided Syllabus Outline (if provided) represented in the proposed syllabus? Any topic from the Admin Outline that is missing MUST be listed in "missingTopics" and reduce "coverageScore".
2. FOUNDATIONS ORIENTATION SCORE (0-100): Does Module 1 properly establish the history, scope, taxonomy, and core conceptual framework of the discipline for ${normalizedLevel} Level students?
3. PREREQUISITE & LEVEL SEQUENCING SCORE (0-100): Is the pedagogical progression logical for ${normalizedLevel} Level? Do foundational concepts precede advanced applications without inappropriate level jumps?
4. WORKLOAD BALANCE & DENSITY (0-100): Does the module count (${proposedSkeleton.modules?.length || 0}) and lesson count provide legitimate ${normalizedLevel} Level university depth without superficial rushing or bloated repetition?

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
    scope, academicStandard, sourceText } = options;
  if (typeof level !== 'string' || !level.trim()) {
    throw new Error('An explicit academic level is required for lesson generation.');
  }
  const audience = Array.from(new Set([
    ...(Array.isArray(options.selectedDepartments) ? options.selectedDepartments : []),
    ...(options.department ? [options.department] : []),
    ...(Array.isArray(options.selectedFaculties) ? options.selectedFaculties : [])
  ].map(v => String(v).trim()).filter(Boolean))).join(', ') ||
    (typeof department === 'string' && department.trim() ? department.trim() : 'Department not supplied; do not infer');

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
Scope: ${typeof scope === 'string' && scope.trim() ? scope.trim() : 'not supplied; do not infer an audience scope'}
Target learning outcome: ${learningOutcomeText || 'Derive measurable objectives only from approved course outcomes and this topic.'}
${sourceText ? `ADMIN-SUPPLIED SOURCE MATERIAL (primary grounding):\n${sourceText.substring(0, 3500)}` : 'No additional source material was supplied. Do not fabricate quotations, citations, page numbers, textbooks or empirical findings.'}

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
- workedExamples: at least one discipline-appropriate example with problem, ordered reasoning, solution and a genuine reasonableness/logic check.
- applications and misconceptions: include only defensible items; otherwise return [] and explain why in applicationRationale or misconceptionRationale.
- guidedPractice: at least one exercise with progressive hints, approach, answer and explanation.
- independentPractice: at least one new no-hint exercise with answer/explanation for later reveal.
- knowledgeChecks: at least two reasoning checks, not recall alone.
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
