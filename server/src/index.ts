import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { Server as IOServer, type Socket } from 'socket.io';
import { loadCatalog, findSound, CLIENT_DIST, AUDIO_DIR, CATALOG_FILE } from './catalog.js';
import {
  createSession,
  getSession,
  isValidId,
  markCommand,
  publicStatus,
  rotateToken,
  type Session,
} from './sessions.js';
import { lanAddresses } from './network.js';
import type { CommandResult, ConsoleState, PlayCommand, StopCommand } from './types.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? null;

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  // mismo origen en uso normal (dev usa proxy de Vite); no se habilita CORS abierto
  pingInterval: 3000,
  pingTimeout: 5000,
});

app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));

// --- helpers --------------------------------------------------------------

const remoteRoom = (sessionId: string) => `remotes:${sessionId}`;

function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ ok: false, error: code, message });
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

function broadcastStatus(s: Session) {
  io.to(remoteRoom(s.id)).emit('session:status', publicStatus(s));
  if (s.consoleSocketId) io.to(s.consoleSocketId).emit('session:remotes', { count: s.remotes.size });
}

/** Autoriza una petición del mando: sesión existente y token correcto. */
function authRemote(req: Request, res: Response): Session | null {
  const { sessionId } = req.params;
  if (!isValidId(sessionId)) {
    fail(res, 400, 'BAD_SESSION_ID', 'Identificador de sesión inválido.');
    return null;
  }
  const s = getSession(sessionId);
  const token = bearer(req) ?? (typeof req.body?.token === 'string' ? req.body.token : null);
  if (!s || !token || token !== s.token) {
    fail(res, 403, 'INVALID_TOKEN', 'Sesión o token inválido. Escanea de nuevo el QR de la consola.');
    return null;
  }
  return s;
}

function consoleGate(s: Session, res: Response): boolean {
  if (!s.consoleSocketId) {
    fail(res, 503, 'CONSOLE_OFFLINE', 'La consola del computador no está conectada.');
    return false;
  }
  if (!s.state?.audioReady) {
    fail(res, 409, 'AUDIO_NOT_READY', 'El audio del computador no está activado. Pulsa "Activar audio" en la consola.');
    return false;
  }
  return true;
}

// --- API ------------------------------------------------------------------

app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.get('/api/sounds', (_req, res) => {
  res.json({ ok: true, sounds: loadCatalog() });
});

app.get('/api/network', (_req, res) => {
  res.json({
    ok: true,
    port: PORT,
    publicBaseUrl: PUBLIC_BASE_URL,
    addresses: lanAddresses(),
  });
});

/**
 * Crea (o recupera) la sesión de la consola.
 * Body opcional { sessionId, consoleSecret, token }: si la consola ya tenía una sesión
 * (p. ej. tras reiniciar el servidor) la recrea con los mismos identificadores para que
 * el QR impreso/escaneado siga siendo válido. Sólo quien conoce consoleSecret puede hacerlo.
 */
app.post('/api/sessions', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { sessionId, consoleSecret, token } = body;
  if (isValidId(sessionId)) {
    const existing = getSession(sessionId);
    if (existing) {
      if (existing.consoleSecret !== consoleSecret) return fail(res, 403, 'FORBIDDEN', 'Secreto de consola incorrecto.');
      return res.json({ ok: true, sessionId: existing.id, token: existing.token, consoleSecret: existing.consoleSecret, resumed: true });
    }
    if (isValidId(consoleSecret) && isValidId(token)) {
      const s = createSession({ id: sessionId, consoleSecret, token });
      return res.json({ ok: true, sessionId: s.id, token: s.token, consoleSecret: s.consoleSecret, resumed: true, recreated: true });
    }
  }
  const s = createSession();
  res.status(201).json({ ok: true, sessionId: s.id, token: s.token, consoleSecret: s.consoleSecret, resumed: false });
});

/** Estado público de la sesión (el mando lo usa para validar el enlace antes de conectar). */
app.get('/api/sessions/:sessionId', (req, res) => {
  const s = authRemote(req, res);
  if (!s) return;
  res.json({ ok: true, ...publicStatus(s) });
});

/** Regenera el token del QR y expulsa los mandos actuales. Requiere consoleSecret. */
app.post('/api/sessions/:sessionId/rotate-token', (req, res) => {
  const { sessionId } = req.params;
  const s = isValidId(sessionId) ? getSession(sessionId) : undefined;
  if (!s || s.consoleSecret !== req.body?.consoleSecret) return fail(res, 403, 'FORBIDDEN', 'No autorizado.');
  const token = rotateToken(s);
  io.to(remoteRoom(s.id)).emit('session:revoked', { reason: 'TOKEN_ROTATED' });
  io.in(remoteRoom(s.id)).disconnectSockets(true);
  s.remotes.clear();
  broadcastStatus(s);
  res.json({ ok: true, token });
});

app.post('/api/sessions/:sessionId/play', (req, res) => {
  const s = authRemote(req, res);
  if (!s) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { soundId, commandId } = body;
  if (!isValidId(commandId)) return fail(res, 400, 'BAD_COMMAND_ID', 'commandId inválido.');
  if (typeof soundId !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(soundId)) return fail(res, 400, 'BAD_SOUND_ID', 'soundId inválido.');
  const sound = findSound(soundId);
  if (!sound) return fail(res, 404, 'UNKNOWN_SOUND', 'Ese sonido no existe en el catálogo.');
  if (!consoleGate(s, res)) return;
  const st = s.state?.sounds?.[soundId];
  if (st === 'missing' || st === 'error') return fail(res, 409, 'SOUND_UNAVAILABLE', `"${sound.name}" no está disponible en la consola (archivo ausente o no decodificable).`);
  if (markCommand(s, commandId)) return res.status(200).json({ ok: true, accepted: true, duplicate: true, commandId });

  const cmd: PlayCommand = { commandId, soundId, source: 'remote', issuedAt: Date.now() };
  io.to(s.consoleSocketId!).emit('command:play', cmd);
  res.status(202).json({ ok: true, accepted: true, duplicate: false, commandId });
});

app.post('/api/sessions/:sessionId/stop', (req, res) => {
  const s = authRemote(req, res);
  if (!s) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { commandId } = body;
  if (!isValidId(commandId)) return fail(res, 400, 'BAD_COMMAND_ID', 'commandId inválido.');
  if (!s.consoleSocketId) return fail(res, 503, 'CONSOLE_OFFLINE', 'La consola del computador no está conectada.');
  if (markCommand(s, commandId)) return res.status(200).json({ ok: true, accepted: true, duplicate: true, commandId });
  const cmd: StopCommand = { commandId, source: 'remote', issuedAt: Date.now() };
  io.to(s.consoleSocketId).emit('command:stop', cmd);
  res.status(202).json({ ok: true, accepted: true, duplicate: false, commandId });
});

app.use('/api', (_req, res) => fail(res, 404, 'NOT_FOUND', 'Ruta no encontrada.'));

// --- Socket.IO ------------------------------------------------------------

interface SocketData {
  role: 'console' | 'remote';
  sessionId: string;
}

io.use((socket, next) => {
  const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
  const { role, sessionId } = auth;
  if (!isValidId(sessionId)) return next(new Error('INVALID_SESSION'));
  const s = getSession(sessionId);
  if (!s) return next(new Error('INVALID_SESSION'));
  if (role === 'console') {
    if (auth.consoleSecret !== s.consoleSecret) return next(new Error('FORBIDDEN'));
  } else if (role === 'remote') {
    if (auth.token !== s.token) return next(new Error('INVALID_SESSION'));
  } else {
    return next(new Error('BAD_ROLE'));
  }
  (socket.data as SocketData) = { role, sessionId };
  next();
});

io.on('connection', (socket: Socket) => {
  const { role, sessionId } = socket.data as SocketData;
  const s = getSession(sessionId);
  if (!s) return socket.disconnect(true);

  if (role === 'console') {
    // Único reproductor activo: si había otra consola en esta sesión, se reemplaza.
    if (s.consoleSocketId && s.consoleSocketId !== socket.id) {
      io.to(s.consoleSocketId).emit('console:replaced');
      io.sockets.sockets.get(s.consoleSocketId)?.disconnect(true);
    }
    s.consoleSocketId = socket.id;
    s.lastActivity = Date.now();
    socket.emit('session:remotes', { count: s.remotes.size });
    broadcastStatus(s);

    socket.on('console:state', (state: ConsoleState) => {
      if (!state || typeof state !== 'object') return;
      s.state = {
        audioReady: state.audioReady === true,
        volume: typeof state.volume === 'number' ? state.volume : 1,
        nowPlaying: state.nowPlaying ?? null,
        sounds: state.sounds && typeof state.sounds === 'object' ? state.sounds : {},
      };
      broadcastStatus(s);
    });

    socket.on('command:result', (r: CommandResult) => {
      if (!r || typeof r !== 'object' || !isValidId(r.commandId)) return;
      io.to(remoteRoom(s.id)).emit('command:result', r);
    });

    socket.on('disconnect', () => {
      if (s.consoleSocketId === socket.id) {
        s.consoleSocketId = null;
        // Sin consola nada puede estar sonando ni el audio estar listo.
        if (s.state) s.state = { ...s.state, nowPlaying: null, audioReady: false };
        // No se encolan órdenes: cualquier petición durante la caída se rechaza (503).
        broadcastStatus(s);
      }
    });
  } else {
    socket.join(remoteRoom(s.id));
    s.remotes.add(socket.id);
    socket.emit('session:status', publicStatus(s));
    broadcastStatus(s);
    socket.on('disconnect', () => {
      s.remotes.delete(socket.id);
      broadcastStatus(s);
    });
  }
});

// --- Frontend estático (producción) ---------------------------------------

const hasDist = fs.existsSync(path.join(CLIENT_DIST, 'index.html'));
if (hasDist) {
  app.use(express.static(CLIENT_DIST, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else {
  // En desarrollo Vite sirve el frontend; aquí sólo exponemos /audio por si se accede directo.
  app.use('/audio', express.static(AUDIO_DIR));
  app.get('/', (_req, res) => {
    res
      .type('text/plain')
      .send(
        'Servidor del soundboard activo.\nNo existe client/dist: ejecuta "npm run dev" (desarrollo, abre http://localhost:5173/console) o "npm start" (producción).',
      );
  });
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if ((err as { type?: string }).type === 'entity.parse.failed') return fail(res, 400, 'BAD_JSON', 'JSON inválido.');
  console.error(err);
  fail(res, 500, 'INTERNAL', 'Error interno.');
});

server.listen(PORT, HOST, () => {
  const cat = loadCatalog();
  console.log(`\n  XENOLINGUISTIC COMMUNICATION TERMINAL — servidor`);
  console.log(`  Escuchando en http://${HOST}:${PORT}  (${hasDist ? 'sirviendo client/dist' : 'modo desarrollo: usa Vite en :5173'})`);
  console.log(`  Catálogo: ${CATALOG_FILE} (${cat.length} sonidos, ${cat.filter((s) => !s.fileExists).length} sin archivo)`);
  const addrs = lanAddresses();
  if (addrs.length) {
    console.log('  Direcciones de red local:');
    for (const a of addrs) console.log(`    - http://${a.address}:${hasDist ? PORT : 5173}/console   (${a.name})`);
  }
  if (PUBLIC_BASE_URL) console.log(`  PUBLIC_BASE_URL=${PUBLIC_BASE_URL}`);
  console.log('');
});
