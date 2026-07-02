// Caso de FALLO: una TERCERA persona intenta entrar a una sala que ya tiene 2.
// La señalización (dev y prod comparten límites) cierra el socket con 4001 y la
// UI debe decir "sala llena" claro. Se prueba con la v2 (no necesita ROM); el
// límite vive en la señalización, así que cubre también al online v1.
import { chromium } from "playwright";

const BASE = "http://localhost:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
let ok = true;
const check = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) ok = false; };
try {
  const st = (p) => p.evaluate(() => { const e = window.__v2; return e ? { frame: e.currentFrame } : null; }).catch(() => null);

  const ctxA = await browser.newContext();
  const A = await ctxA.newPage();
  await A.goto(BASE + "?nc=lockstep#v2", { waitUntil: "load" });
  await A.click("text=Crear partida");
  await sleep(600);
  const code = await A.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");
  console.log("  código:", code);

  const ctxB = await browser.newContext();
  const B = await ctxB.newPage();
  await B.goto(`${BASE}?room=${code}&nc=lockstep#v2`, { waitUntil: "load" });
  let playing = false;
  for (let i = 0; i < 20; i++) { await sleep(500); if ((await st(A))?.frame >= 0 && (await st(B))?.frame >= 0) { playing = true; break; } }
  check(playing, "2 peers en partida (sala completa)");

  // El TERCERO intenta entrar al mismo código.
  const ctxC = await browser.newContext();
  const C = await ctxC.newPage();
  await C.goto(`${BASE}?room=${code}&nc=lockstep#v2`, { waitUntil: "load" });
  let label = "";
  let isError = false;
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    label = await C.evaluate(() => document.querySelector(".pill-label")?.textContent || "");
    isError = await C.evaluate(() => !!document.querySelector(".pill.pill-error"));
    if (isError && label.includes("llena")) break;
  }
  check(isError && label.includes("llena"), `el 3° recibe "sala llena" (${JSON.stringify(label)})`);

  // Y los 2 de adentro siguen jugando como si nada.
  const fa = (await st(A))?.frame ?? -1;
  await sleep(1500);
  const fa2 = (await st(A))?.frame ?? -1;
  check(fa2 > fa, "la partida de los 2 originales sigue avanzando");

  console.log("\n===== SALA LLENA (3er jugador) =====");
  console.log(ok ? "✓ TODO OK: cap de 2 por sala con mensaje claro" : "✗ HAY FALLOS");
} finally {
  await browser.close();
  if (!ok) process.exitCode = 1;
}
