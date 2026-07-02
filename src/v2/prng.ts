// PRNG determinista y seedeable (mulberry32). NO usar Math.random en la sim:
// el netcode justo exige que, dada la misma semilla y los mismos inputs, los dos
// peers produzcan EXACTAMENTE el mismo estado. Math.random rompería eso.
export class PRNG {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** Siguiente entero sin signo de 32 bits. */
  nextU32(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** Entero en [min, max] inclusive. */
  range(min: number, max: number): number {
    return min + (this.nextU32() % (max - min + 1));
  }
  /** Copia el estado interno (para serializar la sim). */
  get state(): number {
    return this.s >>> 0;
  }
  set state(v: number) {
    this.s = v >>> 0;
  }
}
