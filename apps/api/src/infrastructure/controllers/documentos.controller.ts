import {
  BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  DecisionDocumentoDto, DocumentoRespuestaDto,
} from '../../application/dtos/documento.dto';
import {
  GestionarDocumentoUseCase,
} from '../../application/use-cases/documentos/gestionar-documento.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import {
  MetricasCalidadCaptura, TipoDocumento,
} from '../../domain/entities/documento.entity';
import { Rol } from '../../domain/value-objects/rol.vo';
import { verificarEnlaceDescarga } from '../adapters/storage/almacenamiento.adapter';
import { ALMACENAMIENTO, AlmacenamientoPort } from '../../domain/ports/out/servicios-externos.port';
import { ActorActual } from '../auth/actor.decorator';
import { Publico, Roles } from '../auth/roles.decorator';

@ApiTags('Documentos')
@ApiBearerAuth()
@Controller('documentos')
export class DocumentosController {
  constructor(
    private readonly gestionar: GestionarDocumentoUseCase,
    private readonly config: ConfigService,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoPort,
  ) {}

  @Get('practica/:practicaId')
  @ApiOperation({
    summary: 'Documentos de una práctica',
    description:
      'El estudiante no recibe el puntaje de riesgo ni las banderas internas: el filtrado ' +
      'ocurre en el servidor, no en la interfaz.',
  })
  @ApiResponse({ status: 200, type: [DocumentoRespuestaDto] })
  listar(
    @Param('practicaId', ParseUUIDPipe) practicaId: string,
    @ActorActual() actor: Actor,
  ): Promise<DocumentoRespuestaDto[]> {
    return this.gestionar.listarPorPractica(practicaId, actor);
  }

  @Post('practica/:practicaId')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Cargar un documento',
    description:
      'Verifica el tipo real por firma binaria, calcula el hash, versiona por tipo y ejecuta ' +
      'el pipeline de validación por capas. Renombrar la extensión no engaña a la verificación.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['tipo', 'archivo'],
      properties: {
        tipo: { type: 'string', enum: Object.values(TipoDocumento) },
        archivo: { type: 'string', format: 'binary' },
        calidad: {
          type: 'string',
          description: 'JSON con las métricas de captura calculadas en el dispositivo.',
        },
      },
    },
  })
  @ApiResponse({ status: 201, type: DocumentoRespuestaDto })
  async cargar(
    @Param('practicaId', ParseUUIDPipe) practicaId: string,
    @Req() request: FastifyRequest,
    @ActorActual() actor: Actor,
  ): Promise<DocumentoRespuestaDto> {
    const maximoBytes = (this.config.get<number>('DOC_TAMANO_MAXIMO_MB') ?? 10) * 1_048_576;

    let tipo: TipoDocumento | null = null;
    let calidad: MetricasCalidadCaptura | null = null;
    let archivo: { nombreOriginal: string; mimeDeclarado: string; contenido: Buffer } | null = null;

    for await (const parte of request.parts()) {
      if (parte.type === 'file') {
        const contenido = await parte.toBuffer();
        archivo = {
          nombreOriginal: parte.filename ?? 'documento',
          mimeDeclarado: parte.mimetype ?? 'application/octet-stream',
          contenido,
        };
      } else if (parte.fieldname === 'tipo' && typeof parte.value === 'string') {
        tipo = parte.value as TipoDocumento;
      } else if (parte.fieldname === 'calidad' && typeof parte.value === 'string') {
        try {
          calidad = JSON.parse(parte.value) as MetricasCalidadCaptura;
        } catch {
          throw new BadRequestException('El campo "calidad" no es un JSON válido');
        }
      }
    }

    if (!archivo) throw new BadRequestException('No se recibió ningún archivo');
    if (!tipo || !Object.values(TipoDocumento).includes(tipo)) {
      throw new BadRequestException('Tipo de documento no reconocido');
    }

    return this.gestionar.cargar(practicaId, tipo, archivo, calidad, maximoBytes, actor);
  }

  @Get(':id/enlace')
  @ApiOperation({
    summary: 'Enlace firmado de vigencia corta',
    description: 'Cada visualización y descarga queda registrada en la auditoría inmutable.',
  })
  enlace(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
  ): Promise<{ url: string; expiraEn: string }> {
    const minutos = this.config.get<number>('GCS_ENLACE_FIRMADO_MINUTOS') ?? 10;
    return this.gestionar.enlace(id, minutos, actor);
  }

  @Patch(':id/decision')
  @Roles(Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Decidir sobre un documento',
    description:
      'Toda decisión exige justificación. El plan de mejoramiento solo lo aprueba el tutor ' +
      'académico: la IA no lo aprueba ni lo rechaza en ninguna circunstancia.',
  })
  @ApiResponse({ status: 200, type: DocumentoRespuestaDto })
  decidir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDocumentoDto,
    @ActorActual() actor: Actor,
  ): Promise<DocumentoRespuestaDto> {
    return this.gestionar.decidir(id, dto, actor);
  }

  @Publico()
  @Get('descarga')
  @ApiOperation({
    summary: 'Descarga por enlace firmado por la API',
    description:
      'Con almacenamiento local es la única vía. Con Cloud Storage se usa cuando la identidad no puede ' +
      'firmar URL del bucket; el archivo se lee del bucket privado y se sirve desde aquí.',
  })
  async descargar(
    @Query('ruta') ruta: string,
    @Query('expira') expira: string,
    @Query('firma') firma: string,
    @Res() respuesta: FastifyReply,
  ): Promise<void> {
    const secreto = this.config.get<string>('JWT_SECRETO') ?? 'local';
    if (!verificarEnlaceDescarga(secreto, ruta ?? '', Number(expira), firma ?? '')) {
      throw new BadRequestException('Enlace inválido o vencido');
    }
    const contenido = await this.almacen.leer(ruta);
    await respuesta
      .header('content-type', 'application/octet-stream')
      .header('cache-control', 'private, no-store')
      .header('content-disposition', 'inline')
      .send(contenido);
  }
}
