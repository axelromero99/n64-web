// E2E del online v1 (streaming) con la UI real y contextos AISLADOS (equivale
// a dos máquinas/navegadores distintos, señalización WebSocket real):
//   host crea sala por la UI → guest entra por el INVITE LINK → verifica:
//   conexión (phase) en ambos, video no-negro en el guest, input guest→host,
//   modo justo activo y RTT medido.
import { chromium } from "playwright";
import os from "node:os";

const ROM = process.env.ROM || "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const BASE = "http://localhost:5173/";
const SHOT = os.tmpdir();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
let ok = true;
const check = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) ok = false; };
try {
  const getState = (p) => p.evaluate(() => window.__n64net || null).catch(() => null);

  // HOST (contexto 1): crea la sala por la UI.
  const ctxHost = await browser.newContext({ viewport: { width: 900, height: 720 } });
  const host = await ctxHost.newPage();
  host.on("pageerror", (e) => console.log("  [host err]", e.message));
  await host.goto(BASE + "#online", { waitUntil: "load" });
  await host.click("text=Crear una sala");
  await sleep(300);
  await host.setInputFiles("input[type=file]", ROM);
  console.log("→ host booteando la ROM…");
  for (let i = 0; i < 40; i++) { await sleep(1000); if ((await getState(host))?.phase === "waiting") break; }
  check((await getState(host))?.phase === "waiting", "host listo (waiting)");

  const code = await host.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");
  const invite = `${BASE}?room=${code}#online`;
  console.log("  invite:", invite);

  // GUEST (contexto 2, aislado): entra por el invite link.
  const ctxGuest = await browser.newContext({ viewport: { width: 900, height: 720 } });
  const guest = await ctxGuest.newPage();
  guest.on("pageerror", (e) => console.log("  [guest err]", e.message));
  await guest.goto(invite, { waitUntil: "load" });

  let connected = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const h = await getState(host), g = await getState(guest);
    if (i % 5 === 0) console.log(`   host=${h?.phase} guest=${g?.phase} rtt=${g?.rttMs}`);
    if (h?.phase === "connected" && g?.phase === "connected") { connected = true; break; }
  }
  check(connected, "WebRTC conectado en ambos lados (phase)");

  const hs = await getState(host);
  check(hs?.fair === true, `modo justo activo en el host (delay ${hs?.fairDelayMs}ms)`);

  // Video no-negro en el guest (espera a que el juego salga del boot).
  let bright = 0;
  for (let i = 0; i < 30 && connected; i++) {
    await sleep(1000);
    bright = await guest.evaluate(() => {
      const v = document.querySelector(".stage video");
      if (!v || !v.videoWidth) return 0;
      const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
      const g = c.getContext("2d"); g.drawImage(v, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return Math.round(s / (d.length / 4));
    });
    if (bright > 30) break;
  }
  check(bright > 30, `video host→guest no-negro (brillo ${bright})`);

  // Input guest→host por el datachannel.
  const before = (await getState(host))?.inputMsgs ?? 0;
  await guest.bringToFront();
  for (const k of ["KeyX", "ArrowLeft", "ArrowRight", "Enter"]) {
    await guest.keyboard.down(k); await sleep(180); await guest.keyboard.up(k); await sleep(120);
  }
  await sleep(800);
  const after = (await getState(host))?.inputMsgs ?? 0;
  check(after > before, `input guest→host (${before} → ${after} mensajes)`);

  const g = await getState(guest);
  check(typeof g?.rttMs === "number", `RTT medido en el guest (${g?.rttMs}ms)`);

  // Un TERCERO intenta entrar a la sala ocupada → debe ver "sala llena" y la
  // partida de los otros dos sigue como si nada.
  const ctx3 = await browser.newContext({ viewport: { width: 900, height: 720 } });
  const third = await ctx3.newPage();
  await third.goto(invite, { waitUntil: "load" });
  let fullMsg = "";
  let sawFull = false;
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    const s = await getState(third);
    fullMsg = s?.connection || "";
    if (s?.phase === "error" && fullMsg.includes("llena")) { sawFull = true; break; }
  }
  check(sawFull, `el 3° ve "sala llena" (${JSON.stringify(fullMsg)})`);
  await ctx3.close();
  check((await getState(host))?.phase === "connected", "la partida original sigue conectada");

  await host.screenshot({ path: `${SHOT}/online-host.png` }).catch(() => {});
  await guest.screenshot({ path: `${SHOT}/online-guest.png` }).catch(() => {});

  console.log("\n===== ONLINE v1 E2E (contextos aislados) =====");
  console.log(ok ? "✓ TODO OK: conexión + video + input + modo justo" : "✗ HAY FALLOS (ver arriba)");
} finally {
  await browser.close();
  if (!ok) process.exitCode = 1;
}
