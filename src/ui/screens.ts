import { launchLocal, CONTROL_PRESETS, DEFAULT_PRESET_BY_PLAYER, applyPlayerPreset } from "../core/emulatorjs";
import { renderOnline } from "./online-screen";
import { controlsHelp } from "./controls-help";
import { el, button, clickable, romDropzone, overlay, toast, touchWarning } from "./components";

export type Screen = "landing" | "local" | "online";

// Cleanup de la pantalla activa (conexiones, timers, listeners globales). La
// pantalla que arranca algo con vida propia lo registra acá; render() lo
// ejecuta al navegar para no dejar sesiones/listeners zombies.
let screenCleanup: (() => void) | null = null;
export function onScreenLeave(fn: () => void): void {
  screenCleanup = fn;
}

// ---------- Header + hero ----------

function topbar(go: (s: Screen) => void): HTMLElement {
  const brand = clickable(el("div", { class: "brand-mini" },
    el("span", { class: "dot" }),
    el("span", { class: "logo", innerHTML: "N<b>64</b> Web" }),
  ), () => go("landing"));
  return el("div", { class: "topbar" }, brand,
    el("div", { class: "row" }, button("🎮 Controles", "ghost", controlsHelp)),
  );
}

function hero(): HTMLElement {
  const h = el("div", { class: "hero" });
  h.append(
    el("h1", { innerHTML: "Jugá <b>Nintendo 64</b> en tu navegador" }),
    el("p", { textContent: "Solo. Con amigos en el mismo sillón. O con alguien al otro lado del mundo." }),
  );
  return h;
}

// ---------- Landing ----------

function landing(go: (s: Screen) => void): HTMLElement {
  const wrap = el("div");
  wrap.append(hero());

  const cards = el("div", { class: "cards" });

  const local = clickable(el("div", { class: "card" },
    el("div", { class: "arrow", textContent: "→" }),
    el("div", { class: "card-icon", textContent: "🛋️" }),
    el("h2", { textContent: "Jugar Local" }),
    el("p", { textContent: "Hasta 4 jugadores en esta misma compu, con varios mandos. Mario Party, Smash, Mario Kart. Sin internet, sin vueltas." }),
  ), () => go("local"));

  const online = clickable(el("div", { class: "card" },
    el("div", { class: "arrow", textContent: "→" }),
    el("div", { class: "card-icon", textContent: "🌐" }),
    el("h2", { innerHTML: 'Jugar Online <span class="badge badge-green">2P · nuevo</span>' }),
    el("p", { textContent: "Creá una sala y pasá el link. Tu amigo se une desde su compu y juegan juntos por internet." }),
  ), () => go("online"));

  cards.append(local, online);
  wrap.append(cards);
  return wrap;
}

// ---------- Local ----------

// Aviso EN VIVO de Bloq Num: el preset Numpad depende de que NumLock esté
// activado. Con NumLock OFF, el navegador reporta las teclas del numpad como
// flechas/Insert (keyCode 38/45…), que además pisan al Jugador 1. Cuando algún
// jugador usa Numpad, vigilamos la primera tecla del numpad y avisamos si está
// apagado. `code` sigue siendo "Numpad8" aunque NumLock esté OFF, así lo
// detectamos sin ambigüedad.
let numpadUsers = 0;
let numlockListener: ((e: KeyboardEvent) => void) | null = null;
let numlockWarned = false;
function watchNumlock(active: boolean): void {
  if (active && !numlockListener) {
    numlockWarned = false;
    numlockListener = (e) => {
      if (numlockWarned || !e.code.startsWith("Numpad")) return;
      if (e.getModifierState && !e.getModifierState("NumLock")) {
        numlockWarned = true;
        toast("⚠ Activá Bloq Num: sin él, el numpad no controla al Jugador 2 (y pisa al Jugador 1)");
      }
    };
    document.addEventListener("keydown", numlockListener, true);
  } else if (!active && numlockListener) {
    document.removeEventListener("keydown", numlockListener, true);
    numlockListener = null;
  }
}

// Sondeo del estado de mandos: refleja la asignación REAL de EmulatorJS
// (gamepadSelection: un slot por jugador con "id_index" si tiene mando). Enciende
// un badge "🎮 detectado" en el jugador correspondiente al enchufar un control.
let gamepadPoll = 0;
function watchGamepads(badges: HTMLElement[]): void {
  window.clearInterval(gamepadPoll);
  gamepadPoll = window.setInterval(() => {
    const sel = window.EJS_emulator?.gamepadSelection;
    badges.forEach((b, p) => b.classList.toggle("on", !!(sel && sel[p])));
  }, 500);
}

// Selector de preset por jugador (P1-P4). El default es simple: P1 al teclado
// (Flechas) y el resto por mando; cada uno cambia su layout acá para, p. ej.,
// jugar de a dos en el mismo teclado (P1 Flechas + P2 Numpad).
function presetPicker(): HTMLElement {
  const hintFor = (id: string) => CONTROL_PRESETS.find((p) => p.id === id)?.hint ?? "";

  numpadUsers = 0;
  watchNumlock(false);
  const chosen: string[] = [...DEFAULT_PRESET_BY_PLAYER];
  const badges: HTMLElement[] = [];

  const rows = el("div", { class: "presets-rows" });
  for (let p = 0; p < 4; p++) {
    const sel = el("select", { class: "preset-select" });
    sel.setAttribute("aria-label", `Controles del jugador ${p + 1}`);
    sel.dataset.player = String(p);
    for (const preset of CONTROL_PRESETS) sel.append(el("option", { value: preset.id, textContent: preset.name }));
    sel.value = DEFAULT_PRESET_BY_PLAYER[p];

    const hint = el("span", { class: "muted small preset-hint", textContent: hintFor(sel.value) });
    sel.onchange = () => {
      hint.textContent = hintFor(sel.value);
      if (!applyPlayerPreset(p, sel.value)) { toast("Esperá a que arranque el juego para cambiar controles"); return; }
      if (chosen[p] === "numpad") numpadUsers--;
      if (sel.value === "numpad") { numpadUsers++; toast("Numpad: acordate de activar Bloq Num"); }
      chosen[p] = sel.value;
      watchNumlock(numpadUsers > 0);
    };

    const badge = el("span", { class: "gp-badge", title: "Mando detectado", textContent: "🎮 mando" });
    badge.dataset.player = String(p);
    badges.push(badge);

    rows.append(el("div", { class: "preset-row" },
      el("span", { class: "preset-label", textContent: `Jugador ${p + 1}` }),
      sel, badge, hint,
    ));
  }

  watchGamepads(badges);

  return el("details", { class: "presets", open: true },
    el("summary", {},
      el("span", { textContent: "🎮 Controles por jugador" }),
      el("span", { class: "muted small", textContent: "Dos en un teclado: P1 Flechas + P2 Numpad (con Bloq Num)" }),
    ),
    rows,
    el("p", { class: "muted small preset-foot", textContent: "Enchufá mandos y se asignan en orden (1º = P1…). Reasigná cada botón desde el menú ⚙ del emulador." }),
  );
}

function local(go: (s: Screen) => void): HTMLElement {
  const panel = el("div", { class: "panel" });
  panel.append(el("div", { class: "section-head" },
    el("h2", { textContent: "🛋️ Jugar Local" }),
    button("← Volver", "ghost", () => go("landing")),
  ));
  panel.append(el("p", { class: "sub", textContent: "Cargá tu ROM y jugá. Hasta 4 jugadores en esta compu — ideal para Mario Party, Smash o Mario Kart a pantalla dividida." }));
  const warn = touchWarning();
  if (warn) panel.append(warn);

  const holder = el("div");
  panel.append(holder);

  const dz = romDropzone((rom) => {
    holder.replaceChildren();
    const stage = el("div", { class: "stage" });
    const game = el("div", { id: "game" });
    stage.append(game);
    const ov = overlay("Descargando el core de N64 y arrancando el juego…");
    stage.append(ov.root);
    const toolbar = el("div", { class: "toolbar" },
      el("span", { class: "muted small", textContent: "Hasta 4 jugadores. Elegí el control de cada uno abajo 👇" }),
      el("div", { class: "spacer" }),
      button("🎮 Controles", "ghost", controlsHelp),
      button("⛶ Pantalla completa", "ghost", () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void stage.requestFullscreen().catch(() => toast("No disponible"));
      }),
    );
    holder.append(stage, toolbar, presetPicker());
    launchLocal({ container: "#game", rom, multiplayer: true });
    // Quitar overlay cuando aparezca el canvas del juego; si en 30 s no
    // apareció, algo falló (CDN caído, ROM inválida): avisar en vez de girar.
    const t0 = performance.now();
    const t = window.setInterval(() => {
      if (document.querySelector("#game canvas")) { ov.remove(); window.clearInterval(t); }
      else if (performance.now() - t0 > 30000) {
        ov.setText("El juego no arrancó. Puede ser la ROM (¿es un .z64/.n64/.v64 válido?) o tu conexión al CDN del emulador. Recargá la página para reintentar.");
        window.clearInterval(t);
      }
    }, 500);
    onScreenLeave(() => {
      window.clearInterval(t);
      window.clearInterval(gamepadPoll);
      watchNumlock(false);
      // El emulador no tiene teardown sin recargar: si quedó corriendo (audio
      // incluido), recargar deja la app limpia en la pantalla nueva.
      if (window.EJS_emulator) location.reload();
    });
  });
  holder.append(dz);

  return panel;
}

// ---------- Footer ----------

function footer(): HTMLElement {
  return el("div", { class: "footer" },
    el("div", { innerHTML: "Cargá tu propia ROM — nunca se sube a ningún servidor. Es tu partida, en tu navegador." }),
    el("div", { textContent: "Hecho con WebRTC + WebAssembly" }),
  );
}

// ---------- Router ----------

export function render(app: HTMLElement, go: (s: Screen) => void, screen: Screen): void {
  screenCleanup?.();
  screenCleanup = null;
  app.replaceChildren();
  app.append(topbar(go));
  if (screen === "landing") app.append(landing(go));
  else if (screen === "local") app.append(local(go));
  else renderOnline(app, () => go("landing"));
  app.append(footer());
}
