import { el } from "./components";

// Preset "Flechas": el esquema por defecto (P1) y el mismo del guest online.
// Ver core/emulatorjs.ts (N64_CONTROLS_P0) e input/n64.ts (DEFAULT_KEYBOARD_P1).
const MAP: Array<[string, string]> = [
  ["← ↑ ↓ →", "Volante (stick)"],
  ["X", "Acelerar (A)"],
  ["Z", "Frenar (B)"],
  ["Espacio", "Derrape / salto (R)"],
  ["C", "Z (gatillo)"],
  ["A", "L"],
  ["Enter", "Start"],
  ["I J K L", "Botones C (cámara)"],
];

// Preset "Numpad" (Bloq Num activado). Ver KB_NUMPAD en core/emulatorjs.ts.
const MAP_P2: Array<[string, string]> = [
  ["8 2 4 6", "Stick (mover)"],
  ["0", "A"],
  ["1", "B"],
  ["3", "Z"],
  ["7 9", "L / R"],
  ["+", "Start"],
];

let closeCurrent: (() => void) | null = null;

export function controlsHelp(): void {
  if (closeCurrent) { closeCurrent(); return; } // toggle

  const gridFor = (rows: Array<[string, string]>): HTMLElement => {
    const grid = el("div", { class: "controls-grid" });
    for (const [key, action] of rows) {
      grid.append(el("div", { class: "ctrl" },
        el("span", { innerHTML: key.split(" ").map((k) => `<kbd>${k}</kbd>`).join(" ") }),
        el("span", { class: "k", textContent: action }),
      ));
    }
    return grid;
  };

  const closeBtn = el("button", { class: "btn btn-ghost", textContent: "✕", onclick: close });
  closeBtn.setAttribute("aria-label", "Cerrar");
  const card = el("div", { class: "modal-card" },
    el("div", { class: "section-head" },
      el("h2", { textContent: "🎮 Controles" }),
      closeBtn,
    ),
    el("p", { class: "sub", textContent: "En Local, cada jugador elige su preset abajo del juego. Estos son los dos de teclado (reasignás todo desde el menú ⚙ de EmulatorJS). Los mandos USB se detectan solos." }),
    el("h3", { class: "ctrl-title", textContent: "Preset “Flechas” (por defecto)" }),
    gridFor(MAP),
    el("h3", { class: "ctrl-title", textContent: "Preset “Numpad” (Bloq Num)" }),
    gridFor(MAP_P2),
    el("div", { class: "callout", style: "margin-top:16px", innerHTML: "🎮 <b>Hasta 4 jugadores:</b> enchufá los mandos y se asignan en orden (1º = P1, 2º = P2…). Perfecto para <b>Mario Party</b>. Para dos en un teclado sin pisarse: P1 <b>Flechas</b> + P2 <b>Numpad</b>." }),
    el("div", { class: "callout", style: "margin-top:10px", innerHTML: "En <b>Online</b>, cada jugador usa su propio teclado/mando en su compu." }),
  );
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Controles");

  const backdrop = el("div", { class: "modal-backdrop" }, card);
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  closeBtn.focus();
  closeCurrent = close;

  function close() {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    closeCurrent = null;
  }
}
