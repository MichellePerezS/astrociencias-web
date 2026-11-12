// @ts-check
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import react from "@astrojs/react";
import keystatic from "@keystatic/astro";
import netlify from "@astrojs/netlify";

// Solo en `astro dev`: el navegador no puede llamar a la Identity del sitio
// publicado (otro origen, sin CORS). Este proxy la sirve en una ruta local,
// fuera de /.netlify/ para que la emulación de Netlify no la intercepte.
// En .env, PUBLIC_IDENTITY_URL=/identidad-dev; IDENTITY_URL sigue apuntando
// al sitio publicado (el servidor no tiene el problema de CORS).
// `server.proxy` no se usa al compilar, así que producción no cambia.
const RUTA_IDENTITY_DEV = "/identidad-dev";
const { IDENTITY_URL } = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
const identityRemota = IDENTITY_URL ? new URL(IDENTITY_URL) : null;

// Solo al compilar: sanitize-html es CommonJS y hace require() de htmlparser2,
// que solo es ESM. La función de Netlify no admite require() de un módulo ESM
// y fallaba con ERR_REQUIRE_ESM (error 500 en /escribir). Al empaquetar ambos,
// el require se convierte en un import al compilar. En `astro dev` no se
// aplica: Vite no puede ejecutar ese CommonJS empaquetado y Node ya lo admite.
/** @type {import("astro").AstroIntegration} */
const empaquetarSanitizeHtml = {
  name: "empaquetar-sanitize-html",
  hooks: {
    "astro:config:setup": ({ command, updateConfig }) => {
      if (command !== "build") return;
      updateConfig({ vite: { ssr: { noExternal: ["sanitize-html", "htmlparser2"] } } });
    },
  },
};

// https://astro.build/config
// Todas las páginas se generan estáticas; solo el panel de Keystatic
// (/keystatic y /api/keystatic) se ejecuta en una función de Netlify.
export default defineConfig({
  integrations: [react(), keystatic(), empaquetarSanitizeHtml],
  adapter: netlify({
    // Solo afecta a `astro dev`. No usamos Edge Functions y su emulación
    // descarga Deno, que falla. Blobs sigue emulado (no depende de esto).
    devFeatures: { edgeFunctions: false, images: true, environmentVariables: false },
  }),
  vite: {
    server: {
      proxy: identityRemota
        ? {
            [RUTA_IDENTITY_DEV]: {
              target: identityRemota.origin,
              changeOrigin: true,
              rewrite: (ruta) =>
                identityRemota.pathname.replace(/\/$/, "") + ruta.slice(RUTA_IDENTITY_DEV.length),
            },
          }
        : undefined,
    },
  },
});
