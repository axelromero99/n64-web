// Verifica el MODO JUSTO (input-delay del host):
//  - al conectar el guest, se desactiva el teclado interno de EmulatorJS
//    (setKeyboardEnabled(false)),
//  - el input del HOST (P1) pasa por nuestra ruta simulateInput(0,...) con delay,
//  - sigue funcionando (P1 recibe el input, solo que retrasado).
import { chromium } from "playwright";

const ROM = "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const BASE = "http://localhost:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
try {
  const getState = (p) => p.evaluate(() => window.__n64net || null).catch(() => null);

  const ctxHost = await browser.newContext({ viewport: { width: 760, height: 620 } });
  const host = await ctxHost.newPage();
  host.on("pageerror", (e) => console.log("  [host err]", e.message));
  await host.goto(BASE + "#online", { waitUntil: "load" });
  await host.click("text=Crear una sala");
  await sleep(300);
  await host.setInputFiles("input[type=file]", ROM);
  for (let i = 0; i < 30; i++) { await sleep(1000); if ((await getState(host))?.phase === "waiting") break; }

  // Instrumentar setKeyboardEnabled + simulateInput(P1) ANTES de conectar.
  await host.evaluate(() => {
    const gm = window.EJS_emulator.gameManager;
    window.__kbCalls = [];
    window.__p1axis = [];
    const origKb = gm.setKeyboardEnabled?.bind(gm);
    if (origKb) gm.setKeyboardEnabled = (on) => { window.__kbCalls.push(on); return origKb(on); };
    const origSim = gm.simulateInput.bind(gm);
    gm.simulateInput = (p, idx, val) => { if (p === 0 && idx === 16 && val) window.__p1axis.push(val); return origSim(p, idx, val); };
  });

  const code = await host.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");
  const ctxGuest = await browser.newContext({ viewport: { width: 760, height: 620 } });
  const guest = await ctxGuest.newPage();
  await guest.goto(`${BASE}?room=${code}#online`, { waitUntil: "load" });
  for (let i = 0; i < 30; i++) { await sleep(1000); if ((await getState(host))?.phase === "connected") break; }
  await sleep(1000);

  const kbBefore = await host.evaluate(() => window.__kbCalls.slice());
  // El HOST presiona ArrowRight (girar) — debe pasar por simulateInput(0,16,32767).
  await host.bringToFront();
  await host.keyboard.down("ArrowRight");
  await sleep(600);
  await host.keyboard.up("ArrowRight");
  await sleep(200);

  const p1 = await host.evaluate(() => window.__p1axis.slice());
  const st = await getState(host);

  console.log("\n===== MODO JUSTO (host input-delay) =====");
  console.log(`setKeyboardEnabled llamado con: [${kbBefore.join(", ")}]  (debe incluir false)`);
  console.log(`fair activo: ${st?.fair}  ·  delay: ${st?.fairDelayMs}ms  ·  rtt: ${st?.rttMs}ms`);
  console.log(`P1 eje-derecha por nuestra ruta: ${p1.length} llamadas, valor ${[...new Set(p1)].join("/")}`);
  const ok = kbBefore.includes(false) && st?.fair === true && p1.some((v) => v === 32767);
  console.log(ok ? "✓ MODO JUSTO OK: teclado interno off + P1 aplicado con delay a 32767" : "✗ revisar");
  if (!ok) process.exitCode = 1;
} finally { await browser.close(); }
