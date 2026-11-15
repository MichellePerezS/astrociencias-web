// Ejecuta las pruebas e2e: `npm run test:e2e`.
//
// 1. Arranca el sustituto de Netlify Identity (identidad-mock.mjs) con dos
//    cuentas de prueba: una autora y una editora.
// 2. Arranca `astro dev --background` con IDENTITY_URL apuntando a ese
//    sustituto (una variable del proceso tiene prioridad sobre .env).
// 3. Ejecuta la prueba del flujo de revisión en Chrome y, al acabar, para el
//    servidor con `astro dev stop` y el sustituto.
//
// Astro solo admite un servidor de desarrollo a la vez: si ya hay uno en
// marcha, la prueba no empieza (páralo con `npx astro dev stop`). Así el
// `astro dev stop` final solo puede parar el servidor de la prueba.
// Los Blobs locales (.netlify/blobs-serve) se copian antes y se restauran
// después, para que los borradores de prueba no se queden en tus listas.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { arrancarIdentidad } from "./identidad-mock.mjs";
import { probarFlujoRevision } from "./flujo-revision.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ASTRO = path.join(RAIZ, "node_modules", ".bin", "astro");
const BLOBS = path.join(RAIZ, ".netlify", "blobs-serve");
const PUERTO = 4329;

const astro = (args, env = process.env) =>
  promisify(execFile)(ASTRO, args, { cwd: RAIZ, env }).then(
    (r) => r.stdout + r.stderr,
    (e) => `${e.stdout ?? ""}${e.stderr ?? ""}${e.message}`,
  );

const estado = await astro(["dev", "status"]);
// «Dev server running at …» si hay uno; «No dev server is running.» si no.
if (/Dev server running at/i.test(estado)) {
  console.error(
    "Ya hay un servidor de desarrollo en marcha. Páralo con `npx astro dev stop` y vuelve a ejecutar la prueba.",
  );
  process.exit(1);
}

const copiaBlobs = fs.existsSync(BLOBS) ? fs.mkdtempSync(path.join(os.tmpdir(), "ace-e2e-blobs-")) : null;
if (copiaBlobs) fs.cpSync(BLOBS, copiaBlobs, { recursive: true });

const identidad = await arrancarIdentidad();
let arrancado = false;
let fallos = 1;

try {
  const salida = await astro(["dev", "--background", "--host", "127.0.0.1", "--port", String(PUERTO)], {
    ...process.env,
    IDENTITY_URL: identidad.url,
  });
  const m = /Dev server running at (http:\/\/[^\s"\\]+)/.exec(salida);
  if (!m) throw new Error(`astro dev no arrancó:\n${salida}`);
  arrancado = true;
  const base = m[1].replace(/\/$/, "");
  await esperarServidor(base);
  console.log(`astro dev en ${base}, Identity simulada en ${identidad.url}\n`);
  fallos = await probarFlujoRevision(base);
} catch (e) {
  console.error("FALLO ", e instanceof Error ? e.message : e);
} finally {
  if (arrancado) await astro(["dev", "stop"]);
  await identidad.parar();
  if (copiaBlobs) {
    fs.rmSync(BLOBS, { recursive: true, force: true });
    fs.cpSync(copiaBlobs, BLOBS, { recursive: true });
    fs.rmSync(copiaBlobs, { recursive: true, force: true });
  }
}

process.exit(fallos ? 1 : 0);

/** Espera a que el servidor responda (la primera carga compila la página). */
async function esperarServidor(base) {
  for (let i = 0; i < 60; i++) {
    if (await fetch(base).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`astro dev no responde en ${base}`);
}
