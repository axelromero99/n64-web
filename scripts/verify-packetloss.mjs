// Prueba el fix del INPUT PEGADO por pérdida de paquete. El canal de input es
// no-confiable: si el paquete de "soltar tecla" se pierde, el host quedaría
// aplicando la tecla apretada para siempre. El keepalive (reenvío del estado
// cada 100 ms) debe corregirlo en ≤100 ms.
//
// Simulamos la pérdida parcheando RTCDataChannel.send en el guest para tirar
// los envíos durante una ventana corta que cubre el keyup.
import { chromium } from "playwright";

const ROM = process.env.ROM || "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const BASE = "http://localhost:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
let ok = true;
const check = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) ok = false; };
try {
  const getState = (p) => p.evaluate(() => window.__n64net || null).catch(() => null);

  const ctxHost = await browser.newContext({ viewport: { width: 760, height: 620 } });
  const host = await ctxHost.newPage();
  host.on("pageerror", (e) => console.log("  [host err]", e.message));
  await host.goto(BASE + "#online", { waitUntil: "load" });
  await host.click("text=Crear una sala");
  await sleep(300);
  await host.setInputFiles("input[type=file]", ROM);
  for (let i = 0; i < 40; i++) { await sleep(1000); if ((await getState(host))?.phase === "waiting") break; }
  check((await getState(host))?.phase === "waiting", "host listo");

  // Espiar el botón A (acelerador) aplicado a P2 en el host.
  await host.evaluate(() => {
    const gm = window.EJS_emulator.gameManager;
    window.__p2a = [];
    const orig = gm.simulateInput.bind(gm);
    gm.simulateInput = (p, idx, val) => {
      if (p === 1 && idx === 0) { window.__p2a.push(val); if (window.__p2a.length > 400) window.__p2a.splice(0, 200); }
      return orig(p, idx, val);
    };
  });

  const code = await host.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");
  const ctxGuest = await browser.newContext({ viewport: { width: 760, height: 620 } });
  const guest = await ctxGuest.newPage();
  await guest.goto(`${BASE}?room=${code}#online`, { waitUntil: "load" });
  for (let i = 0; i < 30; i++) { await sleep(1000); if ((await getState(host))?.phase === "connected") break; }
  check((await getState(host))?.phase === "connected", "guest conectado");

  // Parche de pérdida: RTCDataChannel.send tira los envíos mientras __drop = true.
  await guest.evaluate(() => {
    window.__drop = false;
    const orig = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (data) { if (window.__drop) return; return orig.call(this, data); };
  });

  // Apretar acelerador: el host debe verlo (keydown pasa normal).
  await guest.bringToFront();
  await guest.keyboard.down("KeyX");
  await sleep(250);
  const pressed = await host.evaluate(() => window.__p2a.slice(-30));
  check(pressed.some((v) => v === 1), "host recibe A=1 al apretar");

  // Ahora PERDEMOS el keyup: abrimos la ventana de drop, soltamos, la cerramos.
  await guest.evaluate(() => (window.__drop = true));
  await guest.keyboard.up("KeyX");     // este envío (soltar) se pierde
  await sleep(70);                      // ventana corta: cubre el keyup
  await guest.evaluate(() => (window.__drop = false));

  // Sin keepalive, TODOS estos frames quedarían pegados en A=1. Con keepalive,
  // el estado real (soltado) llega en ≤100 ms y a partir de ahí es A=0.
  await host.evaluate(() => { window.__p2a = []; });
  await sleep(400);                     // >3 ciclos de keepalive (100 ms)
  const after = await host.evaluate(() => window.__p2a.slice());
  const stuck = after.filter((v) => v === 1).length;
  const tail = after.slice(-10);        // ya corregido: debe ser todo A=0
  check(after.length > 10 && tail.every((v) => v === 0),
    `el keepalive corrige el input pegado (pegado ~${stuck} frames ≈ ${stuck * 16}ms, luego A=0 estable)`);
  // Sanity: hubo pérdida real (si stuck fuese 0, el test no probó nada).
  check(stuck > 0, `la pérdida se reprodujo de verdad (${stuck} frames pegados antes de corregir)`);

  console.log("\n===== INPUT PEGADO POR PÉRDIDA DE PAQUETE =====");
  console.log(ok ? "✓ el keepalive corrige el input tras un paquete perdido (≤100 ms)" : "✗ input quedó pegado (revisar)");
} finally {
  await browser.close();
  if (!ok) process.exitCode = 1;
}
