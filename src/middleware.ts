import { defineMiddleware } from "astro:middleware";
import { COOKIE_SESION, verificarToken } from "./lib/identidad";

// Zona privada del editor. /escribir/entrar es pública (inicio de sesión).
const PRIVADA = /^\/escribir(\/|$)/;
const PUBLICAS = /^\/escribir\/entrar\/?$/;

export const onRequest = defineMiddleware(async (contexto, siguiente) => {
  const { pathname, search } = contexto.url;

  if (!PRIVADA.test(pathname) || PUBLICAS.test(pathname) || contexto.isPrerendered) {
    return siguiente();
  }

  const token = contexto.cookies.get(COOKIE_SESION)?.value;
  const usuario = token ? await verificarToken(token) : null;

  if (!usuario) {
    // Sin sesión, caducada o sin rol: a entrar, que renueva el token si puede.
    const volver = encodeURIComponent(pathname + search);
    const motivo = token ? "&motivo=sesion" : "";
    return contexto.redirect(`/escribir/entrar?volver=${volver}${motivo}`, 302);
  }

  contexto.locals.usuario = usuario;
  const respuesta = await siguiente();
  respuesta.headers.set("Cache-Control", "private, no-store");
  respuesta.headers.set("X-Robots-Tag", "noindex");
  return respuesta;
});
