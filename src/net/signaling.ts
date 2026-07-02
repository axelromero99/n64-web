// Señalización para el handshake WebRTC (intercambio de offer/answer/ICE + "join").
//
// Dos transportes con la MISMA interfaz `Signaling`:
//   - WebSocket (createWebSocketSignaling): real. Cruza incógnito↔normal y entre
//     máquinas por internet. En dev lo sirve el plugin de Vite en /signal; en
//     producción, un Worker + Durable Object de Cloudflare (VITE_SIGNALING_URL).
//   - BroadcastChannel (createLocalSignaling): fallback solo-mismo-navegador.
//
// `createSignaling()` elige el transporte según el entorno.

export interface SignalMessage {
  join?: boolean; // el guest anuncia su presencia (handshake independiente del orden)
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  ice?: RTCIceCandidateInit;
}

export interface Signaling {
  send(msg: SignalMessage): void;
  onMessage: (msg: SignalMessage) => void;
  onOpen?: () => void;
  onError?: (info: string) => void;
  close(): void;
}

/** URL del servicio de señalización. Vacío = usar same-origin /signal (dev). */
export function signalingUrl(room: string): string {
  const configured = import.meta.env.VITE_SIGNALING_URL as string | undefined;
  const override = new URLSearchParams(location.search).get("signal") || undefined;
  const base = override || configured;
  if (base) {
    const u = new URL(base);
    u.searchParams.set("room", room);
    return u.toString();
  }
  // Same-origin (dev server de Vite). ws:// o wss:// según el protocolo de la página.
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/signal?room=${encodeURIComponent(room)}`;
}

export function createWebSocketSignaling(room: string): Signaling {
  const ws = new WebSocket(signalingUrl(room));
  const outbox: string[] = [];
  const sig: Signaling = {
    send(msg) {
      const data = JSON.stringify(msg);
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
      else outbox.push(data); // encolar hasta que abra
    },
    onMessage: () => {},
    close() {
      try { ws.close(); } catch { /* noop */ }
    },
  };
  ws.onopen = () => {
    for (const d of outbox.splice(0)) ws.send(d);
    sig.onOpen?.();
  };
  ws.onmessage = (e) => {
    try { sig.onMessage(JSON.parse(e.data as string) as SignalMessage); } catch { /* ignorar */ }
  };
  ws.onerror = () => sig.onError?.("No se pudo conectar al servidor de señalización");
  return sig;
}

export function createLocalSignaling(room: string, role: "host" | "guest"): Signaling {
  const bc = new BroadcastChannel(`n64-signal-${room}`);
  const other = role === "host" ? "guest" : "host";
  const sig: Signaling = {
    send(msg) {
      bc.postMessage({ from: role, msg });
    },
    onMessage: () => {},
    close() {
      bc.close();
    },
  };
  bc.onmessage = (e) => {
    if (e.data?.from === other) sig.onMessage(e.data.msg as SignalMessage);
  };
  return sig;
}

/**
 * Elige el transporte. Por defecto WebSocket (real). Solo cae a BroadcastChannel
 * si se fuerza con ?signal=local (útil para debug offline).
 */
export function createSignaling(room: string, role: "host" | "guest"): Signaling {
  const forced = new URLSearchParams(location.search).get("signal");
  if (forced === "local") return createLocalSignaling(room, role);
  return createWebSocketSignaling(room);
}
