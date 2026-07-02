// Modo ONLINE COMPETITIVO con rollback (M4). AUN NO IMPLEMENTADO — es la pieza
// grande y está ACOTADA, no diseñada al aire. Ver docs/rollback-core.md.
//
// Por qué no está hecho todavía: el M0 (docs/M0-findings.md) midió con MK64 real
// que el savestate del core de fábrica pesa 16 MB / 8.5 ms → rollback inviable en
// el navegador. El rollback necesita un EmulatorCore propio (fork de N64Wasm en
// WASM) con frame-step + savestate reducido. Esa interfaz ya está en
// src/core/EmulatorCore.ts; este archivo fija cómo se le enchufa el netcode.
//
// Plan (una vez exista el core):
//   - Netcode: GekkoNet (el SDK que usó RMG-K, C++→WASM) o NetplayJS, con
//     transporte WebRTC. La librería aporta predicción/rollback; el core aporta
//     saveState/loadState/frameAdvance.
//   - Señalización: la misma pieza que el modo host-authoritative
//     (docs/signaling-cloudflare.md). STUN ya está; TURN de Cloudflare de respaldo.
//   - Detector de desync: stateHash() (ya escrito en EmulatorCore.ts).
//
// El bucle de rollback, en una frase: cada frame se envia el input local por el
// datachannel, se PREDICE el input remoto (normalmente = el del frame anterior),
// se simula hacia delante; cuando llega el input remoto real, si difiere de la
// prediccion se hace loadState() al ultimo estado confirmado y se re-simula.

import type { EmulatorCore } from "../core/EmulatorCore";
import type { N64Input } from "../input/n64";

export interface RollbackConfig {
  core: EmulatorCore;
  /** "P1" crea la sala, "P2" se une con el codigo. */
  role: "P1" | "P2";
  /** Codigo de sala compartido entre los dos jugadores. */
  roomCode: string;
  /** Callback para leer el input local de cada frame. */
  readLocalInput: () => N64Input;
}

export class RollbackSession {
  constructor(private readonly config: RollbackConfig) {
    void this.config; // (silencia "no usado" hasta implementar)
  }

  async connect(): Promise<void> {
    throw new Error(
      "Modo online: pendiente (M3). Ver el roadmap en README.md. " +
        "Requiere primero el spike de determinismo (M0) y el core N64Wasm.",
    );
  }
}
