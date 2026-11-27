import { ConfigService } from '@nestjs/config';
import { InterruptoresDecisionAutomatica } from '../../domain/services/decision-automatica-documental.domain-service';

/**
 * Interruptores del motor de decisión documental automática (§7.36) leídos de ConfigService. Solo LEE: la decisión es de
 * las políticas de dominio y de `consolidarDecision`. Fallo cerrado: solo `true` o «true» (sin importar mayúsculas)
 * encienden; cualquier otra cosa queda apagada. Nunca lee `process.env`.
 */
function encendido(valor: unknown): boolean {
  return valor === true || (typeof valor === 'string' && valor.trim().toLowerCase() === 'true');
}

export function interruptoresDecisionAutomatica(config: ConfigService | undefined): InterruptoresDecisionAutomatica {
  const leer = (clave: string): boolean => encendido(config?.get<string | boolean | undefined>(clave));
  return {
    habilitado: leer('AUTO_DECISION_DOCUMENTAL_HABILITADA'),
    aprobacionEps: leer('AUTO_APROBACION_EPS'),
    aprobacionRut: leer('AUTO_APROBACION_RUT'),
    aprobacionCamara: leer('AUTO_APROBACION_CAMARA'),
    aprobacionArl: leer('AUTO_APROBACION_ARL'),
    devolucionDocumentoIncorrecto: leer('AUTO_DEVOLUCION_DOCUMENTO_INCORRECTO'),
    devolucionIncumplimiento: leer('AUTO_DEVOLUCION_INCUMPLIMIENTO'),
  };
}
