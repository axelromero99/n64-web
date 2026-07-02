# Rollback competitivo — el core propio (trabajo futuro acotado)

El M0 (ver `M0-findings.md`) demostró que el rollback necesita un savestate
**pequeño y rápido**, que el core de fábrica no da (16 MB / 8.5 ms). Este documento
acota exactamente qué falta. Es la pieza que convierte el proyecto de "bueno" a
"sobresaliente".

## Objetivo

Un `EmulatorCore` (interfaz ya definida en `src/core/EmulatorCore.ts`) que cumpla:

- `frameAdvance(inputs)` — avanzar **exactamente 1 frame** (frame-step), determinista.
- `saveState()` / `loadState()` — **< ~200 KB** y **< ~1 ms** (objetivo).
- Determinismo byte-a-byte: mismos inputs → mismo estado en ambos peers.

## Camino recomendado

1. **Base**: forkear **N64Wasm** (nbarkhina, MIT) — ya es el core ParaLLEl/mupen
   compilado a WASM vía Emscripten, y es el mismo linaje que RMG-K.
2. **Exponer frame-step**: reemplazar el bucle interno del core por una función que
   emule 1 frame por llamada (mupen64plus ya tiene el concepto de `main_run` por
   frame; se trata de exponerlo por `ccall`/`EMSCRIPTEN_KEEPALIVE`).
3. **Savestate reducido**: guardar solo RDRAM + registros CPU + estado del RCP
   (RSP/RDP), **sin** framebuffers ni caché del plugin gráfico. mupen64plus ya
   serializa esto para sus propios savestates; hay que exponerlo a memoria JS.
   Aplicar **delta-encoding** entre frames para el buffer de rollback.
4. **Determinismo**: fijar el plugin gráfico a uno determinista y desactivar
   optimizaciones no deterministas. Verificar con el `stateHash` (FNV) ya escrito:
   grabar una secuencia de inputs, correr 2 veces, comparar hashes por frame.
5. **Enganchar el netcode**: sobre este core, usar **GekkoNet** (C++ → WASM, el
   mismo SDK que usó RMG-K) con transporte **WebRTC** en vez de UDP; o **NetplayJS**
   si se serializa el estado desde JS. La lógica de predicción/rollback la aporta
   la librería; nosotros aportamos save/load/advance.

## Presupuesto a validar (M2)

En 16.6 ms el core debe: guardar 1 estado + (ante rollback) cargar + re-simular
hasta ~8 frames + renderizar 1. Es decir, emular 1 frame debe costar **< ~1.5 ms**
(el core debe correr ~10× tiempo real). N64Wasm en un PC medio ronda esto para
juegos livianos (MK64, Smash 64) — a validar con medición real, como en M0.

## Por qué es realista

RMG-K añadió rollback a N64 en 2026 apoyándose en GekkoNet y su autor lo resumió en
*"it was honestly not that hard"*. Lo nuevo aquí es hacerlo **en el navegador** —
nadie lo shippeó aún (ver el scan de mercado). El riesgo real no es el netcode
(resuelto por la librería) sino el **build de Emscripten con frame-step + savestate
reducido**, que es horas de trabajo de C/toolchain, no de diseño.
