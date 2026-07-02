/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL del servicio de señalización en producción (Worker de Cloudflare). */
  readonly VITE_SIGNALING_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
