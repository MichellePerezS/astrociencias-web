// Prueba e2e del flujo de revisión y publicación (fases 3 y 4), en un navegador real:
// la autora envía → la editora lo ve en la cola → lo devuelve con un comentario
// → la autora edita y reenvía → la editora lo aprueba → la editora lo publica
// (commit con el .md y sus imágenes en el GitHub simulado de github-mock.mjs).
// También comprueba que el servidor aplica las reglas (400, 403, 409, 422).
// Se ejecuta con `npm run test:e2e` (tests/e2e/ejecutar.mjs), que arranca
// `astro dev` con los sustitutos de Identity y de GitHub.
// Con E2E_GUARDAR=<carpeta>, guarda ahí el .md y la imagen publicados.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { chromium } from "playwright-core";

/** PNG RGBA con un degradado, para probar que se reduce a 1600 px y se pasa a WebP. */
function crearPng(ancho, alto) {
  const fila = 1 + ancho * 4;
  const crudo = Buffer.alloc(fila * alto);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = y * fila + 1 + x * 4;
      crudo[i] = (x * 255) / ancho;
      crudo[i + 1] = (y * 255) / alto;
      crudo[i + 2] = ((x + y) * 7) & 255;
      crudo[i + 3] = 255;
    }
  }
  const trozo = (tipo, datos) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(tipo), datos])));
    return Buffer.concat([largo, Buffer.from(tipo), datos, crc]);
  };
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(ancho, 0);
  cabecera.writeUInt32BE(alto, 4);
  cabecera.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", cabecera),
    trozo("IDAT", zlib.deflateSync(crudo)),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

/** Ancho y alto de un WebP (VP8, VP8L o VP8X), o null si no es WebP. */
function tamanoWebp(b) {
  if (!b || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const trozo = b.toString("ascii", 12, 16);
  if (trozo === "VP8 ") return { ancho: b.readUInt16LE(26) & 0x3fff, alto: b.readUInt16LE(28) & 0x3fff };
  if (trozo === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { ancho: (bits & 0x3fff) + 1, alto: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (trozo === "VP8X") return { ancho: b.readUIntLE(24, 3) + 1, alto: b.readUIntLE(27, 3) + 1 };
  return null;
}

const PNG = crearPng(2400, 1000);

/**
 * Ejecuta la prueba contra `base` (un `astro dev` con los sustitutos de
 * Identity y GitHub; `github` es el de github-mock.mjs).
 * Devuelve el número de comprobaciones fallidas más los errores del navegador.
 */
export async function probarFlujoRevision(base, github) {
  const MARCA = Date.now();
  const TITULO = `E2E revisión & publicación ${MARCA}`;
  // Dirección esperada: minúsculas, sin tildes, sin «&» y con guiones.
  const SLUG = `e2e-revision-publicacion-${MARCA}`;
  const RESUMEN = "Resumen con «comillas», \"dobles\" & símbolos < y >.";
  const AREA = "Astronomía y astrofísica";
  const COMENTARIO = "Falta citar la fuente del dato & revisar la conclusión.";

  let pasos = 0;
  const fallos = [];
  const ok = (cond, texto) => {
    pasos++;
    console.log(`${cond ? "OK   " : "FALLO"}  ${texto}`);
    if (!cond) fallos.push(texto);
  };

  // Chrome instalado en el equipo (o el ejecutable de CHROME_PATH): no se descarga ningún navegador.
  const browser = await chromium.launch(
    process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH, headless: true }
      : { channel: "chrome", headless: true },
  );
  const errores = [];
  async function sesion(nombre, token) {
    const ctx = await browser.newContext({ baseURL: base });
    await ctx.addCookies([{ name: "ace_sesion", value: token, url: base }]);
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    page.on("pageerror", (e) => errores.push(`[${nombre}] pageerror: ${e.message}`));
    page.on("console", (m) => {
      // Solo se ignora la auditoría de la barra de Astro (dev) interrumpida al navegar.
      if (m.type() !== "error" || m.text().includes("Error while running audit's match function")) return;
      errores.push(`[${nombre}] console: ${m.text()}`);
    });
    return { ctx, page };
  }
  // Peticiones directas a la API, con la cookie de la sesión y el mismo Origin.
  const api = (page, metodo, ruta, cuerpo) =>
    page.request.fetch(ruta, {
      method: metodo,
      headers: { "Content-Type": "application/json", Origin: base },
      data: cuerpo,
    });
  /** Datos que el servidor pasó a la isla del editor (props serializadas por Astro). */
  async function datosEditor(page) {
    const props = await page.locator("astro-island").first().getAttribute("props");
    const decodificar = (v) =>
      Array.isArray(v) && typeof v[0] === "number"
        ? v[0] === 0
          ? decodificar(v[1])
          : v[0] === 1
            ? v[1].map(decodificar)
            : v[1]
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decodificar(x)]))
          : v;
    return decodificar(JSON.parse(props)).inicial;
  }
  const estadoRevision = (page) => page.locator(".estado-revision").innerText();
  const esperarGuardado = (page) => page.locator(".barra-estado .estado-guardado").waitFor({ timeout: 15000 });

  const autora = await sesion("autora", "token-autor");
  const editora = await sesion("editora", "token-editor");
  const A = autora.page;
  const E = editora.page;

  try {
      // 1. La autora escribe un borrador y lo envía a revisión.
      await A.goto("/escribir/nuevo");
      await A.locator("#ed-titulo").fill(TITULO);
      await A.locator("#ed-resumen").fill(RESUMEN);
      await A.locator("#ed-area").selectOption(AREA);
      await A.locator(".cuerpo-editor").click();
      await A.keyboard.type("Primera versión del texto.");
      await esperarGuardado(A);
      await A.waitForURL(/\/escribir\/editar\/[0-9a-f-]{36}$/);
      const id = A.url().split("/").pop();
      ok(true, `autora: borrador creado y guardado (${id})`);
      const ruta = `/escribir/editar/${id}`;

      await Promise.all([A.waitForNavigation(), A.getByRole("button", { name: "Enviar a revisión" }).click()]);
      await A.locator(".estado-revision").waitFor();
      ok((await estadoRevision(A)) === "En revisión", "autora: tras enviar, el estado es «En revisión»");
      ok(await A.locator("#ed-titulo").evaluate((e) => e.readOnly), "autora: el título queda en solo lectura");
      ok((await A.getByRole("button", { name: "Enviar a revisión" }).count()) === 0, "autora: ya no ve «Enviar a revisión»");
      let d = await datosEditor(A);
      let r = await api(A, "PUT", `/api/borradores/${id}`, { version: d.version, titulo: "hack", contenido: "<p>x</p>" });
      ok(r.status() === 403, `API: la autora no puede guardar en revisión (→ ${r.status()})`);
      r = await api(A, "POST", `/api/borradores/${id}/estado`, { accion: "aprobar", version: d.version });
      ok(r.status() === 403, `API: la autora no puede aprobar (→ ${r.status()})`);

      // 2. La editora lo ve en la cola.
      await E.goto("/escribir/revision");
      const fila = E.locator("table tbody tr", { hasText: TITULO });
      ok((await fila.count()) === 1, "editora: el borrador aparece en «Pendientes»");
      ok((await fila.locator(".marca").count()) === 0, "editora: sin marca «Reenviado» en el primer envío");
      await A.goto("/escribir/revision");
      ok(new URL(A.url()).pathname === "/escribir", "autora: /escribir/revision la redirige a /escribir");
      await E.goto("/escribir");
      ok(/Revisión \(\d+\)/.test(await E.locator("a.boton", { hasText: "Revisión" }).innerText()), "editora: el botón muestra «Revisión (n)»");
      await E.goto("/escribir/revision");
      await fila.getByRole("link").click();
      await E.waitForURL(`**${ruta}`);
      await E.locator(".estado-revision").waitFor();
      ok((await estadoRevision(E)) === "En revisión", "editora: abre el borrador «En revisión»");
      ok((await E.getByRole("button", { name: "Aprobar" }).count()) === 1, "editora: ve «Aprobar»");

      // 3. La editora lo devuelve con un comentario.
      d = await datosEditor(E);
      r = await api(E, "POST", `/api/borradores/${id}/estado`, { accion: "devolver", version: d.version, comentario: "   " });
      ok(r.status() === 422, `API: devolver sin comentario se rechaza (→ ${r.status()})`);
      r = await api(E, "POST", `/api/borradores/${id}/estado`, { accion: "devolver", version: "etag-viejo", comentario: "x" });
      ok(r.status() === 409, `API: devolver con versión antigua da conflicto (→ ${r.status()})`);
      await E.getByRole("button", { name: "Devolver al autor" }).click();
      const enviarDevolucion = E.getByRole("button", { name: "Devolver con este comentario" });
      ok(await enviarDevolucion.isDisabled(), "editora: no se puede devolver con el comentario vacío");
      await E.locator("#revision-comentario").fill(COMENTARIO);
      await enviarDevolucion.click();
      await E.waitForURL("**/escribir/revision");
      ok((await E.locator("table tbody tr", { hasText: TITULO }).count()) === 0, "editora: tras devolver, sale de «Pendientes»");

      // 4. La autora ve el comentario, edita y reenvía.
      await A.goto("/escribir");
      const filaAutora = A.locator("tr", { hasText: TITULO });
      ok((await filaAutora.innerText()).includes("Devuelto"), "autora: en su lista aparece «Devuelto»");
      ok((await filaAutora.innerText()).includes(COMENTARIO), "autora: en su lista ve el comentario (con «&» intacto)");
      await A.goto(ruta);
      await A.locator(".estado-revision").waitFor();
      ok((await estadoRevision(A)) === "Devuelto", "autora: el editor muestra «Devuelto»");
      ok((await A.locator(".comentario-revision blockquote").innerText()) === COMENTARIO, "autora: ve el comentario en el editor");
      ok(!(await A.locator("#ed-titulo").evaluate((e) => e.readOnly)), "autora: puede volver a editar");
      ok((await A.locator("#ed-titulo").inputValue()) === TITULO, "autora: el título se guardó tal cual (sin «&amp;»)");
      ok((await A.locator("#ed-resumen").inputValue()) === RESUMEN, "autora: el resumen se guardó tal cual (sin «&amp;», «&lt;»)");
      await A.locator(".cuerpo-editor").click();
      await A.keyboard.press("End");
      await A.keyboard.type(" Fuente: NASA.");
      // Reenvía en seguida: lo pendiente debe guardarse antes de cambiar de estado.
      await Promise.all([A.waitForNavigation(), A.getByRole("button", { name: "Enviar a revisión" }).click()]);
      await A.locator(".estado-revision").waitFor();
      ok((await estadoRevision(A)) === "En revisión", "autora: reenviado, «En revisión»");
      d = await datosEditor(A);
      ok(d.contenido.includes("Fuente: NASA."), "autora: el cambio hecho justo antes de reenviar se guardó");

      // 5. La editora ve la marca «Reenviado» y lo aprueba.
      await E.goto("/escribir/revision");
      const fila2 = E.locator("table tbody tr", { hasText: TITULO });
      ok((await fila2.locator(".marca").innerText().catch(() => "")) === "Reenviado", "editora: el borrador lleva «Reenviado»");
      await fila2.getByRole("link").click();
      await E.waitForURL(`**${ruta}`);
      // En revisión la editora puede editar: añade formato, una imagen en el texto y la destacada.
      r = await E.request.fetch(`/api/borradores/${id}/imagenes`, {
        method: "POST",
        headers: { "Content-Type": "image/png", Origin: base },
        data: PNG,
      });
      ok(r.status() === 201 || r.status() === 200, `editora: imagen subida (→ ${r.status()})`);
      const urlImagen = (await r.json()).url;
      d = await datosEditor(E);
      r = await api(E, "PUT", `/api/borradores/${id}`, {
        version: d.version,
        titulo: TITULO,
        resumen: RESUMEN,
        area: AREA,
        imagen: urlImagen,
        imagenAlt: "Luna llena",
        contenido:
          "<h2>Cómo observar</h2>" +
          '<p>Texto con <strong>negrita</strong>, <em>cursiva</em> y <a href="https://ace.ec">un enlace</a>. Cuesta 5 * 3 [nota].</p>' +
          "<ul><li><p>uno</p></li><li><p>dos</p></li></ul>" +
          "<blockquote><p>Nunca mires el Sol.</p></blockquote>" +
          `<img src="${urlImagen}" alt="Luna llena">` +
          "<p>Primera versión del texto. Fuente: NASA.</p>",
      });
      ok(r.status() === 200, `editora: guarda el texto con formato e imágenes (→ ${r.status()})`);
      await E.reload();
      await E.getByRole("button", { name: "Aprobar" }).click();
      await E.waitForURL("**/escribir/revision");
      ok((await E.locator("ul.lista li", { hasText: TITULO }).count()) === 1, "editora: aparece en «Aprobados»");
      ok((await E.locator("table tbody tr", { hasText: TITULO }).count()) === 0, "editora: ya no está en «Pendientes»");

      // Estado final para las dos.
      await A.goto(ruta);
      await A.locator(".estado-revision").waitFor();
      ok((await estadoRevision(A)) === "Aprobado", "autora: ve «Aprobado»");
      ok(await A.locator("#ed-titulo").evaluate((e) => e.readOnly), "autora: aprobado, en solo lectura");
      await E.goto(ruta);
      await E.locator(".estado-revision").waitFor();
      ok(await E.locator("#ed-titulo").evaluate((e) => e.readOnly), "editora: aprobado, también en solo lectura");
      ok((await E.getByRole("button", { name: "Devolver al autor" }).count()) === 1, "editora: puede devolver un aprobado");
      ok((await A.getByRole("button", { name: "Publicar" }).count()) === 0, "autora: no ve «Publicar»");

      // 6. Publicación (fase 4): solo editores, solo desde «aprobado», y nada toca GitHub si se rechaza.
      // Ya existe un artículo con la misma dirección: debe publicarse como «-2» sin pisarlo.
      github.commitDirecto({ [`src/content/blog/${SLUG}.md`]: '---\ntitulo: "Otro artículo"\n---\n' }, "Existing article");
      const commitsAntes = github.historial().length;
      d = await datosEditor(E);
      r = await api(A, "POST", `/api/borradores/${id}/publicar`, { version: d.version, autor: "michelle-perez" });
      ok(r.status() === 403, `API: la autora no puede publicar (→ ${r.status()})`);
      r = await api(E, "POST", `/api/borradores/${id}/estado`, { accion: "publicar", version: d.version });
      ok(r.status() === 400, `API: /estado no acepta «publicar» (→ ${r.status()})`);
      r = await api(E, "POST", `/api/borradores/${id}/publicar`, { version: "etag-viejo" });
      ok(r.status() === 409, `API: publicar con versión antigua da conflicto (→ ${r.status()})`);
      r = await api(E, "POST", `/api/borradores/${id}/publicar`, { version: d.version, autor: "no-existe" });
      ok(r.status() === 422 && (await r.json()).error === "autor", `API: publicar con una ficha que no existe (→ ${r.status()})`);
      ok(github.historial().length === commitsAntes, "los intentos rechazados no tocan GitHub");

      // Alguien empuja a main mientras se publica: debe reintentar sobre el nuevo commit, sin forzar.
      github.simularPushAjeno();
      await E.getByRole("button", { name: "Publicar" }).click();
      ok((await E.locator("#publicar-autor").inputValue()) === "michelle-perez", "editora: la ficha de la autora viene elegida");
      await Promise.all([
        E.waitForNavigation({ timeout: 30000 }),
        E.getByRole("button", { name: "Publicar ahora" }).click(),
      ]);
      await E.locator(".estado-revision").waitFor();
      ok((await estadoRevision(E)) === "Publicado", "editora: el estado pasa a «Publicado»");
      const SLUG_FINAL = `${SLUG}-2`;
      ok(
        (await E.getByRole("link", { name: "Ver en la web" }).getAttribute("href")) === `/blog/${SLUG_FINAL}`,
        `editora: enlace a /blog/${SLUG_FINAL}`,
      );
      ok(
        (await E.locator(".acciones-revision button").count()) === 0,
        "editora: publicado, ya sin acciones (ni devolver ni publicar otra vez)",
      );

      // Lo que ha llegado a GitHub.
      const rama = github.historial();
      ok(rama.length === commitsAntes + 2, `un commit de publicación más el ajeno (hay ${rama.length - commitsAntes})`);
      ok(rama[0].mensaje.startsWith(`Publish "${TITULO}"`), "commit con el mensaje de publicación");
      ok(rama[1].mensaje === "Someone else's commit" && !!github.archivo("AJENO.md"), "el commit ajeno se conserva (sin forzar)");
      ok(github.archivo(`src/content/blog/${SLUG}.md`)?.toString().includes("Otro artículo"), "no pisa el artículo que ya existía");
      // La imagen se publica optimizada: WebP de 1600 px de ancho como mucho y ≤ 300 KB.
      const rutaImagen = `/images/blog/${SLUG_FINAL}/${urlImagen.split("/").pop().replace(/\.png$/, ".webp")}`;
      const publicada = github.archivo(`public${rutaImagen}`);
      const tamano = tamanoWebp(publicada);
      ok(!!tamano, `imagen publicada en WebP (public${rutaImagen})`);
      ok(
        tamano?.ancho === 1600 && tamano?.alto === Math.round((1000 * 1600) / 2400),
        `imagen reducida de 2400×1000 a 1600×667 (es ${tamano?.ancho}×${tamano?.alto})`,
      );
      ok(
        !!publicada && publicada.length <= 300 * 1024,
        `imagen de ${Math.round((publicada?.length ?? 0) / 1024)} KB (original ${Math.round(PNG.length / 1024)} KB)`,
      );
      ok(!github.archivo(`public${rutaImagen.replace(/\.webp$/, ".png")}`), "no se sube el PNG original");
      const md = github.archivo(`src/content/blog/${SLUG_FINAL}.md`)?.toString() ?? "";
      const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(new Date());
      const frontmatter = [
        "---",
        `titulo: ${JSON.stringify(TITULO)}`,
        `descripcion: ${JSON.stringify(RESUMEN)}`,
        `fecha: ${fecha}`,
        `area: ${JSON.stringify(AREA)}`,
        "autor: michelle-perez",
        `imagen: "${rutaImagen}"`,
        'imagenAlt: "Luna llena"',
        "borrador: false",
        "---",
      ].join("\n");
      ok(md.startsWith(`${frontmatter}\n\n`), "Markdown: frontmatter completo y en orden");
      if (!md.startsWith(frontmatter)) console.log(md.slice(0, 600));
      for (const trozo of [
        "## Cómo observar",
        "**negrita**",
        "*cursiva*",
        "[un enlace](https://ace.ec)",
        "5 \\* 3 \\[nota\\]",
        "- uno\n- dos",
        "> Nunca mires el Sol.",
        `![Luna llena](${rutaImagen})`,
        "Fuente: NASA.",
      ]) {
        ok(md.includes(trozo), `Markdown: contiene ${JSON.stringify(trozo)}`);
      }
      ok(!md.includes("/api/imagenes/"), "Markdown: sin rutas privadas del editor");
      if (process.env.E2E_GUARDAR) {
        const dir = process.env.E2E_GUARDAR;
        fs.mkdirSync(path.join(dir, path.dirname(`public${rutaImagen}`)), { recursive: true });
        fs.mkdirSync(path.join(dir, "src/content/blog"), { recursive: true });
        fs.writeFileSync(path.join(dir, `src/content/blog/${SLUG_FINAL}.md`), md);
        fs.writeFileSync(path.join(dir, `public${rutaImagen}`), publicada);
      }

      // Después de publicar no se puede volver a publicar, devolver ni editar.
      d = await datosEditor(E);
      r = await api(E, "POST", `/api/borradores/${id}/publicar`, { version: d.version });
      ok(r.status() === 403, `API: no se publica dos veces (→ ${r.status()})`);
      r = await api(E, "POST", `/api/borradores/${id}/estado`, { accion: "devolver", version: d.version, comentario: "x" });
      ok(r.status() === 403, `API: no se devuelve un publicado (→ ${r.status()})`);
      r = await api(E, "PUT", `/api/borradores/${id}`, { version: d.version, titulo: "otro", contenido: "<p>x</p>" });
      ok(r.status() === 403, `API: no se edita un publicado (→ ${r.status()})`);
      ok(github.historial().length === rama.length, "ningún commit más");

      await A.goto("/escribir");
      ok((await A.locator("tr", { hasText: TITULO }).innerText()).includes("Publicado"), "autora: en su lista aparece «Publicado»");
      await A.goto(ruta);
      await A.locator(".estado-revision").waitFor();
      ok((await estadoRevision(A)) === "Publicado", "autora: el editor muestra «Publicado»");

      await E.locator(".historial summary").click();
      const historial = await E.locator(".historial li").allInnerTexts();
      ok(historial.length === 5, `historial con 5 eventos (hay ${historial.length})`);
      ok(
        historial[0].includes("lo publicó") && historial[1].includes("lo aprobó") && historial[4].includes("lo envió a revisión"),
        "historial en orden (último primero)",
      );
  } catch (e) {
    fallos.push(`excepción: ${e.message.split("\n")[0]}`);
    console.log("FALLO  excepción:", e.message.split("\n").slice(0, 3).join(" | "));
  }

  for (const e of errores) console.log("ERROR DEL NAVEGADOR", e);
  console.log(`\n${pasos - fallos.length}/${pasos} comprobaciones correctas, ${errores.length} errores del navegador`);
  await browser.close();
  return fallos.length + errores.length;
}
