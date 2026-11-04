import { randomUUID } from 'node:crypto';
import { AccionAuditada, RegistroAuditoria } from '../entities/auditoria.entity';
import { Documento } from '../entities/documento.entity';
import {
  DatosEvidenciaDocumentoEmpresarial, EvidenciaDocumentoEmpresarial, TipoEvidenciaDocumentoEmpresarial, ValidacionDocumentoEmpresarial,
} from '../entities/validacion-documento-empresarial.entity';
import { DecisionRevisionRut } from './mesa-rut.domain-service';

/**
 * La decisión humana sobre un RUT es UNA operación lógica: documento decidido + validación decidida + evidencia + auditoría,
 * o nada. Este módulo es el núcleo PURO de esa operación (el mismo diseño que la decisión del acta): dado el estado leído, con
 * las filas bloqueadas, decide si procede y construye todo lo que hay que escribir. Quien lo ejecuta (un adaptador con
 * transacción) solo lo persiste, todo junto.
 *
 * Se comprueba, en este orden y dentro de la transacción:
 *  · ni el documento ni la validación están ya decididos (un reintento tras el commit cae aquí: no hay segunda decisión);
 *  · la validación está en `revision`;
 *  · es la versión vigente del RUT de ese tipo;
 *  · la reserva es de quien decide y sigue vigente.
 */

export type MotivoConflictoDecisionRut =
  | 'ya_decidida' | 'inconsistente' | 'no_revisable' | 'version_vieja' | 'reserva' | 'documento_cambio' | 'no_encontrada';

const MENSAJES: Readonly<Record<MotivoConflictoDecisionRut, string>> = {
  ya_decidida: 'El caso ya fue decidido',
  inconsistente: 'El documento ya tiene una decisión pero la validación del RUT sigue en revisión: avise a coordinación para reconciliarlo',
  no_revisable: 'El RUT todavía no está listo para revisión o ya no lo está: recargue el caso',
  version_vieja: 'El estudiante cargó una versión más reciente del RUT: revise esa versión',
  reserva: 'Su reserva del caso venció o es de otro funcionario: tómelo de nuevo antes de decidir',
  documento_cambio: 'El documento cambió mientras se decidía: recárguelo e inténtelo de nuevo',
  no_encontrada: 'Caso no encontrado',
};

/** La decisión no procede por el estado del caso. Siempre un 409 controlado, nunca un 500. */
export class ConflictoDecisionRutError extends Error {
  constructor(public readonly motivo: MotivoConflictoDecisionRut) {
    super(MENSAJES[motivo]);
    this.name = 'ConflictoDecisionRutError';
  }
}

export interface ActorDecisionRut {
  id: string;
  correo: string;
  rol: string;
  ip?: string | null;
  agenteUsuario?: string | null;
}

export interface EntradaDecisionRut {
  decision: DecisionRevisionRut;
  /** Lo que queda en el documento: la justificación o, al devolver, el mensaje humano para el estudiante. */
  justificacion: string;
  motivo: string | null;
  actor: ActorDecisionRut;
  ahora: Date;
  /** Contexto de la decisión para la auditoría (recomendación, apartamiento…). Sin datos del documento. */
  contextoAuditoria: Record<string, unknown>;
}

export interface EstadoLeidoDecisionRut {
  validacion: ValidacionDocumentoEmpresarial;
  documento: Documento;
  /** Mayor versión del RUT de este tipo en esta práctica. */
  versionMaximaRut: number;
}

export interface PlanDecisionRut {
  documento: Documento;
  validacion: ValidacionDocumentoEmpresarial;
  estadoDocumentoLeido: Documento['estado'];
  versionValidacionLeida: number;
  evidencia: DatosEvidenciaDocumentoEmpresarial;
  auditorias: RegistroAuditoria[];
}

export function planificarDecisionRut(leido: EstadoLeidoDecisionRut, entrada: EntradaDecisionRut): PlanDecisionRut {
  const { validacion, documento } = leido;
  const { actor, ahora } = entrada;
  if (documento.estaDecidido) throw new ConflictoDecisionRutError(validacion.estaDecidida ? 'ya_decidida' : 'inconsistente');
  if (validacion.estaDecidida) throw new ConflictoDecisionRutError('ya_decidida');
  if (!validacion.estaRevisable) throw new ConflictoDecisionRutError('no_revisable');
  if (documento.instantanea().version < leido.versionMaximaRut) throw new ConflictoDecisionRutError('version_vieja');
  if (!validacion.reservadaPor(actor.id, ahora)) throw new ConflictoDecisionRutError('reserva');

  const estadoDocumentoLeido = documento.estado;
  const versionValidacionLeida = validacion.version;
  const docDecidido = Documento.desde(documento.instantanea());
  switch (entrada.decision) {
    case 'aprobar': docDecidido.aprobar(actor.id, entrada.justificacion, ahora); break;
    case 'rechazar': docDecidido.rechazar(actor.id, entrada.justificacion, ahora); break;
    case 'devolver': docDecidido.devolver(entrada.justificacion, actor.id, ahora); break;
  }
  const valDecidida = ValidacionDocumentoEmpresarial.desde(validacion.instantanea());
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
    // Evidencia inmutable de la decisión: quién (actor), qué (acción), cuándo (fecha), el motivo y la justificación cuando aplica.
    evidencia: EvidenciaDocumentoEmpresarial.crear({
      id: randomUUID(), validacionId: validacion.id, intento: validacion.intentos, tipo: TipoEvidenciaDocumentoEmpresarial.DECISION_HUMANA,
      resultado: entrada.decision, metodo: 'decision_documento', fecha: ahora, actorId: actor.id, hashDocumento: doc.hashSha256,
      datos: { rol: actor.rol, accion: entrada.decision, motivo: entrada.motivo, justificacion: entrada.justificacion },
      errorCodigo: null, creadoEn: ahora,
    }).instantanea(),
    auditorias: [
      auditoria(AccionAuditada.DECISION_DOCUMENTO, 'documento', doc.id, { decision: entrada.decision, puntaje: doc.puntaje, banda: doc.banda }, entrada.justificacion),
      auditoria(AccionAuditada.DECISION_RUT, 'validacion_documento_empresarial', validacion.id, entrada.contextoAuditoria, null),
    ],
  };
}
