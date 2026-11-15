// Optimiza las imágenes antes de publicarlas (fase 4): como mucho 1600 px de
// ancho y en WebP, para que cada una quede en unos 150–300 KB.
//
// Usa los códecs de Squoosh compilados a WebAssembly (@jsquash) para leer
// JPEG, PNG y WebP y para escribir WebP, no sharp:
// WebAssembly funciona igual en macOS que en la función de Netlify (Linux),
// sin binarios nativos por plataforma. Los .wasm van incrustados en el código
// del servidor (`?inline`), así que no dependen de que Netlify copie archivos
// sueltos de node_modules al preparar la función.
//
// La reducción de tamaño se hace aquí, en JavaScript y fila a fila, en vez de
// con @jsquash/resize: ese copia la imagen entera a memoria de WebAssembly y la
// pasa a coma flotante (unos 360 MB más con una foto de 12 Mpx, cerca del límite
// de 1024 MB de la función). Así solo hace falta la imagen de salida.
//
// Los GIF se publican tal cual: suelen ser animaciones y el códec de WebP de
// Squoosh solo guarda un fotograma.

import decodificarJpeg, { init as initJpeg } from "@jsquash/jpeg/decode";
import decodificarPng, { init as initPng } from "@jsquash/png/decode";
import decodificarWebp, { init as initWebpDec } from "@jsquash/webp/decode";
import codificarWebp, { init as initWebpEnc } from "@jsquash/webp/encode";
import wasmJpeg from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm?inline";
import wasmPng from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm?inline";
import wasmWebpDec from "@jsquash/webp/codec/dec/webp_dec.wasm?inline";
import wasmWebpEnc from "@jsquash/webp/codec/enc/webp_enc_simd.wasm?inline";
import { detectarTipo } from "./imagenes";

export const ANCHO_MAXIMO = 1600;
/** Por encima de esto se baja la calidad (hasta CALIDADES.at(-1)). */
export const BYTES_OBJETIVO = 300 * 1024;
/** Calidades de WebP que se prueban, de mejor a peor, hasta quedar por debajo del objetivo. */
const CALIDADES = [82, 75, 68, 60];

export interface ImagenOptimizada {
  bytes: Uint8Array;
  extension: "webp" | "gif";
  ancho: number;
  alto: number;
}

/** Datos de imagen RGBA, como el ImageData del navegador. */
interface Pixeles {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// Los códecs crean ImageData, que no existe en Node: basta con esta forma.
globalThis.ImageData ??= class ImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
} as unknown as typeof globalThis.ImageData;

/** Compila los .wasm una sola vez por instancia de la función. */
let preparado: Promise<void> | null = null;
function preparar(): Promise<void> {
  const modulo = (dataUrl: string) =>
    WebAssembly.compile(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
  preparado ??= (async () => {
    const [jpeg, png, webpDec, webpEnc] = await Promise.all(
      [wasmJpeg, wasmPng, wasmWebpDec, wasmWebpEnc].map(modulo),
    );
    await Promise.all([initJpeg(jpeg), initPng(png), initWebpDec(webpDec), initWebpEnc(webpEnc)]);
  })().catch((e) => {
    preparado = null; // que el siguiente intento vuelva a probar
    throw e;
  });
  return preparado;
}

/** Nombre con el que se publica una imagen del borrador («<uuid>.jpg» → «<uuid>.webp»). */
export function nombrePublicado(archivo: string): string {
  return archivo.endsWith(".gif") ? archivo : archivo.replace(/\.(jpg|png|webp)$/, ".webp");
}

export async function optimizarImagen(original: Uint8Array): Promise<ImagenOptimizada> {
  const tipo = detectarTipo(original);
  if (!tipo) throw new Error("Formato de imagen no admitido.");
  if (tipo === "image/gif") {
    const { ancho, alto } = tamanoGif(original);
    return { bytes: original, extension: "gif", ancho, alto };
  }

  await preparar();
  const buffer = original.slice().buffer;
  let pixeles: Pixeles =
    tipo === "image/jpeg"
      ? // Pese al nombre, `preserveOrientation: true` aplica la orientación EXIF
        // (las fotos de móvil salen derechas); con false salen giradas.
        await decodificarJpeg(buffer, { preserveOrientation: true })
      : tipo === "image/png"
        ? await decodificarPng(buffer)
        : await decodificarWebp(buffer);

  // Un WebP que ya cumple se deja como está: recomprimirlo solo perdería calidad.
  if (tipo === "image/webp" && pixeles.width <= ANCHO_MAXIMO && original.byteLength <= BYTES_OBJETIVO) {
    return { bytes: original, extension: "webp", ancho: pixeles.width, alto: pixeles.height };
  }

  if (pixeles.width > ANCHO_MAXIMO) {
    const alto = Math.max(1, Math.round((pixeles.height * ANCHO_MAXIMO) / pixeles.width));
    pixeles = reducir(pixeles, ANCHO_MAXIMO, alto);
  }

  let bytes = new Uint8Array(0);
  for (const quality of CALIDADES) {
    bytes = new Uint8Array(await codificarWebp(pixeles as ImageData, { quality }));
    if (bytes.byteLength <= BYTES_OBJETIVO) break;
  }
  return { bytes, extension: "webp", ancho: pixeles.width, alto: pixeles.height };
}

/** Ancho y alto de un GIF (cabecera «Logical Screen Descriptor»). */
function tamanoGif(bytes: Uint8Array): { ancho: number; alto: number } {
  return { ancho: bytes[6] | (bytes[7] << 8), alto: bytes[8] | (bytes[9] << 8) };
}

// sRGB ↔ luz lineal, con tablas: promediar en luz lineal evita que los detalles
// finos (hojas, estrellas, texto) se oscurezcan al reducir.
const A_LINEAL = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const PASOS_SRGB = 4096;
const A_SRGB = Uint8Array.from({ length: PASOS_SRGB + 1 }, (_, i) => {
  const l = i / PASOS_SRGB;
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
});

/**
 * Reduce una imagen RGBA promediando el área de origen que cubre cada píxel de
 * destino (solo para reducir, nunca ampliar). Recorre la salida fila a fila con
 * una sola fila de acumuladores, así que apenas usa memoria además del resultado.
 * El color se pondera por la transparencia para no dejar halos en los bordes.
 */
export function reducir(origen: Pixeles, ancho: number, alto: number): Pixeles {
  const { data: src, width: sw, height: sh } = origen;
  const escalaX = sw / ancho;
  const escalaY = sh / alto;

  // Para cada columna de destino: columnas de origen que cubre y en qué fracción.
  const inicioX = new Int32Array(ancho);
  const finX = new Int32Array(ancho);
  const pesoPrimeraX = new Float32Array(ancho);
  const pesoUltimaX = new Float32Array(ancho);
  for (let x = 0; x < ancho; x++) {
    const a = x * escalaX;
    const b = Math.min(sw, (x + 1) * escalaX);
    inicioX[x] = Math.floor(a);
    finX[x] = Math.min(sw - 1, Math.ceil(b) - 1);
    pesoPrimeraX[x] = Math.min(b, inicioX[x] + 1) - a;
    pesoUltimaX[x] = finX[x] > inicioX[x] ? b - finX[x] : 0;
  }

  const salida = new Uint8ClampedArray(ancho * alto * 4);
  const acumulado = new Float64Array(ancho * 4); // R, G, B (por alfa, lineales) y alfa
  const area = escalaX * escalaY;

  for (let y = 0; y < alto; y++) {
    acumulado.fill(0);
    const a = y * escalaY;
    const b = Math.min(sh, (y + 1) * escalaY);
    const primeraFila = Math.floor(a);
    const ultimaFila = Math.min(sh - 1, Math.ceil(b) - 1);
    for (let fy = primeraFila; fy <= ultimaFila; fy++) {
      const pesoY = Math.min(b, fy + 1) - Math.max(a, fy);
      if (pesoY <= 0) continue;
      const fila = fy * sw * 4;
      for (let x = 0; x < ancho; x++) {
        let r = 0, g = 0, bl = 0, al = 0;
        for (let fx = inicioX[x]; fx <= finX[x]; fx++) {
          const peso = fx === inicioX[x] ? pesoPrimeraX[x] : fx === finX[x] ? pesoUltimaX[x] : 1;
          const i = fila + fx * 4;
          const alfa = (src[i + 3] / 255) * peso;
          r += A_LINEAL[src[i]] * alfa;
          g += A_LINEAL[src[i + 1]] * alfa;
          bl += A_LINEAL[src[i + 2]] * alfa;
          al += alfa;
        }
        const j = x * 4;
        acumulado[j] += r * pesoY;
        acumulado[j + 1] += g * pesoY;
        acumulado[j + 2] += bl * pesoY;
        acumulado[j + 3] += al * pesoY;
      }
    }
    const fila = y * ancho * 4;
    for (let x = 0; x < ancho; x++) {
      const j = x * 4;
      const alfa = acumulado[j + 3];
      const k = fila + j;
      if (alfa > 0) {
        salida[k] = A_SRGB[Math.round(Math.min(1, acumulado[j] / alfa) * PASOS_SRGB)];
        salida[k + 1] = A_SRGB[Math.round(Math.min(1, acumulado[j + 1] / alfa) * PASOS_SRGB)];
        salida[k + 2] = A_SRGB[Math.round(Math.min(1, acumulado[j + 2] / alfa) * PASOS_SRGB)];
      }
      salida[k + 3] = Math.round((alfa / area) * 255);
    }
  }
  return { data: salida, width: ancho, height: alto };
}
