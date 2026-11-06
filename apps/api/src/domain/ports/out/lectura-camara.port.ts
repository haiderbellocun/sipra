import type { LecturaLocalCamara, OpcionesLecturaCamara } from '../../services/lectura-local-camara.domain-service';

/** Lectura local del certificado de Cámara de Comercio (PDF o imagen). 100 % dentro del proceso: sin servicios externos, sin abrir URLs, sin RUES. */
export interface LecturaCamaraPort {
  leer(contenido: Buffer, mime: string, opciones?: OpcionesLecturaCamara): Promise<LecturaLocalCamara>;
}
export const LECTURA_CAMARA = Symbol('LECTURA_CAMARA');
