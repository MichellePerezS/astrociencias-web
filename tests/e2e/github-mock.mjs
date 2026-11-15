// Sustituto local de la API de GitHub para las pruebas e2e de la publicación.
// Guarda un repositorio en memoria (blobs, árboles, commits y una rama) y
// responde a lo que usa src/lib/github.ts:
//   GET   /repos/:repo/contents/:ruta?ref=:rama
//   POST  /repos/:repo/git/blobs | git/trees | git/commits
//   GET   /repos/:repo/git/ref/heads/:rama  y  git/commits/:sha
//   PATCH /repos/:repo/git/refs/heads/:rama   (solo avance rápido: si no, 422)
// Exige `Authorization: Bearer <token>`; con otro token responde 401.

import { createHash } from "node:crypto";
import http from "node:http";

const shaBlob = (bytes) =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const shaDe = (valor) => createHash("sha1").update(JSON.stringify(valor)).digest("hex");

export function arrancarGitHub({ token, repo, rama = "main" }) {
  const blobs = new Map(); // sha → Buffer
  const arboles = new Map(); // sha → Map(ruta → sha del blob)
  const commits = new Map(); // sha → { arbol, padre, mensaje }
  let punta = null;
  let pushesAjenos = 0;
  const peticiones = [];

  function guardarArbol(entradas) {
    const sha = shaDe([...entradas].sort());
    arboles.set(sha, new Map(entradas));
    return sha;
  }
  function crearCommit(arbol, padre, mensaje) {
    const sha = shaDe({ arbol, padre, mensaje, n: commits.size });
    commits.set(sha, { arbol, padre, mensaje });
    return sha;
  }
  /** Commit directo en la rama (como si alguien empujara desde fuera). */
  function commitDirecto(archivos, mensaje) {
    const entradas = new Map(punta ? arboles.get(commits.get(punta).arbol) : []);
    for (const [ruta, contenido] of Object.entries(archivos)) {
      const bytes = Buffer.from(contenido);
      blobs.set(shaBlob(bytes), bytes);
      entradas.set(ruta, shaBlob(bytes));
    }
    punta = crearCommit(guardarArbol(entradas), punta, mensaje);
  }
  commitDirecto({ "README.md": "# Repositorio de prueba\n" }, "Initial commit");

  const servidor = http.createServer(async (req, res) => {
    let cuerpo = "";
    for await (const trozo of req) cuerpo += trozo;
    const url = new URL(req.url, "http://x");
    peticiones.push({ metodo: req.method, ruta: url.pathname });
    const responder = (status, datos = {}) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(datos));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return responder(401, { message: "Bad credentials" });
    const prefijo = `/repos/${repo}`;
    if (!url.pathname.startsWith(prefijo + "/")) return responder(404, { message: "Not Found" });
    const ruta = url.pathname.slice(prefijo.length);
    const datos = cuerpo ? JSON.parse(cuerpo) : {};

    if (req.method === "GET" && ruta.startsWith("/contents/")) {
      if (url.searchParams.get("ref") !== rama) return responder(404, { message: "No commit found for the ref" });
      const archivo = decodeURIComponent(ruta.slice("/contents/".length));
      const sha = arboles.get(commits.get(punta).arbol).get(archivo);
      return sha ? responder(200, { type: "file", path: archivo, sha }) : responder(404, { message: "Not Found" });
    }
    if (req.method === "GET" && ruta === `/git/ref/heads/${rama}`) {
      return responder(200, { ref: `refs/heads/${rama}`, object: { sha: punta, type: "commit" } });
    }
    if (req.method === "GET" && ruta.startsWith("/git/commits/")) {
      const c = commits.get(ruta.slice("/git/commits/".length));
      return c ? responder(200, { tree: { sha: c.arbol } }) : responder(404, { message: "Not Found" });
    }
    if (req.method === "POST" && ruta === "/git/blobs") {
      const bytes = Buffer.from(datos.content, datos.encoding === "base64" ? "base64" : "utf8");
      blobs.set(shaBlob(bytes), bytes);
      return responder(201, { sha: shaBlob(bytes) });
    }
    if (req.method === "POST" && ruta === "/git/trees") {
      const base = arboles.get(datos.base_tree);
      if (!base) return responder(422, { message: "base_tree not found" });
      const entradas = new Map(base);
      for (const e of datos.tree) {
        if (!blobs.has(e.sha)) return responder(422, { message: `blob ${e.sha} not found` });
        entradas.set(e.path, e.sha);
      }
      return responder(201, { sha: guardarArbol(entradas) });
    }
    if (req.method === "POST" && ruta === "/git/commits") {
      if (!arboles.has(datos.tree) || datos.parents?.length !== 1) return responder(422, { message: "invalid" });
      const sha = crearCommit(datos.tree, datos.parents[0], datos.message);
      return responder(201, { sha, html_url: `https://github.com/${repo}/commit/${sha}` });
    }
    if (req.method === "PATCH" && ruta === `/git/refs/heads/${rama}`) {
      if (pushesAjenos > 0) {
        // Alguien empuja a la rama justo antes: este avance ya no es rápido.
        pushesAjenos--;
        commitDirecto({ "AJENO.md": `cambio ajeno ${Date.now()}\n` }, "Someone else's commit");
      }
      const c = commits.get(datos.sha);
      if (!c) return responder(422, { message: "Object does not exist" });
      if (c.padre !== punta && !datos.force) return responder(422, { message: "Update is not a fast forward" });
      punta = datos.sha;
      return responder(200, { ref: `refs/heads/${rama}`, object: { sha: punta } });
    }
    return responder(404, { message: "Not Found" });
  });

  return new Promise((resolver) => {
    servidor.listen(0, "127.0.0.1", () => {
      const { port } = servidor.address();
      resolver({
        url: `http://127.0.0.1:${port}`,
        token,
        repo,
        rama,
        peticiones,
        /** Contenido de un archivo en la punta de la rama (o undefined). */
        archivo(ruta) {
          const sha = arboles.get(commits.get(punta).arbol).get(ruta);
          return sha ? blobs.get(sha) : undefined;
        },
        /** Commits de la rama, del más reciente al más antiguo. */
        historial() {
          const lista = [];
          for (let sha = punta; sha; sha = commits.get(sha).padre) lista.push({ sha, ...commits.get(sha) });
          return lista;
        },
        commitDirecto,
        /** El próximo avance de la rama encontrará un commit ajeno (prueba el reintento). */
        simularPushAjeno() {
          pushesAjenos++;
        },
        parar: () => new Promise((fin) => servidor.close(() => fin(undefined))),
      });
    });
  });
}
