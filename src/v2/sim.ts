// Interfaz de simulación determinista para el netcode de v2.
//
// Contrato (lo mismo que necesitará el core N64 cuando exista):
//   - step(inputs): avanzar EXACTAMENTE 1 frame con el input de cada jugador.
//   - serialize()/deserialize(): estado completo (para rollback/resync).
//   - hash(): huella del estado (para detectar desync entre peers).
//   - DETERMINISTA: misma semilla + mismos inputs → mismo estado, siempre.
//
// La demo (PongSim) usa matemática ENTERA a propósito: los floats pueden diferir
// en casos borde entre máquinas/navegadores; los enteros nunca. Es la garantía
// más barata de determinismo para probar el motor.

export interface SimInput {
  /** -1 arriba, +1 abajo, 0 quieto (paleta). */
  paddle: number;
}
export const NEUTRAL: SimInput = { paddle: 0 };

export interface Simulation {
  step(inputs: SimInput[]): void;
  serialize(): Int32Array;
  deserialize(state: Int32Array): void;
  hash(): number;
  render(ctx: CanvasRenderingContext2D, width: number, height: number, youAre: 0 | 1): void;
  /** Marcador para la UI. */
  scores(): [number, number];
}

import { PRNG } from "./prng";

// Campo lógico en unidades enteras (fixed grid). Se escala al pintar.
const W = 1000;
const H = 700;
const PADDLE_H = 120;
const PADDLE_W = 16;
const BALL = 14;
const PADDLE_SPEED = 12;
const MARGIN = 30;
const WIN = 7;

export class PongSim implements Simulation {
  private rng: PRNG;
  private frame = 0;
  private bx = W / 2;
  private by = H / 2;
  private bvx = 0;
  private bvy = 0;
  private p0y = (H - PADDLE_H) / 2; // paleta izquierda (jugador 0)
  private p1y = (H - PADDLE_H) / 2; // paleta derecha (jugador 1)
  private s0 = 0;
  private s1 = 0;

  constructor(seed: number) {
    this.rng = new PRNG(seed);
    this.serveBall(this.rng.nextU32() % 2 === 0 ? -1 : 1);
  }

  private serveBall(dir: number): void {
    this.bx = W / 2;
    this.by = H / 2;
    // velocidad entera con un poco de variación vertical seedeada
    this.bvx = 9 * dir;
    this.bvy = this.rng.range(-6, 6) || 4;
  }

  step(inputs: SimInput[]): void {
    this.frame++;
    // Paletas (enteras, con clamp)
    this.p0y = clamp(this.p0y + (inputs[0]?.paddle | 0) * PADDLE_SPEED, 0, H - PADDLE_H);
    this.p1y = clamp(this.p1y + (inputs[1]?.paddle | 0) * PADDLE_SPEED, 0, H - PADDLE_H);

    // Pelota
    this.bx += this.bvx;
    this.by += this.bvy;

    // Rebote arriba/abajo
    if (this.by <= 0) { this.by = 0; this.bvy = -this.bvy; }
    if (this.by >= H - BALL) { this.by = H - BALL; this.bvy = -this.bvy; }

    // Rebote en paletas
    if (this.bvx < 0 && this.bx <= MARGIN + PADDLE_W && this.bx >= MARGIN &&
        this.by + BALL >= this.p0y && this.by <= this.p0y + PADDLE_H) {
      this.bx = MARGIN + PADDLE_W;
      this.bvx = -this.bvx + 1; // acelera un poco
      this.bvy += this.paddleSpin(this.p0y);
    }
    if (this.bvx > 0 && this.bx + BALL >= W - MARGIN - PADDLE_W && this.bx + BALL <= W - MARGIN &&
        this.by + BALL >= this.p1y && this.by <= this.p1y + PADDLE_H) {
      this.bx = W - MARGIN - PADDLE_W - BALL;
      this.bvx = -this.bvx - 1;
      this.bvy += this.paddleSpin(this.p1y);
    }

    // Puntos
    if (this.bx < -BALL) { this.s1++; this.serveBall(1); }
    if (this.bx > W) { this.s0++; this.serveBall(-1); }
  }

  private paddleSpin(py: number): number {
    // dónde pegó respecto al centro de la paleta → efecto vertical (entero)
    const center = py + PADDLE_H / 2;
    const d = (this.by + BALL / 2) - center;
    return Math.trunc(d / 20);
  }

  serialize(): Int32Array {
    return Int32Array.from([
      this.frame, this.bx, this.by, this.bvx, this.bvy,
      this.p0y, this.p1y, this.s0, this.s1, this.rng.state | 0,
    ]);
  }
  deserialize(s: Int32Array): void {
    [this.frame, this.bx, this.by, this.bvx, this.bvy, this.p0y, this.p1y, this.s0, this.s1] =
      [s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8]];
    this.rng.state = s[9] >>> 0;
  }

  hash(): number {
    // FNV-1a sobre el estado serializado.
    const s = this.serialize();
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s[i] & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (s[i] >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (s[i] >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (s[i] >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  scores(): [number, number] { return [this.s0, this.s1]; }
  static get target(): number { return WIN; }

  render(ctx: CanvasRenderingContext2D, width: number, height: number, youAre: 0 | 1): void {
    const sx = width / W, sy = height / H;
    ctx.fillStyle = "#0b0c1c";
    ctx.fillRect(0, 0, width, height);
    // línea central
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.setLineDash([8, 12]);
    ctx.beginPath(); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.stroke();
    ctx.setLineDash([]);
    // paletas (la tuya en cyan)
    ctx.fillStyle = youAre === 0 ? "#34d6ff" : "#ff4d5e";
    ctx.fillRect(MARGIN * sx, this.p0y * sy, PADDLE_W * sx, PADDLE_H * sy);
    ctx.fillStyle = youAre === 1 ? "#34d6ff" : "#ff4d5e";
    ctx.fillRect((W - MARGIN - PADDLE_W) * sx, this.p1y * sy, PADDLE_W * sx, PADDLE_H * sy);
    // pelota
    ctx.fillStyle = "#fff";
    ctx.fillRect(this.bx * sx, this.by * sy, BALL * sx, BALL * sy);
    // marcador
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `bold ${Math.round(height * 0.09)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(String(this.s0), width * 0.35, height * 0.14);
    ctx.fillText(String(this.s1), width * 0.65, height * 0.14);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
