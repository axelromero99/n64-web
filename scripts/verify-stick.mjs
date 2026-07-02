// Verifica el FIX del stick del guest: espía simulateInput en el host y confirma
// que al presionar una flecha en el guest, el host aplica el eje analógico con
// valor 32767 (antes mandaba 1 = casi cero → el kart no giraba).
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
  console.log("→ host booteando…");
  for (let i = 0; i < 30; i++) { await sleep(1000); if ((await getState(host))?.phase === "waiting") break; }

  // Instrumentar simulateInput del host para registrar llamadas al eje (P2, 16-19).
  await host.evaluate(() => {
    const gm = window.EJS_emulator.gameManager;
    window.__siAxis = [];
    const orig = gm.simulateInput.bind(gm);
    gm.simulateInput = (p, idx, val) => {
      if (p === 1 && idx >= 16 && idx <= 19 && val !== 0) window.__siAxis.push({ idx, val });
      return orig(p, idx, val);
    };
  });

  const code = await host.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");
  const ctxGuest = await browser.newContext({ viewport: { width: 800, height: 640 } });
  const guest = await ctxGuest.newPage();
  await guest.goto(`${BASE}?room=${code}#online`, { waitUntil: "load" });
  for (let i = 0; i < 30; i++) { await sleep(1000); if ((await getState(guest))?.phase === "connected") break; }
  await sleep(1500);

  // El guest mantiene ArrowRight (girar derecha) un momento.
  await guest.bringToFront();
  await guest.keyboard.down("ArrowRight");
  await sleep(700);
  await guest.keyboard.up("ArrowRight");
  await sleep(400);
  await guest.keyboard.down("ArrowLeft");
  await sleep(700);
  await guest.keyboard.up("ArrowLeft");
  await sleep(400);

  const axisCalls = await host.evaluate(() => window.__siAxis || []);
  const right = axisCalls.filter((c) => c.idx === 16);
  const left = axisCalls.filter((c) => c.idx === 17);
  const vals = [...new Set(axisCalls.map((c) => c.val))];

  console.log("\n===== FIX DEL STICK (guest) =====");
  console.log(`llamadas al eje P2: ${axisCalls.length}  ·  valores usados: ${vals.join(", ")}`);
  console.log(`ArrowRight → índice 16 (xPos): ${right.length} llamadas, valor ${right[0]?.val}`);
  console.log(`ArrowLeft  → índice 17 (xNeg): ${left.length} llamadas, valor ${left[0]?.val}`);
  const ok = right.some((c) => c.val === 32767) && left.some((c) => c.val === 32767);
  console.log(ok ? "✓ STICK ARREGLADO: llega 32767 (deflexión completa)" : "✗ el valor no es 32767");
} finally {
  await browser.close();
}
