# 🚀 Desplegar gratis (3 pasos)

Todo se publica en **un solo lugar** (Cloudflare Workers): la web **y** el servidor
de señalización juntos. Gratis, sin tarjeta.

## Paso 1 — Cuenta de Cloudflare (una sola vez)

Si no tenés, creá una gratis en 👉 https://dash.cloudflare.com/sign-up
(email + contraseña, sin tarjeta).

## Paso 2 — Iniciar sesión desde la terminal (una sola vez)

En la carpeta del proyecto, corré:

```bash
npx wrangler login
```

Se abre el navegador → click en **"Allow"**. Listo, queda logueado.

## Paso 3 — Desplegar

```bash
npm run deploy
```

Esto compila y sube todo. Al terminar, wrangler te imprime la URL, algo como:

```
https://n64-web.TU-USUARIO.workers.dev
```

**Esa es tu página online.** 🎉 (La primera vez quizá te pida elegir un
subdominio `*.workers.dev` — aceptá, es gratis.)

---

## Cómo jugar con un amigo

1. Abrí tu URL → **Jugar Online** → **Crear una sala** → cargá tu ROM.
2. Click en **"Copiar link de invitación"**.
3. Mandale ese link a tu amigo (WhatsApp, Discord, lo que sea).
4. Tu amigo lo abre en **su** compu → se une solo → ¡a jugar!

> El link ya lleva el código de sala. Tu amigo no instala nada: abre y juega.

## Actualizar la página

Cada vez que cambies algo, `npm run deploy` de nuevo y ya está.

## ¿Es realmente gratis?

Sí. En el plan gratis de Cloudflare Workers entra todo esto:
- El hosting de la web (assets estáticos): gratis.
- La señalización (Durable Objects con SQLite): gratis.
- El tráfico del **juego** no pasa por el servidor (es P2P entre los navegadores),
  así que ni se cuenta.

Para NAT muy cerrados (raro), se puede sumar un TURN de Cloudflare (1 TB/mes gratis);
ver `docs/signaling-cloudflare.md`. No hace falta para empezar.
