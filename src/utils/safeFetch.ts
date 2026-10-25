/**
 * Safe fetch utility that guards against server warmup/cold-start HTML responses.
 * Prevents "Unexpected token '<', '<!doctype ' is not valid JSON" errors.
 */

export interface SafeFetchResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  isHtmlFallback?: boolean;
}

export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<SafeFetchResult<T>> {
  try {
    const res = await fetch(input, init);
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.toLowerCase().includes('application/json');

    if (!isJson) {
      // Server returned HTML (e.g. Render warming up, cold start, or SPA fallback)
      return {
        ok: false,
        status: res.status,
        data: null,
        error: 'Server warming up or returned non-JSON response',
        isHtmlFallback: true
      };
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      return {
        ok: false,
        status: res.status,
        data: null,
        error: errBody?.error || errBody?.message || `HTTP ${res.status}`
      };
    }

    const data = await res.json();
    return {
      ok: true,
      status: res.status,
      data
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err?.message || 'Network error'
    };
  }
}
