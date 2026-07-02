// Verifica el modo online end-to-end: 2 pestañas (host + guest) en el mismo
// contexto (BroadcastChannel comparte señalización). Comprueba: conexión WebRTC,
// que el input del guest llega al host, y que el video del host llega al guest.
import { chromium } from "playwright";

const ROM = "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const URL = "http://localhost:5173/#online";
const SHOT = "C:/Users/user1/AppData/Local/Temp/claude/C--Users-user1-Desktop-programacion-emu/80055855-84f5-4062-b1cc-00bd6b00ba6b/scratchpad";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  // Experimento: parchear getContext ANTES de cualquier script de la página.
  await ctx.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype;
    const orig = proto.getContext;
    proto.getContext = function (type, attrs) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl")
        attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
      return orig.call(this, type, attrs);
    };
  });

  const guest = await ctx.newPage();
  guest.on("pageerror", (e) => console.log("  [guest err]", e.message));
  await guest.goto(URL, { waitUntil: "load" });
  await guest.click("#online-guest"); // guest queda escuchando la señalización
  console.log("→ Guest escuchando en sala1");

  const host = await ctx.newPage();
  host.on("pageerror", (e) => console.log("  [host err]", e.message));
  await host.goto(URL, { waitUntil: "load" });
  await host.setInputFiles("#online-rom", ROM); // dispara startHost (bootea emu + manda offer)
  console.log("→ Host booteando emulador y creando oferta…");

  // Esperar conexión en ambos lados.
  const getState = (p) => p.evaluate(() => window.__n64net || null).catch(() => null);
  let connected = false;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const h = await getState(host);
    const g = await getState(guest);
    if (i % 5 === 0) console.log(`   host=${h?.connection} guest=${g?.connection} video=${g?.videoReady}`);
    if (h?.connection === "connected" && g?.connection === "connected") { connected = true; break; }
  }
  console.log(connected ? "✓ WebRTC CONECTADO en ambos lados" : "✗ no conectó a tiempo");

  // Esperar a que el JUEGO renderice de verdad (salga de la pantalla negra de
  // arranque). Polleamos el brillo del canvas del host hasta >0.
  const hostBright = () =>
    host.evaluate(() => {
      const c = [...document.querySelectorAll("#game canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (!c || !c.width) return { bright: -1, w: 0, h: 0 };
      const t = document.createElement("canvas");
      t.width = c.width; t.height = c.height;
      const g = t.getContext("2d"); g.drawImage(c, 0, 0);
      const d = g.getImageData(0, 0, Math.min(120, t.width), Math.min(120, t.height)).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return { bright: s, w: c.width, h: c.height };
    });
  console.log("→ esperando a que el juego renderice (canvas host con brillo)…");
  let hb = { bright: 0 };
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    hb = await hostBright();
    if (i % 4 === 0) console.log(`   host canvas ${hb.w}x${hb.h} brillo=${hb.bright}`);
    if (hb.bright > 1000) break;
  }
  console.log(`host canvas final: ${hb.w}x${hb.h} brillo=${hb.bright} → ${hb.bright > 1000 ? "RENDERIZANDO" : "NEGRO"}`);

  await sleep(2000);
  // Guest manda input (acelerar + volante + start) — el host debe recibir por datachannel.
  const beforeHost = (await getState(host))?.inputMsgs ?? 0;
  await guest.bringToFront();
  for (const k of ["KeyX", "ArrowLeft", "ArrowRight", "Enter"]) {
    await guest.keyboard.down(k); await sleep(180); await guest.keyboard.up(k); await sleep(120);
  }
  await sleep(1000);
  const afterHost = (await getState(host))?.inputMsgs ?? 0;
  console.log(`→ input del guest recibido por el host: ${beforeHost} → ${afterHost} mensajes`);
  const gdbg = await guest.evaluate(() => window.__n64dbg || null).catch(() => null);
  const gstate = await getState(guest);
  console.log(`   guest dbg: ${JSON.stringify(gdbg)} · guest inputMsgs=${gstate?.inputMsgs}`);

  // Verificar que el guest recibe VIDEO no-negro.
  const video = await guest.evaluate(() => {
    const v = document.querySelector("#online-video");
    if (!v || !v.videoWidth) return { ok: false, w: 0, h: 0, avg: 0 };
    const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
    const g = c.getContext("2d"); g.drawImage(v, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return { ok: sum > 1000, w: v.videoWidth, h: v.videoHeight, avg: +(sum / (d.length / 4)).toFixed(1) };
  });
  console.log(`→ video en el guest: ${video.w}x${video.h}, brillo medio=${video.avg}, no-negro=${video.ok}`);

  await host.bringToFront();
  await host.screenshot({ path: `${SHOT}/online-host.png` });
  await guest.screenshot({ path: `${SHOT}/online-guest.png` });

  console.log("\n===== RESUMEN =====");
  console.log(`conexión WebRTC : ${connected ? "OK" : "FALLÓ"}`);
  console.log(`input guest→host: ${afterHost > beforeHost ? "OK (" + (afterHost - beforeHost) + " msgs)" : "FALLÓ"}`);
  console.log(`video host→guest: ${video.ok ? "OK (" + video.w + "x" + video.h + ")" : "FALLÓ"}`);
} finally {
  await browser.close();
}
