import { config, collection, fields, singleton } from "@keystatic/core";
import { AREAS } from "./src/content/areas";

// Proyecto de Keystatic Cloud con el formato «equipo/proyecto».
const PROYECTO_CLOUD = "astrociencias/astrociencias-web";

/** Bloque con título y texto (los párrafos se separan con una línea en blanco). */
const bloqueTexto = (label: string) =>
  fields.object(
    {
      titulo: fields.text({ label: "Título", validation: { isRequired: true } }),
      texto: fields.text({
        label: "Texto",
        description: "Deja una línea en blanco entre párrafos.",
        multiline: true,
        validation: { isRequired: true },
      }),
    },
    { label },
  );

/** Botón con texto y dirección (p. ej. /colabora). */
const enlaceBoton = (label: string) =>
  fields.object(
    {
      texto: fields.text({ label: "Texto", validation: { isRequired: true } }),
      enlace: fields.text({ label: "Dirección (p. ej. /colabora)", validation: { isRequired: true } }),
    },
    { label },
  );

export default config({
  // En local se edita directamente en los archivos; en producción, con Keystatic Cloud.
  storage: import.meta.env.DEV ? { kind: "local" } : { kind: "cloud" },
  cloud: { project: PROYECTO_CLOUD },
  locale: "es-ES",

  ui: {
    brand: { name: "AstroCiencias Ecuador" },
    navigation: { Contenido: ["blog", "autores"], Páginas: ["quienesSomos", "colabora"] },
  },

  collections: {
    blog: collection({
      label: "Artículos del blog",
      slugField: "titulo",
      path: "src/content/blog/*",
      format: { contentField: "contenido" },
      entryLayout: "content",
      columns: ["titulo", "fecha"],
      previewUrl: "/blog/{slug}",
      schema: {
        titulo: fields.slug({
          name: { label: "Título" },
          slug: {
            label: "Dirección (URL)",
            description: "Se genera a partir del título. No la cambies una vez publicado.",
          },
        }),
        descripcion: fields.text({
          label: "Entradilla",
          description: "Una o dos frases. Se muestra bajo el título y en las tarjetas.",
          multiline: true,
          validation: { isRequired: true },
        }),
        fecha: fields.date({
          label: "Fecha de publicación",
          defaultValue: { kind: "today" },
          validation: { isRequired: true },
        }),
        area: fields.select({
          label: "Área",
          options: AREAS.map((a) => ({ label: a, value: a })),
          defaultValue: AREAS[0],
        }),
        tema: fields.text({
          label: "Tema (opcional)",
          description: "Etiqueta corta para la tarjeta, p. ej. «Radioastronomía».",
        }),
        autor: fields.relationship({
          label: "Autor o autora",
          collection: "autores",
          validation: { isRequired: true },
        }),
        imagen: fields.image({
          label: "Imagen destacada",
          directory: "public/images/blog",
          publicPath: "/images/blog/",
        }),
        imagenAlt: fields.text({
          label: "Texto alternativo de la imagen",
          description: "Describe la imagen para quien no puede verla.",
        }),
        borrador: fields.checkbox({
          label: "Borrador",
          description: "Si está marcado, el artículo no se publica en la web.",
          defaultValue: true,
        }),
        urlBlogger: fields.text({
          label: "URL antigua en Blogger (solo artículos migrados)",
        }),
        contenido: fields.markdoc({
          label: "Texto",
          extension: "md",
          options: {
            heading: [2, 3],
            image: {
              directory: "public/images/blog",
              publicPath: "/images/blog/",
            },
          },
        }),
      },
    }),

    autores: collection({
      label: "Autores",
      slugField: "nombre",
      path: "src/content/autores/*",
      format: { data: "yaml" },
      columns: ["nombre", "rol"],
      schema: {
        nombre: fields.slug({ name: { label: "Nombre" } }),
        rol: fields.text({ label: "Rol en ACE" }),
        bio: fields.text({ label: "Biografía breve", multiline: true }),
        foto: fields.image({
          label: "Foto",
          directory: "public/images/autores",
          publicPath: "/images/autores/",
        }),
        enlace: fields.url({ label: "Web o red social (opcional)" }),
      },
    }),
  },

  // Páginas de texto. Cada una tiene su colección en src/content.config.ts con el
  // mismo esquema (quienesSomos, colabora).
  singletons: {
    quienesSomos: singleton({
      label: "Quiénes somos",
      path: "src/content/paginas/quienes-somos",
      format: { data: "yaml" },
      schema: {
        cabecera: fields.object(
          {
            etiqueta: fields.text({ label: "Etiqueta sobre el título", validation: { isRequired: true } }),
            titulo: fields.text({ label: "Título", validation: { isRequired: true } }),
            lema: fields.text({ label: "Lema", multiline: true, validation: { isRequired: true } }),
            datos: fields.array(
              fields.object({
                etiqueta: fields.text({ label: "Etiqueta (p. ej. «Fundación»)", validation: { isRequired: true } }),
                valor: fields.text({ label: "Valor (p. ej. «2012»)", validation: { isRequired: true } }),
              }),
              {
                label: "Datos destacados",
                description: "Solo datos reales. Se muestran junto al título.",
                itemLabel: (props) => `${props.fields.etiqueta.value} · ${props.fields.valor.value}`,
              },
            ),
          },
          { label: "Cabecera" },
        ),
        intro: fields.text({
          label: "Introducción",
          description: "Deja una línea en blanco entre párrafos.",
          multiline: true,
          validation: { isRequired: true },
        }),
        historia: bloqueTexto("Nuestra historia (tarjeta grande)"),
        mision: bloqueTexto("Nuestra misión"),
        enfoque: bloqueTexto("Nuestro enfoque"),
        presencia: fields.object(
          {
            titulo: fields.text({ label: "Título", validation: { isRequired: true } }),
            intro: fields.text({
              label: "Introducción",
              description: "Deja una línea en blanco entre párrafos.",
              multiline: true,
              validation: { isRequired: true },
            }),
            equipos: fields.array(
              fields.object({
                nombre: fields.text({ label: "Ciudad o zona", validation: { isRequired: true } }),
                detalle: fields.text({ label: "Detalle (opcional, p. ej. ciudades que incluye)" }),
                estado: fields.select({
                  label: "Estado",
                  options: [
                    { label: "Equipo activo", value: "activo" },
                    { label: "En planificación", value: "planificacion" },
                  ],
                  defaultValue: "activo",
                }),
              }),
              { label: "Equipos", itemLabel: (props) => props.fields.nombre.value },
            ),
          },
          { label: "Presencia a nivel nacional" },
        ),
        queHacemos: fields.object(
          {
            titulo: fields.text({ label: "Título", validation: { isRequired: true } }),
            actividades: fields.array(
              fields.text({ label: "Actividad", multiline: true, validation: { isRequired: true } }),
              { label: "Actividades", itemLabel: (props) => props.value },
            ),
            cierre: fields.text({ label: "Frase de cierre", multiline: true }),
          },
          { label: "Qué hacemos" },
        ),
        equipo: fields.object(
          {
            titulo: fields.text({ label: "Título", validation: { isRequired: true } }),
            personas: fields.array(
              fields.object({
                nombre: fields.text({ label: "Nombre", validation: { isRequired: true } }),
                cargo: fields.text({ label: "Cargo", validation: { isRequired: true } }),
                foto: fields.image({
                  label: "Foto (opcional)",
                  description: "Cuadrada. Sin foto se muestran sus iniciales.",
                  directory: "public/images/equipo",
                  publicPath: "/images/equipo/",
                }),
              }),
              { label: "Personas", itemLabel: (props) => `${props.fields.nombre.value} · ${props.fields.cargo.value}` },
            ),
          },
          { label: "Liderazgo y coordinación" },
        ),
        llamada: fields.object(
          {
            titulo: fields.text({ label: "Título", validation: { isRequired: true } }),
            texto: fields.text({ label: "Texto (opcional)", multiline: true }),
            botonPrincipal: enlaceBoton("Botón principal"),
            botonSecundario: enlaceBoton("Botón secundario"),
          },
          { label: "Llamada final" },
        ),
      },
    }),
    colabora: singleton({
      label: "Colabora",
      path: "src/content/paginas/colabora",
      format: { data: "yaml" },
      schema: {
        titulo: fields.text({ label: "Título", validation: { isRequired: true } }),
        entradilla: fields.text({
          label: "Entradilla",
          description: "Una frase bajo el título.",
          multiline: true,
          validation: { isRequired: true },
        }),
        voluntariado: fields.object(
          {
            titulo: fields.text({ label: "Título de la tarjeta", validation: { isRequired: true } }),
            cita: fields.text({
              label: "Cita",
              description: "Se muestra entre comillas « ».",
              multiline: true,
              validation: { isRequired: true },
            }),
            introLista: fields.text({ label: "Frase antes de la lista", validation: { isRequired: true } }),
            actividades: fields.array(
              fields.text({ label: "Actividad", validation: { isRequired: true } }),
              { label: "Qué puede hacer un voluntario", itemLabel: (props) => props.value },
            ),
            boton: fields.text({ label: "Texto del botón", validation: { isRequired: true } }),
            asunto: fields.text({
              label: "Asunto del correo",
              description: "El botón abre un correo a la dirección de src/content/contacto.ts con este asunto.",
              validation: { isRequired: true },
            }),
          },
          { label: "Hazte voluntario" },
        ),
        colaboraciones: fields.object(
          {
            titulo: fields.text({ label: "Título de la tarjeta", validation: { isRequired: true } }),
            texto: fields.text({ label: "Texto", multiline: true, validation: { isRequired: true } }),
            boton: fields.text({ label: "Texto del botón", validation: { isRequired: true } }),
            asunto: fields.text({
              label: "Asunto del correo",
              description: "El botón abre un correo a la dirección de src/content/contacto.ts con este asunto.",
              validation: { isRequired: true },
            }),
          },
          { label: "Colaboraciones" },
        ),
        apoyo: fields.object(
          {
            titulo: fields.text({ label: "Título de la tarjeta", validation: { isRequired: true } }),
            texto: fields.text({ label: "Texto", multiline: true, validation: { isRequired: true } }),
          },
          { label: "Apóyanos (próximamente)" },
        ),
      },
    }),
  },
});
