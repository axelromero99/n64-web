// Herramienta MANUAL (no está en verify:*): navega MK64 hasta una partida de
// 4 JUGADORES (quad-split, Battle Mode) manejada por Playwright, y saca
// screenshots. Prueba VISUAL de que el multijugador de 4 anda de punta a punta:
// 4 karts, 4 cuadrantes, los cuatro acelerando a la vez.
//
// Complementa las otras dos capas de prueba:
//   · input a nivel core (4 mandos simultáneos)  → scripts/verify-multiplayer.mjs (D)
//   · visual 2P VS splitscreen                    → scripts/hud-2p-screenshots.mjs
//
// MK64 ignora inputs durante los fades → por eso las esperas largas y fijas.
// Si se cambia de core o de versión de EmulatorJS, correr esto y mirar los
// "driveN.png": deben verse los 4 karts en sus cuadrantes.
//
// Uso:  npm run dev  (en otra terminal)  y después:
//       node scripts/mp-4p-screenshots.mjs
// Env:  ROM (path a la .z64) · BASE (default http://localhost:5173/)
//       SHOTS_DIR (default <tmp>/n64web-4p-shots)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

const ROM = process.env.ROM || "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const BASE = process.env.BASE || "http://localhost:5173/";
const SHOTS = process.env.SHOTS_DIR || `${tmpdir()}/n64web-4p-shots`;
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

  console.log("== título → 4P GAME → VS/Battle → 4 personajes → pista ==");
  await press(0, 3); await sleep(3000);                    // título
  await press(0, 3); await sleep(4000);                    // GAME SELECT (cursor en 1P)
  await press(0, 16); await sleep(800);                    // → 2P
  await press(0, 16); await sleep(800);                    // → 3P
  await press(0, 16); await sleep(1200);                   // → 4P GAME
  await press(0, 0); await sleep(1800);                    // A: submenú 4P
  await press(0, 18); await sleep(1000);                   // ↓ (VS)
  await press(0, 0); await sleep(1800);                    // A: VS
  await press(0, 0); await sleep(3500);                    // A: OK → PLAYER SELECT
  // Cada jugador mueve el cursor a un lado distinto y confirma con A.
  await press(0, 0); await sleep(1200);                                        // P1
  await press(1, 16, 300); await sleep(600); await press(1, 0); await sleep(1000); // P2
  await press(2, 18, 300); await sleep(600); await press(2, 0); await sleep(1000); // P3
  await press(3, 17, 300); await sleep(600); await press(3, 0); await sleep(1200); // P4
  await press(0, 0); await sleep(3500);                    // OK → MAP SELECT
  for (let i = 1; i <= 4; i++) { await press(0, 0, 250); await sleep(2600); }
  await shot("pre-race");

  console.log("== partida: los 4 aceleran a la vez ==");
  await sleep(18000); await shot("race-start");
  await page.evaluate(() => {
    const gm = window.EJS_emulator.gameManager;
    for (let pl = 0; pl < 4; pl++) gm.simulateInput(pl, 0, 1); // los 4 mantienen A
  });
  for (let i = 1; i <= 4; i++) { await sleep(3000); await shot(`drive${i}`); }
  await page.evaluate(() => {
    const gm = window.EJS_emulator.gameManager;
    for (let pl = 0; pl < 4; pl++) gm.simulateInput(pl, 0, 0);
  });
  console.log(`\nListo. Revisar a ojo los PNG en: ${SHOTS} (deben verse 4 karts en 4 cuadrantes)`);
} finally {
  await browser.close();
}
