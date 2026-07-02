import { el } from "./components";

// Mapeo de teclado por defecto (coincide con DEFAULT_KEYBOARD_P1 en input/n64.ts).
const MAP: Array<[string, string]> = [
  ["← ↑ ↓ →", "Stick analógico"],
  ["X", "A"],
  ["C", "B"],
  ["Z", "Z (gatillo)"],
  ["Q", "L"],
  ["E", "R"],
  ["Enter", "Start"],
  ["I / K / J / L", "Botones C"],
];

export function controlsHelp(): void {
  const existing = document.querySelector(".modal-backdrop");
  if (existing) { existing.remove(); return; }

  const grid = el("div", { class: "controls-grid" });
  for (const [key, action] of MAP) {
    grid.append(el("div", { class: "ctrl" },
      el("span", { innerHTML: key.split(" ").map((k) => `<kbd>${k}</kbd>`).join(" ") }),
      el("span", { class: "k", textContent: action }),
    ));
  }

  const card = el("div", { class: "modal-card" },
    el("div", { class: "section-head" },
      el("h2", { textContent: "🎮 Controles" }),
      el("button", { class: "btn btn-ghost", textContent: "✕", onclick: close }),
    ),
    el("p", { class: "sub", textContent: "Teclado por defecto. En modo Local podés reasignar todo desde el menú ⚙ de EmulatorJS. Los mandos USB (Xbox/PS) se detectan automáticamente." }),
    grid,
    el("div", { class: "callout", style: "margin-top:16px", innerHTML: "En <b>Online</b>, cada jugador usa su propio teclado/mando en su compu." }),
  );

  const backdrop = el("div", { class: "modal-backdrop" }, card);
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  document.body.append(backdrop);

  function close() { document.querySelector(".modal-backdrop")?.remove(); }
}
