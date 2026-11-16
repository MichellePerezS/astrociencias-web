import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { AREAS } from "./content/areas";

// Este esquema debe coincidir con keystatic.config.ts.
// Los campos opcionales aceptan null porque Keystatic guarda así los campos vacíos.

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    titulo: z.string(),
    // Entradilla: se muestra bajo el título y en las tarjetas.
    descripcion: z.string(),
    fecha: z.coerce.date(),
    area: z.enum(AREAS),
    // Etiqueta corta opcional para la tarjeta (p. ej. «Radioastronomía»).
    tema: z.string().nullish(),
    autor: reference("autores"),
    imagen: z.string().nullish(),
    imagenAlt: z.string().nullish(),
    // URL antigua en Blogger, para generar redirecciones al migrar.
    urlBlogger: z.string().nullish(),
    borrador: z.boolean().default(false),
  }),
});

const autores = defineCollection({
  loader: glob({ pattern: "**/*.yaml", base: "./src/content/autores" }),
  schema: z.object({
    nombre: z.string(),
    rol: z.string().nullish(),
    bio: z.string().nullish(),
    foto: z.string().nullish(),
    enlace: z.string().nullish(),
  }),
});

// Páginas de texto editables en Keystatic como singletons (un .yaml por página).
// Los párrafos van en campos de texto de varias líneas: una línea en blanco
// separa párrafos.
const paginas = defineCollection({
  loader: glob({ pattern: "*.yaml", base: "./src/content/paginas" }),
  schema: z.object({
    // Quiénes somos (src/content/paginas/quienes-somos.yaml).
    titulo: z.string(),
    entradilla: z.string(),
    historia: z.string(),
    mision: z.string(),
    cita: z.string().nullish(),
    queHacemos: z.array(z.string()),
    dondeEstamos: z.string(),
    contacto: z.string(),
  }),
});

export const collections = { blog, autores, paginas };
