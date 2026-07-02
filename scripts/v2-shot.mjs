import { chromium } from "playwright";
const BASE = "http://localhost:5173/";
const SHOT = "C:/Users/user1/AppData/Local/Temp/claude/C--Users-user1-Desktop-programacion-emu/80055855-84f5-4062-b1cc-00bd6b00ba6b/scratchpad";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const ctxA = await browser.newContext({ viewport: { width: 820, height: 720 } });
  const A = await ctxA.newPage();
  await A.goto(BASE + "#v2", { waitUntil: "load" });
  await A.click("text=Crear partida"); await sleep(500);
  const code = await A.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");
  const ctxB = await browser.newContext({ viewport: { width: 820, height: 720 } });
  const B = await ctxB.newPage();
  await B.goto(`${BASE}?room=${code}#v2`, { waitUntil: "load" });
  await sleep(3500);
  // un poco de juego
  await A.bringToFront(); await A.keyboard.down("ArrowDown"); await sleep(600); await A.keyboard.up("ArrowDown");
  await B.bringToFront(); await B.keyboard.down("ArrowUp"); await sleep(600); await B.keyboard.up("ArrowUp");
  await sleep(1500);
  await A.screenshot({ path: `${SHOT}/v2-peerA.png` });
  await B.screenshot({ path: `${SHOT}/v2-peerB.png` });
  console.log("capturas v2 guardadas (peer A y B)");
} finally { await browser.close(); }
