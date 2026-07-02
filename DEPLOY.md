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
ver la sección siguiente. No hace falta para empezar.

---

## TURN opcional (si a alguien "no le conecta nunca")

La conexión del juego es directa entre los dos navegadores (P2P). En un ~5-10 %
de los casos (routers muy restrictivos, redes de empresa, algún 4G) la conexión
directa es imposible y hace falta un **relay** (TURN). **El código ya está
listo**: solo hay que darle las credenciales. Sin ellas, todo funciona igual
que siempre (solo STUN).

1. En el dashboard de Cloudflare: **Realtime → TURN Server → Create**.
   Te da un **Turn Token ID** y un **API Token**.
2. En la carpeta del proyecto, cargá los dos secretos (una sola vez):

   ```bash
   npx wrangler secret put TURN_KEY_ID      # pegá el Turn Token ID
   npx wrangler secret put TURN_API_TOKEN   # pegá el API Token
   ```

3. `npm run deploy` de nuevo. Listo.

Desde ahí, el cliente pide credenciales efímeras (10 min) a `/turn` al armar
cada conexión y las usa como respaldo. Si algún día borrás los secretos, vuelve
solo a STUN sin romper nada.
