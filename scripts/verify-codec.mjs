// Confirma que el video negocia VP9/H264 (no VP8) y reporta resolución/bitrate
// reales recibidos por el guest, leídos desde getStats().
import { chromium } from "playwright";

const ROM = "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const BASE = "http://localhost:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
try {
  const getState = (p) => p.evaluate(() => window.__n64net || null).catch(() => null);

  const ctxHost = await browser.newContext({ viewport: { width: 800, height: 640 } });
  const host = await ctxHost.newPage();
  host.on("pageerror", (e) => console.log("  [host err]", e.message));
  await host.goto(BASE + "#online", { waitUntil: "load" });
  await host.click("text=Crear una sala");
  await sleep(300);
  await host.setInputFiles("input[type=file]", ROM);
  for (let i = 0; i < 30; i++) { await sleep(1000); if ((await getState(host))?.phase === "waiting") break; }

  const code = await host.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");
  const ctxGuest = await browser.newContext({ viewport: { width: 800, height: 640 } });
  const guest = await ctxGuest.newPage();
  await guest.goto(`${BASE}?room=${code}#online`, { waitUntil: "load" });
  for (let i = 0; i < 30; i++) { await sleep(1000); if ((await getState(guest))?.phase === "connected") break; }
  await sleep(8000); // dejar fluir el video para stats estables

  const info = await guest.evaluate(async () => {
    const pc = window.__n64guestPc;
    if (!pc) return { err: "no pc" };
    const s = await pc.getStats();
    let codec = "?", w = 0, h = 0, kbps = 0, fps = 0, jitterBuf = null;
    const codecs = {};
    s.forEach((r) => { if (r.type === "codec") codecs[r.id] = r.mimeType; });
    s.forEach((r) => {
      if (r.type === "inbound-rtp" && r.kind === "video") {
        codec = codecs[r.codecId] || "?";
        w = r.frameWidth || 0; h = r.frameHeight || 0; fps = r.framesPerSecond || 0;
        jitterBuf = r.jitterBufferDelay != null && r.jitterBufferEmittedCount ? (r.jitterBufferDelay / r.jitterBufferEmittedCount * 1000) : null;
      }
    });
    const v = document.querySelector(".stage video");
    return { codec, w: w || v?.videoWidth, h: h || v?.videoHeight, fps, jitterBufMs: jitterBuf };
  });

  console.log("\n===== CALIDAD / LATENCIA DEL VIDEO (guest) =====");
  console.log(`codec negociado : ${info.codec}  ${/VP9|H264/i.test(info.codec || "") ? "✓ (mejor que VP8)" : "(VP8 fallback)"}`);
  console.log(`resolución       : ${info.w}x${info.h} @ ${info.fps}fps`);
  console.log(`jitter buffer    : ${info.jitterBufMs != null ? info.jitterBufMs.toFixed(1) + " ms" : "n/d"}  (más bajo = menos latencia)`);
} finally {
  await browser.close();
}
