// Caso de FALLO: unirse a una sala/partida que NO existe. Tanto el online v1
// como la v2 deben avisar claramente (no un spinner infinito). No necesita ROM.
import { chromium } from "playwright";

const BASE = "http://localhost:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
let ok = true;
const check = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) ok = false; };
try {
  // --- v1: guest a sala inexistente ---
  const p1 = await browser.newPage();
  await p1.goto(`${BASE}?room=ZZZZZ#online`, { waitUntil: "load" });
  let s1 = null;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    s1 = await p1.evaluate(() => window.__n64net || null).catch(() => null);
    if (s1?.phase === "error") break;
  }
  check(s1?.phase === "error", `v1: fase error al no haber host (${JSON.stringify(s1?.connection)})`);
  check((s1?.connection || "").includes("no encuentro"), "v1: mensaje claro de sala inexistente");
  await p1.close();

  // --- v2: join a partida inexistente ---
  const p2 = await browser.newPage();
  await p2.goto(`${BASE}?room=ZZZZZ#v2`, { waitUntil: "load" });
  let label = "";
  let isError = false;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    label = await p2.evaluate(() => document.querySelector(".pill-label")?.textContent || "");
    isError = await p2.evaluate(() => !!document.querySelector(".pill.pill-error"));
    if (isError) break;
  }
  check(isError, `v2: pill en error al no haber rival (${JSON.stringify(label)})`);
  check(label.includes("no encuentro"), "v2: mensaje claro de partida inexistente");
  await p2.close();

  console.log("\n===== CÓDIGO INVÁLIDO / SIN HOST =====");
  console.log(ok ? "✓ TODO OK: ambos modos avisan claro" : "✗ HAY FALLOS");
} finally {
  await browser.close();
  if (!ok) process.exitCode = 1;
}
