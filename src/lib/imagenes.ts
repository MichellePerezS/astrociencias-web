// Validación de imágenes subidas al editor.
// El tipo se comprueba por los primeros bytes del archivo, no por lo que
// diga el navegador. SVG queda fuera a propósito (puede llevar scripts).

/** Tamaño máximo por imagen. Las funciones de Netlify aceptan unos 6 MB por petición. */
export const MAX_BYTES_IMAGEN = 4 * 1024 * 1024;

export const TIPOS_IMAGEN = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

export type TipoImagen = keyof typeof TIPOS_IMAGEN;

const empiezaPor = (b: Uint8Array, firma: number[], desde = 0) =>
  firma.every((byte, i) => b[desde + i] === byte);

/** Devuelve el tipo real de la imagen, o null si no es uno de los permitidos. */
export function detectarTipo(bytes: Uint8Array): TipoImagen | null {
  if (empiezaPor(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (empiezaPor(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (empiezaPor(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (empiezaPor(bytes, [0x52, 0x49, 0x46, 0x46]) && empiezaPor(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}
