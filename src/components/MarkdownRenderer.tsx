import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { Component, ErrorInfo, ReactNode, Suspense } from 'react';
import MermaidViewer from './renderers/MermaidViewer';
import FunctionPlotViewer from './renderers/FunctionPlotViewer';
import VennDiagramViewer from './renderers/VennDiagramViewer';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

class MathErrorBoundary extends Component<ErrorBoundaryProps, { hasError: boolean }> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Math Rendering Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <div className="p-4 border border-red-200 bg-red-50 text-red-600 rounded-lg text-xs font-mono whitespace-pre-wrap overflow-auto">Failed to render mathematical content. Displaying raw text instead.</div>;
    }
    return this.props.children;
  }
}

interface MarkdownRendererProps {
  content?: string;
  className?: string;
}

function fixMarkdownTables(text: string): string {
  if (typeof text !== 'string' || !text) return '';
  
  // First, handle some common merging issues before splitting into lines
  let processed = text;
  
  // A. Fix cases where text is immediately followed by a table without a newline
  // e.g., "Table below:| Header |" -> "Table below:\n\n| Header |"
  processed = processed.replace(/([a-zA-Z0-9:])(\| [^|\n]+ \|)/g, '$1\n\n$2');
  
  // B. Fix cases where header and separator are on the same line
  // e.g., "| H1 | H2 | |---|---|" -> "| H1 | H2 |\n|---|---|"
  // We look for the pattern | ... | followed by | ---
  processed = processed.replace(/(\| [^|\n]+ \|)\s*(\|?\s*[-:]{3,})/g, '$1\n$2');

  // Split content by newlines to inspect line-by-line
  const lines = processed.split('\n');
  const processedLines: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // Detect and fix mangled separator rows that contain words (like "using", "the", "example")
    // If a line has pipes and many dashes, it's likely a separator even if it has letters
    if (line.includes('|') && (line.match(/-/g) || []).length > 5 && /[a-zA-Z]/.test(line)) {
       const segments = line.split('|');
       const cleanedSegments = segments.map((segment, idx) => {
         if (idx === 0 || idx === segments.length - 1) {
           if (idx === 0 && segment.trim() === '') return '';
           if (idx === segments.length - 1 && segment.trim() === '') return '';
         }
         // If it contains dashes, it's meant to be a separator cell
         if (segment.includes('-')) {
           // Replace all alphanumeric and special chars with space, keep - and :
           return segment.replace(/[^:-]/g, '').padStart(3, '-');
         }
         return segment;
       });
       line = cleanedSegments.join('|');
       if (!line.startsWith('|')) line = '|' + line;
       if (!line.endsWith('|')) line = line + '|';
    }

    // Check if the line is a compressed table:
    // It contains multiple row dividers "||" or "|  |" and has many pipes
    const pipeCount = (line.match(/\|/g) || []).length;
    // Safer row divider detection: || or at least 3 spaces between pipes
    const hasRowDividers = /\|\|\s*\|/g.test(line) || /\|\s{3,}\|/g.test(line);
    
    if (pipeCount > 10 && hasRowDividers) {
      // Split the compressed line into separate row chunks
      // We look for where the AI might have joined rows
      const chunks = line.split(/\|{2,}/);
      
      const reconstructedRows = chunks.map((chunk) => {
        let trimmed = chunk.trim();
        if (!trimmed) return '';
        
        // Ensure row starts with pipe
        if (!trimmed.startsWith('|')) {
          trimmed = '| ' + trimmed;
        }
        // Ensure row ends with pipe
        if (!trimmed.endsWith('|')) {
          trimmed = trimmed + ' |';
        }
        return trimmed;
      }).filter(Boolean);
      
      processedLines.push(...reconstructedRows);
    } else {
      processedLines.push(line);
    }
  }
  
  const processedText = processedLines.join('\n');
  
  // Now align columns and ensure valid separator rows
  const finalLines = processedText.split('\n');
  const alignedLines: string[] = [];
  let inTable = false;
  let tableHeaderCols = 0;
  
  for (let i = 0; i < finalLines.length; i++) {
    const rawLine = finalLines[i];
    const line = rawLine.trim();
    
    // A row is part of a table if it has pipes and starts/ends with pipes (roughly)
    const isTableRow = (line.startsWith('|') || (line.includes('|') && line.endsWith('|'))) && (line.match(/\|/g) || []).length > 1;
    
    if (isTableRow) {
      // If table just started, ensure there's a blank line before it
      if (!inTable && alignedLines.length > 0 && alignedLines[alignedLines.length - 1].trim() !== '') {
        alignedLines.push('');
      }

      // Split by pipe, remove empty first and last elements if they are just whitespace
      let rawCols = line.split('|');
      if (rawCols[0].trim() === '') rawCols.shift();
      if (rawCols.length > 0 && rawCols[rawCols.length - 1].trim() === '') rawCols.pop();
      
      const cols = rawCols.map(c => c.trim());
      
      if (!inTable) {
        inTable = true;
        tableHeaderCols = cols.length;
        alignedLines.push('| ' + cols.join(' | ') + ' |');
      } else {
        // Check if this row is meant to be a separator
        const isSeparator = cols.every(col => /^[:\s-]*$/.test(col)) || (cols.length >= tableHeaderCols && cols.some(col => col.includes('---')));
        
        if (isSeparator) {
          let adjustedCols = cols.map(col => {
            let c = col.replace(/[^:-]/g, '');
            return c.length < 3 ? '---' : c;
          });
          
          if (adjustedCols.length < tableHeaderCols) {
            while (adjustedCols.length < tableHeaderCols) {
              adjustedCols.push('---');
            }
          } else if (adjustedCols.length > tableHeaderCols) {
            adjustedCols = adjustedCols.slice(0, tableHeaderCols);
          }
          alignedLines.push('| ' + adjustedCols.join(' | ') + ' |');
        } else {
          let adjustedCols = [...cols];
          if (adjustedCols.length < tableHeaderCols) {
            while (adjustedCols.length < tableHeaderCols) {
              adjustedCols.push('');
            }
          } else if (adjustedCols.length > tableHeaderCols) {
            adjustedCols = adjustedCols.slice(0, tableHeaderCols);
          }
          alignedLines.push('| ' + adjustedCols.join(' | ') + ' |');
        }
      }
    } else {
      if (inTable && line === '') {
        inTable = false;
        tableHeaderCols = 0;
      }
      alignedLines.push(rawLine);
    }
  }
  
  return alignedLines.join('\n');
}

function preprocessMarkdownContent(text: string): string {
  if (typeof text !== 'string' || !text) return '';

  // 0. Remove markdown backticks if they are wrapping a LaTeX math block entirely
  // e.g. `\[ S_k = 1 \]` -> \[ S_k = 1 \]
  let processedText = text
    .replace(/`(\\\([\s\S]+?\\\))` /g, '$1 ') // inline code with trailing space
    .replace(/ `(\\\([\s\S]+?\\\))`/g, ' $1') // inline code with leading space
    .replace(/`(\\\([\s\S]+?\\\))/g, '$1')   // inline code
    .replace(/`(\\\[[\s\S]+?\\\])`/g, '$1')   // block code
    .replace(/```math\n([\s\S]+?)\n```/g, '\n\n$$\n$1\n$$\n\n') // fenced math code blocks
    .replace(/```latex\n([\s\S]+?)\n```/g, '\n\n$$\n$1\n$$\n\n') // fenced latex code blocks
    .replace(/\\infinity\b/gi, '\\infty');

  // Convert top-level AMS environments (align, equation, gather) to KaTeX-compatible inner environments
  processedText = processedText
    .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
    .replace(/\\end\{align\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{equation\*?\}/g, '\\begin{aligned}')
    .replace(/\\end\{equation\*?\}/g, '\\end{aligned}')
    .replace(/\\begin\{gather\*?\}/g, '\\begin{gathered}')
    .replace(/\\end\{gather\*?\}/g, '\\end{gathered}')
    .replace(/\\begin\{multline\*?\}/g, '\\begin{aligned}')
    .replace(/\\end\{multline\*?\}/g, '\\end{aligned}');

  // Normalize LaTeX delimiters \( ... \) -> $ ... $ and \[ ... \] -> $$ ... $$
  processedText = processedText
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, p1) => `\n\n$$\n${p1.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, p1) => `$${p1.trim()}$`);

  // Wrap standalone \begin{aligned|gathered|cases|...} blocks in $$ if not already wrapped
  processedText = processedText.replace(
    /(?<!\$|`)\\begin\{(aligned|gathered|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|array)\}([\s\S]*?)\\end\{\1\}(?!\$|`)/g,
    '\n\n$$\n\\begin{$1}$2\\end{$1}\n$$\n\n'
  );

  // Normalize inline $$...$$ that are glued to preceding or following text so remark-math parses them as display blocks
  processedText = processedText.replace(/([^\n$])\s*\$\$([^\n$][\s\S]*?[^\n$])\$\$\s*([^\n$])/g, '$1\n\n$$\n$2\n$$\n\n$3');

  // 1. Temporarily extract and protect math blocks from regex operations that strip backslashes
  const mathBlocks: string[] = [];
  let protectedText = processedText;

  // Protect block math $$ ... $$
  protectedText = protectedText.replace(/\$\$([\s\S]+?)\$\$/g, (match) => {
    mathBlocks.push(match);
    return `__MATH_BLOCK_PLACEHOLDER_${mathBlocks.length - 1}__`;
  });

  // Protect inline math $ ... $
  protectedText = protectedText.replace(/\$([^$\n]+?)\$/g, (match) => {
    mathBlocks.push(match);
    return `__MATH_BLOCK_PLACEHOLDER_${mathBlocks.length - 1}__`;
  });

  // 2. Disable indented code blocks by reducing any indentation that is 4 or more spaces to 2 spaces
  // (unless it's inside a fenced code block with ```). This is because AI-generated lists/paragraphs
  // often get accidentally indented by 4+ spaces, which standard markdown renders as preformatted code blocks.
  const lines = protectedText.split('\n');
  let inFencedCodeBlock = false;
  const processedLines = lines.map(line => {
    if (line.trim().startsWith('```')) {
      inFencedCodeBlock = !inFencedCodeBlock;
      return line;
    }
    if (inFencedCodeBlock) {
      return line;
    }
    const match = line.match(/^(\s+)(.*)/);
    if (match) {
      const indent = match[1];
      const rest = match[2];
      if (indent.includes('\t') || indent.length >= 4) {
        // Replace with 2 spaces to preserve nesting under list items without triggering indented code block
        return '  ' + rest;
      }
    }
    return line;
  });
  protectedText = processedLines.join('\n');

  // 3. Fix unescaped backslashes that are followed by regular letters (but aren't real LaTeX commands)
  // This avoids KaTeX trying to interpret regular text containing \something (like \delocalized) as a math macro
  // Since we are running this ONLY on protectedText (which has all math blocks removed), this is completely safe!
  const validCommands = new Set([
    'frac', 'sqrt', 'sum', 'int', 'alpha', 'beta', 'theta', 'pi', 'sigma', 'lambda', 'delta', 'partial', 'infinity', 'infty', 'ge', 'le', 'ne', 'times', 'div', 'pm', 'mp', 'approx', 'equiv', 'cdots', 'dots', 'overline', 'underline', 'hat', 'bar', 'tilde', 'vec', 'text', 'left', 'right', 'begin', 'end', 'align', 'aligned', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'cases', 'del', 'nabla', 'degree', 'sin', 'cos', 'tan', 'log', 'ln', 'lim', 'micro', 'mu', 'rho', 'phi', 'psi', 'omega', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'iota', 'kappa', 'nu', 'xi', 'omicron', 'tau', 'upsilon', 'chi', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega', 'cdot', 'tag', 'limits', 'varepsilon',
    'rightarrow', 'leftarrow', 'to', 'leftrightarrow', 'Rightarrow', 'Leftarrow', 'Leftrightarrow', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathcal', 'mathbb', 'mathfrak', 'ce', 'deg', 'leq', 'geq', 'neq', 'cong', 'propto', 'sim', 'subset', 'supset', 'subseteq', 'supseteq', 'in', 'ni', 'notin',
    'cup', 'cap', 'forall', 'exists', 'implies', 'iff', 'varnothing', 'emptyset', 'setminus', 'displaystyle'
  ]);

  protectedText = protectedText.replace(/\\([a-zA-Z]+)/g, (match, word) => {
    if (validCommands.has(word.toLowerCase())) {
      return match; // Keep valid LaTeX command
    }
    return word; // Strip backslash from regular word (e.g., \delocalized -> delocalized)
  });

  // For cases outside of math blocks that look exactly like interval notation (e.g. )cup( or ) cup ( )
  protectedText = protectedText.replace(/(?<=[)\]])\s*(cup|cap)\s*(?=[([\]])/gi, (match, p1) => {
    return p1.toLowerCase() === 'cup' ? '\\cup' : '\\cap';
  });

  // 4. Restore the math blocks and apply math-specific corrections inside them
  let restored = protectedText;
  for (let i = 0; i < mathBlocks.length; i++) {
    restored = restored.replace(`__MATH_BLOCK_PLACEHOLDER_${i}__`, () => {
      const mathContent = mathBlocks[i];
      
      // Perform math-specific improvements inside the math blocks
      // A. Convert any mistakenly stripped keywords or unescaped keywords inside math block back to LaTeX commands
      const mathKeywords = [
        'cup', 'cap', 'subset', 'supset', 'subseteq', 'supseteq', 'in', 'notin', 
        'setminus', 'emptyset', 'varnothing', 'infty', 'forall', 'exists', 
        'implies', 'iff', 'to', 'le', 'leq', 'ge', 'geq', 'ne', 'neq', 
        'approx', 'times', 'pm', 'div', 'cdot', 'alpha', 'beta', 'gamma', 
        'delta', 'theta', 'omega', 'pi', 'sigma', 'mu', 'lambda', 'tau', 
        'phi', 'psi', 'varepsilon', 'varphi', 'limits', 'tag', 'vec', 'hat'
      ];

      const isBlock = mathContent.startsWith('$$');
      let inner = isBlock ? mathContent.slice(2, -2) : mathContent.slice(1, -1);
      
      inner = inner.trim();
      if (inner.endsWith('\\') && !inner.endsWith('\\\\')) {
        inner = inner.slice(0, -1);
      }
      
      let fixedInner = inner;
      
      // Fix infinity -> infty
      fixedInner = fixedInner.replace(/\\?infinity\b/gi, 'infty');
      
      // Heuristic: If it looks like a runaway math block that consumed plain text, don't fix keywords
      const stripped = fixedInner.replace(/\\(text|mathrm|textbf|textit)\{.*?\}/g, '');
      const words = stripped.match(/(?<!\\)[a-zA-Z]{3,}/g) || [];
      const isRunaway = words.length >= 3 && !isBlock;
      
      if (isRunaway) {
        // Runaway block! Return as regular prose (no math delimiters).
        // Un-escape incorrectly escaped english words that might have been saved in the DB
        fixedInner = fixedInner.replace(/\\(in|to|cap|cup|times|pm|div|cdot|hat|vec|text)\b/gi, '$1');
        // Fix escaped spaces like E\ 
        fixedInner = fixedInner.replace(/\\\s/g, ' ');
        // Strip trailing backslash if any
        if (fixedInner.endsWith('\\')) fixedInner = fixedInner.slice(0, -1);
        return fixedInner;
      }

      // Fix unescaped keywords in math block
      for (const kw of mathKeywords) {
        const regex = new RegExp(`(?<!\\\\)\\b${kw}\\b`, 'g');
        fixedInner = fixedInner.replace(regex, `\\${kw}`);
      }
      
      // Ensure standard limits usage for sum, int, prod inside display math block
      fixedInner = fixedInner.replace(/\\?sum_?limits/g, '\\sum\\limits');
      fixedInner = fixedInner.replace(/\\?int_?limits/g, '\\int\\limits');
      fixedInner = fixedInner.replace(/\\?prod_?limits/g, '\\prod\\limits');

      // Fix equation tags like tag1, tag2 -> \tag{1}, \tag{2}
      fixedInner = fixedInner.replace(/\btag\s*(\d+)\b/g, '\\tag{$1}');

      return isBlock ? `$$${fixedInner}$$` : `$${fixedInner}$`;
    });
  }

  // 5. Convert any mistakenly wrapped single-line paragraphs from math formatting to normal text
  // If a block $ ... $ has 3 or more spaces, and lacks clear mathematical characters/indicators, strip the outer dollar signs.
  restored = restored.replace(/\$([^$\n]+)\$/g, (match, p1) => {
    const trimmed = p1.trim();
    const spaceCount = (trimmed.match(/\s+/g) || []).length;
    const hasMathSymbols = /([=+\-*/^_{}\\]|\\frac|\\sqrt|\\sum|\\int|\\alpha|\\beta|\\theta|\\pi|\\sigma|\\lambda|\\delta|\\partial|\\infty|\\ge|\\le|\\ne|\\cdot|\\times)/.test(trimmed);
    
    if (spaceCount >= 3 && !hasMathSymbols) {
      return trimmed;
    }
    return match;
  });

  restored = restored.replace(/\$\$([^$\n]+)\$\$/g, (match, p1) => {
    const trimmed = p1.trim();
    const spaceCount = (trimmed.match(/\s+/g) || []).length;
    const hasMathSymbols = /([=+\-*/^_{}\\]|\\frac|\\sqrt|\\sum|\\int|\\alpha|\\beta|\\theta|\\pi|\\sigma|\\lambda|\\delta|\\partial|\\infty|\\ge|\\le|\\ne|\\cdot|\\times)/.test(trimmed);
    
    if (spaceCount >= 3 && !hasMathSymbols) {
      return trimmed;
    }
    return match;
  });

  return restored;
}

export default function MarkdownRenderer({ content = '', className = '' }: MarkdownRendererProps) {
  const preprocessedContent = fixMarkdownTables(preprocessMarkdownContent(content));

  return (
    <div className={`prose prose-slate dark:prose-invert max-w-none markdown-body ${className}`}>
      <MathErrorBoundary fallback={<div className="whitespace-pre-wrap font-mono text-sm opacity-80">{content}</div>}>
        <Markdown 
          children={preprocessedContent}
          remarkPlugins={[[remarkMath, { singleDollarTextMath: true }], remarkGfm]} 
          rehypePlugins={[
            [rehypeKatex, { throwOnError: false }],
            [rehypeHighlight, { ignoreMissing: true }]
          ]}
          components={{
            table: ({ node, ...props }) => (
              <div className="my-6 w-full overflow-x-auto rounded-3xl border border-slate-200 dark:border-zinc-800 shadow-sm scrollbar-hide">
                <table className="w-full text-left border-collapse text-sm text-slate-600 dark:text-zinc-300" {...props} />
              </div>
            ),
            thead: ({ node, ...props }) => (
              <thead className="bg-slate-50 dark:bg-zinc-800/40 border-b border-slate-200 dark:border-zinc-800 font-semibold text-slate-900 dark:text-white uppercase text-xs tracking-wider" {...props} />
            ),
            tbody: ({ node, ...props }) => (
              <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/40" {...props} />
            ),
            tr: ({ node, ...props }) => (
              <tr className="hover:bg-slate-50/50 dark:hover:bg-zinc-800/10 transition-colors" {...props} />
            ),
            th: ({ node, ...props }) => (
              <th className="px-5 py-3.5 font-semibold text-slate-800 dark:text-zinc-200" {...props} />
            ),
            td: ({ node, ...props }) => (
              <td className="px-5 py-3.5 text-slate-600 dark:text-zinc-400 font-medium" {...props} />
            ),
            pre: ({ node, children, className }: any) => {
              return <div className={`not-prose my-4 ${className || ''}`}>{children}</div>;
            },
            code: ({ node, inline, className, children, ...props }: any) => {
              const isInline = inline || (!className && !String(children).includes('\n'));
              const match = /language-(\w+)/.exec(className || '');
              const lang = match ? match[1].toLowerCase() : '';
              const codeString = String(children).replace(/\n$/, '');

              if (!isInline && lang === 'mermaid') {
                return (
                  <Suspense fallback={<div className="p-4 text-xs font-mono text-slate-400">Loading diagram...</div>}>
                    <MermaidViewer chart={codeString} />
                  </Suspense>
                );
              }

              if (!isInline && (lang === 'function-plot' || lang === 'math-plot' || lang === 'graph')) {
                return (
                  <Suspense fallback={<div className="p-4 text-xs font-mono text-slate-400">Loading plot...</div>}>
                    <FunctionPlotViewer code={codeString} />
                  </Suspense>
                );
              }

              if (!isInline && (lang === 'venn' || lang === 'venn-diagram' || lang === 'set-diagram' || lang === 'venndiagram')) {
                return (
                  <Suspense fallback={<div className="p-4 text-xs font-mono text-slate-400">Loading diagram...</div>}>
                    <VennDiagramViewer code={codeString} />
                  </Suspense>
                );
              }

              if (isInline) {
                return (
                  <code className="bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-200 px-1.5 py-0.5 rounded-md text-xs sm:text-sm font-mono border border-slate-200/60 dark:border-zinc-700/60 font-normal" {...props}>
                    {children}
                  </code>
                );
              }

              return (
                <div className="relative my-4 overflow-x-auto rounded-2xl bg-slate-900 dark:bg-zinc-900/90 p-4 border border-slate-800 text-slate-100 font-mono text-xs sm:text-sm leading-relaxed shadow-sm">
                  <code className={`bg-transparent text-slate-100 p-0 border-none font-mono text-xs sm:text-sm ${className || ''}`} {...props}>
                    {children}
                  </code>
                </div>
              );
            },
          }}
        />
      </MathErrorBoundary>
    </div>
  );
}
