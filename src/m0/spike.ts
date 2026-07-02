// M0 — Spike de determinismo + performance.
//
// Pregunta que responde: ¿es viable el rollback de N64 EN el navegador?
// Rollback = por cada frame guardar estado; al llegar un input remoto tarde,
// loadState() y re-simular. Eso exige:
//   (A) saveState/loadState BARATOS  -> se mide con rigor acá
//   (B) estado CHICO (buffer de rollback = size x ~120 frames en RAM)
//   (C) DETERMINISMO (mismos inputs -> mismo estado) -> acá va un test aproximado
//
// Usamos Nostalgist.js (RetroArch + core mupen64plus_next compilado a WASM).
// Expone saveState()/loadState() -> perfecto para (A) y (B). NO expone avance
// frame a frame, asi que el determinismo (C) es "olfateo": el veredicto duro
// llega en M2 con el core propio (N64Wasm) que sí permite frame-step.

import { Nostalgist } from "nostalgist";
import { stateHash } from "../core/EmulatorCore";

type NostalgistInstance = Awaited<ReturnType<typeof Nostalgist.launch>>;

const FRAME_MS = 1000 / 60; // 16.67 ms — presupuesto por frame a 60 fps
const ROLLBACK_BUFFER_FRAMES = 120; // ~2 s de historial de estados

let instance: NostalgistInstance | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

interface Stats {
  avg: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
}

function stats(times: number[]): Stats {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { avg: sum / times.length, p50: q(0.5), p95: q(0.95), min: sorted[0], max: sorted[sorted.length - 1] };
}

const ms = (n: number) => `${n.toFixed(2)} ms`;
const light = (v: number, green: number, yellow: number) => (v <= green ? "🟢" : v <= yellow ? "🟡" : "🔴");

// --- Tests -----------------------------------------------------------------

async function measureLatency(log: (s: string) => void): Promise<string> {
  if (!instance) return "Primero cargá una ROM.";
  const ITER = 30;
  log(`Midiendo saveState x${ITER}...`);

  const saveTimes: number[] = [];
  let size = 0;
  let anchor: Blob | null = null;
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now();
    const { state } = await instance.saveState();
    saveTimes.push(performance.now() - t0);
    size = state.size;
    if (i === 0) anchor = state;
  }

  log(`Midiendo loadState x${ITER}...`);
  const loadTimes: number[] = [];
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now();
    await instance.loadState(anchor!);
    loadTimes.push(performance.now() - t0);
  }

  const s = stats(saveTimes);
  const l = stats(loadTimes);
  const sizeMB = size / (1024 * 1024);
  const bufferMB = (size * ROLLBACK_BUFFER_FRAMES) / (1024 * 1024);
  const savePct = (s.p50 / FRAME_MS) * 100;

  return [
    "== PERFORMANCE (lo que decide la viabilidad) ==",
    "",
    `saveState  ${light(s.p50, 1.5, 4)}  p50 ${ms(s.p50)}  ·  avg ${ms(s.avg)}  ·  p95 ${ms(s.p95)}  ·  max ${ms(s.max)}`,
    `loadState  ${light(l.p50, 2, 5)}  p50 ${ms(l.p50)}  ·  avg ${ms(l.avg)}  ·  p95 ${ms(l.p95)}  ·  max ${ms(l.max)}`,
    `estado     ${light(sizeMB, 1, 4)}  ${sizeMB.toFixed(2)} MB por savestate`,
    "",
    "== ANÁLISIS PARA ROLLBACK ==",
    `• Guardar 1 estado/frame usa ~${savePct.toFixed(0)}% del presupuesto de ${FRAME_MS.toFixed(1)} ms.`,
    `• Buffer de ${ROLLBACK_BUFFER_FRAMES} frames (~2 s) = ~${bufferMB.toFixed(0)} MB de RAM.`,
    `• Re-simular N frames tras un rollback cuesta N × (tiempo de emular 1 frame).`,
    "  → OJO: eso exige que el core corra VARIAS veces más rápido que tiempo real.",
    "  Ese número (throughput) se mide fino en M2 con el core frame-step.",
    "",
    veredicto(s.p50, l.p50, sizeMB),
  ].join("\n");
}

function veredicto(saveP50: number, loadP50: number, sizeMB: number): string {
  const problemas: string[] = [];
  if (saveP50 > 4) problemas.push("saveState caro (guardar cada frame comería el presupuesto → usar delta-states/guardar menos seguido)");
  if (loadP50 > 5) problemas.push("loadState caro");
  if (sizeMB > 4) problemas.push("estado grande (buffer pesado → comprimir o delta-states)");
  if (problemas.length === 0) {
    return "VEREDICTO: 🟢 números sanos para rollback. Adelante con M2 (core frame-step + NetplayJS).";
  }
  return "VEREDICTO: 🟡 revisar → " + problemas.join("; ") + ".";
}

async function testDeterminism(log: (s: string) => void): Promise<string> {
  if (!instance) return "Primero cargá una ROM.";
  const ROUNDS = 6;
  const RUN_MS = 250;
  log("Test de determinismo (aproximado)... no toques los controles.");

  const { state: S } = await instance.saveState();
  const hashes: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    await instance.loadState(S);
    await sleep(RUN_MS); // dejar correr el mismo tiempo con input neutro
    const { state } = await instance.saveState();
    hashes.push(stateHash(await blobBytes(state)));
    log(`  ronda ${r + 1}/${ROUNDS}: hash ${hashes[r].toString(16)}`);
  }

  const distinct = new Set(hashes).size;
  const linea =
    distinct === 1
      ? "🟢 1 solo hash → señal fuerte de determinismo desde savestate."
      : `🟡 ${distinct} hashes distintos → puede ser no-determinismo O jitter de conteo de frames (sin frame-step no se distingue).`;

  return [
    "== DETERMINISMO (aproximado) ==",
    linea,
    "",
    "Nota honesta: este test corre por tiempo de reloj, así que el nº de frames",
    "puede variar ±1 entre rondas y dar hashes distintos aunque el core SEA",
    "determinista. El veredicto DURO llega en M2 con avance frame a frame.",
    "Prior fuerte a favor: RMG-K ya probó este core (mupen64plus/ParaLLEl)",
    "determinista para rollback en escritorio, y el float de WASM es IEEE-strict.",
  ].join("\n");
}

function toggleFastForward(log: (s: string) => void): void {
  const mod = instance?.getEmscriptenModule() as unknown as Record<string, undefined | (() => void)>;
  const fn = mod?.["_cmd_toggle_fast_forward"];
  if (typeof fn === "function") {
    fn();
    log("Fast-forward alternado. Si el juego se acelera mucho, hay margen (headroom) para re-simular.");
  } else {
    log("Este build no expone fast-forward por comando. (No crítico para el spike.)");
  }
}

// --- UI --------------------------------------------------------------------

export function renderSpike(host: HTMLElement): void {
  host.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = "🔬 Spike M0 — determinismo + performance";
  const intro = document.createElement("p");
  intro.className = "muted small";
  intro.textContent =
    "Cargá una ROM, entrá a una partida (pasá intros/menús) y corré los tests. " +
    "Mide el coste real de savestate/loadstate en TU navegador: eso decide si el rollback de N64 en web es viable.";

  const canvas = document.createElement("canvas");
  canvas.id = "m0-canvas";
  canvas.width = 640;
  canvas.height = 480;
  canvas.style.cssText = "width:100%;aspect-ratio:4/3;background:#000;border-radius:12px;margin:12px 0;";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".z64,.n64,.v64,.zip";
  fileInput.style.display = "none";
  fileInput.id = "m0-rom";
  const fileLabel = document.createElement("label");
  fileLabel.className = "btn";
  fileLabel.htmlFor = "m0-rom";
  fileLabel.textContent = "📁 Cargar ROM";

  const btnPerf = mkBtn("⏱️ Medir savestate/loadstate", true);
  btnPerf.id = "m0-perf";
  const btnDet = mkBtn("🎲 Test determinismo (aprox)", true);
  btnDet.id = "m0-det";
  const btnFF = mkBtn("⏩ Fast-forward", true);
  btnFF.id = "m0-ff";
  const back = mkBtn("← Volver", false, "ghost");
  back.onclick = () => (location.hash = "landing");

  const results = document.createElement("pre");
  results.id = "m0-results";
  results.style.cssText =
    "white-space:pre-wrap;background:#0b0c1c;border:1px solid #2b2e52;border-radius:12px;padding:16px;margin-top:16px;font-size:13px;min-height:60px;";
  results.textContent = "(resultados acá)";

  const logBox = document.createElement("pre");
  logBox.id = "m0-log";
  logBox.style.cssText = "white-space:pre-wrap;color:#9aa0c7;font-size:12px;margin-top:8px;max-height:140px;overflow:auto;";
  const log = (s: string) => {
    logBox.textContent += s + "\n";
    logBox.scrollTop = logBox.scrollHeight;
  };

  fileInput.onchange = async () => {
    const rom = fileInput.files?.[0];
    if (!rom) return;
    fileLabel.textContent = "Cargando core N64…";
    log("Descargando core mupen64plus_next (WASM) + arrancando ROM…");
    try {
      instance = await Nostalgist.launch({ core: "mupen64plus_next", rom, element: canvas });
      fileLabel.textContent = "✅ ROM cargada";
      log("Core corriendo. Entrá a una partida y después medí.");
      for (const b of [btnPerf, btnDet, btnFF]) b.disabled = false;
    } catch (e) {
      fileLabel.textContent = "📁 Cargar ROM";
      log("ERROR al lanzar: " + (e as Error).message);
      log("Si es por CORS/COEP del core, self-hospedá el core o probá 'parallel-n64'.");
    }
  };

  btnPerf.onclick = async () => {
    btnPerf.disabled = true;
    results.textContent = "Midiendo…";
    try {
      results.textContent = await measureLatency(log);
    } catch (e) {
      results.textContent = "ERROR perf: " + (e as Error).message;
      log("ERROR perf: " + (e as Error).message);
    }
    btnPerf.disabled = false;
  };
  btnDet.onclick = async () => {
    btnDet.disabled = true;
    results.textContent = "Corriendo test de determinismo…";
    try {
      results.textContent = await testDeterminism(log);
    } catch (e) {
      results.textContent = "ERROR det: " + (e as Error).message;
      log("ERROR det: " + (e as Error).message);
    }
    btnDet.disabled = false;
  };
  btnFF.onclick = () => toggleFastForward(log);

  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:center;";
  controls.append(fileInput, fileLabel, btnPerf, btnDet, btnFF);

  host.append(title, intro, canvas, controls, results, logBox, document.createElement("br"), back);
}

function mkBtn(label: string, disabled: boolean, variant = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "btn " + variant;
  b.textContent = label;
  b.disabled = disabled;
  return b;
}
