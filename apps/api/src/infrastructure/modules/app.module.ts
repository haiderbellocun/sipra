import { Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';

import { IngresarAbiertoUseCase } from '../../application/use-cases/auth/ingresar-abierto.use-case';
import {
  ListarPerfilesDisponiblesUseCase,
} from '../../application/use-cases/auth/listar-perfiles.use-case';
import {
  GestionarDocumentoUseCase,
} from '../../application/use-cases/documentos/gestionar-documento.use-case';
import {
  PipelineValidacionUseCase,
} from '../../application/use-cases/documentos/pipeline-validacion.use-case';
import {
  ProcesarTrabajoUseCase,
} from '../../application/use-cases/documentos/procesar-trabajo.use-case';
import {
  GestionarEmpresaUseCase,
} from '../../application/use-cases/empresas/gestionar-empresa.use-case';
import {
  TableroCumplimientoUseCase,
} from '../../application/use-cases/obligaciones/tablero-cumplimiento.use-case';
import {
  GestionarPracticaUseCase,
} from '../../application/use-cases/practicas/gestionar-practica.use-case';
import {
  GestionarVacanteUseCase,
} from '../../application/use-cases/vacantes/gestionar-vacante.use-case';
import {
  GenerarReporteSpeUseCase,
} from '../../application/use-cases/reportes/generar-reporte-spe.use-case';
import {
  ParametrosUseCase,
} from '../../application/use-cases/administracion/parametros.use-case';

import {
  GENERADOR_PDF, GENERADOR_HOJA_CALCULO,
  ALMACENAMIENTO, COHERENCIA_CRUZADA, COLA, EXTRACCION_IA, EXTRACCION_LOCAL, LECTOR_CODIGO_BARRAS,
  NOTIFICACION, RUES, SINU,
} from '../../domain/ports/out/servicios-externos.port';
import {
  AUDITORIA_REPOSITORY, CATALOGO_REPOSITORY, COSTOS_IA_REPOSITORY, DOCUMENTO_REPOSITORY, EMPRESA_REPOSITORY,
  BITACORA_REPOSITORY, SOLICITUD_ARL_REPOSITORY, PQRS_REPOSITORY, CARTA_REPOSITORY, OBLIGACION_REPOSITORY, PARAMETRO_REPOSITORY, PERIODO_REPOSITORY, PRACTICA_REPOSITORY,
  REPORTE_REPOSITORY,
  USUARIO_REPOSITORY, VACANTE_REPOSITORY,
} from '../../domain/ports/out/repositorios.port';

import {
  CoherenciaCruzadaAdapter, ExtraccionAnthropicAdapter, ExtraccionSimuladaAdapter,
} from '../adapters/ia/extraccion.adapter';
import { ExtraccionOpenAiAdapter } from '../adapters/ia/openai.adapter';
import {
  NotificacionConsolaAdapter, RuesSimuladoAdapter, SinuSimuladoAdapter,
} from '../adapters/externos/externos.adapter';
import {
  NotificacionWorkspaceAdapter,
} from '../adapters/externos/workspace.adapter';
import {
  AuditoriaRepositoryAdapter, DocumentoRepositoryAdapter, EmpresaRepositoryAdapter,
  BitacoraRepositoryAdapter, SolicitudArlRepositoryAdapter, PqrsRepositoryAdapter, CartaRepositoryAdapter, ObligacionRepositoryAdapter, PeriodoRepositoryAdapter, PracticaRepositoryAdapter, UsuarioRepositoryAdapter,
  VacanteRepositoryAdapter,
} from '../adapters/persistence/postgres/repositorios.adapter';
import {
  CatalogoRepositoryAdapter, CostosIaRepositoryAdapter, ReporteRepositoryAdapter,
} from '../adapters/persistence/postgres/reportes.adapter';
import {
  ParametroRepositoryAdapter,
} from '../adapters/persistence/postgres/parametros.adapter';
import {
  AlmacenamientoGcsAdapter, AlmacenamientoLocalAdapter,
} from '../adapters/storage/almacenamiento.adapter';
import {
  ColaCloudTasksAdapter, ColaEnProcesoAdapter,
} from '../adapters/cola/cola.adapter';
import {
  DecodificadorImagenAdapter,
} from '../adapters/imagen/decodificador.adapter';
import { Pdf417Adapter } from '../adapters/codigo-barras/pdf417.adapter';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { REDACCION_LOGS } from '../observability/redaccion-logs';
import { OidcService } from '../auth/oidc.service';
import { RolesGuard } from '../auth/roles.guard';
import { PermisoEscrituraGuard } from '../auth/permiso-escritura.guard';
import { validarEntorno } from '../config/configuracion';
import { AuthController } from '../controllers/auth.controller';
import { BolsaController } from '../controllers/bolsa.controller';
import { CumplimientoController } from '../controllers/cumplimiento.controller';
import { DocumentosController } from '../controllers/documentos.controller';
import { EmpresasController } from '../controllers/empresas.controller';
import { PracticasController } from '../controllers/practicas.controller';
import { SaludController } from '../controllers/salud.controller';
import { ReportesController } from '../controllers/reportes.controller';
import { AdministracionController } from '../controllers/administracion.controller';
import { TrabajosController } from '../controllers/trabajos.controller';
import { CartasController } from '../controllers/cartas.controller';
import { BitacoraController } from '../controllers/bitacora.controller';
import { SolicitudesArlController } from '../controllers/solicitudes-arl.controller';
import { UsuariosController } from '../controllers/usuarios.controller';
import { VistasController } from '../controllers/vistas.controller';
import { ReportesSgpController } from '../controllers/reportes-sgp.controller';
import { PeriodosController } from '../controllers/periodos.controller';
import { CatalogoController } from '../controllers/catalogo.controller';
import { PqrsController } from '../controllers/pqrs.controller';
import { ConsentimientosController } from '../controllers/consentimientos.controller';
import { ValidacionesEpsController } from '../controllers/validaciones-eps.controller';
import { ValidacionEpsUseCase } from '../../application/use-cases/documentos/validacion-eps.use-case';
import { VALIDACION_EPS_REPOSITORY } from '../../domain/ports/out/validacion-eps.port';
import { ValidacionEpsRepositoryAdapter } from '../adapters/persistence/postgres/validacion-eps.adapter';
import { ConsentimientoUseCase } from '../../application/use-cases/consentimientos/consentimiento.use-case';
import {
  CONSENTIMIENTO_REPOSITORY, POLITICA_CONSENTIMIENTO_REPOSITORY,
} from '../../domain/ports/out/consentimiento.port';
import {
  ConsentimientoRepositoryAdapter, PoliticaConsentimientoRepositoryAdapter,
} from '../adapters/persistence/postgres/consentimiento.adapter';
import { CostosIaController } from '../controllers/costos-ia.controller';
import { CostosIaUseCase } from '../../application/use-cases/administracion/costos-ia.use-case';
import { PqrsUseCase } from '../../application/use-cases/administracion/pqrs.use-case';
import { GestionarPeriodosUseCase } from '../../application/use-cases/administracion/gestionar-periodos.use-case';
import { ReportesSgpUseCase } from '../../application/use-cases/reportes/reportes-sgp.use-case';
import { ExcelJsAdapter } from '../adapters/hojas/exceljs.adapter';
import { GestionarUsuariosUseCase } from '../../application/use-cases/administracion/gestionar-usuarios.use-case';
import { VistasSinuUseCase } from '../../application/use-cases/administracion/vistas-sinu.use-case';
import { SolicitudArlUseCase } from '../../application/use-cases/practicas/solicitud-arl.use-case';
import { BitacoraUseCase } from '../../application/use-cases/practicas/bitacora.use-case';
import { RegistrarPracticaUseCase } from '../../application/use-cases/practicas/registrar-practica.use-case';
import { CartaPresentacionUseCase } from '../../application/use-cases/practicas/carta-presentacion.use-case';
import { PdfKitAdapter } from '../adapters/pdf/pdfkit.adapter';
import { MetricasInterceptor } from '../observability/metricas.interceptor';
import { MetricasService } from '../observability/metricas.service';
import { ENTIDADES_ORM } from '../persistence/postgres/entities/todas.orm-entity';
import { opcionesDataSource } from '../persistence/postgres/opciones-datasource';
import { AuditoriaService } from './auditoria.service';
import { NotificacionesService } from './notificaciones.service';
import { TareasProgramadasService } from './tareas-programadas.service';

/**
 * Composición de dependencias. Aquí —y solo aquí— la infraestructura se enlaza
 * con los puertos que define el dominio. Cambiar de proveedor de IA o de
 * almacenamiento es cambiar una línea de esta lista.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validarEntorno,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_NIVEL') ?? 'info',
          // El formateo legible es una comodidad de terminal: se apoya en
          // módulos que resuelven rutas desde `require.main`, que en un
          // contenedor sin servidor no existe, y eso tumba el arranque entero.
          // Sin terminal se registra JSON, que además es lo que esperan
          // Cloud Logging y cualquier recolector.
          transport:
            process.stdout.isTTY && config.get<string>('NODE_ENV') === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
              : undefined,
          // Nunca se registran cuerpos de petición, cabeceras de autorización ni la
          // firma de los enlaces de descarga.
          redact: REDACCION_LOGS,
        },
      }),
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...opcionesDataSource(), autoLoadEntities: false }),
    }),
    TypeOrmModule.forFeature(ENTIDADES_ORM),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRETO'),
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRACION') ??
            '8h') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    AuthController, PracticasController, DocumentosController,
    EmpresasController, CumplimientoController, BolsaController, SaludController,
    TrabajosController, ReportesController, AdministracionController, CartasController,
    BitacoraController, SolicitudesArlController, UsuariosController, VistasController, ReportesSgpController,
    PeriodosController, CatalogoController, PqrsController, CostosIaController, ConsentimientosController, ValidacionesEpsController,
  ],
  providers: [
    // ── Puertos de salida → adaptadores ──────────────────────────────────
    UsuarioRepositoryAdapter,
    { provide: USUARIO_REPOSITORY, useExisting: UsuarioRepositoryAdapter },
    { provide: PRACTICA_REPOSITORY, useClass: PracticaRepositoryAdapter },
    { provide: DOCUMENTO_REPOSITORY, useClass: DocumentoRepositoryAdapter },
    { provide: EMPRESA_REPOSITORY, useClass: EmpresaRepositoryAdapter },
    { provide: OBLIGACION_REPOSITORY, useClass: ObligacionRepositoryAdapter },
    { provide: VACANTE_REPOSITORY, useClass: VacanteRepositoryAdapter },
    { provide: AUDITORIA_REPOSITORY, useClass: AuditoriaRepositoryAdapter },
    { provide: CATALOGO_REPOSITORY, useClass: CatalogoRepositoryAdapter },
    { provide: REPORTE_REPOSITORY, useClass: ReporteRepositoryAdapter },
    { provide: COSTOS_IA_REPOSITORY, useClass: CostosIaRepositoryAdapter },
    { provide: PARAMETRO_REPOSITORY, useClass: ParametroRepositoryAdapter },
    { provide: PERIODO_REPOSITORY, useClass: PeriodoRepositoryAdapter },
    { provide: CARTA_REPOSITORY, useClass: CartaRepositoryAdapter },
    { provide: BITACORA_REPOSITORY, useClass: BitacoraRepositoryAdapter },
    { provide: SOLICITUD_ARL_REPOSITORY, useClass: SolicitudArlRepositoryAdapter },
    { provide: PQRS_REPOSITORY, useClass: PqrsRepositoryAdapter },
    { provide: POLITICA_CONSENTIMIENTO_REPOSITORY, useClass: PoliticaConsentimientoRepositoryAdapter },
    { provide: CONSENTIMIENTO_REPOSITORY, useClass: ConsentimientoRepositoryAdapter },
    { provide: VALIDACION_EPS_REPOSITORY, useClass: ValidacionEpsRepositoryAdapter },
    { provide: GENERADOR_PDF, useClass: PdfKitAdapter },
    { provide: GENERADOR_HOJA_CALCULO, useClass: ExcelJsAdapter },

    AlmacenamientoLocalAdapter,
    AlmacenamientoGcsAdapter,
    {
      provide: ALMACENAMIENTO,
      inject: [ConfigService, AlmacenamientoLocalAdapter, AlmacenamientoGcsAdapter],
      useFactory: (
        config: ConfigService,
        local: AlmacenamientoLocalAdapter,
        gcs: AlmacenamientoGcsAdapter,
      ) => (config.get<string>('STORAGE_DRIVER') === 'gcs' ? gcs : local),
    },

    ColaEnProcesoAdapter,
    ColaCloudTasksAdapter,
    {
      provide: COLA,
      inject: [ConfigService, ColaEnProcesoAdapter, ColaCloudTasksAdapter],
      useFactory: (
        config: ConfigService,
        enProceso: ColaEnProcesoAdapter,
        cloudTasks: ColaCloudTasksAdapter,
      ) => (config.get<string>('COLA_DRIVER') === 'cloud_tasks' ? cloudTasks : enProceso),
    },

    DecodificadorImagenAdapter,
    { provide: LECTOR_CODIGO_BARRAS, useClass: Pdf417Adapter },

    ExtraccionSimuladaAdapter,
    ExtraccionAnthropicAdapter,
    ExtraccionOpenAiAdapter,
    {
      provide: EXTRACCION_IA,
      inject: [ConfigService, ExtraccionSimuladaAdapter, ExtraccionAnthropicAdapter, ExtraccionOpenAiAdapter],
      useFactory: (
        config: ConfigService,
        simulada: ExtraccionSimuladaAdapter,
        anthropic: ExtraccionAnthropicAdapter,
        openai: ExtraccionOpenAiAdapter,
      ) => {
        const driver = config.get<string>('IA_DRIVER');
        if (driver === 'openai') return openai;
        if (driver === 'anthropic') return anthropic;
        return simulada;
      },
    },
    // Extractor LOCAL y determinístico: el único que usan los tipos con procesamiento local
    // (certificado de EPS). Nunca sale a un proveedor externo, sea cual sea `IA_DRIVER`.
    // Lectura LOCAL (pdf.js, ZXing, Tesseract): texto nativo, QR y OCR sin salir del proceso.
    { provide: LECTOR_DOCUMENTO_LOCAL, useClass: LectorDocumentoLocalAdapter },
    ExtraccionLocalAdapter,
    { provide: EXTRACCION_LOCAL, useExisting: ExtraccionLocalAdapter },
    { provide: COHERENCIA_CRUZADA, useClass: CoherenciaCruzadaAdapter },
    { provide: RUES, useClass: RuesSimuladoAdapter },
    { provide: SINU, useClass: SinuSimuladoAdapter },
    NotificacionConsolaAdapter,
    NotificacionWorkspaceAdapter,
    {
      provide: NOTIFICACION,
      inject: [ConfigService, NotificacionConsolaAdapter, NotificacionWorkspaceAdapter],
      useFactory: (
        config: ConfigService,
        consola: NotificacionConsolaAdapter,
        workspace: NotificacionWorkspaceAdapter,
      ) => (config.get<string>('CORREO_DRIVER') === 'workspace' ? workspace : consola),
    },

    // ── Casos de uso ──────────────────────────────────────────────────────
    IngresarAbiertoUseCase,
    ListarPerfilesDisponiblesUseCase,
    GestionarPracticaUseCase,
    RegistrarPracticaUseCase,
    CartaPresentacionUseCase,
    BitacoraUseCase,
    SolicitudArlUseCase,
    GestionarUsuariosUseCase,
    VistasSinuUseCase,
    ReportesSgpUseCase,
    GestionarPeriodosUseCase,
    PqrsUseCase,
    ConsentimientoUseCase,
    ValidacionEpsUseCase,
    PipelineValidacionUseCase,
    ProcesarTrabajoUseCase,
    GestionarDocumentoUseCase,
    GestionarEmpresaUseCase,
    TableroCumplimientoUseCase,
    GestionarVacanteUseCase,
    GenerarReporteSpeUseCase,
    ParametrosUseCase,
    CostosIaUseCase,

    // ── Transversales ─────────────────────────────────────────────────────
    OidcService,
    MetricasService,
    AuditoriaService,
    NotificacionesService,
    TareasProgramadasService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermisoEscrituraGuard },
    { provide: APP_INTERCEPTOR, useClass: MetricasInterceptor },
  ],
})
export class AppModule implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly colaEnProceso: ColaEnProcesoAdapter,
    private readonly procesarTrabajo: ProcesarTrabajoUseCase,
  ) {}

  /**
   * La cola en proceso necesita saber quién ejecuta los trabajos. Se enlaza
   * aquí y no por inyección directa para no crear una dependencia circular
   * entre la cola y el caso de uso que la usa.
   */
  onModuleInit(): void {
    if (this.config.get<string>('COLA_DRIVER') !== 'cloud_tasks') {
      this.colaEnProceso.registrarEjecutor((trabajo) => this.procesarTrabajo.ejecutar(trabajo));
    }
  }
}import { LECTOR_DOCUMENTO_LOCAL } from '../../domain/ports/out/lector-documento-local.port';
import { LectorDocumentoLocalAdapter } from '../adapters/lectura-local/lector-documento-local.adapter';
import { ExtraccionLocalAdapter } from '../adapters/ia/extraccion-local.adapter';

