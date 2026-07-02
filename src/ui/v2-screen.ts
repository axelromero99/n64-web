// Pantalla v2 (experimental): demo de netcode JUSTO (lockstep determinista).
// Los dos peers corren la misma sim desde la misma semilla e intercambian solo
// inputs → cero ventaja. Es el banco de pruebas del netcode que después usará el
// core N64. Juego de demo: Pong.

import { startMatch, type MatchStatus, type MatchHandle, type Netcode } from "../v2/peer";
import type { SimInput } from "../v2/sim";
import { el, button, clickable, statusPill, toast, copyText, makeRoomCode, roomFromUrl, inviteLink, touchWarning } from "./components";
import { onScreenLeave } from "./screens";

// Netcode elegido (rollback por defecto). Se puede fijar por URL (?nc=lockstep).
let selectedNetcode: Netcode =
  new URLSearchParams(location.search).get("nc") === "lockstep" ? "lockstep" : "rollback";

// El link de invitación lleva el netcode elegido para que el rival use el mismo.
const v2Invite = (room: string) => inviteLink(room, "v2", { nc: selectedNetcode });

// Estado de teclado → input de paleta (-1 arriba, +1 abajo). Devuelve también
// el detach: sin él, cada visita a la pantalla dejaba listeners globales vivos
// (y el preventDefault de ↑/↓ rompía el scroll del resto de la app).
function paddleInput(): { read: () => SimInput; detach: () => void } {
  const keys = new Set<string>();
  const kd = (e: KeyboardEvent) => { keys.add(e.code); if (["ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault(); };
  const ku = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  return {
    read: () => {
      const up = keys.has("ArrowUp") || keys.has("KeyW");
      const down = keys.has("ArrowDown") || keys.has("KeyS");
      return { paddle: up && !down ? -1 : down && !up ? 1 : 0 };
    },
    detach: () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    },
  };
}

export function renderV2(host: HTMLElement, goBack: () => void): void {
  const panel = el("div", { class: "panel" });
  panel.append(el("div", { class: "section-head" },
    el("h2", { innerHTML: '🧪 v2 — Netcode justo <span class="badge">experimental</span>' }),
    button("← Volver", "ghost", goBack),
  ));
  panel.append(el("p", { class: "sub", textContent: "Esto es una DEMO TÉCNICA del netcode competitivo, con un Pong como juego de prueba — acá no se juega N64 (para eso: Jugar Online). Ambos peers corren la MISMA simulación desde la misma semilla e intercambian solo inputs: cero ventaja para nadie. Cuando exista el core N64 determinista, se enchufa a este mismo motor. Movete con ↑ ↓ (o W/S)." }));
  const warn = touchWarning();
  if (warn) panel.append(warn);

  const body = el("div");
  panel.append(body);

  if (typeof RTCPeerConnection === "undefined") {
    body.append(el("div", { class: "callout warn", innerHTML: "Tu navegador no soporta <b>WebRTC</b>, que es lo que conecta a los dos jugadores. Probá con Chrome, Edge o Firefox actualizados." }));
    host.append(panel);
    return;
  }

  const pre = roomFromUrl();
  if (pre) startGame(body, pre, "join");
  else renderChoice(body);

  host.append(panel);
}

function renderChoice(body: HTMLElement): void {
  body.replaceChildren();
  const choices = el("div", { class: "choices" });
  const create = clickable(el("div", { class: "choice" },
    el("div", { class: "ci", textContent: "🎾" }),
    el("h3", { textContent: "Crear partida" }),
    el("p", { textContent: "Generás la sala y la semilla. Pasás el link y arrancan iguales." }),
  ), () => startGame(body, makeRoomCode(), "create"));
  const join = clickable(el("div", { class: "choice" },
    el("div", { class: "ci", textContent: "🔗" }),
    el("h3", { textContent: "Unirse" }),
    el("p", { textContent: "Entrás con el código que te pasaron." }),
  ), () => renderJoin(body));
  choices.append(create, join);

  // Selector de netcode (para sentir la diferencia).
  const ncRow = el("div", { class: "row", style: "margin-top:16px;justify-content:center" });
  const label = el("span", { class: "muted small" });
  const btn = button("", "ghost", () => {
    selectedNetcode = selectedNetcode === "rollback" ? "lockstep" : "rollback";
    refresh();
  });
  const refresh = () => {
    btn.innerHTML = selectedNetcode === "rollback" ? "⚡ Netcode: Rollback" : "🔒 Netcode: Lockstep";
    label.textContent = selectedNetcode === "rollback"
      ? "predice y corrige — se siente fluido aun con lag"
      : "espera al rival — 100% exacto pero se traba con lag";
  };
  refresh();
  ncRow.append(btn, label);

  body.append(choices, ncRow);
}

function renderJoin(body: HTMLElement): void {
  body.replaceChildren();
  const input = el("input", { class: "field field-code", maxLength: 6, placeholder: "CÓDIGO" }) as HTMLInputElement;
  input.setAttribute("aria-label", "Código de partida");
  input.oninput = () => (input.value = input.value.toUpperCase());
  const join = () => {
    const code = input.value.trim().toUpperCase();
    if (code.length < 4) { toast("Ingresá el código completo"); return; }
    startGame(body, code, "join");
  };
  input.onkeydown = (e) => { if (e.key === "Enter") join(); };
  const go = button("Unirse ▶", "primary", join);
  body.append(
    el("div", { class: "row", style: "margin-bottom:14px" }, el("span", { class: "muted", textContent: "Código:" }), input, go),
    el("div", { class: "back-link" }, button("← Volver", "ghost", () => renderChoice(body))),
  );
  input.focus();
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
      toast((await copyText(v2Invite(room))) ? "Link copiado — mandáselo a tu rival" : "No se pudo copiar");
    });
    body.append(el("div", { class: "roomcode-box" },
      el("div", {}, el("div", { class: "label", textContent: "Código de partida" }), el("span", { class: "code", textContent: room })),
      el("div", { class: "spacer" }), copyLink,
    ), el("div", { style: "height:12px" }));
  }

  const canvas = el("canvas", { width: 800, height: 560 }) as HTMLCanvasElement;
  canvas.style.cssText = "width:100%;aspect-ratio:10/7;background:#0b0c1c;border-radius:12px;display:block";

  const callout = el("div", { class: "callout", innerHTML: "Movés con <kbd>↑</kbd> <kbd>↓</kbd> (o <kbd>W</kbd>/<kbd>S</kbd>). Tu paleta es la <b style='color:#34d6ff'>celeste</b>. Ganás con " + 7 + " puntos." });

  const back = el("div", { class: "back-link" }, button("← Salir", "danger", () => { stopAll(); renderChoice(body); }));

  body.append(topRow, canvas, el("div", { style: "height:12px" }), callout, back);

  const input = paddleInput();
  const stopAll = () => { handle?.stop(); input.detach(); };
  onScreenLeave(stopAll);
  const handle: MatchHandle = startMatch({
    room, role, netcode: selectedNetcode, canvas, readInput: input.read,
    onStatus: (s: MatchStatus) => {
      const label = s.phase === "connected"
        ? (s.desync ? "⚠ DESYNC" : s.stalled ? "esperando al rival…" : "en sync ✓")
        : s.connection;
      pill.set(s.desync ? "error" : s.phase, label, s.rttMs);
      readout.textContent = s.netcode === "rollback"
        ? `rollback · frame ${s.frame} · predice ${s.predicting ?? 0} · correcc. ${s.rollbacks ?? 0} · P${s.youAre + 1}`
        : `lockstep · frame ${s.frame} · buffer ${s.ahead ?? 0} · P${s.youAre + 1}`;
    },
  });
}
