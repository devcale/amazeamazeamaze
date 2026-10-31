import type { SoundEntry, SoundStatus } from '../types';

interface Props {
  sound: SoundEntry;
  status: SoundStatus | undefined;
  playing: boolean;
  lit: boolean;
  disabled: boolean;
  onTrigger: () => void;
}

const STATUS_LABEL: Record<SoundStatus, string> = {
  loading: 'CARGANDO',
  ready: 'LISTO',
  missing: 'SIN ARCHIVO',
  error: 'ERROR DECOD.',
};

export function SoundButton({ sound, status, playing, lit, disabled, onTrigger }: Props) {
  const st = status ?? 'loading';
  const unavailable = st === 'missing' || st === 'error';
  const color = sound.color ?? '#5fd7ff';
  return (
    <button
      type="button"
      className={`sound-btn ${playing ? 'playing' : ''} ${lit ? 'lit' : ''} ${unavailable ? 'unavailable' : ''}`}
      style={{ ['--accent' as string]: color }}
      disabled={disabled || unavailable || st === 'loading'}
      onClick={onTrigger}
      title={unavailable ? `${sound.name}: ${STATUS_LABEL[st]} (${sound.file})` : `${sound.name} — tecla ${sound.key.toUpperCase()}`}
    >
      <span className="sound-btn-top">
        <span className="keycap">{sound.key.toUpperCase()}</span>
        <span className={`sound-led ${st}`} aria-hidden />
      </span>
      <span className="sound-btn-name">{sound.name}</span>
      <span className="sound-btn-meta">
        <span>{sound.category}</span>
        <span className={`sound-status ${st}`}>{STATUS_LABEL[st]}</span>
      </span>
      {sound.demo && <span className="demo-tag">DEMO</span>}
      <span className="sound-btn-glow" aria-hidden />
    </button>
  );
}
