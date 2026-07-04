// Herramienta MANUAL (no está en verify:*): screenshots del HUD de MK64 en una
// carrera 2P VS splitscreen, para verificar A OJO que el core dibuja minimapa,
// ruleta de ítems y contador de vueltas.
//
// Por qué existe: el core mupen64plus_next (EJS_core "n64") tiene un bug de
// GLideN64 en splitscreen (gonetz/GLideN64#2894) que deja esos elementos como
// cajas negras/invisibles aunque funcionan. Por eso usamos parallel_n64.
// Si se cambia de core o de versión de EmulatorJS, correr esto y mirar los
// últimos "driveN.png": deben verse LAP 1/3 en cada mitad y la ruleta de ítems
// al pisar cajas.
//
// Uso:  npm run dev  (en otra terminal)  y después:
//       node scripts/hud-2p-screenshots.mjs
// Env:  ROM (path a la .z64) · BASE (default http://localhost:5173/)
//       SHOTS_DIR (default <tmp>/n64web-hud-shots)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

const ROM = process.env.ROM || "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const BASE = process.env.BASE || "http://localhost:5173/";
const SHOTS = process.env.SHOTS_DIR || `${tmpdir()}/n64web-hud-shots`;
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: false,
  args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist", "--mute-audio"],
});
try {
  const page = await (await browser.newContext({ viewport: { width: 800, height: 620 } })).newPage();
  page.on("pageerror", (e) => console.log("  [err]", e.message));

  let n = 0;
  const shot = async (tag) => {
    n++;
    const f = `${SHOTS}/${String(n).padStart(2, "0")}-${tag}.png`;
    await page.screenshot({ path: f });
    console.log("shot:", f);
  };
  // Botones N64 (índices EmulatorJS): 0=A 1=B 3=START · stick 16→ 17← 18↓ 19↑
  const press = (player, idx, holdMs = 200) =>
    page.evaluate(async ({ player, idx, holdMs }) => {
      const gm = window.EJS_emulator.gameManager;
      gm.simulateInput(player, idx, idx >= 16 ? 32767 : 1);
      await new Promise((r) => setTimeout(r, holdMs));
      gm.simulateInput(player, idx, 0);
    }, { player, idx, holdMs });

  console.log("== cargando ROM en modo local ==");
  await page.goto(BASE + "#local", { waitUntil: "load" });
  await sleep(500);
  await page.setInputFiles("input[type=file]", ROM);
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const ok = await page.evaluate(() => !!window.EJS_emulator?.gameManager?.simulateInput).catch(() => false);
    if (ok) { console.log(`emulador listo a los ${i + 1}s`); break; }
  }
  await sleep(14000); // logo N64 + entrada al título

  // MK64 ignora inputs durante los fades: por eso las esperas largas.
  console.log("== título → GAME SELECT → 2P VS → personajes → pista ==");
  await press(0, 3); await sleep(3000);                    // título
  await press(0, 3); await sleep(4000);                    // GAME SELECT (cursor en 1P)
  await press(0, 16); await sleep(1200);                   // → 2P GAME
  await press(0, 0); await sleep(1500);                    // A: submenú 2P
  await press(0, 18); await sleep(1200);                   // ↓ VS
  await press(0, 0); await sleep(1500);                    // A: VS
  await press(0, 0); await sleep(3500);                    // A: OK? → PLAYER SELECT
  await press(0, 0); await sleep(1500);                    // P1 elige
  await press(1, 16, 300); await sleep(800);               // P2 mueve cursor
  await press(1, 0, 300); await sleep(1500);               // P2 elige
  await press(0, 0); await sleep(3500); await shot("map-select"); // OK → MAP SELECT
  for (let i = 1; i <= 4; i++) { await press(0, 0, 250); await sleep(2800); }
  await shot("pre-race");

  console.log("== carrera: ambos aceleran hacia las cajas de ítems ==");
  await sleep(18000); await shot("race-start");
  await page.evaluate(() => {
    const gm = window.EJS_emulator.gameManager;
    gm.simulateInput(0, 0, 1); // P1 mantiene A
    gm.simulateInput(1, 0, 1); // P2 mantiene A
  });
  for (let i = 1; i <= 7; i++) { await sleep(3000); await shot(`drive${i}`); }
  await page.evaluate(() => {
    const gm = window.EJS_emulator.gameManager;
    gm.simulateInput(0, 0, 0);
    gm.simulateInput(1, 0, 0);
  });
  console.log(`\nListo. Revisar a ojo los PNG en: ${SHOTS}`);
} finally {
  await browser.close();
}
