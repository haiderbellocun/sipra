import { ConfigService } from '@nestjs/config';
import { InterruptoresRescateIa } from '../../domain/services/politica-rescate-ia';

/**
 * Interruptores de la IA de rescate leídos de la configuración (§7.35). Solo LEE: la decisión de si un rescate
 * está permitido es de `decidirRescateIa` (dominio); aquí no hay política.
 *
 * Fallo cerrado: solo `true` (booleano) o la cadena «true» (sin importar mayúsculas) encienden un interruptor;
 * cualquier otra cosa —ausente, `1`, `yes`, un error de tipeo— queda apagada. Lee siempre de ConfigService,
 * nunca de `process.env`. `validarEntorno` ya impone al arrancar las combinaciones permitidas.
 */
function encendido(valor: unknown): boolean {
  return valor === true || (typeof valor === 'string' && valor.trim().toLowerCase() === 'true');
}

export function interruptoresRescateIa(config: ConfigService | undefined): InterruptoresRescateIa {
  const leer = (clave: string): boolean => encendido(config?.get<string | boolean | undefined>(clave));
  return {
    habilitado: leer('IA_RESCATE_HABILITADO'),
    eps: leer('IA_RESCATE_EPS'),
    rut: leer('IA_RESCATE_RUT'),
    camara: leer('IA_RESCATE_CAMARA'),
    acta: leer('IA_RESCATE_ACTA'),
  };
}
