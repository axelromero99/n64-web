// Verifica el multijugador LOCAL de hasta 4 (Mario Party & co.) con presets por
// jugador. NO se queda en los mapeos: PRESIONA TECLAS DE VERDAD y confirma que
// cada jugador recibe input dentro del emulador (hook de gameManager.simulateInput).
//
//  (A) LOCAL default (simple): P1 al teclado (Flechas) y los 4 con GAMEPAD.
//  (B) BEHAVIORAL: apretar teclas mueve al jugador correcto —
//        · P1 Flechas: ArrowUp → stick↑ de P1 · X → A de P1
//        · P2 (preset WASD): W → stick↑ de P2 · A → izquierda de P2
//      y cambiar el preset de un jugador no toca a los demás.
//  (C) NUMPAD: input real inyectando el keyCode 104 (= numpad 8 con Bloq Num ON)
//      en el handler de EmulatorJS; y que la UI avise si NumLock está OFF.
//  (D) GAMEPAD: mando VIRTUAL por la Gamepad API (navigator.getGamepads) — el
//      value2 que cargamos es el default OFICIAL de EmulatorJS; se confirma que
//      auto-asigna el 1er mando a P1 y el 2º a P2, y que mueven al core.
//  (E) ONLINE (host): P2-P4 sin control local (el invitado llega por la red).
import { chromium } from "playwright";

const ROM = process.env.ROM || "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const BASE = process.env.BASE || "http://localhost:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
let ok = true;
const check = (cond, label) => { console.log(`   ${cond ? "✓" : "✗"} ${label}`); if (!cond) ok = false; };
const note = (label) => console.log(`   • ${label}`);
const waitStarted = async (p) => { for (let i = 0; i < 40; i++) { await sleep(1000); if (await p.evaluate(() => !!window.EJS_emulator?.started)) return true; } return false; };

// Instala un hook que registra las llamadas a simulateInput con valor != 0.
const hookInput = (p) => p.evaluate(() => {
  const gm = window.EJS_emulator.gameManager;
  window.__calls = [];
  const orig = gm.simulateInput.bind(gm);
  gm.simulateInput = (pl, i, v) => { if (v) window.__calls.push({ pl, i, v }); return orig(pl, i, v); };
});
// Presiona una tecla real y devuelve las llamadas provocadas.
const press = async (p, key) => {
  await p.evaluate(() => (window.__calls = []));
  await p.keyboard.down(key); await sleep(130); await p.keyboard.up(key); await sleep(120);
  return p.evaluate(() => window.__calls);
};
const hit = (calls, pl, i) => calls.some((c) => c.pl === pl && c.i === i && c.v > 0);

try {
  // ---- (A) LOCAL default ----
  const ctxL = await browser.newContext({ viewport: { width: 820, height: 720 } });
  const local = await ctxL.newPage();
  local.on("pageerror", (e) => console.log("  [local err]", e.message));
  await local.goto(BASE + "#local", { waitUntil: "load" });
  await local.setInputFiles("input[type=file]", ROM);
  const started = await waitStarted(local);
  await sleep(1500);

  console.log("\n(A) LOCAL — default simple (P1 teclado, los 4 con gamepad):");
  const d = started ? await local.evaluate(() => {
    const c = window.EJS_emulator.controls;
    const kb = (p) => Object.values(c[p] || {}).filter((x) => x && typeof x.value === "number" && x.value > 0).length;
    return { p1A: c[0]?.[0]?.value2, pads: [0, 1, 2, 3].map((p) => c[p]?.[0]?.value2), kb: [0, 1, 2, 3].map(kb) };
  }) : null;
  check(!!started, "arrancó el emulador");
  if (d) {
    check(d.pads.every((v) => v === "BUTTON_2"), "los 4 jugadores tienen gamepad (enchufás mandos y andan)");
    check(d.kb[0] > 6 && d.kb[1] === 0 && d.kb[2] === 0 && d.kb[3] === 0, "solo P1 en teclado por defecto (P2-P4 solo mando)");
  }

  // ---- (B) BEHAVIORAL: apretar teclas mueve al jugador correcto ----
  console.log("\n(B) LOCAL — presionar teclas DE VERDAD mueve al jugador correcto:");
  await local.evaluate(() => document.body.focus());
  await hookInput(local);

  const up = await press(local, "ArrowUp");
  check(hit(up, 0, 19), "ArrowUp → stick ↑ del Jugador 1");
  const x = await press(local, "KeyX");
  check(hit(x, 0, 0), "X → A del Jugador 1");

  // Cambiar P2 a WASD desde el selector y volver a apretar.
  await local.selectOption('.preset-select[data-player="1"]', "wasd");
  await sleep(300);
  const w = await press(local, "KeyW");
  check(hit(w, 1, 19), "tras elegir WASD para P2: W → stick ↑ del Jugador 2");
  const a = await press(local, "KeyA");
  check(hit(a, 1, 17), "A → izquierda del Jugador 2");

  // Que P1 siga andando (no lo pisó el cambio de P2).
  const up2 = await press(local, "ArrowUp");
  check(hit(up2, 0, 19) && !hit(up2, 1, 19), "P1 intacto: ArrowUp sigue moviendo solo a P1");

  // ---- (C) NUMPAD: input real por keyCode 104 (= numpad 8 con NumLock ON) ----
  // Playwright fuerza NumLock OFF (numpad → flechas), así que no se puede apretar
  // la tecla física. Pero SÍ inyectamos en el handler real de EmulatorJS el keyCode
  // EXACTO que produce un numpad con NumLock ON, y confirmamos que mueve a P3.
  console.log("\n(C) LOCAL — preset Numpad (keyCode 104 = numpad 8 con Bloq Num ON):");
  await local.selectOption('.preset-select[data-player="2"]', "numpad");
  await sleep(300);
  await hookInput(local);
  const np = await local.evaluate(() => {
    const el = window.EJS_emulator.elements.parent; // donde EmulatorJS escucha el teclado
    window.__calls = [];
    const send = (type, kc) => el.dispatchEvent(new KeyboardEvent(type, { keyCode: kc, which: kc, bubbles: true }));
    send("keydown", 104); send("keyup", 104); // numpad 8 (NumLock ON) = stick ↑
    send("keydown", 96); send("keyup", 96);   // numpad 0 = A
    return window.__calls;
  });
  check(hit(np, 2, 19), "numpad 8 (keyCode 104) → stick ↑ del Jugador 3");
  check(hit(np, 2, 0), "numpad 0 (keyCode 96) → A del Jugador 3");

  // Footgun de NumLock: apretar el numpad físico con NumLock OFF (lo que hace el
  // headless) debe disparar el aviso en vivo de la UI.
  await local.evaluate(() => document.body.focus());
  await local.keyboard.press("Numpad8");
  await sleep(250);
  const warn = await local.evaluate(() => document.querySelector(".toast")?.textContent || "");
  check(/Bloq Num/i.test(warn), "con NumLock OFF, la UI avisa en vivo (no falla en silencio)");

  // ---- (D) GAMEPAD: mando virtual manejando el core de VERDAD ----
  // El mapeo value2 que cargamos es IDÉNTICO al default oficial de EmulatorJS
  // (verificado contra su fuente). Acá inyectamos un mando por la Gamepad API
  // (navigator.getGamepads) y confirmamos que EmulatorJS lo auto-asigna y que
  // sus botones/stick mueven al jugador correcto. Índices estándar: botón 1 =
  // BUTTON_2 = A de N64, botón 9 = START, botón 6 = Z, eje 0 = stick X.
  console.log("\n(D) LOCAL — mando (Gamepad API) virtual manejando el core:");
  await local.evaluate(() => {
    const mk = (index) => ({ index, id: `Virtual ${index} (STANDARD GAMEPAD)`, connected: true, mapping: "standard", timestamp: 0,
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0, touched: false })) });
    window.__pads = [mk(0)];
    const getter = () => window.__pads.map((g) => g ? { ...g, buttons: g.buttons.map((x) => ({ ...x })), axes: [...g.axes] } : null);
    try { Object.defineProperty(navigator, "getGamepads", { value: getter, configurable: true }); } catch { navigator.getGamepads = getter; }
  });
  await sleep(600); // dejar que EmulatorJS registre 'connected' y lo auto-asigne + refrescar badge
  const assigned1 = await local.evaluate(() => (window.EJS_emulator?.gamepadSelection || [])[0]);
  check(!!assigned1, "1er mando auto-asignado al Jugador 1");
  const badge1 = await local.evaluate(() => document.querySelector('.gp-badge[data-player="0"]')?.classList.contains("on"));
  check(!!badge1, "badge '🎮 mando' del Jugador 1 se enciende al detectarlo");

  const padBtn = async (pad, btn) => {
    await hookInput(local);
    await local.evaluate(({ pad, btn }) => { const b = window.__pads[pad].buttons[btn]; b.pressed = true; b.value = 1; window.__pads[pad].timestamp = performance.now(); }, { pad, btn });
    await sleep(120);
    await local.evaluate(({ pad, btn }) => { const b = window.__pads[pad].buttons[btn]; b.pressed = false; b.value = 0; window.__pads[pad].timestamp = performance.now(); }, { pad, btn });
    await sleep(100);
    return local.evaluate(() => window.__calls);
  };
  const padAxis = async (pad, axis, val) => {
    await hookInput(local);
    await local.evaluate(({ pad, axis, val }) => { window.__pads[pad].axes[axis] = val; window.__pads[pad].timestamp = performance.now(); }, { pad, axis, val });
    await sleep(140);
    await local.evaluate(({ pad, axis }) => { window.__pads[pad].axes[axis] = 0; window.__pads[pad].timestamp = performance.now(); }, { pad, axis });
    await sleep(100);
    return local.evaluate(() => window.__calls);
  };
  check(hit(await padBtn(0, 1), 0, 0), "mando 1: botón A (BUTTON_2) → A del Jugador 1");
  check(hit(await padBtn(0, 9), 0, 3), "mando 1: START → Start del Jugador 1");
  check(hit(await padAxis(0, 0, 1), 0, 16), "mando 1: stick → derecha del Jugador 1");

  // 2º mando → se auto-asigna a P2 y lo maneja (así hasta 4).
  await local.evaluate(() => window.__pads.push({ index: 1, id: "Virtual 1 (STANDARD GAMEPAD)", connected: true, mapping: "standard", timestamp: performance.now(),
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0, touched: false })) }));
  await sleep(600);
  const assigned2 = await local.evaluate(() => (window.EJS_emulator?.gamepadSelection || [])[1]);
  check(!!assigned2, "2º mando auto-asignado al Jugador 2 (así hasta 4)");
  const badge2 = await local.evaluate(() => document.querySelector('.gp-badge[data-player="1"]')?.classList.contains("on"));
  check(!!badge2, "badge del Jugador 2 se enciende al enchufar el 2º mando");
  check(hit(await padBtn(1, 1), 1, 0), "mando 2: botón A → A del Jugador 2");
  await ctxL.close();

  // ---- (D) ONLINE (host): P2-P4 sin control local ----
  const ctxO = await browser.newContext({ viewport: { width: 820, height: 720 } });
  const host = await ctxO.newPage();
  host.on("pageerror", (e) => console.log("  [host err]", e.message));
  await host.goto(BASE + "#online", { waitUntil: "load" });
  await host.click("text=Crear una sala");
  await sleep(300);
  await host.setInputFiles("input[type=file]", ROM);
  await waitStarted(host);
  await sleep(1500);
  const online = await host.evaluate(() => {
    const c = window.EJS_emulator?.controls || {};
    const empty = (p) => Object.values(c[p] || {}).every((x) => !x || (x.value === undefined || x.value === "") && (x.value2 === undefined || x.value2 === ""));
    return { p1Has: !!c[0]?.[0]?.value2, p2Empty: empty(1), p3Empty: empty(2), p4Empty: empty(3) };
  });
  console.log("\n(E) ONLINE (host) — el invitado llega por la red, no por teclado local:");
  check(online.p1Has, "host conserva su P1 local");
  check(online.p2Empty && online.p3Empty && online.p4Empty, "P2-P4 SIN control local (no pelean con el invitado)");
  await ctxO.close();

  console.log("\n===== MULTIJUGADOR =====");
  console.log(ok ? "✓ teclado (presets) y mando verificados manejando el core; online intacto" : "✗ hay algo que ajustar");
} finally {
  await browser.close();
  if (!ok) process.exitCode = 1;
}
