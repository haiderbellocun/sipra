/**
 * Cómo se le cuenta a la PERSONA QUE ESTUDIA qué pasó con su documento y qué debe hacer ahora. Sin códigos, sin nombres de
 * estados internos ni conceptos del pipeline: cada estado dice «qué pasó» y «qué hacer». Solo presentación: el estado real
 * lo decide el servidor y no se cambia aquí.
 */

export type TonoGuia = 'ok' | 'aviso' | 'peligro' | 'info' | 'neutra';

export interface GuiaDocumento {
  /** Etiqueta corta del estado (la que va en la insignia). */
  estado: string;
  tono: TonoGuia;
  /** Qué pasó. */
  que: string;
  /** Qué debe hacer ahora. */
  hacer: string;
  /** Hay que corregir y volver a subir: la pantalla ofrece «Subir nueva versión». */
  necesitaCorreccion: boolean;
}

export const DIAS_SUBSANACION = 8;

export function guiaDocumento(estado: string | null | undefined, documento: string): GuiaDocumento {
  switch (estado) {
    case null: case undefined: case '':
      return { estado: 'Pendiente de cargar', tono: 'neutra', que: 'Aún no has cargado este documento.', hacer: 'Súbelo en PDF para iniciar la validación.', necesitaCorreccion: false };
    case 'recibido': case 'analizando':
      return { estado: 'Procesando', tono: 'info', que: 'Recibimos tu documento y lo estamos leyendo.', hacer: 'No tienes que hacer nada: en unos segundos pasa a revisión.', necesitaCorreccion: false };
    case 'en_revision':
      return { estado: 'En revisión', tono: 'aviso', que: 'Una persona de la CUN está revisando tu documento.', hacer: 'Espera el resultado. Si hay algo por corregir, te avisaremos aquí.', necesitaCorreccion: false };
    case 'ilegible':
      return { estado: 'Necesita corrección', tono: 'aviso', que: 'No pudimos leer correctamente tu documento.', hacer: 'Sube una copia más clara: completa, enfocada y en PDF.', necesitaCorreccion: true };
    case 'devuelto':
      return {
        estado: 'Necesita corrección', tono: 'aviso', que: `Tu ${documento.charAt(0).toLowerCase()}${documento.slice(1)} necesita una corrección.`,
        hacer: `Sube una nueva versión con lo indicado. Tienes ${DIAS_SUBSANACION} días calendario.`, necesitaCorreccion: true,
      };
    case 'aprobado': case 'auto_aprobado':
      return { estado: 'Aprobado', tono: 'ok', que: 'Tu documento fue aprobado.', hacer: 'No tienes que hacer nada más con este documento.', necesitaCorreccion: false };
    case 'rechazado':
      return { estado: 'Rechazado', tono: 'peligro', que: 'Tu documento no fue aceptado.', hacer: 'Consulta el motivo con tu docente o con coordinación antes de cargar otro.', necesitaCorreccion: false };
    default:
      return { estado: 'En proceso', tono: 'neutra', que: 'Tu documento está en proceso.', hacer: 'No tienes que hacer nada por ahora.', necesitaCorreccion: false };
  }
}

/** Versión anterior: una línea corta («Versión 2 · Necesita corrección») para no obligar a leer un historial. */
export function lineaVersionAnterior(version: number, estado: string | null | undefined, documento: string): string {
  return `Versión ${version} · ${guiaDocumento(estado, documento).estado}`;
}
