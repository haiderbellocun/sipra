import { Documento } from '../../entities/documento.entity';
import { EntradaDecisionRut } from '../../services/decision-rut.domain-service';

/**
 * Aplica la decisión humana sobre un RUT como UNA sola operación atómica: documento decidido + validación decidida (con quién,
 * cuándo, motivo y reserva liberada) + evidencia + auditoría, o nada. Falla cerrado: ante cualquier error se deshace todo.
 *
 * Lanza `ConflictoDecisionRutError` si la decisión no procede por el estado del caso (ya decidida —incluido el reintento tras un
 * commit cuya respuesta se perdió—, no revisable, versión vieja, reserva ajena o vencida, otra decisión simultánea).
 */
export interface DecisionRutPort {
  aplicar(validacionId: string, entrada: EntradaDecisionRut): Promise<Documento>;
}
export const DECISION_RUT = Symbol('DECISION_RUT');
