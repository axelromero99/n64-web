// PRUEBA DE FAIRNESS del netcode v2: dos peers AISLADOS corren la sim lockstep;
// se les inyectan inputs distintos a cada uno, y se confirma que sus hashes de
// estado COINCIDEN frame a frame. Si coinciden, ambos ven exactamente el mismo
// juego → cero ventaja (fairness real). Si difieren en algún frame → desync.
import { chromium } from "playwright";

const BASE = "http://localhost:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const st = (p) => p.evaluate(() => {
    const e = window.__v2;
    return e ? { frame: e.currentFrame, desync: e.isDesync } : null;
  }).catch(() => null);

  // Peer A crea la partida (LOCKSTEP explícito: este script prueba lockstep;
  // el rollback tiene el suyo en verify-rollback.mjs).
  const ctxA = await browser.newContext({ viewport: { width: 760, height: 620 } });
  const A = await ctxA.newPage();
  A.on("pageerror", (e) => console.log("  [A err]", e.message));
  await A.goto(BASE + "?nc=lockstep#v2", { waitUntil: "load" });
  await A.click("text=Crear partida");
  await sleep(600);
  const code = await A.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");
  console.log("código:", code);

  // Peer B se une (contexto aislado).
  const ctxB = await browser.newContext({ viewport: { width: 760, height: 620 } });
  const B = await ctxB.newPage();
  B.on("pageerror", (e) => console.log("  [B err]", e.message));
  await B.goto(`${BASE}?room=${code}&nc=lockstep#v2`, { waitUntil: "load" });

  // Esperar a que ambos motores arranquen.
  let ready = false;
  for (let i = 0; i < 20; i++) { await sleep(500); if ((await st(A))?.frame >= 0 && (await st(B))?.frame >= 0) { ready = true; break; } }
  if (!ready) throw new Error("los motores no arrancaron");
  console.log("ambos motores en marcha; inyectando inputs distintos a cada peer…");

  // Inputs DISTINTOS en cada peer para que la partida sea no trivial.
  const jitter = async (page, keys) => {
    for (const k of keys) { await page.keyboard.down(k); await sleep(250); await page.keyboard.up(k); await sleep(120); }
  };
  await A.bringToFront(); await jitter(A, ["ArrowUp", "ArrowUp", "ArrowDown"]);
  await B.bringToFront(); await jitter(B, ["ArrowDown", "ArrowUp", "ArrowDown"]);
  await A.bringToFront(); await jitter(A, ["ArrowDown", "ArrowUp"]);
  await sleep(2500);

  // Comparar hashes en un rango de frames que ambos ya pasaron.
  const fa = (await st(A)).frame, fb = (await st(B)).frame;
  const top = Math.min(fa, fb) - 5;
  const from = Math.max(10, top - 120);
  console.log(`frames A=${fa} B=${fb}; comparando hashes de ${from}..${top}`);

  const getHashes = (page, lo, hi) => page.evaluate(([lo, hi]) => {
    const e = window.__v2, out = {};
    for (let f = lo; f <= hi; f++) { const h = e.hashAt(f); if (h !== undefined) out[f] = h; }
    return out;
  }, [lo, hi]);

  const ha = await getHashes(A, from, top);
  const hb = await getHashes(B, from, top);

  let compared = 0, mismatches = 0, firstBad = null;
  for (let f = from; f <= top; f++) {
    if (ha[f] === undefined || hb[f] === undefined) continue;
    compared++;
    if (ha[f] !== hb[f]) { mismatches++; if (firstBad === null) firstBad = f; }
  }

  const desyncA = (await st(A)).desync, desyncB = (await st(B)).desync;
  console.log("\n===== FAIRNESS v2 (misma sim en ambos peers) =====");
  console.log(`frames comparados: ${compared}`);
  console.log(`hashes idénticos : ${compared - mismatches}/${compared}`);
  console.log(`flag desync      : A=${desyncA} B=${desyncB}`);
  if (mismatches === 0 && compared > 20) {
    console.log("✓ FAIRNESS OK: estado byte-idéntico en ambos peers en todos los frames → cero ventaja.");
  } else {
    console.log(`✗ divergencia en ${mismatches} frames (primero: ${firstBad}).`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
