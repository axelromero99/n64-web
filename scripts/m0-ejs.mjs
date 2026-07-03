// M0 vía EmulatorJS (core N64 fiable). Navega al modo local, bootea la ROM real,
// introspecciona la API de estado y mide saveState/loadState + determinismo.
import { chromium } from "playwright";
import os from "node:os";

const ROM = process.env.ROM || "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const URL = "http://localhost:5173/#local";
const SHOT = os.tmpdir();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: false,
  args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => { const t = m.text(); if (!t.includes("[vite]")) console.log(`  [page:${m.type()}] ${t}`); });
  page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  console.log("→ Cargando ROM en modo local (EmulatorJS)…");
  await page.setInputFiles("input[type=file]", ROM);

  // Esperar a que EmulatorJS tenga gameManager (baja el core de su CDN).
  let ready = false;
  for (let i = 0; i < 150; i++) {
    await sleep(1000);
    ready = await page.evaluate(() => !!(window.EJS_emulator && window.EJS_emulator.gameManager)).catch(() => false);
    if (ready) break;
    if (i % 5 === 0) console.log(`   …esperando core EmulatorJS (${i}s)`);
  }
  if (!ready) {
    await page.screenshot({ path: `${SHOT}/m0ejs-fail.png` }).catch(() => {});
    throw new Error("EmulatorJS no expuso gameManager a tiempo");
  }
  console.log("✓ gameManager listo. Booteando a la pista (15s)…");
  await page.click("#game").catch(() => {});
  await sleep(15000);
  await page.screenshot({ path: `${SHOT}/m0ejs-booted.png` }).catch(() => {});

  const result = await page.evaluate(async () => {
    const out = { logs: [] };
    const gm = window.EJS_emulator.gameManager;
    const proto = Object.getPrototypeOf(gm);
    out.methods = Object.getOwnPropertyNames(proto).filter((n) => {
      try { return typeof gm[n] === "function"; } catch { return false; }
    });

    const getState = async () => { let s = gm.getState(); if (s && typeof s.then === "function") s = await s; return s; };
    const loadState = async (s) => { const r = gm.loadState(s); if (r && typeof r.then === "function") await r; };

    let anchor;
    try { anchor = await getState(); } catch (e) { out.error = "getState() lanzó: " + e; return out; }
    const len = anchor?.length ?? anchor?.byteLength;
    out.stateType = Object.prototype.toString.call(anchor);
    out.sizeBytes = len ?? null;
    if (!len) { out.error = "getState() no devolvió bytes"; return out; }

    const fnv = (u8) => { let h = 0x811c9dc5 >>> 0; for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193); } return h >>> 0; };
    const stats = (t) => { const s = [...t].sort((a, b) => a - b); return { avg: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(3), p50: +s[Math.floor(s.length / 2)].toFixed(3), min: +s[0].toFixed(3), max: +s[s.length - 1].toFixed(3) }; };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    try {
      const saveT = [];
      for (let i = 0; i < 25; i++) { const t0 = performance.now(); await getState(); saveT.push(performance.now() - t0); }
      out.save = stats(saveT);

      const loadT = [];
      for (let i = 0; i < 25; i++) { const t0 = performance.now(); await loadState(anchor); loadT.push(performance.now() - t0); }
      out.load = stats(loadT);

      // ¿avanza la emulación? (dos getState separados en el tiempo deben diferir)
      const a = fnv(await getState()); await sleep(400); const b = fnv(await getState());
      out.emulationAdvances = a !== b;

      // determinismo aproximado: loadState(S) -> correr 250ms -> hash, x6
      const hashes = [];
      for (let r = 0; r < 6; r++) { await loadState(anchor); await sleep(250); hashes.push(fnv(await getState())); }
      out.detHashes = hashes.map((h) => h.toString(16));
      out.detDistinct = new Set(hashes).size;
    } catch (e) {
      out.error = "medición falló: " + e;
    }
    return out;
  });

  console.log("\n========== M0 (EmulatorJS / mupen64plus_next) ==========");
  console.log("métodos gameManager:", (result.methods || []).join(", "));
  if (result.error) console.log("ERROR:", result.error);
  if (result.sizeBytes) {
    const mb = result.sizeBytes / (1024 * 1024);
    console.log(`\nestado: ${result.stateType}  ${result.sizeBytes} bytes = ${mb.toFixed(2)} MB`);
    if (result.save) console.log(`saveState: p50 ${result.save.p50} ms · avg ${result.save.avg} · min ${result.save.min} · max ${result.save.max}`);
    if (result.load) console.log(`loadState: p50 ${result.load.p50} ms · avg ${result.load.avg} · min ${result.load.min} · max ${result.load.max}`);
    console.log(`emulación avanza: ${result.emulationAdvances}`);
    console.log(`determinismo aprox: ${result.detDistinct} hash(es) distintos → ${result.detHashes?.join(", ")}`);
    if (result.save) {
      const bufMB = (result.sizeBytes * 120) / (1024 * 1024);
      console.log(`\nanálisis rollback: guardar 1/frame = ${((result.save.p50 / 16.67) * 100).toFixed(0)}% del presupuesto; buffer 120f ≈ ${bufMB.toFixed(0)} MB`);
    }
  }
  await page.screenshot({ path: `${SHOT}/m0ejs-done.png` }).catch(() => {});
} finally {
  await browser.close();
}
