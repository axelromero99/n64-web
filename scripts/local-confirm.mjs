import { chromium } from "playwright";
const ROM = "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const SHOT = "C:/Users/user1/AppData/Local/Temp/claude/C--Users-user1-Desktop-programacion-emu/80055855-84f5-4062-b1cc-00bd6b00ba6b/scratchpad";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 720 } });
  await page.goto("http://localhost:5173/#local", { waitUntil: "load" });
  await sleep(400);
  await page.setInputFiles("input[type=file]", ROM);
  for (let i = 0; i < 40; i++) { await sleep(1000); if (await page.evaluate(() => !!(window.EJS_emulator?.gameManager)).catch(() => false)) break; }
  await sleep(22000); // dejar pasar intro completa hasta el título
  await page.screenshot({ path: `${SHOT}/local-confirm.png` });
  console.log("captura tomada tras 22s de intro");
} finally { await browser.close(); }
