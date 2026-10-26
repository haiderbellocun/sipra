import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ConsultaAdresPreparadaDto, EvidenciaEpsDto, FilaBandejaAdresDto, PrepararConsultaAdresDto, ResultadoAdresDto,
  ValidacionEpsEstudianteDto, ValidacionEpsOperacionDto,
} from '../../application/dtos/validacion-eps.dto';
import { ConsultaAdresUseCase } from '../../application/use-cases/documentos/consulta-adres.use-case';
import { ValidacionEpsUseCase } from '../../application/use-cases/documentos/validacion-eps.use-case';
import { ResultadoVerificarEps, VerificacionEpsUseCase } from '../../application/use-cases/documentos/verificacion-eps.use-case';
import { Actor } from '../../application/use-cases/practicas/gestionar-practica.use-case';
import { Rol } from '../../domain/value-objects/rol.vo';
import { ActorActual } from '../auth/actor.decorator';
import { Roles } from '../auth/roles.decorator';

/**
 * Validación del certificado de EPS. La decisión se toma por la ruta común de
 * documentos (`PATCH /documentos/:id/decision`), donde el auxiliar solo puede
 * decidir el certificado de EPS.
 *
 * Auxiliar, coordinación y administración operan; el estudiante ve únicamente
 * el resultado reducido. Docente, empresa y extensión no entran aquí.
 */
@ApiTags('Validación de EPS')
@ApiBearerAuth()
@ApiExtraModels(ValidacionEpsEstudianteDto, ValidacionEpsOperacionDto)
@Controller('validaciones-eps')
export class ValidacionesEpsController {
  constructor(
    private readonly validaciones: ValidacionEpsUseCase,
    private readonly verificaciones: VerificacionEpsUseCase,
    private readonly adres: ConsultaAdresUseCase,
  ) {}

  @Get('documento/:documentoId')
  @Roles(Rol.ESTUDIANTE, Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Resultado de la validación del certificado de EPS',
    description:
      'Quien opera recibe el detalle (ejes, datos leídos, discrepancias); el estudiante, solo el ' +
      'estado del procesamiento y el resultado. 404 si el documento no es un certificado de EPS o aún no se validó.',
  })
  @ApiResponse({ status: 200, type: ValidacionEpsOperacionDto })
  consultar(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @ActorActual() actor: Actor,
  ): Promise<ValidacionEpsEstudianteDto | ValidacionEpsOperacionDto> {
    return this.validaciones.consultarPorDocumento(documentoId, actor);
  }

  @Get(':id/evidencias')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Evidencias registradas de una validación (uso interno)' })
  @ApiResponse({ status: 200, type: [EvidenciaEpsDto] })
  evidencias(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
  ): Promise<EvidenciaEpsDto[]> {
    return this.validaciones.evidencias(id, actor);
  }

  @Post(':id/reserva')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Tomar el caso (reserva)',
    description: 'Una reserva vigente por caso. Si otro funcionario ya la tiene, 409. La reserva vence sola.',
  })
  @ApiResponse({ status: 200, type: ValidacionEpsOperacionDto })
  @ApiResponse({ status: 409, description: 'Reservado por otro funcionario o ya decidido' })
  reservar(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
  ): Promise<ValidacionEpsOperacionDto> {
    return this.validaciones.reservar(id, actor);
  }

  @Post(':id/verificar')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reintentar la verificación oficial del certificado',
    description:
      'Consulta, si existe, el verificador oficial registrado para el QR del certificado. No hay petición a ningún ' +
      'destino que no esté en el registro. Devuelve el resultado del intento (p. ej. «deshabilitada», «qr_no_soportado», «verificado»).',
  })
  async verificar(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
  ): Promise<{ resultado: ResultadoVerificarEps }> {
    return { resultado: await this.verificaciones.verificarComoOperador(id, actor) };
  }

  // ── Consulta ADRES asistida ──────────────────────────────────────────────
  // Una PERSONA consulta el portal oficial y resuelve el CAPTCHA; SIPRA nunca llama a ADRES.

  @Get('adres/bandeja')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Casos de EPS con la afiliación pendiente de contrastar con ADRES',
    description: 'Vista mínima de operación: estudiante reducido, método, afiliación, estado ADRES y responsable.',
  })
  @ApiResponse({ status: 200, type: [FilaBandejaAdresDto] })
  bandejaAdres(@ActorActual() actor: Actor): Promise<FilaBandejaAdresDto[]> {
    return this.adres.bandeja(actor);
  }

  @Post(':id/adres/preparar')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preparar la consulta ADRES (qué tipo y número de documento consultar)',
    description:
      'Exige tener el caso reservado. NO llama a ADRES ni abre nada desde el servidor: devuelve el tipo y número a ' +
      'consultar, el enlace público del portal oficial y un identificador de un solo uso. Si SIPRA no conoce el tipo de ' +
      'documento, responde «requiere_tipo_documento» y la persona lo confirma (nunca se infiere del número).',
  })
  @ApiResponse({ status: 200, type: ConsultaAdresPreparadaDto })
  prepararAdres(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrepararConsultaAdresDto,
    @ActorActual() actor: Actor,
  ): Promise<ConsultaAdresPreparadaDto> {
    return this.adres.preparar(id, actor, dto);
  }

  @Post(':id/adres/resultado')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['consultaId', 'archivo'],
      properties: {
        consultaId: { type: 'string', description: 'El identificador de un solo uso que devolvió «preparar».' },
        fechaConsulta: { type: 'string', description: 'Opcional: fecha en que se hizo la consulta (AAAA-MM-DD o DD/MM/AAAA).' },
        archivo: { type: 'string', format: 'binary', description: 'El resultado de ADRES guardado o impreso como PDF.' },
      },
    },
  })
  @ApiOperation({
    summary: 'Cargar el resultado de ADRES (PDF) y procesarlo',
    description:
      'El PDF se guarda en almacenamiento privado, se lee localmente (texto nativo, OCR como respaldo; sin IA externa) y se ' +
      'contrasta con SIPRA y con el certificado. El mismo archivo no se registra dos veces. ADRES solo actualiza la ' +
      'afiliación: no prueba la autenticidad del certificado.',
  })
  @ApiResponse({ status: 200, type: ResultadoAdresDto })
  async resultadoAdres(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
    @ActorActual() actor: Actor,
  ): Promise<ResultadoAdresDto> {
    let consultaId = '';
    let fechaConsulta: string | null = null;
    let contenido: Buffer | null = null;
    for await (const parte of request.parts()) {
      if (parte.type === 'file') contenido = await parte.toBuffer();
      else if (parte.fieldname === 'consultaId' && typeof parte.value === 'string') consultaId = parte.value;
      else if (parte.fieldname === 'fechaConsulta' && typeof parte.value === 'string') fechaConsulta = parte.value;
    }
    if (!contenido) throw new BadRequestException('No se recibió ningún archivo');
    if (!/^[0-9a-f-]{36}$/i.test(consultaId)) throw new BadRequestException('Identificador de consulta inválido');
    return this.adres.cargarEvidencia(id, actor, { consultaId, contenido, fechaConsulta });
  }

  @Post(':id/adres/procesar')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @HttpCode(200)
  @ApiOperation({ summary: 'Reintentar el procesamiento del resultado ADRES ya cargado (idempotente)' })
  @ApiResponse({ status: 200, type: ResultadoAdresDto })
  procesarAdres(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
  ): Promise<ResultadoAdresDto> {
    return this.adres.procesar(id, actor);
  }

  @Delete(':id/reserva')
  @Roles(Rol.AUXILIAR, Rol.COORDINADOR, Rol.ADMINISTRADOR)
  @ApiOperation({ summary: 'Liberar el caso; coordinación y administración pueden liberar el de otro' })
  @ApiResponse({ status: 200, type: ValidacionEpsOperacionDto })
  liberar(
    @Param('id', ParseUUIDPipe) id: string,
    @ActorActual() actor: Actor,
  ): Promise<ValidacionEpsOperacionDto> {
    return this.validaciones.liberar(id, actor);
  }
}
