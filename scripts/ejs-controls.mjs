// Descubre el mapa de índices de botones N64 de EmulatorJS (para simulateInput)
// y confirma que se puede manejar el juego por código.
import { chromium } from "playwright";

const ROM = "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const URL = "http://localhost:5173/#local";
const SHOT =
  "C:/Users/user1/AppData/Local/Temp/claude/C--Users-user1-Desktop-programacion-emu/80055855-84f5-4062-b1cc-00bd6b00ba6b/scratchpad";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  await page.setInputFiles("#rom", ROM);
  for (let i = 0; i < 150; i++) {
    await sleep(1000);
    if (await page.evaluate(() => !!(window.EJS_emulator && window.EJS_emulator.gameManager)).catch(() => false)) break;
  }
  await page.click("#game").catch(() => {});
  await sleep(14000);

  const dump = await page.evaluate(() => {
    const e = window.EJS_emulator;
    const out = {};
    out.keysWithControl = Object.keys(e).filter((k) => /control|button|label|pad|keys|scheme/i.test(k));
    try { out.controls0 = JSON.parse(JSON.stringify(e.controls?.[0] ?? null)); } catch { out.controls0 = "no-serializable"; }
    // Buscar una lista de etiquetas de botones (index -> nombre)
    for (const k of ["controlScheme", "buttonLabels", "gamepadLabels", "labels"]) {
      if (e[k]) { try { out[k] = JSON.parse(JSON.stringify(e[k])); } catch { out[k] = "" + e[k]; } }
    }
    return out;
  });
  console.log("keys con 'control/button/...':", dump.keysWithControl);
  console.log("controls[0] =", JSON.stringify(dump.controls0));
  for (const k of ["controlScheme", "buttonLabels", "gamepadLabels", "labels"]) {
    if (dump[k]) console.log(`${k} =`, JSON.stringify(dump[k]).slice(0, 800));
  }

  // Probar manejar el juego: START en player 0 (probamos indice 3) y ver si cambia la pantalla.
  const before = await page.evaluate(() => window.EJS_emulator.gameManager.getFrameNum?.());
  await page.evaluate(async () => {
    const gm = window.EJS_emulator.gameManager;
    for (let rep = 0; rep < 3; rep++) {
      gm.simulateInput(0, 3, 1); // START down
      await new Promise((r) => setTimeout(r, 120));
      gm.simulateInput(0, 3, 0); // START up
      await new Promise((r) => setTimeout(r, 400));
    }
  });
  await sleep(1500);
  const after = await page.evaluate(() => window.EJS_emulator.gameManager.getFrameNum?.());
  console.log(`getFrameNum: ${before} -> ${after}`);
  await page.screenshot({ path: `${SHOT}/ejs-after-start.png` });
  console.log("screenshot guardada: ejs-after-start.png (ver si salió del título)");
} finally {
  await browser.close();
}
