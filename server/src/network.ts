import os from 'node:os';

export interface NetInterface {
  name: string;
  address: string;
}

/** IPv4 no internas (las que el celular puede alcanzar en la misma red). */
export function lanAddresses(): NetInterface[] {
  const out: NetInterface[] = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push({ name, address: i.address });
    }
  }
  // Prioriza redes privadas típicas (Wi‑Fi/hotspot) frente a adaptadores virtuales.
  const score = (a: NetInterface) => {
    let s = 0;
    if (/^192\.168\./.test(a.address)) s += 3;
    if (/^10\./.test(a.address)) s += 2;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) s += 2;
    if (/wi-?fi|wlan|wireless|hotspot/i.test(a.name)) s += 3;
    if (/vEthernet|VirtualBox|VMware|Docker|WSL|Hyper-V|Loopback|Tailscale|ZeroTier/i.test(a.name)) s -= 4;
    return -s;
  };
  return out.sort((a, b) => score(a) - score(b));
}
