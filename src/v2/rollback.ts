// Motor de ROLLBACK sobre el lockstep. Oculta la latencia PREDICIENDO el input
// remoto que aún no llegó (repite el último conocido), avanza la simulación, y
// cuando llega el input real re-simula desde el último frame CONFIRMADO.
//
// Diseño (simple y correcto, reusa Simulation.serialize/deserialize/step/hash):
//   - confirmedSim: solo avanza con inputs REALES de ambos → nunca se equivoca.
//     Su estado serializado es el "baseline".
//   - Cada frame visual: deserializamos el baseline en displaySim y re-jugamos
//     desde confirmedNext hasta currentFrame usando inputs reales donde los hay y
//     PREDICCIÓN donde no. Al llegar un input real, el siguiente re-play ya lo usa
//     → la mispredicción se autocorrige (eso ES el rollback).
//   - Ventana de predicción acotada (MAX_PREDICT): si nos adelantamos demasiado
//     sin confirmar, esperamos (como lockstep) para no divergir sin control.
//
// Fairness: los frames CONFIRMADOS usan los mismos inputs reales en ambos peers →
// sus hashes confirmados coinciden. Igual que lockstep, sin ventaja.

import type { Simulation, SimInput } from "./sim";
import { NEUTRAL } from "./sim";
import type { NetMsg } from "./lockstep";

export interface RollbackStatus {
  netcode: "rollback";
  frame: number; // frame que se muestra (predicho)
  confirmed: number; // último frame confirmado
  predicting: number; // frames por delante del confirmado
  rollbacks: number; // mispredicciones corregidas (telemetría)
  desync: boolean;
}

const STEP_MS = 1000 / 60;
const HASH_EVERY = 30;
const MAX_PREDICT = 8;
const MAX_ADVANCE_PER_TICK = 4;
// Tolerancia de frames "del futuro" en mensajes remotos (~20 s a 60 fps).
const MAX_FRAME_AHEAD = 1200;

export class Rollback {
  private confirmedSim: Simulation;
  private displaySim: Simulation;
  private readonly youAre: 0 | 1;
  private readonly send: (m: NetMsg) => void;
  private readonly readInput: () => SimInput;
  private readonly onStatus?: (s: RollbackStatus) => void;

  private local = new Map<number, SimInput>();
  private remote = new Map<number, SimInput>();
  private confirmedHashes = new Map<number, number>();
  private confirmedNext = 0; // frames [0, confirmedNext) están confirmados
  private currentFrame = 0; // próximo frame a mostrar
  private baseline: Int32Array;
  private lastRemote: SimInput = NEUTRAL; // predicción = último remoto confirmado
  private rollbacks = 0;
  private desync = false;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private canvas?: HTMLCanvasElement;

  constructor(opts: {
    newSim: () => Simulation;
    youAre: 0 | 1;
    send: (m: NetMsg) => void;
    readInput: () => SimInput;
    onStatus?: (s: RollbackStatus) => void;
  }) {
    this.confirmedSim = opts.newSim();
    this.displaySim = opts.newSim();
    this.baseline = this.confirmedSim.serialize();
    this.youAre = opts.youAre;
    this.send = opts.send;
    this.readInput = opts.readInput;
    this.onStatus = opts.onStatus;
  }

  private order(l: SimInput, r: SimInput): SimInput[] {
    return this.youAre === 0 ? [l, r] : [r, l];
  }

  receive(m: NetMsg): void {
    // Frames absurdamente adelantados: o es un peer roto o es abuso. Ignorar
    // para que no infle los buffers (el prune solo poda hacia atrás).
    if (m.f > this.currentFrame + MAX_FRAME_AHEAD) return;
    if (m.t === "in") {
      const input: SimInput = { paddle: (m.p as number) | 0 };
      // Telemetría de rollback: si el input real de un frame ya "predicho" difiere
      // de lo que habríamos predicho, cuenta como una corrección.
      if (m.f >= this.confirmedNext && m.f < this.currentFrame && !this.remote.has(m.f)) {
        if (input.paddle !== this.lastRemote.paddle) this.rollbacks++;
      }
      this.remote.set(m.f, input);
    } else if (m.t === "hash") {
      const mine = this.confirmedHashes.get(m.f);
      if (mine !== undefined && mine !== m.h) this.desync = true;
    }
  }

  private advanceConfirmed(): void {
    while (this.local.has(this.confirmedNext) && this.remote.has(this.confirmedNext)) {
      const l = this.local.get(this.confirmedNext)!;
      const r = this.remote.get(this.confirmedNext)!;
      this.confirmedSim.step(this.order(l, r));
      this.lastRemote = r;
      const f = this.confirmedNext;
      this.confirmedNext++;
      this.baseline = this.confirmedSim.serialize();
      const h = this.confirmedSim.hash();
      this.confirmedHashes.set(f, h);
      if (f % HASH_EVERY === 0) this.send({ t: "hash", f, h });
      this.prune(f);
    }
  }

  start(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.acc += Math.min(now - this.last, 250);
      this.last = now;

      // Avanzar el frame que se MUESTRA (predictivo), acotado por la ventana.
      let advanced = 0;
      let blocked = false;
      while (this.acc >= STEP_MS && advanced < MAX_ADVANCE_PER_TICK) {
        if (this.currentFrame - this.confirmedNext >= MAX_PREDICT) { blocked = true; break; } // esperar a confirmar
        const l = this.readInput();
        this.local.set(this.currentFrame, l);
        this.send({ t: "in", f: this.currentFrame, p: l.paddle });
        this.currentFrame++;
        this.acc -= STEP_MS;
        advanced++;
      }
      // Si la ventana de predicción nos frenó, NO acumular "deuda" de tiempo:
      // al volver el rival la partida correría acelerada hasta drenar el
      // atraso (p. ej. tras minimizar la pestaña). Mismo clamp que lockstep.
      if (blocked) this.acc = Math.min(this.acc, STEP_MS);

      this.advanceConfirmed();

      // Reconstruir el estado mostrado desde el baseline confirmado, prediciendo.
      this.displaySim.deserialize(this.baseline);
      for (let f = this.confirmedNext; f < this.currentFrame; f++) {
        const l = this.local.get(f) ?? NEUTRAL;
        const r = this.remote.get(f) ?? this.lastRemote; // predicción
        this.displaySim.step(this.order(l, r));
      }
      this.draw();

      this.onStatus?.({
        netcode: "rollback",
        frame: this.currentFrame,
        confirmed: this.confirmedNext,
        predicting: Math.max(0, this.currentFrame - this.confirmedNext),
        rollbacks: this.rollbacks,
        desync: this.desync,
      });
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private draw(): void {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    if (ctx) this.displaySim.render(ctx, this.canvas.width, this.canvas.height, this.youAre);
  }

  private prune(uptoFrame: number): void {
    const keep = uptoFrame - 240;
    if (keep <= 0) return;
    for (const f of this.local.keys()) if (f < keep) this.local.delete(f);
    for (const f of this.remote.keys()) if (f < keep) this.remote.delete(f);
    for (const f of this.confirmedHashes.keys()) if (f < keep) this.confirmedHashes.delete(f);
  }

  // --- Debug/verificación ---
  get currentFrameNum(): number { return this.currentFrame; }
  get confirmedFrameNum(): number { return this.confirmedNext; }
  hashAt(f: number): number | undefined { return this.confirmedHashes.get(f); }
  get isDesync(): boolean { return this.desync; }
  get rollbackCount(): number { return this.rollbacks; }
}
