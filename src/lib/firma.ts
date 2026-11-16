// Firma de un artículo: con qué ficha de src/content/autores se publica.
//
// Es siempre la ficha del rol «autor:<ficha>» de quien creó el borrador
// (Borrador.autor, que se actualiza cuando el propietario guarda o envía).
// Nadie la elige al publicar. Módulo aparte de publicar.ts para que las
// páginas del editor no carguen los códecs de imagen.

import { getCollection } from "astro:content";
import type { Borrador } from "./borradores";

/** Firma con la que se publicaría un borrador, o por qué no puede publicarse. */
export type FirmaBorrador =
  | { ok: true; ficha: string; nombre: string }
  | { ok: false; motivo: "sin-ficha" }
  | { ok: false; motivo: "ficha-inexistente"; ficha: string };

/**
 * El autor del artículo es siempre la ficha del rol «autor:<ficha>» de quien
 * creó el borrador (Borrador.autor); nadie puede elegir otro. Si no tiene
 * ficha, o la ficha no existe en src/content/autores, no se puede publicar.
 */
export async function firmaDe(borrador: Pick<Borrador, "autor">): Promise<FirmaBorrador> {
  if (!borrador.autor) return { ok: false, motivo: "sin-ficha" };
  const ficha = (await getCollection("autores")).find((a) => a.id === borrador.autor);
  if (!ficha) return { ok: false, motivo: "ficha-inexistente", ficha: borrador.autor };
  return { ok: true, ficha: ficha.id, nombre: ficha.data.nombre };
}

/** La firma en forma simple para el editor (isla de React): siempre los tres campos. */
export interface DatosFirma {
  ficha: string | null;
  /** Nombre de la ficha, si existe. */
  nombre: string | null;
  /** Por qué no se puede publicar, o null si se puede. */
  problema: "sin-ficha" | "ficha-inexistente" | null;
}

export function datosFirma(firma: FirmaBorrador): DatosFirma {
  if (firma.ok) return { ficha: firma.ficha, nombre: firma.nombre, problema: null };
  return { ficha: firma.motivo === "ficha-inexistente" ? firma.ficha : null, nombre: null, problema: firma.motivo };
}
