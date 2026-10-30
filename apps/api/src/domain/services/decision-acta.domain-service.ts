import { RegistroAuditoria, AccionAuditada } from '../entities/auditoria.entity';
import { Documento } from '../entities/documento.entity';
import {
  DatosEvidenciaActa, DecisionActa, EvidenciaActa, TipoEvidenciaActa, ValidacionActa,
} from '../entities/validacion-acta.entity';
import { randomUUID } from 'node:crypto';

/**
 * La decisión humana sobre un acta es UNA operación lógica: documento decidido + validación decidida + evidencia + auditoría,
 * o nada. Este módulo es el núcleo PURO de esa operación: dado el estado leído (con los datos bloqueados), decide si procede y
 * construye todo lo que hay que escribir. Quien lo ejecuta (un adaptador con transacción) solo lo persiste, todo junto.
 *
 * Qué se comprueba aquí (en este orden, dentro de la transacción, con las filas bloqueadas):
 *  · ni el documento ni la validación están ya decididos (un reintento tras el commit cae aquí: no hay segunda decisión);
 *  · la validación está en `revision`;
 *  · es la versión vigente del acta;
 *  · la reserva es de quien decide y sigue vigente.
 */

export type MotivoConflictoDecisionActa =
  | 'ya_decidida' | 'inconsistente' | 'no_revisable' | 'version_vieja' | 'reserva' | 'documento_cambio' | 'no_encontrada';

const MENSAJES: Readonly<Record<MotivoConflictoDecisionActa, string>> = {
  ya_decidida: 'El caso ya fue decidido',
  inconsistente: 'El documento ya tiene una decisión pero la validación del acta sigue en revisión: avise a coordinación para reconciliarlo',
  no_revisable: 'El acta todavía no está lista para revisión o ya no lo está: recargue el caso',
  version_vieja: 'El estudiante cargó una versión más reciente del acta: revise esa versión',
  reserva: 'Su reserva del caso venció o es de otro funcionario: tómelo de nuevo antes de decidir',
  documento_cambio: 'El documento cambió mientras se decidía: recárguelo e inténtelo de nuevo',
  no_encontrada: 'Caso no encontrado',
};

/** La decisión no procede por el estado del caso. Siempre un 409 controlado, nunca un 500. */
export class ConflictoDecisionActaError extends Error {
  constructor(public readonly motivo: MotivoConflictoDecisionActa) {
    super(MENSAJES[motivo]);
    this.name = 'ConflictoDecisionActaError';
  }
}

export interface ActorDecisionActa {
  id: string;
  correo: string;
  rol: string;
  ip?: string | null;
  agenteUsuario?: string | null;
}

export interface EntradaDecisionActa {
  decision: DecisionActa;
  /** Lo que queda en el documento: justificación o, al devolver, el mensaje humano para el estudiante. */
  justificacion: string;
  motivo: string | null;
  actor: ActorDecisionActa;
  ahora: Date;
  /** Contexto de la decisión para la auditoría de la Mesa (recomendación, apartamiento…). Sin datos del documento. */
  contextoAuditoria: Record<string, unknown>;
}

export interface EstadoLeidoDecisionActa {
  validacion: ValidacionActa;
  documento: Documento;
  /** Mayor versión del acta de esta práctica. */
  versionMaximaActa: number;
}

export interface PlanDecisionActa {
  documento: Documento;
  validacion: ValidacionActa;
  /** Estado del documento tal como se leyó: el compare-and-set exige que siga así al escribir. */
  estadoDocumentoLeido: Documento['estado'];
  versionValidacionLeida: number;
  evidencia: DatosEvidenciaActa;
  auditorias: RegistroAuditoria[];
}

export function planificarDecisionActa(leido: EstadoLeidoDecisionActa, entrada: EntradaDecisionActa): PlanDecisionActa {
  const { validacion, documento } = leido;
  const { actor, ahora } = entrada;
  if (documento.estaDecidido) {
    // Documento terminal y validación en revisión: el estado inconsistente de versiones anteriores. No se «arregla» aquí.
    throw new ConflictoDecisionActaError(validacion.estaDecidida ? 'ya_decidida' : 'inconsistente');
  }
  if (validacion.estaDecidida) throw new ConflictoDecisionActaError('ya_decidida');
  if (!validacion.estaRevisable) throw new ConflictoDecisionActaError('no_revisable');
  if (documento.instantanea().version < leido.versionMaximaActa) throw new ConflictoDecisionActaError('version_vieja');
  if (!validacion.reservadaPor(actor.id, ahora)) throw new ConflictoDecisionActaError('reserva');

  const estadoDocumentoLeido = documento.estado;
  const versionValidacionLeida = validacion.version;
  const docDecidido = Documento.desde(documento.instantanea());
  switch (entrada.decision) {
    case 'aprobar': docDecidido.aprobar(actor.id, entrada.justificacion, ahora); break;
    case 'rechazar': docDecidido.rechazar(actor.id, entrada.justificacion, ahora); break;
    case 'devolver': docDecidido.devolver(entrada.justificacion, actor.id, ahora); break;
  }
  const valDecidida = ValidacionActa.desde(validacion.instantanea());
  valDecidida.registrarDecision(entrada.decision, actor.id, ahora, entrada.motivo);

  const doc = docDecidido.instantanea();
  const auditoria = (accion: AccionAuditada, entidad: string, entidadId: string, metadatos: Record<string, unknown>, justificacion: string | null): RegistroAuditoria => ({
    actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion, entidad, entidadId, justificacion, metadatos,
    ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
  });
  return {
    documento: docDecidido,
    validacion: valDecidida,
    estadoDocumentoLeido,
    versionValidacionLeida,
    evidencia: EvidenciaActa.crear({
      id: randomUUID(), validacionActaId: validacion.id, intento: validacion.intentos, tipo: TipoEvidenciaActa.DECISION_HUMANA,
      resultado: entrada.decision, metodo: 'decision_documento', fecha: ahora, actorId: actor.id, hashDocumento: doc.hashSha256,
      datos: { rol: actor.rol, motivo: entrada.motivo }, errorCodigo: null, creadoEn: ahora,
    }).instantanea(),
    auditorias: [
      auditoria(AccionAuditada.DECISION_DOCUMENTO, 'documento', doc.id, { decision: entrada.decision, puntaje: doc.puntaje, banda: doc.banda }, entrada.justificacion),
      auditoria(AccionAuditada.DECISION_ACTA, 'validacion_acta_iniciacion', validacion.id, entrada.contextoAuditoria, null),
    ],
  };
}
