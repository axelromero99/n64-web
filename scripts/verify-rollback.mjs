// Verifica el ROLLBACK bajo LATENCIA artificial (?lat=80):
//  - la predicción se activa (predice > 0 y hay correcciones/rollbacks),
//  - pese a predecir con inputs distintos, los frames CONFIRMADOS tienen hashes
//    idénticos en ambos peers → el rollback corrige y mantiene el SYNC (fair).
import { chromium } from "playwright";

const BASE = "http://localhost:5173/";
const LAT = 80; // ms de latencia artificial por lado
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const info = (p) => p.evaluate(() => {
    const e = window.__v2;
    return e ? { cur: e.currentFrameNum, conf: e.confirmedFrameNum, rb: e.rollbackCount, desync: e.isDesync } : null;
  }).catch(() => null);

  const ctxA = await browser.newContext({ viewport: { width: 720, height: 600 } });
  const A = await ctxA.newPage();
  A.on("pageerror", (e) => console.log("  [A err]", e.message));
  await A.goto(`${BASE}?lat=${LAT}&nc=rollback#v2`, { waitUntil: "load" });
  await A.click("text=Crear partida"); await sleep(600);
  const code = await A.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");

  const ctxB = await browser.newContext({ viewport: { width: 720, height: 600 } });
  const B = await ctxB.newPage();
  B.on("pageerror", (e) => console.log("  [B err]", e.message));
  await B.goto(`${BASE}?room=${code}&lat=${LAT}&nc=rollback#v2`, { waitUntil: "load" });

  let ready = false;
  for (let i = 0; i < 25; i++) { await sleep(500); if ((await info(A))?.cur >= 0 && (await info(B))?.cur >= 0) { ready = true; break; } }
  if (!ready) throw new Error("motores no arrancaron");

  const jit = async (page, keys) => { for (const k of keys) { await page.keyboard.down(k); await sleep(200); await page.keyboard.up(k); await sleep(100); } };
  await A.bringToFront(); await jit(A, ["ArrowUp", "ArrowDown", "ArrowUp"]);
  await B.bringToFront(); await jit(B, ["ArrowDown", "ArrowUp"]);
  await sleep(3000);

  const ia = await info(A), ib = await info(B);
  console.log(`A: frame ${ia.cur}, confirmado ${ia.conf}, predice ${ia.cur - ia.conf}, rollbacks ${ia.rb}`);
  console.log(`B: frame ${ib.cur}, confirmado ${ib.conf}, predice ${ib.cur - ib.conf}, rollbacks ${ib.rb}`);

  // Comparar hashes CONFIRMADOS en un rango que ambos ya confirmaron.
  const top = Math.min(ia.conf, ib.conf) - 3, from = Math.max(5, top - 120);
  const gh = (page, lo, hi) => page.evaluate(([lo, hi]) => { const e = window.__v2, o = {}; for (let f = lo; f <= hi; f++) { const h = e.hashAt(f); if (h !== undefined) o[f] = h; } return o; }, [lo, hi]);
  const ha = await gh(A, from, top), hb = await gh(B, from, top);
  let comp = 0, bad = 0;
  for (let f = from; f <= top; f++) { if (ha[f] === undefined || hb[f] === undefined) continue; comp++; if (ha[f] !== hb[f]) bad++; }

  const predicted = (ia.cur - ia.conf) > 0 || (ib.cur - ib.conf) > 0 || ia.rb > 0 || ib.rb > 0;
  console.log("\n===== ROLLBACK bajo " + LAT + "ms de latencia =====");
  console.log(`predicción activa : ${predicted ? "sí" : "no"} (rollbacks A=${ia.rb} B=${ib.rb})`);
  console.log(`frames confirmados comparados: ${comp} · idénticos: ${comp - bad}/${comp}`);
  console.log(`desync: A=${ia.desync} B=${ib.desync}`);
  console.log(comp > 20 && bad === 0 && predicted && !ia.desync && !ib.desync
    ? "✓ ROLLBACK OK: predice con latencia y converge a estado confirmado idéntico (fair)"
    : "✗ revisar");
} finally { await browser.close(); }
