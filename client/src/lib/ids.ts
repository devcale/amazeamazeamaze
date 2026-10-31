/**
 * Identificador aleatorio hexadecimal. No usa crypto.randomUUID porque éste sólo existe
 * en contextos seguros (https/localhost) y el mando se abre por http en la IP de la LAN.
 */
export function uid(bytes = 12): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
