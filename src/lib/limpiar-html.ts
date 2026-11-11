// Limpia el HTML del cuerpo de un borrador antes de guardarlo.
// Solo deja lo que permite el editor (títulos, negrita, cursiva, listas,
// enlaces, citas e imágenes subidas al propio borrador); todo lo demás se
// descarta, incluidos scripts, estilos, atributos y enlaces javascript:.

import sanitizeHtml from "sanitize-html";

/** Ruta pública de una imagen subida a un borrador. */
export const RUTA_IMAGEN = /^\/api\/imagenes\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.(?:jpg|png|webp|gif))$/;

export function esImagenDelBorrador(src: string | undefined | null, borradorId: string): boolean {
  const m = src ? RUTA_IMAGEN.exec(src) : null;
  return !!m && m[1] === borradorId;
}

export function limpiarHtml(html: string, borradorId: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "h2", "h3", "strong", "em", "ul", "ol", "li", "a", "blockquote", "img"],
    allowedAttributes: {
      a: ["href", "rel"],
      img: ["src", "alt"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: [] }, // las imágenes solo pueden ser rutas propias
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      b: "strong",
      i: "em",
      h1: "h2",
      h4: "h3",
      h5: "h3",
      h6: "h3",
      a: (tagName, attribs) => ({
        tagName,
        attribs: { href: attribs.href ?? "", rel: "noopener noreferrer nofollow" },
      }),
    },
    // Fuera imágenes que no sean de este borrador y enlaces vacíos.
    exclusiveFilter: (frame) =>
      (frame.tag === "img" && !esImagenDelBorrador(frame.attribs.src, borradorId)) ||
      (frame.tag === "a" && !frame.attribs.href),
  }).trim();
}

/** Texto plano corto (título, resumen, texto alternativo): sin etiquetas y con límite. */
export function textoPlano(valor: unknown, maximo: number): string {
  if (typeof valor !== "string") return "";
  return sanitizeHtml(valor, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximo);
}
