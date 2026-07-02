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

import { createSignaling, type Signaling } from "../net/signaling";
import { Lockstep, type NetMsg } from "./lockstep";
import { Rollback } from "./rollback";
import { PongSim, type SimInput } from "./sim";

const ICE: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }],
};

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

  const pc = new RTCPeerConnection(ICE);
  const sig: Signaling = createSignaling(opts.room, opts.role === "create" ? "host" : "guest");
  sig.onError = (info) => { status.phase = "error"; status.connection = info; emit(); };

  let engine: Engine | null = null;
  let dc: RTCDataChannel | null = null;

  const rawSend = (m: NetMsg) => {
    if (dc?.readyState !== "open") return;
    const data = JSON.stringify(m);
    if (lat > 0) window.setTimeout(() => { if (dc?.readyState === "open") dc.send(data); }, lat);
    else dc.send(data);
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
    (window as unknown as { __v2?: Engine }).__v2 = engine; // hook de verificación
    status.phase = "connected";
    status.connection = "¡en partida!";
    emit();
  };

  const wire = (raw: string) => {
    let m: Wire;
    try { m = JSON.parse(raw) as Wire; } catch { return; }
    if (m.t === "seed") startEngine(m.seed);
    else engine?.receive(m);
  };

  const bindChannel = (channel: RTCDataChannel) => {
    dc = channel;
    dc.onmessage = (e) => wire(e.data as string);
    if (opts.role === "create") {
      dc.onopen = () => {
        const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
        dc!.send(JSON.stringify({ t: "seed", seed } satisfies SeedMsg));
        startEngine(seed);
      };
    }
  };

  pc.onicecandidate = (e) => e.candidate && sig.send({ ice: e.candidate.toJSON() });
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      status.phase = "error"; status.connection = "se perdió la conexión"; emit();
    }
  };

  const rttTimer = window.setInterval(async () => {
    if (pc.connectionState !== "connected") return;
    try {
      const s = await pc.getStats();
      s.forEach((r) => {
        if (r.type === "candidate-pair" && (r as any).nominated && (r as any).currentRoundTripTime != null) {
          status.rttMs = Math.round((r as any).currentRoundTripTime * 1000); emit();
        }
      });
    } catch { /* noop */ }
  }, 1500);

  if (opts.role === "create") {
    let started = false;
    sig.onMessage = async (msg) => {
      if (msg.join && !started) {
        started = true;
        bindChannel(pc.createDataChannel("game", { ordered: true }));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sig.send({ offer });
      } else if (msg.answer) {
        await pc.setRemoteDescription(msg.answer).catch(() => {});
      } else if (msg.ice) {
        await pc.addIceCandidate(msg.ice).catch(() => {});
      }
    };
  } else {
    pc.ondatachannel = (e) => bindChannel(e.channel);
    let answered = false;
    sig.onMessage = async (msg) => {
      if (msg.offer && !answered) {
        answered = true;
        await pc.setRemoteDescription(msg.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sig.send({ answer });
      } else if (msg.ice) {
        await pc.addIceCandidate(msg.ice).catch(() => {});
      }
    };
    sig.send({ join: true });
    const joinTimer = window.setInterval(() => {
      if (answered) { window.clearInterval(joinTimer); return; }
      sig.send({ join: true });
    }, 1000);
  }

  return {
    stop: () => {
      window.clearInterval(rttTimer);
      engine?.stop();
      try { dc?.close(); } catch { /* noop */ }
      pc.close();
      sig.close();
    },
  };
}
