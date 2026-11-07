import React, { useEffect, useRef, useState, useMemo, useId } from 'react';
import mermaid from 'mermaid';
import katex from 'katex';
import DOMPurify from 'dompurify';
import {
  Copy,
  Check,
  Download,
  AlertTriangle,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Compass,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import FunctionPlotViewer from './FunctionPlotViewer';
import { LogService } from '../../services/logService';
import {
  detectMermaidDiagramType,
  validateAndRecoverMermaidDiagram,
  type ConstrainedAiRepairFn
} from '../../services/mermaidRepairService';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  htmlLabels: true,
  flowchart: {
    htmlLabels: true,
    wrappingWidth: 380,
    nodeSpacing: 48,
    rankSpacing: 52,
    curve: 'basis',
    padding: 16,
    useMaxWidth: true
  },
  suppressErrorRendering: true,
  themeVariables: {
    fontSize: '14px',
    primaryColor: '#eef2ff',
    primaryTextColor: '#0f172a',
    primaryBorderColor: '#6366f1',
    lineColor: '#475569',
    secondaryColor: '#f8fafc',
    tertiaryColor: '#ffffff',
    nodeTextColor: '#0f172a',
    mainBkg: '#eef2ff',
    nodeBorder: '#6366f1'
  }
});

const UNICODE_TO_LATEX_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/α/g, '\\alpha '],
  [/β/g, '\\beta '],
  [/γ/g, '\\gamma '],
  [/δ/g, '\\delta '],
  [/ε/g, '\\varepsilon '],
  [/ζ/g, '\\zeta '],
  [/η/g, '\\eta '],
  [/θ/g, '\\theta '],
  [/κ/g, '\\kappa '],
  [/λ/g, '\\lambda '],
  [/μ/g, '\\mu '],
  [/ν/g, '\\nu '],
  [/ξ/g, '\\xi '],
  [/π/g, '\\pi '],
  [/ρ/g, '\\rho '],
  [/σ/g, '\\sigma '],
  [/τ/g, '\\tau '],
  [/υ/g, '\\upsilon '],
  [/φ/g, '\\phi '],
  [/χ/g, '\\chi '],
  [/ψ/g, '\\psi '],
  [/ω/g, '\\omega '],
  [/Γ/g, '\\Gamma '],
  [/Δ/g, '\\Delta '],
  [/Θ/g, '\\Theta '],
  [/Λ/g, '\\Lambda '],
  [/Ξ/g, '\\Xi '],
  [/Π/g, '\\Pi '],
  [/Σ/g, '\\Sigma '],
  [/Φ/g, '\\Phi '],
  [/Ψ/g, '\\Psi '],
  [/Ω/g, '\\Omega '],
  [/∂/g, '\\partial '],
  [/∇/g, '\\nabla '],
  [/∞/g, '\\infty '],
  [/±/g, '\\pm '],
  [/∓/g, '\\mp '],
  [/×/g, '\\times '],
  [/÷/g, '\\div '],
  [/·/g, '\\cdot '],
  [/≈/g, '\\approx '],
  [/≠/g, '\\neq '],
  [/≡/g, '\\equiv '],
  [/≤/g, '\\leq '],
  [/≥/g, '\\geq '],
  [/∈/g, '\\in '],
  [/∉/g, '\\notin '],
  [/⊂/g, '\\subset '],
  [/⊆/g, '\\subseteq '],
  [/∪/g, '\\cup '],
  [/∩/g, '\\cap '],
  [/∀/g, '\\forall '],
  [/∃/g, '\\exists '],
  [/→/g, '\\to '],
  [/←/g, '\\leftarrow '],
  [/⇒/g, '\\implies '],
  [/⇔/g, '\\iff '],
  [/∫/g, '\\int '],
  [/∑/g, '\\sum '],
  [/∏/g, '\\prod '],
  [/∝/g, '\\propto '],
  [/½/g, '\\frac{1}{2}'],
  [/⅓/g, '\\frac{1}{3}'],
  [/⅔/g, '\\frac{2}{3}'],
  [/¼/g, '\\frac{1}{4}'],
  [/¾/g, '\\frac{3}{4}']
];

const UNICODE_SUP_MAP: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')',
  'ⁿ': 'n', 'ⁱ': 'i'
};

const UNICODE_SUB_MAP: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
  'ₐ': 'a', 'ₑ': 'e', 'ᵢ': 'i', 'ⱼ': 'j', 'ₖ': 'k',
  'ₘ': 'm', 'ₙ': 'n', 'ₒ': 'o', 'ₚ': 'p', 'ᵣ': 'r',
  'ₛ': 's', 'ₜ': 't', 'ᵤ': 'u', 'ᵥ': 'v', 'ₓ': 'x'
};

const RESERVED_MATH_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'ln', 'log', 'exp', 'det', 'lim', 'max', 'min',
  'mod', 'gcd', 'lcm', 'sup', 'inf', 'arg', 'deg', 'dim', 'ker', 'rank'
]);

/**
 * Replaces balanced parenthesized or braced radical calls (such as `sqrt((x2 - x1)^2 + (y2 - y1)^2)`
 * or `√(Ax² + Ay² + Az²)`) with `\sqrt{...}` at arbitrary nesting depth.
 */
function replaceSqrtCallsWithLatex(input: string): string {
  let result = input;
  const headRegex = /(?:\\sqrt\b|\bsqrt|√)\s*\(/gi;
  let guard = 0;
  while (guard++ < 25) {
    headRegex.lastIndex = 0;
    const match = headRegex.exec(result);
    if (!match) break;
    const startIdx = match.index;
    const openIdx = startIdx + match[0].length - 1;
    if (result[openIdx] !== '(') break;
    let depth = 1;
    let cursor = openIdx + 1;
    while (cursor < result.length && depth > 0) {
      if (result[cursor] === '(') depth += 1;
      else if (result[cursor] === ')') depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) break;
    const inner = result.slice(openIdx + 1, cursor - 1).trim();
    result = `${result.slice(0, startIdx)}\\sqrt{${inner}}${result.slice(cursor)}`;
  }
  result = result.replace(/√([A-Za-z0-9_^{}]+)/g, '\\sqrt{$1}');
  return result;
}

function convertDiagramFormulaToLatex(rawExpr: string, isVectorContext = false): string {
  let expr = rawExpr.trim();

  // 1. Convert shorthand coordinate/index variables (e.g. Ax, Ay, Az, Fx, vx, x1, y2) inside math formulas
  expr = expr.replace(/\b([A-Za-z])([xyz])(?=(?:[²³⁴0-9_\s+\-*/^=),]|$))/g, (full, base: string, axis: string) => {
    const tokenLower = `${base}${axis}`.toLowerCase();
    if (tokenLower === 'by' || tokenLower === 'my' || tokenLower === 'ox' || tokenLower === 'ex') {
      // Only treat 'by'/'ex' as subscripted if uppercase Base (e.g., B_y, E_x)
      if (base === base.toLowerCase()) return full;
    }
    return `${base}_${axis}`;
  });
  expr = expr.replace(/\b([A-Za-z])([0-9]+)\b/g, '$1_{$2}');

  // 2. Convert Unicode superscripts and subscripts to standard LaTeX ^{...} and _{...}
  expr = expr.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]+/g, (seq) => {
    const mapped = Array.from(seq).map((ch) => UNICODE_SUP_MAP[ch] || ch).join('');
    return mapped.length === 1 ? `^${mapped}` : `^{${mapped}}`;
  });
  expr = expr.replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑᵢⱼₖₘₙₒₚᵣₛₜᵤᵥₓ]+/g, (seq) => {
    const mapped = Array.from(seq).map((ch) => UNICODE_SUB_MAP[ch] || ch).join('');
    return mapped.length === 1 ? `_${mapped}` : `_{${mapped}}`;
  });

  // 3. Convert nested sqrt(...) / √(...) to \sqrt{...}
  expr = replaceSqrtCallsWithLatex(expr);

  // 4. Prefix standard mathematical function identifiers with backslash
  expr = expr.replace(/(?<!\\)\b([a-zA-Z]+)\b/g, (word) => {
    return RESERVED_MATH_FUNCTIONS.has(word) ? `\\${word}` : word;
  });

  // 5. Convert Unicode Greek/calculus/set/operator symbols to LaTeX commands
  for (const [pattern, replacement] of UNICODE_TO_LATEX_MAP) {
    expr = expr.replace(pattern, replacement);
  }

  // 6. Format unit vectors (i, j, k) and vector magnitude norms cleanly
  if (/_[xyz]\s+[ijk]\b/.test(expr)) {
    expr = expr.replace(/(_[xyz])\s+([ijk])\b/g, '$1\\mathbf{$2}');
    isVectorContext = true;
  }
  if (isVectorContext) {
    expr = expr.replace(/^([A-Z])(?=\s*=)/, '\\mathbf{$1}');
    expr = expr.replace(/\|\|([A-Za-z])\|\|/g, '\\|\\mathbf{$1}\\|');
    expr = expr.replace(/\|([A-Z])\|/g, '|\\mathbf{$1}|');
  }

  return expr.replace(/\s+/g, ' ').trim();
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Formats a single line of a diagram label into HTML + KaTeX.
 * Supports explicit $...$ delimiters, "Title: Equation", "Title Equation", "Title (math tuple)", and pure equations.
 */
function renderSingleDiagramLineWithKaTeX(rawLine: string): { html: string; upgraded: boolean } {
  const trimmed = (rawLine || '').trim();
  if (!trimmed) return { html: '', upgraded: false };

  // 0. If the line already contains explicit $...$ inline math delimiters
  if (/\$[^$\n]+\$/.test(trimmed)) {
    let anyMath = false;
    const parts = trimmed.split(/(\$[^$\n]+\$)/g);
    const html = parts
      .map((part, idx) => {
        if (idx % 2 === 1) {
          anyMath = true;
          const inner = part.slice(1, -1).trim();
          return katex.renderToString(convertDiagramFormulaToLatex(inner), {
            throwOnError: false,
            output: 'html'
          });
        }
        return escapeHtmlText(part);
      })
      .join('');
    return { html, upgraded: anyMath };
  }

  const isVectorLabel =
    /\b(?:vector|magnitude|norm)\b/i.test(trimmed) ||
    /\b[A-Za-z]_[xyz]\s+[ijk]\b|\b[A-Za-z][xyz]\s+[ijk]\b/.test(trimmed);

  // 1. Leading descriptive title followed by an equation (supports any LHS: variables, norms |A|, functions H(s)/det(...), calculus ∑/∫/∂/∇)
  const lhsLookahead =
    '(?:\\|\\|?[A-Za-z0-9\\\\{}]+\\|\\|?|[∑∏∫∂∇∆\\\\][A-Za-z0-9_^{}()\\\\²³⁴₀-₉ₓ\\s+\\-*/]*|[A-Za-zα-ωΑ-Ω][A-Za-z0-9_^{}\\\\²³⁴₀-₉ₓ]*(?:\\([^()]+\\))?(?:\\s*[/+\\-]\\s*[∂∇A-Za-z0-9_^{}\\\\²³⁴₀-₉ₓ]+)*)\\s*[=≈≠<>≤≥→⇒⇔]';
  const eqSplitRegex = new RegExp(`^([A-Za-z][A-Za-z0-9\\s'\\-]*?)(?:\\s*:\\s*|\\s+)(?=${lhsLookahead})([\\s\\S]+)$`);
  const eqSplitMatch = trimmed.match(eqSplitRegex);
  if (eqSplitMatch) {
    const prefixTitle = eqSplitMatch[1].trim();
    const mathPart = eqSplitMatch[2].trim();
    const latex = convertDiagramFormulaToLatex(mathPart, isVectorLabel);
    const renderedMath = katex.renderToString(latex, { throwOnError: false, output: 'html' });
    return {
      html: `<span style="font-weight:600;margin-right:6px;">${escapeHtmlText(prefixTitle)}</span>${renderedMath}`,
      upgraded: true
    };
  }

  // 2. Descriptive title followed by a parenthesized or bracketed mathematical expression / symbol tuple
  const parenMathMatch = trimmed.match(
    /^([A-Za-z][A-Za-z0-9\s'\-]*?)\s*(\((?:[A-Za-z0-9_^{}\\²³⁴₀-₉ₓα-ωΑ-Ω∑∏∫∂∇+\-*/=<>≤≥±×·,\s]+)\))$/
  );
  if (parenMathMatch) {
    const prefixTitle = parenMathMatch[1].trim();
    const parenContent = parenMathMatch[2].slice(1, -1).trim();
    const tokens = parenContent.split(',').map((t) => t.trim());
    const looksLikeMathTuple =
      /[=<>≤≥±×·²³⁴₀-₉ₓ\\α-ωΑ-Ω∑∏∫∂∇0-9_]/.test(parenContent) ||
      (tokens.length >= 2 && tokens.every((t) => /^[A-Za-z0-9_^{}]+$/.test(t) && t.length <= 3));
    if (looksLikeMathTuple) {
      const latex = `(${convertDiagramFormulaToLatex(parenContent, isVectorLabel)})`;
      const renderedMath = katex.renderToString(latex, { throwOnError: false, output: 'html' });
      return {
        html: `<span style="font-weight:600;margin-right:5px;">${escapeHtmlText(prefixTitle)}</span>${renderedMath}`,
        upgraded: true
      };
    }
  }

  // 3. Standalone equation or formula with no descriptive prefix
  const standaloneEqRegex = new RegExp(`^${lhsLookahead}[\\s\\S]+$`);
  if (standaloneEqRegex.test(trimmed)) {
    const latex = convertDiagramFormulaToLatex(trimmed, isVectorLabel);
    return {
      html: katex.renderToString(latex, { throwOnError: false, output: 'html' }),
      upgraded: true
    };
  }

  // 4. Standalone mathematical expression containing radicals, explicit scripts, or calculus operators without multi-word prose
  if (/(?:\\sqrt|\bsqrt\s*\(|√|[²³⁴₀-₉ₓ]|_[0-9xyz]|\^[0-9]|[∑∏∫∂∇])/.test(trimmed)) {
    const proseWords = trimmed
      .replace(/\bsqrt\b/gi, ' ')
      .replace(/[^A-Za-z\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 2 && !RESERVED_MATH_FUNCTIONS.has(w.toLowerCase()));
    if (proseWords.length === 0) {
      const latex = convertDiagramFormulaToLatex(trimmed, isVectorLabel);
      return {
        html: katex.renderToString(latex, { throwOnError: false, output: 'html' }),
        upgraded: true
      };
    }
  }

  return { html: escapeHtmlText(trimmed), upgraded: false };
}

/**
 * Upgrades mathematical equations, radicals, vectors, and symbol tuples across single-line
 * or multi-line diagram labels into KaTeX HTML while preserving line breaks.
 */
function renderDiagramLabelWithKaTeX(rawContentOrHtml: string): { html: string; upgraded: boolean } {
  if (!rawContentOrHtml) return { html: '', upgraded: false };
  const lines = rawContentOrHtml
    .split(/<br\s*\/?>|\r?\n/i)
    .map((line) => line.replace(/<[^>]+>/g, '').trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return { html: '', upgraded: false };

  let anyUpgraded = false;
  const renderedLines = lines.map((line) => {
    const res = renderSingleDiagramLineWithKaTeX(line);
    if (res.upgraded) anyUpgraded = true;
    return res.html;
  });

  return {
    html: renderedLines.join('<br/>'),
    upgraded: anyUpgraded
  };
}

/**
 * Mounts the Mermaid SVG inside the offscreen sandbox, upgrades mathematical node/edge labels
 * with KaTeX HTML, adjusts `<foreignObject>` and `<rect>` containers so formulas never wrap or clip,
 * and expands the root `<svg viewBox>` if any outer node grew wider/taller.
 */
function upgradeMermaidSvgLabelsWithKaTeX(rawSvg: string, sandboxHost?: HTMLDivElement | null): string {
  if (!rawSvg || typeof window === 'undefined' || !sandboxHost) return rawSvg;
  try {
    sandboxHost.innerHTML = rawSvg;
    const svgEl = sandboxHost.querySelector('svg');
    if (!svgEl) {
      sandboxHost.innerHTML = '';
      return rawSvg;
    }

    const labelSpans = Array.from(svgEl.querySelectorAll<HTMLElement>('.nodeLabel, .edgeLabel'));
    let anyUpgraded = false;

    for (const span of labelSpans) {
      const rawSource = span.innerHTML && /<br\s*\/?>/i.test(span.innerHTML)
        ? span.innerHTML
        : (span.textContent || '').trim();
      if (!rawSource) continue;
      const { html, upgraded } = renderDiagramLabelWithKaTeX(rawSource);
      if (!upgraded) continue;

      anyUpgraded = true;
      span.innerHTML = html;
      span.style.display = 'inline-block';
      span.style.textAlign = 'center';
      span.style.whiteSpace = 'nowrap';
      span.style.lineHeight = '1.35';

      const wrapperDiv = span.parentElement as HTMLElement | null;
      if (wrapperDiv && wrapperDiv.tagName.toLowerCase() === 'div') {
        wrapperDiv.style.maxWidth = 'none';
        wrapperDiv.style.whiteSpace = 'nowrap';
        wrapperDiv.style.display = 'inline-block';
      }
    }

    if (anyUpgraded) {
      const nodeGroups = Array.from(svgEl.querySelectorAll<SVGGElement>('g.node'));
      for (const nodeG of nodeGroups) {
        const fo = nodeG.querySelector<SVGForeignObjectElement>('foreignObject');
        const span = nodeG.querySelector<HTMLElement>('.nodeLabel');
        if (!fo || !span) continue;

        const rect = span.getBoundingClientRect();
        const measuredW = Math.ceil(Math.max(rect.width, span.scrollWidth || 0)) + 10;
        const measuredH = Math.ceil(Math.max(rect.height, span.scrollHeight || 0)) + 8;
        const origFoW = parseFloat(fo.getAttribute('width') || '0') || 0;
        const origFoH = parseFloat(fo.getAttribute('height') || '0') || 0;

        const finalFoW = Math.max(origFoW, measuredW);
        const finalFoH = Math.max(origFoH, measuredH);

        if (finalFoW > origFoW || finalFoH > origFoH) {
          fo.setAttribute('width', String(finalFoW));
          fo.setAttribute('height', String(finalFoH));
          const labelG = fo.parentElement as Element | null;
          if (labelG && labelG.tagName.toLowerCase() === 'g') {
            labelG.setAttribute('transform', `translate(${-finalFoW / 2}, ${-finalFoH / 2})`);
          }
          const boxRect = nodeG.querySelector<SVGRectElement>('rect.label-container, rect.basic');
          if (boxRect) {
            const origRectW = parseFloat(boxRect.getAttribute('width') || '0') || 0;
            const origRectH = parseFloat(boxRect.getAttribute('height') || '0') || 0;
            const finalRectW = Math.max(origRectW, finalFoW + 28);
            const finalRectH = Math.max(origRectH, finalFoH + 20);
            boxRect.setAttribute('width', String(finalRectW));
            boxRect.setAttribute('height', String(finalRectH));
            boxRect.setAttribute('x', String(-finalRectW / 2));
            boxRect.setAttribute('y', String(-finalRectH / 2));
          }
        }
      }

      // Ensure the root SVG viewBox encompasses any widened outer nodes without edge clipping
      try {
        const bbox = svgEl.getBBox();
        if (bbox && Number.isFinite(bbox.width) && bbox.width > 0 && Number.isFinite(bbox.height) && bbox.height > 0) {
          const pad = 16;
          const vbAttr = svgEl.getAttribute('viewBox') || '';
          const vbNums = vbAttr.trim().split(/[\s,]+/).map((n) => parseFloat(n));
          if (vbNums.length === 4 && vbNums.every((n) => Number.isFinite(n))) {
            const minX = Math.min(vbNums[0], Math.floor(bbox.x - pad));
            const minY = Math.min(vbNums[1], Math.floor(bbox.y - pad));
            const maxX = Math.max(vbNums[0] + vbNums[2], Math.ceil(bbox.x + bbox.width + pad));
            const maxY = Math.max(vbNums[1] + vbNums[3], Math.ceil(bbox.y + bbox.height + pad));
            svgEl.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
          }
        }
      } catch {
        // Ignore getBBox errors in non-visual test environments
      }
    }

    const serialized = svgEl.outerHTML;
    sandboxHost.innerHTML = '';
    return serialized;
  } catch {
    if (sandboxHost) sandboxHost.innerHTML = '';
    return rawSvg;
  }
}

export interface MermaidViewerProps {
  chart: string;
  aiRepairFn?: ConstrainedAiRepairFn | null;
}

export default function MermaidViewer({ chart, aiRepairFn }: MermaidViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sandboxRef = useRef<HTMLDivElement>(null);
  const renderSeqRef = useRef<number>(0);
  const reactInstanceId = useId().replace(/[^a-zA-Z0-9]/g, '');

  const [svgContent, setSvgContent] = useState<string>('');
  const [activeChartSource, setActiveChartSource] = useState<string>(chart);
  const [recoveryStage, setRecoveryStage] = useState<
    'original' | 'structured_spec' | 'deterministic_repair' | 'ai_repair' | 'failed' | null
  >(null);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [diagnosticDetails, setDiagnosticDetails] = useState<string>('');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showRawMermaid, setShowRawMermaid] = useState(false);

  // Detect if an LLM inappropriately generated a Mermaid quadrantChart for Cartesian geometry
  const mathQuadrantData = useMemo(() => {
    const isQuadrant = /quadrantChart/i.test(chart);
    const hasMathTerms = /(origin|circle|tangent|radius|slope|x\^2|y\^2|arc|point)/i.test(chart);
    if (!isQuadrant || !hasMathTerms) return null;
    const extractedLines: string[] = [];

    const equationMatches = chart.matchAll(/(?:[xy]\^2|f\(x\)|y\s*=)[^,\n]+/gi);
    for (const match of equationMatches) {
      extractedLines.push(match[0].trim());
    }

    const coordMatches = chart.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g);
    for (const match of coordMatches) {
      extractedLines.push(`point(${match[1]}, ${match[2]})`);
    }

    return {
      isMisused: true,
      recoveredPlotCode: extractedLines.length > 0 ? extractedLines.join('\n') : null
    };
  }, [chart]);

  useEffect(() => {
    let isCancelled = false;
    renderSeqRef.current += 1;
    const currentSeq = renderSeqRef.current;
    const renderId = `mermaid-${reactInstanceId}-${currentSeq}`;

    const clearSandboxContainer = () => {
      if (sandboxRef.current) {
        sandboxRef.current.innerHTML = '';
      }
    };

    const renderValidatedDiagram = async () => {
      const trimmedChart = (chart || '').trim();
      const reportRenderFailure = (
        stage: 'empty_source' | 'syntax_validation' | 'post_render_sanitization' | 'render_exception',
        error?: unknown
      ) => {
        const diagramType = detectMermaidDiagramType(trimmedChart);
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        void LogService.log(
          'error',
          'ai',
          `Mermaid rendering failure [${stage}] [${diagramType}].`,
          {
            subsystem: 'mermaid-renderer',
            stage,
            diagramType,
            errorName,
            sourceLength: trimmedChart.length
          }
        );
      };
      if (!trimmedChart) {
        if (!isCancelled) {
          setSvgContent('');
          setHasError(true);
          setRecoveryStage('failed');
          setErrorMessage(
            'This diagram could not be rendered because its syntax could not be validated. The rest of this lesson remains available.'
          );
          setDiagnosticDetails('Diagram source is empty.');
          reportRenderFailure('empty_source', new Error('EmptyDiagramSource'));
        }
        return;
      }

      if (!isCancelled) {
        setHasError(false);
        setErrorMessage('');
        setDiagnosticDetails('');
        setSvgContent('');
      }

      try {
        // Step 1: Validate via mermaid.parse() and run layered recovery if needed
        const validation = await validateAndRecoverMermaidDiagram(trimmedChart, {
          parseValidator: async (candidate: string) => {
            const res = await mermaid.parse(candidate, { suppressErrors: false });
            return Boolean(res);
          },
          ...(aiRepairFn !== undefined ? { aiRepairFn } : {})
        });

        if (isCancelled || currentSeq !== renderSeqRef.current) {
          clearSandboxContainer();
          return;
        }

        if (!validation.isValid) {
          clearSandboxContainer();
          setHasError(true);
          setRecoveryStage('failed');
          setErrorMessage(
            validation.errorMessage ||
              'This diagram could not be rendered because its syntax could not be validated. The rest of this lesson remains available.'
          );
          setDiagnosticDetails(validation.diagnosticDetails || 'Syntax validation failed.');
          reportRenderFailure('syntax_validation', new Error('MermaidSyntaxValidationFailed'));
          return;
        }

        // Step 2: Render inside the component's own React-managed sandbox container
        clearSandboxContainer();
        const sandboxHost = sandboxRef.current || undefined;
        const { svg } = await mermaid.render(renderId, validation.chart, sandboxHost);
        const katexUpgradedSvg = upgradeMermaidSvgLabelsWithKaTeX(svg, sandboxRef.current);
        clearSandboxContainer();

        if (isCancelled || currentSeq !== renderSeqRef.current) {
          return;
        }

        const cleanSvg = DOMPurify.sanitize(katexUpgradedSvg, {
          USE_PROFILES: { svg: true, svgFilters: true, html: true, mathMl: true },
          HTML_INTEGRATION_POINTS: { 'annotation-xml': true, foreignobject: true },
          ADD_TAGS: [
            'foreignObject', 'div', 'span', 'p', 'br', 'b', 'i', 'strong', 'em', 'text', 'tspan',
            'svg', 'path', 'line', 'rect', 'circle', 'g'
          ],
          ADD_ATTR: [
            'style', 'class', 'xmlns', 'dominant-baseline', 'text-anchor', 'dy', 'dx', 'x', 'y',
            'transform', 'viewBox', 'd', 'width', 'height', 'preserveAspectRatio', 'aria-hidden'
          ]
        });

        // Guard against any residual error graphic output
        if (!cleanSvg || /Syntax error in text/i.test(cleanSvg)) {
          setHasError(true);
          setRecoveryStage('failed');
          setErrorMessage(
            'This diagram could not be rendered because its syntax could not be validated. The rest of this lesson remains available.'
          );
          setDiagnosticDetails('Renderer output failed post-render verification.');
          reportRenderFailure('post_render_sanitization', new Error('UnsafeOrInvalidSvgOutput'));
          return;
        }

        setActiveChartSource(validation.chart);
        setRecoveryStage(validation.stage);
        setSvgContent(cleanSvg);
      } catch (err: any) {
        clearSandboxContainer();
        if (!isCancelled && currentSeq === renderSeqRef.current) {
          setHasError(true);
          setRecoveryStage('failed');
          setErrorMessage(
            'This diagram could not be rendered because its syntax could not be validated. The rest of this lesson remains available.'
          );
          setDiagnosticDetails(err?.message || String(err));
          reportRenderFailure('render_exception', err);
        }
      }
    };

    renderValidatedDiagram();

    return () => {
      isCancelled = true;
      clearSandboxContainer();
    };
  }, [chart, aiRepairFn, reactInstanceId]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeChartSource || chart);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSvg = () => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `diagram-${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (hasError) {
    return (
      <div
        role="region"
        aria-label="Diagram status"
        className="my-4 p-4 rounded-2xl bg-slate-50 dark:bg-zinc-900/70 border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-300 text-xs"
      >
        <div ref={sandboxRef} className="hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-zinc-100">
              <AlertTriangle size={15} className="text-amber-500 shrink-0" />
              <span>Diagram temporarily unavailable</span>
            </div>
            <p className="text-slate-600 dark:text-zinc-400 leading-relaxed">
              {errorMessage ||
                'This diagram could not be rendered because its syntax could not be validated. The rest of this lesson remains available.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowDiagnostics((prev) => !prev)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-500 dark:text-zinc-400 hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition-colors shrink-0"
          >
            <span>Diagnostics</span>
            {showDiagnostics ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>

        {showDiagnostics && (
          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-zinc-800 space-y-2 font-mono text-[11px]">
            {diagnosticDetails && (
              <div className="text-amber-700 dark:text-amber-400">
                Validation diagnostic: {diagnosticDetails}
              </div>
            )}
            <pre className="p-2.5 rounded-xl bg-slate-100 dark:bg-zinc-950 overflow-x-auto whitespace-pre-wrap text-slate-600 dark:text-zinc-400">
              {chart}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="my-6 space-y-4">
      {/* Isolated React-managed offscreen host with non-zero dimensions for accurate Mermaid SVG text measurement */}
      <div
        ref={sandboxRef}
        className="fixed -left-[9999px] top-0 w-[1024px] h-[768px] opacity-0 pointer-events-none overflow-hidden"
        aria-hidden="true"
      />

      {/* If Mermaid quadrantChart was inappropriately used for Cartesian math, warn and show accurate plot */}
      {mathQuadrantData?.isMisused && (
        <div className="p-4 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-xs text-indigo-950 dark:text-indigo-200">
          <div className="flex items-center gap-2 font-bold text-indigo-700 dark:text-indigo-300 mb-1">
            <Compass size={16} />
            <span>Academic Rigor Note: Cartesian Geometry Correction</span>
          </div>
          <p className="leading-relaxed mb-3 text-indigo-900/90 dark:text-indigo-300/90">
            Mermaid quadrant charts are designed for 2x2 conceptual matrices (e.g. SWOT analysis) and cannot represent continuous Cartesian curves, slopes, or true coordinate axes (which intersect at (0, 0)). Below is the mathematically accurate, dynamic Cartesian coordinate plot.
          </p>

          {mathQuadrantData.recoveredPlotCode && (
            <FunctionPlotViewer code={mathQuadrantData.recoveredPlotCode} />
          )}

          <div className="mt-2 flex justify-end">
            <button
              onClick={() => setShowRawMermaid(!showRawMermaid)}
              className="text-[11px] underline text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 transition-colors"
            >
              {showRawMermaid ? 'Hide original Mermaid quadrant matrix' : 'View original Mermaid quadrant matrix'}
            </button>
          </div>
        </div>
      )}

      {/* Standard Mermaid Diagram Viewer (or when toggled) */}
      {(!mathQuadrantData?.isMisused || showRawMermaid) && (
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/90 shadow-sm overflow-hidden">
          {/* Top Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 bg-slate-50 dark:bg-zinc-800 border-b border-slate-200 dark:border-zinc-700 text-xs font-semibold text-slate-600 dark:text-zinc-300">
            <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] text-indigo-600 dark:text-indigo-400">
              Visual Diagram
              {recoveryStage && recoveryStage !== 'original' && (
                <span className="text-[10px] font-normal normal-case text-slate-400 dark:text-zinc-500">
                  (Verified)
                </span>
              )}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setZoom((z) => Math.min(z + 0.15, 2.0))}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
                title="Zoom In"
              >
                <ZoomIn size={14} />
              </button>
              <button
                onClick={() => setZoom((z) => Math.max(z - 0.15, 0.5))}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
                title="Zoom Out"
              >
                <ZoomOut size={14} />
              </button>
              <button
                onClick={handleDownloadSvg}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
                title="Download SVG"
              >
                <Download size={14} />
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors"
                title="Copy Diagram Code"
              >
                {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                <span className="text-[11px]">{copied ? 'Copied' : 'Source'}</span>
              </button>
            </div>
          </div>

          {/* SVG Canvas */}
          <div
            ref={containerRef}
            className="p-6 overflow-x-auto flex items-center justify-center min-h-[140px] bg-slate-50/50 dark:bg-zinc-900/40"
          >
            {svgContent ? (
              <div
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'center center',
                  transition: 'transform 0.15s ease-out'
                }}
                dangerouslySetInnerHTML={{ __html: svgContent }}
                className="mermaid-svg-wrapper flex justify-center max-w-full"
              />
            ) : (
              <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-zinc-500 animate-pulse">
                <RefreshCw className="animate-spin" size={14} />
                Validating and rendering visual diagram...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
