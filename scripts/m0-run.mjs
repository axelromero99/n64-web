// Corre el spike M0 de forma automatizada con Playwright + la ROM real.
// Uso: node scripts/m0-run.mjs  (requiere el dev server en http://localhost:5173)

import { chromium } from "playwright";

const ROM = "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const URL = "http://localhost:5173/#m0";
const SHOT_DIR =
  "C:/Users/user1/AppData/Local/Temp/claude/C--Users-user1-Desktop-programacion-emu/80055855-84f5-4062-b1cc-00bd6b00ba6b/scratchpad";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: false,
  args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => console.log(`  [page:${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

  console.log("→ Navegando a", URL);
  await page.goto(URL, { waitUntil: "load", timeout: 30000 });

  const coi = await page.evaluate(() => globalThis.crossOriginIsolated);
  const sab = await page.evaluate(() => typeof SharedArrayBuffer !== "undefined");
  console.log(`→ crossOriginIsolated=${coi}  SharedArrayBuffer=${sab}`);

  console.log("→ Cargando ROM:", ROM);
  await page.setInputFiles("#m0-rom", ROM);

  // Esperar boot del core o error (descarga del core puede tardar).
  let booted = false;
  let errored = false;
  for (let i = 0; i < 150; i++) {
    await sleep(1000);
    const disabled = await page.getAttribute("#m0-perf", "disabled").catch(() => "");
    const logtxt = (await page.textContent("#m0-log").catch(() => "")) || "";
    if (disabled === null) {
      booted = true;
      break;
    }
    if (logtxt.includes("ERROR")) {
      errored = true;
      break;
    }
    if (i % 5 === 0) console.log(`   ...esperando boot (${i}s)`);
  }

  if (errored || !booted) {
    const logtxt = await page.textContent("#m0-log").catch(() => "");
    console.log("✗ El core NO arrancó.\n----- LOG -----\n" + logtxt);
    await page.screenshot({ path: `${SHOT_DIR}/m0-fail.png` }).catch(() => {});
    await browser.close();
    process.exit(2);
  }

  console.log("✓ Core arrancado. Dejando correr 12s para estabilizar...");
  await page.click("#m0-canvas").catch(() => {});
  await sleep(12000);
  await page.screenshot({ path: `${SHOT_DIR}/m0-booted.png` }).catch(() => {});

  // --- Performance ---
  console.log("→ Midiendo savestate/loadstate...");
  await page.click("#m0-perf");
  await page.waitForFunction(
    () => (document.querySelector("#m0-results")?.textContent || "").includes("VEREDICTO"),
    { timeout: 120000 },
  );
  const perf = await page.textContent("#m0-results");
  console.log("\n========== PERFORMANCE ==========\n" + perf + "\n");

  // --- Determinismo ---
  console.log("→ Test de determinismo...");
  await page.click("#m0-det");
  await page.waitForFunction(
    () => (document.querySelector("#m0-results")?.textContent || "").includes("DETERMINISMO"),
    { timeout: 120000 },
  );
  const det = await page.textContent("#m0-results");
  console.log("\n========== DETERMINISMO ==========\n" + det + "\n");

  await page.screenshot({ path: `${SHOT_DIR}/m0-done.png` }).catch(() => {});
  console.log("✓ M0 completo. Screenshots en scratchpad.");
} finally {
  await browser.close();
}
