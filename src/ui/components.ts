// Helpers de UI reutilizables. Mantienen el estilo consistente sin un framework.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Omit<HTMLElementTagNameMap[K], "style">> & { class?: string; style?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const { class: className, style, ...rest } = props;
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (style) node.style.cssText = style;
  Object.assign(node, rest);
  for (const c of children) node.append(c);
  return node;
}

/**
 * Hace accesible un elemento clickeable que no es <button>: rol de botón,
 * foco con Tab y activación con Enter/Espacio.
 */
export function clickable<T extends HTMLElement>(node: T, onActivate: () => void): T {
  node.onclick = onActivate;
  node.setAttribute("role", "button");
  node.tabIndex = 0;
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(); }
  });
  return node;
}

/** Aviso para pantallas táctiles: se juega con teclado o mando físico. */
export function touchWarning(): HTMLElement | null {
  if (!window.matchMedia?.("(pointer: coarse)").matches) return null;
  return el("div", {
    class: "callout warn",
    style: "margin-bottom:14px",
    textContent: "📱 Estás en una pantalla táctil: para jugar vas a necesitar un teclado o un mando conectado (todavía no hay controles táctiles).",
  });
}

export type BtnVariant = "primary" | "ghost" | "accent" | "danger";

export function button(label: string, variant: BtnVariant = "primary", onClick?: () => void): HTMLButtonElement {
  const b = el("button", { class: `btn btn-${variant}`, type: "button" });
  b.innerHTML = label;
  if (onClick) b.onclick = onClick;
  return b;
}

/** Pill de estado con color según la fase. */
export function statusPill(): { root: HTMLElement; set: (phase: string, text: string, rtt?: number | null) => void } {
  const dot = el("span", { class: "pill-dot" });
  const label = el("span", { class: "pill-label" });
  const rttEl = el("span", { class: "pill-rtt" });
  const root = el("div", { class: "pill" }, dot, label, rttEl);
  const set = (phase: string, text: string, rtt?: number | null) => {
    root.className = `pill pill-${phase}`;
    label.textContent = text;
    if (rtt != null) {
      rttEl.textContent = `${rtt} ms`;
      rttEl.className = "pill-rtt " + (rtt < 60 ? "rtt-good" : rtt < 120 ? "rtt-ok" : "rtt-bad");
    } else {
      rttEl.textContent = "";
    }
  };
  return { root, set };
}

/** Overlay de carga sobre un contenedor relativo. */
export function overlay(text: string): { root: HTMLElement; setText: (t: string) => void; remove: () => void } {
  const msg = el("div", { class: "overlay-text", textContent: text });
  const root = el("div", { class: "overlay" }, el("div", { class: "overlay-spin" }), msg);
  return { root, setText: (t) => (msg.textContent = t), remove: () => root.remove() };
}

let toastTimer = 0;
export function toast(message: string): void {
  let t = document.querySelector<HTMLElement>(".toast");
  if (!t) {
    t = el("div", { class: "toast" });
    document.body.append(t);
  }
  t.textContent = message;
  t.classList.add("toast-show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t!.classList.remove("toast-show"), 2200);
}

/** Zona para soltar/elegir un archivo de ROM. */
export function romDropzone(onFile: (f: File) => void, hint = "Arrastrá tu ROM acá o hacé click"): HTMLElement {
  const input = el("input", { type: "file", accept: ".z64,.n64,.v64,.zip", class: "hidden-file" });
  const zone = el(
    "label",
    { class: "dropzone" },
    el("div", { class: "dropzone-icon", textContent: "🎮" }),
    el("div", { class: "dropzone-hint", textContent: hint }),
    el("div", { class: "dropzone-sub", textContent: ".z64 · .n64 · .v64 — se queda en tu navegador, no se sube" }),
    input,
  );
  input.onchange = () => { const f = input.files?.[0]; if (f) onFile(f); };
  const stop = (e: Event) => { e.preventDefault(); zone.classList.add("dropzone-over"); };
  zone.addEventListener("dragover", stop);
  zone.addEventListener("dragleave", () => zone.classList.remove("dropzone-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dropzone-over");
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) onFile(f);
  });
  return zone;
}

/** Copia texto al portapapeles con fallback. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = el("textarea", { value: text });
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Código de sala corto y legible (sin caracteres ambiguos). */
export function makeRoomCode(len = 5): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin O/0/I/1/L
  const rnd = new Uint32Array(len);
  crypto.getRandomValues(rnd);
  let code = "";
  for (let i = 0; i < len; i++) code += alphabet[rnd[i] % alphabet.length];
  return code;
}

/** Lee ?room=CODE de la URL (los links de invitación traen el código puesto). */
export function roomFromUrl(): string | null {
  const r = new URLSearchParams(location.search).get("room");
  return r ? r.toUpperCase() : null;
}

/** Link de invitación: URL actual + código de sala (+ extras) + pantalla. */
export function inviteLink(room: string, hash: string, extra: Record<string, string> = {}): string {
  const u = new URL(location.href);
  u.searchParams.set("room", room);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  u.hash = hash;
  return u.toString();
}
