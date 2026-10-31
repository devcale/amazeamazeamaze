import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../lib/api';
import { loadBaseHost, saveBaseHost } from '../lib/storage';
import type { StoredSession } from '../lib/storage';

interface Props {
  session: StoredSession;
  onRotate: () => Promise<void>;
}

interface NetInfo {
  port: number;
  publicBaseUrl: string | null;
  addresses: { name: string; address: string }[];
}

const MANUAL = '__manual__';

export function QrPanel({ session, onRotate }: Props) {
  const [net, setNet] = useState<NetInfo | null>(null);
  const [choice, setChoice] = useState<string>(() => loadBaseHost() ?? '');
  const [manual, setManual] = useState<string>(() => {
    const v = loadBaseHost();
    return v && v.startsWith('http') ? v : '';
  });
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    api
      .network()
      .then(setNet)
      .catch(() => setNet({ port: 0, publicBaseUrl: null, addresses: [] }));
  }, []);

  const options = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    if (net?.publicBaseUrl) opts.push({ value: net.publicBaseUrl, label: `${net.publicBaseUrl} (PUBLIC_BASE_URL)` });
    for (const a of net?.addresses ?? []) {
      const url = `${location.protocol}//${a.address}${location.port ? ':' + location.port : ''}`;
      opts.push({ value: url, label: `${url}  —  ${a.name}` });
    }
    opts.push({ value: MANUAL, label: 'URL manual…' });
    return opts;
  }, [net]);

  // Elección efectiva: guardada → PUBLIC_BASE_URL → primera IP de red → origen actual (sólo si no es localhost)
  const baseUrl = useMemo(() => {
    if (choice === MANUAL) return manual.trim().replace(/\/+$/, '');
    if (choice && choice !== MANUAL) return choice;
    const first = options.find((o) => o.value !== MANUAL);
    if (first) return first.value;
    return location.origin;
  }, [choice, manual, options]);

  const isLocalhost = /\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(baseUrl);
  const remoteUrl = `${baseUrl}/remote?s=${session.sessionId}&t=${session.token}`;

  useEffect(() => {
    if (!baseUrl || isLocalhost) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(remoteUrl, { margin: 1, width: 220, color: { dark: '#dff7ff', light: '#00000000' }, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null));
  }, [remoteUrl, baseUrl, isLocalhost]);

  const pick = (v: string) => {
    setChoice(v);
    saveBaseHost(v === MANUAL ? manual : v);
  };

  const copy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(remoteUrl);
      else {
        const ta = document.createElement('textarea');
        ta.value = remoteUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="qr-panel">
      <div className="qr-frame">
        {qr ? (
          <img src={qr} alt="QR para abrir el mando" width={220} height={220} />
        ) : (
          <div className="qr-empty">
            {isLocalhost
              ? 'La URL apunta a localhost: el celular no podrá abrirla. Elige la IP de tu red Wi‑Fi o escribe la URL manualmente.'
              : 'Generando QR…'}
          </div>
        )}
      </div>
      <div className="qr-side">
        <div className="mono-label">Enlace del mando</div>
        <input className="qr-url" readOnly value={remoteUrl} onFocus={(e) => e.currentTarget.select()} />
        <div className="qr-actions">
          <button type="button" className="hw-btn" onClick={copy}>
            {copied ? 'Copiado' : 'Copiar enlace'}
          </button>
          <button
            type="button"
            className="hw-btn red"
            disabled={rotating}
            onClick={async () => {
              if (!confirm('¿Regenerar el token? Los mandos conectados perderán acceso y deberán escanear el nuevo QR.')) return;
              setRotating(true);
              try {
                await onRotate();
              } finally {
                setRotating(false);
              }
            }}
          >
            Regenerar token
          </button>
        </div>
        <div className="hr" />
        <div className="mono-label">Dirección accesible desde el celular</div>
        <select className="qr-select" value={choice || (options[0]?.value ?? '')} onChange={(e) => pick(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {choice === MANUAL && (
          <input
            className="qr-url"
            placeholder="http://192.168.1.20:3000"
            value={manual}
            onChange={(e) => {
              setManual(e.target.value);
              saveBaseHost(e.target.value);
            }}
          />
        )}
        <p className="qr-help">
          El celular debe estar en la misma red Wi‑Fi o hotspot. Si el QR no abre, revisa el firewall de Windows (permitir Node.js en redes
          privadas) y el aislamiento de clientes del router. Sesión <span className="readout">{session.sessionId}</span>.
        </p>
      </div>
    </div>
  );
}
