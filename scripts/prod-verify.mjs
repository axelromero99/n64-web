// Verifica el sitio DESPLEGADO en Cloudflare de punta a punta:
// carga la página, host crea sala, guest (contexto aislado) abre el invite link
// y se conecta usando la señalización REAL del Worker. Todo en producción.
import { chromium } from "playwright";
import os from "node:os";

const ROM = "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const BASE = "https://n64-web.axelromero99.workers.dev/";
const SHOT = os.tmpdir();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
try {
  const getState = (p) => p.evaluate(() => window.__n64net || null).catch(() => null);

  // Comprobar carga + cross-origin isolation en producción
  const ctxHost = await browser.newContext({ viewport: { width: 900, height: 720 } });
  const host = await ctxHost.newPage();
  host.on("pageerror", (e) => console.log("  [host err]", e.message));
  const resp = await host.goto(BASE + "?debug=1", { waitUntil: "load", timeout: 30000 });
  console.log("página status:", resp?.status());
  // COOP/COEP tienen que llegar desde el _headers de Workers Assets; sin ellas
  // no hay cross-origin isolation (SharedArrayBuffer) y el core WASM se degrada.
  const hd = resp?.headers() ?? {};
  const coop = hd["cross-origin-opener-policy"] === "same-origin";
  const coep = hd["cross-origin-embedder-policy"] === "credentialless";
  const coi = await host.evaluate(() => globalThis.crossOriginIsolated);
  console.log(`COOP: ${hd["cross-origin-opener-policy"]} · COEP: ${hd["cross-origin-embedder-policy"]} · crossOriginIsolated: ${coi}`);
  await host.screenshot({ path: `${SHOT}/prod-landing.png` });

  // Host crea sala
  await host.evaluate(() => (location.hash = "online"));
  await sleep(400);
  await host.click("text=Crear una sala");
  await sleep(300);
  await host.setInputFiles("input[type=file]", ROM);
  console.log("→ host cargó ROM, esperando sala…");
  for (let i = 0; i < 25; i++) { await sleep(1000); if ((await getState(host))?.phase === "waiting") break; }
  const code = await host.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");
  console.log("   código de sala:", code);
  const invite = `${BASE}?room=${code}&debug=1#online`;

  // Guest en contexto AISLADO abre el invite link (señalización via Worker)
  const ctxGuest = await browser.newContext({ viewport: { width: 900, height: 720 } });
  const guest = await ctxGuest.newPage();
  guest.on("pageerror", (e) => console.log("  [guest err]", e.message));
  await guest.goto(invite, { waitUntil: "load", timeout: 30000 });
  console.log("→ guest abrió invite link (prod):", invite);

  let ok = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const h = await getState(host), g = await getState(guest);
    if (i % 4 === 0) console.log(`   host=${h?.phase} guest=${g?.phase} rtt=${g?.rttMs}`);
    if (h?.phase === "connected" && g?.phase === "connected") { ok = true; break; }
  }
  // esperar render del juego en el guest
  let bright = 0;
  for (let i = 0; i < 20 && ok; i++) {
    await sleep(1000);
    bright = await guest.evaluate(() => {
      const v = document.querySelector(".stage video");
      if (!v || !v.videoWidth) return 0;
      const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
      const g = c.getContext("2d"); g.drawImage(v, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return Math.round(s / (d.length / 4));
    });
    if (bright > 30) break;
  }
  await guest.screenshot({ path: `${SHOT}/prod-guest.png` });

  const gs = await getState(guest);
  console.log("\n===== PRODUCCIÓN (Cloudflare en vivo) =====");
  console.log(`página carga     : ${resp?.status() === 200 ? "OK" : "FALLÓ"}`);
  console.log(`COOP/COEP        : ${coop && coep ? "OK" : "FALLARON (revisar _headers / Workers Assets)"}`);
  console.log(`cross-origin iso : ${coi ? "OK (SharedArrayBuffer ok)" : "NO"}`);
  console.log(`invite + conexión: ${ok ? "OK" : "FALLÓ"}`);
  console.log(`video en vivo    : ${bright > 30 ? "OK (brillo " + bright + ")" : "aún negro/boot"}  rtt=${gs?.rttMs}ms`);
  if (!(resp?.status() === 200 && coop && coep && coi && ok && bright > 30)) process.exitCode = 1;
} finally {
  await browser.close();
}
