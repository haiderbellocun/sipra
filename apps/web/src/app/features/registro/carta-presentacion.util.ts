import { Carta, EstadoCarta, ResponsableArlCarta, Rol, SolicitudCarta } from '@core/models/modelos';

/**
 * Carta de presentación digital (presentación). El servidor decide quién emite, valida datos, ventana y alcance,
 * redacta la carta y la firma con su referencia; aquí solo se arma la solicitud y se muestran los resultados.
 */

/** Emiten: estudiante (la suya), docente facilitador, auxiliar, coordinación y analista. Administración solo consulta; dirección no entra (G1). */
export function puedeEmitirCarta(rol: Rol | null): boolean {
  return rol === 'estudiante' || rol === 'tutor' || rol === 'auxiliar' || rol === 'coordinador' || rol === 'analista';
}

export const TEXTO_CONFIRMACION = 'Se generará una carta institucional con estos datos. Una vez emitida quedará registrada en el historial.';

export function etiquetaArl(r: ResponsableArlCarta): string {
  return r === 'empresa' ? 'La empresa' : r === 'cun' ? 'La CUN' : 'Se define al registrar la práctica';
}

export function etiquetaEstado(e: EstadoCarta): string {
  return e === 'vigente' ? 'Vigente' : e === 'reemplazada' ? 'Reemplazada' : 'Anulada';
}

/** Opción elegida en la interfaz: carta genérica sin práctica, o ligada a una práctica (destinatario empresa o genérico). */
export interface OpcionCarta {
  practicaId: string | null;
  destinatario: 'generica' | 'empresa';
  modalidad: string;
}

export function solicitudDesde(periodo: string, opcion: OpcionCarta, documento: string | null): SolicitudCarta {
  const base: SolicitudCarta = { periodoAcademico: periodo, destinatario: opcion.destinatario };
  if (opcion.practicaId) base.practicaId = opcion.practicaId;
  else if (opcion.modalidad) base.modalidad = opcion.modalidad;
  if (documento && documento.trim()) base.estudianteDocumento = documento.trim();
  return base;
}

/** Ruta pública de verificación (la misma a la que apunta el QR impreso). */
export function rutaVerificacion(referencia: string): string {
  return `/verificar-carta/${encodeURIComponent(referencia)}`;
}

/** Nombre del PDF descargado: Carta_presentacion_<documento>_<fecha>.pdf (solo letras y dígitos; nunca rutas). */
export function nombreArchivo(c: Pick<Carta, 'estudianteDocumento' | 'generadaEn' | 'id'>): string {
  const doc = (c.estudianteDocumento ?? '').replace(/[^0-9A-Za-z]/g, '').slice(0, 20) || c.id.slice(0, 8);
  const fecha = /^\d{4}-\d{2}-\d{2}/.test(c.generadaEn) ? c.generadaEn.slice(0, 10) : 'fecha';
  return `Carta_presentacion_${doc}_${fecha}.pdf`;
}
