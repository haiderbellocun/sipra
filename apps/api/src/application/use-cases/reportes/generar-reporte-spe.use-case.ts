import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, CATALOGO_REPOSITORY,
  CatalogoRepositoryPort, EstadoCatalogo, REPORTE_REPOSITORY, ReporteRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  ArchivoPlano, MARCA_BORRADOR, RegistroPlazaSpe, RegistroVacanteSpe,
  ReportesSpeDomainService,
} from '../../../domain/services/reportes-spe.domain-service';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { Actor } from '../practicas/gestionar-practica.use-case';

/**
 * Catálogos sin los cuales un archivo para el SPE no es válido: la entidad
 * rechaza códigos que no existan en la nomenclatura oficial.
 */
const CATALOGOS_REQUERIDOS = ['cno', 'ciiu', 'divipola_municipio', 'nivel_educativo'];

export class ReporteBloqueadoError extends Error {
  constructor(
    public readonly catalogos: readonly EstadoCatalogo[],
    public readonly ambiente: string,
  ) {
    super(
      `No se puede emitir el reporte en el ambiente "${ambiente}": ` +
        `${catalogos.map((c) => `${c.nombre} está ${c.estado}`).join(', ')}. ` +
        'Cargue los catálogos oficiales del DANE antes de generar archivos radicables.',
    );
    this.name = 'ReporteBloqueadoError';
  }
}

export interface ResultadoReporte {
  archivo: ArchivoPlano;
  /** true cuando la estructura sigue sin conciliarse contra el anexo técnico. */
  esBorrador: boolean;
  advertencias: string[];
}

@Injectable()
export class GenerarReporteSpeUseCase {
  private readonly log = new Logger(GenerarReporteSpeUseCase.name);
  private readonly generador = new ReportesSpeDomainService();

  constructor(
    @Inject(REPORTE_REPOSITORY) private readonly reportes: ReporteRepositoryPort,
    @Inject(CATALOGO_REPOSITORY) private readonly catalogos: CatalogoRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    private readonly config: ConfigService,
  ) {}

  /**
   * Archivo diario de vacantes.
   *
   * Solo entran las vacantes en marco `laboral`: las de marco `practica` son un
   * requisito académico, no constituyen intermediación laboral y no se reportan.
   */
  async vacantes(actor: Actor, fecha = new Date()): Promise<ResultadoReporte> {
    this.exigirRol(actor);
    const advertencias = await this.verificarCatalogos();

    const filas = await this.reportes.vacantesPendientesReporte(fecha);
    const registros: RegistroVacanteSpe[] = filas.map((f) => ({
      identificadorVacante: f.vacanteId,
      nitEmpresa: `${f.nitEmpresa}-${f.nitDv}`,
      razonSocial: f.razonSocial,
      cargo: f.titulo,
      descripcion: f.descripcion,
      funciones: f.funciones,
      requisitos: f.requisitos,
      codigoCno: f.codigoCno,
      codigoCiiu: f.codigoCiiu,
      divipolaMunicipio: f.divipolaMunicipio,
      nivelEducativo: f.nivelEducativo,
      numeroVacantes: f.vacantesDisponibles,
      salarioMinimo: f.salarioMinimo,
      salarioMaximo: f.salarioMaximo,
      fechaPublicacion: f.publicadaEn,
      fechaVencimiento: f.vigenteHasta,
    }));

    const anexoConfirmado = this.anexoConfirmado;
    const plano = this.generador.generarVacantes(registros, {
      anexoConfirmado,
      fecha,
      nitPrestador: this.nitPrestador,
    });
    const archivo = this.sellar(plano);

    await this.registrar(actor, 'vacantes', archivo, registros.length, advertencias);

    // Solo se marcan como reportadas si el archivo es radicable: marcarlas
    // sobre un borrador haría que la vacante nunca volviera a salir.
    if (anexoConfirmado && advertencias.length === 0) {
      await this.reportes.marcarVacantesReportadas(filas.map((f) => f.vacanteId), fecha);
    }

    return { archivo, esBorrador: !anexoConfirmado, advertencias };
  }

  /** Archivo diario de plazas de práctica (Ley 1780 de 2016, art. 17). */
  async plazas(actor: Actor, fecha = new Date()): Promise<ResultadoReporte> {
    this.exigirRol(actor);
    const advertencias = await this.verificarCatalogos();

    const filas = await this.reportes.plazasPendientesReporte(fecha);
    const registros: RegistroPlazaSpe[] = filas.map((f) => ({
      identificadorPlaza: f.practicaId,
      nitEmpresa: `${f.nitEmpresa}-${f.nitDv}`,
      razonSocial: f.razonSocial,
      documentoEstudiante: f.documentoEstudiante,
      programa: f.programaId,
      nivelFormacion: f.ciclo,
      divipolaMunicipio: f.divipolaMunicipio ?? '',
      // La plaza de práctica no lleva ocupación CNO en el registro académico;
      // el anexo puede exigirla, y ese es uno de los puntos a conciliar.
      codigoCno: '',
      fechaInicio: f.fechaInicio,
      fechaFin: f.fechaFin,
      modalidad: f.modalidad,
    }));

    const plano = this.generador.generarPlazas(registros, {
      anexoConfirmado: this.anexoConfirmado,
      fecha,
      nitPrestador: this.nitPrestador,
    });
    const archivo = this.sellar(plano);

    await this.registrar(actor, 'plazas', archivo, registros.length, advertencias);
    return { archivo, esBorrador: !this.anexoConfirmado, advertencias };
  }

  // ── internos ─────────────────────────────────────────────────────────────

  private exigirRol(actor: Actor): void {
    if (![Rol.ADMINISTRADOR, Rol.EXTENSION].includes(actor.rol)) {
      throw new ForbiddenException(
        'Solo la Dirección de Extensión y la administración generan reportes regulatorios',
      );
    }
  }

  /**
   * En desarrollo y pruebas se permite generar con catálogos incompletos, para
   * poder trabajar el formato. En preproducción y producción NO: un archivo con
   * códigos fuera de la nomenclatura oficial se radica, queda en firme y luego
   * hay que corregirlo ante la entidad.
   */
  private async verificarCatalogos(): Promise<string[]> {
    const estados = await this.catalogos.estados();
    const incompletos = estados.filter(
      (e) => CATALOGOS_REQUERIDOS.includes(e.nombre) && e.estado !== 'completo',
    );
    if (incompletos.length === 0) return [];

    const ambiente = this.config.get<string>('SIPRA_AMBIENTE') ?? 'dev';
    if (['pre', 'prod'].includes(ambiente)) {
      throw new ReporteBloqueadoError(incompletos, ambiente);
    }

    return incompletos.map(
      (c) =>
        `El catálogo ${c.nombre} está ${c.estado} ` +
        `(${c.filasCargadas} de ${c.filasEsperadas ?? '?'}). ` +
        'El archivo no es radicable.',
    );
  }

  private get anexoConfirmado(): boolean {
    return this.config.get<string>('SPE_ANEXO_CONFIRMADO') === 'true';
  }

  private get nitPrestador(): string {
    return this.config.get<string>('SPE_NIT_PRESTADOR') ?? '000000000';
  }

  private sellar(plano: Omit<ArchivoPlano, 'hash'>): ArchivoPlano {
    return {
      ...plano,
      hash: createHash('sha256').update(plano.contenido, 'utf8').digest('hex'),
    };
  }

  /** Cada generación queda en auditoría con el hash de lo que se produjo. */
  private async registrar(
    actor: Actor,
    tipo: string,
    archivo: ArchivoPlano,
    registros: number,
    advertencias: string[],
  ): Promise<void> {
    await this.auditoria.registrar({
      actorId: actor.id,
      actorCorreo: actor.correo,
      actorRol: actor.rol,
      accion: AccionAuditada.REPORTE_GENERADO,
      entidad: 'reporte_spe',
      entidadId: null,
      justificacion: null,
      metadatos: {
        tipo,
        archivo: archivo.nombre,
        registros,
        hash: archivo.hash,
        borrador: !this.anexoConfirmado ? MARCA_BORRADOR : undefined,
        advertencias: advertencias.length > 0 ? advertencias : undefined,
      },
      ip: actor.ip ?? null,
      agenteUsuario: actor.agenteUsuario ?? null,
      ocurridoEn: new Date(),
    });
    this.log.log(`Reporte ${tipo}: ${registros} registro(s), archivo ${archivo.nombre}`);
  }
}
