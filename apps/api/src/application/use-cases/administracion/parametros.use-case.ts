import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CATALOGO_PARAMETROS, DefinicionParametro, NaturalezaParametro, ValorParametro,
  definicionDe, validarCambio, validarCoherenciaUmbrales,
} from '../../../domain/entities/parametro.entity';
import {
  PARAMETRO_REPOSITORY, ParametroRepositoryPort, SobrescrituraParametro,
} from '../../../domain/ports/out/repositorios.port';

/** Vista de un parámetro con todo lo que hace falta para decidir sobre él. */
export interface ParametroVigente {
  clave: string;
  etiqueta: string;
  descripcion: string;
  tipo: string;
  naturaleza: NaturalezaParametro;
  unidad?: string;
  norma?: string;
  minimo?: number;
  maximo?: number;
  valor: ValorParametro;
  valorPorDefecto: ValorParametro;
  personalizado: boolean;
  motivo?: string;
  actualizadoEn?: Date;
}

export interface CambioParametro {
  clave: string;
  valor: unknown;
  motivo: string;
  actorId: string;
}

/**
 * M12 — Lectura y cambio de parámetros operativos.
 *
 * Se consulta en cada validación de documento y en cada cálculo de señal, así
 * que no puede costar una consulta a la base cada vez; se mantiene un mapa en
 * memoria que se refresca por tiempo y se invalida al escribir. El desfase
 * máximo es la ventana de refresco, y es aceptable: son umbrales de operación,
 * no saldos.
 */
@Injectable()
export class ParametrosUseCase {
  private readonly log = new Logger(ParametrosUseCase.name);
  private static readonly VENTANA_MS = 30_000;

  private cache = new Map<string, SobrescrituraParametro>();
  private leidoEn = 0;
  private cargando: Promise<void> | null = null;

  constructor(
    @Inject(PARAMETRO_REPOSITORY) private readonly repo: ParametroRepositoryPort,
  ) {}

  /** Fuerza la próxima lectura contra la base. */
  invalidar(): void {
    this.leidoEn = 0;
  }

  private async refrescar(): Promise<void> {
    if (Date.now() - this.leidoEn < ParametrosUseCase.VENTANA_MS) return;
    // Varias peticiones simultáneas comparten una sola consulta.
    this.cargando ??= (async () => {
      try {
        const filas = await this.repo.listarSobrescrituras();
        this.cache = new Map(filas.map((f) => [f.clave, f]));
        this.leidoEn = Date.now();
      } finally {
        this.cargando = null;
      }
    })();
    await this.cargando;
  }

  /**
   * Valor vigente de un parámetro. Si la base no responde se sigue con el
   * último valor conocido —o con el de fábrica—: un umbral desactualizado por
   * treinta segundos es preferible a una validación que no ocurre.
   */
  async valor(clave: string): Promise<ValorParametro> {
    const definicion = definicionDe(clave);
    try {
      await this.refrescar();
    } catch (error) {
      this.log.warn(
        `No fue posible releer los parámetros (${(error as Error).message}); ` +
          'se continúa con los últimos valores conocidos.',
      );
    }
    return this.cache.get(clave)?.valor ?? definicion.valorPorDefecto;
  }

  async booleano(clave: string): Promise<boolean> {
    return (await this.valor(clave)) === true;
  }

  async numero(clave: string): Promise<number> {
    const v = await this.valor(clave);
    return typeof v === 'number' ? v : Number(v);
  }

  /** Los dos umbrales del pipeline se leen juntos: su relación importa. */
  async umbralesPipeline(): Promise<{ verde: number; amarillo: number }> {
    return {
      verde: await this.numero('pipeline.umbral_verde'),
      amarillo: await this.numero('pipeline.umbral_amarillo'),
    };
  }

  async listar(): Promise<ParametroVigente[]> {
    await this.refrescar();
    return CATALOGO_PARAMETROS.map((d) => this.vista(d));
  }

  private vista(d: DefinicionParametro): ParametroVigente {
    const s = this.cache.get(d.clave);
    return {
      clave: d.clave,
      etiqueta: d.etiqueta,
      descripcion: d.descripcion,
      tipo: d.tipo,
      naturaleza: d.naturaleza,
      unidad: d.unidad,
      norma: d.norma,
      minimo: d.minimo,
      maximo: d.maximo,
      valor: s?.valor ?? d.valorPorDefecto,
      valorPorDefecto: d.valorPorDefecto,
      personalizado: s !== undefined,
      motivo: s?.motivo,
      actualizadoEn: s?.actualizadoEn,
    };
  }

  /**
   * Aplica un cambio. Devuelve el valor anterior y el nuevo para que quien
   * llama lo registre en auditoría: un umbral movido sin rastro de quién,
   * cuándo y por qué es indefendible ante una revisión.
   */
  async cambiar(c: CambioParametro): Promise<{ anterior: ValorParametro; nuevo: ValorParametro }> {
    const valor = validarCambio(c.clave, c.valor);

    // Los umbrales del pipeline se comprueban contra su pareja vigente, no
    // aislados: por separado ambos pueden ser válidos y juntos dejar sin
    // efecto la banda de revisión humana.
    if (c.clave === 'pipeline.umbral_verde') {
      validarCoherenciaUmbrales(valor as number, await this.numero('pipeline.umbral_amarillo'));
    } else if (c.clave === 'pipeline.umbral_amarillo') {
      validarCoherenciaUmbrales(await this.numero('pipeline.umbral_verde'), valor as number);
    }

    const anterior = await this.valor(c.clave);
    await this.repo.guardar({
      clave: c.clave, valor, motivo: c.motivo.trim(), actualizadoPor: c.actorId,
    });
    this.invalidar();
    this.log.log(`Parámetro ${c.clave}: ${String(anterior)} → ${String(valor)}`);
    return { anterior, nuevo: valor };
  }

  async restaurar(clave: string): Promise<{ anterior: ValorParametro; nuevo: ValorParametro }> {
    const definicion = definicionDe(clave);
    if (definicion.naturaleza === NaturalezaParametro.NORMATIVO) {
      // Nunca estuvo cambiado, así que restaurarlo no significa nada.
      return { anterior: definicion.valorPorDefecto, nuevo: definicion.valorPorDefecto };
    }
    const anterior = await this.valor(clave);
    await this.repo.restaurar(clave);
    this.invalidar();
    return { anterior, nuevo: definicion.valorPorDefecto };
  }
}
