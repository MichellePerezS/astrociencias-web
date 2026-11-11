import type { APIRoute } from "astro";
import { leerBorrador, tiendaImagenes } from "../../../../lib/borradores";
import { TIPOS_IMAGEN } from "../../../../lib/imagenes";
import { RUTA_IMAGEN } from "../../../../lib/limpiar-html";

export const prerender = false;

const noEncontrada = () => new Response("No encontrada", { status: 404 });

// Sirve una imagen de un borrador solo a quien puede ver ese borrador.
export const GET: APIRoute = async ({ params, locals }) => {
  const ruta = `/api/imagenes/${params.borrador}/${params.archivo}`;
  if (!RUTA_IMAGEN.test(ruta)) return noEncontrada();

  const permitido = await leerBorrador(locals.usuario!, params.borrador!);
  if (!permitido) return noEncontrada();

  const entrada = await tiendaImagenes().getWithMetadata(`${params.borrador}/${params.archivo}`, {
    type: "arrayBuffer",
  });
  const tipo = entrada?.metadata?.tipo;
  if (!entrada?.data || typeof tipo !== "string" || !(tipo in TIPOS_IMAGEN)) return noEncontrada();

  return new Response(entrada.data, {
    headers: {
      "Content-Type": tipo,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
};
