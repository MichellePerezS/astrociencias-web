import type { APIRoute } from "astro";
import { crearBorrador } from "../../../lib/borradores";
import { json } from "../../../lib/respuestas";

export const prerender = false;

// Crea un borrador vacío del usuario. El middleware ya ha comprobado la
// sesión, el rol y el origen de la petición.
export const POST: APIRoute = async ({ locals }) => {
  const { borrador, version } = await crearBorrador(locals.usuario!);
  return json({ id: borrador.id, version }, 201);
};
