// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import keystatic from "@keystatic/astro";
import netlify from "@astrojs/netlify";

// https://astro.build/config
// Todas las páginas se generan estáticas; solo el panel de Keystatic
// (/keystatic y /api/keystatic) se ejecuta en una función de Netlify.
export default defineConfig({
  integrations: [react(), keystatic()],
  adapter: netlify({
    // Solo afecta a `astro dev`. No usamos Edge Functions y su emulación
    // descarga Deno, que falla. Blobs sigue emulado (no depende de esto).
    devFeatures: { edgeFunctions: false, images: true, environmentVariables: false },
  }),
});
