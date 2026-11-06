import { getCollection, getEntry, type CollectionEntry } from "astro:content";

export type Articulo = CollectionEntry<"blog">;
export type Autor = CollectionEntry<"autores">;

/** Artículos publicados (sin borradores en producción), del más nuevo al más antiguo. */
export async function articulosPublicados(): Promise<Articulo[]> {
  const todos = await getCollection(
    "blog",
    ({ data }) => import.meta.env.DEV || !data.borrador,
  );
  return todos.sort((a, b) => b.data.fecha.getTime() - a.data.fecha.getTime());
}

/** Minutos de lectura aproximados (200 palabras por minuto). */
export function minutosDeLectura(texto = ""): number {
  const palabras = texto.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(palabras / 200));
}

/** «3 de noviembre de 2026» */
export function fechaLarga(fecha: Date): string {
  return fecha.toLocaleDateString("es-EC", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** «NOV 2026», para las tarjetas. */
export function fechaCorta(fecha: Date): string {
  return fecha
    .toLocaleDateString("es-EC", { month: "short", year: "numeric", timeZone: "UTC" })
    .replace(".", "")
    .replace(" de ", " ")
    .toUpperCase();
}

/** Iniciales para el avatar del autor; con marcador «[…]» devuelve «A». */
export function iniciales(nombre: string): string {
  if (nombre.startsWith("[")) return "A";
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** Autor de un artículo (lanza un error si el autor referenciado no existe). */
export async function autorDe(articulo: Articulo): Promise<Autor> {
  const autor = await getEntry(articulo.data.autor);
  if (!autor) {
    throw new Error(`El artículo «${articulo.id}» cita un autor que no existe: ${articulo.data.autor.id}`);
  }
  return autor;
}
