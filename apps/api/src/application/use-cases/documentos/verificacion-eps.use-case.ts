import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  EvidenciaEps, FuenteEvidenciaEps, TipoEvidenciaEps, origenSinCredenciales,
} from '../../../domain/entities/evidencia-validacion-eps.entity';
import {
  AutenticidadEps, EstadoProcesamientoEps, RutaValidacionEps, ValidacionEpsYaDecididaError,
} from '../../../domain/entities/validacion-eps.entity';
import {
  LECTOR_DOCUMENTO_LOCAL, LectorDocumentoLocalPort,
} from '../../../domain/ports/out/lector-documento-local.port';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort,
  PRACTICA_REPOSITORY, PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { ALMACENAMIENTO, AlmacenamientoPort } from '../../../domain/ports/out/servicios-externos.port';
import {
  CodigoErrorVerificacion, ResultadoVerificacionEps, VERIFICADOR_CERTIFICADO_EPS, VerificadorCertificadoEpsPort,
} from '../../../domain/ports/out/verificador-certificado-eps.port';
import {
  VALIDACION_EPS_REPOSITORY, ValidacionEpsRepositoryPort,
} from '../../../domain/ports/out/validacion-eps.port';
import { LecturaLocalEpsService } from '../../../domain/services/lectura-local-eps.domain-service';
import { clasificarContenidoQr } from '../../../domain/services/lectura-local.domain-service';
import {
  REGISTRO_VERIFICADORES_EPS, RegistroVerificadoresEps, VerificadorEpsDefinicion,
} from '../../../domain/services/registro-verificadores-eps';
import { aliasesAprobados, concluirVerificacion } from '../../../domain/services/verificacion-eps.domain-service';
import { puedeOperarValidacionEps } from '../../../domain/value-objects/acceso-eps.vo';
import { Actor } from '../practicas/gestionar-practica.use-case';
import { INTERRUPTORES_EPS, interruptorEps } from '../../services/interruptores-eps';

/** Un reclamo de verificación abandonado (proceso caído) deja de bloquear pasado este tiempo. */
export const CADUCIDAD_RECLAMO_VERIFICACION_MS = 2 * 60_000;
/** Tras un intento que no concluyó, un reintento automático no vuelve a consultar el portal antes de esto. */
export const VENTANA_REINTENTO_VERIFICACION_MS = 10 * 60_000;

export type ResultadoVerificarEps =
  | 'deshabilitada' | 'no_aplica' | 'ya_verificada' | 'reciente' | 'en_curso'
  | 'sin_qr' | 'qr_no_soportado' | 'qr_ambiguo' | 'requiere_interaccion_humana'
  | 'verificado' | 'rechazado' | 'no_verificable';

/**
 * Verificación de autenticidad (y afiliación, si la fuente la confirma) de un
 * certificado de EPS contra un mecanismo OFICIAL registrado.
 *
 * Reglas: el QR hallado NO es autenticidad; una URL de un host que no está en el
 * registro NO recibe ninguna petición; un portal caído NO vuelve falso al
 * certificado; la autenticidad no implica afiliación; nada se autoaprueba.
 *
 * Registros por identificadores: ni la URL del QR ni datos personales salen a
 * auditoría ni a logs.
 */
@Injectable()
export class VerificacionEpsUseCase {
  private readonly log = new Logger(VerificacionEpsUseCase.name);
  private readonly lectura: LecturaLocalEpsService;
  private readonly aliasEps: Record<string, string>;

  constructor(
    @Inject(VALIDACION_EPS_REPOSITORY) private readonly validaciones: ValidacionEpsRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    @Inject(LECTOR_DOCUMENTO_LOCAL) lector: LectorDocumentoLocalPort,
    @Inject(REGISTRO_VERIFICADORES_EPS) private readonly registro: RegistroVerificadoresEps,
    @Inject(VERIFICADOR_CERTIFICADO_EPS) private readonly verificador: VerificadorCertificadoEpsPort,
    @Optional() private readonly config?: ConfigService,
  ) {
    this.lectura = new LecturaLocalEpsService(lector);
    this.aliasEps = aliasesAprobados(registro.verificadores);
  }

  /** Apagada por defecto: se enciende cuando hay al menos un verificador aprobado y su adaptador. */
  get habilitada(): boolean {
    return interruptorEps(this.config, INTERRUPTORES_EPS.verificacion);
  }

  /** Para operación: reintento manual de la verificación de una validación (no respeta la ventana de espera). */
  async verificarComoOperador(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<ResultadoVerificarEps> {
    if (!puedeOperarValidacionEps(actor.rol)) throw new ForbiddenException('Su perfil no opera la validación de EPS');
    const validacion = await this.validaciones.buscarPorId(validacionId);
    if (!validacion) throw new NotFoundException('Validación no encontrada');
    const practica = await this.practicas.buscarPorId(validacion.practicaId);
    if (!practica?.visiblePara({ id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId })) {
      throw new NotFoundException('Validación no encontrada');
    }
    return this.verificar(validacion.documentoId, { forzar: true, actor, ahora });
  }

  async verificar(
    documentoId: string, opciones: { forzar?: boolean; actor?: Actor; ahora?: Date } = {},
  ): Promise<ResultadoVerificarEps> {
    const ahora = opciones.ahora ?? new Date();
    if (!this.habilitada) return 'deshabilitada';

    const documento = await this.documentos.buscarPorId(documentoId);
    if (!documento || documento.tipo !== TipoDocumento.CERTIFICADO_EPS) return 'no_aplica';
    let validacion = await this.validaciones.buscarPorDocumento(documentoId);
    if (!validacion || validacion.estadoProcesamiento !== EstadoProcesamientoEps.PROCESADO || validacion.estaDecidida) return 'no_aplica';

    // Idempotencia: un resultado definitivo no se repite; un intento reciente sin conclusión, tampoco.
    if (validacion.tieneVerificacionDefinitiva) return 'ya_verificada';
    if (!opciones.forzar && validacion.verificacionError !== null
      && ahora.getTime() - validacion.instantanea().actualizadaEn.getTime() < VENTANA_REINTENTO_VERIFICACION_MS) {
      return 'reciente';
    }

    // Concurrencia: el reclamo se guarda con compare-and-set por versión; de dos workers, uno solo gana.
    if (validacion.verificacionEnCurso(ahora, CADUCIDAD_RECLAMO_VERIFICACION_MS)) return 'en_curso';
    const versionLeida = validacion.version;
    validacion.iniciarVerificacion(ahora);
    if (!(await this.validaciones.guardarSiVersion(validacion.instantanea(), versionLeida))) return 'en_curso';
    await this.auditar(AccionAuditada.VERIFICACION_EPS_INICIADA, validacion.id, { documentoId }, opciones.actor);

    try {
      return await this.ejecutar(documento.instantanea().rutaAlmacenamiento, documento.instantanea().mimeReal, validacion.id, documentoId, ahora, opciones.actor);
    } catch (error) {
      // Cualquier fallo inesperado libera el reclamo y deja constancia; no concluye nada sobre el certificado.
      this.log.error(`Verificación EPS ${validacion.id}: fallo inesperado (${(error as Error).name})`);
      validacion = (await this.validaciones.buscarPorId(validacion.id)) ?? validacion;
      await this.cerrarSinConclusion(validacion.id, 'verificador_no_disponible', ahora, opciones.actor);
      return 'no_verificable';
    }
  }

  // ── Núcleo ───────────────────────────────────────────────────────────────

  private async ejecutar(
    ruta: string, mime: string, validacionId: string, documentoId: string, ahora: Date, actor?: Actor,
  ): Promise<ResultadoVerificarEps> {
    let archivo: Buffer;
    try { archivo = await this.almacen.leer(ruta); } catch {
      await this.cerrarSinConclusion(validacionId, 'documento_no_disponible', ahora, actor);
      return 'no_verificable';
    }
    // El QR se vuelve a leer del archivo: la URL completa solo vive en memoria durante la consulta.
    const qrs = await this.lectura.detectarQrCrudos(archivo, mime);
    if (qrs.length === 0) {
      await this.cerrarSinConclusion(validacionId, 'sin_qr', ahora, actor, false);
      return 'sin_qr';
    }

    // Se separan los QR que apuntan a un verificador registrado; el resto NO recibe ninguna petición.
    const candidatos = new Map<string, { url: string; verificador: VerificadorEpsDefinicion }>();
    for (const q of qrs) {
      if (clasificarContenidoQr(q.contenido).tipo !== 'url') continue;
      const destino = this.registro.resolver(q.contenido.trim());
      if (destino.permitido) candidatos.set(destino.url.href, { url: destino.url.href, verificador: destino.verificador });
    }
    if (candidatos.size === 0) {
      await this.cerrarSinConclusion(validacionId, 'qr_no_soportado', ahora, actor, false);
      return 'qr_no_soportado';
    }
    // Varios QR oficiales distintos: no se elige uno por el usuario.
    if (candidatos.size > 1) {
      await this.cerrarSinConclusion(validacionId, 'qr_ambiguo', ahora, actor, false);
      return 'qr_ambiguo';
    }
    const [{ url, verificador }] = [...candidatos.values()];
    if (!RegistroVerificadoresEps.puedeConsultarse(verificador)) {
      await this.cerrarSinConclusion(validacionId, 'requiere_interaccion_humana', ahora, actor, false);
      return 'requiere_interaccion_humana';
    }

    const validacion = await this.validaciones.buscarPorId(validacionId);
    if (!validacion) return 'no_aplica';
    const certificado = validacion.instantanea().datosExtraidos;
    const practica = await this.practicas.buscarPorId(validacion.practicaId);
    const estudiante = practica ? await this.usuarios.buscarPorId(practica.estudianteId) : null;
    const interno = { numeroDocumento: estudiante?.instantanea().documento ?? null, nombre: estudiante?.nombre ?? null };

    const resultado = await this.verificador.verificar({ url, verificador, datosCertificado: certificado });
    const conclusion = concluirVerificacion(resultado, verificador, certificado, interno, this.aliasEps);

    // Se persiste con compare-and-set por versión (la validación pudo cambiar durante la consulta).
    for (let intento = 0; intento < 3; intento += 1) {
      const actual = await this.validaciones.buscarPorId(validacionId);
      if (!actual) return 'no_aplica';
      const versionActual = actual.version;
      try {
        if (conclusion.definitiva) {
          actual.registrarVerificacionOficial({
            verificador: verificador.codigo, autenticidad: conclusion.autenticidad, afiliacion: conclusion.afiliacion,
            ruta: conclusion.ruta, datosVerificados: conclusion.datosVerificados, discrepancias: conclusion.discrepancias,
            coincidencia: conclusion.coincidencia,
          }, ahora);
        } else {
          actual.registrarVerificacionNoConcluyente(conclusion.errorCodigo ?? 'verificador_no_disponible', ahora, conclusion.autenticidad);
        }
      } catch (error) {
        if (error instanceof ValidacionEpsYaDecididaError) return 'no_aplica'; // una persona decidió mientras tanto
        throw error;
      }
      if (!(await this.validaciones.guardarSiVersion(actual.instantanea(), versionActual))) continue;
      await this.validaciones.agregarEvidencia(this.evidencia(validacionId, resultado, verificador, conclusion.errorCodigo, ahora).instantanea());
      await this.auditar(
        conclusion.definitiva || resultado.estado !== 'no_verificable'
          ? AccionAuditada.VERIFICACION_EPS_COMPLETADA : AccionAuditada.VERIFICACION_EPS_FALLIDA,
        validacionId,
        {
          documentoId, verificador: verificador.codigo, resultado: resultado.estado, autenticidad: conclusion.autenticidad,
          afiliacion: conclusion.afiliacion ?? null, errorCodigo: conclusion.errorCodigo, discrepancias: conclusion.discrepancias.length,
        },
        actor,
      );
      return resultado.estado === 'verificado' && conclusion.autenticidad === AutenticidadEps.INVALIDA ? 'rechazado' : resultado.estado;
    }
    // Sin poder guardar tras varios intentos: se libera el reclamo y se deja constancia.
    await this.cerrarSinConclusion(validacionId, 'verificador_no_disponible', ahora, actor);
    return 'no_verificable';
  }

  /**
   * Cierra el intento sin concluir sobre el certificado. `fallida` distingue una
   * falla técnica (se audita como fallida) de un hecho esperado (no hay QR).
   */
  private async cerrarSinConclusion(
    validacionId: string, codigo: CodigoErrorVerificacion, ahora: Date, actor?: Actor, fallida = true,
  ): Promise<void> {
    for (let intento = 0; intento < 3; intento += 1) {
      const v = await this.validaciones.buscarPorId(validacionId);
      if (!v) return;
      const versionLeida = v.version;
      try {
        v.registrarVerificacionNoConcluyente(codigo, ahora, AutenticidadEps.NO_VERIFICABLE);
        if (v.ruta === RutaValidacionEps.SIN_DETERMINAR) v.registrarVerificacion({ ruta: RutaValidacionEps.REVISION_MANUAL }, ahora);
      } catch (error) {
        if (error instanceof ValidacionEpsYaDecididaError) return;
        throw error;
      }
      if (await this.validaciones.guardarSiVersion(v.instantanea(), versionLeida)) {
        await this.auditar(
          fallida ? AccionAuditada.VERIFICACION_EPS_FALLIDA : AccionAuditada.VERIFICACION_EPS_COMPLETADA,
          validacionId, { resultado: 'no_verificable', errorCodigo: codigo }, actor,
        );
        return;
      }
    }
  }

  private evidencia(
    validacionId: string, r: ResultadoVerificacionEps, v: VerificadorEpsDefinicion,
    errorCodigo: CodigoErrorVerificacion | null, ahora: Date,
  ): EvidenciaEps {
    const campos = r.estado === 'verificado'
      ? Object.entries(r.datosVerificados).filter(([k, val]) => val !== null && !['fuente', 'verificadoEn'].includes(k)).map(([k]) => k)
      : [];
    return EvidenciaEps.crear({
      id: randomUUID(),
      validacionEpsId: validacionId,
      tipo: TipoEvidenciaEps.RESPUESTA_EPS,
      fuente: FuenteEvidenciaEps.EPS_OFICIAL,
      metodo: `verificador_${v.codigo}`.slice(0, 60),
      resultado: r.estado,
      fechaVerificacion: ahora,
      hashEvidencia: r.hashRespuesta,
      // Solo protocolo, host y ruta: sin parámetros, usuario ni fragmento.
      origen: r.origen && r.origen.length <= 300 && origenSinCredenciales(r.origen) ? r.origen : null,
      datosObtenidos: {
        verificador: v.codigo, emisor: v.emisor, httpStatus: r.httpStatus, bytes: r.bytes, camposObtenidos: campos,
        autenticaCertificado: v.autenticaCertificado, confirmaAfiliacion: v.confirmaAfiliacion,
      },
      errorCodigo: errorCodigo ?? (r.estado === 'verificado' ? null : (r as { errorCodigo: string }).errorCodigo),
      verificadoPor: null,
      creadoEn: ahora,
    });
  }

  private async auditar(accion: AccionAuditada, entidadId: string, metadatos: Record<string, unknown>, actor?: Actor): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor?.id ?? null, actorCorreo: actor?.correo ?? 'sistema', actorRol: actor?.rol ?? 'sistema',
      accion, entidad: 'validacion_eps', entidadId, justificacion: null, metadatos,
      ip: actor?.ip ?? null, agenteUsuario: actor?.agenteUsuario ?? null, ocurridoEn: new Date(),
    });
  }
}
