import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TipoDocumento } from '../../../domain/entities/documento.entity';
import {
  DOCUMENTO_REPOSITORY, DocumentoRepositoryPort, PRACTICA_REPOSITORY, PracticaRepositoryPort,
} from '../../../domain/ports/out/repositorios.port';
import {
  VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY, ValidacionDocumentoEmpresarialRepositoryPort,
} from '../../../domain/ports/out/validacion-documento-empresarial.port';
import { estadoCamaraParaEstudiante } from '../../../domain/services/mesa-camara.domain-service';
import { puedeVerEstadoCamaraPropio } from '../../../domain/value-objects/acceso-camara.vo';
import { EstadoCamaraEstudianteDto } from '../../dtos/camara-mesa.dto';
import { Actor } from '../practicas/gestionar-practica.use-case';

/**
 * Estado del certificado de Cámara de Comercio para quien estudia: solo el suyo, en estados humanos, con qué ocurrió y qué hacer.
 * Nunca nombres internos de estado, códigos de discrepancia, confianza, hashes, banderas del pipeline ni texto del OCR. No modifica
 * nada.
 */
@Injectable()
export class CamaraEstudianteUseCase {
  constructor(
    @Inject(PRACTICA_REPOSITORY) private readonly practicas: PracticaRepositoryPort,
    @Inject(DOCUMENTO_REPOSITORY) private readonly documentos: DocumentoRepositoryPort,
    @Inject(VALIDACION_DOCUMENTO_EMPRESARIAL_REPOSITORY) private readonly validaciones: ValidacionDocumentoEmpresarialRepositoryPort,
  ) {}

  async estado(practicaId: string, actor: Actor): Promise<EstadoCamaraEstudianteDto> {
    if (!puedeVerEstadoCamaraPropio(actor.rol)) throw new ForbiddenException('Su perfil no consulta el estado de la Cámara de Comercio de una práctica');
    const practica = await this.practicas.buscarPorId(practicaId);
    // Solo la propia: cualquier otra práctica «no existe» para este estudiante.
    if (!practica || practica.estudianteId !== actor.id) throw new NotFoundException('Práctica no encontrada');

    // La Cámara vigente es la última cargada: una versión anterior es histórica.
    const camaras = (await this.documentos.listarPorPractica(practicaId))
      .filter((d) => d.tipo === TipoDocumento.CAMARA_COMERCIO)
      .map((d) => d.instantanea())
      .sort((a, b) => b.version - a.version || b.cargadoEn.getTime() - a.cargadoEn.getTime());
    const actual = camaras[0];
    const validacion = actual ? (await this.validaciones.buscarPorDocumento(actual.id))?.instantanea() : undefined;
    const vista = estadoCamaraParaEstudiante({
      documento: actual ? { estado: actual.estado, motivoDevolucion: actual.motivoDevolucion } : null,
      validacion: validacion ? { estado: validacion.estado, motivoDecision: validacion.motivoDecision } : null,
    });
    return { estado: vista.estado, etiqueta: vista.etiqueta, que: vista.que, hacer: vista.hacer, puedeReenviar: vista.puedeReenviar };
  }
}
