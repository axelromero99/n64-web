import { el } from "./components";

// Esquema unificado: idéntico para host (P1) y guest (P2). Ver core/emulatorjs.ts
// (N64_CONTROLS_P0) e input/n64.ts (DEFAULT_KEYBOARD_P1).
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

let closeCurrent: (() => void) | null = null;

export function controlsHelp(): void {
  if (closeCurrent) { closeCurrent(); return; } // toggle

  const grid = el("div", { class: "controls-grid" });
  for (const [key, action] of MAP) {
    grid.append(el("div", { class: "ctrl" },
      el("span", { innerHTML: key.split(" ").map((k) => `<kbd>${k}</kbd>`).join(" ") }),
      el("span", { class: "k", textContent: action }),
    ));
  }

  const closeBtn = el("button", { class: "btn btn-ghost", textContent: "✕", onclick: close });
  closeBtn.setAttribute("aria-label", "Cerrar");
  const card = el("div", { class: "modal-card" },
    el("div", { class: "section-head" },
      el("h2", { textContent: "🎮 Controles" }),
      closeBtn,
    ),
    el("p", { class: "sub", textContent: "Teclado por defecto. En modo Local podés reasignar todo desde el menú ⚙ de EmulatorJS. Los mandos USB (Xbox/PS) se detectan automáticamente." }),
    grid,
    el("div", { class: "callout", style: "margin-top:16px", innerHTML: "En <b>Online</b>, cada jugador usa su propio teclado/mando en su compu." }),
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
