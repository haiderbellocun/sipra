import {
  BadRequestException, ForbiddenException, GoneException, Inject, Injectable, InternalServerErrorException, NotFoundException, Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import { CartaPresentacion, DatosCarta } from '../../../domain/entities/carta-presentacion.entity';
import { MATRIZ_MODALIDADES, ModalidadPractica, definicionModalidad } from '../../../domain/entities/modalidad.entity';
import { PeriodoAcademico, TipoVentana } from '../../../domain/entities/periodo.entity';
import { Practica } from '../../../domain/entities/practica.entity';
import { Usuario } from '../../../domain/entities/usuario.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, CARTA_REPOSITORY, CartaRepositoryPort, EMPRESA_REPOSITORY, EmpresaRepositoryPort,
  FiltroCartas, PERIODO_REPOSITORY, PeriodoRepositoryPort, PRACTICA_REPOSITORY,
  PracticaRepositoryPort, USUARIO_REPOSITORY, UsuarioRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  ALMACENAMIENTO, AlmacenamientoPort, GENERADOR_CARTA_PDF, GENERADOR_PDF, GeneradorCartaPdfPort, GeneradorPdfPort,
  MatriculaSinu, SINU, SinuPort,
} from '../../../domain/ports/out/servicios-externos.port';
import {
  DESTINATARIO_GENERICO, DocumentoCarta, PATRON_REFERENCIA, ResponsableArlCarta, SnapshotCarta, construirReferencia,
  enmascararDocumento, fechaColombia, nivelLegible, nombreArchivoCarta, redactarCarta,
} from '../../../domain/services/carta-presentacion.plantilla';
import { JUSTIFICACION_MINIMA } from '../../../domain/services/justificacion-decision';
import { Rol, escuelasDeCoordinacion } from '../../../domain/value-objects/rol.vo';
import { MetricasService } from '../../../infrastructure/observability/metricas.service';
import { Actor } from './gestionar-practica.use-case';
import { emitirTokenCarta, normalizarDocumento, verificarTokenCarta } from '../../services/token-carta-publica';

/** Quién EMITE cartas (estudiante, la suya; docente, auxiliar, coordinación y analista, en su alcance). */
export const ROLES_EMITEN_CARTA: readonly Rol[] = [Rol.ESTUDIANTE, Rol.TUTOR, Rol.AUXILIAR, Rol.COORDINADOR, Rol.ANALISTA];
/**
 * Quién CONSULTA cartas: los anteriores más administración (lectura, sin emitir). Dirección NO: la matriz G1 la deja
 * fuera de las cartas (gobierno, no operación).
 */
export const ROLES_CONSULTAN_CARTA: readonly Rol[] = [...ROLES_EMITEN_CARTA, Rol.ADMINISTRADOR];
/** Quién ANULA una carta emitida (con motivo): coordinación y analista. */
export const ROLES_ANULAN_CARTA: readonly Rol[] = [Rol.COORDINADOR, Rol.ANALISTA];

export const MENSAJE_VENTANA_CERRADA = 'Generación de carta no disponible para este período.';
/** Mismo mensaje para «no existe», «no es estudiante», «sin carta», «solo anuladas/reemplazadas»: no revela nada. */
export const MENSAJE_SIN_CARTA_PUBLICA = 'No encontramos una carta de presentación vigente asociada a este número de identificación.';
export const MENSAJE_DOCUMENTO_INVALIDO = 'Escribe un número de identificación válido (solo números o letras).';
export const MENSAJE_NO_VIGENTE = 'La carta consultada ya no se encuentra vigente.';
export const MENSAJE_TOKEN_INVALIDO = 'El enlace de descarga no es válido o venció. Consulta de nuevo la carta.';

/** Lo que la consulta pública muestra de cada carta VIGENTE: lo mínimo para identificarla (nada interno). */
export interface CartaPublica {
  referencia: string; estado: 'vigente'; estudiante: string; programa: string; nivel: string; modalidad: string;
  fechaExpedicion: string; destinatario: string;
  /** Token firmado y temporal (10 min) para descargar ESTA carta. */
  tokenDescarga: string;
}
export const MENSAJE_FALTA_ARL = 'Falta definir quién asume la afiliación a ARL.';

export interface SolicitudCarta {
  periodoAcademico: string;
  /** Carta ligada a una práctica registrada: su modalidad, su organización y su responsable de ARL. */
  practicaId?: string;
  /** `empresa` exige una organización vinculada a la práctica; sin práctica, siempre genérica. */
  destinatario?: 'generica' | 'empresa';
  /** Solo carta genérica SIN práctica: modalidad ofertada en el periodo. */
  modalidad?: string;
  /** Solo perfiles internos: documento del estudiante. */
  estudianteDocumento?: string;
}

export interface PracticaParaCarta { id: string; modalidad: string; modalidadEtiqueta: string; empresa: string | null; responsableArl: ResponsableArlCarta }

export interface VistaPreviaCarta {
  periodoAcademico: string;
  ventanaAbierta: boolean;
  estudiante: { nombre: string; tipoDocumento: string | null; documento: string; programa: string; nivel: string } | null;
  practicas: PracticaParaCarta[];
  modalidadesOfertadas: { modalidad: string; etiqueta: string }[];
  datos: { destinatario: string; tipoDestinatario: 'generica' | 'empresa'; modalidadEtiqueta: string; responsableArl: ResponsableArlCarta; practicaId: string | null } | null;
  documento: DocumentoCarta | null;
  bloqueos: string[];
  advertencias: string[];
  puedeGenerar: boolean;
}

export interface CartaRespuesta {
  id: string;
  numeroFur: number | null;
  practicaId: string | null;
  estudianteId: string;
  estudianteNombre: string;
  estudianteDocumento: string | null;
  periodoAcademico: string;
  modalidadCarta: 'abierta' | 'con_empresa';
  empresaRazonSocial: string | null;
  generadaEn: string;
  generadaPor: string;
  referencia: string | null;
  estado: 'vigente' | 'reemplazada' | 'anulada';
  modalidad: string | null;
  modalidadEtiqueta: string | null;
  destinatario: string;
  urlVerificacion: string | null;
  digital: boolean;
}

export type VerificacionCarta =
  | { encontrada: false }
  | {
    encontrada: true; referencia: string; estado: 'vigente' | 'reemplazada' | 'anulada'; estudiante: string; documento: string;
    programa: string; nivel: string; modalidad: string; fechaExpedicion: string;
  };

interface Resolucion {
  vista: VistaPreviaCarta;
  estudiante: Usuario | null;
  matricula: MatriculaSinu | null;
  periodo: PeriodoAcademico;
  practica: Practica | null;
  snapshotBase: Omit<SnapshotCarta, 'referencia'> | null;
}

/**
 * Carta de presentación digital (SGP, Paso 1 del estudiante; también la expiden docente, auxiliar y coordinación).
 *
 * - Datos del estudiante desde SIPRA/SINU (nombre, identificación, programa, nivel); nada se digita.
 * - Destinatario: «A QUIEN CORRESPONDA» (sin práctica, o si se pide genérica) o la organización VINCULADA a la práctica.
 * - Modalidad y responsable de ARL: los de la práctica; sin práctica, la modalidad elegida entre las ofertadas en el
 *   periodo y la ARL «por definir al registrar» (sin inferir el responsable). Con práctica y sin responsable: bloqueo.
 * - Ventana: el estudiante solo dentro de la ventana CARTA_PRESENTACION del periodo; los perfiles internos no dependen de
 *   ella (regla existente). Las cartas emitidas se siguen descargando siempre.
 * - Emisión: referencia única no adivinable, snapshot, PDF guardado con su SHA-256 (se entrega SIEMPRE ese archivo),
 *   reemplazo de la carta vigente equivalente y auditoría. Nada se borra ni se edita.
 */
@Injectable()
export class CartaPresentacionUseCase {
  constructor(
    @Inject(CARTA_REPOSITORY) private readonly cartas: CartaRepositoryPort,
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(PERIODO_REPOSITORY) private readonly periodos: PeriodoRepositoryPort,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    @Inject(SINU) private readonly sinu: SinuPort,
    @Inject(GENERADOR_PDF) private readonly generadorPdf: GeneradorPdfPort,
    @Optional() @Inject(GENERADOR_CARTA_PDF) private readonly generadorCarta?: GeneradorCartaPdfPort,
    @Optional() @Inject(ALMACENAMIENTO) private readonly almacenamiento?: AlmacenamientoPort,
    @Optional() private readonly config?: ConfigService,
    @Optional() @Inject(EMPRESA_REPOSITORY) private readonly empresas?: EmpresaRepositoryPort,
    @Optional() private readonly metricas?: MetricasService,
  ) {}

  /** Organización VINCULADA a la práctica: la relación con la empresa habilitada o, en registros sin ella, el nombre del FUR. */
  private async organizacionDe(p: Practica): Promise<string | null> {
    const d = p.instantanea();
    const empresa = d.empresaId && this.empresas ? await this.empresas.buscarPorId(d.empresaId) : null;
    return (empresa?.razonSocial ?? d.empresaRazonSocial ?? '').trim() || null;
  }

  async previsualizar(solicitud: SolicitudCarta, actor: Actor, ahora: Date = new Date()): Promise<VistaPreviaCarta> {
    return (await this.resolver(solicitud, actor, ahora)).vista;
  }

  async generar(solicitud: SolicitudCarta, actor: Actor, ahora: Date = new Date()): Promise<CartaRespuesta> {
    const r = await this.resolver(solicitud, actor, ahora);
    if (!r.vista.puedeGenerar || !r.snapshotBase || !r.estudiante) {
      throw new BadRequestException(r.vista.bloqueos[0] ?? 'No es posible generar la carta con estos datos.');
    }
    if (!this.generadorCarta || !this.almacenamiento) throw new InternalServerErrorException('Generación de cartas no disponible');

    const referencia = await this.referenciaNueva();
    const snapshot: SnapshotCarta = { ...r.snapshotBase, referencia };
    const documento = redactarCarta(snapshot);
    const url = this.urlVerificacion(referencia);
    const pdf = await this.generadorCarta.generar(documento, url);
    const pdfSha256 = createHash('sha256').update(pdf).digest('hex');
    const id = randomUUID();
    const ruta = await this.almacenamiento.guardar(`cartas-presentacion/${r.estudiante.id}/${id}.pdf`, pdf, 'application/pdf');
    const contenido = documento as unknown as Record<string, unknown>;
    const datos: DatosCarta = {
      id, numeroFur: r.practica?.instantanea().numeroFur ?? null, practicaId: snapshot.practicaId,
      estudianteId: r.estudiante.id, periodoAcademico: r.periodo.codigo,
      modalidadCarta: snapshot.destinatario.tipo === 'empresa' ? 'con_empresa' : 'abierta',
      empresaRazonSocial: snapshot.destinatario.tipo === 'empresa' ? snapshot.destinatario.nombre : null,
      contenido, hashSha256: createHash('sha256').update(JSON.stringify(contenido)).digest('hex'),
      generadaPor: actor.id, generadaEn: ahora,
      referencia, estado: 'vigente', reemplazadaPor: null, rutaArchivo: ruta, pdfSha256, snapshot,
      modalidad: snapshot.modalidad, anuladaEn: null, motivoAnulacion: null,
    };
    let emitida: { carta: CartaPresentacion; reemplazadas: string[] };
    try {
      emitida = await this.cartas.emitir(datos);
    } catch (error) {
      await this.almacenamiento.eliminar(ruta).catch(() => undefined); // sin registro, el archivo no queda huérfano
      throw error;
    }

    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol,
      accion: AccionAuditada.CARTA_PRESENTACION_GENERADA, entidad: 'carta_presentacion', entidadId: id, justificacion: null,
      metadatos: {
        referencia, estudianteId: r.estudiante.id, practicaId: snapshot.practicaId, periodo: r.periodo.codigo,
        modalidad: snapshot.modalidad, destinatario: snapshot.destinatario, responsableArl: snapshot.responsableArl,
        fechaExpedicion: snapshot.fechaExpedicion, pdfSha256, reemplazadas: emitida.reemplazadas,
      },
      ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    });
    return this.aRespuesta(emitida.carta, r.estudiante.nombre, r.estudiante.instantanea().documento);
  }

  /** El PDF EMITIDO, idéntico (se verifica su SHA-256). Las cartas históricas se reimprimen desde su contenido. */
  async pdf(id: string, actor: Actor, ahora: Date = new Date()): Promise<{ nombreArchivo: string; contenido: Buffer }> {
    const carta = await this.exigirVisible(id, actor);
    const d = carta.instantanea();
    if (carta.esDigital && d.snapshot && d.rutaArchivo) {
      if (!this.almacenamiento) throw new InternalServerErrorException('Almacenamiento no disponible');
      const contenido = await this.almacenamiento.leer(d.rutaArchivo);
      if (createHash('sha256').update(contenido).digest('hex') !== d.pdfSha256) {
        throw new InternalServerErrorException('El archivo de la carta no coincide con el emitido: se bloquea la descarga.');
      }
      await this.auditoria.registrar({
        actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion: AccionAuditada.CARTA_DESCARGADA,
        entidad: 'carta_presentacion', entidadId: d.id, justificacion: null, metadatos: { referencia: d.referencia },
        ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
      });
      return { nombreArchivo: nombreArchivoCarta(d.snapshot.documento, d.snapshot.fechaExpedicion), contenido };
    }
    const contenido = await this.generadorPdf.generar(carta.contenido);
    return { nombreArchivo: `carta-presentacion-${carta.id.slice(0, 8)}.pdf`, contenido };
  }

  async listar(filtro: FiltroCartas, actor: Actor): Promise<CartaRespuesta[]> {
    if (!ROLES_CONSULTAN_CARTA.includes(actor.rol)) return [];
    const seguro: FiltroCartas = actor.rol === Rol.ESTUDIANTE ? { ...filtro, estudianteId: actor.id } : filtro;
    const cartas = (await this.cartas.listar(seguro)).filter((c) => this.cartaEnAlcance(c, actor));
    return Promise.all(cartas.map(async (c) => {
      const u = await this.usuarios.buscarPorId(c.estudianteId);
      return this.aRespuesta(c, u?.nombre ?? '—', u?.instantanea().documento ?? null);
    }));
  }

  async anular(id: string, motivo: string, actor: Actor, ahora: Date = new Date()): Promise<CartaRespuesta> {
    if (!ROLES_ANULAN_CARTA.includes(actor.rol)) throw new ForbiddenException('Las cartas las anulan coordinación y analista.');
    const texto = (motivo ?? '').trim();
    if (texto.length < JUSTIFICACION_MINIMA) throw new BadRequestException(`Escribe el motivo de la anulación (mínimo ${JUSTIFICACION_MINIMA} caracteres).`);
    const carta = await this.exigirVisible(id, actor);
    if (!carta.esDigital) throw new BadRequestException('Solo se anulan cartas digitales (con referencia).');
    if (!(await this.cartas.anular(id, texto, ahora))) throw new BadRequestException('La carta ya no está vigente.');
    await this.auditoria.registrar({
      actorId: actor.id, actorCorreo: actor.correo, actorRol: actor.rol, accion: AccionAuditada.CARTA_ANULADA,
      entidad: 'carta_presentacion', entidadId: id, justificacion: texto, metadatos: { referencia: carta.instantanea().referencia },
      ip: actor.ip ?? null, agenteUsuario: actor.agenteUsuario ?? null, ocurridoEn: ahora,
    });
    const actual = (await this.cartas.buscarPorId(id))!;
    const u = await this.usuarios.buscarPorId(actual.estudianteId);
    return this.aRespuesta(actual, u?.nombre ?? '—', u?.instantanea().documento ?? null);
  }

  /**
   * Consulta PÚBLICA por número de identificación (sin sesión): cartas VIGENTES del estudiante, con lo mínimo y un token
   * temporal de descarga por carta. Coincidencia exacta del documento; sin resultado, siempre el mismo mensaje.
   */
  async consultarPublica(documentoBruto: unknown, origen: { ip: string | null }, ahora: Date = new Date()): Promise<{ cartas: CartaPublica[]; mensaje: string | null }> {
    const documento = normalizarDocumento(documentoBruto);
    if (!documento) {
      this.metricas?.cartasPublicas.inc({ operacion: 'consulta', resultado: 'invalida' });
      throw new BadRequestException(MENSAJE_DOCUMENTO_INVALIDO);
    }
    const usuario = await this.usuarios.buscarPorDocumento(documento);
    const vigentes = usuario && usuario.rol === Rol.ESTUDIANTE
      ? (await this.cartas.listar({ estudianteId: usuario.id })).filter((c) => c.estado === 'vigente' && c.esDigital)
        .sort((a, b) => b.instantanea().generadaEn.getTime() - a.instantanea().generadaEn.getTime())
      : [];
    if (vigentes.length === 0) {
      this.metricas?.cartasPublicas.inc({ operacion: 'consulta', resultado: 'sin_resultado' });
      return { cartas: [], mensaje: MENSAJE_SIN_CARTA_PUBLICA };
    }
    const secreto = this.secretoTokens();
    const cartas = vigentes.map((c) => {
      const d = c.instantanea();
      const s = d.snapshot!;
      return {
        referencia: d.referencia!, estado: 'vigente' as const, estudiante: s.estudianteNombre, programa: s.programa, nivel: s.nivel,
        modalidad: s.modalidadEtiqueta, fechaExpedicion: s.fechaTexto, destinatario: s.destinatario.nombre,
        tokenDescarga: emitirTokenCarta(secreto, d.id, ahora.getTime()),
      };
    });
    // Auditoría mínima: qué cartas se mostraron, del estudiante (id interno); NUNCA la identificación consultada.
    await this.auditoria.registrar({
      actorId: null, actorCorreo: null, actorRol: 'publico', accion: AccionAuditada.CARTA_CONSULTADA_PUBLICAMENTE,
      entidad: 'carta_presentacion', entidadId: vigentes[0].id, justificacion: null,
      metadatos: { referencias: cartas.map((c) => c.referencia), estudianteId: vigentes[0].estudianteId },
      ip: origen.ip, agenteUsuario: null, ocurridoEn: ahora,
    });
    this.metricas?.cartasPublicas.inc({ operacion: 'consulta', resultado: 'encontrada' });
    return { cartas, mensaje: null };
  }

  /** Descarga PÚBLICA con el token de la consulta: solo si la carta SIGUE vigente, y el PDF emitido (SHA-256 verificado). */
  async descargarPublica(token: unknown, origen: { ip: string | null }, ahora: Date = new Date()): Promise<{ nombreArchivo: string; contenido: Buffer }> {
    const cartaId = verificarTokenCarta(this.secretoTokens(), token, ahora.getTime());
    const carta = cartaId ? await this.cartas.buscarPorId(cartaId) : null;
    const d = carta?.instantanea();
    if (!carta || !d?.snapshot || !d.rutaArchivo || !carta.esDigital) {
      this.metricas?.cartasPublicas.inc({ operacion: 'descarga', resultado: 'token_invalido' });
      throw new ForbiddenException(MENSAJE_TOKEN_INVALIDO);
    }
    if (carta.estado !== 'vigente') {
      this.metricas?.cartasPublicas.inc({ operacion: 'descarga', resultado: 'no_vigente' });
      throw new GoneException(MENSAJE_NO_VIGENTE);
    }
    if (!this.almacenamiento) throw new InternalServerErrorException('Almacenamiento no disponible');
    const contenido = await this.almacenamiento.leer(d.rutaArchivo);
    if (createHash('sha256').update(contenido).digest('hex') !== d.pdfSha256) {
      throw new InternalServerErrorException('El archivo de la carta no coincide con el emitido: se bloquea la descarga.');
    }
    await this.auditoria.registrar({
      actorId: null, actorCorreo: null, actorRol: 'publico', accion: AccionAuditada.CARTA_DESCARGADA_PUBLICAMENTE,
      entidad: 'carta_presentacion', entidadId: d.id, justificacion: null, metadatos: { referencia: d.referencia },
      ip: origen.ip, agenteUsuario: null, ocurridoEn: ahora,
    });
    this.metricas?.cartasPublicas.inc({ operacion: 'descarga', resultado: 'entregada' });
    return { nombreArchivo: nombreArchivoCarta(d.snapshot.documento, d.snapshot.fechaExpedicion), contenido };
  }

  private secretoTokens(): string {
    const secreto = this.config?.get<string>('JWT_SECRETO');
    if (!secreto) throw new InternalServerErrorException('Firma de enlaces no configurada');
    return secreto;
  }

  /** Verificación PÚBLICA: solo lo mínimo, desde el snapshot (nunca datos actuales ni internos). */
  async verificar(referenciaBruta: string): Promise<VerificacionCarta> {
    const referencia = (referenciaBruta ?? '').trim().toUpperCase();
    if (!PATRON_REFERENCIA.test(referencia)) return { encontrada: false };
    const carta = await this.cartas.buscarPorReferencia(referencia);
    const s = carta?.instantanea().snapshot;
    if (!carta || !s) return { encontrada: false };
    return {
      encontrada: true, referencia, estado: carta.estado, estudiante: s.estudianteNombre, documento: enmascararDocumento(s.documento),
      programa: s.programa, nivel: s.nivel, modalidad: s.modalidadEtiqueta, fechaExpedicion: s.fechaTexto,
    };
  }

  // ── internos ─────────────────────────────────────────────────────────────

  private async resolver(solicitud: SolicitudCarta, actor: Actor, ahora: Date): Promise<Resolucion> {
    if (!ROLES_EMITEN_CARTA.includes(actor.rol)) {
      throw new ForbiddenException('La carta de presentación la expiden el estudiante, el docente facilitador, el auxiliar, coordinación y analista.');
    }
    const estudiante = actor.rol === Rol.ESTUDIANTE
      ? await this.usuarios.buscarPorId(actor.id)
      : solicitud.estudianteDocumento?.trim()
        ? await this.usuarios.buscarPorDocumento(solicitud.estudianteDocumento.trim())
        : null;
    if (actor.rol !== Rol.ESTUDIANTE && !solicitud.estudianteDocumento?.trim()) throw new BadRequestException('Indica el documento del estudiante.');
    if (!estudiante || estudiante.rol !== Rol.ESTUDIANTE) throw new NotFoundException('No se encontró el estudiante');

    const periodo = await this.periodos.buscarPorCodigo(solicitud.periodoAcademico);
    if (!periodo) throw new BadRequestException(`El periodo ${solicitud.periodoAcademico} no existe`);

    const perfil = estudiante.instantanea();
    const matricula = perfil.documento ? await this.sinu.buscarPorDocumento(perfil.documento) : null;
    const practicasDelPeriodo = (await this.practicas.listar({ estudianteId: estudiante.id, periodoAcademico: periodo.codigo }))
      .filter((p) => !p.esTerminal);
    const escuelaId = practicasDelPeriodo[0]?.escuelaId ?? matricula?.escuelaId ?? null;
    if (actor.rol !== Rol.ESTUDIANTE && !this.enAlcance(actor, escuelaId, practicasDelPeriodo)) {
      throw new ForbiddenException('El estudiante no está en tu alcance.');
    }

    const bloqueos: string[] = [];
    const advertencias: string[] = [];
    const ventanaAbierta = periodo.ventanaAbierta(TipoVentana.CARTA_PRESENTACION, ahora);
    if (actor.rol === Rol.ESTUDIANTE && !ventanaAbierta) bloqueos.push(MENSAJE_VENTANA_CERRADA);
    if (!perfil.documento) bloqueos.push('El estudiante no tiene número de identificación registrado.');
    if (!matricula) bloqueos.push('No encontramos la matrícula del estudiante en SINU: sin programa y nivel no se expide la carta.');

    const organizaciones = new Map<string, string | null>();
    for (const p of practicasDelPeriodo) organizaciones.set(p.id, await this.organizacionDe(p));
    const practicas: PracticaParaCarta[] = practicasDelPeriodo.map((p) => {
      const d = p.instantanea();
      return { id: d.id, modalidad: d.modalidad, modalidadEtiqueta: definicionModalidad(d.modalidad).etiqueta, empresa: organizaciones.get(d.id) ?? null, responsableArl: d.responsableArlPractica ?? null };
    });
    const ofertadas = MATRIZ_MODALIDADES.filter((m) => periodo.modalidadHabilitada(m.modalidad)).map((m) => ({ modalidad: m.modalidad, etiqueta: m.etiqueta }));

    let practica: Practica | null = null;
    let modalidad: ModalidadPractica | null = null;
    let responsableArl: ResponsableArlCarta = null;
    let destinatario: { tipo: 'generica' | 'empresa'; nombre: string } = { tipo: 'generica', nombre: DESTINATARIO_GENERICO };
    if (solicitud.practicaId) {
      practica = practicasDelPeriodo.find((p) => p.id === solicitud.practicaId) ?? null;
      if (!practica) throw new NotFoundException('La práctica no pertenece al estudiante en este periodo.');
      const d = practica.instantanea();
      modalidad = d.modalidad;
      responsableArl = d.responsableArlPractica ?? null;
      if (responsableArl === null) bloqueos.push(MENSAJE_FALTA_ARL);
      const organizacion = organizaciones.get(d.id) ?? null;
      const quiereEmpresa = (solicitud.destinatario ?? (organizacion ? 'empresa' : 'generica')) === 'empresa';
      if (quiereEmpresa) {
        if (organizacion) destinatario = { tipo: 'empresa', nombre: organizacion.toUpperCase() };
        else bloqueos.push('La práctica no tiene una organización receptora vinculada: genera la carta «A QUIEN CORRESPONDA».');
      }
    } else {
      if (solicitud.destinatario === 'empresa') bloqueos.push('La carta para una empresa exige una práctica con organización vinculada.');
      if (!solicitud.modalidad) bloqueos.push('Elige la modalidad de práctica de la carta.');
      else if (!ofertadas.some((m) => m.modalidad === solicitud.modalidad)) bloqueos.push('Esa modalidad no está ofertada en el periodo.');
      else modalidad = solicitud.modalidad as ModalidadPractica;
    }

    const firmante = {
      nombre: this.config?.get<string>('CARTA_FIRMANTE_NOMBRE')?.trim() ?? '',
      cargo: this.config?.get<string>('CARTA_FIRMANTE_CARGO')?.trim() || 'Coordinador de Desarrollo Profesional',
      dependencia: this.config?.get<string>('CARTA_FIRMANTE_DEPENDENCIA')?.trim() || 'Dirección de Operaciones',
    };
    // Aviso de configuración institucional: solo para el personal (al estudiante no le corresponde).
    if (!firmante.nombre && actor.rol !== Rol.ESTUDIANTE) advertencias.push('El nombre del firmante institucional no está configurado (CARTA_FIRMANTE_NOMBRE): la carta sale con el cargo.');

    const fecha = fechaColombia(ahora);
    const snapshotBase: Omit<SnapshotCarta, 'referencia'> | null = matricula && perfil.documento && modalidad
      ? {
        estudianteNombre: estudiante.nombre, tipoDocumento: matricula.tipoDocumento ?? null, documento: perfil.documento,
        programa: matricula.programaNombre, ciclo: matricula.ciclo, nivel: nivelLegible(matricula.ciclo),
        periodoAcademico: periodo.codigo, modalidad, modalidadEtiqueta: definicionModalidad(modalidad).etiqueta,
        destinatario, responsableArl, practicaId: practica?.id ?? null, escuelaId,
        fechaExpedicion: fecha.iso, fechaTexto: fecha.texto, firmante,
      }
      : null;
    const documento = snapshotBase ? redactarCarta({ ...snapshotBase, referencia: 'Se asigna al emitir' }) : null;

    return {
      vista: {
        periodoAcademico: periodo.codigo, ventanaAbierta,
        estudiante: matricula && perfil.documento
          ? { nombre: estudiante.nombre, tipoDocumento: matricula.tipoDocumento ?? null, documento: perfil.documento, programa: matricula.programaNombre, nivel: nivelLegible(matricula.ciclo) }
          : null,
        practicas, modalidadesOfertadas: ofertadas,
        datos: snapshotBase ? {
          destinatario: destinatario.nombre, tipoDestinatario: destinatario.tipo, modalidadEtiqueta: snapshotBase.modalidadEtiqueta,
          responsableArl, practicaId: snapshotBase.practicaId,
        } : null,
        documento, bloqueos, advertencias, puedeGenerar: bloqueos.length === 0 && snapshotBase !== null,
      },
      estudiante, matricula, periodo, practica, snapshotBase,
    };
  }

  /** Alcance del personal: coordinación/analista por escuelas (vacío = institucional), docente por asignación o escuela. */
  private enAlcance(actor: Actor, escuelaId: string | null, practicas: Practica[]): boolean {
    if (actor.rol === Rol.AUXILIAR) return true;
    if (practicas.some((p) => p.visiblePara(actor))) return true;
    if (actor.rol === Rol.COORDINADOR || actor.rol === Rol.ANALISTA) {
      const propias = escuelasDeCoordinacion(actor);
      return propias === null || (escuelaId !== null && propias.includes(escuelaId));
    }
    if (actor.rol === Rol.TUTOR) return escuelaId !== null && actor.escuelas.includes(escuelaId);
    return false;
  }

  private cartaEnAlcance(c: CartaPresentacion, actor: Actor): boolean {
    switch (actor.rol) {
      case Rol.ESTUDIANTE: return c.estudianteId === actor.id;
      case Rol.ADMINISTRADOR: case Rol.AUXILIAR: return true;
      case Rol.COORDINADOR: case Rol.ANALISTA: {
        const propias = escuelasDeCoordinacion(actor);
        if (propias === null) return true;
        const e = c.instantanea().snapshot?.escuelaId;
        return !!e && propias.includes(e);
      }
      case Rol.TUTOR: {
        const e = c.instantanea().snapshot?.escuelaId;
        return !!e && actor.escuelas.includes(e);
      }
      default: return false;
    }
  }

  private async exigirVisible(id: string, actor: Actor): Promise<CartaPresentacion> {
    if (!ROLES_CONSULTAN_CARTA.includes(actor.rol)) throw new NotFoundException('Carta no encontrada');
    const carta = await this.cartas.buscarPorId(id);
    if (!carta || !this.cartaEnAlcance(carta, actor)) throw new NotFoundException('Carta no encontrada');
    return carta;
  }

  private async referenciaNueva(): Promise<string> {
    for (let i = 0; i < 6; i++) {
      const ref = construirReferencia((n) => randomInt(n));
      if (!(await this.cartas.buscarPorReferencia(ref))) return ref;
    }
    throw new InternalServerErrorException('No fue posible asignar una referencia única');
  }

  private urlVerificacion(referencia: string): string {
    const base = this.config?.get<string>('URL_PUBLICA_WEB')?.trim()
      || (this.config?.get<string>('CORS_ORIGENES') ?? 'http://localhost:4200').split(',')[0].trim();
    return `${base.replace(/\/+$/, '')}/verificar-carta/${referencia}`;
  }

  private aRespuesta(c: CartaPresentacion, nombre: string, documento: string | null): CartaRespuesta {
    const d = c.instantanea();
    return {
      id: d.id, numeroFur: d.numeroFur, practicaId: d.practicaId, estudianteId: d.estudianteId,
      estudianteNombre: nombre, estudianteDocumento: documento, periodoAcademico: d.periodoAcademico,
      modalidadCarta: d.modalidadCarta, empresaRazonSocial: d.empresaRazonSocial,
      generadaEn: d.generadaEn.toISOString(), generadaPor: d.generadaPor,
      referencia: d.referencia, estado: d.estado, modalidad: d.modalidad,
      modalidadEtiqueta: d.snapshot?.modalidadEtiqueta ?? null,
      destinatario: d.snapshot?.destinatario.nombre ?? (d.empresaRazonSocial ?? DESTINATARIO_GENERICO),
      urlVerificacion: d.referencia ? this.urlVerificacion(d.referencia) : null,
      digital: c.esDigital,
    };
  }
}
