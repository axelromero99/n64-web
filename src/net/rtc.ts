// Utilidades WebRTC del modo online: config ICE (STUN + TURN opcional), poll
// de RTT y los helpers que evitan las razas clásicas de señalización.

export const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }],
};

/**
 * Config ICE completa: STUN siempre y, si el servidor tiene TURN configurado
 * (opcional — ver la sección TURN de DEPLOY.md), credenciales efímeras de
 * Cloudflare como relay de respaldo para NAT muy cerrados. Cualquier fallo o
 * ausencia (dev, sin secrets, timeout) degrada silenciosamente a STUN solo.
 */
export async function iceConfig(): Promise<RTCConfiguration> {
  try {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), 2000);
    const r = await fetch("/turn", { signal: ctl.signal });
    window.clearTimeout(t);
    if (r.status !== 200) return ICE_CONFIG;
    const data = (await r.json()) as { iceServers?: RTCIceServer | RTCIceServer[] };
    const turn = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    if (turn.length === 0) return ICE_CONFIG;
    return { iceServers: [...(ICE_CONFIG.iceServers ?? []), ...turn] };
  } catch {
    return ICE_CONFIG;
  }
}

/**
 * Hooks de debug en window (__n64net, __n64hostPc, …): solo en dev o con
 * ?debug=1 explícito. En producción normal no se exponen — los scripts de
 * verificación contra prod pasan ?debug=1 en la URL.
 */
export const DEBUG_HOOKS: boolean =
  import.meta.env.DEV || new URLSearchParams(location.search).has("debug");

// Lo que necesitamos de la entrada candidate-pair de getStats() (el RTT real).
interface CandidatePairStats {
  type: string;
  nominated?: boolean;
  currentRoundTripTime?: number;
}

/** Pollea el RTT del par ICE conectado cada 1.5 s. Devuelve el cleanup. */
export function pollRtt(pc: RTCPeerConnection, onRtt: (ms: number | null) => void): () => void {
  const id = window.setInterval(async () => {
    if (pc.connectionState !== "connected") return;
    try {
      const stats = await pc.getStats();
      let rtt: number | null = null;
      stats.forEach((r) => {
        const p = r as unknown as CandidatePairStats;
        if (p.type === "candidate-pair" && p.nominated && p.currentRoundTripTime != null) {
          rtt = Math.round(p.currentRoundTripTime * 1000);
        }
      });
      onRtt(rtt);
    } catch { /* stats no disponibles: reintenta en el próximo tick */ }
  }, 1500);
  return () => window.clearInterval(id);
}

/**
 * Serializa handlers async de señalización: los mensajes se procesan DE A UNO,
 * en orden de llegada. Sin esto, un `ice` puede ejecutarse mientras el
 * setRemoteDescription(offer) anterior sigue pendiente -> addIceCandidate tira
 * InvalidStateError y el candidato se pierde (conexiones lentas o fallidas).
 */
export function serializeMessages<T>(handle: (msg: T) => Promise<void>): (msg: T) => void {
  let chain: Promise<void> = Promise.resolve();
  return (msg) => {
    chain = chain.then(() => handle(msg)).catch((e) => console.warn("[net] mensaje de señalización descartado:", e));
  };
}

/**
 * Buffer de candidatos ICE remotos. addIceCandidate falla si todavía no hay
 * remoteDescription (llegada fuera de orden, reconexión): en vez de perderlos,
 * se guardan y se aplican todos con flush() cuando la descripción remota está.
 */
export class RemoteCandidates {
  private pending: RTCIceCandidateInit[] = [];
  constructor(private readonly pc: RTCPeerConnection) {}
  async add(c: RTCIceCandidateInit): Promise<void> {
    if (this.pc.remoteDescription) await this.pc.addIceCandidate(c).catch(() => { /* candidato viejo/ajeno */ });
    else this.pending.push(c);
  }
  async flush(): Promise<void> {
    for (const c of this.pending.splice(0)) {
      await this.pc.addIceCandidate(c).catch(() => { /* candidato viejo/ajeno */ });
    }
  }
}

/**
 * Vigila el ciclo de vida de la conexión. "disconnected" suele ser transitorio
 * (blip de WiFi, cambio de red) y WebRTC puede recuperarse solo, así que se le
 * da un período de gracia antes de darla por muerta; "failed" es terminal ya.
 * onLost se dispara UNA vez por conexión perdida.
 */
export function watchConnection(pc: RTCPeerConnection, opts: {
  graceMs?: number;
  onState?: (st: RTCPeerConnectionState) => void;
  onLost: () => void;
}): void {
  const grace = opts.graceMs ?? 5000;
  let timer = 0;
  let lost = false;
  const die = () => {
    if (lost) return;
    lost = true;
    window.clearTimeout(timer);
    opts.onLost();
  };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    opts.onState?.(st);
    if (st === "connected") {
      window.clearTimeout(timer);
      timer = 0;
    } else if (st === "disconnected") {
      if (!timer) timer = window.setTimeout(die, grace);
    } else if (st === "failed" || st === "closed") {
      die();
    }
  };
}
