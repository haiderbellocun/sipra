import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, PRACTICA_REPOSITORY, PracticaRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import { VALIDACION_ACTA_REPOSITORY, ValidacionActaRepositoryPort } from '../../../domain/ports/out/validacion-acta.port';
import { estadoActaParaEstudiante } from '../../../domain/services/mesa-acta.domain-service';
import { puedeVerEstadoActaPropio } from '../../../domain/value-objects/acceso-acta.vo';
import { EstadoActaEstudianteDto } from '../../dtos/acta-iniciacion.dto';
import { Actor } from '../practicas/gestionar-practica.use-case';

/**
 * Estado del acta para quien estudia: solo la suya, en estados humanos, con qué ocurrió y qué hacer. Nunca nombres internos
 * de estado, códigos de discrepancia ni el resultado de la lectura. No modifica nada: el estudiante no cambia desde aquí la
 * remuneración ni quién asume la ARL (eso es de coordinación).
 */
@Injectable()
export class ActaEstudianteUseCase {
  constructor(
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(VALIDACION_ACTA_REPOSITORY) private readonly validaciones: ValidacionActaRepositoryPort,
  ) {}

  async estado(practicaId: string, actor: Actor): Promise<EstadoActaEstudianteDto> {
    if (!puedeVerEstadoActaPropio(actor.rol)) throw new ForbiddenException('Su perfil no consulta el estado del acta de una práctica');
    const practica = await this.practicas.buscarPorId(practicaId);
    // Solo la propia: cualquier otra práctica «no existe» para este estudiante.
    if (!practica || practica.estudianteId !== actor.id) throw new NotFoundException('Práctica no encontrada');

    const actas = (await this.documentos.listarPorPractica(practicaId))
      .filter((d) => d.tipo === TipoDocumento.ACTA_INICIO)
      .map((d) => d.instantanea())
      .sort((a, b) => b.version - a.version);
    const validaciones = await this.validaciones.listarPorPractica(practicaId);
    const vistaDe = (a: (typeof actas)[number] | undefined) => estadoActaParaEstudiante({
      documento: a ? { estado: a.estado, motivoDevolucion: a.motivoDevolucion } : null,
      validacion: (() => {
        const v = a ? validaciones.find((x) => x.documentoId === a.id)?.instantanea() : undefined;
        return v ? { estado: v.estado, motivoDecision: v.motivoDecision } : null;
      })(),
    });
    const actual = vistaDe(actas[0]);
    return {
      practicaId, estado: actual.estado, etiqueta: actual.etiqueta, que: actual.que, hacer: actual.hacer, puedeReenviar: actual.puedeReenviar,
      versionActual: actas[0]?.version ?? null,
      versiones: actas.map((a) => ({ version: a.version, etiqueta: vistaDe(a).etiqueta, cargadaEn: a.cargadoEn.toISOString() })),
    };
  }
}
