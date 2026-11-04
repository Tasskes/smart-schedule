import { createStore } from './db/store';

export const LOCAL_TOKEN = 'local';

export const authStore = createStore<{ token: string | null; ready: boolean }>({ token: null, ready: false });
export const netStore = createStore<{ online: boolean; serverReachable: boolean | null }>({
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  serverReachable: null,
});

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => netStore.set({ online: true }));
  window.addEventListener('offline', () => netStore.set({ online: false, serverReachable: false }));
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function isLocalMode() {
  return authStore.get().token === LOCAL_TOKEN;
}

export function hasServer() {
  const t = authStore.get().token;
  return !!t && t !== LOCAL_TOKEN;
}

let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(fn: () => void) {
  unauthorizedHandler = fn;
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number; auth?: boolean } = {},
): Promise<T> {
  const token = authStore.get().token;
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && token && token !== LOCAL_TOKEN) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000);
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } catch (e) {
    netStore.set({ serverReachable: false });
    if ((e as Error).name === 'AbortError') throw new ApiError(0, 'Сервер не ответил вовремя');
    throw new ApiError(0, 'Нет связи с сервером');
  } finally {
    clearTimeout(timer);
  }
  netStore.set({ serverReachable: true, online: true });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 300) };
  }
  if (res.status === 401 && opts.auth !== false) {
    unauthorizedHandler?.();
    throw new ApiError(401, 'Нужно войти заново');
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error || `Ошибка сервера (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export interface ServerStatus {
  ok: boolean;
  group: string;
  schedule: { fetchedAt: number | null; error: string | null; count: number } | null;
  ai: {
    provider: string;
    configured: boolean;
    model?: string;
    modelFast?: string;
    usage: { model: string; input: number; output: number; calls: number }[];
  };
  push: { publicKey: string; subscriptions: number };
  calendarPath: string;
  publicUrl: string | null;
  serverTime: number;
}

export const statusStore = createStore<{ status: ServerStatus | null; error: string | null }>({ status: null, error: null });

export async function loadStatus() {
  if (!hasServer()) return null;
  try {
    const status = await api<ServerStatus>('/api/status');
    statusStore.set({ status, error: null });
    return status;
  } catch (e) {
    statusStore.set({ error: (e as Error).message });
    return null;
  }
}

/** Файл с сервера (картинки-вложения) — с авторизацией, как blob */
export async function apiBlob(path: string): Promise<Blob> {
  const token = authStore.get().token;
  const res = await fetch(path, { headers: token && token !== LOCAL_TOKEN ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'Файл недоступен');
  return res.blob();
}
