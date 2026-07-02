# Señalización cross-máquina (el único cambio para jugar por internet)

Hoy el modo online usa `createLocalSignaling` (BroadcastChannel) → funciona entre
pestañas del **mismo** navegador. Para jugar entre **máquinas distintas** solo hay
que reemplazar esa pieza; el resto (WebRTC, video, input) no cambia, porque
`src/net/signaling.ts` define una interfaz `Signaling` estable.

## Opción A — atajo sin backend (deploy hoy)

Broker público de **PeerJS** o un servicio realtime (Ably/Pusher). Cero servidor
propio. Contra: dependés de un tercero y sin TURN algunos NAT no conectan.

## Opción B — Cloudflare Durable Object (recomendado, gratis)

Una "sala" por código = una instancia de Durable Object que reenvía mensajes de
señalización entre los 2 peers por WebSocket. Con **WebSocket Hibernation** las
salas inactivas no se cobran → cabe en el free tier holgado.

```js
// worker/signaling-do.js  (esqueleto)
export class Room {
  constructor(state) { this.sessions = []; }
  async fetch(req) {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.sessions.push(server);
    server.addEventListener("message", (e) => {
      // reenviar al OTRO peer de la sala
      for (const s of this.sessions) if (s !== server) s.send(e.data);
    });
    server.addEventListener("close", () => {
      this.sessions = this.sessions.filter((s) => s !== server);
    });
    return new Response(null, { status: 101, webSocket: client });
  }
}
export default {
  fetch(req, env) {
    const code = new URL(req.url).searchParams.get("room") || "sala1";
    const id = env.ROOM.idFromName(code);        // misma sala → mismo DO
    return env.ROOM.get(id).fetch(req);
  },
};
```

Y en el cliente, una implementación de `Signaling` sobre ese WebSocket:

```ts
export function createCloudflareSignaling(room: string): Signaling {
  const ws = new WebSocket(`wss://TU-WORKER.workers.dev/?room=${room}`);
  const sig: Signaling = { send: (m) => ws.send(JSON.stringify(m)), onMessage: () => {}, close: () => ws.close() };
  ws.onmessage = (e) => sig.onMessage(JSON.parse(e.data));
  return sig;
}
```

Cambiar en `src/net/online.ts` el `createLocalSignaling(...)` por
`createCloudflareSignaling(...)` y listo.

## STUN / TURN

- **STUN** (gratis): `stun:stun.cloudflare.com:3478` — ya está en `online.ts`.
- **TURN** (respaldo para NAT difíciles): **Cloudflare Realtime TURN**, 1 TB/mes
  gratis. Se agregan las credenciales al array `iceServers` de `RTCPeerConnection`.
