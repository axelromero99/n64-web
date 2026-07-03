// Smoke de UI + accesibilidad básica (headless, sin ROM):
//  - landing renderiza las 2 cards y son operables con TECLADO (Tab + Enter)
//  - modal de controles abre y cierra con Escape
//  - navegación entre pantallas no rompe (local → landing → online)
//  - el campo de código recibe foco automático
//  - hay favicon (sin 404 de consola)
import { chromium } from "playwright";

const BASE = "http://localhost:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
let ok = true;
const check = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) ok = false; };
try {
  const p = await browser.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(BASE, { waitUntil: "load" });

  check((await p.locator(".card").count()) === 2, "landing: 2 cards (Local y Online)");
  check(await p.evaluate(() => [...document.querySelectorAll(".card")].every((c) => c.getAttribute("role") === "button" && c.tabIndex === 0)), "cards con role=button y tabindex");

  // Activar "Jugar Online" con TECLADO: foco directo + Enter.
  await p.evaluate(() => document.querySelectorAll(".card")[1].focus());
  await p.keyboard.press("Enter");
  await sleep(300);
  check((await p.evaluate(() => location.hash)) === "#online", "card activable con Enter → #online");

  // Tile "Unirse" → campo de código con autofocus.
  await p.click("text=Unirse a una sala");
  await sleep(200);
  check(await p.evaluate(() => document.activeElement?.classList.contains("field-code")), "campo de código con foco automático");

  // Modal de controles: abre y cierra con Escape.
  await p.click("text=🎮 Controles");
  await sleep(200);
  check(await p.evaluate(() => !!document.querySelector(".modal-backdrop")), "modal de controles abre");
  await p.keyboard.press("Escape");
  await sleep(200);
  check(await p.evaluate(() => !document.querySelector(".modal-backdrop")), "modal cierra con Escape");

  // Navegación local → landing → online sin errores de página.
  await p.evaluate(() => (location.hash = "local"));
  await sleep(300);
  await p.evaluate(() => (location.hash = "landing"));
  await sleep(300);
  await p.evaluate(() => (location.hash = "online"));
  await sleep(300);
  check(errors.length === 0, `sin errores de página (${errors.length ? errors.join(" | ") : "ok"})`);

  // Favicon presente.
  check(await p.evaluate(() => !!document.querySelector('link[rel="icon"]')), "favicon declarado");

  console.log("\n===== UI SMOKE =====");
  console.log(ok ? "✓ TODO OK" : "✗ HAY FALLOS");
} finally {
  await browser.close();
  if (!ok) process.exitCode = 1;
}
