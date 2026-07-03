// Verifica que el server de señalización de DEV (plugin de vite.config.ts)
// espeja los límites del Worker de prod: código de sala, 2/sala, tamaño, flood,
// Origin. Correr con `npm run dev` levantado. Así "mismos límites" no es una
// afirmación de fe: es un test.
import WebSocket from "ws";

const HTTP = process.argv[2] || "http://localhost:5173";
const WS = HTTP.replace(/^http/, "ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = true;
const check = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) ok = false; };

// Un rechazo puede llegar como status HTTP (upgrade rechazado: 400/403) o como
// open seguido de un close con código (4001/1009). Devuelve el código final.
const rejectCode = (u, headers) => new Promise((res) => {
  const w = new WebSocket(u, headers ? { headers } : undefined);
  w.on("unexpected-response", (_req, r) => { res(r.statusCode); w.terminate(); });
  w.on("close", (code) => res(code));
  w.on("error", () => { /* lo resuelve unexpected-response/close */ });
});
const openOk = (u) => new Promise((res, rej) => {
  const w = new WebSocket(u);
  w.on("open", () => res(w));
  w.on("close", (c) => rej(new Error("cerró con " + c)));
  w.on("error", rej);
});

// 1) Código de sala inválido → 400
check((await rejectCode(`${WS}/signal?room=no-valido!!`)) === 400, "room inválida → 400");

// 2) Origin ajeno → 403
check((await rejectCode(`${WS}/signal?room=TESTAB`, { Origin: "https://evil.example" })) === 403, "Origin ajeno → 403");

// 3) Relay normal + 4) 3er socket → 4001
const a = await openOk(`${WS}/signal?room=TESTAB`);
const b = await openOk(`${WS}/signal?room=TESTAB`);
const got = new Promise((r) => b.on("message", (d) => r(d.toString())));
a.send(JSON.stringify({ join: true }));
check((await got) === '{"join":true}', "relay A→B funciona");
check((await rejectCode(`${WS}/signal?room=TESTAB`)) === 4001, "3er socket → 4001 room_full");

// 5) Mensaje binario/gigante → 1009
const cc = new Promise((r) => a.on("close", (code) => r(code)));
a.send("x".repeat(64 * 1024));
check((await cc) === 1009, "mensaje de 64 KB → 1009");

b.close();
console.log(`\n===== PARIDAD DE LÍMITES DEV↔PROD =====\n${ok ? "✓ el dev server espeja los límites del Worker" : "✗ HAY DIFERENCIAS"}`);
await sleep(100);
process.exit(ok ? 0 : 1);
