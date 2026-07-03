import { defineConfig } from "vite";
import { WebSocketServer } from "ws";

// COOP/COEP: habilita SharedArrayBuffer (hilos/SIMD del core WASM). Usamos
// "credentialless" para no romper la carga del core de EmulatorJS desde su CDN.
const crossOriginIsolation = {
  name: "cross-origin-isolation",
  configureServer(server: any) {
    server.middlewares.use((_req: any, res: any, next: any) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
      next();
    });
  },
};

// Servidor de señalización WebSocket EN PROCESO, para que `npm run dev` sirva
// señalización real sin un proceso aparte. Relayea mensajes entre los peers de
// una misma sala. Esto arregla incógnito↔normal en la misma máquina (a diferencia
// de BroadcastChannel, un WebSocket no está aislado por contexto de navegación).
//
// En producción esto NO existe: ahí la sirve el mismo Worker que sirve el
// frontend (worker/signaling.js, same-origin /signal). Réplica FIEL de sus
// límites (código de sala, 2/sala, tamaño, flood, Origin) para que un test que
// pase en dev refleje el comportamiento de prod.
const ROOM_RE = /^[A-Z0-9]{4,8}$/;
const MAX_MSG_CHARS = 32 * 1024;
const MAX_MSGS_PER_SOCKET = 500;

// Réplica del check de Origin del Worker (worker/signaling.js): un cliente
// no-navegador puede falsear el Origin — esto solo corta el drive-by.
function devOriginOk(req: any, url: URL): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return o.host === url.host || o.hostname === "localhost" || o.hostname === "127.0.0.1";
  } catch { return false; }
}

// Rechaza el upgrade con un status HTTP y cierra el socket crudo (sin abrir WS).
function rejectUpgrade(socket: any, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\n\r\n`);
  socket.destroy();
}

const signalingServer = {
  name: "signaling-ws",
  configureServer(server: any) {
    const wss = new WebSocketServer({ noServer: true });
    const rooms = new Map<string, Set<any>>();

    server.httpServer?.on("upgrade", (req: any, socket: any, head: any) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/signal") return; // dejar pasar el HMR de Vite
      if (!devOriginOk(req, url)) return rejectUpgrade(socket, 403, "Forbidden");
      const room = (url.searchParams.get("room") || "").toUpperCase();
      if (!ROOM_RE.test(room)) return rejectUpgrade(socket, 400, "Bad Request");
      wss.handleUpgrade(req, socket, head, (ws: any) => {
        let peers = rooms.get(room);
        if (!peers) rooms.set(room, (peers = new Set()));
        // Sala llena: mismo código de cierre que el Worker (4001 "room_full").
        if (peers.size >= 2) { ws.close(4001, "room_full"); return; }
        peers.add(ws);
        let count = 0;
        ws.on("message", (data: any, isBinary: boolean) => {
          if (isBinary || data.length > MAX_MSG_CHARS) { ws.close(1009, "mensaje inválido"); return; }
          if (++count > MAX_MSGS_PER_SOCKET) { ws.close(1008, "demasiados mensajes"); return; }
          const text = data.toString();
          // Relay a los OTROS peers de la sala (no a sí mismo).
          for (const p of peers!) if (p !== ws && p.readyState === 1) p.send(text);
        });
        ws.on("close", () => {
          peers!.delete(ws);
          if (peers!.size === 0) rooms.delete(room);
        });
      });
    });
  },
};

export default defineConfig({
  plugins: [crossOriginIsolation, signalingServer],
  server: { port: 5173 },
});
