// Flujo de revisión de los borradores del editor propio (fase 3).
//
//   edicion ──enviar──▶ revision ──aprobar──▶ aprobado
//      ▲                   │  ▲                   │
//      │                devolver                devolver
//      │                   ▼  │                   │
//      └───────────── devuelto ◀──────────────────┘
//                         └──enviar──▶ revision
//
//   aprobado ──publicar──▶ publicado (final: el .md ya está en GitHub)
//
// Quién puede qué (se comprueba siempre en el servidor):
//   enviar   → solo quien creó el borrador, desde «edicion» o «devuelto».
//   aprobar  → solo editores, desde «revision».
//   devolver → solo editores, desde «revision» o «aprobado», con comentario.
//   publicar → solo editores, desde «aprobado» (src/lib/publicar.ts).
//   editar el contenido:
//     «edicion» y «devuelto» → el propietario y los editores;
//     «revision»             → solo editores;
//     «aprobado»             → nadie (hay que devolverlo antes);
//     «publicado»            → nadie (se cambia en el repositorio).
//
// Este módulo no depende de Blobs ni de Astro: solo reglas.

import type { Usuario } from "./identidad";

export const ESTADOS = ["edicion", "revision", "aprobado", "devuelto", "publicado"] as const;
export type EstadoBorrador = (typeof ESTADOS)[number];

export const ETIQUETAS_ESTADO: Record<EstadoBorrador, string> = {
  edicion: "En edición",
  revision: "En revisión",
  aprobado: "Aprobado",
  devuelto: "Devuelto",
  publicado: "Publicado",
};

export const ACCIONES = ["enviar", "aprobar", "devolver", "publicar"] as const;
export type Accion = (typeof ACCIONES)[number];

/**
 * Acciones que solo cambian el estado (POST /api/borradores/[id]/estado).
 * «publicar» no está: solo la aplica publicarBorrador, después de subir el
 * artículo a GitHub, para que nunca quede marcado como publicado sin estarlo.
 */
export const ACCIONES_ESTADO = ["enviar", "aprobar", "devolver"] as const;
export type AccionEstado = (typeof ACCIONES_ESTADO)[number];

/** Una entrada del historial de revisión. */
export interface EventoRevision {
  accion: Accion;
  por: { id: string; nombre: string };
  fecha: string;
  /** Solo al devolver. */
  comentario?: string;
}

/** Lo que las reglas necesitan saber de un borrador. */
export interface BorradorFlujo {
  propietario: { id: string };
  estado: EstadoBorrador;
}

const DESTINO: Record<Accion, EstadoBorrador> = {
  enviar: "revision",
  aprobar: "aprobado",
  devolver: "devuelto",
  publicar: "publicado",
};

export const esAccionEstado = (valor: unknown): valor is AccionEstado =>
  typeof valor === "string" && (ACCIONES_ESTADO as readonly string[]).includes(valor);

/** Estado de un borrador guardado antes de la fase 3 (sin campo «estado»). */
export const estadoDe = (valor: unknown): EstadoBorrador =>
  typeof valor === "string" && (ESTADOS as readonly string[]).includes(valor)
    ? (valor as EstadoBorrador)
    : "edicion";

export function esPropietario(usuario: Usuario, borrador: BorradorFlujo): boolean {
  return borrador.propietario.id === usuario.id;
}

/** ¿Puede cambiar el título, el texto o las imágenes en el estado actual? */
export function puedeEditar(usuario: Usuario, borrador: BorradorFlujo): boolean {
  const editor = usuario.rol === "editor";
  switch (borrador.estado) {
    case "edicion":
    case "devuelto":
      return editor || esPropietario(usuario, borrador);
    case "revision":
      return editor;
    case "aprobado":
    case "publicado":
      return false;
  }
}

/** ¿Puede aplicar esta acción al borrador en su estado actual? */
export function puedeAplicar(usuario: Usuario, borrador: BorradorFlujo, accion: Accion): boolean {
  const editor = usuario.rol === "editor";
  switch (accion) {
    case "enviar":
      return (
        esPropietario(usuario, borrador) &&
        (borrador.estado === "edicion" || borrador.estado === "devuelto")
      );
    case "aprobar":
      return editor && borrador.estado === "revision";
    case "devolver":
      return editor && (borrador.estado === "revision" || borrador.estado === "aprobado");
    case "publicar":
      return editor && borrador.estado === "aprobado";
  }
}

/** Acciones disponibles para mostrar los botones (el servidor vuelve a comprobarlas). */
export function accionesPermitidas(usuario: Usuario, borrador: BorradorFlujo): Accion[] {
  return ACCIONES.filter((a) => puedeAplicar(usuario, borrador, a));
}

export const estadoTras = (accion: Accion): EstadoBorrador => DESTINO[accion];

/** Último comentario de devolución, para mostrárselo al autor. */
export function ultimaDevolucion(historial: EventoRevision[]): EventoRevision | null {
  for (let i = historial.length - 1; i >= 0; i--) {
    if (historial[i].accion === "devolver") return historial[i];
  }
  return null;
}

/**
 * Comentario de devolución: texto plano con saltos de línea. No se pasa por
 * sanitize-html (convertiría «&» en «&amp;»); se muestra siempre como texto,
 * así que no puede inyectar HTML. Se quitan caracteres de control.
 */
export function limpiarComentario(valor: unknown, maximo: number): string {
  if (typeof valor !== "string") return "";
  return valor
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maximo);
}
