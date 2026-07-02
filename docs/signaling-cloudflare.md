# Señalización (implementada): Worker + Durable Object, same-origin

El online hace el handshake WebRTC a través de un WebSocket de señalización en
`/signal?room=CODIGO`. La pieza es intercambiable
gracias a la interfaz `Signaling` de `src/net/signaling.ts`; hoy hay dos
implementaciones del servidor con **el mismo protocolo y los mismos límites**:

| Entorno | Quién sirve `/signal` | Archivo |
|---------|----------------------|---------|
| `npm run dev` | plugin de Vite, en proceso | `vite.config.ts` (`signalingServer`) |
| Producción | Worker de Cloudflare + Durable Object | `worker/signaling.js` |

Un solo Worker sirve el frontend (`dist/`, binding ASSETS) **y** la
señalización, así el cliente usa `/signal` same-origin sin configurar nada.
Deploy: `npm run deploy` desde la raíz (config en `wrangler.toml`).

## Cómo funciona

- Una **sala** = una instancia del Durable Object `SignalRoom`
  (`idFromName(código)` → mismo código, misma instancia).
- El DO **relayea** cada mensaje a los otros sockets de la sala. No interpreta
  el contenido: `join`/`offer`/`answer`/`ice` son cosa del cliente.
- Usa **WebSocket Hibernation**: las salas inactivas no se cobran → free tier.
- El cliente (`createWebSocketSignaling`) encola lo que se envía antes de que
  abra el socket, y ante un cierre inesperado **reconecta con backoff** (5
  intentos) antes de rendirse con un error claro.

## Límites anti-abuso (espejados en dev y prod)

| Límite | Valor | Respuesta |
|--------|-------|-----------|
| Código de sala | `^[A-Z0-9]{4,8}$` (se normaliza a mayúsculas) | HTTP 400 |
| Sockets por sala | 2 | close **4001** `room_full` → la UI dice "sala llena" |
| Tamaño de mensaje | 32 KB, solo texto (un SDP real pesa < 10 KB) | close 1009 |
| Mensajes por socket | 500 | close 1008 |
| Origin | mismo host del Worker (o localhost) | HTTP 403 |
| `/signal` sin Upgrade | — | HTTP 426 |

Verificación automatizada: `npm run verify:worker` (contra `npx wrangler dev`,
prueba 400/426/relay/4001/1009 contra el runtime real) y
`npm run verify:online` (incluye que el 3° que entra ve "sala llena" en la UI).

## STUN / TURN

- **STUN** (gratis): `stun:stun.cloudflare.com:3478` + Google como respaldo —
  en `src/net/rtc.ts` (`ICE_CONFIG`).
- **TURN** (respaldo para NAT difíciles, ~5-10 % de los pares): Cloudflare
  Realtime TURN, 1 TB/mes gratis. Ver la sección TURN de `DEPLOY.md` para
  activarlo (opcional; sin configurar, todo funciona solo con STUN).
