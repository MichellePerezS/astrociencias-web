import { getCollection, type CollectionEntry } from "astro:content";

export type Edicion = CollectionEntry<"revista">;

/** Ediciones de la revista, de la más nueva a la más antigua (por fecha y, si empatan, por número). */
export async function ediciones(): Promise<Edicion[]> {
  const todas = await getCollection("revista");
  return todas.sort(
    (a, b) => b.data.fecha.getTime() - a.data.fecha.getTime() || b.data.numero - a.data.numero,
  );
}

/** «N.º 12» */
export const numeroEdicion = (edicion: Edicion) => `N.º ${edicion.data.numero}`;

/** Dirección de la página de una edición. */
export const urlEdicion = (edicion: Edicion) => `/recursos/revista/${edicion.id}`;

/**
 * Extracto para las tarjetas: el primer párrafo del texto (sin títulos ni
 * listas), sin la sintaxis de Markdown y recortado a `max` caracteres.
 */
export function extracto(markdown = "", max = 150): string {
  const parrafo =
    markdown
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .find((b) => b && !/^(#|[-*+] |\d+\. |>)/.test(b)) ?? "";

  const texto = parrafo
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max);
  return `${corte.slice(0, corte.lastIndexOf(" ")).replace(/[\s,;:.]+$/, "")}…`;
}
