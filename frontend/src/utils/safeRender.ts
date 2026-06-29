/** Safely coerce API/Excel values for JSX text nodes and template literals. */

export function safeStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (val instanceof Date) return val.toLocaleDateString();
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return '[object]';
    }
  }
  return String(val);
}

export function safeNum(val: unknown): number {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
}

export function safeArr<T = unknown>(val: unknown): T[] {
  return Array.isArray(val) ? (val as T[]) : [];
}

/** Parse FastAPI / fetch error bodies into a display string. */
export function apiErrorMessage(err: unknown, fallback = 'Request failed'): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const detail = (err as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          if (item && typeof item === 'object' && 'msg' in item) {
            return safeStr((item as { msg: unknown }).msg);
          }
          return safeStr(item);
        })
        .filter(Boolean)
        .join('; ') || fallback;
    }
    if (detail && typeof detail === 'object') return safeStr(detail);
    if ('message' in err && typeof (err as { message: unknown }).message === 'string') {
      return (err as { message: string }).message;
    }
  }
  return fallback;
}
