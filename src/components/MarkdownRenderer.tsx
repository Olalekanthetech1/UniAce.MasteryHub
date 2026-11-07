import React, { Component, ErrorInfo, ReactNode, Suspense, useMemo } from 'react';
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import DOMPurify from 'dompurify';
import MermaidViewer from './renderers/MermaidViewer';
import FunctionPlotViewer from './renderers/FunctionPlotViewer';
import VennDiagramViewer from './renderers/VennDiagramViewer';
import SvgDiagramViewer from './renderers/SvgDiagramViewer';
import { normalizeMathDelimiters as normalizeSharedMathDelimiters } from '../shared/mathText';
import { convertLatexLabelToReadableText } from '../services/mermaidRepairService';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

class MathErrorBoundary extends Component<ErrorBoundaryProps, { hasError: boolean; errorMsg: string }> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error?.message || 'Unknown rendering error' };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Markdown/Math Rendering Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="p-4 border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 text-red-600 dark:text-red-300 rounded-lg text-xs font-mono whitespace-pre-wrap overflow-auto">
            Render Error: {this.state.errorMsg}
          </div>
        )
      );
    }
    return this.props.children;
  }
}

export interface MarkdownRendererProps {
  content?: string;
  className?: string;
  inline?: boolean;
}

const KATEX_MATHML_TAGS = [
  'math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mspace', 'mtext',
  'menclose', 'merror', 'mfenced', 'mfrac', 'mpadded', 'mphantom', 'mroot', 'msqrt',
  'mstyle', 'mmultiscripts', 'mover', 'mprescripts', 'msub', 'msubsup', 'msup', 'munder',
  'munderover', 'mtable', 'mtd', 'mtr', 'none', 'svg', 'path', 'line', 'rect', 'circle',
  'g', 'defs', 'use', 'clipPath', 'text', 'tspan', 'polygon', 'polyline', 'ellipse'
];

const KATEX_ALLOWED_ATTR = [
  'xmlns', 'encoding', 'display', 'mathvariant', 'stretchy', 'fence', 'separator',
  'accent', 'accentunder', 'columnalign', 'rowalign', 'columnspacing', 'rowspacing',
  'columnlines', 'rowlines', 'frame', 'framespacing', 'equalrows', 'equalcolumns',
  'displaystyle', 'scriptlevel', 'voffset', 'lspace', 'rspace', 'maxsize', 'minsize',
  'aria-hidden', 'style', 'class', 'id', 'href', 'target', 'rel', 'src', 'alt', 'title',
  'width', 'height', 'viewBox', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'transform', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'points', 'preserveAspectRatio', 'colspan', 'rowspan', 'align'
];

/**
 * Normalizes transport-level LaTeX delimiter variants (\( ... \) and \[ ... \])
 * so marked-katex-extension parses all math blocks uniformly.
 */
export const normalizeMathDelimiters = normalizeSharedMathDelimiters;
function createConfiguredMarkedInstance(): Marked {
  const instance = new Marked({
    gfm: true,
    breaks: true
  });

  instance.use(
    markedKatex({
      throwOnError: false,
      nonStandard: true,
      output: 'htmlAndMathml',
      strict: false
    })
  );

  instance.use({
    renderer: {
      table(token) {
        const headerCells = token.header
          .map((cell) => {
            const alignAttr = cell.align ? ` style="text-align:${cell.align}"` : '';
            const rendered = this.parser.parseInline(cell.tokens);
            return `<th class="px-5 py-3.5 font-semibold text-slate-800 dark:text-zinc-200"${alignAttr}>${rendered}</th>`;
          })
          .join('');

        const bodyRows = token.rows
          .map((row) => {
            const rowCells = row
              .map((cell) => {
                const alignAttr = cell.align ? ` style="text-align:${cell.align}"` : '';
                const rendered = this.parser.parseInline(cell.tokens);
                return `<td class="px-5 py-3.5 text-slate-600 dark:text-zinc-400 font-medium"${alignAttr}>${rendered}</td>`;
              })
              .join('');
            return `<tr class="hover:bg-slate-50/50 dark:hover:bg-zinc-800/10 transition-colors">${rowCells}</tr>`;
          })
          .join('');

        return `<div class="my-6 w-full overflow-x-auto rounded-3xl border border-slate-200 dark:border-zinc-800 shadow-sm scrollbar-hide"><table class="w-full text-left border-collapse text-sm text-slate-600 dark:text-zinc-300"><thead class="bg-slate-50 dark:bg-zinc-800/40 border-b border-slate-200 dark:border-zinc-800 font-semibold text-slate-900 dark:text-white uppercase text-xs tracking-wider"><tr>${headerCells}</tr></thead><tbody class="divide-y divide-slate-100 dark:divide-zinc-800/40">${bodyRows}</tbody></table></div>`;
      },
      codespan(token) {
        const escaped = token.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<code class="bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-200 px-1.5 py-0.5 rounded-md text-xs sm:text-sm font-mono border border-slate-200/60 dark:border-zinc-700/60 font-normal">${escaped}</code>`;
      },
      code(token) {
        const langClass = token.lang ? ` language-${token.lang}` : '';
        const escaped = token.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<div class="not-prose relative my-4 overflow-x-auto rounded-2xl bg-slate-900 dark:bg-zinc-900/90 p-4 border border-slate-800 text-slate-100 font-mono text-xs sm:text-sm leading-relaxed shadow-sm"><code class="bg-transparent text-slate-100 p-0 border-none font-mono text-xs sm:text-sm${langClass}">${escaped}</code></div>`;
      },
      link(token) {
        const href = token.href || '';
        const titleAttr = token.title ? ` title="${token.title}"` : '';
        const text = this.parser.parseInline(token.tokens);
        return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
      }
    }
  });

  return instance;
}

const sharedMarked = createConfiguredMarkedInstance();

/**
 * Sanitizes HTML + KaTeX MathML + SVG markup using DOMPurify.
 */
export function sanitizeRenderedHtml(dirtyHtml: string): string {
  if (!dirtyHtml || typeof dirtyHtml !== 'string') return '';
  return String(
    DOMPurify.sanitize(dirtyHtml, {
      ADD_TAGS: KATEX_MATHML_TAGS,
      ADD_ATTR: KATEX_ALLOWED_ATTR,
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur']
    })
  );
}

const SVG_DIGIT_SUB_MAP: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉'
};

function formatSvgMathLabelText(raw: string): string {
  if (!raw) return '';
  let text = convertLatexLabelToReadableText(raw).text;
  // Convert coordinate / indexed variable tokens like P1, P2, x1, x2, y1, y2 -> P₁, P₂, x₁, x₂, y₁, y₂
  text = text.replace(/\b([A-Za-z])([0-9])\b/g, (_m, sym: string, digit: string) => {
    return `${sym}${SVG_DIGIT_SUB_MAP[digit] || digit}`;
  });
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Repairs SVG <text> and <tspan> typography anomalies at runtime:
 * 1. Collapses inline subscript/superscript <tspan> sequences or redundant x-positioned <tspan> children
 *    that cause characters/words (such as P1(x1, y1), x2 - x1, Distance d) to stack at the same X coordinate.
 * 2. Resets inherited negative letter-spacing (-0.01em) so small-viewBox user units are never compressed.
 * 3. When an SVG uses a small coordinate viewBox (or font-size < 9 in user units), normalizes <text>
 *    to font-size="16" with an exact compensating translate(x,y) scale(s) translate(-x,-y) transform
 *    so Chrome/Blink never clamps glyph height relative to character advance.
 */
function normalizeSvgDiagramTypography(svgMarkup: string): string {
  if (!svgMarkup || typeof DOMParser === 'undefined') return svgMarkup;
  try {
    const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl || doc.querySelector('parsererror')) {
      return svgMarkup;
    }

    const vbAttr = svgEl.getAttribute('viewBox') || '';
    const vbParts = vbAttr
      .trim()
      .split(/[\s,]+/)
      .map((n) => parseFloat(n));
    const hasValidVb = vbParts.length === 4 && vbParts.every((n) => Number.isFinite(n));
    const vbWidth = hasValidVb ? Math.abs(vbParts[2]) : 600;
    const vbHeight = hasValidVb ? Math.abs(vbParts[3]) : 400;
    const minVbDim = Math.min(vbWidth, vbHeight);

    const parseFontSizeFromEl = (el: Element | null): number | null => {
      let curr: Element | null = el;
      while (curr && curr.tagName.toLowerCase() !== 'svg') {
        const attrFs = curr.getAttribute('font-size');
        if (attrFs) {
          const val = parseFloat(attrFs);
          if (Number.isFinite(val) && val > 0) return val;
        }
        const styleAttr = curr.getAttribute('style') || '';
        const styleMatch = styleAttr.match(/font-size\s*:\s*([0-9.]+)/i);
        if (styleMatch) {
          const val = parseFloat(styleMatch[1]);
          if (Number.isFinite(val) && val > 0) return val;
        }
        curr = curr.parentElement;
      }
      return null;
    };

    const textEls = Array.from(svgEl.querySelectorAll('text'));
    for (const textEl of textEls) {
      textEl.removeAttribute('textLength');
      textEl.removeAttribute('lengthAdjust');

      const tspans = Array.from(textEl.querySelectorAll('tspan'));
      if (tspans.length > 0) {
        // Check if tspans are inline segments (no multi-line vertical break)
        const parentX = textEl.getAttribute('x');
        const effectiveFs = parseFontSizeFromEl(textEl) || (minVbDim < 120 ? minVbDim * 0.045 : 14);
        const hasTrueLineBreak = tspans.some((ts, idx) => {
          if (idx === 0) return false;
          const dyRaw = ts.getAttribute('dy') || '';
          if (!dyRaw) return false;
          if (/em$/i.test(dyRaw.trim())) {
            return Math.abs(parseFloat(dyRaw)) >= 0.85;
          }
          const dyVal = parseFloat(dyRaw);
          return Number.isFinite(dyVal) && Math.abs(dyVal) >= effectiveFs * 0.85;
        });

        if (!hasTrueLineBreak) {
          // Collapse inline tspans into a single clean text string so baseline/x resets cannot stack glyphs
          const combinedRaw = (textEl.textContent || '').replace(/\s+/g, ' ').trim();
          textEl.textContent = formatSvgMathLabelText(combinedRaw);
        } else {
          // Multi-line tspan block: ensure only true line-break tspans reset x, and format each span's text
          tspans.forEach((ts, idx) => {
            ts.removeAttribute('textLength');
            ts.removeAttribute('lengthAdjust');
            const dyRaw = ts.getAttribute('dy') || '';
            if (idx > 0 && !dyRaw && ts.getAttribute('x') === parentX) {
              ts.removeAttribute('x');
            }
            if (ts.childNodes.length === 1 && ts.firstChild?.nodeType === 3) {
              ts.textContent = formatSvgMathLabelText(ts.textContent || '');
            }
          });
        }
      } else {
        textEl.textContent = formatSvgMathLabelText(textEl.textContent || '');
      }

      // Reset letter-spacing and word-spacing on <text>
      const prevStyle = (textEl.getAttribute('style') || '').replace(
        /(?:letter-spacing|word-spacing)\s*:[^;]+;?/gi,
        ''
      ).trim();
      textEl.setAttribute(
        'style',
        `${prevStyle ? `${prevStyle}; ` : ''}letter-spacing: 0px; word-spacing: 0px;`
      );

      // If font-size in SVG user space is small (< 9 user units) or viewBox is compact (< 160 units),
      // normalize font-size to 16px and apply a local scale transform around (x, y)
      const explicitFs = parseFontSizeFromEl(textEl);
      const desiredUserFs =
        explicitFs !== null
          ? explicitFs
          : minVbDim < 160
            ? Math.max(minVbDim * 0.045, 0.35)
            : 14;

      if (desiredUserFs < 9.5) {
        const targetFs = 16;
        const scale = Number((desiredUserFs / targetFs).toFixed(5));
        const xVal = parseFloat(textEl.getAttribute('x') || '0') || 0;
        const yVal = parseFloat(textEl.getAttribute('y') || '0') || 0;

        textEl.setAttribute('font-size', String(targetFs));
        // Strip inline style font-size if present so attribute font-size=16 governs
        const cleanedStyle = (textEl.getAttribute('style') || '').replace(/font-size\s*:[^;]+;?/gi, '').trim();
        textEl.setAttribute('style', cleanedStyle);

        // Scale dx/dy offsets on textEl if present
        if (textEl.hasAttribute('dx')) {
          const dxNum = parseFloat(textEl.getAttribute('dx') || '0');
          if (Number.isFinite(dxNum) && dxNum !== 0) {
            textEl.setAttribute('dx', String(Number((dxNum / scale).toFixed(2))));
          }
        }
        if (textEl.hasAttribute('dy') && !/%|em/i.test(textEl.getAttribute('dy') || '')) {
          const dyNum = parseFloat(textEl.getAttribute('dy') || '0');
          if (Number.isFinite(dyNum) && dyNum !== 0) {
            textEl.setAttribute('dy', String(Number((dyNum / scale).toFixed(2))));
          }
        }

        const existingTransform = (textEl.getAttribute('transform') || '').trim();
        const scaleTransform =
          xVal === 0 && yVal === 0
            ? `scale(${scale})`
            : `translate(${xVal}, ${yVal}) scale(${scale}) translate(${-xVal}, ${-yVal})`;
        textEl.setAttribute(
          'transform',
          existingTransform ? `${existingTransform} ${scaleTransform}` : scaleTransform
        );
      }
    }

    return new XMLSerializer().serializeToString(svgEl);
  } catch {
    return svgMarkup;
  }
}

/**
 * Sanitizes raw SVG diagram markup using DOMPurify.
 */
export function sanitizeSvgMarkup(rawSvg: string): { cleanSvg: string; error?: string } {
  if (!rawSvg || typeof rawSvg !== 'string' || !rawSvg.trim()) {
    return { cleanSvg: '', error: 'Empty SVG diagram content' };
  }

  let svgCandidate = rawSvg.trim();
  const svgMatch = svgCandidate.match(/<svg[\s\S]*?<\/svg>/i);
  if (svgMatch) {
    svgCandidate = svgMatch[0];
  } else if (!svgCandidate.toLowerCase().startsWith('<svg')) {
    return { cleanSvg: '', error: 'Valid <svg> root element not found in diagram block' };
  }

  const sanitized = String(
    DOMPurify.sanitize(svgCandidate, {
      USE_PROFILES: { svg: true, svgFilters: true, html: true },
      HTML_INTEGRATION_POINTS: { 'annotation-xml': true, foreignobject: true },
      ADD_TAGS: ['foreignObject', 'text', 'tspan'],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
    })
  );

  if (!sanitized || !sanitized.toLowerCase().includes('<svg')) {
    return { cleanSvg: '', error: 'SVG diagram failed security sanitization' };
  }

  let responsiveSvg = sanitized;
  if (!/viewBox\s*=/i.test(responsiveSvg)) {
    const widthMatch = responsiveSvg.match(/width\s*=\s*["']?(\d+)/i);
    const heightMatch = responsiveSvg.match(/height\s*=\s*["']?(\d+)/i);
    const w = widthMatch ? parseInt(widthMatch[1], 10) : 600;
    const h = heightMatch ? parseInt(heightMatch[1], 10) : 400;
    responsiveSvg = responsiveSvg.replace(/<svg/i, `<svg viewBox="0 0 ${w} ${h}"`);
  }

  if (!/style\s*=/i.test(responsiveSvg)) {
    responsiveSvg = responsiveSvg.replace(
      /<svg/i,
      '<svg style="width: 100%; height: auto; max-height: 480px; display: block; margin: 0 auto; letter-spacing: 0px; word-spacing: 0px;"'
    );
  }

  responsiveSvg = normalizeSvgDiagramTypography(responsiveSvg);

  return { cleanSvg: responsiveSvg };
}

/**
 * Compiles Markdown + LaTeX math into sanitized HTML using marked, marked-katex-extension, and DOMPurify.
 */
export function renderMarkdownToSanitizedHtml(content: string, inline: boolean = false): string {
  if (typeof content !== 'string' || !content.trim()) return '';
  const normalized = normalizeMathDelimiters(content);
  const rawHtml = inline
    ? (sharedMarked.parseInline(normalized) as string)
    : (sharedMarked.parse(normalized) as string);
  return sanitizeRenderedHtml(rawHtml);
}

type RenderSegment =
  | { type: 'html'; html: string }
  | { type: 'mermaid'; code: string }
  | { type: 'plot'; code: string }
  | { type: 'svg'; code: string }
  | { type: 'venn'; code: string };

const INTERACTIVE_CODE_LANGS: Record<string, 'mermaid' | 'plot' | 'svg' | 'venn'> = {
  mermaid: 'mermaid',
  'mermaid-json': 'mermaid',
  'diagram-spec': 'mermaid',
  'function-plot': 'plot',
  'math-plot': 'plot',
  graph: 'plot',
  plot: 'plot',
  cartesian: 'plot',
  svg: 'svg',
  'svg-diagram': 'svg',
  geometry: 'svg',
  'vector-diagram': 'svg',
  venn: 'venn',
  'venn-diagram': 'venn',
  'set-diagram': 'venn',
  venndiagram: 'venn'
};

function segmentMarkdownContent(content: string, inline: boolean): RenderSegment[] {
  if (typeof content !== 'string' || !content.trim()) return [];

  if (inline) {
    return [{ type: 'html', html: renderMarkdownToSanitizedHtml(content, true) }];
  }

  // Protect interactive diagram blocks (Mermaid, diagram-spec, SVG, plots) before math normalization
  const protectedDiagramBodies: string[] = [];
  const maskedContent = content.replace(
    /(^|\n)(```|~~~)([^\n]*)\n([\s\S]*?)\n\2[ \t]*(?=\n|$)/g,
    (fullMatch, leading: string, fence: string, info: string, body: string) => {
      const lang = String(info || '').trim().toLowerCase().split(/\s+/)[0];
      if (INTERACTIVE_CODE_LANGS[lang]) {
        const idx = protectedDiagramBodies.length;
        protectedDiagramBodies.push(body);
        return `${leading}${fence}${lang}\n__UNIACE_PROTECTED_DIAGRAM_${idx}__\n${fence}`;
      }
      return fullMatch;
    }
  );

  const normalized = normalizeMathDelimiters(maskedContent);
  const tokens = sharedMarked.lexer(normalized);
  const segments: RenderSegment[] = [];
  let pendingTokens: any[] = [];
  (pendingTokens as any).links = (tokens as any).links || {};

  const flushPendingTokens = () => {
    if (pendingTokens.length === 0) return;
    const html = sanitizeRenderedHtml(sharedMarked.parser(pendingTokens));
    if (html.trim()) {
      segments.push({ type: 'html', html });
    }
    pendingTokens = [];
    (pendingTokens as any).links = (tokens as any).links || {};
  };

  for (const token of tokens) {
    if (token.type === 'code') {
      const lang = (token.lang || '').trim().toLowerCase().split(/\s+/)[0];
      const interactiveType = INTERACTIVE_CODE_LANGS[lang];
      if (interactiveType) {
        flushPendingTokens();
        const placeholderMatch = String(token.text || '').trim().match(/^__UNIACE_PROTECTED_DIAGRAM_(\d+)__$/);
        const rawDiagramCode = placeholderMatch
          ? protectedDiagramBodies[Number(placeholderMatch[1])] ?? token.text
          : token.text;
        segments.push({ type: interactiveType, code: rawDiagramCode });
        continue;
      }
    }
    pendingTokens.push(token);
  }

  flushPendingTokens();
  return segments;
}

export default function MarkdownRenderer({
  content = '',
  className = '',
  inline = false
}: MarkdownRendererProps) {
  const segments = useMemo(() => segmentMarkdownContent(content, inline), [content, inline]);

  if (!content || typeof content !== 'string' || !content.trim()) {
    return null;
  }

  if (inline) {
    const html = segments[0]?.type === 'html' ? segments[0].html : '';
    return (
      <MathErrorBoundary>
        <span
          className={`markdown-inline ${className}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </MathErrorBoundary>
    );
  }

  return (
    <div className={`prose prose-slate dark:prose-invert max-w-none markdown-body ${className}`}>
      <MathErrorBoundary>
        {segments.map((seg, idx) => {
          if (seg.type === 'mermaid') {
            return (
              <Suspense key={idx} fallback={<div className="p-4 text-xs font-mono text-slate-400">Loading diagram...</div>}>
                <MermaidViewer chart={seg.code} />
              </Suspense>
            );
          }
          if (seg.type === 'plot') {
            return (
              <Suspense key={idx} fallback={<div className="p-4 text-xs font-mono text-slate-400">Loading plot...</div>}>
                <FunctionPlotViewer code={seg.code} />
              </Suspense>
            );
          }
          if (seg.type === 'svg') {
            return (
              <Suspense key={idx} fallback={<div className="p-4 text-xs font-mono text-slate-400">Loading diagram...</div>}>
                <SvgDiagramViewer code={seg.code} />
              </Suspense>
            );
          }
          if (seg.type === 'venn') {
            return (
              <Suspense key={idx} fallback={<div className="p-4 text-xs font-mono text-slate-400">Loading diagram...</div>}>
                <VennDiagramViewer code={seg.code} />
              </Suspense>
            );
          }
          return (
            <div
              key={idx}
              dangerouslySetInnerHTML={{ __html: seg.html }}
            />
          );
        })}
      </MathErrorBoundary>
    </div>
  );
}

export const MarkdownInline: React.FC<{ content?: string; className?: string }> = ({
  content = '',
  className = ''
}) => <MarkdownRenderer content={content} className={className} />;

export const MarkdownWordSpan: React.FC<{ content?: string; className?: string }> = ({
  content = '',
  className = ''
}) => <MarkdownRenderer content={content} className={className} inline />;

