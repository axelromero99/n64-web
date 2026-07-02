// Motor de netcode LOCKSTEP determinista (transport-agnostic).
//
// Por qué es JUSTO: los dos peers corren la MISMA simulación desde la MISMA
// semilla e intercambian SOLO inputs. Un frame se simula únicamente cuando están
// los inputs de AMBOS jugadores para ese frame. Si falta el del rival, se ESPERA
// (stall) — pero se espera igual en las dos puntas, así que nadie tiene ventaja.
//
// input-delay (D): cada peer decide su input D frames en el futuro y lo envía ya.
// Eso le da a la red D frames para entregarlo antes de que haga falta. Los
// primeros D frames usan input neutro (asumido idéntico por ambos → determinista).
//
// (Rollback = esto + predicción para ocultar la latencia del stall. Se puede
// agregar encima en una v2.1; lockstep ya prueba la propiedad de fairness.)

import type { Simulation, SimInput } from "./sim";
import { NEUTRAL } from "./sim";

export interface NetMsg {
  t: "in" | "hash";
  f: number; // frame
  p?: number; // paddle (-1/0/1) para "in"
  h?: number; // hash para "hash"
}

export interface LockstepStatus {
  frame: number;
  stalled: boolean;
  desync: boolean;
  /** frames de ventaja de inputs remotos disponibles (buffer). */
  ahead: number;
}

const STEP_MS = 1000 / 60;
const HASH_EVERY = 30;
const MAX_ADVANCE_PER_TICK = 6;
// Tolerancia de frames "del futuro" en mensajes remotos (~20 s a 60 fps).
const MAX_FRAME_AHEAD = 1200;

export class Lockstep {
  private readonly sim: Simulation;
  private readonly youAre: 0 | 1;
  private readonly D: number;
  private readonly send: (m: NetMsg) => void;
  private readonly readInput: () => SimInput;
  private readonly onStatus?: (s: LockstepStatus) => void;

  private local = new Map<number, SimInput>();
  private remote = new Map<number, SimInput>();
  private hashes = new Map<number, number>();
  private simFrame = 0;
  private nextLocalFrame: number;
  private desync = false;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private canvas?: HTMLCanvasElement;

  constructor(opts: {
    sim: Simulation;
    youAre: 0 | 1;
    inputDelay?: number;
    send: (m: NetMsg) => void;
    readInput: () => SimInput;
    onStatus?: (s: LockstepStatus) => void;
  }) {
    this.sim = opts.sim;
    this.youAre = opts.youAre;
    this.D = opts.inputDelay ?? 3;
    this.send = opts.send;
    this.readInput = opts.readInput;
    this.onStatus = opts.onStatus;
    // Prefill de los primeros D frames con input neutro (ambos lo asumen igual).
    for (let f = 0; f < this.D; f++) { this.local.set(f, NEUTRAL); this.remote.set(f, NEUTRAL); }
    this.nextLocalFrame = this.D;
  }

  /** Mensaje recibido del peer. */
  receive(m: NetMsg): void {
    // Frames absurdamente adelantados: peer roto o abuso → ignorar (no dejar
    // que inflen los buffers; el prune solo poda hacia atrás).
    if (m.f > this.simFrame + MAX_FRAME_AHEAD) return;
    if (m.t === "in") {
      this.remote.set(m.f, { paddle: (m.p as number) | 0 });
    } else if (m.t === "hash") {
      const mine = this.hashes.get(m.f);
      if (mine !== undefined && mine !== m.h) this.desync = true;
    }
  }

  start(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.acc += Math.min(now - this.last, 250); // cap para evitar spiral
      this.last = now;
      let stalled = false;
      let advanced = 0;
      while (this.acc >= STEP_MS && advanced < MAX_ADVANCE_PER_TICK) {
        // Capturar+enviar input local para los frames futuros (hasta simFrame+D).
        while (this.nextLocalFrame <= this.simFrame + this.D) {
          const inp = this.readInput();
          this.local.set(this.nextLocalFrame, inp);
          this.send({ t: "in", f: this.nextLocalFrame, p: inp.paddle });
          this.nextLocalFrame++;
        }
        const l = this.local.get(this.simFrame);
        const r = this.remote.get(this.simFrame);
        if (l === undefined || r === undefined) { stalled = true; break; } // esperar al rival
        const inputs: SimInput[] = this.youAre === 0 ? [l, r] : [r, l];
        this.sim.step(inputs);
        const h = this.sim.hash();
        this.hashes.set(this.simFrame, h);
        if (this.simFrame % HASH_EVERY === 0) this.send({ t: "hash", f: this.simFrame, h });
        this.prune(this.simFrame);
        this.simFrame++;
        this.acc -= STEP_MS;
        advanced++;
      }
      // Al estar frenados esperando al rival, no acumular "deuda" de tiempo
      // (la partida correría acelerada al destrabarse).
      if (advanced === 0 && this.acc >= STEP_MS) stalled = true;
      if (stalled) this.acc = Math.min(this.acc, STEP_MS);
      this.draw();
      const ahead = this.maxRemoteFrame() - this.simFrame;
      this.onStatus?.({ frame: this.simFrame, stalled, desync: this.desync, ahead: Math.max(0, ahead) });
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // --- Debug/verificación ---
  get currentFrame(): number { return this.simFrame; }
  hashAt(f: number): number | undefined { return this.hashes.get(f); }
  get isDesync(): boolean { return this.desync; }

  private draw(): void {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    if (ctx) this.sim.render(ctx, this.canvas.width, this.canvas.height, this.youAre);
  }

  private maxRemoteFrame(): number {
    let m = -1;
    for (const f of this.remote.keys()) if (f > m) m = f;
    return m;
  }

  private prune(uptoFrame: number): void {
    const keep = uptoFrame - 120;
    if (keep <= 0) return;
    for (const f of this.local.keys()) if (f < keep) this.local.delete(f);
    for (const f of this.remote.keys()) if (f < keep) this.remote.delete(f);
    for (const f of this.hashes.keys()) if (f < keep) this.hashes.delete(f);
  }
}
