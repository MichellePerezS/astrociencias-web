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

// Páginas de texto editables en Keystatic como singletons: un .yaml por página
// en src/content/paginas y una colección por página (cada una con su esquema,
// igual que su singleton en keystatic.config.ts). Los párrafos van en campos de
// texto de varias líneas: una línea en blanco separa párrafos.
const paginaDe = (archivo: string) => glob({ pattern: archivo, base: "./src/content/paginas" });

// Quiénes somos (src/content/paginas/quienes-somos.yaml).
const bloqueTexto = z.object({ titulo: z.string(), texto: z.string() });
const boton = z.object({ texto: z.string(), enlace: z.string() });

const quienesSomos = defineCollection({
  loader: paginaDe("quienes-somos.yaml"),
  schema: z.object({
    cabecera: z.object({
      etiqueta: z.string(),
      titulo: z.string(),
      lema: z.string(),
      datos: z.array(z.object({ etiqueta: z.string(), valor: z.string() })),
    }),
    intro: z.string(),
    historia: bloqueTexto,
    mision: bloqueTexto,
    enfoque: bloqueTexto,
    presencia: z.object({
      titulo: z.string(),
      intro: z.string(),
      equipos: z.array(
        z.object({
          nombre: z.string(),
          detalle: z.string().nullish(),
          estado: z.enum(["activo", "planificacion"]),
        }),
      ),
    }),
    queHacemos: z.object({
      titulo: z.string(),
      actividades: z.array(z.string()),
      cierre: z.string().nullish(),
    }),
    equipo: z.object({
      titulo: z.string(),
      personas: z.array(z.object({ nombre: z.string(), cargo: z.string(), foto: z.string().nullish() })),
    }),
    llamada: z.object({
      titulo: z.string(),
      texto: z.string().nullish(),
      botonPrincipal: boton,
      botonSecundario: boton,
    }),
  }),
});

// Colabora (src/content/paginas/colabora.yaml).
const colabora = defineCollection({
  loader: paginaDe("colabora.yaml"),
  schema: z.object({
    titulo: z.string(),
    entradilla: z.string(),
    voluntariado: z.object({
      titulo: z.string(),
      cita: z.string(),
      introLista: z.string(),
      actividades: z.array(z.string()),
      boton: z.string(),
      asunto: z.string(),
    }),
    colaboraciones: z.object({
      titulo: z.string(),
      texto: z.string(),
      boton: z.string(),
      asunto: z.string(),
    }),
    apoyo: z.object({
      titulo: z.string(),
      texto: z.string(),
    }),
  }),
});

export const collections = { blog, autores, quienesSomos, colabora };
