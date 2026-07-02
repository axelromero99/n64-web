import { startHost, startGuest, type NetStatus, type GuestHandle } from "../net/online";
import { KEYBOARD_PRESETS } from "../input/n64";
import { el, button, statusPill, romDropzone, overlay, toast, copyText, makeRoomCode } from "./components";
import { controlsHelp } from "./controls-help";

// Lee ?room=CODE de la URL (para invitaciones).
function urlRoom(): string | null {
  const r = new URLSearchParams(location.search).get("room");
  return r ? r.toUpperCase() : null;
}

function inviteLink(room: string): string {
  const u = new URL(location.href);
  u.searchParams.set("room", room);
  u.hash = "online";
  return u.toString();
}

export function renderOnline(host: HTMLElement, goBack: () => void): void {
  const panel = el("div", { class: "panel" });
  const head = el("div", { class: "section-head" },
    el("h2", { innerHTML: "🌐 Jugar Online" }),
    button("← Volver", "ghost", goBack),
  );
  panel.append(head, el("p", { class: "sub", textContent: "Un jugador crea la sala y corre el juego; el otro se une por código o link. Funciona entre computadoras distintas." }));

  const body = el("div");
  panel.append(body);

  const preRoom = urlRoom();
  if (preRoom) renderJoin(body, preRoom);
  else renderChoice(body);

  host.append(panel);
}

// --- Elección host/guest ---------------------------------------------------

function renderChoice(body: HTMLElement): void {
  body.replaceChildren();
  const choices = el("div", { class: "choices" });

  const hostTile = el("div", { class: "choice" },
    el("div", { class: "ci", textContent: "🎮" }),
    el("h3", { textContent: "Crear una sala" }),
    el("p", { textContent: "Vos corrés el juego (Jugador 1) e invitás a un amigo con un código o link." }),
  );
  hostTile.onclick = () => renderHost(body);

  const guestTile = el("div", { class: "choice" },
    el("div", { class: "ci", textContent: "🔗" }),
    el("h3", { textContent: "Unirse a una sala" }),
    el("p", { textContent: "Entrás con el código que te pasaron y jugás como Jugador 2." }),
  );
  guestTile.onclick = () => renderJoin(body, "");

  choices.append(hostTile, guestTile);
  body.append(choices);
}

// --- HOST ------------------------------------------------------------------

function renderHost(body: HTMLElement): void {
  body.replaceChildren();
  const back = el("div", { class: "back-link" }, button("← Elegir otro modo", "ghost", () => renderChoice(body)));

  const intro = el("p", { class: "sub", textContent: "Cargá tu ROM para abrir la sala. Cuando esté lista, compartí el código o el link." });
  const dz = romDropzone((file) => launchHost(body, file));
  body.append(intro, dz, back);
}

function launchHost(body: HTMLElement, rom: File): void {
  const room = makeRoomCode();
  body.replaceChildren();

  // Barra: código + copiar + estado
  const codeEl = el("span", { class: "code", textContent: room });
  const copyCode = button("📋 Copiar código", "ghost", async () => {
    toast((await copyText(room)) ? "Código copiado" : "No se pudo copiar");
  });
  const copyLink = button("🔗 Copiar link de invitación", "accent", async () => {
    toast((await copyText(inviteLink(room))) ? "Link copiado — mandáselo a tu amigo" : "No se pudo copiar");
  });
  const codeBox = el("div", { class: "roomcode-box" },
    el("div", {}, el("div", { class: "label", textContent: "Código de sala" }), codeEl),
    el("div", { class: "spacer" }),
    copyCode, copyLink,
  );

  const pill = statusPill();
  pill.set("starting", "Arrancando emulador…");

  const stage = el("div", { class: "stage" });
  const game = el("div", { id: "game" });
  stage.append(game);
  const ov = overlay("Descargando el core de N64 y arrancando el juego… (unos segundos)");
  stage.append(ov.root);

  const toolbar = el("div", { class: "toolbar" },
    pill.root,
    el("div", { class: "spacer" }),
    button("🎮 Controles", "ghost", controlsHelp),
    button("⛶ Pantalla completa", "ghost", () => toggleFullscreen(stage)),
  );

  const callout = el("div", { class: "callout", innerHTML: "Sos el <b>Jugador 1</b>: jugás con tu teclado/mando acá. Tu amigo (Jugador 2) verá el juego y controlará desde su compu. El juego tarda ~10-15s en aparecer." });

  body.append(codeBox, el("div", { style: "height:14px" }), stage, toolbar, el("div", { style: "height:14px" }), callout);

  // Mantener el overlay hasta que el juego muestre su primer frame (no solo
  // hasta que el emulador esté listo): así no se ve un negro raro en el arranque.
  let removed = false;
  const waitRender = window.setInterval(() => {
    const cv = document.querySelector<HTMLCanvasElement>("#game canvas");
    if (cv && cv.width > 0) { removed = true; ov.remove(); window.clearInterval(waitRender); }
  }, 400);
  window.setTimeout(() => { if (!removed) { ov.remove(); window.clearInterval(waitRender); } }, 20000);

  startHost({
    rom, gameContainer: "#game", room,
    onStatus: (s: NetStatus) => pill.set(s.phase, s.connection, s.rttMs),
  }).catch((e) => { ov.setText("Error: " + e.message); });
}

// --- GUEST -----------------------------------------------------------------

function renderJoin(body: HTMLElement, preCode: string): void {
  body.replaceChildren();
  const input = el("input", { class: "field field-code", value: preCode, maxLength: 6, placeholder: "CÓDIGO" }) as HTMLInputElement;
  input.oninput = () => (input.value = input.value.toUpperCase());
  const joinBtn = button("Unirse ▶", "primary", () => {
    const code = input.value.trim().toUpperCase();
    if (code.length < 4) { toast("Ingresá el código completo"); return; }
    connectGuest(body, code);
  });

  const form = el("div", { class: "row", style: "margin-bottom:14px" },
    el("span", { class: "muted", textContent: "Código de sala:" }), input, joinBtn,
  );
  const back = el("div", { class: "back-link" }, button("← Elegir otro modo", "ghost", () => renderChoice(body)));
  const hint = el("div", { class: "callout", innerHTML: "Pedile a tu amigo que <b>cree la sala</b> y te pase el código (o el link de invitación, que te trae acá con el código ya puesto)." });

  body.append(el("p", { class: "sub", textContent: "Entrá con el código que te compartieron. Vas a ver el juego del host y jugar como Jugador 2." }), form, hint, back);
  if (preCode) connectGuest(body, preCode);
}

function connectGuest(body: HTMLElement, code: string): void {
  body.replaceChildren();
  const pill = statusPill();
  pill.set("connecting", "Conectando…");

  const stage = el("div", { class: "stage" });
  const video = el("video", { muted: true, autoplay: true, playsInline: true }) as HTMLVideoElement;
  stage.append(video);
  const ov = overlay("Conectando con la sala " + code + "…");
  stage.append(ov.root);

  // Selector de preset de controles (cambia en caliente, sin reconectar).
  const preset = el("select", { class: "field" }) as HTMLSelectElement;
  for (const p of KEYBOARD_PRESETS) preset.append(el("option", { value: p.id, textContent: p.name }));
  const hintEl = el("span", { class: "muted small" });
  const applyHint = () => {
    const p = KEYBOARD_PRESETS.find((x) => x.id === preset.value)!;
    hintEl.textContent = p.hint;
    handle?.setKeyboard(p.map);
  };
  preset.onchange = applyHint;

  const toolbar = el("div", { class: "toolbar" },
    pill.root,
    el("div", { class: "spacer" }),
    el("span", { class: "muted small", textContent: "Controles:" }), preset,
    button("🎮 Ayuda", "ghost", controlsHelp),
    button("⛶", "ghost", () => toggleFullscreen(stage)),
    button("Salir", "danger", () => { handle?.stop(); renderChoice(body); }),
  );

  const callout = el("div", { class: "callout" }, el("span", {}, "Sos el "), el("b", { textContent: "Jugador 2" }), el("span", {}, ". Preset actual: "), hintEl);

  body.append(stage, toolbar, el("div", { style: "height:14px" }), callout);

  let handle: GuestHandle | undefined;
  let cleared = false;
  startGuest({
    videoEl: video, room: code, keyboard: KEYBOARD_PRESETS[0].map,
    onStatus: (s: NetStatus) => {
      if (!cleared && s.videoReady) { cleared = true; ov.remove(); }
      if (s.phase === "error") ov.setText(s.connection);
      pill.set(s.phase, s.phase === "connected" ? "Conectado" : s.connection, s.rttMs);
    },
  }).then((h) => { handle = h; applyHint(); });
}

// --- utils -----------------------------------------------------------------

function toggleFullscreen(elm: HTMLElement): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void elm.requestFullscreen().catch(() => toast("Pantalla completa no disponible"));
}
