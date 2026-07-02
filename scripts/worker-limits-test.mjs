// Prueba los LÍMITES del Worker de señalización (correr con `npx wrangler dev`
// levantado, o pasar la URL de prod como argumento):
//   node scripts/worker-limits-test.mjs [http://localhost:8787]
//  - código de sala inválido → HTTP 400
//  - /signal sin Upgrade → HTTP 426
//  - relay normal entre 2 peers → funciona
//  - 3er socket en la sala → close 4001 "room_full"
//  - mensaje gigante (>32 KB) → close 1009
import WebSocket from "ws";

const HTTP = process.argv[2] || "http://localhost:8787";
const WS = HTTP.replace(/^http/, "ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = true;
const check = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) ok = false; };

// 1) Código inválido → 400
const r400 = await fetch(`${HTTP}/signal?room=no-valido!!`);
check(r400.status === 400, `room inválida → 400 (fue ${r400.status})`);

// 2) Sin Upgrade → 426
const r426 = await fetch(`${HTTP}/signal?room=TESTAB`);
check(r426.status === 426, `sin Upgrade → 426 (fue ${r426.status})`);

// 3) Relay normal entre 2 peers
const url = `${WS}/signal?room=TESTAB`;
const openWs = (u) => new Promise((res, rej) => {
  const w = new WebSocket(u);
  w.on("open", () => res(w));
  w.on("error", rej);
});
const a = await openWs(url);
const b = await openWs(url);
const got = new Promise((res) => b.on("message", (d) => res(d.toString())));
a.send(JSON.stringify({ join: true }));
check((await got) === '{"join":true}', "relay A→B funciona");

// 4) 3er socket → close 4001
const cClose = new Promise((res) => {
  const c = new WebSocket(url);
  c.on("close", (code, reason) => res({ code, reason: reason.toString() }));
  c.on("error", () => res({ code: -1, reason: "error" }));
});
const third = await cClose;
check(third.code === 4001, `3er socket → close 4001 "room_full" (fue ${third.code} ${third.reason})`);

// 5) Mensaje gigante → close 1009 (y no debe llegar al otro peer)
let leaked = false;
b.on("message", () => (leaked = true));
const aClose = new Promise((res) => a.on("close", (code) => res(code)));
a.send("x".repeat(64 * 1024));
check((await aClose) === 1009, "mensaje de 64 KB → close 1009");
await sleep(300);
check(!leaked, "el mensaje gigante NO se relayeó");

b.close();
console.log("\n===== LÍMITES DEL WORKER =====");
console.log(ok ? "✓ TODO OK" : "✗ HAY FALLOS");
if (!ok) process.exitCode = 1;
