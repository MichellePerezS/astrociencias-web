// @ts-check
import fs from "node:fs";
import path from "node:path";
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
// y fallaba con ERR_REQUIRE_ESM (error 500 en /escribir).
// Se empaqueta sanitize-html con TODAS sus dependencias, no solo htmlparser2:
// si una queda fuera, su require() se hace en tiempo de ejecución, Netlify no
// la detecta al preparar la función, no la copia y falla con «Cannot find
// module». La lista se calcula desde los package.json para que siga siendo
// completa cuando sanitize-html cambie de dependencias.
// En `astro dev` no se aplica: Vite no puede ejecutar ese CommonJS empaquetado
// y Node ya lo admite.
function dependenciasDe(paquete) {
  const encontradas = new Set();
  const pendientes = [[paquete, process.cwd()]];
  while (pendientes.length) {
    const [nombre, desde] = /** @type {[string, string]} */ (pendientes.pop());
    // Como Node: primero node_modules anidados, luego los de los directorios padre.
    let dir = desde;
    let carpeta = null;
    while (!carpeta) {
      const candidata = path.join(dir, "node_modules", nombre);
      if (fs.existsSync(path.join(candidata, "package.json"))) carpeta = candidata;
      else if (path.dirname(dir) === dir) throw new Error(`No se encuentra ${nombre} (desde ${desde})`);
      else dir = path.dirname(dir);
    }
    if (encontradas.has(nombre)) continue;
    encontradas.add(nombre);
    const pkg = JSON.parse(fs.readFileSync(path.join(carpeta, "package.json"), "utf8"));
    for (const dep of Object.keys(pkg.dependencies ?? {})) pendientes.push([dep, carpeta]);
  }
  return [...encontradas];
}

/** @type {import("astro").AstroIntegration} */
const empaquetarSanitizeHtml = {
  name: "empaquetar-sanitize-html",
  hooks: {
    "astro:config:setup": ({ command, updateConfig }) => {
      if (command !== "build") return;
      updateConfig({ vite: { ssr: { noExternal: dependenciasDe("sanitize-html") } } });
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
