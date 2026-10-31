import { useEffect, useRef } from 'react';
import type { SoundEntry } from '../types';
import { engine } from '../lib/audioEngine';
import './display.css';

interface Props {
  nowPlaying: { soundId: string; source: string; duration: number } | null;
  sound: SoundEntry | null;
  audioReady: boolean;
  serverOnline: boolean;
  remotes: number;
  lastEvent: string | null;
}

/**
 * Pantalla central dibujada en canvas: retícula cian, trayectorias diagonales, un
 * "objeto" central (silueta tipo nave) en reposo y la forma de onda real del
 * AnalyserNode mientras suena algo. Todo generado, sin imágenes.
 */
export function Display({ nowPlaying, sound, audioReady, serverOnline, remotes, lastEvent }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef<Props>({ nowPlaying, sound, audioReady, serverOnline, remotes, lastEvent });
  propsRef.current = { nowPlaying, sound, audioReady, serverOnline, remotes, lastEvent };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let wave = new Uint8Array(0);
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      const p = propsRef.current;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const t = (performance.now() - start) / 1000;
      const cyan = '#5fd7ff';
      const amber = '#ffb547';

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#050a0d';
      ctx.fillRect(0, 0, w, h);

      // Retícula
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(95,215,255,0.10)';
      ctx.beginPath();
      const step = 24;
      for (let x = (w / 2) % step; x < w; x += step) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
      }
      for (let y = (h / 2) % step; y < h; y += step) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
      }
      ctx.stroke();

      // Ejes principales
      ctx.strokeStyle = 'rgba(95,215,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(w / 2 + 0.5, 0);
      ctx.lineTo(w / 2 + 0.5, h);
      ctx.moveTo(0, h / 2 + 0.5);
      ctx.lineTo(w, h / 2 + 0.5);
      ctx.stroke();

      // Trayectorias diagonales (como en la referencia)
      ctx.strokeStyle = 'rgba(95,215,255,0.45)';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(w * 0.08, h * 0.88);
      ctx.lineTo(w * 0.92, h * 0.14);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,77,77,0.55)';
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(w * 0.05, h * 0.62);
      ctx.lineTo(w * 0.95, h * 0.62);
      ctx.stroke();
      ctx.setLineDash([]);

      // Marcas de regla
      ctx.strokeStyle = 'rgba(95,215,255,0.6)';
      ctx.beginPath();
      for (let x = 0; x < w; x += step) {
        const big = Math.round(x / step) % 4 === 0;
        ctx.moveTo(x + 0.5, h - 6);
        ctx.lineTo(x + 0.5, h - (big ? 14 : 10));
      }
      for (let y = 0; y < h; y += step) {
        const big = Math.round(y / step) % 4 === 0;
        ctx.moveTo(6, y + 0.5);
        ctx.lineTo(big ? 14 : 10, y + 0.5);
      }
      ctx.stroke();

      const playing = !!p.nowPlaying;
      const analyser = engine.getAnalyser();

      if (playing && analyser) {
        if (wave.length !== analyser.fftSize) wave = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(wave);
        // Forma de onda
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = cyan;
        ctx.shadowColor = cyan;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        const mid = h * 0.5;
        const amp = h * 0.28;
        for (let i = 0; i < wave.length; i++) {
          const x = (i / (wave.length - 1)) * w;
          const y = mid + ((wave[i] - 128) / 128) * amp;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Barra de progreso
        const prog = engine.progress();
        const bx = w * 0.08;
        const bw = w * 0.84;
        const by = h * 0.80;
        ctx.strokeStyle = 'rgba(95,215,255,0.5)';
        ctx.strokeRect(bx + 0.5, by + 0.5, bw, 8);
        ctx.fillStyle = amber;
        ctx.shadowColor = amber;
        ctx.shadowBlur = 10;
        ctx.fillRect(bx + 1, by + 1, (bw - 1) * prog, 7);
        ctx.shadowBlur = 0;

        // Cursor de tiempo en la trayectoria
        const cx = w * 0.08 + w * 0.84 * prog;
        const cy = h * 0.88 - h * 0.74 * prog;
        ctx.fillStyle = amber;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 7);
        ctx.lineTo(cx + 6, cy);
        ctx.lineTo(cx, cy + 7);
        ctx.lineTo(cx - 6, cy);
        ctx.closePath();
        ctx.fill();

        ctx.font = '10px ' + getComputedStyle(canvas).fontFamily;
        ctx.fillStyle = amber;
        ctx.textAlign = 'right';
        const elapsed = Math.min(p.nowPlaying!.duration, prog * p.nowPlaying!.duration);
        ctx.fillText(`${elapsed.toFixed(2).padStart(5, '0')} / ${p.nowPlaying!.duration.toFixed(2)} s`, bx + bw, by - 4);
      } else {
        // Reposo: silueta elíptica tipo nave + barrido
        const cx = w / 2;
        const cy = h / 2;
        ctx.strokeStyle = 'rgba(95,215,255,0.8)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, w * 0.17, h * 0.07, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, cy, w * 0.11, h * 0.035, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - w * 0.17, cy);
        ctx.lineTo(cx - w * 0.23, cy);
        ctx.moveTo(cx + w * 0.17, cy);
        ctx.lineTo(cx + w * 0.23, cy);
        ctx.stroke();
        // Segmentos del casco
        ctx.strokeStyle = 'rgba(95,215,255,0.45)';
        ctx.beginPath();
        for (let i = -3; i <= 3; i++) {
          const x = cx + (i * w * 0.17) / 3.5;
          ctx.moveTo(x, cy - h * 0.055);
          ctx.lineTo(x, cy + h * 0.055);
        }
        ctx.stroke();

        // Línea de barrido
        const sx = ((t * 0.12) % 1) * w;
        const grad = ctx.createLinearGradient(sx - 60, 0, sx, 0);
        grad.addColorStop(0, 'rgba(95,215,255,0)');
        grad.addColorStop(1, 'rgba(95,215,255,0.25)');
        ctx.fillStyle = grad;
        ctx.fillRect(sx - 60, 0, 60, h);
        ctx.fillStyle = 'rgba(95,215,255,0.9)';
        ctx.fillRect(sx, 0, 1, h);
      }

      // Esquinas / etiquetas técnicas
      ctx.font = '10px ' + getComputedStyle(canvas).fontFamily;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(95,215,255,0.9)';
      ctx.fillText('XCT-01 // MAIN DISPLAY', 18, 16);
      ctx.fillStyle = p.serverOnline ? '#5dff7a' : '#ff4d4d';
      ctx.fillText(`LINK ${p.serverOnline ? 'NOMINAL' : 'LOST'}`, 18, 28);
      ctx.fillStyle = p.audioReady ? '#5dff7a' : amber;
      ctx.fillText(`AUDIO ${p.audioReady ? 'ARMED' : 'STANDBY'}`, 18, 40);
      ctx.fillStyle = 'rgba(95,215,255,0.9)';
      ctx.textAlign = 'right';
      ctx.fillText(`REMOTES ${String(p.remotes).padStart(2, '0')}`, w - 18, 16);
      ctx.fillText(`T+${t.toFixed(1).padStart(7, '0')}`, w - 18, 28);

      // Título de estado central inferior
      ctx.textAlign = 'center';
      if (playing && p.sound) {
        ctx.font = 'bold 20px ' + getComputedStyle(canvas).fontFamily;
        ctx.fillStyle = '#e9fbff';
        ctx.shadowColor = cyan;
        ctx.shadowBlur = 12;
        ctx.fillText(p.sound.name.toUpperCase(), w / 2, h * 0.26);
        ctx.shadowBlur = 0;
        ctx.font = '10px ' + getComputedStyle(canvas).fontFamily;
        ctx.fillStyle = amber;
        const src = p.nowPlaying!.source === 'remote' ? 'CELULAR' : p.nowPlaying!.source === 'keyboard' ? 'TECLADO' : 'CONSOLA';
        ctx.fillText(`TRANSMITIENDO  ·  ORIGEN ${src}  ·  ${p.sound.category.toUpperCase()}`, w / 2, h * 0.26 + 16);
      } else {
        ctx.font = '11px ' + getComputedStyle(canvas).fontFamily;
        ctx.fillStyle = p.audioReady ? 'rgba(95,215,255,0.85)' : amber;
        ctx.fillText(p.audioReady ? 'STANDBY — ESPERANDO TRANSMISIÓN' : 'AUDIO EN ESPERA — PULSA «ACTIVAR AUDIO»', w / 2, h * 0.92);
      }
      if (p.lastEvent) {
        ctx.textAlign = 'left';
        ctx.font = '10px ' + getComputedStyle(canvas).fontFamily;
        ctx.fillStyle = 'rgba(207,230,238,0.75)';
        ctx.fillText(`> ${p.lastEvent}`, 18, h - 20);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="display">
      <canvas ref={canvasRef} className="display-canvas" />
      <div className="display-scanlines" />
      <div className="display-glass" />
    </div>
  );
}
