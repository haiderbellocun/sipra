import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Counter, Gauge, Histogram, Registry, collectDefaultMetrics,
} from 'prom-client';
import { ResumenMetricasEps } from '../../domain/ports/out/validacion-eps.port';

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

  // ── Flujo EPS (Fase 6). Sin PII: solo enumeraciones acotadas como etiquetas, jamás ids, nombres ni documentos. ──
  readonly epsDocumentosProcesados = new Counter({
    name: 'sipra_eps_documentos_procesados_total',
    help: 'Certificados de EPS leídos localmente (ruta de lectura y si hubo OCR)',
    labelNames: ['ruta', 'ocr'] as const,
    registers: [this.registro],
  });

  readonly epsOcr = new Counter({
    name: 'sipra_eps_ocr_total',
    help: 'Certificados de EPS que requirieron OCR local',
    registers: [this.registro],
  });

  readonly epsDecisiones = new Counter({
    name: 'sipra_eps_decisiones_total',
    help: 'Decisiones humanas sobre certificados de EPS (y si se apartaron de la recomendación del sistema)',
    labelNames: ['decision', 'aparta_de_recomendacion'] as const,
    registers: [this.registro],
  });

  readonly epsTiempoRevision = new Histogram({
    name: 'sipra_eps_tiempo_revision_horas',
    help: 'Horas desde que llegó el certificado hasta la decisión humana',
    buckets: [1, 4, 8, 24, 48, 72, 168, 336],
    registers: [this.registro],
  });

  private fuenteEps: (() => Promise<ResumenMetricasEps>) | null = null;
  private cacheEps: { hasta: number; datos: Promise<ResumenMetricasEps | null> } | null = null;

  /** La Mesa registra aquí cómo contar lo pendiente; los gauges se calculan en cada scrape (con caché de 5 s). */
  registrarFuenteEps(fuente: () => Promise<ResumenMetricasEps>): void {
    this.fuenteEps = fuente;
  }

  private resumenEps(): Promise<ResumenMetricasEps | null> {
    const ahora = Date.now();
    if (!this.cacheEps || this.cacheEps.hasta < ahora) {
      const f = this.fuenteEps;
      this.cacheEps = { hasta: ahora + 5000, datos: f ? f().catch(() => null) : Promise.resolve(null) };
    }
    return this.cacheEps.datos;
  }

  private gaugeEps(name: string, help: string, valor: (r: ResumenMetricasEps) => number): Gauge {
    return new Gauge({
      name, help, registers: [this.registro],
      collect: async () => { const r = await this.resumenEps(); if (r) (this.registro.getSingleMetric(name) as Gauge).set(valor(r)); },
    });
  }

  readonly epsPendientesRevision = this.gaugeEps('sipra_eps_pendientes_revision', 'Casos EPS abiertos esperando una decisión humana', (r) => r.abiertas);
  readonly epsPendientesAdres = this.gaugeEps('sipra_eps_pendientes_adres', 'Casos EPS abiertos con la consulta ADRES pendiente', (r) => r.pendientesAdres);
  readonly epsSinAsignar = this.gaugeEps('sipra_eps_sin_asignar', 'Casos EPS abiertos sin funcionario (o con reserva vencida)', (r) => r.sinAsignar);
  readonly epsProcesamientoAtascado = this.gaugeEps('sipra_eps_procesamiento_atascado', 'Validaciones EPS «procesando» hace más de 30 minutos (worker atascado o muerto)', (r) => r.procesamientoAtascado);
  readonly epsProcesamientoError = this.gaugeEps('sipra_eps_procesamiento_error', 'Validaciones EPS en error de procesamiento, a la espera de reintento', (r) => r.procesamientoError);
  /** SOMBRA: casos que HUBIERAN sido candidatos a autoaprobación. La autoaprobación NO está activa; solo se mide. */
  readonly epsCandidatosAutoaprobacion = this.gaugeEps('sipra_eps_candidatos_autoaprobacion', 'Casos abiertos con la etiqueta «candidato» (modo sombra: no se aprueba nada)', (r) => r.candidatos);

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
