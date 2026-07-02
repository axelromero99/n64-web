// Señalización WebRTC en producción: Worker + Durable Object de Cloudflare.
// Una "sala" (por código) = una instancia de Durable Object que relayea mensajes
// de señalización entre los 2 peers. Mismo protocolo (y mismos límites) que el
// plugin de dev en vite.config.ts, así que el cliente no cambia.
//
// Deploy: `npm run deploy` desde la raíz del repo (el wrangler.toml de la raíz
// sirve el frontend dist/ Y esta señalización, same-origin en /signal).
//
// Límites anti-abuso (esto es un relay público):
//   - código de sala: 4-8 caracteres alfanuméricos
//   - máx. 2 sockets por sala (el 3° se cierra con código 4001 "room_full")
//   - solo mensajes de TEXTO de hasta 32 KB (un SDP real pesa < 10 KB)
//   - máx. 500 mensajes por socket (una señalización real usa < 100)
//   - Origin: mismo host del Worker (o localhost, para probar contra prod)
//
// Free tier: los Durable Objects con SQLite entran en el plan gratis, y con
// WebSocket Hibernation las salas inactivas no se cobran.

const ROOM_RE = /^[A-Z0-9]{4,8}$/;
const MAX_MSG_CHARS = 32 * 1024;
const MAX_MSGS_PER_SOCKET = 500;
// Mismo código en el cliente (src/net/signaling.ts) y el plugin de dev.
const CLOSE_ROOM_FULL = 4001;

export class SignalRoom {
  constructor(state) {
    this.state = state;
    // Contador best-effort (se resetea si la sala hiberna; alcanza para frenar
    // un flood, que es su único propósito).
    this.msgCount = new WeakMap();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Se esperaba un WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Sala llena: aceptamos y cerramos con un código propio, así el cliente
    // puede mostrar "sala llena" (rechazar el upgrade no distingue la causa).
    if (this.state.getWebSockets().length >= 2) {
      server.accept();
      server.close(CLOSE_ROOM_FULL, "room_full");
      return new Response(null, { status: 101, webSocket: client });
    }

    // Hibernation API: la sala no se cobra mientras está inactiva.
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Relay: reenviar cada mensaje a los OTROS sockets de la sala.
  webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > MAX_MSG_CHARS) {
      try { ws.close(1009, "mensaje inválido"); } catch { /* noop */ }
      return;
    }
    const n = (this.msgCount.get(ws) || 0) + 1;
    this.msgCount.set(ws, n);
    if (n > MAX_MSGS_PER_SOCKET) {
      try { ws.close(1008, "demasiados mensajes"); } catch { /* noop */ }
      return;
    }
    for (const peer of this.state.getWebSockets()) {
      if (peer !== ws) {
        try { peer.send(message); } catch { /* peer cerrado */ }
      }
    }
  }

  webSocketClose(ws) {
    try { ws.close(); } catch { /* noop */ }
  }
}

// Anti drive-by: que otra página web no pueda usar esta señalización de relay
// gratis. (Un cliente no-navegador puede falsear el Origin — esto no es un
// esquema de auth, solo corta el abuso barato.)
function allowedOrigin(request, url) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return o.host === url.host || o.hostname === "localhost" || o.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // /signal → señalización (Durable Object por sala).
    if (url.pathname === "/signal") {
      if (!allowedOrigin(request, url)) return new Response("Origin no permitido", { status: 403 });
      const room = (url.searchParams.get("room") || "").toUpperCase();
      if (!ROOM_RE.test(room)) return new Response("Código de sala inválido", { status: 400 });
      const id = env.SIGNAL_ROOM.idFromName(room); // mismo código de sala → mismo DO
      return env.SIGNAL_ROOM.get(id).fetch(request);
    }
    // /turn → credenciales TURN efímeras (OPCIONAL, ver DEPLOY.md). TURN es el
    // relay de respaldo para NAT muy cerrados (~5-10 % de pares no conectan
    // P2P directo). Si los secrets no están configurados, 204 y el cliente
    // sigue con STUN solo — nada se rompe.
    if (url.pathname === "/turn") {
      if (!allowedOrigin(request, url)) return new Response("Origin no permitido", { status: 403 });
      if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) return new Response(null, { status: 204 });
      try {
        const resp = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ ttl: 600 }), // credenciales de 10 min, por sesión
          },
        );
        if (!resp.ok) return new Response(null, { status: 204 }); // degradar a STUN
        return new Response(await resp.text(), {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      } catch {
        return new Response(null, { status: 204 });
      }
    }
    // Cualquier otra ruta → servir el frontend estático (dist/).
    return env.ASSETS.fetch(request);
  },
};
