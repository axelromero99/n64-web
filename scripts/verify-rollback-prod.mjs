// Igual que verify-rollback pero contra el sitio DESPLEGADO (señalización real).
import { chromium } from "playwright";
const BASE = "https://n64-web.axelromero99.workers.dev/";
const LAT = 80;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const info = (p) => p.evaluate(() => { const e = window.__v2; return e ? { cur: e.currentFrameNum, conf: e.confirmedFrameNum, rb: e.rollbackCount, desync: e.isDesync } : null; }).catch(() => null);
  const ctxA = await browser.newContext({ viewport: { width: 720, height: 600 } });
  const A = await ctxA.newPage(); A.on("pageerror", (e) => console.log("[A]", e.message));
  await A.goto(`${BASE}?lat=${LAT}&nc=rollback&debug=1#v2`, { waitUntil: "load", timeout: 30000 });
  await A.click("text=Crear partida"); await sleep(700);
  const code = await A.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");
  const ctxB = await browser.newContext({ viewport: { width: 720, height: 600 } });
  const B = await ctxB.newPage(); B.on("pageerror", (e) => console.log("[B]", e.message));
  await B.goto(`${BASE}?room=${code}&lat=${LAT}&nc=rollback&debug=1#v2`, { waitUntil: "load", timeout: 30000 });
  let ready = false;
  for (let i = 0; i < 30; i++) { await sleep(500); if ((await info(A))?.cur >= 0 && (await info(B))?.cur >= 0) { ready = true; break; } }
  if (!ready) throw new Error("no arrancaron");
  const jit = async (page, keys) => { for (const k of keys) { await page.keyboard.down(k); await sleep(200); await page.keyboard.up(k); await sleep(100); } };
  await A.bringToFront(); await jit(A, ["ArrowUp", "ArrowDown"]);
  await B.bringToFront(); await jit(B, ["ArrowDown", "ArrowUp"]);
  await sleep(3000);
  const ia = await info(A), ib = await info(B);
  const top = Math.min(ia.conf, ib.conf) - 3, from = Math.max(5, top - 100);
  const gh = (page, lo, hi) => page.evaluate(([lo, hi]) => { const e = window.__v2, o = {}; for (let f = lo; f <= hi; f++) { const h = e.hashAt(f); if (h !== undefined) o[f] = h; } return o; }, [lo, hi]);
  const ha = await gh(A, from, top), hb = await gh(B, from, top);
  let comp = 0, bad = 0;
  for (let f = from; f <= top; f++) { if (ha[f] === undefined || hb[f] === undefined) continue; comp++; if (ha[f] !== hb[f]) bad++; }
  console.log("\n===== ROLLBACK EN PRODUCCIÓN (lat " + LAT + "ms) =====");
  console.log(`rollbacks A=${ia.rb} B=${ib.rb} · confirmados idénticos ${comp - bad}/${comp} · desync A=${ia.desync} B=${ib.desync}`);
  const ok = comp > 15 && bad === 0 && (ia.rb > 0 || ib.rb > 0) && !ia.desync;
  console.log(ok ? "✓ OK en vivo" : "✗ revisar");
  if (!ok) process.exitCode = 1;
} finally { await browser.close(); }
