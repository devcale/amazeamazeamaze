import { randomBytes } from 'node:crypto';
import type { ConsoleState } from './types.js';

export interface Session {
  id: string;
  /** Token que viaja en el QR; autoriza al mando. */
  token: string;
  /** Secreto que solo conoce la consola; autoriza a registrarse como reproductor. */
  consoleSecret: string;
  consoleSocketId: string | null;
  state: ConsoleState | null;
  remotes: Set<string>;
  seen: Set<string>;
  seenOrder: string[];
  createdAt: number;
  lastActivity: number;
}

const MAX_SEEN = 500;
const ID_RE = /^[a-f0-9]{8,64}$/;

const sessions = new Map<string, Session>();

export function rid(bytes = 8): string {
  return randomBytes(bytes).toString('hex');
}

export function isValidId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v);
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function createSession(fixed?: { id: string; token: string; consoleSecret: string }): Session {
  const s: Session = {
    id: fixed?.id ?? rid(6),
    token: fixed?.token ?? rid(12),
    consoleSecret: fixed?.consoleSecret ?? rid(24),
    consoleSocketId: null,
    state: null,
    remotes: new Set(),
    seen: new Set(),
    seenOrder: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  sessions.set(s.id, s);
  return s;
}

export function rotateToken(s: Session): string {
  s.token = rid(12);
  s.lastActivity = Date.now();
  return s.token;
}

/** Devuelve true si la orden ya se había visto (duplicada). */
export function markCommand(s: Session, commandId: string): boolean {
  if (s.seen.has(commandId)) return true;
  s.seen.add(commandId);
  s.seenOrder.push(commandId);
  if (s.seenOrder.length > MAX_SEEN) {
    const old = s.seenOrder.shift();
    if (old) s.seen.delete(old);
  }
  s.lastActivity = Date.now();
  return false;
}

export function publicStatus(s: Session) {
  return {
    sessionId: s.id,
    consoleOnline: s.consoleSocketId !== null,
    remotes: s.remotes.size,
    state: s.state,
  };
}

/** Limpieza: sesiones sin consola ni mandos durante 24 h. */
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, s] of sessions) {
    if (!s.consoleSocketId && s.remotes.size === 0 && s.lastActivity < cutoff) sessions.delete(id);
  }
}, 60 * 60 * 1000).unref();
