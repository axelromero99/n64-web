// Verifica el esquema de controles unificado:
//  (A) HOST/local: EmulatorJS controls[0] tiene las FLECHAS en el stick (16-19).
//  (B) GUEST: al presionar flechas, el host aplica el eje P2 con 32767 y la
//      polaridad correcta (arriba = índice 19, derecha = índice 16).
import { chromium } from "playwright";

const ROM = process.env.ROM || "C:/Users/user1/Downloads/Mario Kart 64 (E) (V1.1) [!].z64";
const BASE = "http://localhost:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist"] });
try {
  const getState = (p) => p.evaluate(() => window.__n64net || null).catch(() => null);

  // ---- (A) HOST: controles del jugador 1 ----
  const ctxHost = await browser.newContext({ viewport: { width: 760, height: 620 } });
  const host = await ctxHost.newPage();
  host.on("pageerror", (e) => console.log("  [host err]", e.message));
  await host.goto(BASE + "#online", { waitUntil: "load" });
  await host.click("text=Crear una sala");
  await sleep(300);
  await host.setInputFiles("input[type=file]", ROM);
  for (let i = 0; i < 30; i++) { await sleep(1000); if ((await getState(host))?.phase === "waiting") break; }
  await sleep(1500);

  const p1 = await host.evaluate(() => {
    const c = window.EJS_emulator?.controls?.[0];
    if (!c) return null;
    const v = (i) => c[i]?.value;
    return {
      stickR: v(16), stickL: v(17), stickD: v(18), stickU: v(19),
      A: v(0), B: v(1), R: v(11), Ztrig: v(12), start: v(3),
      flag: (() => { try { return localStorage.getItem("n64web-ctrl"); } catch { return null; } })(),
    };
  });
  console.log("\n(A) Controles del HOST (jugador 1):");
  console.log("   stick →/←/↓/↑ :", p1?.stickR, "/", p1?.stickL, "/", p1?.stickD, "/", p1?.stickU);
  console.log("   A/B/R/Z/Start :", p1?.A, "/", p1?.B, "/", p1?.R, "/", p1?.Ztrig, "/", p1?.start, " (flag:", p1?.flag + ")");
  // EmulatorJS convierte los nombres a keyCodes tras setupKeys(): aceptamos ambos.
  const eq = (v, name, code) => v === name || v === code || String(v) === String(code);
  const hostOk = p1 && eq(p1.stickR, "right arrow", 39) && eq(p1.stickL, "left arrow", 37) &&
    eq(p1.stickU, "up arrow", 38) && eq(p1.A, "x", 88) && eq(p1.R, "space", 32) &&
    eq(p1.B, "z", 90) && eq(p1.start, "enter", 13);
  console.log("   " + (hostOk ? "✓ flechas = volante, X acelera, Z frena, Espacio derrape, Enter start" : "✗ no coincide"));

  // ---- (B) GUEST: eje P2 vía simulateInput ----
  await host.evaluate(() => {
    const gm = window.EJS_emulator.gameManager;
    window.__ax = [];
    const orig = gm.simulateInput.bind(gm);
    gm.simulateInput = (p, idx, val) => { if (p === 1 && idx >= 16 && idx <= 19 && val) window.__ax.push({ idx, val }); return orig(p, idx, val); };
  });
  const code = await host.evaluate(() => document.querySelector(".roomcode-box .code")?.textContent || "");
  const ctxGuest = await browser.newContext({ viewport: { width: 760, height: 620 } });
  const guest = await ctxGuest.newPage();
  await guest.goto(`${BASE}?room=${code}#online`, { waitUntil: "load" });
  for (let i = 0; i < 30; i++) { await sleep(1000); if ((await getState(guest))?.phase === "connected") break; }
  await sleep(1500);
  await guest.bringToFront();
  await guest.keyboard.down("ArrowUp"); await sleep(500); await guest.keyboard.up("ArrowUp"); await sleep(300);
  await guest.keyboard.down("ArrowRight"); await sleep(500); await guest.keyboard.up("ArrowRight"); await sleep(300);

  const ax = await host.evaluate(() => window.__ax || []);
  const up = ax.filter((c) => c.idx === 19); // arriba = índice 19
  const upWrong = ax.filter((c) => c.idx === 18); // si aparece 18 al ir arriba, está invertido
  const right = ax.filter((c) => c.idx === 16);
  console.log("\n(B) GUEST → eje del jugador 2:");
  console.log("   ArrowUp    → índice 19 (arriba):", up.length, "llamadas, valor", up[0]?.val, upWrong.length ? "(⚠ también " + upWrong.length + " en 18)" : "");
  console.log("   ArrowRight → índice 16 (derecha):", right.length, "llamadas, valor", right[0]?.val);
  const guestOk = up.some((c) => c.val === 32767) && right.some((c) => c.val === 32767) && upWrong.length === 0;
  console.log("   " + (guestOk ? "✓ polaridad correcta y deflexión 32767" : "✗ revisar"));

  console.log("\n===== RESULTADO =====");
  console.log(hostOk && guestOk ? "✓ Controles unificados OK en host y guest" : "✗ hay algo que ajustar");
  if (!(hostOk && guestOk)) process.exitCode = 1;
} finally { await browser.close(); }
