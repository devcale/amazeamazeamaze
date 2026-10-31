export interface SoundEntry {
  id: string;
  name: string;
  file: string;
  key: string;
  category: string;
  color?: string;
  demo?: boolean;
  fileExists: boolean;
}

export type SoundStatus = 'loading' | 'ready' | 'missing' | 'error';

export type CommandSource = 'keyboard' | 'console' | 'remote';

export interface NowPlaying {
  soundId: string;
  startedAt: number;
  duration: number;
  source: CommandSource;
}

export interface ConsoleState {
  audioReady: boolean;
  volume: number;
  nowPlaying: NowPlaying | null;
  sounds: Record<string, SoundStatus>;
}

export interface PlayCommand {
  commandId: string;
  soundId: string;
  source: 'remote';
  issuedAt: number;
}

export interface StopCommand {
  commandId: string;
  source: 'remote';
  issuedAt: number;
}

export type CommandResultStatus = 'playing' | 'stopped' | 'error';

export interface CommandResult {
  commandId: string;
  action: 'play' | 'stop';
  soundId?: string;
  status: CommandResultStatus;
  error?: string;
  at: number;
}

export interface SessionStatus {
  sessionId: string;
  consoleOnline: boolean;
  remotes: number;
  state: ConsoleState | null;
}

export interface LogEntry {
  id: string;
  at: number;
  text: string;
  source: CommandSource | 'system';
  level: 'info' | 'ok' | 'warn' | 'err';
}
