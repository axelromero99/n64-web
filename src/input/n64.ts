// Modelo del mando de N64 y mapeos por defecto.
//
// En modo LOCAL (M1) es EmulatorJS quien lee los mandos (tiene su propio menu
// de configuracion). Este modulo es el modelo COMPARTIDO que usara el modo
// ONLINE (rollback, M2/M3): ahi necesitamos capturar el input de cada frame
// como un valor pequeno y serializable para enviarlo por la red.

/** Los 14 botones digitales del mando de N64 (1 bit cada uno). */
export enum N64Button {
  A = 1 << 0,
  B = 1 << 1,
  Z = 1 << 2,
  Start = 1 << 3,
  L = 1 << 4,
  R = 1 << 5,
  CUp = 1 << 6,
  CDown = 1 << 7,
  CLeft = 1 << 8,
  CRight = 1 << 9,
  DUp = 1 << 10,
  DDown = 1 << 11,
  DLeft = 1 << 12,
  DRight = 1 << 13,
}

/**
 * Estado de UN mando en UN frame. Es lo que viaja por la red en el modo online:
 * `buttons` es una mascara de bits (N64Button), y el stick va como dos enteros
 * de -128..127 (rango nativo del stick analogico de N64).
 *
 * Cabe en 4 bytes -> ideal para rollback (se manda un paquete diminuto/frame).
 */
export interface N64Input {
  buttons: number; // OR de N64Button
  stickX: number; // -128..127
  stickY: number; // -128..127
}

export const EMPTY_INPUT: N64Input = { buttons: 0, stickX: 0, stickY: 0 };

/** Empaqueta un N64Input en un entero de 32 bits (para enviarlo por WebRTC). */
export function packInput(input: N64Input): number {
  const x = (input.stickX & 0xff) << 14;
  const y = (input.stickY & 0xff) << 22;
  return (input.buttons & 0x3fff) | x | y;
}

/** Desempaqueta lo que produjo packInput(). */
export function unpackInput(packed: number): N64Input {
  const buttons = packed & 0x3fff;
  const stickX = ((packed >> 14) & 0xff) << 24 >> 24; // sign-extend 8 bits
  const stickY = ((packed >> 22) & 0xff) << 24 >> 24;
  return { buttons, stickX, stickY };
}

// --- Mapeos por defecto ("controles preconfigurados") -----------------------

/** Mapeo teclado -> boton/eje N64. Se puede reasignar y guardar (ver config). */
export interface KeyboardMap {
  buttons: Record<string, N64Button>; // event.code -> boton
  axis: {
    up: string;
    down: string;
    left: string;
    right: string;
  };
}

// Esquema ESTÁNDAR — idéntico al del host (ver core/emulatorjs.ts N64_CONTROLS_P0),
// así ambos jugadores usan exactamente los mismos controles.
//   flechas = volante · X=acelerar(A) · Z=frenar(B) · Espacio=derrape(R) · C=Z
//   A=L · Enter=Start · I/J/K/L = botones C
export const DEFAULT_KEYBOARD_P1: KeyboardMap = {
  buttons: {
    KeyX: N64Button.A,
    KeyZ: N64Button.B,
    Space: N64Button.R,
    KeyC: N64Button.Z,
    KeyA: N64Button.L,
    Enter: N64Button.Start,
    KeyI: N64Button.CUp,
    KeyK: N64Button.CDown,
    KeyJ: N64Button.CLeft,
    KeyL: N64Button.CRight,
  },
  axis: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" },
};

/** Preset alternativo: WASD como volante (para zurdos o teclados chicos). */
export const KEYBOARD_WASD: KeyboardMap = {
  buttons: {
    KeyL: N64Button.A, // acelerar
    KeyK: N64Button.B, // frenar
    Space: N64Button.R, // derrape
    KeyJ: N64Button.Z,
    KeyU: N64Button.L,
    Enter: N64Button.Start,
    ArrowUp: N64Button.CUp,
    ArrowDown: N64Button.CDown,
    ArrowLeft: N64Button.CLeft,
    ArrowRight: N64Button.CRight,
  },
  axis: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD" },
};

/** Presets seleccionables en la UI (jugador 2 online). El primero = estándar (= host). */
export interface Preset {
  id: string;
  name: string;
  hint: string;
  map: KeyboardMap;
}
export const KEYBOARD_PRESETS: Preset[] = [
  {
    id: "std",
    name: "Estándar (flechas)",
    hint: "← ↑ ↓ → volante · X acelera · Z frena · Espacio derrape · C = Z · A = L · Enter Start",
    map: DEFAULT_KEYBOARD_P1,
  },
  {
    id: "wasd",
    name: "WASD",
    hint: "W A S D volante · L acelera · K frena · Espacio derrape · Enter Start",
    map: KEYBOARD_WASD,
  },
];

/**
 * Mapeo de gamepad estandar (Xbox/PS via Gamepad API) al mando N64.
 * Los indices siguen el "standard gamepad mapping" del navegador.
 */
export const DEFAULT_GAMEPAD_BUTTONS: Record<number, N64Button> = {
  0: N64Button.A, // A / Cross
  2: N64Button.B, // X / Square
  6: N64Button.Z, // gatillo izq (LT) -> Z
  9: N64Button.Start, // Start
  4: N64Button.L, // LB
  5: N64Button.R, // RB
  12: N64Button.DUp,
  13: N64Button.DDown,
  14: N64Button.DLeft,
  15: N64Button.DRight,
};
// Los botones C se leen del stick derecho (ejes 2 y 3) en gamepad.ts (M2).
