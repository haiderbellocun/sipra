/**
 * Saneamiento de PDF antes del almacenamiento (M3).
 *
 * Un PDF no es solo texto e imágenes: puede llevar JavaScript, acciones que se
 * ejecutan al abrirlo, archivos embebidos y formularios que envían datos a un
 * servidor externo. Guardar eso en un repositorio institucional y servirlo
 * después a un tutor es exponerlo.
 *
 * El saneamiento es DESTRUCTIVO por diseño: neutraliza esos objetos. Por eso el
 * original se conserva con su hash intacto y lo que se sirve es la copia
 * saneada. El valor probatorio se preserva en el hash del original.
 */

export interface HallazgoSaneamiento {
  tipo: 'javascript' | 'accion_apertura' | 'accion_lanzamiento' | 'archivo_embebido'
      | 'envio_formulario' | 'uri_externa';
  ocurrencias: number;
  descripcion: string;
}

export interface ResultadoSaneamiento {
  contenido: Buffer;
  hallazgos: HallazgoSaneamiento[];
  modificado: boolean;
}

/**
 * Objetos activos que se neutralizan. Se reemplaza el NOMBRE de la clave, no el
 * contenido, para no alterar la longitud del archivo ni romper las tablas de
 * referencias cruzadas del PDF: `/JavaScript` pasa a `/XXJavaScrip_`, que
 * ningún visor reconoce como acción.
 */
const OBJETOS_ACTIVOS: readonly {
  patron: RegExp;
  reemplazo: string;
  tipo: HallazgoSaneamiento['tipo'];
  descripcion: string;
}[] = [
  {
    patron: /\/JavaScript(?![A-Za-z0-9])/g,
    reemplazo: '/XXJavaScrip_',
    tipo: 'javascript',
    descripcion: 'Código JavaScript embebido en el documento',
  },
  {
    patron: /\/JS(?![A-Za-z0-9])/g,
    reemplazo: '/XX',
    tipo: 'javascript',
    descripcion: 'Entrada de acción JavaScript',
  },
  {
    patron: /\/OpenAction(?![A-Za-z0-9])/g,
    reemplazo: '/XXOpenActio_',
    tipo: 'accion_apertura',
    descripcion: 'Acción que se ejecuta al abrir el documento',
  },
  {
    patron: /\/AA(?![A-Za-z0-9])/g,
    reemplazo: '/XX',
    tipo: 'accion_apertura',
    descripcion: 'Acción adicional asociada a un evento del documento',
  },
  {
    patron: /\/Launch(?![A-Za-z0-9])/g,
    reemplazo: '/XXLaunc_',
    tipo: 'accion_lanzamiento',
    descripcion: 'Acción que lanza un programa externo',
  },
  {
    patron: /\/EmbeddedFile(?![A-Za-z0-9])/g,
    reemplazo: '/XXEmbeddedFil_',
    tipo: 'archivo_embebido',
    descripcion: 'Archivo embebido dentro del PDF',
  },
  {
    patron: /\/EmbeddedFiles(?![A-Za-z0-9])/g,
    reemplazo: '/XXEmbeddedFile_',
    tipo: 'archivo_embebido',
    descripcion: 'Colección de archivos embebidos',
  },
  {
    patron: /\/SubmitForm(?![A-Za-z0-9])/g,
    reemplazo: '/XXSubmitFor_',
    tipo: 'envio_formulario',
    descripcion: 'Formulario que envía datos a un servidor externo',
  },
  {
    patron: /\/RichMedia(?![A-Za-z0-9])/g,
    reemplazo: '/XXRichMedi_',
    tipo: 'archivo_embebido',
    descripcion: 'Contenido multimedia ejecutable',
  },
];

export class SaneamientoPdfDomainService {
  /**
   * Devuelve una copia saneada y la lista de lo que se neutralizó.
   * Si no había nada activo, `modificado` es false y el contenido es idéntico.
   */
  sanear(contenido: Buffer): ResultadoSaneamiento {
    let texto = contenido.toString('latin1');
    const hallazgos = new Map<HallazgoSaneamiento['tipo'], HallazgoSaneamiento>();

    for (const objeto of OBJETOS_ACTIVOS) {
      const coincidencias = texto.match(objeto.patron);
      if (!coincidencias?.length) continue;

      // El reemplazo conserva la longitud para no invalidar las referencias
      // cruzadas del PDF, que son desplazamientos absolutos en bytes.
      const reemplazo = objeto.reemplazo.padEnd(
        coincidencias[0].length,
        '_',
      ).slice(0, coincidencias[0].length);
      texto = texto.replace(objeto.patron, reemplazo);

      const previo = hallazgos.get(objeto.tipo);
      hallazgos.set(objeto.tipo, {
        tipo: objeto.tipo,
        ocurrencias: (previo?.ocurrencias ?? 0) + coincidencias.length,
        descripcion: previo?.descripcion ?? objeto.descripcion,
      });
    }

    const lista = [...hallazgos.values()];
    return {
      contenido: lista.length > 0 ? Buffer.from(texto, 'latin1') : contenido,
      hallazgos: lista,
      modificado: lista.length > 0,
    };
  }

  /** Inspecciona sin modificar. Útil para auditar el repositorio existente. */
  inspeccionar(contenido: Buffer): HallazgoSaneamiento[] {
    return this.sanear(contenido).hallazgos;
  }
}
