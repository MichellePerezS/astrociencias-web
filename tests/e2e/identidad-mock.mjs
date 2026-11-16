// Sustituto local de Netlify Identity para las pruebas e2e.
// Solo responde a GET /user, que es lo que usa el servidor (src/lib/identidad.ts)
// para validar el token de la cookie `ace_sesion`.

import http from "node:http";

/**
 * Token de la cookie → usuario de Identity. Las pruebas pueden cambiar los
 * roles mientras se ejecutan (el servidor los consulta en cada petición).
 */
export const USUARIOS = {
  "token-autor": {
    id: "e2e-autor",
    email: "autora@example.com",
    user_metadata: { full_name: "Autora E2E" },
    app_metadata: { roles: ["autor", "autor:michelle-perez"] },
  },
  "token-editor": {
    id: "e2e-editor",
    email: "editora@example.com",
    user_metadata: { full_name: "Editora E2E" },
    app_metadata: { roles: ["editor"] },
  },
  // Autor cuyo rol apunta a una ficha que no existe en src/content/autores.
  "token-autor-ficha-mala": {
    id: "e2e-autor-ficha-mala",
    email: "otro@example.com",
    user_metadata: { full_name: "Autor Sin Ficha Real" },
    app_metadata: { roles: ["autor", "autor:no-existe"] },
  },
};

/** Arranca el sustituto en un puerto libre y devuelve su URL y cómo pararlo. */
export function arrancarIdentidad() {
  const servidor = http.createServer((req, res) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const usuario = req.url?.endsWith("/user") ? USUARIOS[token] : undefined;
    res.setHeader("content-type", "application/json");
    if (!usuario) {
      res.statusCode = 401;
      res.end("{}");
      return;
    }
    res.end(JSON.stringify(usuario));
  });
  return new Promise((resolver) => {
    servidor.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (servidor.address());
      resolver({
        url: `http://127.0.0.1:${port}/identity`,
        parar: () => new Promise((fin) => servidor.close(() => fin(undefined))),
      });
    });
  });
}
