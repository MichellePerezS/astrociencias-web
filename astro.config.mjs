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
  adapter: netlify(),
});
