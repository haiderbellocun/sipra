import { Documento } from '../../entities/documento.entity';
import { EntradaDecisionActa } from '../../services/decision-acta.domain-service';

/**
 * Aplica la decisión humana sobre un acta como UNA sola operación atómica: documento decidido + validación decidida (con
 * quién, cuándo, motivo y reserva liberada) + evidencia + auditoría, o nada. Falla cerrado: ante cualquier error se deshace todo.
 *
 * Lanza `ConflictoDecisionActaError` si la decisión no procede por el estado del caso (ya decidida —incluido el reintento tras
 * un commit cuya respuesta se perdió—, no revisable, versión vieja, reserva ajena o vencida, otra decisión simultánea).
 */
export interface DecisionActaPort {
  aplicar(validacionId: string, entrada: EntradaDecisionActa): Promise<Documento>;
}
export const DECISION_ACTA = Symbol('DECISION_ACTA');
