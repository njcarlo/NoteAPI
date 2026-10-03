import type { ApiErrorBody, ErrorCode } from '@clinic/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** Field-level messages keyed by dotted path, for mapping onto form fields. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      (this.details as { path: string[]; message: string }[]).map((d) => [
        d.path.join('.'),
        d.message,
      ]),
    );
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};

let onUnauthenticated: (() => void) | null = null;
export const setUnauthenticatedHandler = (handler: () => void) => {
  onUnauthenticated = handler;
};

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const body = (data as ApiErrorBody | null)?.error;
    if (res.status === 401 && path !== '/auth/login') onUnauthenticated?.();
    throw new ApiError(
      res.status,
      body?.code ?? 'INTERNAL_ERROR',
      body?.message ?? 'Request failed',
      body?.details,
    );
  }
  return data as T;
}

export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;
