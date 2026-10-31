import type { CommandSource, NowPlaying, SoundEntry, SoundStatus } from '../types';

export interface EngineSnapshot {
  contextState: 'none' | AudioContextState;
  audioReady: boolean;
  volume: number;
  nowPlaying: NowPlaying | null;
  sounds: Record<string, SoundStatus>;
}

type Listener = (snap: EngineSnapshot) => void;

/**
 * Motor de reproducción: un único AudioContext reutilizado, buffers decodificados en
 * memoria, un GainNode maestro y un AnalyserNode para la pantalla.
 * Política: cada sonido nuevo interrumpe al anterior (para todos los orígenes).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private status: Record<string, SoundStatus> = {};
  private current: { soundId: string; source: AudioBufferSourceNode; startedAtCtx: number; np: NowPlaying } | null = null;
  private volume = 0.9;
  private listeners = new Set<Listener>();
  private snapshot: EngineSnapshot = { contextState: 'none', audioReady: false, volume: 0.9, nowPlaying: null, sounds: {} };

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.snapshot);
    return () => this.listeners.delete(l);
  }

  getSnapshot(): EngineSnapshot {
    return this.snapshot;
  }

  private emit() {
    this.snapshot = {
      contextState: this.ctx ? this.ctx.state : 'none',
      audioReady: !!this.ctx && this.ctx.state === 'running',
      volume: this.volume,
      nowPlaying: this.current?.np ?? null,
      sounds: { ...this.status },
    };
    for (const l of this.listeners) l(this.snapshot);
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.6;
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.ctx.onstatechange = () => this.emit();
    }
    return this.ctx;
  }

  /** Debe llamarse desde un gesto del usuario (clic en "Activar audio"). */
  async activate(): Promise<boolean> {
    const ctx = this.ensureContext();
    try {
      await ctx.resume();
      // buffer silencioso: fuerza el desbloqueo en navegadores estrictos
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start();
    } catch (err) {
      console.warn('No se pudo activar el audio', err);
    }
    this.emit();
    return ctx.state === 'running';
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /** Descarga y decodifica todo el catálogo. Los fallos se marcan sin romper nada. */
  async preload(catalog: SoundEntry[]): Promise<void> {
    const ctx = this.ensureContext();
    const ids = new Set(catalog.map((s) => s.id));
    for (const id of Object.keys(this.status)) if (!ids.has(id)) delete this.status[id];
    for (const s of catalog) if (!this.buffers.has(s.id)) this.status[s.id] = 'loading';
    this.emit();

    await Promise.all(
      catalog.map(async (s) => {
        if (this.buffers.has(s.id)) {
          this.status[s.id] = 'ready';
          return;
        }
        try {
          const res = await fetch(`/audio/${encodeURIComponent(s.file)}`, { cache: 'no-cache' });
          const type = res.headers.get('content-type') ?? '';
          if (!res.ok || type.includes('text/html')) {
            this.status[s.id] = 'missing';
            return;
          }
          const data = await res.arrayBuffer();
          const buf = await ctx.decodeAudioData(data.slice(0));
          this.buffers.set(s.id, buf);
          this.status[s.id] = 'ready';
        } catch (err) {
          console.warn(`No se pudo decodificar ${s.file}`, err);
          this.status[s.id] = 'error';
        } finally {
          this.emit();
        }
      }),
    );
  }

  getDuration(soundId: string): number | null {
    return this.buffers.get(soundId)?.duration ?? null;
  }

  play(soundId: string, source: CommandSource): { ok: true; nowPlaying: NowPlaying } | { ok: false; error: string; message: string } {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.master) {
      return { ok: false, error: 'AUDIO_NOT_READY', message: 'Audio no activado en la consola.' };
    }
    const buf = this.buffers.get(soundId);
    if (!buf) {
      const st = this.status[soundId];
      return {
        ok: false,
        error: st === 'loading' ? 'SOUND_LOADING' : 'SOUND_UNAVAILABLE',
        message: st === 'loading' ? 'El sonido aún se está cargando.' : 'Archivo ausente o no decodificable.',
      };
    }
    this.stopAll(true);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.master);
    const np: NowPlaying = { soundId, startedAt: Date.now(), duration: buf.duration, source };
    const entry = { soundId, source: src, startedAtCtx: ctx.currentTime, np };
    src.onended = () => {
      if (this.current === entry) {
        this.current = null;
        this.emit();
      }
    };
    src.start();
    this.current = entry;
    this.emit();
    return { ok: true, nowPlaying: np };
  }

  stopAll(silent = false): boolean {
    const had = !!this.current;
    if (this.current) {
      const c = this.current;
      this.current = null;
      c.source.onended = null;
      try {
        c.source.stop();
      } catch {
        /* ya detenido */
      }
      c.source.disconnect();
    }
    if (!silent) this.emit();
    return had;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
    }
    this.emit();
  }

  /** Progreso 0..1 del sonido actual (para la pantalla). */
  progress(): number {
    if (!this.current || !this.ctx) return 0;
    const el = this.ctx.currentTime - this.current.startedAtCtx;
    return Math.max(0, Math.min(1, el / this.current.np.duration));
  }
}

export const engine = new AudioEngine();
