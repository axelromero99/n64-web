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
    try {
      const u = new URL(base);
      u.searchParams.set("room", room);
      return u.toString();
    } catch { /* ?signal= inválido → caer al same-origin */ }
  }
  // Same-origin (dev server de Vite). ws:// o wss:// según el protocolo de la página.
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/signal?room=${encodeURIComponent(room)}`;
}

// Código de cierre que emite el servidor cuando la sala ya tiene 2 peers.
const CLOSE_ROOM_FULL = 4001;

export function createWebSocketSignaling(room: string): Signaling {
  let ws: WebSocket | null = null;
  const outbox: string[] = [];
  let closedByUs = false;
  let retries = 0;

  const sig: Signaling = {
    send(msg) {
      const data = JSON.stringify(msg);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
      else outbox.push(data); // encolar hasta que (re)abra
    },
    onMessage: () => {},
    close() {
      closedByUs = true;
      try { ws?.close(); } catch { /* noop */ }
    },
  };

  const open = () => {
    ws = new WebSocket(signalingUrl(room));
    ws.onopen = () => {
      retries = 0;
      for (const d of outbox.splice(0)) ws!.send(d);
      sig.onOpen?.();
    };
    ws.onmessage = (e) => {
      try { sig.onMessage(JSON.parse(e.data as string) as SignalMessage); } catch { /* mensaje ajeno: ignorar */ }
    };
    // Un cierre inesperado (server reiniciado, red) se reintenta con backoff;
    // la cola retiene lo que se quiera enviar mientras tanto. "Sala llena" es
    // definitivo: avisar y no reintentar.
    ws.onclose = (e) => {
      if (closedByUs) return;
      if (e.code === CLOSE_ROOM_FULL) {
        sig.onError?.("esa sala ya está llena (las partidas son de a 2)");
        return;
      }
      if (retries < 5) {
        retries++;
        window.setTimeout(() => { if (!closedByUs) open(); }, 1000 * retries);
      } else {
        sig.onError?.("no pude conectar con el servidor de la sala — revisá tu internet y recargá");
      }
    };
    ws.onerror = () => { /* el onclose que sigue decide: reintento o error final */ };
  };
  open();
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
