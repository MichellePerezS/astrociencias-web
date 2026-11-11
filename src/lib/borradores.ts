// Borradores del editor propio, guardados en Netlify Blobs.
//
// Tienda «editor-borradores»: una entrada JSON por borrador, con su id como clave.
// Tienda «editor-imagenes»:   «<id del borrador>/<id de la imagen>.<ext>».
//
// Permisos (se comprueban siempre aquí, en el servidor):
//   editor → ve y edita todos los borradores.
//   autor  → solo los que ha creado él (propietario.id = su id de Identity).

import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";
import { AREAS } from "../content/areas";
import type { Usuario } from "./identidad";
import { esImagenDelBorrador, limpiarHtml, textoPlano } from "./limpiar-html";
import { LIMITES } from "./limites";

export interface Borrador {
  id: string;
  propietario: { id: string; nombre: string; correo: string };
  /** Ficha de autor (src/content/autores) del propietario, si es autor. */
  autor: string | null;
  titulo: string;
  resumen: string;
  area: (typeof AREAS)[number] | null;
  imagen: string | null;
  imagenAlt: string;
  /** HTML ya limpio. */
  contenido: string;
  creado: string;
  actualizado: string;
}

export interface BorradorConVersion {
  borrador: Borrador;
  /** ETag de Blobs: identifica la versión guardada (para no pisar cambios ajenos). */
  version: string;
}

export { LIMITES };

const ID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const tiendaBorradores = () => getStore({ name: "editor-borradores", consistency: "strong" });
export const tiendaImagenes = () => getStore({ name: "editor-imagenes", consistency: "strong" });

export function esIdValido(id: unknown): id is string {
  return typeof id === "string" && ID_VALIDO.test(id);
}

export function puedeAcceder(usuario: Usuario, borrador: Borrador): boolean {
  return usuario.rol === "editor" || borrador.propietario.id === usuario.id;
}

/**
 * Lee un borrador si el usuario tiene permiso. Si no existe o no es suyo
 * devuelve null en ambos casos, para no revelar qué borradores existen.
 */
export async function leerBorrador(usuario: Usuario, id: string): Promise<BorradorConVersion | null> {
  if (!esIdValido(id)) return null;
  const entrada = await tiendaBorradores().getWithMetadata(id, { type: "json" });
  if (!entrada?.data || !entrada.etag) return null;
  const borrador = entrada.data as Borrador;
  if (!puedeAcceder(usuario, borrador)) return null;
  return { borrador, version: entrada.etag };
}

export async function crearBorrador(usuario: Usuario): Promise<BorradorConVersion> {
  const ahora = new Date().toISOString();
  const borrador: Borrador = {
    id: randomUUID(),
    propietario: { id: usuario.id, nombre: usuario.nombre, correo: usuario.correo },
    autor: usuario.rol === "autor" ? usuario.autor : null,
    titulo: "",
    resumen: "",
    area: null,
    imagen: null,
    imagenAlt: "",
    contenido: "",
    creado: ahora,
    actualizado: ahora,
  };
  const r = await tiendaBorradores().setJSON(borrador.id, borrador, { onlyIfNew: true });
  if (!r.modified || !r.etag) throw new Error("No se pudo crear el borrador.");
  return { borrador, version: r.etag };
}

/** Lo que el navegador puede cambiar de un borrador. */
export interface CambiosBorrador {
  titulo?: unknown;
  resumen?: unknown;
  area?: unknown;
  imagen?: unknown;
  imagenAlt?: unknown;
  contenido?: unknown;
}

export type ResultadoGuardado =
  | { ok: true; version: string; borrador: Borrador }
  | { ok: false; motivo: "no-encontrado" | "conflicto" | "demasiado-grande" };

/**
 * Valida, limpia y guarda los cambios. Solo escribe si la versión que tenía
 * el navegador sigue siendo la última (si no, devuelve «conflicto»).
 */
export async function guardarBorrador(
  usuario: Usuario,
  id: string,
  versionCliente: string,
  cambios: CambiosBorrador,
): Promise<ResultadoGuardado> {
  const actual = await leerBorrador(usuario, id);
  if (!actual) return { ok: false, motivo: "no-encontrado" };
  if (actual.version !== versionCliente) return { ok: false, motivo: "conflicto" };

  if (typeof cambios.contenido === "string" && cambios.contenido.length > LIMITES.contenido) {
    return { ok: false, motivo: "demasiado-grande" };
  }

  const area = AREAS.find((a) => a === cambios.area) ?? null;
  const imagen =
    typeof cambios.imagen === "string" && esImagenDelBorrador(cambios.imagen, id) ? cambios.imagen : null;

  const borrador: Borrador = {
    ...actual.borrador,
    titulo: textoPlano(cambios.titulo, LIMITES.titulo),
    resumen: textoPlano(cambios.resumen, LIMITES.resumen),
    area,
    imagen,
    imagenAlt: imagen ? textoPlano(cambios.imagenAlt, LIMITES.imagenAlt) : "",
    contenido: typeof cambios.contenido === "string" ? limpiarHtml(cambios.contenido, id) : "",
    actualizado: new Date().toISOString(),
  };

  const r = await tiendaBorradores().setJSON(id, borrador, { onlyIfMatch: actual.version });
  if (!r.modified || !r.etag) return { ok: false, motivo: "conflicto" };
  return { ok: true, version: r.etag, borrador };
}

/** Borradores que el usuario puede ver, del más reciente al más antiguo. */
export async function listarBorradores(usuario: Usuario): Promise<Borrador[]> {
  const tienda = tiendaBorradores();
  const { blobs } = await tienda.list();
  const todos = await Promise.all(
    blobs.map((b) => tienda.get(b.key, { type: "json" }) as Promise<Borrador | null>),
  );
  return todos
    .filter((b): b is Borrador => !!b && puedeAcceder(usuario, b))
    .sort((a, b) => b.actualizado.localeCompare(a.actualizado));
}
