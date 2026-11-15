// Prueba e2e del flujo de revisión (fase 3), en un navegador real:
// la autora envía → la editora lo ve en la cola → lo devuelve con un comentario
// → la autora edita y reenvía → la editora lo aprueba.
// También comprueba que el servidor aplica las reglas (403, 409, 422).
// Se ejecuta con `npm run test:e2e` (tests/e2e/ejecutar.mjs), que arranca
// `astro dev` con el sustituto de Identity de identidad-mock.mjs.

import { chromium } from "playwright-core";

/**
 * Ejecuta la prueba contra `base` (un `astro dev` con el sustituto de Identity).
 * Devuelve el número de comprobaciones fallidas más los errores del navegador.
 */
export async function probarFlujoRevision(base) {
  const TITULO = `E2E revisión ${Date.now()}`;
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
      await E.locator(".historial summary").click();
      const historial = await E.locator(".historial li").allInnerTexts();
      ok(historial.length === 4, `historial con 4 eventos (hay ${historial.length})`);
      ok(historial[0].includes("lo aprobó") && historial[3].includes("lo envió a revisión"), "historial en orden (último primero)");
  } catch (e) {
    fallos.push(`excepción: ${e.message.split("\n")[0]}`);
    console.log("FALLO  excepción:", e.message.split("\n").slice(0, 3).join(" | "));
  }

  for (const e of errores) console.log("ERROR DEL NAVEGADOR", e);
  console.log(`\n${pasos - fallos.length}/${pasos} comprobaciones correctas, ${errores.length} errores del navegador`);
  await browser.close();
  return fallos.length + errores.length;
}
