import type { APIRoute } from "astro";
import { json } from "../../../../lib/respuestas";
import { publicarBorrador } from "../../../../lib/publicar";

export const prerender = false;

const ESTADOS = {
  "no-encontrado": 404,
  "no-permitido": 403,
  conflicto: 409,
  incompleto: 422,
  // Quien creó el borrador no tiene rol «autor:<ficha>», o su ficha no existe.
  "sin-ficha": 422,
  "ficha-inexistente": 422,
  imagen: 500,
  // Una imagen que no se puede decodificar (archivo dañado).
  "imagen-formato": 422,
  // Falta configurar el token o el repositorio en Netlify.
  "github-config": 503,
  // Token caducado, sin permisos o GitHub no responde: el fallo no es de quien publica.
  "github-token": 502,
  "github-permisos": 502,
  "github-github": 502,
} as const;

// Publica un borrador aprobado: lo sube a GitHub como .md con sus imágenes.
// Cuerpo: { version }. El autor no se envía: es siempre la ficha del rol
// «autor:<ficha>» de quien creó el borrador (firmaDe en src/lib/publicar.ts).
// El middleware ya ha comprobado la sesión y el origen; el rol de editor, el
// estado y la ficha se comprueban en publicarBorrador.
export const POST: APIRoute = async ({ params, request, locals }) => {
  let cuerpo: { version?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return json({ error: "peticion" }, 400);
  }
  if (typeof cuerpo.version !== "string") return json({ error: "peticion" }, 400);

  const r = await publicarBorrador(locals.usuario!, params.id ?? "", cuerpo.version);
  if (!r.ok) return json({ error: r.motivo, campos: r.campos }, ESTADOS[r.motivo]);
  return json({ publicacion: r.publicacion });
};
