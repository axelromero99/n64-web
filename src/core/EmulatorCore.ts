// La "costura" (seam) que hace posible el rollback mas adelante.
//
// El rollback netcode necesita PODER, sobre el emulador:
//   1) avanzar exactamente 1 frame con inputs dados (frameAdvance)
//   2) guardar el estado completo rapido (saveState)
//   3) restaurar un estado guardado rapido (loadState)
//   4) hacerlo de forma DETERMINISTA: mismos inputs -> mismo estado byte a byte
//
// EmulatorJS (el core del M1, modo local) NO expone esto: corre su propio bucle
// interno. Por eso el modo online usara otro core (fork de N64Wasm) que SI
// implemente esta interfaz. Definirla ahora fija el contrato para M2/M3.

import type { N64Input } from "../input/n64";

export interface EmulatorCore {
  /** Carga una ROM (bytes crudos del .z64/.n64/.v64). */
  loadRom(rom: Uint8Array): Promise<void>;

  /**
   * Avanza EXACTAMENTE un frame usando el input de cada jugador.
   * Debe ser determinista: misma entrada -> mismo resultado, siempre.
   */
  frameAdvance(inputs: N64Input[]): void;

  /**
   * Vuelca el estado completo del emulador (RDRAM + registros + RCP...).
   * Debe ser RAPIDO: el rollback lo llama ~cada frame. Ver el spike M0.
   */
  saveState(): Uint8Array;

  /** Restaura un estado devuelto por saveState(). */
  loadState(state: Uint8Array): void;

  /** Framebuffer actual para pintar en el canvas. */
  getVideo(): { width: number; height: number; pixels: Uint8Array };

  /** Muestras de audio generadas en el ultimo frame. */
  getAudio(): Float32Array;
}

/**
 * Hash rapido del estado, para el DETECTOR DE DESYNC (M4): cada N frames los
 * dos peers intercambian este hash; si difieren, hubo desync -> avisar/re-sync.
 */
export function stateHash(state: Uint8Array): number {
  // FNV-1a 32-bit. Barato y suficiente para detectar divergencias.
  let h = 0x811c9dc5;
  for (let i = 0; i < state.length; i++) {
    h ^= state[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
