import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MODELO_OPENAI_PREDETERMINADO, FUENTE_TARIFAS, TARIFAS_IA, TarifaModelo, VIGENCIA_TARIFAS, esfuerzoEfectivo,
  tarifaDe,
} from '../../../domain/entities/tarifas-ia';
import { MATRIZ_MODALIDADES } from '../../../domain/entities/modalidad.entity';
import {
  COSTOS_IA_REPOSITORY, CostosIaRepositoryPort, FilaGastoIa, FiltroGastoIa,
} from '../../../domain/ports/out/repositorios.port';
import {
  ComparativaModelo, CostosIaDomainService, EstimacionPorEstudiante, SUPUESTOS_PREDETERMINADOS,
  SupuestosEstimacion,
} from '../../../domain/services/costos-ia.domain-service';
import {
  ConocimientoDocumentalDomainService,
} from '../../../domain/services/conocimiento-documental.domain-service';
import { inicioDelDiaEnColombia } from '../../../domain/services/fechas-colombia';
import { TipoDocumento } from '../../../domain/entities/documento.entity';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { Actor } from '../practicas/gestionar-practica.use-case';
import { ParametrosUseCase } from './parametros.use-case';

export { inicioDelDiaEnColombia };

/** Lo que la página «Costos de IA» muestra como configuración vigente. */
export interface ConfiguracionIa {
  driver: string;
  modelo: string;
  esfuerzo: string;
  topeDiarioUsd: number;
  tarifasVigentesDesde: string;
  fuenteTarifas: string;
}

export interface GastoPorClave {
  clave: string;
  etiqueta: string;
  documentos: number;
  tokensEntrada: number;
  tokensSalida: number;
  costoUsd: number;
}

export interface GastoPorEstudiante {
  estudianteId: string;
  nombre: string;
  periodoAcademico: string;
  modalidad: string;
  modalidadEtiqueta: string;
  documentos: number;
  tokensEntrada: number;
  tokensSalida: number;
  costoUsd: number;
  ultimaLectura: string;
}

export interface ResumenGastoIa {
  filtro: { periodoAcademico: string | null; desde: string | null; hasta: string | null };
  periodosDisponibles: string[];
  totales: {
    costoUsd: number;
    documentos: number;
    estudiantes: number;
    tokensEntrada: number;
    tokensSalida: number;
    costoPromedioDocumentoUsd: number;
    costoPromedioEstudianteUsd: number;
    /** Documentos leídos sin costo (simulado, PDF417): muestran que el pipeline corrió sin IA. */
    documentosSinCosto: number;
  };
  gastoHoyUsd: number;
  topeDiarioUsd: number;
  porModelo: GastoPorClave[];
  porTipo: GastoPorClave[];
  porModalidad: GastoPorClave[];
  porPeriodo: GastoPorClave[];
  porEstudiante: GastoPorEstudiante[];
}

@Injectable()
export class CostosIaUseCase {
  private readonly estimador = new CostosIaDomainService();
  private readonly conocimiento = new ConocimientoDocumentalDomainService();

  constructor(
    @Inject(COSTOS_IA_REPOSITORY) private readonly repositorio: CostosIaRepositoryPort,
    private readonly parametros: ParametrosUseCase,
    private readonly config: ConfigService,
  ) {}

  async configuracion(): Promise<ConfiguracionIa> {
    const driver = this.config.get<string>('IA_DRIVER') ?? 'simulado';
    const modelo = driver === 'anthropic'
      ? (this.config.get<string>('IA_MODELO') ?? 'claude-sonnet-5')
      : (this.config.get<string>('OPENAI_MODELO') ?? MODELO_OPENAI_PREDETERMINADO);
    const pedido = this.config.get<string>('OPENAI_ESFUERZO') ?? 'low';
    // Se muestra el esfuerzo que de verdad se envía, no el configurado.
    const tarifa = tarifaDe(modelo)?.tarifa;
    const esfuerzo = tarifa ? (esfuerzoEfectivo(tarifa, pedido).efectivo ?? 'sin razonamiento') : pedido;
    return {
      driver,
      modelo,
      esfuerzo,
      topeDiarioUsd: await this.parametros.numero('ia.tope_diario_usd'),
      tarifasVigentesDesde: VIGENCIA_TARIFAS,
      fuenteTarifas: FUENTE_TARIFAS,
    };
  }

  tarifas(): readonly TarifaModelo[] {
    return TARIFAS_IA;
  }

  /** Estimación por estudiante y modalidad para un modelo; null si el modelo no está en la tabla. */
  estimacion(modelo?: string, ajustes: Partial<SupuestosEstimacion> = {}): EstimacionPorEstudiante | null {
    const supuestos = this.supuestos(ajustes);
    const elegido = modelo?.trim() || (this.config.get<string>('OPENAI_MODELO') ?? MODELO_OPENAI_PREDETERMINADO);
    return this.estimador.estimarPorEstudiante(elegido, supuestos);
  }

  comparativa(ajustes: Partial<SupuestosEstimacion> = {}): ComparativaModelo[] {
    return this.estimador.comparativa(this.supuestos(ajustes));
  }

  /**
   * Gasto real. El alcance es el mismo que el del resto de la API: la
   * coordinación de una escuela solo ve a sus estudiantes; administración y
   * la coordinación del Área de Prácticas (sin escuelas) ven todo.
   */
  async resumen(filtro: FiltroGastoIa, actor?: Actor): Promise<ResumenGastoIa> {
    const escuelaIds = this.alcance(actor);
    const conAlcance: FiltroGastoIa = { ...filtro, ...(escuelaIds ? { escuelaIds } : {}) };
    const [filas, periodos, topeDiarioUsd, gastoHoy] = await Promise.all([
      this.repositorio.gastoAgrupado(conAlcance),
      this.repositorio.periodosConGasto(escuelaIds),
      this.parametros.numero('ia.tope_diario_usd'),
      // El gasto de hoy frente al tope es institucional: el tope también lo es.
      this.repositorio.gastoAgrupado({ desde: inicioDelDiaEnColombia(new Date()) }),
    ]);
    const etiquetaModalidad = new Map(MATRIZ_MODALIDADES.map((m) => [m.modalidad as string, m.etiqueta]));

    const costoUsd = redondear(suma(filas, (f) => f.costoUsd));
    const documentos = suma(filas, (f) => f.documentos);
    const estudiantes = new Set(filas.map((f) => f.estudianteId)).size;
    const documentosSinCosto = suma(filas.filter((f) => f.costoUsd === 0), (f) => f.documentos);

    return {
      filtro: {
        periodoAcademico: filtro.periodoAcademico ?? null,
        desde: filtro.desde?.toISOString() ?? null,
        hasta: filtro.hasta?.toISOString() ?? null,
      },
      periodosDisponibles: periodos,
      totales: {
        costoUsd,
        documentos,
        estudiantes,
        tokensEntrada: suma(filas, (f) => f.tokensEntrada),
        tokensSalida: suma(filas, (f) => f.tokensSalida),
        costoPromedioDocumentoUsd: documentos > 0 ? redondear(costoUsd / documentos) : 0,
        costoPromedioEstudianteUsd: estudiantes > 0 ? redondear(costoUsd / estudiantes) : 0,
        documentosSinCosto,
      },
      gastoHoyUsd: redondear(suma(gastoHoy, (f) => f.costoUsd)),
      topeDiarioUsd,
      porModelo: this.agrupar(filas, (f) => f.modelo, (f) => `${f.modelo} (${f.proveedor})`),
      porTipo: this.agrupar(filas, (f) => f.tipo, (f) => this.conocimiento.nombreDe(f.tipo as TipoDocumento)),
      porModalidad: this.agrupar(filas, (f) => f.modalidad, (f) => etiquetaModalidad.get(f.modalidad) ?? f.modalidad),
      porPeriodo: this.agrupar(filas, (f) => f.periodoAcademico, (f) => f.periodoAcademico),
      porEstudiante: this.porEstudiante(filas, etiquetaModalidad),
    };
  }

  /** Alcance por escuelas, igual que en el resto de la API; `undefined` = institucional. */
  private alcance(actor?: Actor): readonly string[] | undefined {
    if (!actor) return undefined;
    if (actor.rol === Rol.COORDINADOR && actor.escuelas.length > 0) return actor.escuelas;
    if (actor.rol === Rol.TUTOR) return actor.escuelas.length > 0 ? actor.escuelas : ['__sin_escuela__'];
    return undefined;
  }

  /** Ajustes válidos: números finitos; las dimensiones y la respuesta no pueden ser cero. */
  private supuestos(ajustes: Partial<SupuestosEstimacion>): SupuestosEstimacion {
    const base = { ...SUPUESTOS_PREDETERMINADOS };
    const estrictamentePositivos: (keyof SupuestosEstimacion)[] = ['anchoPaginaPx', 'altoPaginaPx', 'tokensRespuesta'];
    for (const clave of Object.keys(base) as (keyof SupuestosEstimacion)[]) {
      const valor = ajustes[clave];
      if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) continue;
      if (valor === 0 && estrictamentePositivos.includes(clave)) continue;
      base[clave] = valor;
    }
    if (base.factorReenvios < 1) base.factorReenvios = 1;
    return base;
  }

  private agrupar(
    filas: FilaGastoIa[],
    clave: (f: FilaGastoIa) => string,
    etiqueta: (f: FilaGastoIa) => string,
  ): GastoPorClave[] {
    const grupos = new Map<string, GastoPorClave>();
    for (const f of filas) {
      const k = clave(f);
      const g = grupos.get(k) ?? {
        clave: k, etiqueta: etiqueta(f), documentos: 0, tokensEntrada: 0, tokensSalida: 0, costoUsd: 0,
      };
      g.documentos += f.documentos;
      g.tokensEntrada += f.tokensEntrada;
      g.tokensSalida += f.tokensSalida;
      g.costoUsd = redondear(g.costoUsd + f.costoUsd);
      grupos.set(k, g);
    }
    return [...grupos.values()].sort((a, b) => b.costoUsd - a.costoUsd || b.documentos - a.documentos);
  }

  private porEstudiante(filas: FilaGastoIa[], etiquetas: Map<string, string>): GastoPorEstudiante[] {
    const grupos = new Map<string, GastoPorEstudiante>();
    for (const f of filas) {
      const k = `${f.estudianteId}|${f.periodoAcademico}|${f.modalidad}`;
      const g = grupos.get(k) ?? {
        estudianteId: f.estudianteId, nombre: f.estudianteNombre,
        periodoAcademico: f.periodoAcademico, modalidad: f.modalidad,
        modalidadEtiqueta: etiquetas.get(f.modalidad) ?? f.modalidad,
        documentos: 0, tokensEntrada: 0, tokensSalida: 0, costoUsd: 0, ultimaLectura: f.ultimaLectura.toISOString(),
      };
      g.documentos += f.documentos;
      g.tokensEntrada += f.tokensEntrada;
      g.tokensSalida += f.tokensSalida;
      g.costoUsd = redondear(g.costoUsd + f.costoUsd);
      if (f.ultimaLectura.toISOString() > g.ultimaLectura) g.ultimaLectura = f.ultimaLectura.toISOString();
      grupos.set(k, g);
    }
    return [...grupos.values()].sort((a, b) => b.costoUsd - a.costoUsd || a.nombre.localeCompare(b.nombre));
  }
}

function suma<T>(filas: T[], valor: (f: T) => number): number {
  return filas.reduce((s, f) => s + valor(f), 0);
}

function redondear(valor: number): number {
  return Math.round(valor * 1e6) / 1e6;
}

