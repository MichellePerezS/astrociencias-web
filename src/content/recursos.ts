// Recursos de ACE: revista, podcast, radio, charlas y biblioteca virtual.
// Lista única, compartida por /recursos y la franja «Escucha, mira y lee» de la
// portada (src/components/FranjaRecursos.astro). Sin `href`, el recurso se
// muestra como «Próximamente».

export interface Recurso {
  id: "revista" | "podcast" | "radio" | "charlas" | "biblioteca";
  titulo: string;
  texto: string;
  /** Sin enlace todavía: se muestra «Próximamente». */
  href?: string;
  /** Texto del enlace al pie de la tarjeta (en /recursos). */
  accion?: string;
  /** Trazos del icono (viewBox 0 0 24 24, línea). */
  icono: string;
}

export const RECURSOS: Recurso[] = [
  {
    id: "revista",
    titulo: "Revista Astro&Ciencias",
    texto: "Los números de nuestra revista trimestral.",
    icono:
      '<path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/>',
  },
  {
    id: "podcast",
    titulo: "Podcast",
    texto: "Episodios de divulgación en Spotify.",
    href: "https://open.spotify.com/show/7sxgxENn3kVSwzXwgUkYZ7",
    accion: "Escuchar en Spotify",
    icono: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  },
  {
    id: "radio",
    titulo: "AstroCiencias Radio",
    texto: "Emisión en línea.",
    href: "https://zeno.fm/radio/astrociencias-radio/",
    accion: "Escuchar la radio",
    icono:
      '<circle cx="12" cy="12" r="2"/><path d="M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
  },
  {
    id: "charlas",
    titulo: "Charlas en vídeo",
    texto: "Directos y charlas en YouTube.",
    href: "https://www.youtube.com/@AstroCienciasEcuador",
    accion: "Ver en YouTube",
    icono: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M10 9.5l5 2.5-5 2.5z"/>',
  },
  {
    id: "biblioteca",
    titulo: "Biblioteca virtual",
    texto: "Documentos y libros de divulgación.",
    href: "https://drive.google.com/drive/folders/1m6BUBP_GkV5G9-xTc8h2rQ9zUUXroDuI?usp=drive_link",
    accion: "Abrir la biblioteca",
    icono: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  },
];
