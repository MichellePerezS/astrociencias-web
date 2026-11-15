// Publicación de un borrador aprobado (fase 4).
//
// Un editor pulsa «Publicar» → se convierte a Markdown con el frontmatter del
// blog (src/content.config.ts) → en un solo commit a la rama de GitHub:
//   src/content/blog/<slug>.md
//   public/images/blog/<slug>/<archivo>   (imagen destacada e imágenes del texto,
//                                          optimizadas: ver optimizar-imagen.ts)
// → el borrador queda «publicado». Netlify recompila la web con el commit.
//
// Todo se comprueba aquí, en el servidor: rol de editor, estado «aprobado»,
// versión (ETag) y campos obligatorios del esquema.

import { getCollection } from "astro:content";
import { leerBorrador, leerImagen, marcarPublicado, type Borrador, type Publicacion } from "./borradores";
import { puedeAplicar } from "./flujo";
import { commitArchivos, configGitHub, ErrorGitHub, shaArchivo, shaBlob, type ArchivoCommit } from "./github";
import type { Usuario } from "./identidad";
import { RUTA_IMAGEN } from "./limpiar-html";
import { htmlAMarkdown } from "./markdown";
import { nombrePublicado, optimizarImagen } from "./optimizar-imagen";

export type ResultadoPublicacion =
  | { ok: true; publicacion: Publicacion }
  | {
      ok: false;
      motivo:
        | "no-encontrado"
        | "conflicto"
        | "no-permitido"
        | "incompleto"
        | "autor"
        | "imagen"
        | "imagen-formato"
        | `github-${ErrorGitHub["motivo"]}`;
      /** Campos que faltan (solo con «incompleto»). */
      campos?: string[];
    };

/** Dirección como la genera Keystatic: minúsculas, sin tildes y con guiones. */
export function slugDe(titulo: string): string {
  return (
    titulo
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "") || "articulo"
  );
}

/** Fecha de hoy en Ecuador continental (AAAA-MM-DD). */
const hoyEnEcuador = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(new Date());

/** Cadena YAML entre comillas dobles (JSON es YAML válido). */
const yaml = (texto: string) => JSON.stringify(texto);

/** Archivo de cada imagen del borrador que se usa en el artículo. */
function imagenesUsadas(borrador: Borrador): string[] {
  const rutas = [borrador.imagen, ...[...borrador.contenido.matchAll(/src="([^"]+)"/g)].map((m) => m[1])];
  const archivos = new Set<string>();
  for (const ruta of rutas) {
    const m = ruta ? RUTA_IMAGEN.exec(ruta) : null;
    if (m && m[1] === borrador.id) archivos.add(m[2]);
  }
  return [...archivos];
}

/** El .md completo del artículo para un slug dado. */
export function markdownDelArticulo(borrador: Borrador, slug: string, autor: string, fecha: string): string {
  const rutaPublica = (src: string) => {
    const m = RUTA_IMAGEN.exec(src);
    return m && m[1] === borrador.id ? `/images/blog/${slug}/${nombrePublicado(m[2])}` : src;
  };
  const frontmatter = [
    "---",
    `titulo: ${yaml(borrador.titulo)}`,
    `descripcion: ${yaml(borrador.resumen)}`,
    `fecha: ${fecha}`,
    `area: ${yaml(borrador.area ?? "")}`,
    `autor: ${autor}`,
    ...(borrador.imagen
      ? [`imagen: ${yaml(rutaPublica(borrador.imagen))}`, `imagenAlt: ${yaml(borrador.imagenAlt)}`]
      : []),
    "borrador: false",
    "---",
  ];
  return `${frontmatter.join("\n")}\n\n${htmlAMarkdown(borrador.contenido, { rutaImagen: rutaPublica })}`;
}

export async function publicarBorrador(
  usuario: Usuario,
  id: string,
  versionCliente: string,
  autorCliente: unknown,
): Promise<ResultadoPublicacion> {
  const actual = await leerBorrador(usuario, id);
  if (!actual) return { ok: false, motivo: "no-encontrado" };
  if (actual.version !== versionCliente) return { ok: false, motivo: "conflicto" };
  const borrador = actual.borrador;
  // Solo editores y solo desde «aprobado» (src/lib/flujo.ts).
  if (!puedeAplicar(usuario, borrador, "publicar")) return { ok: false, motivo: "no-permitido" };

  // Campos obligatorios del esquema del blog.
  const faltan = [
    !borrador.titulo.trim() && "titulo",
    !borrador.resumen.trim() && "resumen",
    !borrador.area && "area",
    !htmlAMarkdown(borrador.contenido).trim() && "contenido",
  ].filter((c): c is string => !!c);
  if (faltan.length) return { ok: false, motivo: "incompleto", campos: faltan };

  // La ficha de autor debe existir: si no, la web no compilaría.
  const autor = typeof autorCliente === "string" && autorCliente ? autorCliente : borrador.autor;
  const fichas = new Set((await getCollection("autores")).map((a) => a.id));
  if (!autor || !fichas.has(autor)) return { ok: false, motivo: "autor" };

  // Se optimizan antes de subirlas: máximo 1600 px de ancho y WebP (los GIF, tal cual).
  const imagenes: { archivo: string; bytes: Uint8Array }[] = [];
  for (const archivo of imagenesUsadas(borrador)) {
    const original = await leerImagen(id, archivo);
    if (!original) return { ok: false, motivo: "imagen" };
    try {
      const optimizada = await optimizarImagen(original);
      imagenes.push({ archivo: nombrePublicado(archivo), bytes: optimizada.bytes });
    } catch (e) {
      console.error(`[publicar] ${id}: no se pudo procesar ${archivo}:`, e);
      return { ok: false, motivo: "imagen-formato" };
    }
  }

  try {
    const config = configGitHub();
    const fecha = hoyEnEcuador();
    const base = slugDe(borrador.titulo);
    const codificar = (texto: string) => new TextEncoder().encode(texto);

    // Primer slug libre: «base», «base-2», «base-3»… Si ya existe exactamente
    // este mismo archivo (un intento anterior que subió el commit pero no llegó
    // a marcar el borrador), se reutiliza sin volver a subir nada.
    for (let n = 1; n <= 20; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      const md = codificar(markdownDelArticulo(borrador, slug, autor, fecha));
      const ruta = `src/content/blog/${slug}.md`;
      const existente = await shaArchivo(config, ruta);
      if (existente && existente !== shaBlob(md)) continue;

      let commit: { sha: string; url: string } | null = null;
      if (!existente) {
        const archivos: ArchivoCommit[] = [
          { ruta, contenido: md },
          ...imagenes.map((i) => ({ ruta: `public/images/blog/${slug}/${i.archivo}`, contenido: i.bytes })),
        ];
        commit = await commitArchivos(
          config,
          archivos,
          `Publish "${borrador.titulo}"\n\nPublished from the editor by ${usuario.nombre}.\nDraft: ${id}`,
        );
      }
      const publicacion: Publicacion = {
        slug,
        autor,
        fecha,
        commit: commit?.sha ?? null,
        urlCommit: commit?.url ?? `https://github.com/${config.repo}/blob/${config.rama}/${ruta}`,
      };
      await marcarPublicado(usuario, id, publicacion);
      return { ok: true, publicacion };
    }
    throw new ErrorGitHub("github", `Ya hay demasiados artículos con la dirección «${base}».`);
  } catch (e) {
    if (e instanceof ErrorGitHub) {
      console.error(`[publicar] ${id}: ${e.message}`);
      return { ok: false, motivo: `github-${e.motivo}` };
    }
    throw e;
  }
}
