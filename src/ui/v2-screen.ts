// Pantalla v2 (experimental): demo de netcode JUSTO (lockstep determinista).
// Los dos peers corren la misma sim desde la misma semilla e intercambian solo
// inputs → cero ventaja. Es el banco de pruebas del netcode que después usará el
// core N64. Juego de demo: Pong.

import { startMatch, type MatchStatus, type MatchHandle } from "../v2/peer";
import type { SimInput } from "../v2/sim";
import { el, button, statusPill, toast, copyText, makeRoomCode } from "./components";

function urlRoom(): string | null {
  const r = new URLSearchParams(location.search).get("room");
  return r ? r.toUpperCase() : null;
}
function inviteLink(room: string): string {
  const u = new URL(location.href);
  u.searchParams.set("room", room);
  u.hash = "v2";
  return u.toString();
}

// Estado de teclado → input de paleta (-1 arriba, +1 abajo).
function paddleInput(): () => SimInput {
  const keys = new Set<string>();
  const kd = (e: KeyboardEvent) => { keys.add(e.code); if (["ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault(); };
  const ku = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  return () => {
    const up = keys.has("ArrowUp") || keys.has("KeyW");
    const down = keys.has("ArrowDown") || keys.has("KeyS");
    return { paddle: up && !down ? -1 : down && !up ? 1 : 0 };
  };
}

export function renderV2(host: HTMLElement, goBack: () => void): void {
  const panel = el("div", { class: "panel" });
  panel.append(el("div", { class: "section-head" },
    el("h2", { innerHTML: '🧪 v2 — Netcode justo <span class="badge">experimental</span>' }),
    button("← Volver", "ghost", goBack),
  ));
  panel.append(el("p", { class: "sub", textContent: "Demo del netcode competitivo: ambos corren la MISMA simulación desde la misma semilla e intercambian solo inputs (lockstep determinista). Sin ventaja para nadie. Es el motor que después manejará N64. Juego de prueba: Pong. Movete con ↑ ↓ (o W/S)." }));

  const body = el("div");
  panel.append(body);

  const pre = urlRoom();
  if (pre) startGame(body, pre, "join");
  else renderChoice(body);

  host.append(panel);
}

function renderChoice(body: HTMLElement): void {
  body.replaceChildren();
  const choices = el("div", { class: "choices" });
  const create = el("div", { class: "choice" },
    el("div", { class: "ci", textContent: "🎾" }),
    el("h3", { textContent: "Crear partida" }),
    el("p", { textContent: "Generás la sala y la semilla. Pasás el link y arrancan iguales." }),
  );
  create.onclick = () => startGame(body, makeRoomCode(), "create");
  const join = el("div", { class: "choice" },
    el("div", { class: "ci", textContent: "🔗" }),
    el("h3", { textContent: "Unirse" }),
    el("p", { textContent: "Entrás con el código que te pasaron." }),
  );
  join.onclick = () => renderJoin(body);
  choices.append(create, join);
  body.append(choices);
}

function renderJoin(body: HTMLElement): void {
  body.replaceChildren();
  const input = el("input", { class: "field field-code", maxLength: 6, placeholder: "CÓDIGO" }) as HTMLInputElement;
  input.oninput = () => (input.value = input.value.toUpperCase());
  const go = button("Unirse ▶", "primary", () => {
    const code = input.value.trim().toUpperCase();
    if (code.length < 4) { toast("Ingresá el código completo"); return; }
    startGame(body, code, "join");
  });
  body.append(
    el("div", { class: "row", style: "margin-bottom:14px" }, el("span", { class: "muted", textContent: "Código:" }), input, go),
    el("div", { class: "back-link" }, button("← Volver", "ghost", () => renderChoice(body))),
  );
}

function startGame(body: HTMLElement, room: string, role: "create" | "join"): void {
  body.replaceChildren();
  const pill = statusPill();
  pill.set("connecting", role === "create" ? "Esperando al rival…" : "Conectando…");

  const readout = el("div", { class: "muted small", style: "font-family:ui-monospace,monospace;margin-left:auto" });

  const topRow = el("div", { class: "row", style: "margin-bottom:10px" }, pill.root, el("div", { class: "spacer" }), readout);

  // Barra de código/invitación solo para el creador.
  if (role === "create") {
    const copyLink = button("🔗 Copiar link", "accent", async () => {
      toast((await copyText(inviteLink(room))) ? "Link copiado — mandáselo a tu rival" : "No se pudo copiar");
    });
    body.append(el("div", { class: "roomcode-box" },
      el("div", {}, el("div", { class: "label", textContent: "Código de partida" }), el("span", { class: "code", textContent: room })),
      el("div", { class: "spacer" }), copyLink,
    ), el("div", { style: "height:12px" }));
  }

  const canvas = el("canvas", { width: 800, height: 560 }) as HTMLCanvasElement;
  canvas.style.cssText = "width:100%;aspect-ratio:10/7;background:#0b0c1c;border-radius:12px;display:block";

  const callout = el("div", { class: "callout", innerHTML: "Movés con <kbd>↑</kbd> <kbd>↓</kbd> (o <kbd>W</kbd>/<kbd>S</kbd>). Tu paleta es la <b style='color:#34d6ff'>celeste</b>. Ganás con " + 7 + " puntos." });

  const back = el("div", { class: "back-link" }, button("← Salir", "danger", () => { handle?.stop(); renderChoice(body); }));

  body.append(topRow, canvas, el("div", { style: "height:12px" }), callout, back);

  const read = paddleInput();
  const handle: MatchHandle = startMatch({
    room, role, canvas, readInput: read,
    onStatus: (s: MatchStatus) => {
      const label = s.phase === "connected"
        ? (s.desync ? "⚠ DESYNC detectado" : s.stalled ? "esperando al rival…" : "en sync ✓")
        : s.connection;
      pill.set(s.desync ? "error" : s.phase, label, s.rttMs);
      readout.textContent = `frame ${s.frame} · buffer ${s.ahead} · P${s.youAre + 1}`;
    },
  });
}
