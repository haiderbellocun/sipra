import {
  BadRequestException, ConflictException, ForbiddenException, GoneException, Inject, Injectable, Logger, NotFoundException,
  Optional, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  EstadoAdres, OrigenTipoDocumento, TIPOS_DOCUMENTO_ADRES, esTipoDocumentoAdres,
} from '../../../domain/entities/adres';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  EvidenciaEps, FuenteEvidenciaEps, TipoEvidenciaEps,
} from '../../../domain/entities/evidencia-validacion-eps.entity';
import {
  ConsultaAdresInvalidaError, EstadoProcesamientoEps, ValidacionEps, ValidacionEpsYaDecididaError,
} from '../../../domain/entities/validacion-eps.entity';
import { LECTOR_DOCUMENTO_LOCAL, LectorDocumentoLocalPort } from '../../../domain/ports/out/lector-documento-local.port';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, PRACTICA_REPOSITORY,
  PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  ALMACENAMIENTO, AlmacenamientoPort, SINU, SinuPort,
} from '../../../domain/ports/out/servicios-externos.port';
import {
  VALIDACION_EPS_REPOSITORY, ValidacionEpsRepositoryPort,
} from '../../../domain/ports/out/validacion-eps.port';
import { evaluarResultadoAdres } from '../../../domain/services/adres-resultado.domain-service';
import { LecturaLocalAdresService } from '../../../domain/services/lectura-local-adres.domain-service';
import { fechaIsoDe, normalizarDocumento } from '../../../domain/services/normalizacion-identidad';
import { SaneamientoPdfDomainService } from '../../../domain/services/saneamiento-pdf.domain-service';
import { puedeOperarValidacionEps } from '../../../domain/value-objects/acceso-eps.vo';
import {
  ConsultaAdresPreparadaDto, FilaBandejaAdresDto, ResultadoAdresDto,
} from '../../dtos/validacion-eps.dto';
import { Actor } from '../practicas/gestionar-practica.use-case';
import { INTERRUPTORES_EPS, exigirInterruptorEps } from '../../services/interruptores-eps';

/** Vida de una consulta preparada: un solo uso y corta, para que no se reutilice ni se adjunte a otro caso. */
export const VIGENCIA_CONSULTA_ADRES_MS = 30 * 60_000;
export const TAMANO_MAXIMO_ADRES_MB = 5;
/**
 * Página oficial de ADRES a la que la PERSONA va a consultar. ÚNICA fuente de verdad: no hay variable de entorno
 * que la sustituya (así ningún ambiente puede apuntar a otro sitio), y el enlace nunca lleva datos del estudiante.
 */
export const PORTAL_ADRES_OFICIAL = 'https://www.adres.gov.co/consulte-su-eps';

/** https, host de adres.gov.co (no un dominio que lo imite), sin credenciales y sin query ni fragmento (ahí podría viajar un documento). */
export function portalAdresValido(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash
      && (u.hostname === 'adres.gov.co' || u.hostname.endsWith('.adres.gov.co'));
  } catch { return false; }
}

/**
 * Consulta ADRES ASISTIDA.
 *
 * Una PERSONA consulta el portal oficial, resuelve ella misma el CAPTCHA y aporta
 * el resultado como PDF. SIPRA solo prepara la consulta (qué tipo y número de
 * documento consultar), recibe el archivo, lo lee localmente y lo contrasta.
 * No llama a ADRES, no resuelve ni evade CAPTCHA, no usa endpoints privados, no
 * guarda cookies ni sesiones. El resultado de ADRES contrasta la AFILIACIÓN; no
 * dice nada de la autenticidad del certificado de EPS.
 *
 * Todo se hace sobre un caso reservado por quien opera, con el actor tomado de
 * la sesión y registros por identificadores (sin cédula, nombre ni contenido).
 */
@Injectable()
export class ConsultaAdresUseCase {
  private readonly log = new Logger(ConsultaAdresUseCase.name);
  private readonly lectura: LecturaLocalAdresService;
  private readonly saneamiento = new SaneamientoPdfDomainService();

  constructor(
    @Inject(VALIDACION_EPS_REPOSITORY) private readonly validaciones: ValidacionEpsRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
    @Inject(LECTOR_DOCUMENTO_LOCAL) lector: LectorDocumentoLocalPort,
    @Optional() @Inject(SINU) private readonly sinu?: SinuPort,
    @Optional() private readonly config?: ConfigService,
  ) {
    this.lectura = new LecturaLocalAdresService(lector);
  }

  // ── Preparar la consulta ────────────────────────────────────────────────────

  /** Prepara la consulta: decide QUÉ consultar. No llama a ADRES ni abre nada desde el servidor. */
  async preparar(
    validacionId: string, actor: Actor, dto: { tipoDocumento?: string } = {}, ahora: Date = new Date(),
  ): Promise<ConsultaAdresPreparadaDto> {
    const v = await this.cargarParaOperar(validacionId, actor, ahora);
    const estudiante = await this.usuarios.buscarPorId(v.estudianteId);
    const numero = normalizarDocumento(estudiante?.instantanea().documento ?? null).numero;
    if (!numero) throw new ConflictException('El estudiante no tiene un número de documento registrado en SIPRA');

    // Fuente del tipo de documento: SINU > (dato institucional / solicitud ARL: aún no existen) > confirmación humana.
    // El tipo NUNCA se infiere del número ni se toma del certificado.
    const previo = v.adresInstantanea();
    let tipo: string | null = null;
    let origen: OrigenTipoDocumento | null = null;
    let confirmadoPor: string | null = null;
    const deSinu = await this.tipoDesdeSinu(estudiante?.instantanea().documento ?? '');
    if (deSinu) { tipo = deSinu; origen = 'sinu'; }
    else if (previo.tipoDocumento && previo.tipoDocumentoOrigen) {
      tipo = previo.tipoDocumento; origen = previo.tipoDocumentoOrigen; confirmadoPor = previo.tipoDocumentoConfirmadoPor;
    } else if (dto.tipoDocumento !== undefined) {
      if (!esTipoDocumentoAdres(dto.tipoDocumento)) throw new BadRequestException('Tipo de documento no reconocido');
      tipo = dto.tipoDocumento; origen = 'confirmacion_humana'; confirmadoPor = actor.id;
    }
    if (!tipo || !origen) {
      const sugerido = v.instantanea().datosExtraidos?.tipoDocumento ?? null;
      return {
        estado: 'requiere_tipo_documento',
        opciones: [...TIPOS_DOCUMENTO_ADRES],
        sugerencia: esTipoDocumentoAdres(sugerido) ? sugerido : null,
      };
    }

    const consultaId = randomUUID();
    const venceEn = new Date(ahora.getTime() + VIGENCIA_CONSULTA_ADRES_MS);
    const versionLeida = v.version;
    try {
      v.prepararConsultaAdres({ consultaId, actorId: actor.id, ahora, venceEn, tipoDocumento: tipo, origenTipoDocumento: origen, confirmadoPor });
    } catch (error) { this.traducir(error); }
    if (!(await this.validaciones.guardarSiVersion(v.instantanea(), versionLeida))) {
      throw new ConflictException('El caso cambió mientras se preparaba la consulta: inténtelo de nuevo');
    }
    await this.auditar(AccionAuditada.CONSULTA_ADRES_PREPARADA, v.id, { consultaId, origenTipoDocumento: origen }, actor);
    return {
      estado: 'preparada', consultaId, tipoDocumento: tipo, numeroDocumento: numero, portalUrl: PORTAL_ADRES_OFICIAL, venceEn: venceEn.toISOString(),
      instrucciones: [
        'Abra el portal oficial de ADRES en una pestaña nueva.',
        'Seleccione el tipo de documento e ingrese el número que se muestra aquí.',
        'Resuelva usted mismo la verificación (CAPTCHA) y consulte.',
        'Guarde o imprima el resultado como PDF y cárguelo en este caso.',
      ],
    };
  }

  // ── Cargar el resultado ─────────────────────────────────────────────────────

  async cargarEvidencia(
    validacionId: string, actor: Actor,
    entrada: { consultaId: string; contenido: Buffer; fechaConsulta?: string | null },
    ahora: Date = new Date(),
  ): Promise<ResultadoAdresDto> {
    let v = await this.cargarParaOperar(validacionId, actor, ahora);
    const contenido = entrada.contenido;
    const maximo = (this.config?.get<number>('ADRES_TAMANO_MAXIMO_MB') ?? TAMANO_MAXIMO_ADRES_MB) * 1_048_576;
    if (contenido.length === 0) throw new BadRequestException('El archivo está vacío');
    if (contenido.length > maximo) throw new BadRequestException(`El archivo supera el máximo de ${maximo / 1_048_576} MB`);
    // El tipo real se decide por el contenido, no por lo que declare quien lo sube.
    if (contenido.subarray(0, 5).toString('latin1') !== '%PDF-') throw new UnsupportedMediaTypeException('El resultado debe ser un PDF');

    const hash = createHash('sha256').update(contenido).digest('hex');
    // Retry o doble clic con el mismo archivo: no se registra nada nuevo.
    if (v.adresInstantanea().evidenciaHash === hash) return this.aResultado(v, true);
    const otro = await this.validaciones.buscarEvidenciaAdresPorHash(hash);
    if (otro && otro.validacionEpsId !== v.id) throw new ConflictException('Este archivo ya se cargó en otro caso');

    if (!v.consultaAdresVigente(entrada.consultaId, actor.id, ahora)) {
      throw new GoneException('La consulta no existe, ya se usó, venció o la preparó otra persona: prepárela de nuevo');
    }
    const consultaDeclarada = this.fechaDeclarada(entrada.fechaConsulta ?? null, ahora);

    // Se guarda la copia SANEADA (sin acciones activas) en almacenamiento privado; el hash es el del original.
    const saneado = this.saneamiento.sanear(contenido).contenido;
    const ruta = await this.almacen.guardar(`evidencias/adres/${v.id}/${hash.slice(0, 16)}-${randomBytes(8).toString('hex')}.pdf`, saneado, 'application/pdf');

    const versionLeida = v.version;
    try {
      v.recibirEvidenciaAdres({ hash, referenciaArchivo: ruta, actorId: actor.id, ahora, consultadoEn: consultaDeclarada });
    } catch (error) { this.traducir(error); }
    if (!(await this.validaciones.guardarSiVersion(v.instantanea(), versionLeida))) {
      // Otro proceso ganó: el archivo guardado queda huérfano (privado) y se pide reintentar.
      await this.almacen.eliminar(ruta).catch(() => undefined);
      throw new ConflictException('El caso cambió mientras se cargaba el resultado: inténtelo de nuevo');
    }
    await this.validaciones.agregarEvidencia(this.evidencia(v.id, hash, 'cargada', ahora, actor.id, {
      referencia: ruta, bytes: contenido.length, fechaConsultaDeclarada: consultaDeclarada?.toISOString() ?? null,
    }).instantanea());
    await this.auditar(AccionAuditada.EVIDENCIA_ADRES_CARGADA, v.id, { bytes: contenido.length }, actor);

    v = (await this.validaciones.buscarPorId(v.id)) ?? v;
    return this.procesarInterno(v.id, actor, ahora);
  }

  // ── Procesar ────────────────────────────────────────────────────────────────

  /** Reintento del procesamiento de un resultado ya cargado (idempotente). */
  async procesar(validacionId: string, actor: Actor, ahora: Date = new Date()): Promise<ResultadoAdresDto> {
    await this.cargarParaOperar(validacionId, actor, ahora);
    return this.procesarInterno(validacionId, actor, ahora);
  }

  private async procesarInterno(validacionId: string, actor: Actor, ahora: Date): Promise<ResultadoAdresDto> {
    const v = await this.validaciones.buscarPorId(validacionId);
    if (!v) throw new NotFoundException('Validación no encontrada');
    const a = v.adresInstantanea();
    // Ya procesado (o sin nada que procesar): no se repite ni se duplica evidencia.
    if ([EstadoAdres.PROCESADO, EstadoAdres.NO_DETERMINABLE].includes(a.estado)) return this.aResultado(v, true);
    if (![EstadoAdres.EVIDENCIA_RECIBIDA, EstadoAdres.ERROR].includes(a.estado) || !a.referenciaArchivo || !a.evidenciaHash) {
      throw new ConflictException('No hay un resultado ADRES cargado por procesar');
    }

    let pdf: Buffer;
    try { pdf = await this.almacen.leer(a.referenciaArchivo); } catch {
      return this.fallar(v.id, 'archivo_no_disponible', ahora, actor, a.evidenciaHash);
    }
    const leido = await this.lectura.leer(pdf);
    if (leido.error || !leido.lectura) return this.fallar(v.id, leido.error ?? 'lectura_fallida', ahora, actor, a.evidenciaHash);

    const estudiante = await this.usuarios.buscarPorId(v.estudianteId);
    const inst = v.instantanea();
    const evaluacion = evaluarResultadoAdres({
      datos: leido.lectura.datos,
      sipra: {
        tipoDocumento: a.tipoDocumento,
        numeroDocumento: normalizarDocumento(estudiante?.instantanea().documento ?? null).numero,
        nombre: estudiante?.nombre ?? null,
      },
      certificado: inst.datosExtraidos,
      autenticidad: inst.autenticidad,
      coincidenciaCertificado: inst.coincidencia,
      vigencia: inst.vigenciaCertificado,
      hayBanderaCritica: inst.hayBanderaCritica,
    });
    const consultadoEn = leido.lectura.datos.fechaConsulta ? new Date(`${leido.lectura.datos.fechaConsulta}T12:00:00Z`) : null;
    const fuenteActualizadaEn = leido.lectura.datos.fuenteActualizadaEn ? new Date(`${leido.lectura.datos.fuenteActualizadaEn}T12:00:00Z`) : null;

    for (let intento = 0; intento < 3; intento += 1) {
      const actual = await this.validaciones.buscarPorId(v.id);
      if (!actual) throw new NotFoundException('Validación no encontrada');
      if ([EstadoAdres.PROCESADO, EstadoAdres.NO_DETERMINABLE].includes(actual.adresEstado)) return this.aResultado(actual, true);
      const versionLeida = actual.version;
      try {
        actual.registrarResultadoAdres({
          estado: evaluacion.estado, error: evaluacion.error, datos: leido.lectura.datos, comparacion: evaluacion.comparacion,
          afiliacion: evaluacion.afiliacion, recomendacion: evaluacion.recomendacion, consultadoEn, fuenteActualizadaEn,
        }, ahora);
      } catch (error) { this.traducir(error); }
      if (!(await this.validaciones.guardarSiVersion(actual.instantanea(), versionLeida))) continue;

      const d = leido.lectura.datos;
      await this.validaciones.agregarEvidencia(this.evidencia(v.id, a.evidenciaHash, evaluacion.estado, ahora, actor.id, {
        // Solo lo no identificante: el nombre y el documento quedan en la validación, no en la evidencia.
        camposLeidos: leido.lectura.camposLeidos, ocr: leido.ocrEjecutado, eps: d.eps, regimen: d.regimen,
        estadoAfiliacion: d.estadoAfiliacion, fechaAfiliacion: d.fechaAfiliacion, fechaConsulta: d.fechaConsulta,
        fuenteActualizadaEn: d.fuenteActualizadaEn, afiliacionResultante: evaluacion.afiliacion,
      }, evaluacion.error).instantanea());
      await this.auditar(AccionAuditada.EVIDENCIA_ADRES_PROCESADA, v.id, { estadoAdres: evaluacion.estado, ocr: leido.ocrEjecutado, error: evaluacion.error }, actor);
      await this.auditar(AccionAuditada.COMPARACION_ADRES_REALIZADA, v.id, {
        recomendacion: evaluacion.recomendacion, criticos: evaluacion.comparacion.filter((c) => c.critico).length,
        afiliacion: evaluacion.afiliacion,
      }, actor);
      return this.aResultado((await this.validaciones.buscarPorId(v.id)) ?? actual, false);
    }
    return this.fallar(v.id, 'lectura_fallida', ahora, actor, a.evidenciaHash);
  }

  private async fallar(validacionId: string, codigo: string, ahora: Date, actor: Actor, hash: string): Promise<ResultadoAdresDto> {
    for (let intento = 0; intento < 3; intento += 1) {
      const v = await this.validaciones.buscarPorId(validacionId);
      if (!v) throw new NotFoundException('Validación no encontrada');
      // El mismo fallo ya registrado para este archivo: un reintento no duplica evidencia ni auditoría.
      if (v.adresEstado === EstadoAdres.ERROR && v.adresInstantanea().error === codigo.slice(0, 40)) return this.aResultado(v, true);
      const versionLeida = v.version;
      try { v.marcarErrorAdres(codigo, ahora); } catch (error) { this.traducir(error); }
      if (await this.validaciones.guardarSiVersion(v.instantanea(), versionLeida)) {
        await this.validaciones.agregarEvidencia(this.evidencia(validacionId, hash, 'error', ahora, actor.id, { codigo }, codigo).instantanea());
        await this.auditar(AccionAuditada.EVIDENCIA_ADRES_PROCESADA, validacionId, { estadoAdres: EstadoAdres.ERROR, error: codigo }, actor);
        return this.aResultado((await this.validaciones.buscarPorId(validacionId)) ?? v, false);
      }
    }
    throw new ConflictException('El caso cambió mientras se procesaba el resultado: inténtelo de nuevo');
  }

  // ── Bandeja mínima ──────────────────────────────────────────────────────────

  async bandeja(actor: Actor, ahora: Date = new Date()): Promise<FilaBandejaAdresDto[]> {
    if (!puedeOperarValidacionEps(actor.rol)) throw new ForbiddenException('Su perfil no opera la validación de EPS');
    exigirInterruptorEps(this.config, INTERRUPTORES_EPS.adres, 'La consulta asistida de ADRES está suspendida temporalmente.');
    const casos = await this.validaciones.listarParaAdres(50);
    const filas: FilaBandejaAdresDto[] = [];
    for (const v of casos) {
      const practica = await this.practicas.buscarPorId(v.practicaId);
      if (!practica?.visiblePara({ id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId })) continue;
      const documento = await this.documentos.buscarPorId(v.documentoId);
      if (documento?.tipo !== TipoDocumento.CERTIFICADO_EPS) continue;
      const estudiante = await this.usuarios.buscarPorId(v.estudianteId);
      const d = v.instantanea();
      const numero = estudiante?.instantanea().documento ?? '';
      filas.push({
        validacionId: v.id, documentoId: v.documentoId,
        estudiante: { nombre: estudiante?.nombre ?? '(sin nombre)', documentoEnmascarado: numero.length > 4 ? `••••${numero.slice(-4)}` : '••••' },
        metodoValidacion: d.verificadorCodigo !== null && d.verificadoEn !== null ? 'qr_oficial' : 'sin_verificar',
        afiliacion: d.afiliacion, estadoAdres: d.adres.estado, recomendacion: d.adres.recomendacion,
        responsable: v.reservaVigente(ahora) ? d.asignadoA : null,
        reservaHasta: v.reservaVigente(ahora) ? d.reservaHasta?.toISOString() ?? null : null,
        actualizadaEn: d.actualizadaEn.toISOString(),
      });
    }
    return filas;
  }

  // ── Internos ────────────────────────────────────────────────────────────────

  /**
   * Quien opera: rol permitido, caso visible, sin decisión humana y — esto es la
   * reserva — con el caso TOMADO por él. Otro funcionario no procesa a la vez el
   * mismo caso; si la reserva venció, puede tomarlo.
   */
  private async cargarParaOperar(validacionId: string, actor: Actor, ahora: Date): Promise<ValidacionEps> {
    if (!puedeOperarValidacionEps(actor.rol)) throw new ForbiddenException('Su perfil no opera la validación de EPS');
    exigirInterruptorEps(this.config, INTERRUPTORES_EPS.adres, 'La consulta asistida de ADRES está suspendida temporalmente.');
    const v = await this.validaciones.buscarPorId(validacionId);
    if (!v) throw new NotFoundException('Validación no encontrada');
    const practica = await this.practicas.buscarPorId(v.practicaId);
    if (!practica?.visiblePara({ id: actor.id, rol: actor.rol, escuelas: actor.escuelas, empresaId: actor.empresaId })) {
      throw new NotFoundException('Validación no encontrada');
    }
    if (v.estaDecidida) throw new ConflictException('El caso ya fue decidido');
    if (v.estadoProcesamiento !== EstadoProcesamientoEps.PROCESADO) throw new ConflictException('El certificado aún no se ha procesado');
    if (!v.reservaVigente(ahora)) throw new ConflictException('Tome el caso antes de consultar ADRES');
    if (v.asignadoA !== actor.id) throw new ConflictException('El caso está reservado por otro funcionario');
    return v;
  }

  private async tipoDesdeSinu(documento: string): Promise<string | null> {
    if (!this.sinu || !documento) return null;
    try {
      const m = await this.sinu.buscarPorDocumento(documento);
      return esTipoDocumentoAdres(m?.tipoDocumento) ? m?.tipoDocumento ?? null : null;
    } catch {
      return null; // SINU no disponible: se cae a la confirmación humana, nunca a una suposición
    }
  }

  private fechaDeclarada(valor: string | null, ahora: Date): Date | null {
    if (!valor) return null;
    const iso = fechaIsoDe(valor);
    if (!iso) throw new BadRequestException('La fecha de consulta no es válida');
    const fecha = new Date(`${iso}T12:00:00Z`);
    if (fecha.getTime() > ahora.getTime() + 24 * 3_600_000) throw new BadRequestException('La fecha de consulta no puede ser futura');
    return fecha;
  }

  private traducir(error: unknown): never {
    if (error instanceof ConsultaAdresInvalidaError) throw new ConflictException(error.message);
    if (error instanceof ValidacionEpsYaDecididaError) throw new ConflictException('El caso ya fue decidido');
    throw error;
  }

  private aResultado(v: ValidacionEps, duplicada: boolean): ResultadoAdresDto {
    const a = v.adresInstantanea();
    return {
      validacionId: v.id, estadoAdres: a.estado, afiliacion: v.afiliacion, recomendacion: a.recomendacion, error: a.error, duplicada,
      comparacion: a.comparacion,
    };
  }

  private evidencia(
    validacionId: string, hash: string, resultado: string, ahora: Date, actorId: string, datos: Record<string, unknown>, error: string | null = null,
  ): EvidenciaEps {
    return EvidenciaEps.crear({
      id: randomUUID(), validacionEpsId: validacionId, tipo: TipoEvidenciaEps.ADRES, fuente: FuenteEvidenciaEps.ADRES,
      metodo: 'pdf_importado_adres_bdua', resultado, fechaVerificacion: ahora, hashEvidencia: hash,
      // El portal se abre en el navegador de la persona: SIPRA no registra ninguna URL con parámetros.
      origen: null, datosObtenidos: datos, errorCodigo: error, verificadoPor: actorId, creadoEn: ahora,
    });
  }

  private async auditar(accion: AccionAuditada, entidadId: string, metadatos: Record<string, unknown>, actor: Actor): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion, entidad: 'validacion_eps', entidadId,
      justificacion: null, metadatos, ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: new Date(),
    });
  }
}
