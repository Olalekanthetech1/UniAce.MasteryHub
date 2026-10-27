import { 
  DomainBrief, 
  DisciplinePedagogyType, 
  CourseSkeleton, 
  OutlineCriticRubric, 
  deriveCurriculumParameters 
} from '../src/shared/courseSchemas.js';
import { LATEX_INSTRUCTION } from '../src/shared/prompts.js';

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
 * Lesson syntax and structural validator.
 * Enforces balanced KaTeX delimiters, valid markdown table structure, and substantive content.
 * Rejects faulty content with actionable diagnostic errors instead of silent patching.
 */
export function validateLessonSyntax(content: string, pedagogyType: DisciplinePedagogyType = 'STEM_MATHEMATICAL'): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!content || typeof content !== 'string') {
    return { isValid: false, errors: ['Lesson content is empty or null.'] };
  }

  const trimmed = content.trim();
  if (trimmed.length < 200) {
    errors.push(`Lesson content is too brief (${trimmed.length} chars). Expected substantive university lesson.`);
  }

  // 1. KaTeX Math Delimiter Balance Check
  // Count $$ occurrences (display math)
  const displayMathMatches = trimmed.match(/\$\$/g) || [];
  if (displayMathMatches.length % 2 !== 0) {
    errors.push(`Unbalanced display math delimiters ($$). Found ${displayMathMatches.length} occurrences (must be an even number).`);
  }

  // Strip $$...$$ blocks first to check inline $...$
  const withoutDisplayMath = trimmed.replace(/\$\$[\s\S]*?\$\$/g, '');
  
  // Find single $ that are math delimiters (ignore escaped \$ and standard currency if not matching)
  // Simple check: count unescaped single $
  const unescapedSingleDollars = (withoutDisplayMath.match(/(?<!\\)\$/g) || []).length;
  if (unescapedSingleDollars % 2 !== 0) {
    errors.push(`Unbalanced inline math delimiters ($). Found ${unescapedSingleDollars} unescaped dollar signs.`);
  }

  // Check for unclosed \begin{env} ... \end{env}
  const beginMatches = trimmed.match(/\\begin\{([a-zA-Z*]+)\}/g) || [];
  const endMatches = trimmed.match(/\\end\{([a-zA-Z*]+)\}/g) || [];
  if (beginMatches.length !== endMatches.length) {
    errors.push(`Mismatched LaTeX environment tags: found ${beginMatches.length} \\begin{} vs ${endMatches.length} \\end{}.`);
  }

  // 2. Markdown Table Check (Math-Aware)
  const lines = trimmed.split('\n');
  let inTable = false;
  let tableHeaderCols = 0;
  let tableRowIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (rawLine.startsWith('|') && rawLine.endsWith('|')) {
      // Mask math blocks ($...$ and $$...$$) and escaped pipes (\|) to prevent absolute value bars (|x|) from corrupting table column counts
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
        // If it's the second row, check if it's the delimiter row (e.g., |---|---|)
        if (tableRowIndex === 1 && maskedLine.includes('---')) {
          // Valid separator
        } else if (cols.length !== tableHeaderCols && cols.length > 0) {
          // Check if column mismatch is severe
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

  // 3. Diagram & Visualization Integrity Check
  // Mermaid quadrantChart must never be used for Cartesian coordinate geometry or continuous math curves
  const mermaidBlocks = trimmed.match(/```mermaid[\s\S]*?```/gi) || [];
  for (const block of mermaidBlocks) {
    if (/quadrantChart/i.test(block) && /(origin|circle|tangent|radius|slope|x\^2|y\^2|coordinate|axis)/i.test(block)) {
      errors.push('Invalid mathematical visualization: Mermaid quadrantChart was used for Cartesian geometry/curves. Use ```function-plot or ```svg instead.');
      break;
    }
  }

  // 4. Domain-Specific Pedagogical Expectation Check
  if (pedagogyType === 'STEM_MATHEMATICAL') {
    // Expect at least some mathematical notation or quantitative concepts
    const hasMath = trimmed.includes('$') || trimmed.includes('\\') || /\b(equation|formula|theorem|parameter|derivative|matrix|vector|integral|ratio|constant)\b/i.test(trimmed);
    if (!hasMath && trimmed.length > 500) {
      // Soft note, not a hard rejection unless strictly math course
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Stage 0: Grounding Prompt
 * Retrieves course-level references (textbook TOCs, university syllabi) and classifies pedagogy type.
 */
export function buildDomainBriefPrompt(options: CurriculumGenerationOptions): string {
  const { courseName, courseCode, department } = options;
  return `Analyze the course title "${courseName}" ${courseCode ? `(Code: ${courseCode})` : ''} within the department "${department || 'General Studies'}".

[GROUNDING & COURSE-LEVEL TAXONOMY TASK]:
1. Identify the primary authoritative academic discipline.
2. Determine the Pedagogy Type based on the nature of the discipline:
   - "STEM_MATHEMATICAL": Physical sciences, engineering, mathematics, computer science (emphasizes formal derivations, quantitative models, KaTeX equations, physical laws).
   - "HUMANITIES_LAW_ARTS": History, philosophy, literature, law, languages (emphasizes primary source analysis, textual critique, legal precedence, ethical discourse).
   - "SOCIAL_SCIENCES_BUSINESS": Economics, finance, management, sociology, psychology (emphasizes empirical methodology, behavioral/market case studies, statistical interpretation).
   - "BIOMEDICAL_LIFE_SCIENCES": Biology, medicine, pharmacology, biochemistry (emphasizes biochemical pathways, physiological mechanisms, clinical implications).
   - "GENERAL_FOUNDATIONS": Interdisciplinary survey or academic study skills.
3. List 3-5 sub-disciplines.
4. List 8-14 core course topics that define the standard syllabus of this specific course in accredited universities (e.g. standard undergraduate curriculum). Anchor in course-level textbook tables of contents and published university syllabi.
5. Identify 2-3 canonical reference textbooks or standard university syllabus benchmarks (e.g., "Callister - Materials Science and Engineering: An Introduction", "MIT OpenCourseWare 3.091").
6. Formulate 3-4 foundational axioms/principles that establish the core framework for orientation in Module 1.

Return strictly a JSON object:
{
  "primaryDomain": "e.g. Materials Science and Engineering",
  "subDisciplines": ["Structure of Materials", "Thermodynamics of Solids", "Mechanical Properties", "Phase Transformations"],
  "pedagogyType": "STEM_MATHEMATICAL",
  "courseLevelFramework": "Undergraduate University Level Core",
  "recommendedCreditHours": 3,
  "targetModuleCountRange": { "min": 6, "max": 10 },
  "canonicalCourseReferences": ["Callister & Rethwisch - Materials Science and Engineering: An Introduction", "MIT OCW 3.091 Course Syllabus"],
  "foundationalAxioms": [
    "The central Materials Science Paradigm: Processing -> Structure -> Properties -> Performance",
    "Classification taxonomy of engineering materials: Metals, Ceramics, Polymers, and Composites",
    "Historical evolution and technological role of materials in societal development"
  ],
  "coreCourseTopics": [
    "Introduction to Materials Classification and the Materials Paradigm",
    "Atomic Structure and Chemical Bonding in Solids",
    "Crystal Structures and Crystallographic Planes/Directions",
    "Imperfections, Point Defects, and Dislocations in Solids",
    "Diffusion Mechanisms and Fick's Laws",
    "Mechanical Properties, Stress-Strain Relations, and Elastic/Plastic Deformation",
    "Dislocations and Strengthening Mechanisms in Metals",
    "Phase Equilibria, Binary Phase Diagrams, and the Iron-Carbon System",
    "Phase Transformations and Microstructural Evolution",
    "Corrosion, Degradation, and Failure Analysis"
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
    scope = 'DEPARTMENT',
    selectedFaculties = [],
    selectedDepartments = [],
    outline,
    sourceText,
    academicStandard = 'Globally Adaptive (Universal University Standard)'
  } = options;

  const params = deriveCurriculumParameters(level, semester, creditUnits || domainBrief.recommendedCreditHours, depth);
  const normalizedScope = scope.toUpperCase();

  let audienceDirective = '';
  if (normalizedScope === 'GLOBAL' || normalizedScope === 'PUBLIC' || normalizedScope === 'ALL') {
    audienceDirective = `AUDIENCE: MULTIDISCIPLINARY COHORT.
- Pedagogical Directive: Teach the core discipline of "${domainBrief.primaryDomain}" with clear conceptual scaffolding, intuitive analogies, and accessible real-world examples before introducing complex formal models.`;
  } else if (normalizedScope === 'FACULTY') {
    const facs = selectedFaculties.length > 0 ? selectedFaculties.join(', ') : 'Faculty Students';
    audienceDirective = `AUDIENCE: FACULTY-WIDE (${facs}).
- Pedagogical Directive: Anchor concepts and case studies in interdisciplinary technical applications relevant across ${facs}, emphasizing practical problem-solving in ${domainBrief.primaryDomain}.`;
  } else {
    const depts = selectedDepartments.length > 0 ? selectedDepartments.join(', ') : domainBrief.primaryDomain;
    audienceDirective = `AUDIENCE: DEPARTMENTAL SPECIALISTS (${depts}).
- Pedagogical Directive: Teach "${domainBrief.primaryDomain}" with full theoretical rigor, discipline-standard formulations, formal proofs, and specialized professional case studies.`;
  }

  return `You are an expert university curriculum committee chair in ${domainBrief.primaryDomain}.
Design a complete, comprehensive university syllabus skeleton for "${courseName}" ${courseCode ? `(${courseCode})` : ''}.

AUTHORITATIVE DOMAIN: ${domainBrief.primaryDomain}
PEDAGOGY TYPE: ${domainBrief.pedagogyType}
GROUNDING REFERENCES: ${domainBrief.canonicalCourseReferences.join('; ')}
REQUIRED CORE TOPICS: ${domainBrief.coreCourseTopics.join(', ')}

${audienceDirective}

[CRITICAL CURRICULUM ARCHITECTURE RULES]:
1. DYNAMIC MODULE COUNT: Generate between ${params.minModules} and ${params.maxModules} full academic modules to provide genuine university-level depth for a ${params.credits}-credit course.
2. DOMAIN-AGNOSTIC MODULE 1 ORIENTATION RULE:
   - Module 1 MUST establish the history, scope, foundational taxonomy, and core theoretical framework of the discipline.
   - It serves as the foundational orientation for students before progressing into specialized microstructural or advanced thematic units.
   - Ground Module 1 in the domain's foundational axioms: ${domainBrief.foundationalAxioms.join('; ')}.
3. PROGRESSIVE TAXONOMY & PREREQUISITES:
   - Organize modules so foundational mechanisms and prerequisite concepts precede complex applications, derivations, and specialized topics.
4. BLOOM'S TAXONOMY LEARNING OUTCOMES:
   - Formulate 5-8 measurable "learningOutcomes" covering Bloom's taxonomy (Remember, Understand, Apply, Analyze, Evaluate, Create).
   - Map each module to the relevant learning outcome indices.
5. LESSONS PER MODULE:
   - Provide 3 to 5 distinct, well-titled lessons per module covering the required core topics without superficial skipping.

${feedbackCritique ? `\n[AUDIT FEEDBACK FROM PREVIOUS REVIEW TO REMEDY]:\n${feedbackCritique}\n` : ''}

Level: ${level || 'Undergraduate'}
Tone: ${tone}
Depth: ${depth}
Academic Standard: ${academicStandard}
${outline ? `Additional Outlines: ${outline}` : ''}
${sourceText ? `Source Reference: ${sourceText.substring(0, 3000)}` : ''}

Return strictly a JSON object:
{
  "pedagogicalReasoning": "Curriculum architecture rationale grounded in ${domainBrief.canonicalCourseReferences.join(' and ')}",
  "description": "Comprehensive course overview rooted in ${domainBrief.primaryDomain}",
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
  const { courseName } = options;
  const moduleSummary = (proposedSkeleton.modules || []).map((m, idx) => 
    `Module ${idx + 1}: "${m.title}" -> Lessons: ${(m.lessonTitles || m.topics || []).join(', ')}`
  ).join('\n');

  return `You are a strict University Academic Accreditation Auditor & Subject Matter Critic.
Evaluate the proposed syllabus for "${courseName}" against the authoritative discipline "${domainBrief.primaryDomain}".

EXPECTED CANONICAL TOPICS (From Benchmark Syllabi):
${domainBrief.coreCourseTopics.join('\n- ')}

PROPOSED SYLLABUS OUTLINE (${proposedSkeleton.modules?.length || 0} Modules):
${moduleSummary}

[AUDIT RUBRIC AXES]:
1. COVERAGE SCORE (0-100): Are the expected core topics of ${domainBrief.primaryDomain} adequately represented in the syllabus?
2. FOUNDATIONS ORIENTATION SCORE (0-100): Does Module 1 properly establish the history, scope, taxonomy, and core conceptual framework of the discipline?
3. PREREQUISITE & SEQUENCING SCORE (0-100): Is the pedagogical progression logical? Do foundational concepts precede advanced applications?
4. WORKLOAD BALANCE & DENSITY (0-100): Does the module count (${proposedSkeleton.modules?.length || 0}) and lesson count provide legitimate university depth without superficial rushing or bloated repetition?

Return strictly a JSON object:
{
  "isValid": true/false,
  "coverageScore": 90,
  "foundationsScore": 95,
  "workloadBalanceScore": 90,
  "sequencingScore": 95,
  "consistencyScore": 95,
  "confidenceState": "verified",
  "coveredTopics": ["List of core topics covered in the modules"],
  "missingTopics": ["Core topics omitted, if any"],
  "sequencingErrors": ["Any prerequisite violations, if any"],
  "genericFillerDetected": false,
  "reasoning": "Summary evaluation explaining the scores and verdict"
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
  const {
    courseName,
    department,
    level = 'Undergraduate',
    tone = 'academic',
    depth = 'standard',
    scope = 'DEPARTMENT',
    academicStandard = 'Globally Adaptive (Universal University Standard)',
    sourceText
  } = options;

  let pedagogyDirective = '';
  switch (domainBrief.pedagogyType) {
    case 'STEM_MATHEMATICAL':
      pedagogyDirective = `DISCIPLINE STYLE: STEM / MATHEMATICAL & ENGINEERING
- Formulate mathematical derivations, physical laws, and quantitative governing equations where applicable.
- Enforce strict LaTeX formatting for equations: inline math in $...$ and display math in $$...$$.
- Include clear comparison tables (e.g. properties, crystal systems, phases, or algorithmic bounds).
- Include an authentic, sourced empirical engineering case study or experimental application.`;
      break;
    case 'HUMANITIES_LAW_ARTS':
      pedagogyDirective = `DISCIPLINE STYLE: HUMANITIES / LAW & LIBERAL ARTS
- Emphasize primary source textual analysis, historical historiography, rhetorical critique, and legal/ethical frameworks.
- Include structured comparative critique tables (e.g. philosophical doctrines, statutory interpretations, or artistic periods).
- Include an authentic historical or legal case study with sourced context.`;
      break;
    case 'SOCIAL_SCIENCES_BUSINESS':
      pedagogyDirective = `DISCIPLINE STYLE: SOCIAL SCIENCES & BUSINESS / ECONOMICS
- Emphasize empirical research methodologies, statistical tables, market/behavioral case studies, and macroeconomic models.
- Include data comparison tables and methodological frameworks.
- Include an authentic corporate, policy, or behavioral case study.`;
      break;
    case 'BIOMEDICAL_LIFE_SCIENCES':
      pedagogyDirective = `DISCIPLINE STYLE: BIOMEDICAL & LIFE SCIENCES
- Emphasize physiological mechanisms, biochemical pathways, clinical significance, and taxonomic classifications.
- Include comparison tables of cellular structures, metabolic pathways, or pharmacological agents.
- Include an authentic clinical case study or experimental study.`;
      break;
    default:
      pedagogyDirective = `DISCIPLINE STYLE: GENERAL ACADEMIC FOUNDATIONS
- Emphasize clear conceptual taxonomy, analytical frameworks, and structured real-world applications.
- Include comparison tables and practical case studies.`;
  }

  const audienceList = [
    ...(Array.isArray(options.selectedDepartments) ? options.selectedDepartments : []),
    ...(options.department ? [options.department] : []),
    ...(Array.isArray(options.selectedFaculties) ? options.selectedFaculties : [])
  ].map(s => String(s).trim()).filter(Boolean);

  const uniqueAudience = Array.from(new Set(audienceList));
  const audienceText = uniqueAudience.length > 0 ? uniqueAudience.join(', ') : (department || domainBrief.primaryDomain);
  const isMultiAudience = uniqueAudience.length > 1;

  return `Write a comprehensive, rigorous, university-level study guide and lesson for the topic: "${topicTitle}"
within Module ${moduleOrder}: "${moduleTitle}" of the course "${courseName}".

AUTHORITATIVE DOMAIN: ${domainBrief.primaryDomain}
TARGET ENROLLED AUDIENCE: ${audienceText}
${isMultiAudience ? `AUDIENCE DIRECTIVE: This course serves a multi-department cohort (${audienceText}). Frame the foundational significance and applied case studies across these disciplines without narrowing the context exclusively to a single department.` : ''}
LEVEL: ${level}
TONE: ${tone}
DEPTH: ${depth}
ACADEMIC STANDARD: ${academicStandard}
${learningOutcomeText ? `TARGET LEARNING OUTCOME: ${learningOutcomeText}` : ''}
${sourceText ? `SOURCE REFERENCE: ${sourceText.substring(0, 1500)}` : ''}

${pedagogyDirective}

[PEDAGOGICAL REQUIREMENTS]:
1. Executive Summary: Core thesis and why this topic matters within ${domainBrief.primaryDomain}.
2. Theoretical Foundations: Systematic breakdown of mechanisms, principles, definitions, and formal theories.
3. Detailed Breakdown: Step-by-step analysis with clear subheadings, structured bullet points, and markdown tables.
4. Real-World Case Study: An authentic, fully grounded empirical application native to ${domainBrief.primaryDomain}.
5. Key Takeaways & Practice Discussion Prompt: Dynamic summary questions for student reflection.

[STRICT JSON OUTPUT FORMAT]:
- Place the ENTIRE lesson (all sections above) inside the single "content" markdown field. Do NOT output separate keys for sections.
- When emphasizing words or symbols inside the text, use single quotes (e.g. 'voltage', 'current') or backticks, never raw double quotes.

Return strictly a JSON object:
{
  "pedagogicalReasoning": "How this lesson satisfies university learning outcomes in ${domainBrief.primaryDomain}",
  "title": "${topicTitle}",
  "content": "Full detailed markdown lesson text compiling all sections above. Follow all formatting rules."
}`;
}
