// Sesión y roles del editor propio (/escribir), con Netlify Identity.
//
// Roles, en app_metadata.roles del usuario (solo los puede cambiar un
// administrador del sitio en Netlify, nunca el propio usuario):
//   "editor"          → ve y gestiona todos los artículos.
//   "autor"           → ve solo sus artículos...
//   "autor:<slug>"    → ...los que citan a src/content/autores/<slug>.yaml.
//
// Todo se comprueba aquí, en el servidor: el token del navegador se valida
// contra Netlify Identity en cada petición.

import type { AstroCookies } from "astro";

export const COOKIE_SESION = "ace_sesion";

export type Rol = "editor" | "autor";

export interface Usuario {
  id: string;
  correo: string;
  nombre: string;
  rol: Rol;
  /** Slug del autor en la colección «autores» (solo para el rol autor). */
  autor: string | null;
}

/** URL de la API de Netlify Identity del sitio. */
function urlIdentity(): string {
  // IDENTITY_URL permite apuntar a la Identity del sitio publicado desde `astro dev`.
  const explicita = process.env.IDENTITY_URL;
  if (explicita) return explicita.replace(/\/$/, "");
  // URL la define Netlify (en la compilación y en las funciones).
  const sitio = process.env.URL;
  if (sitio) return `${sitio.replace(/\/$/, "")}/.netlify/identity`;
  throw new Error(
    "No se conoce la URL de Netlify Identity: define IDENTITY_URL (p. ej. https://tusitio.netlify.app/.netlify/identity).",
  );
}

interface UsuarioIdentity {
  id: string;
  email: string;
  user_metadata?: { full_name?: string };
  app_metadata?: { roles?: unknown };
}

/** Convierte los roles de app_metadata en el rol de la aplicación. */
export function rolDesdeMetadatos(roles: unknown): { rol: Rol; autor: string | null } | null {
  const lista = Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [];
  if (lista.includes("editor")) return { rol: "editor", autor: null };
  if (lista.includes("autor")) {
    const vinculo = lista.find((r) => r.startsWith("autor:"));
    const slug = vinculo?.slice("autor:".length).trim() || null;
    return { rol: "autor", autor: slug };
  }
  return null;
}

/**
 * Valida el token con Netlify Identity (firma y caducidad las comprueba Identity)
 * y devuelve el usuario con su rol. Devuelve null si el token no vale o el
 * usuario no tiene ningún rol de la aplicación.
 */
export async function verificarToken(token: string): Promise<Usuario | null> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${urlIdentity()}/user`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    console.error("[identidad] No se pudo contactar con Netlify Identity:", error);
    return null;
  }
  if (!respuesta.ok) return null;

  const datos = (await respuesta.json()) as UsuarioIdentity;
  const permiso = rolDesdeMetadatos(datos.app_metadata?.roles);
  if (!permiso) return null;

  return {
    id: datos.id,
    correo: datos.email,
    nombre: datos.user_metadata?.full_name || datos.email,
    ...permiso,
  };
}

/** Segundos que le quedan al token (lee `exp` sin verificar; solo para la cookie). */
export function segundosRestantes(token: string): number {
  try {
    const carga = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { exp?: number };
    if (!carga.exp) return 0;
    return Math.max(0, carga.exp - Math.floor(Date.now() / 1000));
  } catch {
    return 0;
  }
}

export function guardarSesion(cookies: AstroCookies, token: string, maxAge: number) {
  cookies.set(COOKIE_SESION, token, {
    path: "/",
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: "lax",
    maxAge,
  });
}

export function borrarSesion(cookies: AstroCookies) {
  cookies.delete(COOKIE_SESION, { path: "/" });
}
