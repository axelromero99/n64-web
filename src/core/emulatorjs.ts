// Core del M1: EmulatorJS (modo LOCAL + jugador 1 del online).
//
// EmulatorJS envuelve el core mupen64plus_next (N64) compilado a WASM y ya trae
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

const EJS_CDN = "https://cdn.emulatorjs.org/stable/data/";

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

const CTRL_VERSION = "v2"; // subir si cambiamos el esquema por defecto

let loaderInjected = false;

export interface LaunchOptions {
  container: string;
  rom: File;
}

export function launchLocal({ container, rom }: LaunchOptions): void {
  if (loaderInjected) {
    window.location.reload();
    return;
  }
  loaderInjected = true;

  const romUrl = URL.createObjectURL(rom);

  window.EJS_player = container;
  window.EJS_core = "n64";
  window.EJS_pathtodata = EJS_CDN;
  window.EJS_gameUrl = romUrl;
  window.EJS_gameName = rom.name.replace(/\.[^.]+$/, "");
  window.EJS_startOnLoaded = true;
  // Default limpio (también lo usa el botón "Reset" del menú de controles).
  window.EJS_defaultControllers = { 0: { ...N64_CONTROLS_P0 }, 1: {}, 2: {}, 3: {} };

  const script = document.createElement("script");
  script.src = EJS_CDN + "loader.js";
  document.body.appendChild(script);

  applyCleanControls();
}

// Fuerza el esquema claro UNA vez (versionado). Cubre a usuarios que ya tenían
// guardado el esquema viejo/confuso en localStorage; después respeta lo que el
// usuario reasigne desde el menú.
function applyCleanControls(): void {
  const already = (() => { try { return localStorage.getItem("n64web-ctrl") === CTRL_VERSION; } catch { return false; } })();
  if (already) return;

  const t0 = performance.now();
  const poll = window.setInterval(() => {
    const emu = window.EJS_emulator;
    if (emu?.controls && typeof emu.setupKeys === "function") {
      emu.controls[0] = { ...N64_CONTROLS_P0 };
      try { emu.setupKeys?.(); emu.checkGamepadInputs?.(); emu.saveSettings?.(); } catch { /* noop */ }
      try { localStorage.setItem("n64web-ctrl", CTRL_VERSION); } catch { /* noop */ }
      window.clearInterval(poll);
    } else if (performance.now() - t0 > 60000) {
      window.clearInterval(poll);
    }
  }, 400);
}
