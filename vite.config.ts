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
// En producción (Cloudflare Pages estático) esto NO existe: ahí el cliente apunta
// a un Worker + Durable Object (VITE_SIGNALING_URL). Mismo protocolo. Ver worker/.
const signalingServer = {
  name: "signaling-ws",
  configureServer(server: any) {
    const wss = new WebSocketServer({ noServer: true });
    const rooms = new Map<string, Set<any>>();

    server.httpServer?.on("upgrade", (req: any, socket: any, head: any) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/signal") return; // dejar pasar el HMR de Vite
      const room = url.searchParams.get("room") || "default";
      wss.handleUpgrade(req, socket, head, (ws: any) => {
        let peers = rooms.get(room);
        if (!peers) rooms.set(room, (peers = new Set()));
        peers.add(ws);
        ws.on("message", (data: any) => {
          // Relay a los OTROS peers de la sala (no a sí mismo).
          for (const p of peers!) if (p !== ws && p.readyState === 1) p.send(data.toString());
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
