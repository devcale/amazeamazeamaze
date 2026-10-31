import type { SoundEntry } from '../types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init: RequestInit = {}, timeoutMs = 6000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      /* sin cuerpo */
    }
    if (!res.ok) {
      throw new ApiError(res.status, String(data.error ?? 'HTTP_' + res.status), String(data.message ?? res.statusText));
    }
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === 'AbortError') throw new ApiError(0, 'TIMEOUT', 'El servidor no respondió a tiempo.');
    throw new ApiError(0, 'NETWORK', 'Sin conexión con el servidor.');
  } finally {
    clearTimeout(t);
  }
}

export const api = {
  sounds: () => request<{ sounds: SoundEntry[] }>('/api/sounds'),
  network: () => request<{ port: number; publicBaseUrl: string | null; addresses: { name: string; address: string }[] }>('/api/network'),
  createSession: (resume?: { sessionId: string; consoleSecret: string; token: string }) =>
    request<{ sessionId: string; token: string; consoleSecret: string; resumed: boolean }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(resume ?? {}),
    }),
  rotateToken: (sessionId: string, consoleSecret: string) =>
    request<{ token: string }>(`/api/sessions/${sessionId}/rotate-token`, { method: 'POST', body: JSON.stringify({ consoleSecret }) }),
  sessionStatus: (sessionId: string, token: string) =>
    request<{ consoleOnline: boolean; remotes: number }>(`/api/sessions/${sessionId}`, { headers: { authorization: `Bearer ${token}` } }),
  play: (sessionId: string, token: string, soundId: string, commandId: string) =>
    request<{ accepted: boolean; duplicate: boolean; commandId: string }>(`/api/sessions/${sessionId}/play`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ soundId, commandId }),
    }),
  stop: (sessionId: string, token: string, commandId: string) =>
    request<{ accepted: boolean; duplicate: boolean; commandId: string }>(`/api/sessions/${sessionId}/stop`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ commandId }),
    }),
};
