// Verifica el online con señalización WebSocket entre DOS CONTEXTOS SEPARADOS.
// Dos browser.newContext() = storage/BroadcastChannel aislados, igual que
// incógnito vs ventana normal. Si conectan, el WS arregla el problema del usuario.
import { chromium } from "playwright";

const ROM = "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const ROOM = "testxc";
const URL = `http://localhost:5173/?room=${ROOM}#online`;
const SHOT = "C:/Users/user1/AppData/Local/Temp/claude/C--Users-user1-Desktop-programacion-emu/80055855-84f5-4062-b1cc-00bd6b00ba6b/scratchpad";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
try {
  const getState = (p) => p.evaluate(() => window.__n64net || null).catch(() => null);

  // CONTEXTO 1 (como "ventana normal") = HOST
  const ctxHost = await browser.newContext({ viewport: { width: 760, height: 600 } });
  const host = await ctxHost.newPage();
  host.on("pageerror", (e) => console.log("  [host err]", e.message));
  await host.goto(URL, { waitUntil: "load" });
  await host.setInputFiles("#online-rom", ROM);
  console.log("→ HOST (contexto 1) cargó ROM. Booteando 16s…");
  await sleep(16000);
  console.log("   host:", (await getState(host))?.connection);

  // CONTEXTO 2 (como "ventana incógnito") = GUEST — AISLADO del contexto 1.
  const ctxGuest = await browser.newContext({ viewport: { width: 760, height: 600 } });
  const guest = await ctxGuest.newPage();
  guest.on("pageerror", (e) => console.log("  [guest err]", e.message));
  await guest.goto(URL, { waitUntil: "load" });
  await guest.click("#online-guest");
  console.log("→ GUEST (contexto 2, aislado) se une…");

  let connected = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const h = await getState(host), g = await getState(guest);
    if (i % 3 === 0) console.log(`   host=${h?.connection}  guest=${g?.connection}`);
    const gc = g?.connection || "";
    if (h?.connection === "connected" && (gc === "connected" || gc.startsWith("conectado"))) { connected = true; break; }
  }

  let vid = { ok: false };
  for (let i = 0; i < 25 && connected; i++) {
    await sleep(1000);
    vid = await guest.evaluate(() => {
      const v = document.querySelector("#online-video");
      if (!v || !v.videoWidth) return { ok: false, w: 0, avg: 0 };
      const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
      const g = c.getContext("2d"); g.drawImage(v, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return { ok: s > 5000, w: v.videoWidth, avg: +(s / (d.length / 4)).toFixed(1) };
    });
    if (vid.ok) break;
  }
  await guest.screenshot({ path: `${SHOT}/xcontext-guest.png` });

  console.log("\n===== ONLINE CROSS-CONTEXTO (= incógnito vs normal) =====");
  console.log(`conexión WebSocket : ${connected ? "OK" : "FALLÓ"}`);
  console.log(`video host→guest   : ${vid.ok ? "OK (brillo " + vid.avg + ")" : "FALLÓ"}`);
} finally {
  await browser.close();
}
