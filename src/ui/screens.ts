import { launchLocal } from "../core/emulatorjs";
import { renderOnline } from "./online-screen";
import { controlsHelp } from "./controls-help";
import { el, button, clickable, romDropzone, romHelp, overlay, toast, touchWarning } from "./components";

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
    el("p", { textContent: "2 a 4 jugadores en esta misma compu, con varios mandos. Sin internet, sin vueltas." }),
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

function local(go: (s: Screen) => void): HTMLElement {
  const panel = el("div", { class: "panel" });
  panel.append(el("div", { class: "section-head" },
    el("h2", { textContent: "🛋️ Jugar Local" }),
    button("← Volver", "ghost", () => go("landing")),
  ));
  panel.append(el("p", { class: "sub", textContent: "Cargá tu ROM y jugá. Enchufá hasta 4 mandos para 2-4 jugadores en esta compu." }));
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
      el("span", { class: "muted small", textContent: "Configurá los controles desde el menú ⚙ del emulador, abajo." }),
      el("div", { class: "spacer" }),
      button("🎮 Controles", "ghost", controlsHelp),
      button("⛶ Pantalla completa", "ghost", () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void stage.requestFullscreen().catch(() => toast("No disponible"));
      }),
    );
    holder.append(stage, toolbar);
    launchLocal({ container: "#game", rom });
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
      // El emulador no tiene teardown sin recargar: si quedó corriendo (audio
      // incluido), recargar deja la app limpia en la pantalla nueva.
      if (window.EJS_emulator) location.reload();
    });
  });
  holder.append(dz, romHelp());

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
