# N64 Web 🎮

Emulador de **Nintendo 64 en el navegador** con multijugador **local (2-4)** y
**online 2 jugadores** (WebRTC). Pensado para desplegarse gratis en **Cloudflare**.

- Cada jugador carga **su propia ROM** desde su disco — nunca se sube a ningún servidor.
- Controles preconfigurados y reasignables (teclado y gamepad).
- Online por **link de invitación**: creás la sala, pasás el link, tu amigo se une.
- La partida online es **P2P** (WebRTC): el servidor solo hace de "presentador".
- Objetivo futuro: **rollback netcode** competitivo (ver `docs/rollback-core.md`).

---

## Estado actual

| Modo | Estado | Cómo funciona |
|------|--------|---------------|
| **Local (2-4 jugadores)** | ✅ Funciona | Core **EmulatorJS** (mupen64plus_next WASM). Verificado con MK64 real vía Playwright. |
| **Online 2 jugadores (host-authoritative)** | ✅ Funciona | Host emula y transmite video por WebRTC; guest manda input por datachannel. Verificado E2E. |
| **Online competitivo (rollback)** | 🔬 Acotado, futuro | Requiere core propio con savestate optimizado — ver `docs/rollback-core.md`. |

> **Por qué dos "online".** El M0 midió (con MK64 real) que el savestate del core de
> fábrica pesa **16 MB** y tarda **8.5 ms** → el rollback necesitaría ~1.9 GB de RAM
> de buffer: inviable. Así que el online que **funciona hoy** es host-authoritative
> (streaming de video + inputs), y el rollback competitivo queda como pieza futura
> bien delimitada (un core N64 propio en WASM). Detalle en `docs/M0-findings.md`.

## Cómo funciona el online (2 jugadores)

1. El **Host** crea una sala (carga su ROM) → obtiene un **código** y un **link de invitación**.
2. El **Guest** abre el link (o entra el código) → se conecta por **WebRTC**.
3. El host emula y **transmite el video**; el guest **manda su input** por un datachannel.
   Se muestra el **ping (RTT)** real de la conexión.

La **señalización** (el "apretón de manos" WebRTC) va por WebSocket:
- **En dev**: la sirve el propio `npm run dev` (plugin de Vite en `/signal`) — por eso
  funciona entre **incógnito y ventana normal** en la misma máquina, y entre pestañas.
- **En producción**: un **Worker + Durable Object de Cloudflare** (carpeta `worker/`),
  configurado con `VITE_SIGNALING_URL`. STUN de Cloudflare ya está puesto; para NAT
  difíciles se agrega TURN. Ver `docs/signaling-cloudflare.md`.

> La partida en sí es **P2P**: el servidor solo conecta a los dos jugadores, no procesa
> el juego. Por eso escala barato (cabe en el free tier de Cloudflare).

## Verificado con Playwright

Todo lo marcado ✅ está probado de forma automatizada contra la ROM real, no a mano:

- `scripts/m0-ejs.mjs` — mide savestate/loadstate/determinismo (M0).
- `scripts/online-verify.mjs` — 2 páginas host+guest: conecta, input y video fluyen.
- `scripts/online-verify-xcontext.mjs` — **2 contextos aislados (= incógnito vs normal)**:
  confirma que la señalización WebSocket conecta donde BroadcastChannel no podía.
- `scripts/ui-tour.mjs` — flujo completo con **link de invitación** + capturas de la UI.

---

## Correr en local (desarrollo)

```bash
npm install
npm run dev       # http://localhost:5173  (incluye el servidor de señalización)
```

- **Jugar Local**: **Cargar ROM** → a jugar. Controles reasignables desde el menú ⚙.
- **Jugar Online (probar en 1 PC)**: pestaña 1 → *Crear una sala* → cargá la ROM →
  copiá el link. Pestaña 2 (o incógnito) → pegá el link → *Unirse*. ¡Conectan!

```bash
npm run build     # genera dist/ (typecheck + bundle)
npm run preview   # sirve dist/ para probar el build
```

### Correr el spike M0 (decide si el online es viable)

`npm run dev` → abrí **http://localhost:5173/#m0** → **Cargar ROM** → entrá a una
partida → **Medir savestate/loadstate**. Reportá los números (p50 de save/load y
MB por estado): con eso se decide si seguir con rollback tal cual o con alcance
reducido (juegos livianos / delta-states).

## Desplegar (gratis en Cloudflare)

Son **dos piezas**: el frontend (Pages) y la señalización (Worker + Durable Object).

**1) Señalización** (para que el online funcione entre máquinas distintas):
```bash
cd worker
npx wrangler deploy          # te da una URL wss://n64-signaling.<tu>.workers.dev
```

**2) Frontend** (Cloudflare Pages):
1. Subí el repo a GitHub/GitLab.
2. Cloudflare Dashboard → **Pages** → **Connect to Git** → elegí el repo.
3. Build command: `npm run build` · Output directory: `dist`.
4. **Variable de entorno**: `VITE_SIGNALING_URL = wss://n64-signaling.<tu>.workers.dev/signal`
5. Deploy. El archivo `public/_headers` ya aplica las cabeceras COOP/COEP.

Alternativa por CLI: `npm run build && npx wrangler pages deploy dist`.

> Sin `VITE_SIGNALING_URL`, el online solo funciona en `npm run dev` (señalización
> same-origin). Para probar cross-máquina sin desplegar el Worker, podés pasar
> `?signal=wss://otro-servidor/signal` en la URL.

---

## Roadmap

- **M0 — Spike de determinismo/savestate** ✅ *(hecho — ver `docs/M0-findings.md`)*
  Medido con MK64 real: savestate 16 MB / 8.5 ms → rollback off-the-shelf inviable.
  Redirigió el diseño a online host-authoritative (que funciona) + core propio para
  el rollback (futuro). Harness en `src/m0/spike.ts` y `scripts/m0-ejs.mjs`.
- **M1 — Emu local en el navegador** ✅
  EmulatorJS + UI + carga de ROM + deploy en Cloudflare Pages.
- **M2 — Online 2 jugadores (host-authoritative)** ✅
  Host emula + transmite video (WebRTC captureStream); guest manda input por
  datachannel; `simulateInput` lo aplica como P2. Señalización local
  (BroadcastChannel) para probar en 1 PC. Verificado E2E con Playwright.
- **M3 — Online cross-máquina** *(cambio pequeño)*
  Reemplazar la señalización local por **Cloudflare Durable Object** (o broker
  PeerJS). STUN ya puesto; TURN de Cloudflare como respaldo. Ver
  `docs/signaling-cloudflare.md`. El resto del código no cambia.
- **M4 — Rollback competitivo** *(la pieza grande, acotada)*
  Core N64 propio en WASM con frame-step + savestate reducido + GekkoNet/NetplayJS.
  Detector de desync (`stateHash` ya escrito). Ver `docs/rollback-core.md`.
- **M5 — Pulido**
  Config de controles por jugador, lobby con códigos, reconexión, indicador de ping.

## Estructura

```
src/
  main.ts              # bootstrap + router de pantallas
  ui/                  # landing, selección de modo, pantalla de juego
  core/
    EmulatorCore.ts    # interfaz (la "costura" que habilita el rollback) + stateHash
    emulatorjs.ts      # core del M1 (modo local)
  input/
    n64.ts             # modelo del mando N64 + mapeos por defecto + (des)empaquetado
  net/
    signaling.ts       # interfaz Signaling + impl local (BroadcastChannel)
    online.ts          # modo online host-authoritative (WebRTC video + input) ✅
    rollback.ts        # seam del rollback competitivo (futuro, ver docs/rollback-core.md)
  m0/
    spike.ts           # harness M0 in-app: mide savestate/loadstate + determinismo
scripts/
  m0-ejs.mjs           # M0 automatizado (Playwright + ROM real)
  online-verify.mjs    # verificación E2E del online (host+guest en 2 páginas)
docs/
  M0-findings.md       # resultados medidos del M0
  rollback-core.md     # qué falta para el rollback competitivo
  signaling-cloudflare.md # cómo pasar a online cross-máquina
public/
  _headers             # COOP/COEP para Cloudflare Pages
  roms/                # vacía a propósito (las ROMs las carga el usuario)
```

## Notas técnicas

- **COOP/COEP**: se usa `Cross-Origin-Embedder-Policy: credentialless` (no
  `require-corp`) para habilitar `SharedArrayBuffer` sin romper la carga del core
  de EmulatorJS desde su CDN.
- **Online = 2 jugadores** con rollback (límite actual de la tecnología en N64, ver
  RMG-K/GekkoNet). 3-4 online sería posible con netcode *delay-based* (estilo
  gopher64), a cambio de latencia — quedaría como modo aparte.
- **Legalidad**: el emulador es legal; las ROMs no se distribuyen. Cada quien carga
  la suya y se queda en su navegador.
