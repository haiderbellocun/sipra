import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import {
  DatosRutExtraidos, ESTADOS_DECIDIDOS_EMPRESARIAL, EstadoValidacionDocumentoEmpresarial,
} from '../../../domain/entities/documento-empresarial';
import { Documento, EstadoDocumento, SeveridadBandera, TipoDocumento } from '../../../domain/entities/documento.entity';
import { DatosValidacionEps } from '../../../domain/entities/validacion-eps.entity';
import { LECTOR_DOCUMENTO_LOCAL, LectorDocumentoLocalPort } from '../../../domain/ports/out/lector-documento-local.port';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, EMPRESA_REPOSITORY,
  EmpresaRepositoryPort, PRACTICA_REPOSITORY, PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { ALMACENAMIENTO, AlmacenamientoPort, CampoExtraido } from '../../../domain/ports/out/servicios-externos.port';
import { VALIDACION_EPS_REPOSITORY, ValidacionEpsRepositoryPort } from '../../../domain/ports/out/validacion-eps.port';
import {
  VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY, ValidacionDocumentoEmpresarialRepositoryPort,
} from '../../../domain/ports/out/validacion-documento-empresarial.port';
import { analizarCertificadoArl } from '../../../domain/services/clasificacion-documental-arl.domain-service';
import {
  DecisionAutomaticaDocumento, FuenteDato, TIPOS_CON_MOTOR_DE_DECISION, consolidarDecision, motorDecisionAutorizado,
} from '../../../domain/services/decision-automatica-documental.domain-service';
import { LIMITES_LECTURA_EPS } from '../../../domain/services/lectura-local.domain-service';
import {
  CAMPO_EXTRACCION_EPS, CampoCriticoEps, HechosDocumentoEmpresarial, decidirArl, decidirCamara, decidirEps, decidirRut,
} from '../../../domain/services/politicas-decision-documental.domain-service';
import { EventoNotificable } from '../../../domain/services/plantillas-notificacion.domain-service';
import { NotificacionesService } from '../../../infrastructure/modules/notificaciones.service';
import { interruptoresDecisionAutomatica } from '../../services/interruptores-decision-automatica';

type ResultadoAuditado = 'auto_aprobado' | 'auto_devuelto' | 'revision';

interface ExtraccionPersistida {
  campos?: Record<string, CampoExtraido>;
  rescateIa?: { invocado?: boolean; fuentesFinales?: Record<string, string> } | null;
  lecturaLocal?: { clasificacion?: { tipo?: string; motivos?: string[]; subtipoIncorrecto?: string } } | null;
}

/**
 * Aplica el MOTOR DE DECISIÓN DOCUMENTAL AUTOMÁTICA (§7.36) a un documento que su motor especializado ya procesó.
 *
 *  · No sustituye ningún motor: lee los HECHOS que ya calcularon (validación de EPS, de documentos empresariales, lectura
 *    local) y los pasa a la política del tipo. Lo único que lee aquí es el texto NATIVO del certificado de ARL (local).
 *  · Solo actúa con el general encendido y en `dev`; solo sobre un documento `en_revision`; nunca sobre una decisión humana
 *    ni sobre un caso reservado por una persona. La escritura es condicional (`guardarSiEstado`): idempotente.
 *  · No hay rechazo automático. `auto_devuelto` permite una nueva versión.
 *  · Auditoría con CÓDIGOS (sin valores ni datos personales). Nunca lanza: un fallo deja el documento en revisión.
 */
@Injectable()
export class DecisionAutomaticaDocumentalUseCase {
  private readonly log = new Logger(DecisionAutomaticaDocumentalUseCase.name);

  constructor(
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Optional() private readonly config?: ConfigService,
    @Optional() @Inject(AUDITORIA_REPOSITORY) private readonly auditoria?: AuditoriaRepositoryPort,
    @Optional() @Inject(VALIDACION_EPS_REPOSITORY) private readonly validacionesEps?: ValidacionEpsRepositoryPort,
    @Optional() @Inject(VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY) private readonly validacionesEmpresariales?: ValidacionDocumentoEmpresarialRepositoryPort,
    @Optional() @Inject(EMPRESA_REPOSITORY) private readonly empresas?: EmpresaRepositoryPort,
    @Optional() @Inject(ALMACENAMIENTO) private readonly almacen?: AlmacenamientoPort,
    @Optional() @Inject(LECTOR_DOCUMENTO_LOCAL) private readonly lector?: LectorDocumentoLocalPort,
    @Optional() private readonly notificaciones?: NotificacionesService,
  ) {}

  /** Evalúa y, si corresponde, aplica. Devuelve la decisión ejecutada, o null si el motor no actuó (apagado, no aplica…). */
  async evaluar(documentoId: string, ahora: Date = new Date()): Promise<DecisionAutomaticaDocumento | null> {
    try {
      const interruptores = interruptoresDecisionAutomatica(this.config);
      if (!motorDecisionAutorizado(interruptores, this.config?.get<string>('SIPRA_AMBIENTE'))) return null;
      const documento = await this.documentos.buscarPorId(documentoId);
      if (!documento || !TIPOS_CON_MOTOR_DE_DECISION.includes(documento.tipo)) return null;
      // Solo un documento que espera revisión: lo ya decidido (por persona o por el motor) no se vuelve a decidir.
      if (documento.estado !== EstadoDocumento.EN_REVISION) return null;

      const propuesta = await this.proponer(documento, ahora);
      if (!propuesta) return null;
      const decision = consolidarDecision(documento.tipo, propuesta, interruptores);

      if (decision.resultado === 'auto_aprobar') documento.aplicarAutoAprobacion(ahora);
      else if (decision.resultado === 'auto_devolver') documento.aplicarAutoDevolucion(decision.mensajeUsuario, ahora);
      if (decision.resultado !== 'revision') {
        const guardado = await this.documentos.guardarSiEstado(documento.instantanea(), EstadoDocumento.EN_REVISION);
        // Otra decisión llegó en medio (una persona, otra ejecución): la suya manda; no se audita lo que no se aplicó.
        if (!guardado) return null;
      }
      await this.auditar(documento, propuesta, decision, ahora);
      if (decision.resultado === 'auto_devolver') await this.avisar(documento);
      this.log.log(`Documento ${documentoId}: decisión automática ${decision.resultado} (${decision.politica}: ${decision.motivos.join(', ')})`);
      return decision;
    } catch (error) {
      this.log.warn(`Documento ${documentoId}: la decisión automática no se aplicó (${(error as Error).name}); queda en revisión`);
      return null;
    }
  }

  /** La propuesta de la política del tipo, o null si no hay base para decidir (decidido, reservado, sin motor). */
  private async proponer(documento: Documento, ahora: Date): Promise<DecisionAutomaticaDocumento | null> {
    const datos = documento.instantanea();
    const hayBanderaCritica = datos.banderas.some((b) => b.severidad === SeveridadBandera.CRITICA);
    switch (datos.tipo) {
      case TipoDocumento.CERTIFICADO_EPS: {
        const v = (await this.validacionesEps?.buscarPorDocumento(datos.id))?.instantanea() ?? null;
        if (!v || this.reservadaPorPersona(v.asignadoA, v.reservaHasta, ahora)) return null;
        if (['aprobado_manual', 'devuelto', 'rechazado', 'aprobado_automatico'].includes(v.decision)) return null;
        return decidirEps(this.hechosEps(v, datos.extraccion));
      }
      case TipoDocumento.RUT_NATURAL:
      case TipoDocumento.RUT_JURIDICO:
      case TipoDocumento.CAMARA_COMERCIO: {
        const v = (await this.validacionesEmpresariales?.buscarPorDocumento(datos.id))?.instantanea() ?? null;
        if (!v || ESTADOS_DECIDIDOS_EMPRESARIAL.includes(v.estado) || this.reservadaPorPersona(v.asignadoA, v.reservaHasta, ahora)) return null;
        const hechos: HechosDocumentoEmpresarial = {
          procesada: v.estado === EstadoValidacionDocumentoEmpresarial.REVISION,
          tipoDetectado: v.tipoDetectado, expectativa: v.expectativa, lecturaDudosa: v.lecturaDudosa, metodoLectura: v.metodoLectura,
          comparacion: v.comparacion,
          controlNit: (v.datosExtraidos as DatosRutExtraidos | null)?.controlNit ?? null,
          autenticidad: v.autenticidad.estado, hayBanderaCritica,
        };
        return datos.tipo === TipoDocumento.CAMARA_COMERCIO ? decidirCamara(hechos) : decidirRut(datos.tipo, hechos);
      }
      case TipoDocumento.CERTIFICADO_ARL:
        return decidirArl(await this.hechosArl(documento, hayBanderaCritica));
      default:
        return null;
    }
  }

  private reservadaPorPersona(asignadoA: string | null, reservaHasta: Date | null, ahora: Date): boolean {
    return asignadoA !== null && reservaHasta !== null && reservaHasta.getTime() > ahora.getTime();
  }

  /** Hechos de EPS: los de su validación + la procedencia de cada dato crítico (incluido lo que aportó la IA de rescate). */
  private hechosEps(v: DatosValidacionEps, extraccion: ExtraccionPersistida | null) {
    const local = extraccion?.lecturaLocal?.clasificacion?.tipo;
    const clasificacion = v.datosExtraidos?.tipoDocumentoDetectado ?? (esClasificacionEps(local) ? local : null);
    const subtipo = extraccion?.lecturaLocal?.clasificacion?.subtipoIncorrecto
      ?? v.datosExtraidos?.motivosClasificacion?.find((m) => m.startsWith('subtipo_'))?.slice('subtipo_'.length)
      ?? null;
    const procedencia: Partial<Record<CampoCriticoEps, FuenteDato>> = {};
    for (const [critico, campo] of Object.entries(CAMPO_EXTRACCION_EPS) as [CampoCriticoEps, string][]) {
      procedencia[critico] = procedenciaDe(extraccion, campo);
    }
    return {
      clasificacion, subtipoIncorrecto: subtipo, estadoProcesamiento: v.estadoProcesamiento, autenticidad: v.autenticidad,
      coincidencia: v.coincidencia, discrepancias: v.discrepancias.map((d) => ({ campo: d.campo, comparacion: d.comparacion })),
      afiliacion: v.afiliacion, afiliacionFuente: v.afiliacionFuente, vigencia: v.vigenciaCertificado,
      hayBanderaCritica: v.hayBanderaCritica, procedencia,
    };
  }

  /** ARL: texto NATIVO local del PDF (sin OCR ni proveedor externo) contrastado con lo que SIPRA sabe de la práctica. */
  private async hechosArl(documento: Documento, hayBanderaCritica: boolean) {
    const datos = documento.instantanea();
    const practica = await this.practicas.buscarPorId(datos.practicaId);
    const estudiante = practica ? await this.usuarios.buscarPorId(practica.estudianteId) : null;
    let nitEmpresa: string | null = null;
    if (practica?.empresaId && this.empresas) {
      try { nitEmpresa = (await this.empresas.buscarPorId(practica.empresaId))?.nit.numero ?? null; } catch { nitEmpresa = null; }
    }
    let texto: string | null = null;
    if (datos.mimeReal === 'application/pdf' && this.almacen && this.lector) {
      try {
        const contenido = await this.almacen.leer(datos.rutaAlmacenamiento);
        const nativo = await this.lector.extraerTextoNativo(contenido, LIMITES_LECTURA_EPS);
        texto = nativo.porPagina.map((p) => p.texto).join('\n');
      } catch {
        texto = null;
      }
    }
    return {
      analisis: texto ? analizarCertificadoArl(texto, { documentoEstudiante: estudiante?.instantanea().documento ?? null, nitEmpresa }) : null,
      fechaInicioPractica: practica?.fechaInicio ? practica.fechaInicio.toISOString().slice(0, 10) : null,
      empresaConocida: nitEmpresa !== null,
      hayBanderaCritica,
    };
  }

  /** Una entrada por decisión. Solo códigos: ni valores, ni nombres, ni documentos, ni texto. */
  private async auditar(
    documento: Documento, propuesta: DecisionAutomaticaDocumento, decision: DecisionAutomaticaDocumento, ahora: Date,
  ): Promise<void> {
    const datos = documento.instantanea();
    const resultado: ResultadoAuditado = decision.resultado === 'auto_aprobar' ? 'auto_aprobado'
      : decision.resultado === 'auto_devolver' ? 'auto_devuelto' : 'revision';
    try {
      await this.auditoria?.registrar({
        actorId: null, actorCorreo: 'sistema', actorRol: 'sistema',
        accion: AccionAuditada.DECISION_AUTOMATICA_DOCUMENTO,
        entidad: 'documento', entidadId: datos.id, justificacion: null,
        metadatos: {
          documentoId: datos.id,
          tipo: datos.tipo,
          resultado,
          resultadoPropuesto: propuesta.resultado,
          politica: decision.politica,
          motivos: decision.motivos,
          rescateIa: (datos.extraccion as ExtraccionPersistida | null)?.rescateIa?.invocado === true,
          verificacionOficial: decision.verificacionOficial,
          fuentesCriticas: decision.fuentesCriticas,
          ...(decision.resultado === 'auto_devolver' ? { tipoDevolucion: decision.tipoDevolucion, mensajeUsuario: decision.mensajeUsuario } : {}),
        },
        ip: null, agenteUsuario: null, ocurridoEn: ahora,
      });
    } catch (error) {
      this.log.warn(`Auditoría de la decisión automática: no se registró (${(error as Error).name})`);
    }
  }

  /** Aviso al estudiante de una devolución automática: el mensaje genérico, nunca datos del documento. */
  private async avisar(documento: Documento): Promise<void> {
    try {
      const datos = documento.instantanea();
      const practica = await this.practicas.buscarPorId(datos.practicaId);
      const estudiante = practica ? await this.usuarios.buscarPorId(practica.estudianteId) : null;
      if (!estudiante || !this.notificaciones) return;
      await this.notificaciones.notificar(
        EventoNotificable.DOCUMENTO_DEVUELTO,
        { correo: estudiante.correo, nombre: estudiante.nombre, id: estudiante.id },
        { tipoDocumento: datos.tipo, motivo: datos.motivoDevolucion ?? undefined, guias: [] },
      );
    } catch (error) {
      this.log.warn(`Aviso de devolución automática: no se envió (${(error as Error).name})`);
    }
  }
}

type ClasificacionEps = 'certificado_eps_probable' | 'documento_incorrecto' | 'no_determinable';
const esClasificacionEps = (t: string | undefined): t is ClasificacionEps =>
  t === 'certificado_eps_probable' || t === 'documento_incorrecto' || t === 'no_determinable';

/** Procedencia de un campo de la extracción: lo que dijo la fusión del rescate, o la fuente local, o «lectura base». */
function procedenciaDe(extraccion: ExtraccionPersistida | null, campo: string): FuenteDato {
  const final = extraccion?.rescateIa?.fuentesFinales?.[campo];
  if (final === 'qr' || final === 'texto_nativo' || final === 'ocr' || final === 'ia_rescate' || final === 'lectura_base' || final === 'sin_valor') return final;
  const c = extraccion?.campos?.[campo];
  if (!c || c.valor === null || String(c.valor).trim() === '') return 'sin_valor';
  return c.fuente ?? 'lectura_base';
}
