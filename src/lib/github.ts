// Escritura en el repositorio de GitHub para publicar artículos (fase 4).
//
// Variables de entorno (solo en el servidor; nunca con el prefijo PUBLIC_):
//   ACE_GITHUB_TOKEN  token fine-grained con «Contents: Read and write» solo
//                     en este repositorio.
//   ACE_GITHUB_REPO   «propietario/repositorio».
//   ACE_GITHUB_RAMA   rama donde se publica (por defecto, main).
//   ACE_GITHUB_API    URL de la API (por defecto https://api.github.com; las
//                     pruebas e2e la apuntan a un sustituto local).
//
// Se leen de process.env al ejecutar, no de import.meta.env: Astro sustituye
// import.meta.env al compilar y el token acabaría escrito en el código generado.
// En `astro dev`, astro.config.mjs copia estas variables de .env a process.env.

import { createHash } from "node:crypto";

export interface ConfigGitHub {
  token: string;
  repo: string;
  rama: string;
  api: string;
}

/** Fallo al hablar con GitHub, con un motivo que la interfaz puede explicar. */
export class ErrorGitHub extends Error {
  constructor(
    readonly motivo: "config" | "token" | "permisos" | "github",
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export function configGitHub(): ConfigGitHub {
  const token = process.env.ACE_GITHUB_TOKEN?.trim();
  const repo = process.env.ACE_GITHUB_REPO?.trim();
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new ErrorGitHub("config", "Faltan ACE_GITHUB_TOKEN o ACE_GITHUB_REPO («propietario/repositorio»).");
  }
  return {
    token,
    repo,
    rama: process.env.ACE_GITHUB_RAMA?.trim() || "main",
    api: (process.env.ACE_GITHUB_API?.trim() || "https://api.github.com").replace(/\/$/, ""),
  };
}

async function peticion<T>(
  config: ConfigGitHub,
  metodo: string,
  ruta: string,
  cuerpo?: unknown,
): Promise<{ status: number; datos: T }> {
  let r: Response;
  try {
    r = await fetch(`${config.api}/repos/${config.repo}${ruta}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "astrociencias-web",
        ...(cuerpo ? { "Content-Type": "application/json" } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch (e) {
    throw new ErrorGitHub("github", `No se pudo conectar con GitHub: ${(e as Error).message}`);
  }
  const datos = (await r.json().catch(() => ({}))) as T;
  if (r.status === 401) throw new ErrorGitHub("token", "GitHub rechazó el token (caducado o no válido).");
  // GitHub responde 404 (no 403) cuando el token no tiene acceso al repositorio.
  if (r.status === 403 || (r.status === 404 && ruta.startsWith("/git/"))) {
    throw new ErrorGitHub(
      "permisos",
      `GitHub respondió ${r.status} a ${metodo} ${ruta}: el token no tiene acceso al repositorio o la rama no existe.`,
    );
  }
  return { status: r.status, datos };
}

/** SHA de Git de un archivo («blob <tamaño>\0<contenido>»), para compararlo sin descargarlo. */
export function shaBlob(contenido: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${contenido.byteLength}\0`)
    .update(contenido)
    .digest("hex");
}

/** SHA de Git del archivo en la rama, o null si no existe. */
export async function shaArchivo(config: ConfigGitHub, ruta: string): Promise<string | null> {
  const { status, datos } = await peticion<{ sha?: string; type?: string }>(
    config,
    "GET",
    `/contents/${ruta.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(config.rama)}`,
  );
  if (status === 404) return null;
  if (status !== 200 || !datos.sha) throw new ErrorGitHub("github", `GitHub respondió ${status} al leer ${ruta}.`);
  return datos.sha;
}

export interface ArchivoCommit {
  ruta: string;
  contenido: Uint8Array;
}

/**
 * Sube varios archivos en un solo commit a la rama configurada (Git Data API).
 * Si la rama avanza mientras tanto (otro commit), vuelve a empezar sobre la
 * nueva punta en vez de forzar, para no perder cambios de nadie.
 */
export async function commitArchivos(
  config: ConfigGitHub,
  archivos: ArchivoCommit[],
  mensaje: string,
): Promise<{ sha: string; url: string }> {
  const esperado = (status: number, ok: number, que: string) => {
    if (status !== ok) throw new ErrorGitHub("github", `GitHub respondió ${status} al ${que}.`);
  };

  // Los blobs no dependen de la punta de la rama: se suben una sola vez.
  const blobs = await Promise.all(
    archivos.map(async (a) => {
      const { status, datos } = await peticion<{ sha: string }>(config, "POST", "/git/blobs", {
        content: Buffer.from(a.contenido).toString("base64"),
        encoding: "base64",
      });
      esperado(status, 201, `subir ${a.ruta}`);
      return { path: a.ruta, mode: "100644", type: "blob", sha: datos.sha };
    }),
  );

  const ref = `/git/refs/heads/${config.rama}`;
  for (let intento = 0; intento < 3; intento++) {
    const punta = await peticion<{ object: { sha: string } }>(config, "GET", `/git/ref/heads/${config.rama}`);
    esperado(punta.status, 200, `leer la rama ${config.rama}`);
    const padre = punta.datos.object.sha;

    const commitPadre = await peticion<{ tree: { sha: string } }>(config, "GET", `/git/commits/${padre}`);
    esperado(commitPadre.status, 200, "leer el último commit");

    const arbol = await peticion<{ sha: string }>(config, "POST", "/git/trees", {
      base_tree: commitPadre.datos.tree.sha,
      tree: blobs,
    });
    esperado(arbol.status, 201, "crear el árbol");

    const commit = await peticion<{ sha: string; html_url: string }>(config, "POST", "/git/commits", {
      message: mensaje,
      tree: arbol.datos.sha,
      parents: [padre],
    });
    esperado(commit.status, 201, "crear el commit");

    const mover = await peticion(config, "PATCH", ref, { sha: commit.datos.sha, force: false });
    if (mover.status === 200) return { sha: commit.datos.sha, url: commit.datos.html_url };
    // 422: la rama ya no apunta a «padre» (alguien ha publicado entre medias).
    if (mover.status !== 422 && mover.status !== 409) esperado(mover.status, 200, `actualizar la rama ${config.rama}`);
  }
  throw new ErrorGitHub("github", `La rama ${config.rama} cambió varias veces seguidas; inténtalo de nuevo.`);
}
