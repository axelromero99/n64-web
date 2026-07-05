// Core del M1: EmulatorJS (modo LOCAL + jugador 1 del online).
//
// EmulatorJS envuelve un core de N64 compilado a WASM y ya trae
// GRATIS lo que necesitamos para el modo local:
//   - hasta 4 jugadores locales (varios mandos en el mismo PC)
//   - guardado rapido, fullscreen, menu de reasignacion, etc.
//
// Se carga desde el CDN oficial (cdn.emulatorjs.org) -> cero binarios en el repo.
// La ROM la elige el usuario desde su disco: creamos un object URL local, asi la
// ROM NUNCA sale de su navegador.
//
// CONTROLES: el default de EmulatorJS para N64 es confuso (flechas = D-Pad, y el
// stick analogico en H/F/G/T). Como en N64 se maneja con el STICK, lo remapeamos
// a un esquema claro con las FLECHAS = stick. Ver N64_CONTROLS_P0.

// Estructura de un control de EmulatorJS: value = nombre de tecla (string).
interface EJSControl { value?: string; value2?: string }
type EJSControllers = Record<number, Record<number, EJSControl>>;

interface EJSEmu {
  controls?: EJSControllers;
  setupKeys?: () => void;
  checkGamepadInputs?: () => void;
  saveSettings?: () => void;
  // Un slot por jugador ("id_index" del mando asignado, o "" si ninguno).
  // Lo usa la UI para mostrar qué jugadores tienen un mando enchufado.
  gamepadSelection?: string[];
}

declare global {
  interface Window {
    EJS_player?: string;
    EJS_core?: string;
    EJS_gameUrl?: string;
    EJS_gameName?: string;
    EJS_pathtodata?: string;
    EJS_startOnLoaded?: boolean;
    EJS_defaultControllers?: EJSControllers;
    EJS_ready?: () => void;
    EJS_emulator?: EJSEmu;
  }
}

// Versión FIJADA (no "stable"): un update sorpresa del CDN podría cambiar los
// índices de simulateInput o el comportamiento del core en producción sin que
// nadie toque este repo. Para subirla: cambiar acá y correr
// scripts/verify-controls.mjs + verify-fair.mjs contra la ROM real.
const EJS_CDN = "https://cdn.emulatorjs.org/4.2.3/data/";

// Esquema de teclado claro para el JUGADOR 1 (índices de botón de EmulatorJS N64).
// Debe coincidir con el preset del guest (input/n64.ts) para que ambos jueguen igual.
//   flechas = stick · X=acelerar(A) · Z=frenar(B) · Espacio=derrape(R) · C=Z(gatillo)
//   A=L · Enter=Start · I/J/K/L = botones C
const N64_CONTROLS_P0: Record<number, EJSControl> = {
  0: { value: "x", value2: "BUTTON_2" }, // A — acelerar
  1: { value: "z", value2: "BUTTON_4" }, // B — frenar / marcha atrás
  2: { value: "", value2: "SELECT" },
  3: { value: "enter", value2: "START" },
  4: { value: "up arrow", value2: "DPAD_UP" }, // D-Pad también en flechas (inofensivo)
  5: { value: "down arrow", value2: "DPAD_DOWN" },
  6: { value: "left arrow", value2: "DPAD_LEFT" },
  7: { value: "right arrow", value2: "DPAD_RIGHT" },
  8: { value: "", value2: "BUTTON_1" },
  9: { value: "", value2: "BUTTON_3" },
  10: { value: "a", value2: "LEFT_TOP_SHOULDER" }, // L
  11: { value: "space", value2: "RIGHT_TOP_SHOULDER" }, // R — derrape/salto
  12: { value: "c", value2: "LEFT_BOTTOM_SHOULDER" }, // Z (gatillo)
  13: { value: "", value2: "RIGHT_BOTTOM_SHOULDER" },
  14: { value: "", value2: "LEFT_STICK" },
  15: { value: "", value2: "RIGHT_STICK" },
  16: { value: "right arrow", value2: "LEFT_STICK_X:+1" }, // volante →
  17: { value: "left arrow", value2: "LEFT_STICK_X:-1" }, // volante ←
  18: { value: "down arrow", value2: "LEFT_STICK_Y:+1" }, // ↓
  19: { value: "up arrow", value2: "LEFT_STICK_Y:-1" }, // ↑
  20: { value: "l", value2: "RIGHT_STICK_X:+1" }, // C →
  21: { value: "j", value2: "RIGHT_STICK_X:-1" }, // C ←
  22: { value: "k", value2: "RIGHT_STICK_Y:+1" }, // C ↓
  23: { value: "i", value2: "RIGHT_STICK_Y:-1" }, // C ↑
  24: { value: "1" }, 25: { value: "2" }, 26: { value: "3" },
  27: {}, 28: {}, 29: {},
};

// --- Presets de control por jugador (multijugador local, hasta 4) ------------
//
// Filosofía (pedido del usuario): el DEFAULT es simple — todos comparten el
// MISMO esquema (Flechas) y el GAMEPAD anda para los 4 (enchufás mandos y listo,
// ideal Mario Party / Smash / Bomberman). Después, abajo del juego, cada jugador
// puede elegir un PRESET distinto (Flechas / Numpad / WASD / Solo mando) para,
// por ejemplo, jugar de a dos en el MISMO teclado sin pisarse.
//
// Detalle de EmulatorJS 4.2.3: `defaultControllers` NO tiene defaults ocultos —
// es literalmente lo que le pasamos. Con P2-P4 en `{}`, enchufar un 2º/3º/4º
// mando NO hace nada. Por eso a cada jugador le damos SIEMPRE el mapeo de
// gamepad (value2): EmulatorJS auto-asigna el 1º mando a P1, el 2º a P2, etc.

/** Parte de GAMEPAD (value2) del esquema, derivada de P0 para no desincronizar. */
const N64_GAMEPAD: Array<[number, string]> = Object.entries(N64_CONTROLS_P0)
  .filter(([, c]) => c.value2)
  .map(([i, c]) => [Number(i), c.value2 as string]);

/** Solo gamepad (sin teclado): el layout N64 estándar en value2. */
function gamepadMap(): Record<number, EJSControl> {
  const out: Record<number, EJSControl> = {};
  for (const [i, v2] of N64_GAMEPAD) out[i] = { value2: v2 };
  return out;
}

/**
 * Copia con objetos internos NUEVOS. Necesaria porque EmulatorJS muta
 * `controls[p][i].value` in-place en setupKeys(): sin copia profunda, eso
 * mutaría N64_CONTROLS_P0 o haría que dos jugadores con el mismo preset
 * compartan el mismo objeto de botón.
 */
function cloneControls(map: Record<number, EJSControl>): Record<number, EJSControl> {
  const out: Record<number, EJSControl> = {};
  for (const [i, c] of Object.entries(map)) out[Number(i)] = { ...c };
  return out;
}

// Teclado de cada preset: índice de botón N64 -> nombre de tecla de EmulatorJS.
type KbCluster = Array<[number, string]>;

// Numpad (Bloq Num ON): keyCodes 96-107, NO chocan con las flechas/letras de
// "Flechas" → es el preset ideal para el 2º jugador en el mismo teclado.
//   8/2/4/6 = stick · 7/9 = L/R · 0 = A · 1 = B · 3 = Z · + = Start
const KB_NUMPAD: KbCluster = [
  [19, "numpad 8"], [18, "numpad 2"], [17, "numpad 4"], [16, "numpad 6"],
  [10, "numpad 7"], [11, "numpad 9"],
  [0, "numpad 0"], [1, "numpad 1"], [12, "numpad 3"], [3, "add"],
];
// WASD (mano izquierda): alternativa a "Flechas" (comparten zona, no se usan a la
// vez). W A S D = stick · Q/E = L/R · F/G = A/B · V = Z · R = Start.
const KB_WASD: KbCluster = [
  [19, "w"], [18, "s"], [17, "a"], [16, "d"],
  [10, "q"], [11, "e"],
  [0, "f"], [1, "g"], [12, "v"], [3, "r"],
];

/** Mapa completo de un preset: gamepad SIEMPRE + el teclado del cluster (o none). */
function presetMap(cluster: KbCluster | "flechas" | null): Record<number, EJSControl> {
  if (cluster === "flechas") return cloneControls(N64_CONTROLS_P0); // ya trae value + value2
  const out = gamepadMap();
  if (cluster) for (const [i, key] of cluster) out[i] = { ...out[i], value: key };
  return out;
}

export interface ControlPreset { id: string; name: string; hint: string; }
/** Presets seleccionables por jugador en la pantalla Local. */
export const CONTROL_PRESETS: ControlPreset[] = [
  { id: "flechas", name: "Flechas", hint: "← ↑ ↓ → stick · X=A · Z=B · Espacio=R · C=Z · A=L · Enter=Start · IJKL=C" },
  { id: "numpad", name: "Numpad", hint: "Bloq Num · 8/2/4/6 stick · 0=A · 1=B · 3=Z · 7/9=L/R · +=Start" },
  { id: "wasd", name: "WASD", hint: "W A S D stick · F=A · G=B · V=Z · Q/E=L/R · R=Start" },
  { id: "mando", name: "Solo mando", hint: "Sin teclado — jugás con tu joystick/gamepad USB" },
];

function presetById(id: string): Record<number, EJSControl> {
  switch (id) {
    case "numpad": return presetMap(KB_NUMPAD);
    case "wasd": return presetMap(KB_WASD);
    case "mando": return presetMap(null);
    default: return presetMap("flechas");
  }
}

/** Asignación por defecto: P1 al teclado (Flechas), el resto por mando. */
export const DEFAULT_PRESET_BY_PLAYER = ["flechas", "mando", "mando", "mando"] as const;

/**
 * Cambia el preset de un jugador EN CALIENTE (desde el selector de la UI).
 * Devuelve false si el emulador todavía no está listo.
 */
export function applyPlayerPreset(player: number, presetId: string): boolean {
  const emu = window.EJS_emulator;
  if (!emu?.controls || typeof emu.setupKeys !== "function") return false;
  emu.controls[player] = presetById(presetId);
  try { emu.setupKeys?.(); emu.checkGamepadInputs?.(); emu.saveSettings?.(); } catch { /* noop */ }
  return true;
}

const CTRL_VERSION = "v3"; // subir si cambiamos el esquema por defecto

let loaderInjected = false;

export interface LaunchOptions {
  container: string;
  rom: File;
  /**
   * true  = pantalla Local: hasta 4 jugadores. Default = P1 Flechas + gamepad
   *         para los 4; cada uno cambia su preset desde la UI.
   * false = host del online: SOLO P1 es local; P2 llega por la red
   *         (simulateInput). El host NO debe tener controles locales de P2-P4,
   *         o pelearían con el invitado.
   */
  multiplayer?: boolean;
}

export function launchLocal({ container, rom, multiplayer = false }: LaunchOptions): void {
  if (loaderInjected) {
    window.location.reload();
    return;
  }
  loaderInjected = true;

  const romUrl = URL.createObjectURL(rom);

  window.EJS_player = container;
  // parallel_n64 y NO "n64" (mupen64plus_next): el GLideN64 de mupen64plus_next
  // tiene un bug de microcódigo HLE en SPLITSCREEN (gonetz/GLideN64#2894) que
  // deja invisibles el minimapa, la ruleta de ítems y el contador de vueltas en
  // partidas 2P+ (cajas negras) — justo el modo estrella de este producto.
  // Verificado acá con MK64: 4.2.3 y 4.3.0-pre lo sufren; parallel_n64 dibuja
  // todo el HUD bien en 1P y 2P. Si se vuelve a mupen64plus_next, re-testear
  // el HUD en una carrera 2P VS antes de deployar.
  window.EJS_core = "parallel_n64";
  window.EJS_pathtodata = EJS_CDN;
  window.EJS_gameUrl = romUrl;
  window.EJS_gameName = rom.name.replace(/\.[^.]+$/, "");
  window.EJS_startOnLoaded = true;
  // Default limpio (también lo usa el botón "Reset" del menú de controles).
  // Local: P1 al teclado (Flechas) + gamepad para los 4. El resto de los
  // jugadores arranca "solo mando" y cambia su preset desde el selector de abajo.
  const defaults: EJSControllers = multiplayer
    ? {
        0: presetById(DEFAULT_PRESET_BY_PLAYER[0]),
        1: presetById(DEFAULT_PRESET_BY_PLAYER[1]),
        2: presetById(DEFAULT_PRESET_BY_PLAYER[2]),
        3: presetById(DEFAULT_PRESET_BY_PLAYER[3]),
      }
    : { 0: cloneControls(N64_CONTROLS_P0), 1: {}, 2: {}, 3: {} };
  window.EJS_defaultControllers = defaults;

  const script = document.createElement("script");
  script.src = EJS_CDN + "loader.js";
  document.body.appendChild(script);

  applyCleanControls(defaults, multiplayer);
}

// Fuerza el esquema por defecto (versionado). Cubre a usuarios que ya tenían
// guardado el esquema viejo en localStorage; después respeta lo que el usuario
// reasigne desde el menú.
//
// En online (multiplayer=false) además vaciamos P2-P4 en CADA arranque: si el
// usuario había guardado el teclado de P2 jugando local, el host no debe
// manejar localmente al invitado (que llega por simulateInput).
function applyCleanControls(defaults: EJSControllers, multiplayer: boolean): void {
  const upToDate = (() => { try { return localStorage.getItem("n64web-ctrl") === CTRL_VERSION; } catch { return false; } })();
  if (upToDate && multiplayer) return; // local ya migrado: respetar remaps del usuario

  const t0 = performance.now();
  const poll = window.setInterval(() => {
    const emu = window.EJS_emulator;
    if (emu?.controls && typeof emu.setupKeys === "function") {
      if (!upToDate) {
        // Reset único al esquema nuevo (los 4 jugadores). Copia profunda: no
        // queremos que setupKeys mute window.EJS_defaultControllers (lo usa el
        // botón "Reset" del menú de EmulatorJS).
        for (const p of [0, 1, 2, 3]) emu.controls[p] = cloneControls(defaults[p]);
      } else {
        // Online ya migrado: solo garantizar que el host no tenga P2-P4 locales.
        emu.controls[1] = {}; emu.controls[2] = {}; emu.controls[3] = {};
      }
      try { emu.setupKeys?.(); emu.checkGamepadInputs?.(); emu.saveSettings?.(); } catch { /* noop */ }
      try { localStorage.setItem("n64web-ctrl", CTRL_VERSION); } catch { /* noop */ }
      window.clearInterval(poll);
    } else if (performance.now() - t0 > 60000) {
      window.clearInterval(poll);
    }
  }, 400);
}
