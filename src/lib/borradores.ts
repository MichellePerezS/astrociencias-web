// Borradores del editor propio, guardados en Netlify Blobs.
//
// Tienda «editor-borradores»: una entrada JSON por borrador, con su id como clave.
// Tienda «editor-imagenes»:   «<id del borrador>/<id de la imagen>.<ext>».
//
// Permisos (se comprueban siempre aquí, en el servidor):
//   editor → ve todos los borradores.
//   autor  → solo los que ha creado él (propietario.id = su id de Identity).
// Quién puede editar o cambiar el estado depende del flujo de revisión
// (src/lib/flujo.ts).

import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";
import { AREAS } from "../content/areas";
import {
  estadoDe,
  estadoTras,
  limpiarComentario,
  puedeAplicar,
  puedeEditar,
  type Accion,
  type EstadoBorrador,
  type EventoRevision,
} from "./flujo";
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
  /** Estado en el flujo de revisión (los borradores anteriores a la fase 3 no lo tienen). */
  estado: EstadoBorrador;
  /** Envíos, aprobaciones y devoluciones, del más antiguo al más reciente. */
  historial: EventoRevision[];
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
  if (!esIdValido(id)) return noEncontrado(id, "id no válido");
  const tienda = tiendaBorradores();
  const entrada = await tienda.getWithMetadata(id, { type: "json" });
  if (!entrada?.data) return noEncontrado(id, "no existe en la tienda");
  const etag = entrada.etag ?? (await etagEmulado(tienda, id));
  if (!etag) return noEncontrado(id, "Blobs no devolvió ETag");
  const borrador = normalizar(entrada.data as Borrador);
  if (!puedeAcceder(usuario, borrador)) {
    return noEncontrado(
      id,
      `sin permiso (rol ${usuario.rol}, usuario ${usuario.id}, propietario ${borrador.propietario.id})`,
    );
  }
  return { borrador, version: etag };
}

/** Completa los campos que no tienen los borradores guardados antes de la fase 3. */
function normalizar(borrador: Borrador): Borrador {
  return {
    ...borrador,
    estado: estadoDe(borrador.estado),
    historial: Array.isArray(borrador.historial) ? borrador.historial : [],
  };
}

/** Solo en `astro dev`: explica en la terminal por qué un borrador da 404. */
function noEncontrado(id: string, motivo: string): null {
  if (import.meta.env.DEV) console.warn(`[borradores] 404 para ${id}: ${motivo}`);
  return null;
}

/**
 * Solo en `astro dev`: el emulador local de Blobs no envía ETag al leer
 * (sí al escribir y al listar), así que se toma del listado. Es el mismo
 * ETag que el emulador compara en `onlyIfMatch`. En producción Blobs
 * siempre lo envía y, si faltara, el borrador no se considera válido.
 */
async function etagEmulado(tienda: ReturnType<typeof tiendaBorradores>, id: string) {
  if (!import.meta.env.DEV) return undefined;
  const { blobs } = await tienda.list({ prefix: id });
  return blobs.find((b) => b.key === id)?.etag || undefined;
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
    estado: "edicion",
    historial: [],
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
  | { ok: false; motivo: "no-encontrado" | "conflicto" | "demasiado-grande" | "bloqueado" };

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
  if (!puedeEditar(usuario, actual.borrador)) return { ok: false, motivo: "bloqueado" };

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
    .map(normalizar)
    .sort((a, b) => b.actualizado.localeCompare(a.actualizado));
}

export type ResultadoCambioEstado =
  | { ok: true; version: string; borrador: Borrador }
  | {
      ok: false;
      motivo: "no-encontrado" | "conflicto" | "no-permitido" | "incompleto" | "sin-comentario";
    };

/**
 * Aplica una acción del flujo de revisión (enviar, aprobar o devolver).
 * Comprueba el rol y el estado aquí, en el servidor, y solo escribe si la
 * versión que tenía el navegador sigue siendo la última.
 */
export async function cambiarEstado(
  usuario: Usuario,
  id: string,
  versionCliente: string,
  accion: Accion,
  comentarioCliente: unknown,
): Promise<ResultadoCambioEstado> {
  const actual = await leerBorrador(usuario, id);
  if (!actual) return { ok: false, motivo: "no-encontrado" };
  if (actual.version !== versionCliente) return { ok: false, motivo: "conflicto" };
  const previo = actual.borrador;
  if (!puedeAplicar(usuario, previo, accion)) return { ok: false, motivo: "no-permitido" };

  // Para revisar hace falta al menos título y texto.
  if (accion === "enviar" && (!previo.titulo.trim() || !textoPlano(previo.contenido, 1))) {
    return { ok: false, motivo: "incompleto" };
  }
  const comentario = limpiarComentario(comentarioCliente, LIMITES.comentario);
  if (accion === "devolver" && !comentario) return { ok: false, motivo: "sin-comentario" };

  const ahora = new Date().toISOString();
  const evento: EventoRevision = {
    accion,
    por: { id: usuario.id, nombre: usuario.nombre },
    fecha: ahora,
    ...(accion === "devolver" ? { comentario } : {}),
  };
  const borrador: Borrador = {
    ...previo,
    estado: estadoTras(accion),
    historial: [...previo.historial, evento],
    actualizado: ahora,
  };

  const r = await tiendaBorradores().setJSON(id, borrador, { onlyIfMatch: actual.version });
  if (!r.modified || !r.etag) return { ok: false, motivo: "conflicto" };
  return { ok: true, version: r.etag, borrador };
}
