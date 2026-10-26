import {
  BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccionAuditada } from '../../../domain/entities/auditoria.entity';
import {
  DatosEmpresa, Empresa, EstadoEmpresa, SenalPreverificacion,
} from '../../../domain/entities/empresa.entity';
import {
  AUDITORIA_REPOSITORY, AuditoriaRepositoryPort, EMPRESA_REPOSITORY, EmpresaRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { RUES, RuesPort } from '../../../domain/ports/out/servicios-externos.port';
import { Nit, NitInvalidoError } from '../../../domain/value-objects/nit.vo';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { DecisionEmpresaDto, EmpresaRespuestaDto, SolicitudEmpresaDto } from '../../dtos/empresa.dto';
import { Actor } from '../practicas/gestionar-practica.use-case';

/** Dominios de correo genéricos: no acreditan pertenencia a la empresa. */
const DOMINIOS_GENERICOS = [
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.es',
  'live.com', 'icloud.com', 'protonmail.com', 'aol.com',
];

@Injectable()
export class GestionarEmpresaUseCase {
  constructor(
    @Inject(EMPRESA_REPOSITORY) private readonly empresas: EmpresaRepositoryPort,
    @Inject(AUDITORIA_REPOSITORY) private readonly auditoria: AuditoriaRepositoryPort,
    @Inject(RUES) private readonly rues: RuesPort,
  ) {}

  /**
   * Formulario público. Realiza UNA operación: insertar una solicitud.
   * Una solicitud no es una organización: mientras el administrador no
   * apruebe, no hay tenant, ni usuario, ni acceso.
   */
  async registrarSolicitud(dto: SolicitudEmpresaDto): Promise<void> {
    // Campo trampa: se acepta en silencio y se descarta. No se informa al bot.
    if (dto.sitioWebAlterno?.trim()) return;

    let nit: Nit;
    try {
      nit = Nit.crear(dto.nit);
    } catch (error) {
      if (error instanceof NitInvalidoError) throw new BadRequestException(error.message);
      throw error;
    }

    // Confirmar que el NIT ya existe convertiría el formulario en un
    // verificador público de qué empresas trabajan con la institución.
    const existente = await this.empresas.buscarPorNit(nit.numero);
    if (existente) return;

    const ahora = new Date();
    const datos: DatosEmpresa = {
      id: randomUUID(),
      razonSocial: dto.razonSocial.trim(),
      nitNumero: nit.numero,
      nitDv: nit.digitoVerificacion,
      ciiu: dto.ciiu ?? null,
      divipolaMunicipio: dto.divipolaMunicipio ?? null,
      direccion: dto.direccion ?? null,
      telefono: dto.telefono ?? null,
      solicitanteNombre: dto.solicitanteNombre.trim(),
      solicitanteCorreo: dto.solicitanteCorreo.trim().toLowerCase(),
      solicitanteCargo: dto.solicitanteCargo ?? null,
      representanteLegal: dto.representanteLegal ?? null,
      estado: EstadoEmpresa.SOLICITUD_RECIBIDA,
      senales: [],
      decididaPor: null,
      justificacionDecision: null,
      solicitadaEn: ahora,
      actualizadaEn: ahora,
    };

    const empresa = await this.empresas.guardar(datos);
    const senales = await this.preverificar(empresa);
    empresa.registrarSenales(senales, ahora);
    await this.empresas.guardar(empresa.instantanea());
  }

  /** Pre-verificación automática (M6). Alimenta el semáforo; no decide. */
  private async preverificar(empresa: Empresa): Promise<SenalPreverificacion[]> {
    const datos = empresa.instantanea();
    const senales: SenalPreverificacion[] = [
      {
        codigo: 'NIT_DV',
        resultado: Nit.esValido(datos.nitNumero, datos.nitDv) ? 'ok' : 'critico',
        detalle: `Dígito de verificación ${datos.nitDv} para el NIT ${datos.nitNumero}`,
      },
    ];

    const dominio = datos.solicitanteCorreo.split('@')[1] ?? '';
    senales.push({
      codigo: 'DOMINIO_CORPORATIVO',
      resultado: DOMINIOS_GENERICOS.includes(dominio) ? 'advertencia' : 'ok',
      detalle: DOMINIOS_GENERICOS.includes(dominio)
        ? `El solicitante usa un dominio genérico (${dominio})`
        : `Dominio corporativo: ${dominio}`,
    });

    try {
      const rues = await this.rues.consultarPorNit(datos.nitNumero);
      if (!rues.encontrado) {
        senales.push({
          codigo: 'RUES',
          resultado: 'critico',
          detalle: 'El NIT no aparece en el RUES',
        });
      } else {
        senales.push({
          codigo: 'RUES',
          resultado: rues.estadoMatricula === 'activa' ? 'ok' : 'advertencia',
          detalle: `RUES: ${rues.razonSocial ?? '—'} · matrícula ${rues.estadoMatricula ?? 'desconocida'}`,
        });
        if (
          rues.razonSocial &&
          normalizar(rues.razonSocial) !== normalizar(datos.razonSocial)
        ) {
          senales.push({
            codigo: 'RAZON_SOCIAL_DISCREPANTE',
            resultado: 'advertencia',
            detalle: `Declarada "${datos.razonSocial}" vs. RUES "${rues.razonSocial}"`,
          });
        }
        if (
          rues.representanteLegal &&
          datos.representanteLegal &&
          normalizar(rues.representanteLegal) !== normalizar(datos.representanteLegal)
        ) {
          senales.push({
            codigo: 'REPRESENTANTE_DISCREPANTE',
            resultado: 'advertencia',
            detalle: 'El representante legal declarado no coincide con el RUES',
          });
        }
      }
    } catch {
      senales.push({
        codigo: 'RUES',
        resultado: 'advertencia',
        detalle: 'No fue posible consultar el RUES en este momento',
      });
    }

    return senales;
  }

  async listar(estado: EstadoEmpresa | undefined, actor: Actor): Promise<EmpresaRespuestaDto[]> {
    const esInterno = [Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.EXTENSION].includes(actor.rol);
    const empresas = await this.empresas.listar(estado);
    const visibles =
      actor.rol === Rol.EMPRESA
        ? empresas.filter((e) => e.id === actor.empresaId)
        : empresas;
    return visibles.map((e) => this.aRespuesta(e, esInterno));
  }

  async obtener(id: string, actor: Actor): Promise<EmpresaRespuestaDto> {
    const empresa = await this.empresas.buscarPorId(id);
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    if (actor.rol === Rol.EMPRESA && actor.empresaId !== id) {
      throw new NotFoundException('Empresa no encontrada');
    }
    const esInterno = [Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.EXTENSION].includes(actor.rol);
    return this.aRespuesta(empresa, esInterno);
  }

  /** La decisión es humana y exige justificación. La IA no habilita empresas. */
  async decidir(id: string, dto: DecisionEmpresaDto, actor: Actor): Promise<EmpresaRespuestaDto> {
    if (actor.rol !== Rol.ADMINISTRADOR) {
      throw new ForbiddenException('Solo el administrador institucional habilita empresas');
    }
    const empresa = await this.empresas.buscarPorId(id);
    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    try {
      switch (dto.decision) {
        case 'habilitar': empresa.habilitar(actor.id, dto.justificacion); break;
        case 'rechazar': empresa.rechazar(actor.id, dto.justificacion); break;
        case 'requerir_info': empresa.requerirInformacion(actor.id, dto.justificacion); break;
        case 'suspender': empresa.suspender(actor.id, dto.justificacion); break;
        default: throw new BadRequestException('Decisión no reconocida');
      }
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const guardada = await this.empresas.guardar(empresa.instantanea());
    await this.auditoria.registrar({
      actorId: actor.id,
      actorCorreo: actor.correo,
      actorRol: actor.rol,
      accion: AccionAuditada.DECISION_EMPRESA,
      entidad: 'empresa',
      entidadId: id,
      justificacion: dto.justificacion,
      metadatos: { decision: dto.decision, semaforo: empresa.semaforo },
      ip: actor.ip ?? null,
      agenteUsuario: actor.agenteUsuario ?? null,
      ocurridoEn: new Date(),
    });
    return this.aRespuesta(guardada, true);
  }

  private aRespuesta(empresa: Empresa, esInterno: boolean): EmpresaRespuestaDto {
    const datos = empresa.instantanea();
    return {
      id: datos.id,
      razonSocial: datos.razonSocial,
      nit: `${datos.nitNumero}-${datos.nitDv}`,
      estado: datos.estado,
      semaforo: empresa.semaforo,
      solicitanteNombre: datos.solicitanteNombre,
      solicitanteCorreo: datos.solicitanteCorreo,
      solicitadaEn: datos.solicitadaEn.toISOString(),
      ...(esInterno ? { senales: datos.senales } : {}),
    };
  }
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(s\.?a\.?s?|ltda|s\.?a\.?|e\.?u\.?)\b/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}
