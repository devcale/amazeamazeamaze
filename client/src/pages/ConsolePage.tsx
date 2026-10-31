import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '../lib/api';
import { engine, type EngineSnapshot } from '../lib/audioEngine';
import { fmtTime, uid } from '../lib/ids';
import { clearSession, loadSession, loadVolume, saveSession, saveVolume, type StoredSession } from '../lib/storage';
import type { CommandResult, CommandSource, ConsoleState, LogEntry, PlayCommand, SoundEntry, StopCommand } from '../types';
import { Display } from '../components/Display';
import { Lamp, Panel } from '../components/Panel';
import { QrPanel } from '../components/QrPanel';
import { SoundButton } from '../components/SoundButton';
import '../styles/console.css';

const SOURCE_LABEL: Record<CommandSource | 'system', string> = {
  keyboard: 'TECLADO',
  console: 'CONSOLA',
  remote: 'CELULAR',
  system: 'SISTEMA',
};

function toState(s: EngineSnapshot): ConsoleState {
  return { audioReady: s.audioReady, volume: s.volume, nowPlaying: s.nowPlaying, sounds: s.sounds };
}

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function ConsolePage() {
  const [catalog, setCatalog] = useState<SoundEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [snap, setSnap] = useState<EngineSnapshot>(engine.getSnapshot());
  const [session, setSession] = useState<StoredSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [serverOnline, setServerOnline] = useState(false);
  const [remotes, setRemotes] = useState(0);
  const [replaced, setReplaced] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [showQr, setShowQr] = useState(true);
  const [litId, setLitId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activating, setActivating] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const catalogRef = useRef<SoundEntry[]>([]);
  catalogRef.current = catalog;
  const litTimer = useRef<number | null>(null);

  const addLog = useCallback((text: string, source: LogEntry['source'], level: LogEntry['level'] = 'info') => {
    setLog((l) => [{ id: uid(4), at: Date.now(), text, source, level }, ...l].slice(0, 40));
  }, []);

  // --- motor de audio -----------------------------------------------------
  useEffect(() => engine.subscribe(setSnap), []);
  useEffect(() => {
    engine.setVolume(loadVolume());
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const { sounds } = await api.sounds();
      setCatalog(sounds);
      setCatalogError(null);
      await engine.preload(sounds);
      const st = engine.getSnapshot().sounds;
      const bad = sounds.filter((s) => st[s.id] === 'missing' || st[s.id] === 'error');
      addLog(`Banco de audio: ${sounds.length - bad.length}/${sounds.length} sonidos listos`, 'system', bad.length ? 'warn' : 'ok');
      for (const b of bad) addLog(`"${b.name}" no disponible (${b.file}: ${st[b.id] === 'missing' ? 'archivo ausente' : 'no decodificable'})`, 'system', 'warn');
    } catch (err) {
      setCatalogError((err as Error).message);
      addLog('No se pudo cargar el catálogo de sonidos', 'system', 'err');
    }
  }, [addLog]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // --- sesión -------------------------------------------------------------
  const ensureSession = useCallback(async (): Promise<StoredSession | null> => {
    const stored = loadSession();
    try {
      const r = await api.createSession(stored ?? undefined);
      const s: StoredSession = { sessionId: r.sessionId, token: r.token, consoleSecret: r.consoleSecret };
      saveSession(s);
      setSession(s);
      setSessionError(null);
      return s;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'FORBIDDEN') {
        clearSession();
        const r = await api.createSession();
        const s: StoredSession = { sessionId: r.sessionId, token: r.token, consoleSecret: r.consoleSecret };
        saveSession(s);
        setSession(s);
        return s;
      }
      setSessionError((err as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const tryIt = async () => {
      const s = await ensureSession();
      if (!s && !cancelled) timer = window.setTimeout(tryIt, 3000);
    };
    void tryIt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ensureSession]);

  // --- reproducción (común a todos los orígenes) ---------------------------
  const flash = useCallback((id: string) => {
    setLitId(id);
    if (litTimer.current) clearTimeout(litTimer.current);
    litTimer.current = window.setTimeout(() => setLitId(null), 220);
  }, []);

  const triggerPlay = useCallback(
    (soundId: string, source: CommandSource): CommandResult => {
      const sound = catalogRef.current.find((s) => s.id === soundId);
      const name = sound?.name ?? soundId;
      const res = engine.play(soundId, source);
      flash(soundId);
      if (res.ok) {
        addLog(`▶ ${name}`, source, 'ok');
        return { commandId: '', action: 'play', soundId, status: 'playing', at: Date.now() };
      }
      addLog(`✕ ${name}: ${res.message}`, source, 'err');
      return { commandId: '', action: 'play', soundId, status: 'error', error: res.error, at: Date.now() };
    },
    [addLog, flash],
  );

  const triggerStop = useCallback(
    (source: CommandSource): CommandResult => {
      const had = engine.stopAll();
      addLog(had ? '■ Detener todo' : '■ Detener (nada sonando)', source, 'info');
      return { commandId: '', action: 'stop', status: 'stopped', at: Date.now() };
    },
    [addLog],
  );

  // --- Socket.IO ----------------------------------------------------------
  useEffect(() => {
    if (!session) return;
    const socket = io({
      auth: { role: 'console', sessionId: session.sessionId, consoleSecret: session.consoleSecret },
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setServerOnline(true);
      setReplaced(false);
      addLog('Enlace con el servidor establecido', 'system', 'ok');
      socket.emit('console:state', toState(engine.getSnapshot()));
    });
    socket.on('disconnect', (reason) => {
      setServerOnline(false);
      setRemotes(0);
      if (reason !== 'io client disconnect') addLog(`Enlace perdido (${reason}). Reintentando…`, 'system', 'warn');
    });
    socket.on('connect_error', async (err) => {
      setServerOnline(false);
      if (err.message === 'INVALID_SESSION' || err.message === 'FORBIDDEN') {
        // El servidor se reinició o la sesión caducó: la recreamos con los mismos identificadores.
        addLog('Sesión no reconocida por el servidor; restaurando…', 'system', 'warn');
        const s = await ensureSession();
        if (s && s.sessionId === session.sessionId) socket.connect();
      }
    });
    socket.on('session:remotes', ({ count }: { count: number }) => setRemotes(count));
    socket.on('console:replaced', () => {
      setReplaced(true);
      addLog('Otra consola tomó el control de esta sesión. Esta pestaña queda inactiva.', 'system', 'err');
    });
    socket.on('command:play', (cmd: PlayCommand) => {
      if (!cmd || typeof cmd.commandId !== 'string') return;
      if (seenRef.current.has(cmd.commandId)) return; // idempotencia local
      seenRef.current.add(cmd.commandId);
      if (seenRef.current.size > 500) seenRef.current.delete(seenRef.current.values().next().value as string);
      const r = triggerPlay(cmd.soundId, 'remote');
      socket.emit('command:result', { ...r, commandId: cmd.commandId });
    });
    socket.on('command:stop', (cmd: StopCommand) => {
      if (!cmd || typeof cmd.commandId !== 'string') return;
      if (seenRef.current.has(cmd.commandId)) return;
      seenRef.current.add(cmd.commandId);
      const r = triggerStop('remote');
      socket.emit('command:result', { ...r, commandId: cmd.commandId });
    });

    // Si la pestaña se oculta/descarga (o entra en bfcache) avisamos de inmediato al servidor
    // para que los mandos sepan que la consola no está disponible, en vez de esperar al ping.
    const onHide = () => {
      engine.stopAll();
      socket.disconnect();
    };
    const onShow = () => {
      if (!socket.connected) socket.connect();
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);

    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session, addLog, ensureSession, triggerPlay, triggerStop]);

  // Publica el estado de la consola cada vez que cambia (audio listo, sonando, disponibilidad)
  useEffect(() => {
    socketRef.current?.emit('console:state', toState(snap));
  }, [snap]);

  // --- teclado ------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isEditable(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        triggerStop('keyboard');
        return;
      }
      const k = e.key.toLowerCase();
      const sound = catalogRef.current.find((s) => s.key === k);
      if (!sound) return;
      e.preventDefault();
      triggerPlay(sound.id, 'keyboard');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [triggerPlay, triggerStop]);

  // --- pantalla completa --------------------------------------------------
  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* no soportado */
    }
  };

  const activateAudio = async () => {
    setActivating(true);
    const ok = await engine.activate();
    setActivating(false);
    addLog(ok ? 'Audio activado — reproductor armado' : 'El navegador no permitió activar el audio', 'system', ok ? 'ok' : 'err');
  };

  const rotate = async () => {
    if (!session) return;
    const r = await api.rotateToken(session.sessionId, session.consoleSecret);
    const s = { ...session, token: r.token };
    saveSession(s);
    setSession(s);
    addLog('Token regenerado; mandos anteriores desvinculados', 'system', 'warn');
  };

  const nowSound = useMemo(() => (snap.nowPlaying ? catalog.find((s) => s.id === snap.nowPlaying!.soundId) ?? null : null), [snap.nowPlaying, catalog]);
  const lastEvent = log[0] ? `${fmtTime(log[0].at)} ${log[0].text}` : null;

  return (
    <div className="chassis-bg console-root">
      <header className="console-header panel">
        <div className="console-title">
          <div className="console-title-main">XENOLINGUISTIC COMMUNICATION TERMINAL</div>
          <div className="console-title-sub">HAIL MARY ⇄ BLIP‑A · ENLACE GRACE — ROCKY · UNIDAD XCT‑01</div>
        </div>
        <div className="console-lamps">
          <Lamp label="Server link" color={serverOnline ? 'green' : session ? 'red' : 'amber'} blink={!serverOnline && !!session} />
          <Lamp label="Audio" color={snap.audioReady ? 'green' : 'amber'} blink={!snap.audioReady} />
          <Lamp label={`Remote ${remotes > 0 ? `×${remotes}` : ''}`} color={remotes > 0 ? 'cyan' : 'off'} />
          <Lamp label="TX" color={snap.nowPlaying ? 'amber' : 'off'} blink={!!snap.nowPlaying} />
        </div>
        <div className="console-header-actions">
          <button type="button" className="hw-btn" onClick={toggleFullscreen}>
            {isFullscreen ? 'Salir pantalla completa' : 'Pantalla completa'}
          </button>
          <label className={`toggle ${showQr ? 'on' : ''}`}>
            <span className="sw" onClick={() => setShowQr((v) => !v)} />
            <span className="mono-label" onClick={() => setShowQr((v) => !v)}>
              QR
            </span>
          </label>
        </div>
      </header>

      {replaced && (
        <div className="banner err">
          Otra pestaña o computador tomó el control de esta sesión. Recarga esta página para recuperar el control aquí.
        </div>
      )}
      {sessionError && <div className="banner err">Sin conexión con el servidor: {sessionError}. Reintentando…</div>}
      {catalogError && <div className="banner err">Catálogo no disponible: {catalogError}</div>}

      <main className="console-grid">
        <Panel title="Link status" code="L‑01" className="col-left">
          <div className="status-rows">
            <div className="status-row">
              <span className="mono-label">Servidor</span>
              <span className={`readout ${serverOnline ? 'ok' : 'bad'}`}>{serverOnline ? 'CONECTADO' : 'SIN ENLACE'}</span>
            </div>
            <div className="status-row">
              <span className="mono-label">Audio</span>
              <span className={`readout ${snap.audioReady ? 'ok' : 'warn'}`}>{snap.audioReady ? 'LISTO' : snap.contextState === 'none' ? 'INACTIVO' : snap.contextState.toUpperCase()}</span>
            </div>
            <div className="status-row">
              <span className="mono-label">Mandos</span>
              <span className={`readout ${remotes ? 'ok' : ''}`}>{remotes ? `${remotes} CONECTADO${remotes > 1 ? 'S' : ''}` : 'NINGUNO'}</span>
            </div>
            <div className="status-row">
              <span className="mono-label">Sesión</span>
              <span className="readout">{session?.sessionId ?? '——'}</span>
            </div>
          </div>
          <div className="hr" />
          <button
            type="button"
            className={`hw-btn amber big ${snap.audioReady ? 'lit' : ''}`}
            onClick={activateAudio}
            disabled={activating}
          >
            {snap.audioReady ? '● Audio activo' : 'Activar audio'}
          </button>
          <p className="hint">
            {snap.audioReady
              ? 'Este computador es el único que reproduce sonido.'
              : 'El navegador exige un clic antes de reproducir. Pulsa una vez al abrir la consola.'}
          </p>
          <div className="hr" />
          <div className="mono-label">Volumen maestro</div>
          <div className="volume-row">
            <input
              type="range"
              className="fader"
              min={0}
              max={1}
              step={0.01}
              value={snap.volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                engine.setVolume(v);
                saveVolume(v);
              }}
              aria-label="Volumen maestro"
            />
            <span className="readout vol">{Math.round(snap.volume * 100).toString().padStart(3, '0')}</span>
          </div>
          <div className="hr" />
          <button type="button" className="hw-btn red big" onClick={() => triggerStop('console')}>
            Detener todo <span className="key">ESC</span>
          </button>
        </Panel>

        <section className="col-center">
          <Display
            nowPlaying={snap.nowPlaying}
            sound={nowSound}
            audioReady={snap.audioReady}
            serverOnline={serverOnline}
            remotes={remotes}
            lastEvent={lastEvent}
          />
          <Panel
            title="Audio bank"
            code="A‑02"
            right={
              <span className="mono-label">
                {catalog.filter((s) => snap.sounds[s.id] === 'ready').length}/{catalog.length} listos · clic o tecla
              </span>
            }
          >
            {catalog.length === 0 && !catalogError && <div className="hint">Cargando catálogo…</div>}
            <div className="sound-grid">
              {catalog.map((s) => (
                <SoundButton
                  key={s.id}
                  sound={s}
                  status={snap.sounds[s.id]}
                  playing={snap.nowPlaying?.soundId === s.id}
                  lit={litId === s.id}
                  disabled={!snap.audioReady}
                  onTrigger={() => triggerPlay(s.id, 'console')}
                />
              ))}
            </div>
            {!snap.audioReady && catalog.length > 0 && <div className="hint warn">Activa el audio para habilitar el banco.</div>}
          </Panel>
        </section>

        <Panel title="Transmission log" code="T‑03" className="col-right">
          <ol className="tx-log">
            {log.length === 0 && <li className="tx-empty">Sin eventos.</li>}
            {log.map((e) => (
              <li key={e.id} className={`tx-${e.level}`}>
                <span className="tx-time">{fmtTime(e.at)}</span>
                <span className={`tx-src src-${e.source}`}>{SOURCE_LABEL[e.source]}</span>
                <span className="tx-text">{e.text}</span>
              </li>
            ))}
          </ol>
        </Panel>

        {showQr && session && (
          <Panel title="Remote link" code="R‑04" className="col-qr" right={<span className="mono-label">escanea con el celular</span>}>
            <QrPanel session={session} onRotate={rotate} />
          </Panel>
        )}
      </main>

      <footer className="console-footer mono-label">
        Atajos: {catalog.map((s) => `${s.key.toUpperCase()}=${s.name}`).join(' · ')} · ESC=Detener · Mantén esta pestaña abierta y el equipo despierto.
      </footer>
    </div>
  );
}
