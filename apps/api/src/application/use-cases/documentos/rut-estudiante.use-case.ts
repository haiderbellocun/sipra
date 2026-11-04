import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, PRACTICA_REPOSITORY, PracticaRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY, ValidacionDocumentoEmpresarialRepositoryPort,
} from '../../../domain/ports/out/validacion-documento-empresarial.port';
import { estadoRutParaEstudiante } from '../../../domain/services/mesa-rut.domain-service';
import { puedeVerEstadoRutPropio } from '../../../domain/value-objects/acceso-rut.vo';
import { EstadoRutEstudianteDto } from '../../dtos/rut-mesa.dto';
import { Actor } from '../practicas/gestionar-practica.use-case';

/**
 * Estado del RUT para quien estudia: solo el suyo, en estados humanos, con qué ocurrió y qué hacer. Nunca nombres internos de
 * estado, códigos de discrepancia, confianza, hashes, banderas del pipeline ni detalle del OCR. No modifica nada.
 */
@Injectable()
export class RutEstudianteUseCase {
  constructor(
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY) private readonly validaciones: ValidacionDocumentoEmpresarialRepositoryPort,
  ) {}

  async estado(practicaId: string, actor: Actor): Promise<EstadoRutEstudianteDto> {
    if (!puedeVerEstadoRutPropio(actor.rol)) throw new ForbiddenException('Su perfil no consulta el estado del RUT de una práctica');
    const practica = await this.practicas.buscarPorId(practicaId);
    // Solo la propia: cualquier otra práctica «no existe» para este estudiante.
    if (!practica || practica.estudianteId !== actor.id) throw new NotFoundException('Práctica no encontrada');

    // El RUT vigente es el último cargado, sea natural o jurídico: una versión vieja es histórica.
    const ruts = (await this.documentos.listarPorPractica(practicaId))
      .filter((d) => d.tipo === TipoDocumento.RUT_NATURAL || d.tipo === TipoDocumento.RUT_JURIDICO)
      .map((d) => d.instantanea())
      .sort((a, b) => b.cargadoEn.getTime() - a.cargadoEn.getTime() || b.version - a.version);
    const actual = ruts[0];
    const validacion = actual ? (await this.validaciones.buscarPorDocumento(actual.id))?.instantanea() : undefined;
    const vista = estadoRutParaEstudiante({
      documento: actual ? { estado: actual.estado, motivoDevolucion: actual.motivoDevolucion } : null,
      validacion: validacion ? { estado: validacion.estado, motivoDecision: validacion.motivoDecision } : null,
    });
    return { estado: vista.estado, etiqueta: vista.etiqueta, que: vista.que, hacer: vista.hacer, puedeReenviar: vista.puedeReenviar };
  }
}
