// Bloque «Destacado» de la portada: una sola pieza grande.
//
// Prioridad:
//   1. El próximo evento, cuando exista (`proximoEvento`, aún sin fuente).
//   2. Si no hay evento, el último artículo publicado del blog.
//
// La portada solo conoce el tipo `Destacado`: para añadir los eventos basta con
// implementar `proximoEvento` (y su conversión a `Destacado`), sin tocar el
// componente ni la página.
import { articulosPublicados, autorDe, fechaLarga, type Articulo } from "./blog";

export interface Destacado {
  tipo: "evento" | "articulo";
  /** Etiqueta corta sobre el título, p. ej. «Física y química». */
  categoria: string;
  /** Línea de metadatos en monoespaciada (fecha, autor, lugar…). */
  meta: string[];
  titulo: string;
  resumen: string;
  imagen?: string | null;
  imagenAlt?: string | null;
  boton: { texto: string; enlace: string };
  /** Si es un artículo, su id: «Últimos artículos» lo excluye. */
  articuloId?: string;
}

/**
 * Próximo evento para destacar. De momento no hay colección de eventos, así que
 * devuelve null. Cuando la haya, debe devolver el evento futuro más cercano
 * (o null si no queda ninguno) ya convertido a `Destacado`.
 */
async function proximoEvento(): Promise<Destacado | null> {
  return null;
}

/** Artículos publicados, del más nuevo al más antiguo (nunca borradores, tampoco en dev). */
export async function ultimosArticulos(): Promise<Articulo[]> {
  return (await articulosPublicados()).filter((a) => !a.data.borrador);
}

async function desdeArticulo(articulo: Articulo): Promise<Destacado> {
  const { titulo, descripcion, area, tema, fecha, imagen, imagenAlt } = articulo.data;
  const autor = await autorDe(articulo);
  return {
    tipo: "articulo",
    categoria: tema || area,
    meta: [fechaLarga(fecha), autor.data.nombre],
    titulo,
    resumen: descripcion,
    imagen,
    imagenAlt,
    boton: { texto: "Leer el artículo", enlace: `/blog/${articulo.id}` },
    articuloId: articulo.id,
  };
}

/** Lo que se destaca en la portada, o null si no hay nada que mostrar. */
export async function obtenerDestacado(): Promise<Destacado | null> {
  const evento = await proximoEvento();
  if (evento) return evento;

  const [ultimo] = await ultimosArticulos();
  return ultimo ? desdeArticulo(ultimo) : null;
}
