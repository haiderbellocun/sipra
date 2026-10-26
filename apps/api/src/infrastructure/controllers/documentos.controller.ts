import {
  BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res,
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
import { verificarEnlaceDocumento } from '../adapters/storage/enlace-documento';
import { ActorActual } from '../auth/actor.decorator';
import { Publico, Roles } from '../auth/roles.decorator';

/** Roles que consultan documentos; el auxiliar, solo los tipos de su proceso (dominio). */
const ROLES_DOCUMENTALES: readonly Rol[] = [
  Rol.ESTUDIANTE, Rol.TUTOR, Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR,
];

@ApiTags('Documentos')
@ApiBearerAuth()
@Controller('documentos')
export class DocumentosController {
  constructor(
    private readonly gestionar: GestionarDocumentoUseCase,
    private readonly config: ConfigService,
  ) {}

  @Get('practica/:practicaId')
  @Roles(...ROLES_DOCUMENTALES)
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
  @Roles(Rol.ESTUDIANTE, Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
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
  @Roles(...ROLES_DOCUMENTALES)
  @ApiOperation({
    summary: 'Enlace firmado de vigencia corta',
    description:
      'Emitir el enlace queda auditado como visualización solicitada; la descarga real se ' +
      'audita aparte. El auxiliar solo obtiene enlaces de los documentos de su proceso.',
  })
  enlace(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
  ): Promise<{ url: string; expiraEn: string }> {
    const minutos = this.config.get<number>('GCS_ENLACE_FIRMADO_MINUTOS') ?? 10;
    return this.gestionar.enlace(id, minutos, actor);
  }

  @Patch(':id/decision')
  @Roles(Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR, Rol.AUXILIAR)
  @ApiOperation({
    summary: 'Decidir sobre un documento',
    description:
      'Toda decisión exige justificación y un documento ya decidido no se decide de nuevo (409). El auxiliar ' +
      'decide únicamente el certificado de EPS. El plan de mejoramiento solo lo aprueba el tutor ' +
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
      'El enlace va firmado para un documento y para quien lo pidió. Al descargar se vuelve a ' +
      'comprobar el estado actual del usuario y su acceso al documento, y la descarga queda ' +
      'registrada en la auditoría. Es público (sin cabecera de sesión) solo porque la firma es ' +
      'la credencial.',
  })
  async descargar(
    @Query('doc') doc: string,
    @Query('usr') usr: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Req() peticion: FastifyRequest,
    @Res() respuesta: FastifyReply,
  ): Promise<void> {
    const enlace = verificarEnlaceDocumento(this.config.getOrThrow<string>('JWT_SECRETO'), {
      doc, usr, exp, sig,
    });
    if (!enlace) throw new BadRequestException('Enlace inválido o vencido');

    const contenido = await this.gestionar.descargar(enlace.documentoId, enlace.solicitanteId, {
      ip: peticion.ip ?? null,
      agenteUsuario: peticion.headers['user-agent'] ?? null,
    });
    await respuesta
      .header('content-type', 'application/octet-stream')
      .header('cache-control', 'private, no-store')
      .header('content-disposition', 'inline')
      .send(contenido);
  }
}
