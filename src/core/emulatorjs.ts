// Core del M1: EmulatorJS (modo LOCAL).
//
// EmulatorJS envuelve el core mupen64plus_next (N64) compilado a WASM y ya trae
// GRATIS lo que necesitamos para el modo local:
//   - controles preconfigurados + menu para reasignar (teclado y gamepad)
//   - hasta 4 jugadores locales (varios mandos en el mismo PC)
//   - guardado rapido, fullscreen, etc.
//
// Se carga desde el CDN oficial (cdn.emulatorjs.org) -> cero binarios en el repo.
// La ROM la elige el usuario desde su disco: creamos un object URL local, asi la
// ROM NUNCA sale de su navegador.

// Config global que lee el loader de EmulatorJS (son variables window.EJS_*).
declare global {
  interface Window {
    EJS_player?: string;
    EJS_core?: string;
    EJS_gameUrl?: string;
    EJS_gameName?: string;
    EJS_pathtodata?: string;
    EJS_startOnLoaded?: boolean;
    EJS_ready?: () => void;
    EJS_emulator?: unknown;
  }
}

const EJS_CDN = "https://cdn.emulatorjs.org/stable/data/";

let loaderInjected = false;

export interface LaunchOptions {
  /** Selector del contenedor donde montar el emulador (ej: "#game"). */
  container: string;
  /** ROM elegida por el usuario. */
  rom: File;
}

/**
 * Lanza EmulatorJS con la ROM del usuario en el contenedor indicado.
 * Solo se puede lanzar una vez por carga de pagina (limitacion del loader);
 * para "cambiar de ROM" recargamos la pagina.
 */
export function launchLocal({ container, rom }: LaunchOptions): void {
  if (loaderInjected) {
    // El loader de EmulatorJS no soporta reinicios limpios: recargamos.
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

  const script = document.createElement("script");
  script.src = EJS_CDN + "loader.js";
  document.body.appendChild(script);
}
