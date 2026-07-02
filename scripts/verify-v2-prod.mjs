// Verifica la fairness de la v2 contra el sitio DESPLEGADO (señalización real de
// Cloudflare): 2 peers aislados corren el lockstep y sus hashes deben coincidir.
import { chromium } from "playwright";

const BASE = "https://n64-web.axelromero99.workers.dev/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const st = (p) => p.evaluate(() => { const e = window.__v2; return e ? { frame: e.currentFrame, desync: e.isDesync } : null; }).catch(() => null);

  const ctxA = await browser.newContext({ viewport: { width: 720, height: 600 } });
  const A = await ctxA.newPage();
  A.on("pageerror", (e) => console.log("  [A err]", e.message));
  await A.goto(BASE + "#v2", { waitUntil: "load", timeout: 30000 });
  await A.click("text=Crear partida"); await sleep(700);
  const code = await A.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");
  console.log("código:", code);

  const ctxB = await browser.newContext({ viewport: { width: 720, height: 600 } });
  const B = await ctxB.newPage();
  B.on("pageerror", (e) => console.log("  [B err]", e.message));
  await B.goto(`${BASE}?room=${code}#v2`, { waitUntil: "load", timeout: 30000 });

  let ready = false;
  for (let i = 0; i < 25; i++) { await sleep(500); if ((await st(A))?.frame >= 0 && (await st(B))?.frame >= 0) { ready = true; break; } }
  if (!ready) throw new Error("motores no arrancaron en prod");

  const jitter = async (page, keys) => { for (const k of keys) { await page.keyboard.down(k); await sleep(220); await page.keyboard.up(k); await sleep(120); } };
  await A.bringToFront(); await jitter(A, ["ArrowUp", "ArrowDown", "ArrowUp"]);
  await B.bringToFront(); await jitter(B, ["ArrowDown", "ArrowUp"]);
  await sleep(2500);

  const fa = (await st(A)).frame, fb = (await st(B)).frame;
  const top = Math.min(fa, fb) - 5, from = Math.max(10, top - 120);
  const gh = (page, lo, hi) => page.evaluate(([lo, hi]) => { const e = window.__v2, o = {}; for (let f = lo; f <= hi; f++) { const h = e.hashAt(f); if (h !== undefined) o[f] = h; } return o; }, [lo, hi]);
  const ha = await gh(A, from, top), hb = await gh(B, from, top);
  let comp = 0, bad = 0;
  for (let f = from; f <= top; f++) { if (ha[f] === undefined || hb[f] === undefined) continue; comp++; if (ha[f] !== hb[f]) bad++; }

  console.log("\n===== FAIRNESS v2 EN PRODUCCIÓN =====");
  console.log(`frames comparados: ${comp}  ·  idénticos: ${comp - bad}/${comp}  ·  desync: A=${(await st(A)).desync} B=${(await st(B)).desync}`);
  console.log(bad === 0 && comp > 20 ? "✓ FAIRNESS OK en vivo (Cloudflare)" : `✗ ${bad} divergencias`);
} finally { await browser.close(); }
