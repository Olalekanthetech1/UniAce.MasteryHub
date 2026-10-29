import React, { Component, ErrorInfo, ReactNode, Suspense, useMemo } from 'react';
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import DOMPurify from 'dompurify';
import MermaidViewer from './renderers/MermaidViewer';
import FunctionPlotViewer from './renderers/FunctionPlotViewer';
import VennDiagramViewer from './renderers/VennDiagramViewer';
import SvgDiagramViewer from './renderers/SvgDiagramViewer';

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
export function normalizeMathDelimiters(raw: string): string {
  if (typeof raw !== 'string' || !raw) return '';

  return raw
    .replace(/```(?:math|latex)\n([\s\S]+?)\n```/gi, (_m, body) => `\n\n$$\n${body.trim()}\n$$\n\n`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body) => `\n\n$$\n${body.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body) => `$${body.trim()}$`);
}

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
      ADD_TAGS: ['foreignObject'],
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
      '<svg style="width: 100%; height: auto; max-height: 480px; display: block; margin: 0 auto;"'
    );
  }

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

  const normalized = normalizeMathDelimiters(content);
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
      const lang = (token.lang || '').trim().toLowerCase();
      const interactiveType = INTERACTIVE_CODE_LANGS[lang];
      if (interactiveType) {
        flushPendingTokens();
        segments.push({ type: interactiveType, code: token.text });
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

