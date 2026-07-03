// Modo ONLINE 2 jugadores — host-authoritative (funciona HOY, sin core propio).
//
// Arquitectura:
//   HOST  = jugador 1. Corre el emulador (EmulatorJS). Captura el canvas y lo
//           envía por WebRTC (video) al guest. Recibe el input del guest por un
//           datachannel y lo aplica como jugador 2 con gameManager.simulateInput.
//   GUEST = jugador 2. No corre emulador: muestra el video que recibe y manda su
//           input (teclado) por el datachannel.
//
// Es streaming host-authoritative: la latencia = red + codificación de video.
// La ventaja de reacción del host se compensa con el MODO JUSTO (input-delay,
// ver DelayLine). Netcodes tipo rollback quedan descartados con este core:
// EmulatorJS no expone frame-step y sus savestates pesan ~16 MB / ~8.5 ms
// (medido con MK64 real; ver docs/M0-findings.md), inviable para guardar/
// rebobinar 60 veces por segundo.

import { launchLocal } from "../core/emulatorjs";
import { N64Button, type N64Input, type KeyboardMap, packInput, unpackInput, DEFAULT_KEYBOARD_P1, EMPTY_INPUT } from "../input/n64";
import { createSignaling, type Signaling } from "./signaling";
import { DEBUG_HOOKS, iceConfig, pollRtt, serializeMessages, RemoteCandidates, watchConnection } from "./rtc";

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

function publish(s: NetStatus) {
  if (DEBUG_HOOKS) (window as unknown as { __n64net?: NetStatus }).__n64net = { ...s };
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

const waitFor = async (cond: () => boolean, ms = 120000, what = "el emulador no respondió — probá recargar la página") => {
  const t0 = performance.now();
  while (!cond()) {
    if (performance.now() - t0 > ms) throw new Error(what);
    await new Promise((r) => setTimeout(r, 200));
  }
};

// --- HOST -------------------------------------------------------------------

export interface HostHandle {
  /** Activar/desactivar el modo justo (input-delay) en caliente. */
  setFair: (on: boolean) => void;
  /** Cierra la sala: corta la conexión, la señalización y el loop de red.
   *  (El emulador en sí sigue: EmulatorJS no tiene teardown sin recargar.) */
  stop: () => void;
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
  await waitFor(() => !!gm(), 120000, "el emulador no arrancó — ¿la ROM es válida? Probá recargar la página");
  await waitFor(() => pickGameCanvas(opts.gameContainer)?.width > 0, 120000, "el juego no mostró imagen — probá recargar la página");
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
  // fairWanted = preferencia del usuario (el toggle). fairActive = si AHORA
  // estamos capturando/retrasando (solo con un guest conectado). Separarlos hace
  // que la preferencia sobreviva a una desconexión + reconexión del guest.
  const hostLine = new DelayLine();
  let detachHostKb: (() => void) | null = null;
  let fairWanted = true;
  let fairActive = false;

  const applyFair = (connected: boolean) => {
    const g = gm();
    const shouldBeActive = fairWanted && connected;
    if (shouldBeActive && !fairActive && g && typeof g.setKeyboardEnabled === "function") {
      g.setKeyboardEnabled(false); // apagar teclado interno de EmulatorJS para P1
      detachHostKb = attachKeyboard(DEFAULT_KEYBOARD_P1, (inp) => hostLine.push(inp));
      fairActive = true;
    } else if (!shouldBeActive && fairActive) {
      detachHostKb?.(); detachHostKb = null;
      if (g && typeof g.setKeyboardEnabled === "function") g.setKeyboardEnabled(true);
      fairActive = false;
    }
    status.fair = fairWanted;
    emit();
  };

  // Bucle de red del host: aplicar inputs + copiar el frame al espejo. Es un
  // setInterval y NO requestAnimationFrame a propósito: rAF se congela con la
  // pestaña oculta y dejaba de aplicarse el input del guest. Con timers, y con
  // el audio del juego sonando, Chrome no acelera el throttling en background.
  const loopTimer = window.setInterval(() => {
    if (fairActive) applyInput(0, hostLine.at(status.fairDelayMs ?? 16)); // P1 con retardo
    applyInput(1, lastInput); // input del guest -> P2, cada frame
    if (mirror.width !== canvas.width || mirror.height !== canvas.height) {
      mirror.width = canvas.width;
      mirror.height = canvas.height;
    }
    try { mctx.drawImage(canvas, 0, 0); } catch { /* canvas aún no listo */ }
  }, 16);

  const sig: Signaling = createSignaling(opts.room, "host");
  sig.onError = (info) => { status.connection = info; status.phase = "error"; emit(); };
  let pc: RTCPeerConnection | null = null;
  let creatingPeer = false;
  let candidates: RemoteCandidates | null = null;
  let stopRtt: (() => void) | null = null;
  let stopped = false;

  // Baja la sesión con el guest actual y deja la sala lista para otro join.
  // Importante: cerrar el pc viejo y parar su poll de RTT (si no, quedan
  // conexiones zombie que pueden "revivir"), y RESETEAR el input de P2 (si no,
  // el último input del guest queda aplicándose para siempre).
  const teardownPeer = (msg?: string) => {
    if (!pc) return;
    stopRtt?.(); stopRtt = null;
    try { pc.close(); } catch { /* ya cerrado */ }
    pc = null;
    candidates = null;
    lastInput = EMPTY_INPUT;
    status.rttMs = null;
    applyFair(false); // el host vuelve a jugar normal mientras espera
    if (msg && !stopped) { status.connection = msg; status.phase = "waiting"; emit(); }
  };

  // El peer + la oferta se crean SOLO cuando el guest anuncia "join". Así el
  // handshake funciona sin importar el orden (crear sala antes o después de unirse)
  // y los candidatos ICE se emiten con el guest ya escuchando.
  async function startPeerForGuest(): Promise<void> {
    if (pc || creatingPeer || stopped) return; // ya hay una sesión en curso: ignorar joins repetidos
    creatingPeer = true;
    status.connection = "jugador 2 detectado — conectando…";
    status.phase = "connecting";
    emit();

    // TURN (si está configurado) se pide por sesión: credenciales efímeras.
    const rtcConfig = await iceConfig();
    if (pc || stopped) { creatingPeer = false; return; }
    creatingPeer = false;

    const stream = mirror.captureStream(30);
    pc = new RTCPeerConnection(rtcConfig);
    const thisPc = pc;
    candidates = new RemoteCandidates(pc);
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
    if (DEBUG_HOOKS) (window as unknown as { __n64hostPc?: RTCPeerConnection }).__n64hostPc = pc;

    const dc = pc.createDataChannel("input", { ordered: false, maxRetransmits: 0 });
    dc.binaryType = "arraybuffer";
    // Estado por sesión para descartar paquetes viejos/reordenados del canal
    // no-confiable y evitar re-emitir en los keepalives que no cambian nada.
    let lastSeq = 0;
    let lastPacked = packInput(EMPTY_INPUT);
    dc.onmessage = (e) => {
      const data = e.data as ArrayBuffer;
      if (!(data instanceof ArrayBuffer) || data.byteLength !== 8) return; // [inputPack, seq]
      const arr = new Int32Array(data);
      const s = arr[1];
      if (s === lastSeq || (s - lastSeq) < 0) return; // viejo/reordenado (delta con signo por si wrappea)
      lastSeq = s;
      const packed = arr[0];
      if (packed === lastPacked) return; // keepalive sin cambios: no tocar la UI
      lastPacked = packed;
      lastInput = unpackInput(packed);
      status.inputMsgs++;
      emit();
    };
    // Si el canal muere antes que ICE lo note, soltar el input de P2 ya.
    dc.onclose = () => { if (pc === thisPc) lastInput = EMPTY_INPUT; };

    pc.onicecandidate = (e) => e.candidate && sig.send({ ice: e.candidate.toJSON() });
    watchConnection(pc, {
      onState: (st) => {
        if (pc !== thisPc) return;
        if (st === "connected") {
          status.connection = "¡Jugador 2 conectado! 🎮";
          status.phase = "connected";
          applyFair(true); // emparejar el timing de input
        } else if (st === "disconnected") {
          status.connection = "conexión inestable — esperando que vuelva…";
        } else if (st !== "failed" && st !== "closed") {
          status.connection = st;
        }
        emit();
      },
      onLost: () => {
        if (pc !== thisPc) return;
        teardownPeer("jugador 2 se desconectó — la sala sigue abierta para que vuelva a entrar");
      },
    });
    stopRtt = pollRtt(pc, (ms) => {
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

  // Serializado: procesa un mensaje por vez (evita addIceCandidate durante un
  // setRemoteDescription pendiente, que perdía candidatos en silencio).
  sig.onMessage = serializeMessages(async (msg) => {
    if (msg.join) {
      await startPeerForGuest();
    } else if (msg.answer && pc) {
      // Solo la primera answer de la oferta vigente (una 2ª — p.ej. dos guests
      // a la vez — dejaría el pc en estado inválido).
      if (pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(msg.answer).catch(() => { /* answer inválida */ });
        await candidates?.flush();
      }
    } else if (msg.ice) {
      await candidates?.add(msg.ice);
    }
  });

  return {
    setFair: (on: boolean) => {
      fairWanted = on;
      applyFair(pc?.connectionState === "connected");
    },
    stop: () => {
      stopped = true;
      window.clearInterval(loopTimer);
      teardownPeer();
      sig.close();
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

  const dbg: Record<string, unknown> = { dcFired: false, dcOpen: false, keydown: 0, sent: 0 };
  if (DEBUG_HOOKS) (window as unknown as { __n64dbg?: Record<string, unknown> }).__n64dbg = dbg;
  let currentMap: KeyboardMap = opts.keyboard ?? DEFAULT_KEYBOARD_P1;
  let detach = () => {};
  let dc: RTCDataChannel | null = null;
  let pc: RTCPeerConnection | null = null;
  let candidates: RemoteCandidates | null = null;
  let stopRtt: (() => void) | null = null;
  let answered = false;
  let stopped = false;

  // El canal de input es no-confiable/sin-orden (baja latencia). Para que un
  // paquete perdido o reordenado no deje un input "pegado" en el host:
  //   - cada mensaje lleva un nº de secuencia (8 bytes: [inputPack, seq]);
  //     el host descarta los que llegan viejos.
  //   - un keepalive reenvía el estado ACTUAL cada 100 ms aunque no cambie, así
  //     un keyup perdido se corrige en ≤100 ms en vez de quedar pegado.
  let seq = 0;
  let lastSent: N64Input = EMPTY_INPUT;
  const rawSendInput = (input: N64Input) => {
    if (dc && dc.readyState === "open") {
      try {
        dc.send(new Int32Array([packInput(input), (seq = (seq + 1) | 0)]).buffer);
        dbg.sent = (dbg.sent as number) + 1;
      } catch { /* el canal se cerró entre el check y el send */ }
    }
  };
  const sendInput = (input: N64Input) => {
    lastSent = input;
    dbg.keydown = (dbg.keydown as number) + 1;
    status.inputMsgs++;
    emit();
    rawSendInput(input);
  };
  const keepAlive = window.setInterval(() => rawSendInput(lastSent), 100);
  const reattach = (map: KeyboardMap) => {
    currentMap = map;
    detach();
    detach = attachKeyboard(map, sendInput);
  };

  // Errores FATALES de señalización (sala llena, servidor inalcanzable tras
  // reintentos): cortan el loop de join para que el mensaje no sea pisado por
  // el "buscando la sala…" del reintento.
  let fatalSignal = false;
  const sig = createSignaling(opts.room, "guest");
  sig.onError = (info) => {
    fatalSignal = true;
    window.clearInterval(joinTimer);
    status.connection = info;
    status.phase = "error";
    emit();
  };

  // Anuncia "join" y reintenta hasta recibir la oferta. Cubre unirse ANTES de
  // que el host esté listo, DESPUÉS de que ya haya ofertado, y el re-join tras
  // una caída. Tras ~8 s sin respuesta, casi seguro no hay host: avisar.
  let joinTimer = 0;
  const startJoining = () => {
    window.clearInterval(joinTimer);
    if (fatalSignal) return;
    let tries = 0;
    sig.send({ join: true });
    joinTimer = window.setInterval(() => {
      if (answered || stopped || fatalSignal) { window.clearInterval(joinTimer); return; }
      tries++;
      if (tries < 8) {
        status.connection = "buscando la sala del host…";
        status.phase = "connecting";
      } else if (tries < 60) {
        status.connection = "no encuentro una sala con ese código. ¿El host ya creó la sala y cargó su ROM?";
        status.phase = "error";
      } else {
        // Tras 1 minuto, dejar de insistir (no spamear la señalización).
        status.connection = "no encuentro esa sala. Verificá el código con el host y recargá para reintentar.";
        status.phase = "error";
        window.clearInterval(joinTimer);
      }
      emit();
      sig.send({ join: true });
    }, 1000);
  };

  // Crea una sesión WebRTC nueva (la primera, o una limpia tras una caída).
  const newPeer = async () => {
    stopRtt?.(); stopRtt = null;
    try { pc?.close(); } catch { /* ya cerrado */ }
    pc = null;
    answered = false;
    dc = null;
    // TURN (si está configurado) se pide por sesión: credenciales efímeras.
    const rtcConfig = await iceConfig();
    if (stopped) return;
    pc = new RTCPeerConnection(rtcConfig);
    const thisPc = pc;
    candidates = new RemoteCandidates(pc);
    if (DEBUG_HOOKS) (window as unknown as { __n64guestPc?: RTCPeerConnection }).__n64guestPc = pc;

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
    pc.ondatachannel = (e) => {
      dc = e.channel;
      dc.binaryType = "arraybuffer";
      dbg.dcFired = true;
      dc.onopen = () => (dbg.dcOpen = true);
      reattach(currentMap);
    };
    pc.onicecandidate = (e) => e.candidate && sig.send({ ice: e.candidate.toJSON() });
    watchConnection(pc, {
      onState: (st) => {
        if (pc !== thisPc) return;
        if (st === "connected") {
          status.connection = "conectado ✓ (el juego tarda ~10-15s en aparecer)";
          status.phase = "connected";
        } else if (st === "disconnected") {
          status.connection = "conexión inestable — esperando que vuelva…";
        } else if (st !== "failed" && st !== "closed") {
          status.connection = st;
        }
        emit();
      },
      onLost: () => {
        if (pc !== thisPc || stopped) return;
        // Reintento automático: sesión limpia + re-join (el host acepta un join
        // nuevo cuando su sesión anterior también cayó).
        status.connection = "se perdió la conexión — reintentando…";
        status.phase = "connecting";
        status.rttMs = null;
        status.videoReady = false;
        emit();
        void newPeer().then(() => startJoining());
      },
    });
    stopRtt = pollRtt(pc, (ms) => { status.rttMs = ms; emit(); });
  };

  // Cerrar la pestaña con la partida andando deja al host colgado: confirmar.
  // (Solo el guest: el host usa recargas propias para cerrar/limpiar la sala.)
  const warnUnload = (e: BeforeUnloadEvent) => { if (status.phase === "connected") e.preventDefault(); };
  window.addEventListener("beforeunload", warnUnload);

  // Serializado: procesa un mensaje por vez (evita addIceCandidate durante un
  // setRemoteDescription pendiente, que perdía candidatos en silencio).
  sig.onMessage = serializeMessages(async (msg) => {
    if (!pc || stopped) return;
    if (msg.offer && !answered) {
      answered = true;
      status.connection = "oferta recibida — respondiendo…";
      emit();
      await pc.setRemoteDescription(msg.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sig.send({ answer });
      await candidates?.flush();
    } else if (msg.ice) {
      await candidates?.add(msg.ice);
    }
  });

  await newPeer();
  startJoining();

  return {
    stop: () => {
      stopped = true;
      window.removeEventListener("beforeunload", warnUnload);
      window.clearInterval(joinTimer);
      window.clearInterval(keepAlive);
      stopRtt?.();
      detach();
      try { pc?.close(); } catch { /* ya cerrado */ }
      sig.close();
    },
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
