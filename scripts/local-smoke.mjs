// Smoke test del modo LOCAL con la UI nueva: dropzone -> boot -> juego visible.
import { chromium } from "playwright";
const ROM = "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const SHOT = "C:/Users/user1/AppData/Local/Temp/claude/C--Users-user1-Desktop-programacion-emu/80055855-84f5-4062-b1cc-00bd6b00ba6b/scratchpad";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 820 } });
  page.on("pageerror", (e) => console.log("  [err]", e.message));
  await page.goto("http://localhost:5173/#local", { waitUntil: "load" });
  await sleep(400);
  await page.setInputFiles("input[type=file]", ROM);
  console.log("→ ROM cargada en Local; booteando…");
  for (let i = 0; i < 40; i++) { await sleep(1000); if (await page.evaluate(() => !!(window.EJS_emulator?.gameManager)).catch(() => false)) break; }
  await sleep(14000);
  const bright = await page.evaluate(() => {
    const c = [...document.querySelectorAll("#game canvas")].sort((a,b)=>b.width*b.height-a.width*a.height)[0];
    if (!c || !c.width) return -1;
    const t = document.createElement("canvas"); t.width=c.width; t.height=c.height;
    const g = t.getContext("2d"); try { g.drawImage(c,0,0); } catch { return -2; }
    const d = g.getImageData(0,0,Math.min(120,c.width),Math.min(120,c.height)).data; let s=0;
    for(let i=0;i<d.length;i+=4) s+=d[i]+d[i+1]+d[i+2]; return Math.round(s/(d.length/4));
  });
  await page.screenshot({ path: `${SHOT}/local-smoke.png` });
  console.log(`Local mode: canvas brillo=${bright} → ${bright>20?"JUEGO VISIBLE ✓":"negro/boot"}`);
} finally { await browser.close(); }
