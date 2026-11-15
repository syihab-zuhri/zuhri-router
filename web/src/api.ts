export class ApiError extends Error {
  code: string;
  status: number;
  retryAfter: string | null;
  constructor(code: string, status: number, retryAfter: string | null = null) {
    super(code); this.code = code; this.status = status; this.retryAfter = retryAfter;
  }
}
type Options = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal };
export async function api<T>(path: string, options: Options = {}, fetcher: typeof fetch = fetch): Promise<T> {
  if (!/^\/(api|admin\/api)\//.test(path)) throw new ApiError('invalid_path', 0);
  const method = options.method ?? 'GET';
  let response: Response;
  try {
    response = await fetcher(path, { method, credentials: 'same-origin', cache: 'no-store', signal: options.signal,
      headers: { accept: 'application/json', ...(method !== 'GET' ? { 'x-router-csrf': '1', 'content-type': 'application/json' } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('network_unknown', 0);
  }
  const data: unknown = await response.json().catch(() => { throw new ApiError('invalid_response', response.status); });
  if (!response.ok) {
    const code = data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'code' in data.error && typeof data.error.code === 'string' ? data.error.code : 'internal_error';
    throw new ApiError(code, response.status, response.headers.get('retry-after'));
  }
  return data as T;
}
export const post = <T,>(path: string, body: unknown): Promise<T> => api<T>(path, { method: 'POST', body });
export const newIdempotencyKey = (): string => crypto.randomUUID();
