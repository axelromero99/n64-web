# M0 — Hallazgos del spike (medidos, no teóricos)

Medido con **Playwright + Mario Kart 64 (E) (V1.1)** real, core **mupen64plus_next**
(EmulatorJS) en Chromium. Reproducible: `node scripts/m0-ejs.mjs` con el dev server
levantado.

## Números

| Métrica | Valor | Presupuesto 60fps (16.67 ms) |
|---|---|---|
| Tamaño del savestate | **16.02 MB** | — |
| `saveState` p50 | **8.5 ms** (avg 8.8, max 12.3) | 51 % del frame |
| `loadState` p50 | **2.8 ms** (avg 3.4, max 8.3) | 17 % del frame |
| Emulación avanza | sí (frames 718→878 en 0.4 s) | — |
| Determinismo (aprox.) | no concluyente por reloj | — |

## Veredicto

**Rollback con el core "de fábrica" = inviable.** Dos bloqueos duros:

1. **Memoria.** El savestate son 16 MB. Un buffer de rollback de ~120 frames (2 s)
   = **~1.9 GB de RAM**. Imposible en un navegador.
2. **CPU.** Guardar un estado por frame ya se come el **51 %** del presupuesto de
   16.6 ms, *antes* de emular y renderizar. El rollback además re-simula N frames
   tras cada fallo de predicción — no hay margen.

La causa raíz: ese savestate incluye framebuffers y estructuras del plugin gráfico.
Los emuladores con rollback real (**RMG-K/GekkoNet, gopher64**) usan un savestate
**mínimo y optimizado** (solo RDRAM + registros + estado del RCP, con delta-encoding)
que baja de ~16 MB a decenas/cientos de KB y de ms a microsegundos.

## Conclusión para el proyecto

- ✅ **Online host-authoritative (implementado)**: no necesita savestate por frame.
  El host emula y transmite video; el guest manda inputs. Funciona hoy. Bueno para
  co-op casual. Latencia = red + codificación de video.
- 🔬 **Rollback competitivo (trabajo futuro acotado)**: requiere un **core N64 propio
  compilado a WASM** con savestate reducido. Ver `docs/rollback-core.md`.

El M0 cumplió su objetivo: **evitó que construyéramos rollback sobre una base que no
lo aguanta**, y redirigió a una arquitectura que sí entrega online jugable ahora.
