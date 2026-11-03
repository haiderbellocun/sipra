import type { LecturaLocalRut } from '../../services/lectura-local-rut.domain-service';

/** Lectura local del RUT (PDF o imagen). 100 % dentro del proceso: sin servicios externos ni peticiones de red. */
export interface LecturaRutPort {
  leer(contenido: Buffer, mime: string): Promise<LecturaLocalRut>;
}
export const LECTURA_RUT = Symbol('LECTURA_RUT');
