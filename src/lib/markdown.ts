// Convierte el cuerpo de un borrador (HTML ya limpio, ver limpiar-html.ts) a
// Markdown para src/content/blog. Solo trata lo que deja pasar limpiarHtml:
// p, br, h2, h3, strong, em, ul, ol, li, a, blockquote e img. Cualquier otra
// etiqueta se reduce a su texto.
//
// El texto se escapa para que no se interprete como sintaxis de Markdown
// (asteriscos, corchetes, «#» o «-» al principio de línea, etc.).

import { parseDocument } from "htmlparser2";
import type { ChildNode, Element } from "domhandler";

export interface OpcionesMarkdown {
  /** Cambia la dirección de cada imagen (p. ej. de /api/imagenes/… a /images/blog/…). */
  rutaImagen?: (src: string) => string;
}

export function htmlAMarkdown(html: string, opciones: OpcionesMarkdown = {}): string {
  const rutaImagen = opciones.rutaImagen ?? ((src: string) => src);
  const documento = parseDocument(html);

  const esElemento = (n: ChildNode): n is Element => n.type === "tag";

  function bloques(nodos: ChildNode[]): string[] {
    const salida: string[] = [];
    let enLinea: ChildNode[] = [];
    // Texto o etiquetas en línea sueltos entre bloques: se agrupan en un párrafo.
    const cerrarParrafo = () => {
      const texto = escaparInicioDeLinea(enLinea.map(enLineaMd).join("").trim());
      if (texto) salida.push(texto);
      enLinea = [];
    };
    for (const n of nodos) {
      if (!esElemento(n) || !BLOQUES.has(n.name)) {
        enLinea.push(n);
        continue;
      }
      cerrarParrafo();
      const md = bloque(n);
      if (md) salida.push(md);
    }
    cerrarParrafo();
    return salida;
  }

  function bloque(el: Element): string {
    switch (el.name) {
      case "p":
        return escaparInicioDeLinea(contenidoEnLinea(el).trim());
      case "h2":
      case "h3": {
        const texto = contenidoEnLinea(el).replace(/\\\n/g, " ").trim();
        if (!texto) return "";
        // Un «#» al final se tomaría como cierre del título.
        return `${el.name === "h2" ? "##" : "###"} ${texto.replace(/(\s)(#+)$/, "$1\\$2")}`;
      }
      case "blockquote":
        return bloques(el.children)
          .join("\n\n")
          .split("\n")
          .map((l) => (l ? `> ${l}` : ">"))
          .join("\n");
      case "ul":
      case "ol": {
        const items = el.children.filter((n): n is Element => esElemento(n) && n.name === "li");
        const inicio = Number(el.attribs.start) || 1;
        return items
          .map((li, i) => {
            const marca = el.name === "ul" ? "- " : `${inicio + i}. `;
            const sangria = " ".repeat(marca.length);
            const texto = bloques(li.children).join("\n\n") || "";
            return texto
              .split("\n")
              .map((l, j) => (j === 0 ? marca + l : l ? sangria + l : ""))
              .join("\n");
          })
          .join("\n");
      }
      case "img":
        return imagen(el);
      default:
        return "";
    }
  }

  function contenidoEnLinea(el: Element): string {
    return el.children.map(enLineaMd).join("");
  }

  function enLineaMd(n: ChildNode): string {
    if (n.type === "text") return escaparTexto(n.data.replace(/\s+/g, " "));
    if (!esElemento(n)) return "";
    switch (n.name) {
      case "strong":
      case "b":
        return envolver(contenidoEnLinea(n), "**");
      case "em":
      case "i":
        return envolver(contenidoEnLinea(n), "*");
      case "br":
        return "\\\n";
      case "a": {
        const texto = contenidoEnLinea(n).trim();
        const href = n.attribs.href ?? "";
        if (!href) return texto;
        return `[${texto || escaparTexto(href)}](${destino(href)})`;
      }
      case "img":
        return imagen(n);
      default:
        // Un bloque dentro de una línea (no debería ocurrir): se queda su texto.
        return contenidoEnLinea(n);
    }
  }

  function imagen(el: Element): string {
    const src = el.attribs.src;
    if (!src) return "";
    const alt = (el.attribs.alt ?? "").replace(/\s+/g, " ").trim();
    return `![${alt.replace(/([\\[\]])/g, "\\$1")}](${destino(rutaImagen(src))})`;
  }

  return bloques(documento.children).join("\n\n").trim() + "\n";
}

const BLOQUES = new Set(["p", "h2", "h3", "ul", "ol", "blockquote", "img"]);

/** Marca de énfasis sin espacios pegados por dentro (si no, Markdown no la reconoce). */
function envolver(texto: string, marca: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(texto)!;
  if (!m[2]) return texto;
  return `${m[1]}${marca}${m[2]}${marca}${m[3]}`;
}

/** Dirección de un enlace o imagen, sin caracteres que corten la sintaxis. */
function destino(url: string): string {
  // encodeURIComponent no codifica «(» ni «)», que cortarían el enlace.
  const CODIGOS: Record<string, string> = { "(": "%28", ")": "%29", "<": "%3C", ">": "%3E" };
  return url.replace(/[\s()<>]/g, (c) => CODIGOS[c] ?? encodeURIComponent(c));
}

/** Escapa los caracteres con significado en Markdown dentro de una línea. */
function escaparTexto(texto: string): string {
  return texto
    .replace(/([\\`*_[\]<>|~])/g, "\\$1")
    .replace(/&(?=#?\w+;)/g, "&amp;");
}

/** Escapa lo que al principio de una línea empezaría un título, cita o lista. */
function escaparInicioDeLinea(texto: string): string {
  return texto
    .split("\n")
    .map((linea) =>
      linea
        // Cualquier «-» inicial: también evita «---» (línea horizontal o título subrayado).
        .replace(/^(\s*)(#{1,6}(?:\s|$)|[>+](?:\s|$)|-|=+\s*$)/, "$1\\$2")
        .replace(/^(\s*\d+)([.)])(\s|$)/, "$1\\$2$3"),
    )
    .join("\n");
}
