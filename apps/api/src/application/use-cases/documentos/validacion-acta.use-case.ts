import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LecturaActaPersistible } from '../../../domain/entities/acta-iniciacion';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { Documento, EstadoDocumento, TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  DecisionActa, EstadoValidacionActa, EvidenciaActa, TipoEvidenciaActa, ValidacionActa,
} from '../../../domain/entities/validacion-acta.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, EMPRESA_REPOSITORY,
  EmpresaRepositoryPort, PRACTICA_REPOSITORY, PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { SINU, SinuPort } from '../../../domain/ports/out/servicios-externos.port';
import { VALIDACION_ACTA_REPOSITORY, ValidacionActaRepositoryPort } from '../../../domain/ports/out/validacion-acta.port';
import { datosSipraDePractica, resolverValidacionActa } from '../../../domain/services/validacion-acta.domain-service';
import { Actor } from '../practicas/gestionar-practica.use-case';

/**
 * Validación del acta de iniciación: persiste lo que se interpretó de UN documento (una versión del acta).
 *
 * No lee el archivo: el pipeline ya lo leyó, en local, y dejó la lectura minimizada en la extracción del documento.
 * Aquí se compara contra los datos canónicos de SIPRA (Usuario, Práctica, Empresa), se guarda el resultado y la
 * evidencia, y se audita. Ni aprueba ni rechaza: el acta queda en `revision` para que la decida una persona, y NUNCA
 * modifica a SIPRA (la práctica conserva su remuneración y su responsable de la ARL).
 *
 * Idempotente: repetir el procesamiento no crea otra validación ni otra versión documental, no duplica evidencias
 * (se identifican por validación, ronda y tipo) y no pisa un resultado ni una decisión humana.
 */
@Injectable()
export class ValidacionActaUseCase {
  private readonly log = new Logger(ValidacionActaUseCase.name);

  constructor(
    @Inject(VALIDACION_ACTA_REPOSITORY) private readonly validaciones: ValidacionActaRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(EMPRESA_REPOSITORY) private readonly empresas: EmpresaRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    @Optional() @Inject(SINU) private readonly sinu?: SinuPort,
  ) {}

  // ── Procesamiento (lo invoca el worker) ──────────────────────────────────

  /** Pasa la validación a «procesando» al empezar el trabajo (no pisa una procesada ni una decidida). */
  async marcarProcesando(documentoId: string, ahora: Date = new Date()): Promise<void> {
    const documento = await this.documentos.buscarPorId(documentoId);
    if (!documento || documento.tipo !== TipoDocumento.ACTA_INICIO) return;
    const validacion = await this.obtenerOCrear(documento, ahora);
    if (!validacion || validacion.estaProcesada) return;
    const versionLeida = validacion.version;
    validacion.iniciarProcesamiento(ahora);
    await this.validaciones.guardarSiVersion(validacion.instantanea(), versionLeida);
  }

  /** Deja constancia de que el procesamiento falló (sin detalle del documento); un reintento lo reanuda. */
  async marcarErrorProcesamiento(documentoId: string, codigo: string, ahora: Date = new Date()): Promise<void> {
    const validacion = await this.validaciones.buscarPorDocumento(documentoId);
    if (!validacion || validacion.estaProcesada) return;
    const versionLeida = validacion.version;
    validacion.marcarError(codigo, ahora);
    await this.validaciones.guardarSiVersion(validacion.instantanea(), versionLeida);
  }

  /** Registra el resultado del procesamiento local de un acta. */
  async registrarProcesamiento(documento: Documento, ahora: Date = new Date()): Promise<ValidacionActa | null> {
    if (documento.tipo !== TipoDocumento.ACTA_INICIO) return null;
    const datos = documento.instantanea();
    // Mientras el pipeline no haya terminado no hay resultado que registrar.
    if ([EstadoDocumento.RECIBIDO, EstadoDocumento.ANALIZANDO].includes(datos.estado)) return null;

    let validacion = await this.validaciones.buscarPorDocumento(datos.id);
    // Ya procesada o decidida (otro intento, otro proceso, una persona): nada que hacer.
    if (validacion?.estaProcesada) return validacion;

    const practica = await this.practicas.buscarPorId(datos.practicaId);
    if (!practica) return null;
    const estudiante = await this.usuarios.buscarPorId(practica.estudianteId);
    if (!estudiante) return null;

    validacion = validacion ?? await this.obtenerOCrear(documento, ahora);
    if (!validacion || validacion.estaProcesada) return validacion;
    // Abre la ronda de evidencias (pendiente/error) o reanuda la interrumpida («procesando»): la ronda no cambia al reanudar.
    if (validacion.estado !== EstadoValidacionActa.PROCESANDO) {
      const v = validacion.version;
      validacion.iniciarProcesamiento(ahora);
      if (!(await this.validaciones.guardarSiVersion(validacion.instantanea(), v))) {
        return (await this.validaciones.buscarPorDocumento(datos.id)) ?? validacion;
      }
      validacion = (await this.validaciones.buscarPorDocumento(datos.id)) ?? validacion;
    }

    const lectura = (datos.extraccion as { lecturaActa?: LecturaActaPersistible } | null)?.lecturaActa ?? null;
    const { practica: dp, estudiante: de } = { practica: practica.instantanea(), estudiante: estudiante.instantanea() };
    const empresa = dp.empresaId ? await this.empresas.buscarPorId(dp.empresaId) : null;
    const sipra = datosSipraDePractica({
      practica: dp,
      estudiante: { nombre: estudiante.nombre, documento: de.documento },
      empresa: empresa ? { razonSocial: empresa.razonSocial, nit: empresa.nit.formateado } : null,
      programa: await this.nombreDelPrograma(de.documento),
    });
    const { resultado, evidencias } = resolverValidacionActa(lectura, sipra, ahora);

    // Las evidencias van ANTES del cambio de estado: son idempotentes por (validación, ronda, tipo), así que si el
    // proceso se interrumpe aquí el reintento las completa sin duplicar; y si otro proceso gana, no hay conflicto.
    const intento = validacion.intentos;
    for (const e of evidencias) {
      await this.validaciones.agregarEvidencia(EvidenciaActa.crear({
        id: randomUUID(), validacionActaId: validacion.id, intento, tipo: e.tipo, resultado: e.resultado, metodo: e.metodo,
        fecha: ahora, actorId: null, hashDocumento: datos.hashSha256, datos: e.datos, errorCodigo: null, creadoEn: ahora,
      }).instantanea());
    }

    const versionLeida = validacion.version;
    validacion.registrarResultado(resultado, ahora);
    // Compare-and-set por versión: si otro proceso la tocó, no se pisa ni se duplica la auditoría.
    if (!(await this.validaciones.guardarSiVersion(validacion.instantanea(), versionLeida))) {
      this.log.warn(`Validación de acta ${validacion.id}: la modificó otro proceso; se conserva su resultado`);
      return (await this.validaciones.buscarPorId(validacion.id)) ?? validacion;
    }

    // Una sola entrada de auditoría por procesamiento, con códigos y conteos (nunca datos del documento).
    await this.auditar(AccionAuditada.ACTA_PROCESADA, validacion.id, {
      documentoId: datos.id,
      version: datos.version,
      tipoActa: resultado.tipoActaDetectada,
      remuneracion: resultado.remuneracionDetectada,
      responsableArl: resultado.responsableArlDetectado,
      firmaEmpresa: resultado.firmaEmpresa,
      firmaPracticante: resultado.firmaPracticante,
      metodo: resultado.metodoLectura,
      veredicto: resultado.comparacion?.veredicto ?? null,
      discrepanciasCriticas: resultado.comparacion?.discrepancias.filter((d) => d.severidad === 'critica').length ?? 0,
    });
    return (await this.validaciones.buscarPorId(validacion.id)) ?? validacion;
  }

  // ── Decisión humana tomada sobre el documento ────────────────────────────

  /**
   * La decisión general del documento (aprobar, devolver, rechazar) se refleja en la validación y deja su evidencia.
   * No cambia ningún resultado de lectura. Para otros tipos de documento no hace nada.
   */
  async registrarDecisionHumana(documento: Documento, decision: DecisionActa, actor: Actor, ahora: Date = new Date()): Promise<void> {
    if (documento.tipo !== TipoDocumento.ACTA_INICIO) return;
    const validacion = await this.obtenerOCrear(documento, ahora);
    if (!validacion || validacion.estaDecidida) return;
    const versionLeida = validacion.version;
    validacion.registrarDecision(decision, actor.id, ahora);
    if (!(await this.validaciones.guardarSiVersion(validacion.instantanea(), versionLeida))) return;
    await this.validaciones.agregarEvidencia(EvidenciaActa.crear({
      id: randomUUID(), validacionActaId: validacion.id, intento: validacion.intentos, tipo: TipoEvidenciaActa.DECISION_HUMANA,
      resultado: decision, metodo: 'decision_documento', fecha: ahora, actorId: actor.id,
      hashDocumento: documento.instantanea().hashSha256, datos: { rol: actor.rol }, errorCodigo: null, creadoEn: ahora,
    }).instantanea());
  }

  // ── internos ─────────────────────────────────────────────────────────────

  private async obtenerOCrear(documento: Documento, ahora: Date): Promise<ValidacionActa | null> {
    const datos = documento.instantanea();
    const existente = await this.validaciones.buscarPorDocumento(datos.id);
    if (existente) return existente;
    const practica = await this.practicas.buscarPorId(datos.practicaId);
    if (!practica) return null;
    const nueva = ValidacionActa.pendiente({
      id: randomUUID(), documentoId: datos.id, practicaId: datos.practicaId, estudianteId: practica.estudianteId,
      recibidaEn: datos.cargadoEn, ahora,
    });
    return (await this.validaciones.crearSiNoExiste(nueva.instantanea())).validacion;
  }

  /** El nombre del programa viene de SINU; si no se puede leer, esa fila de la comparación queda «información insuficiente». */
  private async nombreDelPrograma(documentoEstudiante: string | null): Promise<string | null> {
    if (!documentoEstudiante || !this.sinu) return null;
    try {
      return (await this.sinu.buscarPorDocumento(documentoEstudiante))?.programaNombre ?? null;
    } catch {
      return null;
    }
  }

  private async auditar(accion: AccionAuditada, entidadId: string, metadatos: Record<string, unknown>): Promise<void> {
    await this.auditoria.registrar({
      actorId: null, actorCorreo: 'sistema', actorRol: 'sistema', accion, entidad: 'validacion_acta_iniciacion', entidadId,
      justificacion: null, metadatos, ip: null, agenteUsuario: null, ocurridoEn: new Date(),
    });
  }
}
