// Genera sonidos de DEMOSTRACIÓN (tonos sintéticos tipo "acordes de Rocky") en client/public/audio/.
// No son grabaciones reales: sirven solo para verificar el funcionamiento completo.
// Sustitúyelos por tus propias grabaciones (ver README).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../client/public/audio');
const SR = 44100;

function env(t, dur, a = 0.01, r = 0.08) {
  if (t < a) return t / a;
  if (t > dur - r) return Math.max(0, (dur - t) / r);
  return 1;
}

// Un segmento: lista de parciales {f, amp, wave} con glide opcional (fEnd) y vibrato
function segment(dur, partials, opts = {}) {
  const n = Math.floor(dur * SR);
  const out = new Float32Array(n);
  const { attack = 0.01, release = 0.08, vibrato = 0, vibRate = 5 } = opts;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (const p of partials) {
      const fEnd = p.fEnd ?? p.f;
      const f = p.f + (fEnd - p.f) * (t / dur) + vibrato * Math.sin(2 * Math.PI * vibRate * t);
      const phase = 2 * Math.PI * f * t;
      let w = Math.sin(phase);
      if (p.wave === 'square') w = Math.sign(Math.sin(phase)) * 0.5 + Math.sin(phase) * 0.3;
      if (p.wave === 'tri') w = (2 / Math.PI) * Math.asin(Math.sin(phase));
      s += w * (p.amp ?? 0.3);
    }
    out[i] = s * env(t, dur, attack, release);
  }
  return out;
}

function silence(dur) {
  return new Float32Array(Math.floor(dur * SR));
}

function concat(...parts) {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function normalize(buf, peak = 0.8) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max === 0) return buf;
  const g = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

function writeWav(file, samples) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * bytesPerSample, 28);
  buf.writeUInt16LE(bytesPerSample, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

// Notas (Hz)
const N = { C3: 130.81, E3: 164.81, G3: 196.0, A3: 220.0, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5 };
const chord = (fs, amp = 0.25, wave = 'sine') => fs.map((f) => ({ f, amp, wave }));

const sounds = {
  'demo-saludo': () =>
    concat(
      segment(0.35, chord([N.C4, N.E4, N.G4])),
      silence(0.05),
      segment(0.5, chord([N.E4, N.G4, N.B4]), { release: 0.2 }),
    ),
  'demo-si': () => concat(segment(0.18, chord([N.G4, N.B4])), silence(0.04), segment(0.35, chord([N.C5, N.E5]), { release: 0.15 })),
  'demo-no': () =>
    concat(
      segment(0.22, chord([N.E3, N.G3], 0.3, 'square')),
      silence(0.06),
      segment(0.4, chord([N.C3, N.E3], 0.3, 'square'), { release: 0.18 }),
    ),
  'demo-pregunta': () => segment(0.7, [{ f: N.C4, fEnd: N.G4, amp: 0.3 }, { f: N.E4, fEnd: N.B4, amp: 0.2 }], { release: 0.2 }),
  'demo-alegria': () =>
    concat(
      segment(0.12, chord([N.C5], 0.35, 'tri')),
      segment(0.12, chord([N.E5], 0.35, 'tri')),
      segment(0.12, chord([N.G5], 0.35, 'tri')),
      segment(0.45, chord([N.C6, N.G5, N.E5], 0.22, 'tri'), { release: 0.25 }),
    ),
  'demo-alerta': () =>
    concat(
      segment(0.16, chord([880], 0.4, 'square'), { attack: 0.003, release: 0.02 }),
      silence(0.05),
      segment(0.16, chord([660], 0.4, 'square'), { attack: 0.003, release: 0.02 }),
      silence(0.05),
      segment(0.16, chord([880], 0.4, 'square'), { attack: 0.003, release: 0.02 }),
      silence(0.05),
      segment(0.3, chord([660], 0.4, 'square'), { attack: 0.003, release: 0.1 }),
    ),
  'demo-tristeza': () =>
    segment(1.3, [{ f: N.A4, fEnd: N.D4, amp: 0.3 }, { f: N.F4, fEnd: N.A3, amp: 0.2 }], { attack: 0.08, release: 0.5, vibrato: 3, vibRate: 4.5 }),
  'demo-celebracion': () =>
    concat(
      segment(0.14, chord([N.C5], 0.35, 'tri')),
      silence(0.03),
      segment(0.14, chord([N.C5], 0.35, 'tri')),
      silence(0.03),
      segment(0.2, chord([N.G5], 0.35, 'tri')),
      silence(0.03),
      segment(0.7, chord([N.C5, N.E5, N.G5, N.C6], 0.2, 'tri'), { release: 0.35 }),
    ),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [name, make] of Object.entries(sounds)) {
  const file = path.join(OUT_DIR, `${name}.wav`);
  writeWav(file, normalize(make()));
  console.log('generado', path.relative(process.cwd(), file));
}
console.log('\nListo. Son sonidos de DEMOSTRACIÓN; reemplázalos por tus grabaciones (ver README).');
