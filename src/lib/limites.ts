// Límites del editor, compartidos por el servidor y el navegador.
// El servidor los aplica siempre; en el navegador solo sirven para avisar antes.

export const LIMITES = {
  titulo: 200,
  resumen: 600,
  imagenAlt: 300,
  /** Tamaño máximo del HTML del cuerpo. */
  contenido: 400_000,
} as const;
