import { launchLocal } from "../core/emulatorjs";
import { renderSpike } from "../m0/spike";
import { renderOnline } from "./online-screen";
import { renderV2 } from "./v2-screen";
import { controlsHelp } from "./controls-help";
import { el, button, romDropzone, overlay, toast } from "./components";

export type Screen = "landing" | "local" | "online" | "m0" | "v2";

// ---------- Header + hero ----------

function topbar(go: (s: Screen) => void): HTMLElement {
  const brand = el("div", { class: "brand-mini" },
    el("span", { class: "dot" }),
    el("span", { class: "logo", innerHTML: "N<b>64</b> Web" }),
  );
  brand.onclick = () => go("landing");
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

  const local = el("div", { class: "card" },
    el("div", { class: "arrow", textContent: "→" }),
    el("div", { class: "card-icon", textContent: "🛋️" }),
    el("h2", { textContent: "Jugar Local" }),
    el("p", { textContent: "2 a 4 jugadores en esta misma compu, con varios mandos. Sin internet, sin vueltas." }),
  );
  local.onclick = () => go("local");

  const online = el("div", { class: "card" },
    el("div", { class: "arrow", textContent: "→" }),
    el("div", { class: "card-icon", textContent: "🌐" }),
    el("h2", { innerHTML: 'Jugar Online <span class="badge badge-green">2P · nuevo</span>' }),
    el("p", { textContent: "Creá una sala y pasá el link. Tu amigo se une desde su compu y juegan juntos por internet." }),
  );
  online.onclick = () => go("online");

  cards.append(local, online);
  wrap.append(cards);

  const v2 = el("div", { class: "card", style: "margin-top:18px" },
    el("div", { class: "arrow", textContent: "→" }),
    el("div", { class: "card-icon", textContent: "🧪" }),
    el("h2", { innerHTML: 'Netcode justo <span class="badge">v2 · rollback</span>' }),
    el("p", { textContent: "Demo del online competitivo: ambos corren la misma simulación e intercambian solo inputs, con lockstep y rollback deterministas. Cero ventaja, verificado. El motor que después manejará N64." }),
  );
  v2.onclick = () => go("v2");
  wrap.append(v2);
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
    // Quitar overlay cuando aparezca el canvas del juego.
    const t = window.setInterval(() => {
      if (document.querySelector("#game canvas")) { ov.remove(); window.clearInterval(t); }
    }, 500);
  });
  holder.append(dz);

  return panel;
}

// ---------- M0 ----------

function m0Screen(): HTMLElement {
  const panel = el("div", { class: "panel" });
  renderSpike(panel);
  return panel;
}

// ---------- Footer ----------

function footer(): HTMLElement {
  return el("div", { class: "footer" },
    el("div", { innerHTML: "Cargá tu propia ROM — nunca se sube a ningún servidor. Es tu partida, en tu navegador." }),
    el("div", { innerHTML: '<a href="#m0">🔬 Spike técnico (M0)</a> · hecho con WebRTC + WebAssembly' }),
  );
}

// ---------- Router ----------

export function render(app: HTMLElement, go: (s: Screen) => void, screen: Screen): void {
  app.replaceChildren();
  app.append(topbar(go));
  if (screen === "landing") app.append(landing(go));
  else if (screen === "local") app.append(local(go));
  else if (screen === "online") renderOnline(app, () => go("landing"));
  else if (screen === "v2") renderV2(app, () => go("landing"));
  else app.append(m0Screen());
  app.append(footer());
}
