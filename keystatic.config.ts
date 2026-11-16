import { config, collection, fields, singleton } from "@keystatic/core";
import { AREAS } from "./src/content/areas";

// Proyecto de Keystatic Cloud con el formato «equipo/proyecto».
const PROYECTO_CLOUD = "astrociencias/astrociencias-web";

export default config({
  // En local se edita directamente en los archivos; en producción, con Keystatic Cloud.
  storage: import.meta.env.DEV ? { kind: "local" } : { kind: "cloud" },
  cloud: { project: PROYECTO_CLOUD },
  locale: "es-ES",

  ui: {
    brand: { name: "AstroCiencias Ecuador" },
    navigation: { Contenido: ["blog", "autores"], Páginas: ["quienesSomos"] },
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

  // Páginas de texto. Su esquema está en src/content.config.ts (colección «paginas»).
  singletons: {
    quienesSomos: singleton({
      label: "Quiénes somos",
      path: "src/content/paginas/quienes-somos",
      format: { data: "yaml" },
      schema: {
        titulo: fields.text({ label: "Título", validation: { isRequired: true } }),
        entradilla: fields.text({
          label: "Entradilla",
          description: "Una o dos frases bajo el título.",
          multiline: true,
          validation: { isRequired: true },
        }),
        historia: fields.text({
          label: "Historia",
          description: "Deja una línea en blanco entre párrafos.",
          multiline: true,
          validation: { isRequired: true },
        }),
        mision: fields.text({
          label: "Misión",
          description: "Deja una línea en blanco entre párrafos.",
          multiline: true,
          validation: { isRequired: true },
        }),
        cita: fields.text({
          label: "Cita destacada",
          description: "Frase que se muestra resaltada junto a la misión (opcional).",
          multiline: true,
        }),
        queHacemos: fields.array(
          fields.text({ label: "Actividad", validation: { isRequired: true } }),
          { label: "Qué hacemos", itemLabel: (props) => props.value },
        ),
        dondeEstamos: fields.text({
          label: "Dónde estamos",
          description: "Deja una línea en blanco entre párrafos.",
          multiline: true,
          validation: { isRequired: true },
        }),
        contacto: fields.text({
          label: "Contacto (texto)",
          description: "El correo y el WhatsApp se muestran debajo; se cambian en src/content/contacto.ts.",
          multiline: true,
          validation: { isRequired: true },
        }),
      },
    }),
  },
});
