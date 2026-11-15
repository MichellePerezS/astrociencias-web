import type { APIRoute } from "astro";
import { cambiarEstado } from "../../../../lib/borradores";
import { esAccionEstado } from "../../../../lib/flujo";
import { json } from "../../../../lib/respuestas";

export const prerender = false;

const ESTADOS = {
  "no-encontrado": 404,
  "no-permitido": 403,
  conflicto: 409,
  incompleto: 422,
  "sin-comentario": 422,
} as const;

// Cambia el estado de un borrador en el flujo de revisión.
// Cuerpo: { accion: "enviar" | "aprobar" | "devolver", version, comentario? }.
// «publicar» no se acepta aquí: va por /publicar, que sube el artículo a GitHub.
// El middleware ya ha comprobado la sesión y el origen; el rol y el estado
// se comprueban en cambiarEstado (src/lib/flujo.ts).
export const POST: APIRoute = async ({ params, request, locals }) => {
  let cuerpo: { accion?: unknown; version?: unknown; comentario?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return json({ error: "peticion" }, 400);
  }
  if (!esAccionEstado(cuerpo.accion) || typeof cuerpo.version !== "string") {
    return json({ error: "peticion" }, 400);
  }

  const r = await cambiarEstado(
    locals.usuario!,
    params.id ?? "",
    cuerpo.version,
    cuerpo.accion,
    cuerpo.comentario,
  );
  if (!r.ok) return json({ error: r.motivo }, ESTADOS[r.motivo]);
  return json({ estado: r.borrador.estado, version: r.version });
};
