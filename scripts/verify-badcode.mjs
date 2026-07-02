// Caso de FALLO: unirse a una sala que NO existe. Debe avisar claramente
// (no un spinner infinito). No necesita ROM.
import { chromium } from "playwright";

const BASE = "http://localhost:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
let ok = true;
const check = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) ok = false; };
try {
  const p1 = await browser.newPage();
  await p1.goto(`${BASE}?room=ZZZZZ#online`, { waitUntil: "load" });
  let s1 = null;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    s1 = await p1.evaluate(() => window.__n64net || null).catch(() => null);
    if (s1?.phase === "error") break;
  }
  check(s1?.phase === "error", `fase error al no haber host (${JSON.stringify(s1?.connection)})`);
  check((s1?.connection || "").includes("no encuentro"), "mensaje claro de sala inexistente");
  await p1.close();

  console.log("\n===== CÓDIGO INVÁLIDO / SIN HOST =====");
  console.log(ok ? "✓ TODO OK: avisa claro" : "✗ HAY FALLOS");
} finally {
  await browser.close();
  if (!ok) process.exitCode = 1;
}
