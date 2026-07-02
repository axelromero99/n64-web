// Modo ONLINE 2 jugadores — host-authoritative (funciona HOY, sin core propio).
//
// Arquitectura:
//   HOST  = jugador 1. Corre el emulador (EmulatorJS). Captura el canvas y lo
//           envía por WebRTC (video) al guest. Recibe el input del guest por un
//           datachannel y lo aplica como jugador 2 con gameManager.simulateInput.
//   GUEST = jugador 2. No corre emulador: muestra el video que recibe y manda su
//           input (teclado) por el datachannel.
//
// Esto NO es rollback (el M0 mostró que el rollback necesita un core propio con
// savestate optimizado). Es streaming host-authoritative: perfecto para co-op
// casual y 100% construible en el navegador. La latencia = red + video.

import { launchLocal } from "../core/emulatorjs";
import { N64Button, type N64Input, type KeyboardMap, packInput, unpackInput, DEFAULT_KEYBOARD_P1, EMPTY_INPUT } from "../input/n64";
import { createSignaling, type Signaling } from "./signaling";

const ICE: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }],
};

// Reordena los codecs de video para preferir los de mejor calidad (VP9/H264)
// sobre el VP8 por defecto. Debe llamarse ANTES de createOffer.
function preferVideoCodec(pc: RTCPeerConnection, order: string[]): void {
  const caps = RTCRtpSender.getCapabilities?.("video");
  if (!caps) return;
  const rank = (mime: string) => {
    const i = order.findIndex((m) => m.toLowerCase() === mime.toLowerCase());
    return i === -1 ? order.length : i;
  };
  const sorted = [...caps.codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType));
  for (const t of pc.getTransceivers()) {
    if (t.sender?.track?.kind === "video" && "setCodecPreferences" in t) {
      try { t.setCodecPreferences(sorted); } catch { /* no soportado: ignorar */ }
    }
  }
}

// N64Button -> índice de EmulatorJS simulateInput (descubierto en runtime + fuente).
// OJO: EmulatorJS espera valor 32767 (no 1) para los índices ANALÓGICOS 16-23.
//   16-19 = stick izquierdo (steering)   ·   20-23 = stick derecho = botones C.
// Los demás son digitales (valor 1). Mandar 1 a un eje analógico ≈ no moverse:
// ese era el bug del guest que no podía girar.
const AXIS_MAX = 32767;

// Botones DIGITALES (valor 1/0).
const EJS_DIGITAL: Array<[N64Button, number]> = [
  [N64Button.A, 0],
  [N64Button.B, 1],
  [N64Button.Start, 3],
  [N64Button.Z, 12],
  [N64Button.L, 10],
  [N64Button.R, 11],
  [N64Button.DUp, 4],
  [N64Button.DDown, 5],
  [N64Button.DLeft, 6],
  [N64Button.DRight, 7],
];
// Botones C = stick derecho (índices ANALÓGICOS → valor 32767/0).
const EJS_C: Array<[N64Button, number]> = [
  [N64Button.CUp, 23],
  [N64Button.CDown, 22],
  [N64Button.CLeft, 21],
  [N64Button.CRight, 20],
];
// Stick izquierdo (analógico). +X derecha, -X izquierda, +Y arriba, -Y abajo.
const STICK = { xPos: 16, xNeg: 17, yPos: 18, yNeg: 19 };

// Hook de estado para UI + verificación automatizada.
export interface NetStatus {
  role: "host" | "guest";
  connection: string;
  /** Fase estable para pintar la UI (no el texto). */
  phase: "starting" | "waiting" | "connecting" | "connected" | "error";
  inputMsgs: number;
  videoReady: boolean;
  /** Round-trip time en ms (del par ICE), o null si aún no hay dato. */
  rttMs: number | null;
  /** Modo justo (input-delay) activo — solo relevante para el host. */
  fair?: boolean;
  /** Retardo aplicado a los inputs del host, en ms. */
  fairDelayMs?: number;
}

// Poll de estadísticas WebRTC para leer el RTT real del par conectado.
function pollRtt(pc: RTCPeerConnection, onRtt: (ms: number | null) => void): () => void {
  const id = window.setInterval(async () => {
    if (pc.connectionState !== "connected") return;
    try {
      const stats = await pc.getStats();
      let rtt: number | null = null;
      stats.forEach((r) => {
        if (r.type === "candidate-pair" && (r as any).nominated && (r as any).currentRoundTripTime != null) {
          rtt = Math.round((r as any).currentRoundTripTime * 1000);
        }
      });
      onRtt(rtt);
    } catch { /* noop */ }
  }, 1500);
  return () => window.clearInterval(id);
}
function publish(s: NetStatus) {
  (window as unknown as { __n64net?: NetStatus }).__n64net = { ...s };
}

interface EJSGameManager {
  simulateInput(p: number, i: number, v: number): void;
  setKeyboardEnabled?(on: boolean): void;
}
function gm(): EJSGameManager | null {
  return (window as unknown as { EJS_emulator?: { gameManager?: EJSGameManager } }).EJS_emulator?.gameManager ?? null;
}

// Escala una magnitud de stick (-128..127) al rango analógico de EmulatorJS.
function axis(v: number): number {
  const m = Math.min(1, Math.abs(v) / 127);
  return Math.round(m * AXIS_MAX);
}

// Línea de retardo de input: guarda el estado del teclado con timestamps y
// devuelve el estado "como era hace D ms". Se usa para el MODO JUSTO: retrasamos
// los inputs del host la misma latencia que sufre el invitado, así el anfitrión
// no tiene ventaja de reacción.
class DelayLine {
  private ev: { t: number; v: N64Input }[] = [{ t: 0, v: EMPTY_INPUT }];
  push(v: N64Input): void {
    this.ev.push({ t: performance.now(), v });
    if (this.ev.length > 300) this.ev.splice(0, this.ev.length - 300);
  }
  at(delayMs: number): N64Input {
    const cutoff = performance.now() - delayMs;
    let v: N64Input = this.ev[0].v;
    let last = 0;
    for (let i = 0; i < this.ev.length; i++) {
      if (this.ev[i].t <= cutoff) { v = this.ev[i].v; last = i; } else break;
    }
    if (last > 1) this.ev.splice(0, last); // podar lo ya consumido (dejar el aplicable)
    return v;
  }
}

// Aplica un N64Input al jugador `player` (0 = host/P1, 1 = guest/P2).
function applyInput(player: 0 | 1, input: N64Input): void {
  const g = gm();
  if (!g) return;
  // Digitales (A, B, Z, Start, L, R, D-Pad) → 1/0.
  for (const [bit, idx] of EJS_DIGITAL) g.simulateInput(player, idx, input.buttons & bit ? 1 : 0);
  // Botones C = stick derecho → analógico (32767/0).
  for (const [bit, idx] of EJS_C) g.simulateInput(player, idx, input.buttons & bit ? AXIS_MAX : 0);
  // Stick izquierdo → analógico proporcional (con pequeña zona muerta).
  const dz = 8;
  g.simulateInput(player, STICK.xPos, input.stickX > dz ? axis(input.stickX) : 0);
  g.simulateInput(player, STICK.xNeg, input.stickX < -dz ? axis(input.stickX) : 0);
  g.simulateInput(player, STICK.yPos, input.stickY > dz ? axis(input.stickY) : 0);
  g.simulateInput(player, STICK.yNeg, input.stickY < -dz ? axis(input.stickY) : 0);
}

// captureStream sobre un canvas WebGL da frames NEGROS salvo que el contexto se
// haya creado con preserveDrawingBuffer:true. EmulatorJS no lo hace, así que
// parcheamos getContext ANTES de que cree su canvas para forzarlo.
function patchWebGLForCapture(): void {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: ((type: string, attrs?: unknown) => unknown) & { __patched?: boolean };
  };
  if (proto.getContext.__patched) return;
  const orig = proto.getContext;
  const patched = function (this: HTMLCanvasElement, type: string, attrs?: Record<string, unknown>) {
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
      attrs = { ...(attrs ?? {}), preserveDrawingBuffer: true };
    }
    return orig.call(this, type, attrs);
  } as typeof proto.getContext;
  patched.__patched = true;
  proto.getContext = patched;
}

// EmulatorJS puede tener varios canvas (overlays chicos). El del JUEGO es el de
// mayor área — lo elegimos para capturar el video correcto.
function pickGameCanvas(container: string): HTMLCanvasElement {
  const list = [...document.querySelectorAll<HTMLCanvasElement>(`${container} canvas`)];
  return list.sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

const waitFor = async (cond: () => boolean, ms = 120000) => {
  const t0 = performance.now();
  while (!cond()) {
    if (performance.now() - t0 > ms) throw new Error("timeout esperando condición");
    await new Promise((r) => setTimeout(r, 200));
  }
};

// --- HOST -------------------------------------------------------------------

export interface HostHandle {
  /** Activar/desactivar el modo justo (input-delay) en caliente. */
  setFair: (on: boolean) => void;
}

export async function startHost(opts: {
  rom: File;
  gameContainer: string; // selector donde EmulatorJS monta el canvas (ej "#game")
  room: string;
  onStatus?: (s: NetStatus) => void;
}): Promise<HostHandle> {
  const status: NetStatus = { role: "host", connection: "arrancando emulador", phase: "starting", inputMsgs: 0, videoReady: false, rttMs: null, fair: true, fairDelayMs: 16 };
  const emit = () => { publish(status); opts.onStatus?.(status); };
  emit();

  patchWebGLForCapture();
  launchLocal({ container: opts.gameContainer, rom: opts.rom });
  await waitFor(() => !!gm());
  await waitFor(() => pickGameCanvas(opts.gameContainer)?.width > 0);
  const canvas = pickGameCanvas(opts.gameContainer);
  status.connection = "sala lista — esperando al jugador 2";
  status.phase = "waiting";
  emit();

  // Canvas 2D "espejo": copiamos el frame del juego acá cada vuelta y capturamos
  // el STREAM de este canvas 2D (no del WebGL). captureStream directo sobre un
  // canvas WebGL entrega frames negros según CUÁNDO se llame; el 2D es sólido
  // porque lo dibujamos explícitamente cada frame. (drawImage del canvas del
  // juego funciona gracias al parche preserveDrawingBuffer.)
  const mirror = document.createElement("canvas");
  mirror.width = canvas.width;
  mirror.height = canvas.height;
  const mctx = mirror.getContext("2d")!;

  let lastInput: N64Input = { buttons: 0, stickX: 0, stickY: 0 };

  // MODO JUSTO: cuando está activo, capturamos el teclado del host (P1) nosotros,
  // deshabilitamos el teclado interno de EmulatorJS, y aplicamos el input de P1
  // con un retardo = a la latencia que sufre el invitado. Así ninguno reacciona
  // antes que el otro. (El invitado igual ve el video con algo de latencia; esto
  // empareja el TIMING DE INPUT, que es la ventaja concreta del anfitrión.)
  const hostLine = new DelayLine();
  let detachHostKb: (() => void) | null = null;
  let fairActive = false;

  const enableFair = () => {
    const g = gm();
    if (fairActive || !g || typeof g.setKeyboardEnabled !== "function") return;
    g.setKeyboardEnabled(false); // apagar teclado interno de EmulatorJS para P1
    detachHostKb = attachKeyboard(DEFAULT_KEYBOARD_P1, (inp) => hostLine.push(inp));
    fairActive = true;
    status.fair = true; emit();
  };
  const disableFair = () => {
    const g = gm();
    detachHostKb?.(); detachHostKb = null;
    if (g && typeof g.setKeyboardEnabled === "function") g.setKeyboardEnabled(true);
    fairActive = false;
    status.fair = false; emit();
  };

  const loop = () => {
    if (fairActive) applyInput(0, hostLine.at(status.fairDelayMs ?? 16)); // P1 con retardo
    applyInput(1, lastInput); // input del guest -> P2, cada frame
    if (mirror.width !== canvas.width || mirror.height !== canvas.height) {
      mirror.width = canvas.width;
      mirror.height = canvas.height;
    }
    try { mctx.drawImage(canvas, 0, 0); } catch { /* canvas aún no listo */ }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const sig: Signaling = createSignaling(opts.room, "host");
  sig.onError = (info) => { status.connection = info; status.phase = "error"; emit(); };
  let pc: RTCPeerConnection | null = null;

  // El peer + la oferta se crean SOLO cuando el guest anuncia "join". Así el
  // handshake funciona sin importar el orden (crear sala antes o después de unirse)
  // y los candidatos ICE se emiten con el guest ya escuchando.
  async function startPeerForGuest(): Promise<void> {
    if (pc) return; // ya hay una sesión en curso: ignorar joins repetidos
    status.connection = "jugador 2 detectado — conectando…";
    status.phase = "connecting";
    emit();

    const stream = mirror.captureStream(30);
    pc = new RTCPeerConnection(ICE);
    for (const track of stream.getVideoTracks()) {
      track.contentHint = "motion"; // priorizar fluidez de movimiento
      const sender = pc.addTrack(track, stream);
      // Más bitrate, sin bajar resolución, manteniendo framerate → mejor calidad.
      try {
        const p = sender.getParameters();
        p.degradationPreference = "maintain-framerate";
        p.encodings = [{ maxBitrate: 8_000_000, maxFramerate: 30, scaleResolutionDownBy: 1 }];
        void sender.setParameters(p);
      } catch { /* algunos navegadores no lo permiten; no es crítico */ }
    }
    // Preferir un codec de mejor calidad que el VP8 por defecto.
    preferVideoCodec(pc, ["video/VP9", "video/H264", "video/VP8"]);
    (window as unknown as { __n64hostPc?: RTCPeerConnection }).__n64hostPc = pc;

    const dc = pc.createDataChannel("input", { ordered: false, maxRetransmits: 0 });
    dc.binaryType = "arraybuffer";
    dc.onmessage = (e) => {
      lastInput = unpackInput(new Int32Array(e.data as ArrayBuffer)[0]);
      status.inputMsgs++;
      emit();
    };

    pc.onicecandidate = (e) => e.candidate && sig.send({ ice: e.candidate.toJSON() });
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      const st = pc.connectionState;
      if (st === "connected") {
        status.connection = "¡Jugador 2 conectado! 🎮"; status.phase = "connected";
        if (status.fair) enableFair(); // emparejar el timing de input
      } else if (st === "disconnected" || st === "failed") {
        status.connection = "jugador 2 se desconectó"; status.phase = "waiting"; status.rttMs = null; pc = null;
        disableFair(); // el host vuelve a jugar normal mientras espera
      } else { status.connection = st; }
      emit();
    };
    pollRtt(pc, (ms) => {
      status.rttMs = ms;
      // Retardo justo = latencia de ida (RTT/2), acotado. Es la demora que sufre
      // el input del invitado en llegar; se la aplicamos también al host.
      if (ms != null) status.fairDelayMs = Math.min(120, Math.max(16, Math.round(ms / 2)));
      emit();
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sig.send({ offer });
  }

  sig.onMessage = async (msg) => {
    if (msg.join) await startPeerForGuest();
    else if (msg.answer && pc) await pc.setRemoteDescription(msg.answer).catch(() => {});
    else if (msg.ice && pc) await pc.addIceCandidate(msg.ice).catch(() => {});
  };

  return {
    setFair: (on: boolean) => {
      status.fair = on;
      if (on && pc?.connectionState === "connected") enableFair();
      else if (!on) disableFair();
      emit();
    },
  };
}

// --- GUEST ------------------------------------------------------------------

export interface GuestHandle {
  stop: () => void;
  /** Cambiar el preset de teclado en caliente (sin reconectar). */
  setKeyboard: (map: KeyboardMap) => void;
}

export async function startGuest(opts: {
  videoEl: HTMLVideoElement;
  room: string;
  keyboard?: KeyboardMap;
  onStatus?: (s: NetStatus) => void;
}): Promise<GuestHandle> {
  const status: NetStatus = { role: "guest", connection: "conectando", phase: "connecting", inputMsgs: 0, videoReady: false, rttMs: null };
  const emit = () => { publish(status); opts.onStatus?.(status); };
  emit();

  const pc = new RTCPeerConnection(ICE);
  (window as unknown as { __n64guestPc?: RTCPeerConnection }).__n64guestPc = pc;
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.ontrack = (e) => {
    // Minimizar el jitter buffer del decoder → mucha menos latencia de video.
    try {
      const rx = e.receiver as RTCRtpReceiver & { playoutDelayHint?: number; jitterBufferTarget?: number };
      rx.playoutDelayHint = 0;
      rx.jitterBufferTarget = 0;
    } catch { /* no soportado en este navegador */ }
    opts.videoEl.srcObject = e.streams[0];
    opts.videoEl.muted = true;
    opts.videoEl.autoplay = true;
    opts.videoEl.playsInline = true;
    void opts.videoEl.play().catch(() => {});
    status.videoReady = true;
    emit();
  };

  const dbg = ((window as unknown as { __n64dbg?: Record<string, unknown> }).__n64dbg = {
    dcFired: false,
    dcOpen: false,
    keydown: 0,
    sent: 0,
  });
  let currentMap: KeyboardMap = opts.keyboard ?? DEFAULT_KEYBOARD_P1;
  let detach = () => {};
  let dc: RTCDataChannel | null = null;

  const sendInput = (input: N64Input) => {
    dbg.keydown = (dbg.keydown as number) + 1;
    status.inputMsgs++;
    emit();
    if (dc && dc.readyState === "open") {
      dc.send(new Int32Array([packInput(input)]).buffer);
      dbg.sent = (dbg.sent as number) + 1;
    }
  };
  const reattach = (map: KeyboardMap) => {
    currentMap = map;
    detach();
    detach = attachKeyboard(map, sendInput);
  };

  pc.ondatachannel = (e) => {
    dc = e.channel;
    dc.binaryType = "arraybuffer";
    dbg.dcFired = true;
    dc.onopen = () => (dbg.dcOpen = true);
    reattach(currentMap);
  };

  const sig = createSignaling(opts.room, "guest");
  sig.onError = (info) => { status.connection = info; status.phase = "error"; emit(); };
  pc.onicecandidate = (e) => e.candidate && sig.send({ ice: e.candidate.toJSON() });
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === "connected") { status.connection = "conectado ✓ (el juego tarda ~10-15s en aparecer)"; status.phase = "connected"; }
    else if (st === "disconnected" || st === "failed") { status.connection = "se perdió la conexión"; status.phase = "error"; status.rttMs = null; }
    else { status.connection = st; }
    emit();
  };
  pollRtt(pc, (ms) => { status.rttMs = ms; emit(); });

  let answered = false;
  sig.onMessage = async (msg) => {
    if (msg.offer && !answered) {
      answered = true;
      status.connection = "oferta recibida — respondiendo…";
      emit();
      await pc.setRemoteDescription(msg.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sig.send({ answer });
    } else if (msg.ice) {
      await pc.addIceCandidate(msg.ice).catch(() => {});
    }
  };

  // Anunciar "join" ya, y reintentar hasta recibir la oferta. Cubre el caso de
  // unirse ANTES de que el host esté listo Y después de que ya haya ofertado.
  sig.send({ join: true });
  let tries = 0;
  const joinTimer = window.setInterval(() => {
    if (answered) { window.clearInterval(joinTimer); return; }
    tries++;
    // Tras ~8s sin respuesta, casi seguro no hay host en esa sala: avisar.
    if (tries < 8) {
      status.connection = "buscando la sala del host…";
      status.phase = "connecting";
    } else {
      status.connection = "no encuentro una sala con ese código. ¿El host ya creó la sala y cargó su ROM?";
      status.phase = "error";
    }
    emit();
    sig.send({ join: true });
  }, 1000);

  return {
    stop: () => { window.clearInterval(joinTimer); detach(); pc.close(); sig.close(); },
    setKeyboard: (map: KeyboardMap) => reattach(map),
  };
}

// Captura de teclado del guest -> N64Input, con callback en cada cambio.
// Polaridad del stick (consistente con el host N64_CONTROLS_P0):
//   arriba = Y negativo (índice 19) · abajo = Y positivo (índice 18)
//   derecha = X positivo (índice 16) · izquierda = X negativo (índice 17)
function attachKeyboard(map: KeyboardMap, onChange: (input: N64Input) => void): () => void {
  const state: N64Input = { buttons: 0, stickX: 0, stickY: 0 };
  const isMapped = (code: string) =>
    code in map.buttons || code === map.axis.up || code === map.axis.down ||
    code === map.axis.left || code === map.axis.right;
  const set = (code: string, down: boolean) => {
    let changed = false;
    const btn = map.buttons[code];
    if (btn !== undefined) {
      const next = down ? state.buttons | btn : state.buttons & ~btn;
      if (next !== state.buttons) { state.buttons = next; changed = true; }
    }
    const setAxis = (axis: "stickX" | "stickY", val: number) => {
      if (state[axis] !== val) { state[axis] = val; changed = true; }
    };
    if (code === map.axis.left) setAxis("stickX", down ? -127 : 0);
    else if (code === map.axis.right) setAxis("stickX", down ? 127 : 0);
    else if (code === map.axis.up) setAxis("stickY", down ? -127 : 0);
    else if (code === map.axis.down) setAxis("stickY", down ? 127 : 0);
    if (changed) onChange({ ...state });
  };
  const kd = (e: KeyboardEvent) => { if (isMapped(e.code)) e.preventDefault(); set(e.code, true); };
  const ku = (e: KeyboardEvent) => { if (isMapped(e.code)) e.preventDefault(); set(e.code, false); };
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  onChange({ ...state });
  return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
}
