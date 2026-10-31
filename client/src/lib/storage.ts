export interface StoredSession {
  sessionId: string;
  token: string;
  consoleSecret: string;
}

const KEY = 'xeno.console.session';
const BASE_KEY = 'xeno.console.baseHost';
const VOL_KEY = 'xeno.console.volume';

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (s.sessionId && s.token && s.consoleSecret) return s;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveSession(s: StoredSession) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

export function loadBaseHost(): string | null {
  return localStorage.getItem(BASE_KEY);
}

export function saveBaseHost(v: string | null) {
  if (v) localStorage.setItem(BASE_KEY, v);
  else localStorage.removeItem(BASE_KEY);
}

export function loadVolume(): number {
  const v = Number(localStorage.getItem(VOL_KEY));
  return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0.9;
}

export function saveVolume(v: number) {
  localStorage.setItem(VOL_KEY, String(v));
}
