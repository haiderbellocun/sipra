import { ConflictException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
import {
  datosSipraDePractica, recalcularComparacion, resolverValidacionActa,
} from '../../../domain/services/validacion-acta.domain-service';
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
   * Solo un acta LISTA para revisión se decide. Mientras está pendiente o procesando (o falló), no hay nada que decidir:
   * 409 controlado, y NO se crea una validación artificial. Una ya decidida tampoco se decide otra vez.
   */
  async exigirRevisable(documentoId: string): Promise<ValidacionActa> {
    const validacion = await this.validaciones.buscarPorDocumento(documentoId);
    if (!validacion) throw new ConflictException('El acta todavía no se ha procesado: espere a que esté lista para revisión');
    if (validacion.estaDecidida) throw new ConflictException('El acta ya fue decidida');
    if (!validacion.estaRevisable) {
      throw new ConflictException(
        validacion.estado === EstadoValidacionActa.ERROR
          ? 'El procesamiento del acta falló: debe reintentarse antes de decidir'
          : 'El acta todavía se está procesando: espere a que esté lista para revisión',
      );
    }
    return validacion;
  }

  /**
   * La decisión general del documento se refleja en la validación (estado, motivo, quién y cuándo; libera la reserva) y deja
   * su evidencia. No cambia ningún resultado de lectura. NO crea la validación si no existe. Reintenta ante un cambio
   * concurrente de versión (otra persona reservó o liberó mientras tanto): la decisión del documento ya se aplicó.
   */
  async registrarDecisionHumana(
    documento: Documento, decision: DecisionActa, actor: Actor, motivo: string | null = null, ahora: Date = new Date(),
  ): Promise<void> {
    if (documento.tipo !== TipoDocumento.ACTA_INICIO) return;
    for (let intento = 0; intento < 5; intento += 1) {
      const validacion = await this.validaciones.buscarPorDocumento(documento.id);
      if (!validacion || validacion.estaDecidida) return;
      const versionLeida = validacion.version;
      validacion.registrarDecision(decision, actor.id, ahora, motivo);
      if (!(await this.validaciones.guardarSiVersion(validacion.instantanea(), versionLeida))) continue;
      await this.validaciones.agregarEvidencia(EvidenciaActa.crear({
        id: randomUUID(), validacionActaId: validacion.id, intento: validacion.intentos, tipo: TipoEvidenciaActa.DECISION_HUMANA,
        resultado: decision, metodo: 'decision_documento', fecha: ahora, actorId: actor.id,
        hashDocumento: documento.instantanea().hashSha256, datos: { rol: actor.rol, motivo }, errorCodigo: null, creadoEn: ahora,
      }).instantanea());
      return;
    }
  }

  // ── Cambio de los datos canónicos de la práctica ─────────────────────────

  /**
   * Remuneración y responsable de la ARL gobiernan la comparación. Si cambian (coordinación/administración, con
   * justificación) y ya hay un acta:
   *  · validación en revisión → la comparación se RECALCULA en una ronda nueva (las evidencias anteriores se conservan);
   *  · ya decidida → NO se reabre ni se toca: queda constancia de que los datos cambiaron después;
   *  · pendiente/procesando/error → no hay cálculo aún: usará los datos nuevos al procesarse.
   * El archivo no cambió: no hay versión documental nueva. Nunca se borra historial.
   */
  async alCambiarDatosDeLaPractica(
    practicaId: string, cambios: { remuneracion?: { de: string | null; a: string }; responsableArl?: { de: string | null; a: string } },
    actor: Actor, justificacion: string, ahora: Date = new Date(),
  ): Promise<'sin_acta' | 'sin_calculo' | 'recalculada' | 'marcada_posterior_a_decision'> {
    const actas = (await this.documentos.listarPorPractica(practicaId)).filter((d) => d.tipo === TipoDocumento.ACTA_INICIO);
    if (actas.length === 0) return 'sin_acta';
    const vigente = actas.reduce((m, d) => (d.instantanea().version > m.instantanea().version ? d : m));
    const practica = await this.practicas.buscarPorId(practicaId);
    if (!practica) return 'sin_acta';

    for (let intento = 0; intento < 5; intento += 1) {
      const validacion = await this.validaciones.buscarPorDocumento(vigente.id);
      if (!validacion || !validacion.estaProcesada) return 'sin_calculo';
      const versionLeida = validacion.version;
      const evidenciaCambio = (n: number): EvidenciaActa => EvidenciaActa.crear({
        id: randomUUID(), validacionActaId: validacion.id, intento: n, tipo: TipoEvidenciaActa.CAMBIO_DATOS_PRACTICA,
        resultado: validacion.estaDecidida ? 'posterior_a_decision' : 'recalculada', metodo: 'correccion_datos_practica', fecha: ahora,
        actorId: actor.id, hashDocumento: vigente.instantanea().hashSha256, datos: { cambios, rol: actor.rol, conJustificacion: justificacion.length > 0 },
        errorCodigo: null, creadoEn: ahora,
      });

      if (validacion.estaDecidida) {
        validacion.marcarCambioDeDatosPosterior(ahora);
        if (!(await this.validaciones.guardarSiVersion(validacion.instantanea(), versionLeida))) continue;
        await this.validaciones.agregarEvidencia(evidenciaCambio(validacion.intentos).instantanea());
        await this.auditar(AccionAuditada.ACTA_DATOS_CAMBIARON_TRAS_DECISION, validacion.id, { documentoId: vigente.id, cambios }, actor, justificacion);
        return 'marcada_posterior_a_decision';
      }

      const estudiante = await this.usuarios.buscarPorId(practica.estudianteId);
      const empresa = practica.empresaId ? await this.empresas.buscarPorId(practica.empresaId) : null;
      const sipra = datosSipraDePractica({
        practica: practica.instantanea(),
        estudiante: { nombre: estudiante?.nombre ?? '', documento: estudiante?.instantanea().documento ?? null },
        empresa: empresa ? { razonSocial: empresa.razonSocial, nit: empresa.nit.formateado } : null,
        programa: await this.nombreDelPrograma(estudiante?.instantanea().documento ?? null),
      });
      const v = validacion.instantanea();
      const nueva = recalcularComparacion(v, sipra, ahora);
      if (!nueva) return 'sin_calculo';
      validacion.aplicarRecalculo(nueva.comparacion, nueva.hayDiscrepanciaCritica, ahora);
      if (!(await this.validaciones.guardarSiVersion(validacion.instantanea(), versionLeida))) continue;
      const ronda = validacion.intentos;
      await this.validaciones.agregarEvidencia(evidenciaCambio(ronda).instantanea());
      await this.validaciones.agregarEvidencia(EvidenciaActa.crear({
        id: randomUUID(), validacionActaId: validacion.id, intento: ronda, tipo: TipoEvidenciaActa.COMPARACION,
        resultado: nueva.comparacion.veredicto, metodo: 'comparacion_acta_vs_sipra', fecha: ahora, actorId: actor.id,
        hashDocumento: vigente.instantanea().hashSha256,
        datos: {
          motivo: 'cambio_datos_practica', resumen: nueva.comparacion.resumen,
          camposDiferentes: nueva.comparacion.campos.filter((f) => f.resultado === 'diferente').map((f) => f.campo),
          camposInsuficientes: nueva.comparacion.campos.filter((f) => f.resultado === 'informacion_insuficiente').map((f) => f.campo),
          discrepancias: nueva.comparacion.discrepancias.map((d) => d.codigo),
        },
        errorCodigo: null, creadoEn: ahora,
      }).instantanea());
      await this.auditar(AccionAuditada.ACTA_RECALCULADA, validacion.id, {
        documentoId: vigente.id, veredicto: nueva.comparacion.veredicto, discrepanciasCriticas: nueva.comparacion.discrepancias.filter((d) => d.severidad === 'critica').length,
      }, actor, justificacion);
      return 'recalculada';
    }
    return 'sin_calculo';
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

  private async auditar(
    accion: AccionAuditada, entidadId: string, metadatos: Record<string, unknown>, actor?: Actor, justificacion: string | null = null,
  ): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor?.id ?? null, actorCorreo: actor?.correo ?? 'sistema', actorRol: actor?.rol ?? 'sistema', accion,
      entidad: 'validacion_acta_iniciacion', entidadId, justificacion, metadatos, ip: actor?.ip ?? null,
      agenteUsuario: actor?.agenteUsuario ?? null, ocurridoEn: new Date(),
    });
  }
}
