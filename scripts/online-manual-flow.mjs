// Reproduce el FLUJO MANUAL EXACTO del usuario, clicando los botones reales
// (no setInputFiles por atajo): tab Host clickea "Crear sala (Host)" y elige la
// ROM por el file chooser; tab Guest clickea "Unirse (Guest)". Mismo contexto
// (mismas cookies/origen) = BroadcastChannel compartido, como 2 pestañas reales.
import { chromium } from "playwright";

const ROM = "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const URL = "http://localhost:5173/#online";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 820, height: 640 } });
  const getState = (p) => p.evaluate(() => window.__n64net || null).catch(() => null);

  // TAB HOST: click en el botón real "Crear sala (Host)" -> file chooser.
  const host = await ctx.newPage();
  host.on("pageerror", (e) => console.log("  [host err]", e.message));
  host.on("console", (m) => { const t = m.text(); if (t.includes("ERROR") || m.type() === "error") console.log("  [host console]", t); });
  await host.goto(URL, { waitUntil: "load" });
  const chooserP = host.waitForEvent("filechooser");
  await host.click("#online-host");
  const chooser = await chooserP;
  await chooser.setFiles(ROM);
  console.log("→ HOST: ROM elegida por el file chooser. Booteando…");
  await sleep(16000);
  console.log("   host status:", (await getState(host))?.connection);

  // TAB GUEST: click en el botón real "Unirse (Guest)".
  const guest = await ctx.newPage();
  guest.on("pageerror", (e) => console.log("  [guest err]", e.message));
  await guest.goto(URL, { waitUntil: "load" });
  await guest.click("#online-guest");
  console.log("→ GUEST: click 'Unirse'. Esperando…");

  let ok = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const h = await getState(host), g = await getState(guest);
    if (i % 3 === 0) console.log(`   host=${h?.connection}  guest=${g?.connection}`);
    if (h?.connection === "connected" && (g?.connection === "connected" || (g?.connection || "").startsWith("conectado"))) { ok = true; break; }
  }
  console.log(ok ? "\n✓ FLUJO MANUAL OK: conectó" : "\n✗ FLUJO MANUAL: NO conectó (reproduje el bug del usuario)");
} finally {
  await browser.close();
}
