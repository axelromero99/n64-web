// Verifica el CICLO DE VIDA de la conexión del online v1:
//  1) Un guest conectado (con una tecla APRETADA) cierra la pestaña de golpe →
//     el host debe volver a "waiting" y RESETEAR el input de P2 (sin el fix,
//     el último input quedaba aplicándose para siempre: P2 acelerando solo).
//  2) Un guest NUEVO entra a la misma sala → el host acepta la re-conexión.
import { chromium } from "playwright";

const ROM = "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const BASE = "http://localhost:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
let ok = true;
const check = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) ok = false; };
try {
  const getState = (p) => p.evaluate(() => window.__n64net || null).catch(() => null);

  // HOST crea la sala y carga la ROM.
  const ctxHost = await browser.newContext({ viewport: { width: 760, height: 620 } });
  const host = await ctxHost.newPage();
  host.on("pageerror", (e) => console.log("  [host err]", e.message));
  await host.goto(BASE + "#online", { waitUntil: "load" });
  await host.click("text=Crear una sala");
  await sleep(300);
  await host.setInputFiles("input[type=file]", ROM);
  for (let i = 0; i < 40; i++) { await sleep(1000); if ((await getState(host))?.phase === "waiting") break; }
  check((await getState(host))?.phase === "waiting", "host listo (waiting)");

  // Instrumentar: registrar lo que se aplica al botón A de P2 (simulateInput(1, 0, v)).
  await host.evaluate(() => {
    const gm = window.EJS_emulator.gameManager;
    window.__p2a = [];
    const orig = gm.simulateInput.bind(gm);
    gm.simulateInput = (p, idx, val) => {
      if (p === 1 && idx === 0) { window.__p2a.push(val); if (window.__p2a.length > 500) window.__p2a.splice(0, 250); }
      return orig(p, idx, val);
    };
  });
  const code = await host.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");
  console.log("  código de sala:", code);

  // GUEST 1 se une y deja el acelerador (KeyX = botón A) APRETADO.
  const ctxG1 = await browser.newContext({ viewport: { width: 760, height: 620 } });
  const g1 = await ctxG1.newPage();
  await g1.goto(`${BASE}?room=${code}#online`, { waitUntil: "load" });
  for (let i = 0; i < 30; i++) { await sleep(1000); if ((await getState(host))?.phase === "connected") break; }
  check((await getState(host))?.phase === "connected", "guest 1 conectado");

  await g1.bringToFront();
  await g1.keyboard.down("KeyX"); // apretado, SIN soltar
  await sleep(1200);
  const pressed = await host.evaluate(() => window.__p2a.slice(-60));
  check(pressed.some((v) => v === 1), "host aplica A=1 de P2 mientras el guest lo mantiene");

  // El guest se cae DE GOLPE (cerrar el contexto = cerrar la pestaña).
  console.log("  cerrando al guest 1 de golpe…");
  await ctxG1.close();

  // El host debe detectarlo (gracia incluida) y volver a "waiting".
  let backToWaiting = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if ((await getState(host))?.phase === "waiting") { backToWaiting = true; break; }
  }
  check(backToWaiting, "host detecta la caída y vuelve a 'waiting'");

  // Con el guest muerto, el input de P2 tiene que estar RESETEADO (A=0).
  await host.evaluate(() => { window.__p2a = []; });
  await sleep(1200);
  const after = await host.evaluate(() => window.__p2a.slice());
  check(after.length > 10 && after.every((v) => v === 0), `input de P2 reseteado tras la caída (${after.filter((v) => v === 1).length} aplicaciones de A=1 en 1.2s)`);

  // GUEST 2 (nuevo) entra a la MISMA sala → debe conectar.
  const ctxG2 = await browser.newContext({ viewport: { width: 760, height: 620 } });
  const g2 = await ctxG2.newPage();
  await g2.goto(`${BASE}?room=${code}#online`, { waitUntil: "load" });
  let reconnected = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const h = await getState(host), g = await getState(g2);
    if (h?.phase === "connected" && g?.phase === "connected") { reconnected = true; break; }
  }
  check(reconnected, "un guest nuevo puede entrar a la misma sala (re-join)");

  console.log("\n===== DESCONEXIÓN / RE-JOIN v1 =====");
  console.log(ok ? "✓ TODO OK: caída detectada, input reseteado, sala reutilizable" : "✗ HAY FALLOS (ver arriba)");
} finally {
  await browser.close();
  if (!ok) process.exitCode = 1;
}
