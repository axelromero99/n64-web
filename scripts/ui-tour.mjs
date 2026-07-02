// Tour visual de la UI nueva + verificación del flujo completo con invite link.
// Host crea sala (contexto 1), copia el link, y el guest (contexto 2 aislado)
// abre ESE link y se une automáticamente. Screenshots de cada pantalla.
import { chromium } from "playwright";

const ROM = "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const BASE = "http://localhost:5173/";
const SHOT = "C:/Users/user1/AppData/Local/Temp/claude/C--Users-user1-Desktop-programacion-emu/80055855-84f5-4062-b1cc-00bd6b00ba6b/scratchpad";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
try {
  const getState = (p) => p.evaluate(() => window.__n64net || null).catch(() => null);

  // ---- Landing ----
  const ctxHost = await browser.newContext({ viewport: { width: 1000, height: 820 } });
  const host = await ctxHost.newPage();
  host.on("pageerror", (e) => console.log("  [host err]", e.message));
  await host.goto(BASE, { waitUntil: "load" });
  await sleep(600);
  await host.screenshot({ path: `${SHOT}/ui-1-landing.png` });
  console.log("✓ landing capturado");

  // ---- Online: elección ----
  await host.evaluate(() => (location.hash = "online"));
  await sleep(500);
  await host.screenshot({ path: `${SHOT}/ui-2-online-choice.png` });

  // ---- Host: crear sala (click en la tile "Crear una sala") ----
  await host.click("text=Crear una sala");
  await sleep(400);
  await host.screenshot({ path: `${SHOT}/ui-3-host-dropzone.png` });

  // Cargar ROM (el input está oculto dentro del dropzone)
  await host.setInputFiles("input[type=file]", ROM);
  console.log("→ host cargó ROM; esperando código de sala + boot…");
  await sleep(3000);
  await host.screenshot({ path: `${SHOT}/ui-4-host-room.png` });

  // Leer el código de sala del DOM
  const code = await host.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");
  console.log("   código de sala:", code);
  const invite = `${BASE}?room=${code}#online`;

  // Esperar a que el host bootee (overlay se va)
  for (let i = 0; i < 25; i++) { await sleep(1000); if ((await getState(host))?.phase === "waiting") break; }
  await host.screenshot({ path: `${SHOT}/ui-5-host-waiting.png` });

  // ---- Guest: abrir el INVITE LINK en contexto aislado ----
  const ctxGuest = await browser.newContext({ viewport: { width: 1000, height: 820 } });
  const guest = await ctxGuest.newPage();
  guest.on("pageerror", (e) => console.log("  [guest err]", e.message));
  await guest.goto(invite, { waitUntil: "load" });
  console.log("→ guest abrió el invite link:", invite);
  await sleep(1500);
  await guest.screenshot({ path: `${SHOT}/ui-6-guest-connecting.png` });

  // Esperar conexión + video
  let ok = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const h = await getState(host), g = await getState(guest);
    if (i % 4 === 0) console.log(`   host=${h?.phase}/${h?.rttMs}ms guest=${g?.phase}/${g?.rttMs}ms`);
    if (h?.phase === "connected" && g?.phase === "connected") { ok = true; break; }
  }
  // esperar a que el juego renderice en el guest
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const bright = await guest.evaluate(() => {
      const v = document.querySelector(".stage video");
      if (!v || !v.videoWidth) return 0;
      const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
      const g = c.getContext("2d"); g.drawImage(v, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return s / (d.length / 4);
    });
    if (bright > 30) break;
  }
  await sleep(500);
  await host.screenshot({ path: `${SHOT}/ui-7-host-connected.png` });
  await guest.screenshot({ path: `${SHOT}/ui-8-guest-playing.png` });

  const hs = await getState(host), gs = await getState(guest);
  console.log("\n===== RESULTADO =====");
  console.log(`invite link funcionó: ${ok ? "SÍ" : "NO"}`);
  console.log(`host: phase=${hs?.phase} rtt=${hs?.rttMs}ms  ·  guest: phase=${gs?.phase} rtt=${gs?.rttMs}ms video=${gs?.videoReady}`);
} finally {
  await browser.close();
}
