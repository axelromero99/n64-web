// Transporte WebRTC SIMÉTRICO para la v2 (netcode justo).
//
// A diferencia del online v1 (host transmite video), acá NO hay asimetría: los
// dos peers corren la misma simulación y solo intercambian inputs por un
// datachannel confiable. El "creador" de la sala genera la SEMILLA compartida y
// la manda al unirse el otro → ambos arrancan la sim idéntica (fairness real).
//
// Netcode elegible: "rollback" (predice + corrige, oculta la latencia) o
// "lockstep" (espera al rival). Debug: ?lat=NN agrega latencia artificial a los
// envíos para sentir/probar el rollback.
//
// Si la conexión se cae, la partida TERMINA (no hay reconexión): recuperar una
// sim lockstep/rollback a mitad exigiría transferir el estado completo y
// re-sincronizar, y para la demo no vale la complejidad.

import { createSignaling, type Signaling } from "../net/signaling";
import { ICE_CONFIG, DEBUG_HOOKS, iceConfig, pollRtt, serializeMessages, RemoteCandidates, watchConnection } from "../net/rtc";
import { Lockstep, type NetMsg } from "./lockstep";
import { Rollback } from "./rollback";
import { PongSim, type SimInput } from "./sim";

export type Netcode = "rollback" | "lockstep";

export interface MatchStatus {
  phase: "connecting" | "connected" | "error";
  connection: string;
  youAre: 0 | 1;
  rttMs: number | null;
  netcode: Netcode;
  frame: number;
  desync: boolean;
  // lockstep
  stalled?: boolean;
  ahead?: number;
  // rollback
  confirmed?: number;
  predicting?: number;
  rollbacks?: number;
}

type SeedMsg = { t: "seed"; seed: number };
type Wire = NetMsg | SeedMsg;
type Engine = Lockstep | Rollback;

// Un mensaje real nuestro es JSON de ~30 bytes; cualquier cosa mucho más grande
// no es de este juego.
const MAX_WIRE_BYTES = 512;

export interface MatchHandle {
  stop: () => void;
}

export function startMatch(opts: {
  room: string;
  role: "create" | "join";
  netcode?: Netcode;
  canvas: HTMLCanvasElement;
  readInput: () => SimInput;
  onStatus?: (s: MatchStatus) => void;
}): MatchHandle {
  const netcode: Netcode = opts.netcode ?? "rollback";
  const youAre: 0 | 1 = opts.role === "create" ? 0 : 1;
  const lat = Math.max(0, Number(new URLSearchParams(location.search).get("lat")) || 0);
  const status: MatchStatus = {
    phase: "connecting", connection: "conectando…", youAre, rttMs: null, netcode,
    frame: 0, desync: false,
  };
  const emit = () => opts.onStatus?.({ ...status });
  emit();

  const pc = new RTCPeerConnection(ICE_CONFIG);
  // TURN (si el servidor lo tiene configurado) se suma en cuanto llega: acá la
  // negociación arranca recién con el join/offer, así que casi siempre llega
  // antes; si no, STUN alcanza para la gran mayoría de pares.
  void iceConfig().then((cfg) => {
    try { pc.setConfiguration(cfg); } catch { /* ya negociando: seguir con STUN */ }
  });
  const candidates = new RemoteCandidates(pc);
  const sig: Signaling = createSignaling(opts.room, opts.role === "create" ? "host" : "guest");
  sig.onError = (info) => { status.phase = "error"; status.connection = info; emit(); };

  let engine: Engine | null = null;
  let dc: RTCDataChannel | null = null;
  let joinTimer = 0;
  let stopped = false;

  const rawSend = (m: NetMsg) => {
    if (dc?.readyState !== "open") return;
    const data = JSON.stringify(m);
    try {
      if (lat > 0) window.setTimeout(() => { if (dc?.readyState === "open") dc.send(data); }, lat);
      else dc.send(data);
    } catch { /* el canal se cerró entre el check y el send */ }
  };

  const startEngine = (seed: number) => {
    if (engine) return;
    const newSim = () => new PongSim(seed);
    if (netcode === "rollback") {
      engine = new Rollback({
        newSim, youAre, send: rawSend, readInput: opts.readInput,
        onStatus: (r) => {
          status.frame = r.frame; status.confirmed = r.confirmed;
          status.predicting = r.predicting; status.rollbacks = r.rollbacks;
          status.desync = r.desync; emit();
        },
      });
    } else {
      engine = new Lockstep({
        sim: newSim(), youAre, send: rawSend, readInput: opts.readInput,
        onStatus: (ls) => {
          status.frame = ls.frame; status.stalled = ls.stalled;
          status.ahead = ls.ahead; status.desync = ls.desync; emit();
        },
      });
    }
    engine.start(opts.canvas);
    if (DEBUG_HOOKS) (window as unknown as { __v2?: Engine }).__v2 = engine; // hook de verificación
    status.phase = "connected";
    status.connection = "¡en partida!";
    emit();
  };

  // La partida termina: congelar la sim y avisar. (Sin reconexión: ver arriba.)
  const endMatch = (why: string) => {
    if (stopped) return;
    engine?.stop();
    status.phase = "error";
    status.connection = why;
    emit();
  };

  // Validar TODO lo que llega por el canal antes de dárselo al motor: un peer
  // hostil no debe poder inflar los buffers (frames absurdos) ni meter basura.
  const wire = (raw: unknown) => {
    if (typeof raw !== "string" || raw.length > MAX_WIRE_BYTES) return;
    let m: Wire;
    try { m = JSON.parse(raw) as Wire; } catch { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "seed") {
      if (typeof m.seed === "number" && Number.isFinite(m.seed)) startEngine(m.seed >>> 0);
    } else if (m.t === "in") {
      if (Number.isInteger(m.f) && m.f >= 0 && (m.p === -1 || m.p === 0 || m.p === 1)) engine?.receive(m);
    } else if (m.t === "hash") {
      if (Number.isInteger(m.f) && m.f >= 0 && typeof m.h === "number") engine?.receive(m);
    }
  };

  const bindChannel = (channel: RTCDataChannel) => {
    dc = channel;
    dc.onmessage = (e) => wire(e.data);
    dc.onclose = () => endMatch("se cortó el canal de juego — la partida terminó");
    if (opts.role === "create") {
      dc.onopen = () => {
        const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
        dc!.send(JSON.stringify({ t: "seed", seed } satisfies SeedMsg));
        startEngine(seed);
      };
    }
  };

  pc.onicecandidate = (e) => e.candidate && sig.send({ ice: e.candidate.toJSON() });
  watchConnection(pc, {
    onState: (st) => {
      if (st === "disconnected" && status.phase === "connected") {
        status.connection = "conexión inestable…"; emit();
      }
    },
    onLost: () => endMatch("se perdió la conexión con el rival — la partida terminó"),
  });

  const stopRtt = pollRtt(pc, (ms) => { status.rttMs = ms; emit(); });

  // Serializado: procesa un mensaje por vez (evita addIceCandidate durante un
  // setRemoteDescription pendiente, que perdía candidatos en silencio).
  if (opts.role === "create") {
    let started = false;
    sig.onMessage = serializeMessages(async (msg) => {
      if (msg.join && !started) {
        started = true;
        bindChannel(pc.createDataChannel("game", { ordered: true }));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sig.send({ offer });
      } else if (msg.answer && pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(msg.answer).catch(() => { /* answer inválida */ });
        await candidates.flush();
      } else if (msg.ice) {
        await candidates.add(msg.ice);
      }
    });
  } else {
    pc.ondatachannel = (e) => bindChannel(e.channel);
    let answered = false;
    sig.onMessage = serializeMessages(async (msg) => {
      if (msg.offer && !answered) {
        answered = true;
        await pc.setRemoteDescription(msg.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sig.send({ answer });
        await candidates.flush();
      } else if (msg.ice) {
        await candidates.add(msg.ice);
      }
    });
    // Reintentar el join hasta recibir la oferta; tras ~8 s sin señal, avisar
    // que probablemente no exista una partida con ese código.
    sig.send({ join: true });
    let tries = 0;
    joinTimer = window.setInterval(() => {
      if (answered || stopped) { window.clearInterval(joinTimer); return; }
      tries++;
      if (tries >= 60) {
        // Tras 1 minuto, dejar de insistir (no spamear la señalización).
        status.connection = "no encuentro esa partida. Verificá el código y recargá para reintentar.";
        status.phase = "error";
        emit();
        window.clearInterval(joinTimer);
        return;
      }
      if (tries >= 8 && status.phase === "connecting") {
        status.connection = "no encuentro una partida con ese código. ¿Tu rival ya la creó?";
        status.phase = "error";
        emit();
      }
      sig.send({ join: true });
    }, 1000);
  }

  return {
    stop: () => {
      stopped = true;
      window.clearInterval(joinTimer);
      stopRtt();
      engine?.stop();
      try { dc?.close(); } catch { /* noop */ }
      pc.close();
      sig.close();
    },
  };
}
