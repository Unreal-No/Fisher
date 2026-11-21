// Fetch wrapper: cookie session + CSRF header, typed errors in Thai.
import type { ApiErrorBody } from '@fisher/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string[]>,
    public details?: unknown,
  ) {
    super(message);
  }
}

const csrf = () => document.cookie.match(/(?:^|; )fcsrf=([^;]+)/)?.[1] ?? '';
type Params = Record<string, string | number | boolean | null | undefined>;

export function qs(params?: Params) {
  if (!params) return '';
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}

async function request<T>(method: string, path: string, body?: unknown, extra?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-csrf-token': decodeURIComponent(csrf()) } : {}),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      ...extra,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ (ออฟไลน์?)');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error;
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? `เกิดข้อผิดพลาด (${res.status})`, e?.fieldErrors, e?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, params?: Params) => request<T>('GET', path + qs(params)),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: (file: File, sensitivity: 'INTERNAL' | 'CONFIDENTIAL' | 'PERSONAL' = 'INTERNAL') => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ id: string; fileName: string; mimeType: string; sizeBytes: number }>('POST', `/files${qs({ sensitivity })}`, fd);
  },
};
export const fileUrl = (id: string) => `/api/v1/files/${id}`;
