import type { APIRoute } from "astro";
import {
  borrarSesion,
  guardarSesion,
  comprobarToken,
  segundosRestantes,
} from "../../lib/identidad";

export const prerender = false;

/** Rechaza peticiones que no vienen de páginas de este mismo sitio. */
function mismoOrigen(request: Request, url: URL): boolean {
  return request.headers.get("origin") === url.origin;
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// Recibe el token de Netlify Identity del navegador, lo valida y lo guarda
// en una cookie HttpOnly que leen las páginas de /escribir.
export const POST: APIRoute = async ({ request, url, cookies }) => {
  if (!mismoOrigen(request, url)) return json({ error: "origen" }, 403);

  let token: unknown;
  try {
    ({ token } = (await request.json()) as { token?: unknown });
  } catch {
    return json({ error: "peticion" }, 400);
  }
  if (typeof token !== "string" || !token) return json({ error: "peticion" }, 400);

  const r = await comprobarToken(token);
  if (!r.ok) {
    borrarSesion(cookies);
    // 403 solo para «sin rol»; token no válido → 401; Identity inaccesible → 502.
    const estado = { "sin-rol": 403, token: 401, identidad: 502 }[r.motivo];
    return json({ error: r.motivo }, estado);
  }

  guardarSesion(cookies, token, segundosRestantes(token));
  return json({ rol: r.usuario.rol });
};

// Cierra la sesión del servidor.
export const DELETE: APIRoute = async ({ request, url, cookies }) => {
  if (!mismoOrigen(request, url)) return json({ error: "origen" }, 403);
  borrarSesion(cookies);
  return json({ ok: true });
};
