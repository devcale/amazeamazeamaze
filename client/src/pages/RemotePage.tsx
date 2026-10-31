import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { api, ApiError } from '../lib/api';
import { uid } from '../lib/ids';
import type { CommandResult, SessionStatus, SoundEntry } from '../types';
import { Lamp, Screws } from '../components/Panel';
import '../styles/remote.css';

type Stage = 'sending' | 'accepted' | 'playing' | 'stopped' | 'error' | 'noconfirm';

interface Cmd {
  id: string;
  soundId: string | null; // null = stop
  stage: Stage;
  message?: string;
  at: number;
}

type LinkState = 'connecting' | 'connected' | 'disconnected' | 'invalid';

const CONFIRM_TIMEOUT_MS = 4000;
const MAX_INVALID_RETRIES = 8;

const ERROR_TEXT: Record<string, string> = {
  CONSOLE_OFFLINE: 'La consola del computador no está conectada.',
  AUDIO_NOT_READY: 'El audio del computador no está activado.',
  SOUND_UNAVAILABLE: 'Ese sonido no está disponible en la consola.',
  SOUND_LOADING: 'El sonido aún se está cargando en la consola.',
  INVALID_TOKEN: 'Sesión inválida. Escanea de nuevo el QR.',
  UNKNOWN_SOUND: 'Sonido desconocido.',
  NETWORK: 'Sin conexión con el servidor.',
  TIMEOUT: 'El servidor no respondió.',
  NO_LINK: 'Sin enlace en tiempo real con el servidor.',
};

function errText(code: string, fallback?: string) {
  return ERROR_TEXT[code] ?? fallback ?? `Error (${code})`;
}

export function RemotePage() {
  const [params] = useSearchParams();
  const sessionId = params.get('s') ?? '';
  const token = params.get('t') ?? '';
  const linkOk = /^[a-f0-9]{8,64}$/.test(sessionId) && /^[a-f0-9]{8,64}$/.test(token);

  const [catalog, setCatalog] = useState<SoundEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [link, setLink] = useState<LinkState>('connecting');
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [cmds, setCmds] = useState<Cmd[]>([]);
  const [revoked, setRevoked] = useState(false);
  const [invalidRetries, setInvalidRetries] = useState(0);
  const [, force] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const timersRef = useRef<Map<string, number>>(new Map());

  const updateCmd = useCallback((id: string, patch: Partial<Cmd>) => {
    setCmds((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  // catálogo
  useEffect(() => {
    api
      .sounds()
      .then(({ sounds }) => setCatalog(sounds))
      .catch((e) => setCatalogError((e as Error).message));
  }, []);

  // socket
  useEffect(() => {
    if (!linkOk) return;
    const socket = io({ auth: { role: 'remote', sessionId, token }, reconnectionDelay: 500, reconnectionDelayMax: 3000, timeout: 5000 });
    socketRef.current = socket;
    let retries = 0;
    let retryTimer: number | undefined;

    socket.on('connect', () => {
      retries = 0;
      setInvalidRetries(0);
      setLink('connected');
    });
    socket.on('disconnect', () => {
      setLink((l) => (l === 'invalid' ? l : 'disconnected'));
    });
    socket.on('connect_error', (err) => {
      if (err.message === 'INVALID_SESSION' || err.message === 'FORBIDDEN' || err.message === 'BAD_ROLE') {
        setLink('invalid');
        // La consola puede estar restaurando la sesión tras un reinicio del servidor: reintentamos un rato.
        if (retries < MAX_INVALID_RETRIES) {
          retries += 1;
          setInvalidRetries(retries);
          retryTimer = window.setTimeout(() => socket.connect(), 4000);
        }
      } else {
        setLink('disconnected');
      }
    });
    socket.on('session:status', (s: SessionStatus) => setStatus(s));
    socket.on('session:revoked', () => {
      setRevoked(true);
      setLink('invalid');
    });
    socket.on('command:result', (r: CommandResult) => {
      const t = timersRef.current.get(r.commandId);
      if (t) {
        clearTimeout(t);
        timersRef.current.delete(r.commandId);
      }
      const stage: Stage = r.status === 'error' ? 'error' : r.status === 'stopped' ? 'stopped' : 'playing';
      updateCmd(r.commandId, { stage, message: r.error ? errText(r.error) : undefined });
    });

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [linkOk, sessionId, token, updateCmd]);

  // limpiar órdenes viejas y refrescar la UI (para que el resaltado expire)
  useEffect(() => {
    const i = window.setInterval(() => {
      setCmds((list) => list.filter((c) => Date.now() - c.at < 15000).slice(-30));
      force((n) => n + 1);
    }, 1000);
    return () => clearInterval(i);
  }, []);

  const consoleOnline = status?.consoleOnline ?? false;
  const audioReady = status?.state?.audioReady ?? false;
  const canSend = link === 'connected' && consoleOnline && audioReady;

  const send = useCallback(
    async (soundId: string | null) => {
      const id = uid();
      const at = Date.now();
      const fresh: Cmd = { id, soundId, stage: 'sending', at };
      setCmds((list) => [...list, fresh].slice(-30));
      if (link !== 'connected') {
        updateCmd(id, { stage: 'error', message: errText(link === 'invalid' ? 'INVALID_TOKEN' : 'NO_LINK') });
        return;
      }
      try {
        const r = soundId ? await api.play(sessionId, token, soundId, id) : await api.stop(sessionId, token, id);
        if (r.duplicate) return; // ya procesada; el resultado llegará (o llegó) por socket
        // La confirmación por socket puede adelantarse a la respuesta HTTP: sólo avanzamos si seguimos en "sending".
        setCmds((list) => list.map((c) => (c.id === id && c.stage === 'sending' ? { ...c, stage: 'accepted' } : c)));
        const t = window.setTimeout(() => {
          timersRef.current.delete(id);
          setCmds((list) => list.map((c) => (c.id === id && c.stage === 'accepted' ? { ...c, stage: 'noconfirm', message: 'Orden aceptada pero la consola no confirmó la reproducción.' } : c)));
        }, CONFIRM_TIMEOUT_MS);
        timersRef.current.set(id, t);
      } catch (err) {
        const e = err as ApiError;
        updateCmd(id, { stage: 'error', message: errText(e.code, e.message) });
        if (e.code === 'INVALID_TOKEN') setLink('invalid');
      }
    },
    [link, sessionId, token, updateCmd],
  );

  // Evita dobles disparos: sólo pointerdown (no click) + guarda por pointerId.
  const activePointers = useRef<Set<number>>(new Set());
  const press = (soundId: string | null) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (activePointers.current.has(e.pointerId)) return;
    activePointers.current.add(e.pointerId);
    const release = () => activePointers.current.delete(e.pointerId);
    e.currentTarget.addEventListener('pointerup', release, { once: true });
    e.currentTarget.addEventListener('pointercancel', release, { once: true });
    e.currentTarget.addEventListener('pointerleave', release, { once: true });
    if (navigator.vibrate) navigator.vibrate(10);
    void send(soundId);
  };
  const keyPress = (soundId: string | null) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.repeat) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void send(soundId);
    }
  };

  const latestFor = useCallback(
    (soundId: string | null): Cmd | undefined => {
      for (let i = cmds.length - 1; i >= 0; i--) if (cmds[i].soundId === soundId) return cmds[i];
      return undefined;
    },
    [cmds],
  );

  const lastCmd = cmds[cmds.length - 1];
  const nowPlaying = status?.state?.nowPlaying ?? null;
  const nowSound = useMemo(() => (nowPlaying ? catalog.find((s) => s.id === nowPlaying.soundId) : null), [nowPlaying, catalog]);

  // Línea de estado principal
  let headline: { text: string; level: 'ok' | 'warn' | 'err' | 'info' };
  if (!linkOk) headline = { text: 'Enlace inválido. Escanea el QR de la consola.', level: 'err' };
  else if (revoked) headline = { text: 'La consola regeneró el token. Escanea el nuevo QR.', level: 'err' };
  else if (link === 'invalid')
    headline = {
      text: invalidRetries < MAX_INVALID_RETRIES ? `Sesión no reconocida. Reintentando (${invalidRetries}/${MAX_INVALID_RETRIES})…` : 'Sesión inválida o caducada. Escanea el QR de nuevo.',
      level: 'err',
    };
  else if (link !== 'connected') headline = { text: link === 'connecting' ? 'Conectando con el servidor…' : 'Sin conexión con el servidor. Reintentando…', level: 'warn' };
  else if (!consoleOnline) headline = { text: 'La consola del computador no está conectada.', level: 'err' };
  else if (!audioReady) headline = { text: 'Pulsa «Activar audio» en el computador.', level: 'warn' };
  else if (lastCmd && Date.now() - lastCmd.at < 6000) {
    const name = lastCmd.soundId ? catalog.find((s) => s.id === lastCmd.soundId)?.name ?? lastCmd.soundId : 'Detener todo';
    const map: Record<Stage, [string, 'ok' | 'warn' | 'err' | 'info']> = {
      sending: [`Enviando «${name}»…`, 'info'],
      accepted: [`«${name}» aceptada · esperando confirmación…`, 'warn'],
      playing: [`▶ «${name}» sonando en el computador`, 'ok'],
      stopped: ['■ Audio detenido en el computador', 'ok'],
      error: [`✕ «${name}»: ${lastCmd.message ?? 'error'}`, 'err'],
      noconfirm: [`? «${name}»: ${lastCmd.message ?? 'sin confirmación'}`, 'err'],
    };
    const [text, level] = map[lastCmd.stage];
    headline = { text, level };
  } else headline = { text: nowSound ? `▶ ${nowSound.name}` : 'Listo. Toca un botón para transmitir.', level: nowSound ? 'ok' : 'info' };

  return (
    <div className="remote-root chassis-bg">
      <header className="remote-header">
        <Screws />
        <div className="remote-title">
          <div className="remote-title-main">XENOLINGUISTIC COMM. TERMINAL</div>
          <div className="remote-title-sub">MANDO REMOTO · GRACE ⇄ ROCKY</div>
        </div>
        <div className="remote-lamps">
          <Lamp label="Link" color={link === 'connected' ? 'green' : link === 'invalid' ? 'red' : 'amber'} blink={link === 'connecting' || link === 'disconnected'} />
          <Lamp label="Consola" color={!linkOk || link !== 'connected' ? 'off' : consoleOnline ? 'green' : 'red'} />
          <Lamp label="Audio" color={!consoleOnline || link !== 'connected' ? 'off' : audioReady ? 'green' : 'amber'} blink={consoleOnline && !audioReady} />
        </div>
      </header>

      <div className={`remote-display level-${headline.level}`}>
        <div className="remote-display-grid" aria-hidden />
        <div className="remote-display-text">{headline.text}</div>
        {nowSound && nowPlaying && (
          <div className="remote-display-sub">
            TX {nowSound.name.toUpperCase()} · {nowPlaying.duration.toFixed(1)} s · ORIGEN {nowPlaying.source === 'remote' ? 'CELULAR' : nowPlaying.source === 'keyboard' ? 'TECLADO' : 'CONSOLA'}
          </div>
        )}
      </div>

      <main className="remote-grid">
        {catalogError && <div className="remote-error">No se pudo cargar el catálogo: {catalogError}</div>}
        {catalog.map((s) => {
          const st = status?.state?.sounds?.[s.id];
          const unavailable = st === 'missing' || st === 'error';
          const c = latestFor(s.id);
          const recent = c && Date.now() - c.at < 2500 ? c.stage : null;
          const live = nowPlaying?.soundId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              className={`remote-btn ${recent ? `st-${recent}` : ''} ${live ? 'live' : ''} ${unavailable ? 'unavailable' : ''}`}
              style={{ ['--accent' as string]: s.color ?? '#5fd7ff' }}
              disabled={!linkOk || unavailable}
              aria-disabled={!canSend}
              onPointerDown={press(s.id)}
              onKeyDown={keyPress(s.id)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <span className="remote-btn-key">{s.key.toUpperCase()}</span>
              <span className="remote-btn-name">{s.name}</span>
              <span className="remote-btn-meta">
                {unavailable ? 'NO DISPONIBLE' : recent === 'sending' ? 'ENVIANDO' : recent === 'accepted' ? 'ACEPTADA' : recent === 'playing' ? 'SONANDO' : recent === 'error' || recent === 'noconfirm' ? 'FALLO' : live ? 'EN AIRE' : s.category}
              </span>
              <span className="remote-btn-led" aria-hidden />
            </button>
          );
        })}
      </main>

      <footer className="remote-footer">
        <button
          type="button"
          className={`remote-stop ${latestFor(null) && Date.now() - latestFor(null)!.at < 1500 ? `st-${latestFor(null)!.stage}` : ''}`}
          disabled={!linkOk}
          onPointerDown={press(null)}
          onKeyDown={keyPress(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          ■ DETENER TODO
        </button>
      </footer>
    </div>
  );
}
