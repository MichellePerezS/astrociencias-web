/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Usuario con sesión en /escribir (lo pone src/middleware.ts). */
    usuario?: import("./lib/identidad").Usuario;
  }
}

interface ImportMetaEnv {
  /** URL de Netlify Identity para el navegador al trabajar con `astro dev`. */
  readonly PUBLIC_IDENTITY_URL?: string;
  /** Solo servidor: Identity del sitio publicado, para `astro dev`. */
  readonly IDENTITY_URL?: string;
}
