# N64 Web 🎮

**Nintendo 64 en el navegador**, con multijugador **local** y **online**, desplegado
gratis en Cloudflare. Sin instalar nada: entrás, cargás tu ROM y jugás — solo, con
alguien en el mismo sillón, o con alguien al otro lado del mundo.

**🔗 En vivo:** https://n64-web.axelromero99.workers.dev

> Cada jugador carga **su propia ROM** desde su disco. Nunca se sube a ningún
> servidor: se queda en tu navegador.

---

## Modos

| Modo | Qué es | Estado |
|------|--------|--------|
| 🛋️ **Local (2-4)** | N64 real en una PC, varios mandos. Sin latencia, perfectamente justo. | ✅ |
| 🌐 **Online 2P (casual)** | El host emula y transmite video por WebRTC; el invitado manda su input. **Modo justo** (input-delay) para que el host no tenga ventaja. | ✅ |
| 🧪 **Netcode justo (v2)** | Demo del online *competitivo*: **lockstep** y **rollback** deterministas — ambos corren la misma sim e intercambian solo inputs (cero ventaja). Juego de prueba: Pong. | ✅ (demo) |
| 🕹️ Online competitivo con N64 real | El netcode justo (v2) manejando N64. Requiere un core N64 determinista propio en WASM. | 🔭 futuro (otro repo) |

## Lo interesante (por qué existe)

El online "fácil" de emuladores (host transmite video) es **asimétrico**: el host
juega local sin lag y el invitado sufre latencia → ventaja del host. Este proyecto
lo aborda en capas honestas:

1. **Streaming + modo justo** — para casual. El *modo justo* iguala el timing de
   input (retrasa los inputs del host la latencia del invitado), quitando la
   ventaja de reacción. No borra la latencia de video (inherente al streaming).
2. **Netcode determinista (v2)** — para competitivo. Ambos peers corren la **misma
   simulación desde la misma semilla** e intercambian **solo inputs**:
   - **Lockstep**: espera los inputs de ambos → exacto, pero se traba con lag.
   - **Rollback**: **predice** el input remoto ausente y **corrige** re-simulando
     desde el último frame confirmado → fluido aun con lag. (La técnica de GGPO.)

   La propiedad de fairness está **verificada**: dos peers aislados, con inputs
   distintos y 80 ms de latencia, convergen a **hashes de estado idénticos** frame
   a frame. Nadie tiene ventaja.

## Arquitectura

```
Frontend (Cloudflare Pages/Worker, estático)
├─ core/emulatorjs.ts   Core N64 (EmulatorJS) para local + host online
├─ net/                 Online v1 (streaming host-authoritative)
│  ├─ signaling.ts        WebSocket (dev: plugin Vite · prod: Durable Object)
│  └─ online.ts           WebRTC: video (host→guest) + input (guest→host) + modo justo
├─ v2/                  Online v2 (netcode determinista, demo)
│  ├─ sim.ts              interfaz Simulation + Pong (matemática entera = determinista)
│  ├─ lockstep.ts         motor lockstep
│  ├─ rollback.ts         motor rollback (predicción + corrección)
│  └─ peer.ts             transporte WebRTC simétrico (solo inputs + semilla)
└─ ui/                  pantallas, componentes, controles

Señalización: worker/signaling.js  (Cloudflare Worker + Durable Object)
```

Todo el juego online es **P2P** (WebRTC): el servidor solo hace el "apretón de
manos". Por eso escala barato y entra en el free tier.

## Controles (teclado, unificados para ambos jugadores)

`← ↑ ↓ →` volante · `X` acelerar · `Z` frenar · `Espacio` derrape · `C` = Z (gatillo)
· `A` = L · `Enter` Start · `I J K L` = botones C. Los mandos USB se detectan solos.

## Correr en local

```bash
npm install
npm run dev        # http://localhost:5173 (incluye el servidor de señalización)
npm run build      # typecheck + bundle de producción
```

Probar el online en una PC: abrí dos pestañas (o una normal + una incógnito),
una crea la sala y la otra abre el link de invitación.

## Desplegar (gratis, un comando)

Un solo Worker de Cloudflare sirve el frontend **y** la señalización:

```bash
npx wrangler login     # una vez
npm run deploy         # build + deploy
```

Detalle paso a paso en [`DEPLOY.md`](./DEPLOY.md).

## Verificación (Playwright, contra la ROM real)

Todo lo marcado ✅ está probado de forma automatizada, no a mano:

| Script | Qué prueba |
|--------|-----------|
| `scripts/m0-ejs.mjs` | M0: coste de savestate/loadstate/determinismo del core |
| `scripts/online-verify*.mjs` | online v1: conexión, input y video (incl. cross-contexto) |
| `scripts/verify-controls.mjs` | esquema de controles unificado host + guest |
| `scripts/verify-fair.mjs` | modo justo: input del host aplicado con delay |
| `scripts/verify-v2-fairness.mjs` | lockstep: hashes idénticos entre peers |
| `scripts/verify-rollback.mjs` | rollback bajo 80 ms: predice y converge a estado idéntico |

## Roadmap

- [x] Local 2-4 · Online streaming · Modo justo · Controles unificados
- [x] Netcode determinista v2 (lockstep + rollback), verificado
- [ ] **Core N64 determinista en WASM** — para que el netcode justo maneje N64 real.
  Ver [`docs/rollback-core.md`](./docs/rollback-core.md). Es la pieza grande y va en
  su propio repo/proyecto: forkear N64Wasm/mupen64plus, exponer `retro_run` (frame-
  step) + `retro_serialize`, forzar determinismo (CPU intérprete, RSP LLE).

## Notas

- **Legalidad**: el emulador es legal; las ROMs no se distribuyen. Cada quien carga
  la suya y se queda en su navegador.
- **Stack**: TypeScript + Vite, WebAssembly (EmulatorJS/mupen64plus_next), WebRTC,
  Cloudflare Workers + Durable Objects. Sin framework de UI.

## Licencia

MIT — ver [`LICENSE`](./LICENSE).
