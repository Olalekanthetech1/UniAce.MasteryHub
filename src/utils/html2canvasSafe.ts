import html2canvas, { Options as Html2CanvasOptions } from 'html2canvas';

const MODERN_COLOR_FN_REGEX = /\b(oklab|oklch|lab|lch|color-mix|color)\s*\(/i;
const GRADIENT_COLOR_SPACE_REGEX =
  /\s+in\s+(?:oklab|oklch|srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65|hsl|hwb|lch|lab)(?:\s+(?:shorter|longer|increasing|decreasing)\s+hue)?/gi;

let colorProbeCtx: CanvasRenderingContext2D | null = null;
const colorCache = new Map<string, string>();

function getColorProbeContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!colorProbeCtx) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    colorProbeCtx = canvas.getContext('2d', { willReadFrequently: true });
  }
  return colorProbeCtx;
}

/**
 * Converts a single CSS color expression (e.g. `oklab(...)`, `oklch(...)`, `color-mix(...)`)
 * to a standard `rgb(...)` or `rgba(...)` string by rasterizing a 1x1 pixel on an offscreen canvas.
 */
function convertSingleColorFunctionToRgb(expr: string): string {
  const trimmed = expr.trim();
  const cached = colorCache.get(trimmed);
  if (cached) return cached;

  const ctx = getColorProbeContext();
  if (!ctx) return 'rgb(15, 23, 42)';

  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    ctx.fillStyle = trimmed;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    const r = data[0];
    const g = data[1];
    const b = data[2];
    const a = data[3];

    let result: string;
    if (a === 0 && !trimmed.includes('/ 0') && !trimmed.includes('/0')) {
      result = 'rgba(0, 0, 0, 0)';
    } else if (a === 255) {
      result = `rgb(${r}, ${g}, ${b})`;
    } else {
      result = `rgba(${r}, ${g}, ${b}, ${ Number((a / 255).toFixed(3)) })`;
    }

    colorCache.set(trimmed, result);
    return result;
  } catch {
    return 'rgb(15, 23, 42)';
  }
}

/**
 * Replaces all balanced `oklab(...)`, `oklch(...)`, `lab(...)`, `lch(...)`, `color-mix(...)`,
 * and `color(...)` calls inside an arbitrary CSS property value or stylesheet string,
 * and strips CSS Color 4 gradient interpolation tokens (such as `in oklab`).
 */
export function sanitizeCssColorString(input: string): string {
  if (!input || typeof input !== 'string') return input;

  let working = input;
  if (working.includes('in oklab') || working.includes('in oklch') || working.includes('in srgb')) {
    working = working.replace(GRADIENT_COLOR_SPACE_REGEX, '');
  }

  if (!MODERN_COLOR_FN_REGEX.test(working)) {
    return working;
  }

  let output = '';
  let cursor = 0;
  const len = working.length;

  while (cursor < len) {
    const rest = working.slice(cursor);
    const match = MODERN_COLOR_FN_REGEX.exec(rest);
    if (!match || match.index === undefined) {
      output += rest;
      break;
    }

    const fnStart = cursor + match.index;
    output += working.slice(cursor, fnStart);

    const openParenIdx = working.indexOf('(', fnStart);
    if (openParenIdx === -1) {
      output += working.slice(fnStart);
      break;
    }

    let depth = 0;
    let endIdx = openParenIdx;
    for (; endIdx < len; endIdx++) {
      const ch = working[endIdx];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          endIdx++;
          break;
        }
      }
    }

    const fullFnCall = working.slice(fnStart, endIdx);
    output += convertSingleColorFunctionToRgb(fullFnCall);
    cursor = endIdx;
  }

  return output;
}

const COLOR_STYLE_PROPERTIES = [
  'color',
  'backgroundColor',
  'backgroundImage',
  'background',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderColor',
  'outlineColor',
  'textDecorationColor',
  'columnRuleColor',
  'boxShadow',
  'textShadow',
  'fill',
  'stroke',
  'stopColor',
  'floodColor',
  'lightingColor',
  'caretColor',
  'accentColor',
  'webkitTextFillColor',
  'webkitTextStrokeColor',
] as const;

function wrapGetComputedStyle(targetWindow: Window & typeof globalThis): () => void {
  const originalGetComputedStyle = targetWindow.getComputedStyle.bind(targetWindow);

  const patchedGetComputedStyle = function (
    elt: Element,
    pseudoElt?: string | null
  ): CSSStyleDeclaration {
    const rawStyle = originalGetComputedStyle(elt, pseudoElt);
    return new Proxy(rawStyle, {
      get(target, prop) {
        if (prop === 'getPropertyValue') {
          return (propName: string) => {
            const val = target.getPropertyValue(propName);
            return typeof val === 'string' ? sanitizeCssColorString(val) : val;
          };
        }
        const value = Reflect.get(target, prop, target);
        if (typeof value === 'function') {
          return value.bind(target);
        }
        if (typeof value === 'string') {
          return sanitizeCssColorString(value);
        }
        return value;
      },
    });
  };

  targetWindow.getComputedStyle = patchedGetComputedStyle as typeof window.getComputedStyle;

  return () => {
    targetWindow.getComputedStyle = originalGetComputedStyle;
  };
}

function sanitizeClonedDocument(clonedDoc: Document): void {
  // 1. Sanitize all <style> tags in the cloned document
  const styleTags = clonedDoc.querySelectorAll('style');
  styleTags.forEach((styleEl) => {
    if (styleEl.textContent) {
      styleEl.textContent = sanitizeCssColorString(styleEl.textContent);
    }
  });

  // 2. Sanitize inline style attributes and computed color properties on all cloned elements
  const win = clonedDoc.defaultView || window;
  const allElements: Element[] = [
    clonedDoc.documentElement,
    clonedDoc.body,
    ...Array.from(clonedDoc.querySelectorAll('*')),
  ].filter(Boolean);

  for (const el of allElements) {
    const htmlEl = el as HTMLElement;
    if (!htmlEl.style) continue;

    const inlineStyleAttr = htmlEl.getAttribute('style');
    if (inlineStyleAttr && MODERN_COLOR_FN_REGEX.test(inlineStyleAttr)) {
      htmlEl.setAttribute('style', sanitizeCssColorString(inlineStyleAttr));
    }

    try {
      const computed = win.getComputedStyle(el);
      for (const prop of COLOR_STYLE_PROPERTIES) {
        const rawVal = (computed as any)[prop];
        if (
          typeof rawVal === 'string' &&
          (MODERN_COLOR_FN_REGEX.test(rawVal) ||
            rawVal.includes('in oklab') ||
            rawVal.includes('in oklch'))
        ) {
          (htmlEl.style as any)[prop] = sanitizeCssColorString(rawVal);
        }
      }
    } catch {
      // Ignore inaccessible pseudo/detached nodes
    }
  }
}

/**
 * Safely renders a DOM element to an HTMLCanvasElement via `html2canvas`
 * while converting all CSS Color 4 functions (`oklab`, `oklch`, `lab`, `lch`, `color-mix`, `color`)
 * and gradient color-space interpolations (`in oklab`) into standard sRGB `rgb()`/`rgba()` values.
 */
export async function renderElementToCanvasSafe(
  element: HTMLElement,
  options: Partial<Html2CanvasOptions> = {}
): Promise<HTMLCanvasElement> {
  const restoreMainWindow = wrapGetComputedStyle(window);
  let restoreClonedWindow: (() => void) | null = null;

  const userOnClone = options.onclone;

  try {
    return await html2canvas(element, {
      ...options,
      onclone: (clonedDoc, clonedElement) => {
        if (clonedDoc.defaultView && clonedDoc.defaultView !== window) {
          restoreClonedWindow = wrapGetComputedStyle(
            clonedDoc.defaultView as Window & typeof globalThis
          );
        }
        sanitizeClonedDocument(clonedDoc);
        if (userOnClone) {
          userOnClone(clonedDoc, clonedElement);
        }
      },
    });
  } finally {
    if (restoreClonedWindow) {
      (restoreClonedWindow as () => void)();
    }
    restoreMainWindow();
  }
}
