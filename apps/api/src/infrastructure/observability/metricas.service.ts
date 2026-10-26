import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Counter, Gauge, Histogram, Registry, collectDefaultMetrics,
} from 'prom-client';

/**
 * Observabilidad por diseño (sección 7 del manual de la Fábrica).
 * Cuatro señales de oro + métricas de negocio del proceso de prácticas.
 */
@Injectable()
export class MetricasService implements OnModuleInit {
  readonly registro = new Registry();

  readonly peticiones = new Counter({
    name: 'http_requests_total',
    help: 'Total de peticiones HTTP atendidas',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [this.registro],
  });

  readonly duracion = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duración de las peticiones HTTP',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registro],
  });

  // ── Métricas de negocio ────────────────────────────────────────────────
  readonly documentosProcesados = new Counter({
    name: 'sipra_documentos_procesados_total',
    help: 'Documentos que completaron el pipeline de validación',
    labelNames: ['tipo', 'banda', 'estado'] as const,
    registers: [this.registro],
  });

  readonly documentosAutoAprobados = new Counter({
    name: 'sipra_documentos_auto_aprobados_total',
    help: 'Documentos aprobados sin intervención humana (objetivo: 85 % del total)',
    labelNames: ['tipo'] as const,
    registers: [this.registro],
  });

  readonly duracionPipeline = new Histogram({
    name: 'sipra_pipeline_duracion_seconds',
    help: 'Duración del pipeline de validación documental por capas',
    labelNames: ['tipo', 'cortocircuito'] as const,
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [this.registro],
  });

  readonly costoIa = new Counter({
    name: 'sipra_ia_costo_usd_total',
    help: 'Costo acumulado de la extracción asistida por IA',
    labelNames: ['modelo'] as const,
    registers: [this.registro],
  });

  readonly practicasBloqueadasArl = new Gauge({
    name: 'sipra_practicas_bloqueadas_arl',
    help: 'Prácticas en validación detenidas por la compuerta de ARL',
    registers: [this.registro],
  });

  readonly obligacionesVencidas = new Gauge({
    name: 'sipra_obligaciones_vencidas',
    help: 'Obligaciones normativas vencidas y sin cumplir',
    labelNames: ['tipo'] as const,
    registers: [this.registro],
  });

  readonly vacantesBloqueadas = new Counter({
    name: 'sipra_vacantes_bloqueadas_antidiscriminacion_total',
    help: 'Publicaciones bloqueadas por el filtro antidiscriminación',
    labelNames: ['categoria'] as const,
    registers: [this.registro],
  });

  readonly accesosFueraDeAlcance = new Counter({
    name: 'sipra_accesos_fuera_de_alcance_total',
    help: 'Intentos de acceso a expedientes fuera del alcance del actor',
    labelNames: ['rol'] as const,
    registers: [this.registro],
  });

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registro, prefix: 'sipra_' });
  }

  async exponer(): Promise<string> {
    return this.registro.metrics();
  }

  get contentType(): string {
    return this.registro.contentType;
  }
}
