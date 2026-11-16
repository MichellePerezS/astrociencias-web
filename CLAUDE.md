# Web de AstroCiencias Ecuador (ACE)

Web y blog de AstroCiencias Ecuador, asociación de divulgación de astronomía y más ciencias desde 2012. Sustituye al blog actual en Blogger (astrocienciasecu.blogspot.com).

## Pila técnica
- Astro (plantilla mínima), sin frameworks de UI ni Tailwind: CSS propio con variables.
- Contenido del blog en Markdown con colecciones de contenido de Astro.
- Despliegue en Netlify (adaptador `@astrojs/netlify`): las páginas son estáticas; solo el panel de Keystatic se ejecuta como función.
- Editor visual: Keystatic en `/keystatic`, con almacenamiento local en desarrollo y Keystatic Cloud en producción (equipo editorial de 3 personas). Configuración en `keystatic.config.ts`; su esquema debe coincidir con `src/content.config.ts`.
- Formularios con Netlify Forms: boletín (`boletin`) y envío de artículos (`articulo-colaborador`). Comentarios con Cusdis (`PUBLIC_CUSDIS_APP_ID`).

## Estructura
- `src/styles/global.css`: variables de color, tipografía, espacios y botones. Usa siempre estas variables, no colores sueltos.
- `src/layouts/Base.astro`: estructura común (cabecera, pie, fuentes, metadatos).
- `src/components/`: Header, Footer y una pieza por sección de la portada.
- `src/pages/index.astro`: portada.
- `src/content/blog/`: un `.md` por artículo; esquema en `src/content.config.ts`.
- `src/content/autores/`: un `.yaml` por autor; los artículos lo citan en `autor` por su nombre de archivo.
- `src/content/areas.ts`: lista única de áreas, compartida por el esquema, Keystatic y los formularios.
- Páginas: `/blog`, `/blog/[slug]`, `/autores`, `/quienes-somos`, `/recursos`, `/colabora`, `/colabora/escribe` (y su `/gracias`).
- Páginas de texto editables en Keystatic (grupo «Páginas»): un singleton por página, guardado en `src/content/paginas/<página>.yaml`, con su propia colección y el mismo esquema en `src/content.config.ts` (`quienesSomos`, `colabora`). En los campos de varias líneas, una línea en blanco separa párrafos. Correo y WhatsApp vienen de `src/content/contacto.ts`, compartido con el pie.
  - `/quienes-somos`: cabecera con datos destacados (solo datos reales), introducción, historia + misión + enfoque, presencia nacional (equipos con estado «Equipo activo» o «En planificación»), qué hacemos, liderazgo y coordinación (personas con foto opcional en `public/images/equipo/`; sin foto, iniciales) y llamada final con dos botones. Todo, incluidas las listas y los enlaces de los botones, se edita en Keystatic.
  - `/colabora`: tres tarjetas. Voluntariado (botón `mailto:` con asunto), colaboraciones (visitas a escuelas, colegios o universidades y otras propuestas, con botón `mailto:`) y donaciones («Próximamente», sin enlace). El botón «Colabora» de la cabecera lleva aquí.
- `/recursos` (`src/pages/recursos.astro`, lista y enlaces en `src/content/recursos.ts`, compartida con la franja de la portada): revista Astro&Ciencias (de momento «Próximamente», sin enlace), podcast (Spotify), AstroCiencias Radio (Zeno.fm), charlas en YouTube y biblioteca virtual (Google Drive). En la portada solo hay una franja pequeña con cuatro de ellos; el enlace «Recursos» de la cabecera lleva a esta página.
- Editor propio (en construcción por fases, independiente de Keystatic): zona privada `/escribir`, acceso en `/escribir/entrar`.
  - Login con Netlify Identity, solo por invitación (`gotrue-js` en el navegador).
  - Roles en `app_metadata.roles`: `editor` (ve todo) o `autor` + `autor:<slug>` (ve los artículos de `src/content/autores/<slug>.yaml`).
  - El servidor valida el token contra Identity en cada petición (`src/middleware.ts`, `src/lib/identidad.ts`); el navegador lo entrega en `/api/sesion` y se guarda en la cookie HttpOnly `ace_sesion`.
  - Toda página nueva bajo `/escribir` debe llevar `export const prerender = false`.
  - Fase 2: editor visual TipTap (isla React `src/components/editor/EditorArticulo.tsx`) en `/escribir/nuevo` y `/escribir/editar/[id]`, con guardado automático.
    - Borradores en Netlify Blobs, tienda `editor-borradores` (clave = id); imágenes en `editor-imagenes` (`<id>/<uuid>.<ext>`). Lógica y permisos en `src/lib/borradores.ts`: el autor solo accede a lo que creó (`propietario.id`), el editor a todo; si no hay permiso se responde 404.
    - API privada: `POST /api/borradores`, `PUT /api/borradores/[id]` (con `version` = ETag; si no coincide, 409), `POST /api/borradores/[id]/imagenes`, `GET /api/imagenes/[borrador]/[archivo]`. El middleware exige sesión y, en escrituras, mismo `Origin`.
    - El HTML se limpia en el servidor con `src/lib/limpiar-html.ts` (solo p, h2, h3, strong, em, listas, a, blockquote e imágenes del propio borrador). Imágenes: JPG, PNG, WebP o GIF comprobados por sus bytes, máximo 4 MB (`src/lib/imagenes.ts`); SVG no.
    - En `astro dev`, el emulador local de Blobs no envía ETag al leer: `leerBorrador` lo toma del listado (solo en dev) y avisa en la terminal del motivo de cada 404.
    - Publicar en GitHub es la fase 4 (abajo).
  - Fase 3: flujo de revisión. Estados `edicion` → `revision` → `aprobado`, y `devuelto` (con comentario obligatorio) desde `revision` o `aprobado`. Las reglas están en `src/lib/flujo.ts` y se aplican siempre en el servidor:
    - Enviar: solo el propietario, desde `edicion` o `devuelto`, con título y texto. Aprobar y devolver: solo editores.
    - Editar: propietario y editores en `edicion`/`devuelto`; solo editores en `revision`; nadie en `aprobado` (403).
    - `POST /api/borradores/[id]/estado` con `{ accion, version, comentario? }`; con versión antigua, 409. Cada acción queda en `historial`.
    - Cola de editores en `/escribir/revision`, con los más antiguos primero y la marca «Reenviado».
  - Fase 4: publicación. Un editor pulsa «Publicar» en un borrador `aprobado` → `POST /api/borradores/[id]/publicar` (`{ version }`) → `src/lib/publicar.ts`:
    - Solo editores y solo desde `aprobado`, comprobado en el servidor. `/estado` no acepta `publicar`: el estado `publicado` solo se pone después de subir a GitHub. `publicado` es final: nadie edita ni devuelve.
    - Exige título, resumen, área y texto.
    - El autor es siempre la ficha del rol `autor:<ficha>` de quien creó el borrador (`Borrador.autor`, en `src/lib/firma.ts`); nadie lo elige y el servidor ignora cualquier autor que mande el navegador. Se muestra como texto en el editor, la cola y el diálogo de publicar. Los editores también pueden tener `autor:<ficha>` (solo firma, no cambia permisos). `Borrador.autor` se actualiza cada vez que el propietario guarda o envía.
    - Sin ficha (`sin-ficha`) o con una que no existe en `src/content/autores` (`ficha-inexistente`) no se publica (422): un editor debe asignar el rol `autor:<ficha>` en Netlify Identity y devolver el borrador para que su creador lo reenvíe.
    - Convierte el HTML a Markdown (`src/lib/markdown.ts`, escapa la sintaxis de Markdown) con el frontmatter del esquema del blog, `fecha` = hoy en Ecuador y `borrador: false`.
    - Imágenes (`src/lib/optimizar-imagen.ts`): máximo 1600 px de ancho y WebP (calidad 82, bajando hasta 60 si pasa de 300 KB); los GIF van tal cual. Códecs de @jsquash en WebAssembly incrustados con `?inline` (no sharp: sin binarios nativos) y reducción propia en JavaScript, fila a fila, para no acercarse al límite de 1024 MB de la función.
    - Un solo commit en la rama con `src/content/blog/<slug>.md` y `public/images/blog/<slug>/…` (`src/lib/github.ts`, Git Data API). Si el slug existe, `-2`, `-3`…; si el .md idéntico ya existe (reintento), no vuelve a subirlo. Si la rama avanza, reintenta sin forzar. Netlify recompila con el commit.
    - Variables (solo servidor, de `process.env`, nunca `import.meta.env` ni `PUBLIC_`): `ACE_GITHUB_TOKEN` (fine-grained, solo este repositorio, «Contents: Read and write»), `ACE_GITHUB_REPO` (`propietario/repo`), `ACE_GITHUB_RAMA` (por defecto `main`), `ACE_GITHUB_API` (solo para pruebas). En `astro dev`, `astro.config.mjs` las copia de `.env`.
    - Los títulos y resúmenes se guardan como texto plano (sin entidades HTML): `textoPlano` decodifica lo que devuelve sanitize-html.
  - Prueba e2e del flujo de revisión y publicación: `npm run test:e2e` (`tests/e2e/`). Usa Chrome instalado (o `CHROME_PATH`) con `playwright-core` y sustitutos locales de Identity (autora y editora) y de la API de GitHub (repositorio en memoria); nunca escribe en el repositorio real. Arranca y para su propio `astro dev`, así que antes hay que parar el que esté en marcha (`npx astro dev stop`). Restaura `.netlify/blobs-serve` al acabar. Si cambias el flujo o los textos de la interfaz que comprueba, actualízala.
  - Correos de Identity: se usan los de por defecto (las plantillas propias exigen el plan Pro de Netlify). Enlazan a la portada con `#invite_token`, `#recovery_token` o `#confirmation_token`; un script mínimo en `Base.astro` redirige a `/escribir/entrar` conservando el hash, y esa página procesa los tres tokens. No quites ese script de Base.
  - En local, `IDENTITY_URL` apunta a la Identity del sitio publicado y `PUBLIC_IDENTITY_URL=/identidad-dev`, un proxy de Vite (solo en `astro dev`, en `astro.config.mjs`) que reenvía a ella para evitar el error de CORS. En producción `PUBLIC_IDENTITY_URL` no se define y se usa `/.netlify/identity`.
- `public/`: escudo.png y logotipo-blanco.png; Keystatic guarda las imágenes en `public/images/blog/` y `public/images/autores/`.

## Diseño
- Estilo científico y tecnológico, tipo panel de observatorio: fondo azul noche, cuadrícula técnica sutil, órbitas y etiquetas en monoespaciada.
- Colores: `--cosmos` #061423 (fondo), `--cosmos-2` #0b1a2a, `--cosmos-3` #0b2a44, `--linea` #1c3954, `--texto` #eef2f6, `--texto-suave` #a9b8c6, `--azul` #4fa3cf (botones y enlaces), `--dorado` #c6b99b (detalles y etiquetas).
- Tipografías: Space Grotesk (títulos), Source Sans 3 (texto), JetBrains Mono (etiquetas).
- Los artículos del blog van en fondo blanco, en modo lectura.
- Sin degradados morados ni emojis. Accesible: contraste 4.5:1, enlaces y botones reales, textos alternativos.

## Portada (orden de secciones)
Portada simplificada:
1. «Destacado» (`src/components/Destacado.astro`): una tarjeta grande con imagen, título, resumen y botón. Lo decide `obtenerDestacado()` en `src/lib/destacado.ts`: el próximo evento si existe (`proximoEvento()`, que aún devuelve null porque no hay fuente de eventos) y, si no, el último artículo publicado. El componente solo recibe el tipo `Destacado`, así que para los eventos basta con implementar `proximoEvento()`.
2. Últimos artículos del blog (`UltimosArticulos.astro`): los tres más recientes sin repetir el del destacado (prop `excluir`).
3. Franja compacta «Escucha, mira y lee» (`FranjaRecursos.astro`): podcast, radio, charlas en YouTube y revista («Próximamente»), con enlace a `/recursos`.
4. Pie con contacto (correo y WhatsApp) y redes: Instagram, Facebook, TikTok, YouTube, LinkedIn, X.

La portada no muestra un título visible: lleva un `h1` solo para lectores de pantalla.

Los recursos tienen su propia página, `/recursos`; en la portada solo va la franja compacta.

## Reglas
- Todo el texto en español.
- Excepción: los mensajes de commit se escriben en inglés.
- Nunca ejecutes `git add`, `git commit` ni `git push`: Michelle lo hace ella misma. Al terminar un cambio, enumera los archivos modificados y propón un mensaje de commit breve en inglés.
- No inventes datos de la asociación: usa marcadores entre corchetes, como [Texto de presentación].
- El calendario de eventos calculado automáticamente queda FUERA de esta web: es parte del TFG de Michelle y se conectará más adelante mediante una API. Aquí los eventos se escriben a mano.
- Al migrar desde Blogger, conserva las URL antiguas con redirecciones en Netlify.
