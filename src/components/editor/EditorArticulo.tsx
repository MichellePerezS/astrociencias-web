// Editor visual de artículos (isla de React con TipTap).
// Guarda solo, unos segundos después de cada cambio, en /api/borradores.
// El servidor vuelve a validar y limpiar todo lo que llega desde aquí,
// y comprueba el rol en cada cambio de estado del flujo de revisión.

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import FileHandler from "@tiptap/extension-file-handler";
import { AREAS } from "../../content/areas";
import type { DatosFirma } from "../../lib/firma";
import { ETIQUETAS_ESTADO, type Accion, type EstadoBorrador } from "../../lib/flujo";
import { MAX_BYTES_IMAGEN, TIPOS_IMAGEN } from "../../lib/imagenes";
import { LIMITES } from "../../lib/limites";
import "./editor.css";

export interface DatosIniciales {
  id: string | null;
  version: string | null;
  titulo: string;
  resumen: string;
  area: string | null;
  imagen: string | null;
  imagenAlt: string;
  contenido: string;
  actualizado: string | null;
  /** Estado en el flujo de revisión. */
  estadoRevision: EstadoBorrador;
  /** Si el usuario puede editar el contenido en este estado (lo decide el servidor). */
  editable: boolean;
  /** Acciones de revisión que el usuario puede aplicar (el servidor las vuelve a comprobar). */
  acciones: Accion[];
  /** Último comentario al devolverlo, si está devuelto. */
  devolucion: { comentario: string; por: string; fecha: string } | null;
  /** Nombre de quien creó el borrador (para explicar qué falta si no tiene ficha). */
  creador: string;
  /** Autor con el que se publica: la ficha del rol «autor:<ficha>» del creador (src/lib/firma.ts). */
  firma: DatosFirma;
  /** Dónde quedó publicado, si lo está. */
  publicacion: { slug: string; urlCommit: string } | null;
}

interface Campos {
  titulo: string;
  resumen: string;
  area: string;
  imagen: string | null;
  imagenAlt: string;
}

type Estado =
  | "sin-cambios"
  | "pendiente"
  | "guardando"
  | "guardado"
  | "error"
  | "conflicto"
  | "sesion"
  | "solo-lectura"
  | "bloqueado";

const ESPERA_GUARDADO_MS = 1500;
const REINTENTO_MS = 10_000;
const TIPOS_ACEPTADOS = Object.keys(TIPOS_IMAGEN);
const MB = (MAX_BYTES_IMAGEN / 1024 / 1024).toFixed(0);

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" });

export default function EditorArticulo({ inicial }: { inicial: DatosIniciales }) {
  const [campos, setCampos] = useState<Campos>({
    titulo: inicial.titulo,
    resumen: inicial.resumen,
    area: inicial.area ?? "",
    imagen: inicial.imagen,
    imagenAlt: inicial.imagenAlt,
  });
  const editable = inicial.editable;
  const [estado, setEstado] = useState<Estado>(
    !editable ? "solo-lectura" : inicial.actualizado ? "guardado" : "sin-cambios",
  );
  const [ultimoGuardado, setUltimoGuardado] = useState(inicial.actualizado);
  const [aviso, setAviso] = useState("");
  const [subiendo, setSubiendo] = useState(0);

  // Referencias para que el guardado use siempre los datos más recientes.
  const idRef = useRef(inicial.id);
  const versionRef = useRef(inicial.version);
  const camposRef = useRef(campos);
  const editorRef = useRef<Editor | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guardando = useRef(false);
  const otraVez = useRef(false);
  const bloqueado = useRef(!editable);
  const creando = useRef<Promise<string> | null>(null);
  /** Guardado en marcha (para esperar a que termine antes de cambiar de estado). */
  const enCurso = useRef<Promise<void> | null>(null);
  /** Hay cambios que todavía no ha confirmado el servidor. */
  const sucio = useRef(false);

  /** Crea el borrador en el servidor la primera vez que hace falta. */
  const asegurarId = useCallback(async (): Promise<string> => {
    if (idRef.current) return idRef.current;
    creando.current ??= (async () => {
      const r = await fetch("/api/borradores", { method: "POST" });
      if (r.status === 401) throw new Error("sesion");
      if (!r.ok) throw new Error("crear");
      const { id, version } = (await r.json()) as { id: string; version: string };
      idRef.current = id;
      versionRef.current = version;
      history.replaceState(null, "", `/escribir/editar/${id}`);
      return id;
    })();
    try {
      return await creando.current;
    } finally {
      creando.current = null;
    }
  }, []);

  const guardar = useCallback((): Promise<void> => {
    if (bloqueado.current) return Promise.resolve();
    if (guardando.current) {
      otraVez.current = true;
      return enCurso.current ?? Promise.resolve();
    }
    if (temporizador.current) clearTimeout(temporizador.current);
    guardando.current = true;
    setEstado("guardando");

    enCurso.current = (async () => {
      try {
        const id = await asegurarId();
        // Lo que se envía ahora; si se cambia algo durante el envío, vuelve a quedar sucio.
        sucio.current = false;
        const r = await fetch(`/api/borradores/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: versionRef.current,
            ...camposRef.current,
            area: camposRef.current.area || null,
            contenido: editorRef.current?.getHTML() ?? "",
          }),
        });

        if (r.ok) {
          const { version, actualizado } = (await r.json()) as { version: string; actualizado: string };
          versionRef.current = version;
          setUltimoGuardado(actualizado);
          setEstado(otraVez.current ? "pendiente" : "guardado");
          setAviso("");
          return;
        }
        sucio.current = true;
        if (r.status === 409) {
          bloqueado.current = true;
          setEstado("conflicto");
        } else if (r.status === 401) {
          bloqueado.current = true;
          setEstado("sesion");
        } else if (r.status === 403) {
          // El borrador ha cambiado de estado (p. ej. lo han enviado a revisión en otra pestaña).
          bloqueado.current = true;
          setEstado("bloqueado");
        } else if (r.status === 413) {
          setEstado("error");
          setAviso("El texto es demasiado largo para guardarlo. Divide el artículo o quita contenido.");
        } else {
          throw new Error(String(r.status));
        }
      } catch (e) {
        sucio.current = true;
        if ((e as Error).message === "sesion") {
          bloqueado.current = true;
          setEstado("sesion");
        } else {
          setEstado("error");
          temporizador.current = setTimeout(() => void guardar(), REINTENTO_MS);
        }
      } finally {
        guardando.current = false;
        enCurso.current = null;
        if (otraVez.current && !bloqueado.current) {
          otraVez.current = false;
          void guardar();
        }
      }
    })();
    return enCurso.current;
  }, [asegurarId]);

  /** Guarda ya lo pendiente y espera. Devuelve false si queda algo sin guardar. */
  const guardarTodo = useCallback(async (): Promise<boolean> => {
    if (temporizador.current) clearTimeout(temporizador.current);
    for (let i = 0; i < 5; i++) {
      if (enCurso.current) {
        await enCurso.current;
      } else if (sucio.current && !bloqueado.current) {
        await guardar();
      } else {
        break;
      }
    }
    return !sucio.current && !enCurso.current;
  }, [guardar]);

  /** Programa un guardado poco después del último cambio. */
  const programar = useCallback(() => {
    if (bloqueado.current) return;
    sucio.current = true;
    setEstado("pendiente");
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => void guardar(), ESPERA_GUARDADO_MS);
  }, [guardar]);

  const cambiar = <K extends keyof Campos>(campo: K, valor: Campos[K]) => {
    camposRef.current = { ...camposRef.current, [campo]: valor };
    setCampos(camposRef.current);
    programar();
  };

  /** Sube una imagen al borrador y devuelve su URL. */
  const subirImagen = useCallback(
    async (archivo: File): Promise<string | null> => {
      if (!TIPOS_ACEPTADOS.includes(archivo.type)) {
        setAviso(`«${archivo.name}» no es una imagen admitida. Usa JPG, PNG, WebP o GIF.`);
        return null;
      }
      if (archivo.size > MAX_BYTES_IMAGEN) {
        setAviso(`«${archivo.name}» pesa más de ${MB} MB. Redúcela antes de subirla.`);
        return null;
      }
      setSubiendo((n) => n + 1);
      try {
        const id = await asegurarId();
        const r = await fetch(`/api/borradores/${id}/imagenes`, {
          method: "POST",
          headers: { "Content-Type": archivo.type },
          body: archivo,
        });
        if (r.ok) {
          setAviso("");
          return ((await r.json()) as { url: string }).url;
        }
        setAviso(
          r.status === 415
            ? `«${archivo.name}» no es una imagen válida.`
            : r.status === 413
              ? `«${archivo.name}» pesa más de ${MB} MB.`
              : r.status === 401
                ? "Tu sesión ha caducado. Vuelve a entrar para subir imágenes."
                : r.status === 403
                  ? "Este borrador ya no se puede editar en su estado actual."
                  : `No se pudo subir «${archivo.name}». Inténtalo de nuevo.`,
        );
        return null;
      } catch {
        setAviso(`No se pudo subir «${archivo.name}». Comprueba la conexión.`);
        return null;
      } finally {
        setSubiendo((n) => n - 1);
      }
    },
    [asegurarId],
  );

  const insertarImagenes = useCallback(
    async (editor: Editor, archivos: File[], posicion?: number) => {
      for (const archivo of archivos) {
        const url = await subirImagen(archivo);
        if (!url) continue;
        const nodo = { type: "image", attrs: { src: url, alt: "" } };
        if (posicion === undefined) editor.chain().focus().insertContent(nodo).run();
        else editor.chain().insertContentAt(posicion, nodo).focus().run();
      }
    },
    [subirImagen],
  );

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    content: inicial.contenido,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null },
        },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      FileHandler.configure({
        consumePasteEvent: true,
        onDrop: (ed, archivos, posicion) => void insertarImagenes(ed, archivos, posicion),
        onPaste: (ed, archivos) => void insertarImagenes(ed, archivos),
      }),
    ],
    editorProps: {
      attributes: { class: "cuerpo-editor", "aria-label": "Cuerpo del artículo" },
      // Las imágenes pegadas desde otras webs no se guardan: hay que subirlas.
      transformPastedHTML: (html) => html.replace(/<img\b[^>]*>/gi, ""),
    },
    onUpdate: () => programar(),
  });
  editorRef.current = editor;

  // Avisa al salir con cambios sin guardar.
  useEffect(() => {
    const alSalir = (e: BeforeUnloadEvent) => {
      if (estado === "pendiente" || estado === "guardando" || subiendo > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [estado, subiendo]);

  // Cambios de estado del flujo de revisión
  const [procesando, setProcesando] = useState(false);
  const ejecutar = async (
    accion: Accion,
    datos: { comentario?: string } = {},
  ): Promise<boolean> => {
    setProcesando(true);
    setAviso("");
    try {
      if (!(await guardarTodo())) {
        setAviso("Hay cambios sin guardar. Espera a que se guarden (o recarga la página) e inténtalo de nuevo.");
        return false;
      }
      const id = idRef.current;
      if (!id) {
        setAviso("Escribe el título y el texto antes de enviarlo a revisión.");
        return false;
      }
      // Publicar va por su propio endpoint: sube el artículo a GitHub antes de cambiar el estado.
      const r =
        accion === "publicar"
          ? await fetch(`/api/borradores/${id}/publicar`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ version: versionRef.current }),
            })
          : await fetch(`/api/borradores/${id}/estado`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accion, version: versionRef.current, comentario: datos.comentario }),
            });
      if (r.ok) {
        // Quien envía o publica se queda viendo el borrador (ya en solo lectura);
        // el editor que aprueba o devuelve vuelve a la cola.
        if (accion === "enviar" || accion === "publicar") location.reload();
        else location.assign("/escribir/revision");
        return true;
      }
      const { error, campos } = (await r.json().catch(() => ({}))) as { error?: string; campos?: string[] };
      setAviso(mensajeAccion(r.status, error, campos));
      if (r.status === 409) {
        bloqueado.current = true;
        setEstado("conflicto");
      } else if (r.status === 401) {
        bloqueado.current = true;
        setEstado("sesion");
      }
      return false;
    } catch {
      setAviso("No se ha podido completar la acción. Comprueba la conexión e inténtalo de nuevo.");
      return false;
    } finally {
      setProcesando(false);
    }
  };

  // Imagen destacada
  const elegirDestacada = async (archivo: File | undefined) => {
    if (!archivo) return;
    const url = await subirImagen(archivo);
    if (url) cambiar("imagen", url);
  };
  const soltarDestacada = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    void elegirDestacada(e.dataTransfer.files[0]);
  };

  return (
    <div className="editor-articulo">
      <div className="barra-estado" role="status" aria-live="polite">
        <span className={`estado estado-${estado}`}>{textoEstado(estado, ultimoGuardado)}</span>
        {subiendo > 0 && <span className="estado">Subiendo imagen…</span>}
        {estado === "conflicto" && (
          <button type="button" className="enlace" onClick={() => location.reload()}>
            Recargar
          </button>
        )}
        {estado === "sesion" && (
          <a href={`/escribir/entrar?volver=${encodeURIComponent(location.pathname)}`}>Volver a entrar</a>
        )}
      </div>
      <PanelRevision
        estado={inicial.estadoRevision}
        editable={editable}
        acciones={inicial.acciones}
        devolucion={inicial.devolucion}
        creador={inicial.creador}
        firma={inicial.firma}
        publicacion={inicial.publicacion}
        procesando={procesando}
        ejecutar={ejecutar}
      />

      {aviso && (
        <p className="aviso-editor" role="alert">
          {aviso}
        </p>
      )}

      <div className="hoja">
        <div className="campo">
          <label htmlFor="ed-titulo">Título</label>
          <textarea
            id="ed-titulo"
            className="entrada-titulo"
            rows={2}
            maxLength={LIMITES.titulo}
            value={campos.titulo}
            readOnly={!editable}
            placeholder="Título del artículo"
            onChange={(e) => cambiar("titulo", e.target.value.replace(/\n/g, " "))}
          />
        </div>

        <div className="campo">
          <label htmlFor="ed-resumen">Resumen</label>
          <textarea
            id="ed-resumen"
            className="entrada-resumen"
            rows={3}
            maxLength={LIMITES.resumen}
            value={campos.resumen}
            readOnly={!editable}
            placeholder="Una o dos frases que resuman el artículo."
            onChange={(e) => cambiar("resumen", e.target.value)}
          />
        </div>

        <div className="campo campo-area">
          <label htmlFor="ed-area">Área</label>
          <select id="ed-area" value={campos.area} disabled={!editable} onChange={(e) => cambiar("area", e.target.value)}>
            <option value="">Sin elegir</option>
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="destacada-editor">
          <legend>Imagen destacada</legend>
          {campos.imagen ? (
            <div className="destacada-con-imagen">
              <img src={campos.imagen} alt="" />
              <div className="campo">
                <label htmlFor="ed-alt">Texto alternativo</label>
                <input
                  id="ed-alt"
                  type="text"
                  maxLength={LIMITES.imagenAlt}
                  value={campos.imagenAlt}
                  readOnly={!editable}
                  placeholder="Describe la imagen para quien no puede verla"
                  onChange={(e) => cambiar("imagenAlt", e.target.value)}
                />
              </div>
              {editable && (
                <button type="button" className="enlace" onClick={() => cambiar("imagen", null)}>
                  Quitar imagen
                </button>
              )}
            </div>
          ) : !editable ? (
            <p className="ayuda">Sin imagen destacada.</p>
          ) : (
            <div className="zona-soltar" onDragOver={(e) => e.preventDefault()} onDrop={soltarDestacada}>
              <label htmlFor="ed-destacada" className="boton-archivo">
                Elegir imagen
              </label>
              <input
                id="ed-destacada"
                type="file"
                className="oculto"
                accept={TIPOS_ACEPTADOS.join(",")}
                onChange={(e) => {
                  void elegirDestacada(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <span>o arrástrala aquí. JPG, PNG, WebP o GIF, hasta {MB} MB.</span>
            </div>
          )}
        </fieldset>

        <div className="campo">
          <span className="etiqueta-campo" id="ed-cuerpo">
            Texto
          </span>
          {editor && editable && <BarraHerramientas editor={editor} subirImagen={insertarImagenes} />}
          <div className="marco-cuerpo" aria-labelledby="ed-cuerpo">
            <EditorContent editor={editor} />
          </div>
          {editable && (
            <span className="ayuda">
              Puedes arrastrar o pegar imágenes en el texto (JPG, PNG, WebP o GIF, hasta {MB} MB).
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function textoEstado(estado: Estado, ultimo: string | null): string {
  switch (estado) {
    case "sin-cambios":
      return "Empieza a escribir: se guardará solo.";
    case "pendiente":
      return "Cambios sin guardar…";
    case "guardando":
      return "Guardando…";
    case "guardado":
      return ultimo ? `Guardado a las ${hora(ultimo)}` : "Guardado";
    case "error":
      return "No se pudo guardar. Se reintentará en unos segundos.";
    case "conflicto":
      return "Alguien ha guardado otra versión de este borrador. Recarga para ver la última; tus cambios desde entonces no se han guardado.";
    case "sesion":
      return "Tu sesión ha caducado. Los últimos cambios no se han guardado.";
    case "solo-lectura":
      return "Solo lectura: en este estado no puedes editar el borrador.";
    case "bloqueado":
      return "El borrador ha cambiado de estado y ya no puedes editarlo. Recarga la página; tus últimos cambios no se han guardado.";
  }
}

/** Por qué no se puede publicar sin ficha y qué tiene que hacer un editor. */
function mensajeFirma(firma: DatosFirma, creador: string): string {
  if (firma.problema === "ficha-inexistente") {
    return (
      `No se puede publicar: el rol de ${creador} apunta a la ficha «${firma.ficha}», que no existe en la web. ` +
      "Un editor debe crear esa ficha en Keystatic, o corregir su rol autor:<ficha> en Netlify Identity y " +
      "devolverle el borrador para que lo vuelva a enviar (así se guarda la ficha nueva)."
    );
  }
  return (
    `No se puede publicar: ${creador} no tiene ficha de autor. ` +
    "Un editor debe asignarle primero el rol autor:<ficha> en Netlify Identity (Identity → su usuario → Roles), " +
    "con el nombre de su ficha de src/content/autores. Después, devuélveselo para que lo vuelva a enviar: " +
    "así el borrador guarda su ficha."
  );
}

const NOMBRES_CAMPOS: Record<string, string> = {
  titulo: "título",
  resumen: "resumen",
  area: "área",
  contenido: "texto",
};

/** Mensaje para un cambio de estado o una publicación rechazados por el servidor. */
function mensajeAccion(status: number, error: string | undefined, campos?: string[]): string {
  if (error === "incompleto" && campos?.length) {
    return `Para publicarlo falta: ${campos.map((c) => NOMBRES_CAMPOS[c] ?? c).join(", ")}. Devuélvelo al autor o complétalo antes de aprobarlo.`;
  }
  if (error === "incompleto") return "Añade un título y texto antes de enviarlo a revisión.";
  if (error === "sin-ficha" || error === "ficha-inexistente") {
    return "No se puede publicar: quien creó el borrador no tiene una ficha de autor válida. Un editor debe asignarle el rol autor:<ficha> en Netlify Identity.";
  }
  if (error === "imagen") return "Falta una de las imágenes del borrador. Recarga la página e inténtalo de nuevo.";
  if (error === "imagen-formato") {
    return "Una de las imágenes está dañada y no se puede preparar para la web. Quítala o súbela de nuevo.";
  }
  if (error === "github-config") {
    return "La publicación no está configurada en el servidor (falta el token de GitHub). Avisa a quien administra la web.";
  }
  if (error === "github-token" || error === "github-permisos") {
    return "GitHub ha rechazado el token de publicación (caducado o sin permisos). Avisa a quien administra la web.";
  }
  if (error === "github-github") return "GitHub no ha respondido bien. Espera un momento e inténtalo de nuevo.";
  if (error === "sin-comentario") return "Escribe un comentario para el autor explicando qué debe cambiar.";
  if (status === 409) return "Alguien ha cambiado este borrador mientras tanto. Recarga la página para ver la última versión.";
  if (status === 403) return "No puedes hacer esto con el borrador en su estado actual. Recarga la página.";
  if (status === 401) return "Tu sesión ha caducado. Vuelve a entrar.";
  if (status === 404) return "No encontramos este borrador. Puede que ya no tengas acceso a él.";
  return "No se ha podido completar la acción. Inténtalo de nuevo.";
}

const EXPLICACION: Record<EstadoBorrador, string> = {
  edicion: "Cuando esté listo, envíalo a revisión. Mientras lo revisan no podrás editarlo.",
  revision: "Los editores lo están revisando.",
  aprobado: "Aprobado y listo para publicar.",
  devuelto: "Los editores lo han devuelto con un comentario. Haz los cambios y vuelve a enviarlo.",
  publicado: "Publicado: el artículo ya está en el repositorio. Para cambiarlo, edítalo en Keystatic.",
};

function PanelRevision({
  estado,
  editable,
  acciones,
  devolucion,
  creador,
  firma,
  publicacion,
  procesando,
  ejecutar,
}: {
  estado: EstadoBorrador;
  editable: boolean;
  acciones: Accion[];
  devolucion: DatosIniciales["devolucion"];
  creador: DatosIniciales["creador"];
  firma: DatosIniciales["firma"];
  publicacion: DatosIniciales["publicacion"];
  procesando: boolean;
  ejecutar: (accion: Accion, datos?: { comentario?: string }) => Promise<boolean>;
}) {
  const [devolviendo, setDevolviendo] = useState(false);
  const [comentario, setComentario] = useState("");
  const [publicando, setPublicando] = useState(false);


  const enviar = () => {
    if (window.confirm("¿Enviar a revisión? No podrás editarlo hasta que te lo devuelvan.")) {
      void ejecutar("enviar");
    }
  };
  const aprobar = () => {
    if (window.confirm("¿Aprobar este borrador? Quedará listo para publicar y nadie podrá editarlo.")) {
      void ejecutar("aprobar");
    }
  };

  let explicacion = EXPLICACION[estado];
  if (estado === "revision" && editable) explicacion += " Puedes editarlo antes de aprobarlo o devolverlo.";
  if (estado === "revision" && !editable) explicacion += " No puedes editarlo mientras tanto.";

  return (
    <section className="panel-revision" aria-labelledby="revision-titulo">
      <div className="panel-revision-cabecera">
        <h2 id="revision-titulo">Revisión</h2>
        <span className={`estado-revision estado-revision-${estado}`}>{ETIQUETAS_ESTADO[estado]}</span>
      </div>
      <p>{explicacion}</p>
      <p className={firma.problema ? "firma firma-sin-ficha" : "firma"}>
        <span className="firma-etiqueta">Autor o autora</span>{" "}
        {firma.nombre ? <strong>{firma.nombre}</strong> : <strong>Sin ficha de autor</strong>}
        {firma.problema && ` (${creador})`}
      </p>

      {devolucion && (
        <figure className="comentario-revision">
          <figcaption>
            Comentario de {devolucion.por} · {fechaHora(devolucion.fecha)}
          </figcaption>
          <blockquote>{devolucion.comentario}</blockquote>
        </figure>
      )}

      {publicacion && (
        <div className="publicacion">
          <p>
            Netlify actualiza la web en unos minutos: hasta entonces la dirección puede dar «no encontrado».
          </p>
          <div className="acciones-revision">
            <a className="boton boton-principal" href={`/blog/${publicacion.slug}`}>
              Ver en la web
            </a>
            <a className="boton boton-secundario" href={publicacion.urlCommit} rel="noopener noreferrer">
              Ver el cambio en GitHub
            </a>
          </div>
        </div>
      )}

      {acciones.length > 0 && !devolviendo && !publicando && (
        <div className="acciones-revision">
          {acciones.includes("enviar") && (
            <button type="button" className="boton boton-principal" disabled={procesando} onClick={enviar}>
              Enviar a revisión
            </button>
          )}
          {acciones.includes("publicar") && (
            <button
              type="button"
              className="boton boton-principal"
              disabled={procesando}
              onClick={() => setPublicando(true)}
            >
              Publicar
            </button>
          )}
          {acciones.includes("aprobar") && (
            <button type="button" className="boton boton-principal" disabled={procesando} onClick={aprobar}>
              Aprobar
            </button>
          )}
          {acciones.includes("devolver") && (
            <button
              type="button"
              className="boton boton-secundario"
              disabled={procesando}
              onClick={() => setDevolviendo(true)}
            >
              Devolver al autor
            </button>
          )}
        </div>
      )}

      {devolviendo && (
        <form
          className="form-devolver"
          onSubmit={(e) => {
            e.preventDefault();
            void ejecutar("devolver", { comentario });
          }}
        >
          <label htmlFor="revision-comentario">Comentario para el autor</label>
          <textarea
            id="revision-comentario"
            rows={4}
            required
            maxLength={LIMITES.comentario}
            value={comentario}
            placeholder="Explica qué debe cambiar antes de volver a enviarlo."
            onChange={(e) => setComentario(e.target.value)}
          />
          <div className="acciones-revision">
            <button type="submit" className="boton boton-principal" disabled={procesando || !comentario.trim()}>
              Devolver con este comentario
            </button>
            <button
              type="button"
              className="boton boton-secundario"
              disabled={procesando}
              onClick={() => setDevolviendo(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {publicando && (
        <form
          className="form-devolver"
          aria-labelledby="publicar-titulo"
          onSubmit={(e) => {
            e.preventDefault();
            if (!firma.problema) void ejecutar("publicar");
          }}
        >
          <h3 id="publicar-titulo">Publicar en el blog</h3>
          {firma.problema ? (
            <p className="aviso-firma" role="alert">
              {mensajeFirma(firma, creador)}
            </p>
          ) : (
            <>
              <p className="publicar-autor">
                Se publicará firmado por <strong>{firma.nombre}</strong>.
              </p>
              <p className="ayuda">
                La firma es la ficha de autor de quien creó el borrador y no se puede cambiar aquí. Se subirá al
                repositorio como artículo del blog, con sus imágenes, y Netlify lo pondrá en la web en unos
                minutos. Después ya no se podrá editar aquí.
              </p>
            </>
          )}
          <div className="acciones-revision">
            {!firma.problema && (
              <button type="submit" className="boton boton-principal" disabled={procesando}>
                {procesando ? "Publicando…" : "Publicar ahora"}
              </button>
            )}
            <button
              type="button"
              className="boton boton-secundario"
              disabled={procesando}
              onClick={() => setPublicando(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function BarraHerramientas({
  editor,
  subirImagen,
}: {
  editor: Editor;
  subirImagen: (editor: Editor, archivos: File[]) => Promise<void>;
}) {
  const activo = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      negrita: e.isActive("bold"),
      cursiva: e.isActive("italic"),
      vinetas: e.isActive("bulletList"),
      numerada: e.isActive("orderedList"),
      cita: e.isActive("blockquote"),
      enlace: e.isActive("link"),
      imagen: e.isActive("image"),
    }),
  });
  const entradaImagen = useRef<HTMLInputElement>(null);

  const enlace = () => {
    const previo = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Dirección del enlace (déjala vacía para quitarlo):", previo ?? "https://");
    if (url === null) return;
    const limpia = url.trim();
    if (!limpia) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    if (!/^(https?:\/\/|mailto:)/i.test(limpia)) {
      window.alert("El enlace debe empezar por https://, http:// o mailto:");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: limpia }).run();
  };

  const textoAlternativo = () => {
    const previo = (editor.getAttributes("image").alt as string | undefined) ?? "";
    const alt = window.prompt("Texto alternativo de la imagen:", previo);
    if (alt === null) return;
    editor.chain().focus().updateAttributes("image", { alt: alt.slice(0, LIMITES.imagenAlt) }).run();
  };

  const botones: { texto: string; titulo: string; activo?: boolean; accion: () => void }[] = [
    { texto: "T2", titulo: "Título de sección", activo: activo.h2, accion: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { texto: "T3", titulo: "Subtítulo", activo: activo.h3, accion: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { texto: "N", titulo: "Negrita", activo: activo.negrita, accion: () => editor.chain().focus().toggleBold().run() },
    { texto: "C", titulo: "Cursiva", activo: activo.cursiva, accion: () => editor.chain().focus().toggleItalic().run() },
    { texto: "• Lista", titulo: "Lista con viñetas", activo: activo.vinetas, accion: () => editor.chain().focus().toggleBulletList().run() },
    { texto: "1. Lista", titulo: "Lista numerada", activo: activo.numerada, accion: () => editor.chain().focus().toggleOrderedList().run() },
    { texto: "“ Cita", titulo: "Cita o aviso destacado", activo: activo.cita, accion: () => editor.chain().focus().toggleBlockquote().run() },
    { texto: "Enlace", titulo: "Añadir o quitar enlace", activo: activo.enlace, accion: enlace },
  ];

  return (
    <div className="herramientas" role="toolbar" aria-label="Formato del texto">
      {botones.map((b) => (
        <button
          key={b.titulo}
          type="button"
          title={b.titulo}
          aria-label={b.titulo}
          aria-pressed={b.activo}
          className={b.activo ? "activo" : undefined}
          onMouseDown={(e) => e.preventDefault()}
          onClick={b.accion}
        >
          {b.texto}
        </button>
      ))}
      <button type="button" title="Insertar imagen" aria-label="Insertar imagen" onClick={() => entradaImagen.current?.click()}>
        Imagen
      </button>
      <input
        ref={entradaImagen}
        type="file"
        className="oculto"
        tabIndex={-1}
        aria-hidden="true"
        accept={TIPOS_ACEPTADOS.join(",")}
        multiple
        onChange={(e) => {
          void subirImagen(editor, Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {activo.imagen && (
        <button type="button" title="Texto alternativo de la imagen" aria-label="Texto alternativo de la imagen" onClick={textoAlternativo}>
          Texto alt.
        </button>
      )}
    </div>
  );
}
