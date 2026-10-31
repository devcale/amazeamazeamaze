import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SoundEntry } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '../..');
export const CATALOG_FILE = path.join(ROOT_DIR, 'shared', 'sounds.json');
export const AUDIO_DIR = path.join(ROOT_DIR, 'client', 'public', 'audio');
export const CLIENT_DIST = path.join(ROOT_DIR, 'client', 'dist');

const SAFE_FILE = /^[A-Za-z0-9._ -]+$/; // nombre de archivo plano; nunca rutas
const SAFE_ID = /^[a-z0-9_-]{1,40}$/;
const SAFE_KEY = /^[a-z0-9]$/;

let lastGood: SoundEntry[] = [];
let lastMtime = 0;

function validate(raw: unknown): SoundEntry[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { sounds?: unknown }).sounds)) {
    throw new Error('sounds.json debe contener un arreglo "sounds"');
  }
  const ids = new Set<string>();
  const keys = new Set<string>();
  const out: SoundEntry[] = [];
  for (const item of (raw as { sounds: unknown[] }).sounds) {
    const s = item as Record<string, unknown>;
    const id = String(s.id ?? '');
    const file = String(s.file ?? '');
    const key = String(s.key ?? '').toLowerCase();
    if (!SAFE_ID.test(id)) throw new Error(`id inválido: "${id}" (usa a-z, 0-9, _ o -)`);
    if (ids.has(id)) throw new Error(`id duplicado: ${id}`);
    if (!SAFE_FILE.test(file) || file.includes('..')) throw new Error(`file inválido para ${id}: "${file}"`);
    if (!SAFE_KEY.test(key)) throw new Error(`key inválida para ${id}: "${key}" (una letra o dígito)`);
    if (keys.has(key)) throw new Error(`tecla duplicada: ${key}`);
    ids.add(id);
    keys.add(key);
    out.push({
      id,
      name: String(s.name ?? id),
      file,
      key,
      category: String(s.category ?? 'general'),
      color: typeof s.color === 'string' ? s.color : undefined,
      demo: s.demo === true,
      fileExists: fs.existsSync(path.join(AUDIO_DIR, file)),
    });
  }
  return out;
}

/** Relee el catálogo si cambió en disco; ante error conserva la última versión válida. */
export function loadCatalog(): SoundEntry[] {
  try {
    const stat = fs.statSync(CATALOG_FILE);
    if (stat.mtimeMs !== lastMtime || lastGood.length === 0) {
      const raw = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
      lastGood = validate(raw);
      lastMtime = stat.mtimeMs;
    } else {
      // refrescar existencia de archivos (barato) por si se copió un audio nuevo
      lastGood = lastGood.map((s) => ({ ...s, fileExists: fs.existsSync(path.join(AUDIO_DIR, s.file)) }));
    }
  } catch (err) {
    console.error('[catalog] error leyendo sounds.json:', (err as Error).message);
  }
  return lastGood;
}

export function findSound(id: string): SoundEntry | undefined {
  return loadCatalog().find((s) => s.id === id);
}
