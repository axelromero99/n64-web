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
| 🌐 **Online 2P** | El host emula y transmite video por WebRTC; el invitado manda su input. **Modo justo** (input-delay) para que el host no tenga ventaja. | ✅ |

## Cómo funciona el online (y el modo justo)

El online de emuladores por streaming es **asimétrico** por naturaleza: el host
juega local sin lag y el invitado sufre la latencia de red + video → ventaja del
host. Acá eso se compensa con el **modo justo**: el host juega con sus inputs
retrasados exactamente la latencia que sufre el invitado (medida en vivo por
RTT), así **ninguno reacciona antes que el otro**. La latencia de video del
invitado no desaparece (es inherente al streaming), pero la ventaja de reacción
sí.

Todo el tráfico del juego es **P2P** (WebRTC) — video del host al invitado,
inputs del invitado al host (4 bytes por cambio). El servidor solo presenta a
los dos peers y no ve nada del juego.

## Arquitectura

```
Frontend (TypeScript + Vite, sin framework)
├─ core/emulatorjs.ts   Core N64 (EmulatorJS, versión fijada) para local + host online
├─ net/                 Online (streaming host-authoritative)
│  ├─ signaling.ts        WebSocket con reconexión (dev: plugin Vite · prod: Durable Object)
│  ├─ rtc.ts              utilidades WebRTC (ICE/TURN, RTT, razas de señalización)
│  └─ online.ts           WebRTC: video (host→guest) + input (guest→host) + modo justo
├─ input/n64.ts         modelo del mando + presets de teclado compartidos
└─ ui/                  pantallas, componentes, controles

Señalización: worker/signaling.js — Cloudflare Worker + Durable Object, con
límites anti-abuso (2 por sala, tamaño/cantidad de mensajes, Origin).
Detalle: docs/signaling-cloudflare.md
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

Todo lo marcado ✅ está probado de forma automatizada, no a mano. Con el dev
server corriendo (`npm run dev`):

```bash
npm run verify:quick   # sin ROM: UI y casos de fallo (~1 min)
npm run verify:all     # todo, incluye los flujos con la ROM real (~10 min)
```

| Script (`npm run …`) | Qué prueba |
|--------|-----------|
| `verify:ui` | UI + accesibilidad: cards con teclado, modal, autofocus, navegación |
| `verify:badcode` | caso de fallo: código de sala inexistente avisa claro |
| `verify:online` | e2e: invite link, conexión, video, input, modo justo, sala llena |
| `verify:controls` | esquema de controles unificado host + guest |
| `verify:fair` | modo justo: input del host aplicado con delay |
| `verify:disconnect` | el guest se cae: input de P2 reseteado, re-join a la misma sala |
| `verify:worker` | límites del Durable Object contra `wrangler dev` (workerd real) |
| `verify:prod` | el sitio DESPLEGADO: COOP/COEP, conexión, video en vivo |

Todos devuelven exit code ≠ 0 si algo falla (sirven para CI).

## Notas

- **Legalidad**: el emulador es legal; las ROMs no se distribuyen. Cada quien carga
  la suya y se queda en su navegador.
- **Stack**: TypeScript + Vite, WebAssembly (EmulatorJS/mupen64plus_next), WebRTC,
  Cloudflare Workers + Durable Objects. Sin framework de UI.

## Licencia

MIT — ver [`LICENSE`](./LICENSE).
