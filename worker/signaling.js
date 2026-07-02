// Señalización WebRTC en producción: Worker + Durable Object de Cloudflare.
// Una "sala" (por código) = una instancia de Durable Object que relayea mensajes
// de señalización entre los 2 peers. Mismo protocolo que el plugin de dev en
// vite.config.ts, así que el cliente no cambia.
//
// Deploy:
//   cd worker && npx wrangler deploy
// Luego poné en el build del frontend:
//   VITE_SIGNALING_URL = wss://<tu-worker>.workers.dev/signal
//
// Free tier: los Durable Objects con SQLite entran en el plan gratis, y con
// WebSocket Hibernation las salas inactivas no se cobran.

export class SignalRoom {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Se esperaba un WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation API: la sala no se cobra mientras está inactiva.
    this.state.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  // Relay: reenviar cada mensaje a los OTROS sockets de la sala.
  webSocketMessage(ws, message) {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // /signal → señalización (Durable Object por sala).
    if (url.pathname === "/signal") {
      const room = url.searchParams.get("room") || "default";
      const id = env.SIGNAL_ROOM.idFromName(room); // mismo código de sala → mismo DO
      return env.SIGNAL_ROOM.get(id).fetch(request);
    }
    // Cualquier otra ruta → servir el frontend estático (dist/).
    return env.ASSETS.fetch(request);
  },
};
