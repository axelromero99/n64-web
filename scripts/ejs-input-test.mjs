import { chromium } from "playwright";
const ROM = "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const URL = "http://localhost:5173/#local";
const SHOT = "C:/Users/user1/AppData/Local/Temp/claude/C--Users-user1-Desktop-programacion-emu/80055855-84f5-4062-b1cc-00bd6b00ba6b/scratchpad";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  await page.setInputFiles("#rom", ROM);
  for (let i = 0; i < 150; i++) { await sleep(1000); if (await page.evaluate(() => !!(window.EJS_emulator?.gameManager)).catch(() => false)) break; }
  await page.click("#game").catch(() => {});
  console.log("esperando a que aparezca PUSH START (20s)...");
  await sleep(20000);
  await page.screenshot({ path: `${SHOT}/inp-0-baseline.png` });

  // Presionar START (player 0, index 3) con hold generoso, 4 veces, screenshot tras cada una
  for (let k = 1; k <= 4; k++) {
    await page.evaluate(async () => {
      const gm = window.EJS_emulator.gameManager;
      gm.simulateInput(0, 3, 1);
      await new Promise((r) => setTimeout(r, 350));
      gm.simulateInput(0, 3, 0);
    });
    await sleep(1200);
    await page.screenshot({ path: `${SHOT}/inp-${k}-afterstart.png` });
    console.log(`START #${k} enviado`);
  }
  console.log("listo. Revisar inp-4-afterstart.png");
} finally { await browser.close(); }
