import type { APIRoute } from "astro";
import { randomUUID } from "node:crypto";
import { leerBorrador, tiendaImagenes } from "../../../../lib/borradores";
import { MAX_BYTES_IMAGEN, TIPOS_IMAGEN, detectarTipo } from "../../../../lib/imagenes";
import { json } from "../../../../lib/respuestas";

export const prerender = false;

// Sube una imagen a un borrador. El cuerpo es el archivo tal cual.
// Devuelve { url } para usarla en el texto o como imagen destacada.
export const POST: APIRoute = async ({ params, request, locals }) => {
  const usuario = locals.usuario!;
  const actual = await leerBorrador(usuario, params.id ?? "");
  if (!actual) return json({ error: "no-encontrado" }, 404);

  const declarado = Number(request.headers.get("content-length") ?? 0);
  if (declarado > MAX_BYTES_IMAGEN) return json({ error: "demasiado-grande" }, 413);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return json({ error: "vacia" }, 400);
  if (bytes.byteLength > MAX_BYTES_IMAGEN) return json({ error: "demasiado-grande" }, 413);

  const tipo = detectarTipo(bytes);
  if (!tipo) return json({ error: "tipo" }, 415);

  const archivo = `${randomUUID()}.${TIPOS_IMAGEN[tipo]}`;
  const borradorId = actual.borrador.id;
  await tiendaImagenes().set(`${borradorId}/${archivo}`, bytes.buffer as ArrayBuffer, {
    metadata: { tipo, subidaPor: usuario.id, subida: new Date().toISOString() },
  });

  return json({ url: `/api/imagenes/${borradorId}/${archivo}` }, 201);
};
