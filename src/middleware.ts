import { defineMiddleware } from "astro:middleware";
import { COOKIE_SESION, verificarToken } from "./lib/identidad";

// Zona privada del editor. /escribir/entrar es pública (inicio de sesión).
const PAGINAS_PRIVADAS = /^\/escribir(\/|$)/;
const PAGINAS_PUBLICAS = /^\/escribir\/entrar\/?$/;
// API privada del editor (borradores e imágenes).
const API_PRIVADA = /^\/api\/(borradores|imagenes)(\/|$)/;

const LECTURA = new Set(["GET", "HEAD"]);

const json = (cuerpo: unknown, status: number) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const onRequest = defineMiddleware(async (contexto, siguiente) => {
  const { pathname, search, origin } = contexto.url;
  const esApi = API_PRIVADA.test(pathname);
  const esPagina = PAGINAS_PRIVADAS.test(pathname) && !PAGINAS_PUBLICAS.test(pathname);

  if ((!esApi && !esPagina) || contexto.isPrerendered) return siguiente();

  // Las escrituras solo se aceptan desde páginas de este sitio (protección CSRF).
  if (esApi && !LECTURA.has(contexto.request.method)) {
    if (contexto.request.headers.get("origin") !== origin) {
      return json({ error: "origen" }, 403);
    }
  }

  const token = contexto.cookies.get(COOKIE_SESION)?.value;
  const usuario = token ? await verificarToken(token) : null;

  if (!usuario) {
    if (esApi) return json({ error: "sesion" }, 401);
    // Sin sesión, caducada o sin rol: a entrar, que renueva el token si puede.
    const volver = encodeURIComponent(pathname + search);
    const motivo = token ? "&motivo=sesion" : "";
    return contexto.redirect(`/escribir/entrar?volver=${volver}${motivo}`, 302);
  }

  contexto.locals.usuario = usuario;
  const respuesta = await siguiente();
  if (!respuesta.headers.has("Cache-Control")) {
    respuesta.headers.set("Cache-Control", "private, no-store");
  }
  respuesta.headers.set("X-Robots-Tag", "noindex");
  return respuesta;
});
