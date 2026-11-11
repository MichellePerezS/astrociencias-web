// Editor visual de artículos (isla de React con TipTap).
// Guarda solo, unos segundos después de cada cambio, en /api/borradores.
// El servidor vuelve a validar y limpiar todo lo que llega desde aquí.

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import FileHandler from "@tiptap/extension-file-handler";
import { AREAS } from "../../content/areas";
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
  | "sesion";

const ESPERA_GUARDADO_MS = 1500;
const REINTENTO_MS = 10_000;
const TIPOS_ACEPTADOS = Object.keys(TIPOS_IMAGEN);
const MB = (MAX_BYTES_IMAGEN / 1024 / 1024).toFixed(0);

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });

export default function EditorArticulo({ inicial }: { inicial: DatosIniciales }) {
  const [campos, setCampos] = useState<Campos>({
    titulo: inicial.titulo,
    resumen: inicial.resumen,
    area: inicial.area ?? "",
    imagen: inicial.imagen,
    imagenAlt: inicial.imagenAlt,
  });
  const [estado, setEstado] = useState<Estado>(inicial.actualizado ? "guardado" : "sin-cambios");
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
  const bloqueado = useRef(false);
  const creando = useRef<Promise<string> | null>(null);

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

  const guardar = useCallback(async () => {
    if (bloqueado.current) return;
    if (guardando.current) {
      otraVez.current = true;
      return;
    }
    if (temporizador.current) clearTimeout(temporizador.current);
    guardando.current = true;
    setEstado("guardando");

    try {
      const id = await asegurarId();
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
      } else if (r.status === 409) {
        bloqueado.current = true;
        setEstado("conflicto");
      } else if (r.status === 401) {
        bloqueado.current = true;
        setEstado("sesion");
      } else if (r.status === 413) {
        setEstado("error");
        setAviso("El texto es demasiado largo para guardarlo. Divide el artículo o quita contenido.");
      } else {
        throw new Error(String(r.status));
      }
    } catch (e) {
      if ((e as Error).message === "sesion") {
        bloqueado.current = true;
        setEstado("sesion");
      } else {
        setEstado("error");
        temporizador.current = setTimeout(() => void guardar(), REINTENTO_MS);
      }
    } finally {
      guardando.current = false;
      if (otraVez.current && !bloqueado.current) {
        otraVez.current = false;
        void guardar();
      }
    }
  }, [asegurarId]);

  /** Programa un guardado poco después del último cambio. */
  const programar = useCallback(() => {
    if (bloqueado.current) return;
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
            placeholder="Una o dos frases que resuman el artículo."
            onChange={(e) => cambiar("resumen", e.target.value)}
          />
        </div>

        <div className="campo campo-area">
          <label htmlFor="ed-area">Área</label>
          <select id="ed-area" value={campos.area} onChange={(e) => cambiar("area", e.target.value)}>
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
                  placeholder="Describe la imagen para quien no puede verla"
                  onChange={(e) => cambiar("imagenAlt", e.target.value)}
                />
              </div>
              <button type="button" className="enlace" onClick={() => cambiar("imagen", null)}>
                Quitar imagen
              </button>
            </div>
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
          {editor && <BarraHerramientas editor={editor} subirImagen={insertarImagenes} />}
          <div className="marco-cuerpo" aria-labelledby="ed-cuerpo">
            <EditorContent editor={editor} />
          </div>
          <span className="ayuda">
            Puedes arrastrar o pegar imágenes en el texto (JPG, PNG, WebP o GIF, hasta {MB} MB).
          </span>
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
  }
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
