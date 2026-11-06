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
- Páginas: `/blog`, `/blog/[slug]`, `/autores`, `/colabora/escribe` (y su `/gracias`).
- `public/`: escudo.png y logotipo-blanco.png; Keystatic guarda las imágenes en `public/images/blog/` y `public/images/autores/`.

## Diseño
- Estilo científico y tecnológico, tipo panel de observatorio: fondo azul noche, cuadrícula técnica sutil, órbitas y etiquetas en monoespaciada.
- Colores: `--cosmos` #061423 (fondo), `--cosmos-2` #0b1a2a, `--cosmos-3` #0b2a44, `--linea` #1c3954, `--texto` #eef2f6, `--texto-suave` #a9b8c6, `--azul` #4fa3cf (botones y enlaces), `--dorado` #c6b99b (detalles y etiquetas).
- Tipografías: Space Grotesk (títulos), Source Sans 3 (texto), JetBrains Mono (etiquetas).
- Los artículos del blog van en fondo blanco, en modo lectura.
- Sin degradados morados ni emojis. Accesible: contraste 4.5:1, enlaces y botones reales, textos alternativos.

## Portada (orden de secciones)
1. Héroe: «Explorando ciencia y tecnología desde el cosmos», botones «Leer el blog» y «Únete como voluntario».
2. Barra de próximo evento.
3. Áreas: Astronomía y astrofísica, Física y química, Biología y salud, Ciencias de la Tierra, Tecnología e IA, Mujer y niña en la ciencia.
4. Últimos artículos del blog (desde la colección).
5. Recursos: revista Astro&Ciencias, podcast (Spotify), AstroCiencias Radio, charlas en YouTube, biblioteca virtual.
6. Colabora: voluntariado y donaciones.
7. Pie con redes: Instagram, Facebook, TikTok, YouTube, LinkedIn, X.

## Reglas
- Todo el texto en español.
- No inventes datos de la asociación: usa marcadores entre corchetes, como [Texto de presentación].
- El calendario de eventos calculado automáticamente queda FUERA de esta web: es parte del TFG de Michelle y se conectará más adelante mediante una API. Aquí los eventos se escriben a mano.
- Al migrar desde Blogger, conserva las URL antiguas con redirecciones en Netlify.
