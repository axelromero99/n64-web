// Verifica el modo online en el ORDEN NATURAL DEL USUARIO:
//   1) Host crea la sala y carga la ROM PRIMERO.
//   2) Guest se une DESPUÉS (cuando el host ya podría haber ofertado).
// Este era el caso ROTO (el guest se perdía la oferta). Confirma el fix del
// handshake join-driven.
import { chromium } from "playwright";

const ROM = "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const URL = "http://localhost:5173/#online";
const SHOT = "C:/Users/user1/AppData/Local/Temp/claude/C--Users-user1-Desktop-programacion-emu/80055855-84f5-4062-b1cc-00bd6b00ba6b/scratchpad";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const getState = (p) => p.evaluate(() => window.__n64net || null).catch(() => null);

  // 1) HOST primero, carga ROM.
  const host = await ctx.newPage();
  host.on("pageerror", (e) => console.log("  [host err]", e.message));
  await host.goto(URL, { waitUntil: "load" });
  await host.setInputFiles("#online-rom", ROM);
  console.log("→ HOST creó la sala y cargó la ROM. Esperando 18s (a que boote y 'oferte')…");
  await sleep(18000);
  console.log("   host:", (await getState(host))?.connection);

  // Diagnóstico: ¿el canvas del host tiene preserveDrawingBuffer y brillo?
  const hostDiag = await host.evaluate(() => {
    const c = [...document.querySelectorAll("#game canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!c) return { err: "no canvas" };
    let pdb = null;
    try { const gl = c.getContext("webgl2") || c.getContext("webgl"); pdb = gl?.getContextAttributes().preserveDrawingBuffer; } catch (e) { pdb = "err:" + e.message; }
    let bright = -1;
    try {
      const t = document.createElement("canvas"); t.width = c.width; t.height = c.height;
      const g = t.getContext("2d"); g.drawImage(c, 0, 0);
      const d = g.getImageData(0, 0, Math.min(120, c.width), Math.min(120, c.height)).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; bright = s;
    } catch (e) { bright = "err:" + e.message; }
    return { w: c.width, h: c.height, pdb, bright };
  });
  console.log("   host canvas diag:", JSON.stringify(hostDiag));

  // 2) GUEST se une DESPUÉS (el caso que estaba roto).
  const guest = await ctx.newPage();
  guest.on("pageerror", (e) => console.log("  [guest err]", e.message));
  await guest.goto(URL, { waitUntil: "load" });
  await guest.click("#online-guest");
  console.log("→ GUEST se unió DESPUÉS. Esperando conexión…");

  let connected = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const h = await getState(host), g = await getState(guest);
    if (i % 3 === 0) console.log(`   host=${h?.connection} guest=${g?.connection}`);
    const gConn = (g?.connection || "");
    if (h?.connection === "connected" && (gConn === "connected" || gConn.startsWith("conectado"))) { connected = true; break; }
  }
  console.log(connected ? "✓ CONECTÓ pese a unirse tarde" : "✗ no conectó");

  // Esperar a que el juego renderice y medir el video del guest.
  let vid = { ok: false };
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    vid = await guest.evaluate(() => {
      const v = document.querySelector("#online-video");
      if (!v || !v.videoWidth) return { ok: false, w: 0, h: 0, avg: 0 };
      const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
      const g = c.getContext("2d"); g.drawImage(v, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return { ok: s > 5000, w: v.videoWidth, h: v.videoHeight, avg: +(s / (d.length / 4)).toFixed(1) };
    });
    if (vid.ok) break;
  }
  console.log(`→ video en el guest: ${vid.w}x${vid.h}, brillo=${vid.avg}, no-negro=${vid.ok}`);

  await guest.screenshot({ path: `${SHOT}/hostfirst-guest.png` });
  console.log("\n===== RESUMEN (orden usuario: host→guest) =====");
  console.log(`conexión : ${connected ? "OK" : "FALLÓ"}`);
  console.log(`video    : ${vid.ok ? "OK (" + vid.w + "x" + vid.h + ")" : "FALLÓ/negro"}`);
} finally {
  await browser.close();
}
