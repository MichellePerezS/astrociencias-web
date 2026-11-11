import type { APIRoute } from "astro";
import { guardarBorrador, type CambiosBorrador } from "../../../lib/borradores";
import { json } from "../../../lib/respuestas";

export const prerender = false;

const ESTADOS = { "no-encontrado": 404, conflicto: 409, "demasiado-grande": 413 } as const;

// Guarda los cambios de un borrador (guardado automático del editor).
// Cuerpo: { version, titulo, resumen, area, imagen, imagenAlt, contenido }.
export const PUT: APIRoute = async ({ params, request, locals }) => {
  let cuerpo: CambiosBorrador & { version?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return json({ error: "peticion" }, 400);
  }
  if (typeof cuerpo.version !== "string") return json({ error: "peticion" }, 400);

  const r = await guardarBorrador(locals.usuario!, params.id ?? "", cuerpo.version, cuerpo);
  if (!r.ok) return json({ error: r.motivo }, ESTADOS[r.motivo]);
  return json({ version: r.version, actualizado: r.borrador.actualizado });
};
