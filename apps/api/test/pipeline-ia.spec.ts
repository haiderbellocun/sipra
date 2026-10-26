import { operacionesAtomicasEnMemoria } from './soporte-concurrencia';
import { ConfigService } from '@nestjs/config';
import { ParametrosUseCase } from '../src/application/use-cases/administracion/parametros.use-case';
import {
  PipelineValidacionUseCase,
} from '../src/application/use-cases/documentos/pipeline-validacion.use-case';
import { camposDe } from '../src/domain/entities/campos-extraccion';
import {
  DatosDocumento, Documento, EstadoDocumento, SeveridadBandera, TipoDocumento,
} from '../src/domain/entities/documento.entity';
import {
  DocumentoRepositoryPort, PracticaRepositoryPort, SobrescrituraParametro, UsuarioRepositoryPort,
} from '../src/domain/ports/out/repositorios.port';
import {
  AlmacenamientoPort, CampoExtraido, CoherenciaCruzadaPort, ExtraccionIaPort, HallazgoCriterio,
  LectorCodigoBarrasPort, ResultadoExtraccion,
} from '../src/domain/ports/out/servicios-externos.port';
import { ImagenGris } from '../src/domain/services/hash-perceptual.domain-service';
import {
  DecodificadorImagenAdapter,
} from '../src/infrastructure/adapters/imagen/decodificador.adapter';

/**
 * Capa 2 del pipeline con lectura asistida real detrás: tope de gasto diario,
 * criterios del manual respondidos por el modelo, tipos que siempre revisa una
 * persona y el rastro (fecha, costo) que toda lectura deja aunque el documento
 * vuelva al estudiante.
 */

const decodificador = new DecodificadorImagenAdapter();

/** Documento inclinado, con margen y con sombra: el preproceso tiene algo que corregir. */
function imagenTorcida(ancho = 320, alto = 260): ImagenGris {
  const pixeles = new Uint8Array(ancho * alto).fill(240);
  const tangente = Math.tan((5 * Math.PI) / 180);
  for (let renglon = 0; renglon < 12; renglon += 1) {
    const yBase = 40 + Math.round((renglon * (alto - 80)) / 12);
    for (let x = 40; x < ancho - 40; x += 1) {
      const y = Math.round(yBase + (x - ancho / 2) * tangente);
      for (let g = 0; g < 4; g += 1) {
        if (y + g >= 0 && y + g < alto) pixeles[(y + g) * ancho + x] = 30;
      }
    }
  }
  for (let y = 0; y < alto; y += 1) {
    for (let x = 0; x < ancho; x += 1) {
      const i = y * ancho + x;
      pixeles[i] = Math.round(pixeles[i] * (1 - 0.5 * (x / ancho)));
    }
  }
  return { ancho, alto, pixeles };
}

const PNG = decodificador.codificarPng(imagenTorcida());

const COSTO_LECTURA = 0.00107;

/** Extracción «buena»: todos los campos del tipo con valor y confianza alta. */
function extraccionBuena(tipo: TipoDocumento, extra: Partial<ResultadoExtraccion> = {}): ResultadoExtraccion {
  const campos: Record<string, CampoExtraido> = {};
  for (const nombre of camposDe(tipo)) {
    campos[nombre] = { valor: `valor de ${nombre}`, confianza: 0.95, evidencia: `Fragmento con ${nombre}` };
  }
  return {
    tipoDetectado: tipo,
    campos,
    ilegible: false,
    modelo: 'gpt-6-luna-2026-09-22',
    tokensEntrada: 10_000,
    tokensSalida: 500,
    costoUsd: COSTO_LECTURA,
    hallazgos: [],
    motivoIlegible: null,
    resumen: 'Documento de prueba',
    proveedor: 'openai',
    ...extra,
  };
}

function hallazgo(parcial: Partial<HallazgoCriterio>): HallazgoCriterio {
  return {
    codigo: 'CRIT_1', enunciado: 'Identifica claramente al estudiante.', cumple: 'si',
    detalle: null, causalDevolucion: false, ...parcial,
  };
}

/** Extractor que cuenta llamadas y responde lo que se le programe. */
class ExtractorDePrueba implements ExtraccionIaPort {
  llamadas = 0;
  constructor(private readonly responder: (intento: number) => Promise<ResultadoExtraccion>) {}

  extraer(): Promise<ResultadoExtraccion> {
    this.llamadas += 1;
    return this.responder(this.llamadas);
  }
}

function sobrescritura(clave: string, valor: number): SobrescrituraParametro {
  return { clave, valor, motivo: 'prueba', actualizadoPor: 'admin-1', actualizadoEn: new Date() };
}

interface OpcionesArnes {
  tipo?: TipoDocumento;
  sobrescrituras?: SobrescrituraParametro[];
  /** Lo que devuelve `gastoIaDesde`: el gasto de hoy en USD. */
  gastoHoy?: number;
  /** Lo que devuelve `contarLecturasDesde`: lecturas de la práctica hoy. */
  lecturasHoy?: number;
  /** Variables de entorno que ve el pipeline (`AUTH_MODO`, `IA_TOPE_DIARIO_USD`); sin ellas no hay techo. */
  config?: Record<string, string | number>;
}

function configDe(valores: Record<string, string | number>): ConfigService {
  return { get: (clave: string) => valores[clave] } as unknown as ConfigService;
}

function datosDocumento(tipo: TipoDocumento): DatosDocumento {
  const ahora = new Date();
  return {
    id: 'doc-1', practicaId: 'p-1', tipo, version: 1,
    estado: EstadoDocumento.RECIBIDO, nombreOriginal: 'documento.png', mimeReal: 'image/png',
    tamanoBytes: PNG.length, hashSha256: 'a'.repeat(64), hashPerceptual: null,
    rutaAlmacenamiento: 'ruta/x', calidadCaptura: null, banderas: [], puntaje: null,
    banda: null, extraccion: null, decididoPor: null, justificacionDecision: null,
    motivoDevolucion: null, cargadoEn: ahora, actualizadoEn: ahora, purgarDespuesDe: null,
  };
}

/** Construye el pipeline con un extractor controlado, parámetros y gasto del día. */
function pipeline(extractor: ExtraccionIaPort, opciones: OpcionesArnes = {}): {
  uso: PipelineValidacionUseCase;
  guardado: () => DatosDocumento;
  consultasDeGasto: () => Date[];
  consultasDeLecturas: () => { practicaId: string; desde: Date }[];
} {
  let almacenado = datosDocumento(opciones.tipo ?? TipoDocumento.PLANILLA_HORAS);
  const consultas: Date[] = [];
  const consultasLecturas: { practicaId: string; desde: Date }[] = [];

  const documentos: DocumentoRepositoryPort = {
    buscarPorId: () => Promise.resolve(Documento.desde(almacenado)),
    listarPorPractica: () => Promise.resolve([]),
    contarPorHash: () => Promise.resolve(0),
    listarHashesPerceptuales: () => Promise.resolve([]),
    ultimaVersion: () => Promise.resolve(1),
    guardar: (datos) => {
      almacenado = datos;
      return Promise.resolve(Documento.desde(datos));
    },
    listarParaPurga: () => Promise.resolve([]),
    ...operacionesAtomicasEnMemoria(() => almacenado, (d) => { almacenado = d; }),
    gastoIaDesde: (desde) => {
      consultas.push(desde);
      return Promise.resolve(opciones.gastoHoy ?? 0);
    },
    contarLecturasDesde: (practicaId, desde) => {
      consultasLecturas.push({ practicaId, desde });
      return Promise.resolve(opciones.lecturasHoy ?? 0);
    },
  };

  const practicas = { buscarPorId: () => Promise.resolve(null) } as unknown as PracticaRepositoryPort;
  const usuarios = { buscarPorId: () => Promise.resolve(null) } as unknown as UsuarioRepositoryPort;
  const almacen = { leer: () => Promise.resolve(PNG) } as unknown as AlmacenamientoPort;
  const coherencia: CoherenciaCruzadaPort = { evaluar: () => Promise.resolve([]) };
  const lectorCodigos: LectorCodigoBarrasPort = {
    leerPdf417: () => Promise.resolve({ encontrado: false, formato: null, contenido: '' }),
  };
  const parametros = new ParametrosUseCase({
    listarSobrescrituras: () => Promise.resolve(opciones.sobrescrituras ?? []),
    guardar: () => Promise.resolve(),
    restaurar: () => Promise.resolve(),
  });

  return {
    uso: new PipelineValidacionUseCase(
      documentos, practicas, usuarios, almacen, extractor, coherencia, decodificador,
      lectorCodigos, parametros, opciones.config ? configDe(opciones.config) : undefined,
    ),
    guardado: () => almacenado,
    consultasDeGasto: () => consultas,
    consultasDeLecturas: () => consultasLecturas,
  };
}

function esIsoValido(valor: unknown): boolean {
  return typeof valor === 'string' && new Date(valor).toISOString() === valor;
}

describe('Capa 2 · extracción buena', () => {
  it('sin banderas el documento se aprueba solo y la lectura queda fechada', async () => {
    const extractor = new ExtractorDePrueba(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
    const { uso, guardado } = pipeline(extractor);
    await uso.ejecutar('doc-1');

    const datos = guardado();
    expect(datos.banderas).toEqual([]);
    expect(datos.puntaje).toBe(100);
    expect(datos.estado).toBe(EstadoDocumento.AUTO_APROBADO);
    expect(extractor.llamadas).toBe(1);

    expect(datos.extraccion).not.toBeNull();
    expect(esIsoValido(datos.extraccion!.leidoEn)).toBe(true);
    expect(datos.extraccion!.costoUsd).toBe(COSTO_LECTURA);
    expect(datos.extraccion!.proveedor).toBe('openai');
  });
});

describe('Capa 2 · lectura no disponible', () => {
  it('si el extractor falla, el documento va a revisión con bandera ALTA y sin extracción', async () => {
    const extractor = new ExtractorDePrueba(() => Promise.reject(new Error('OpenAI respondió 500: caído')));
    const { uso, guardado } = pipeline(extractor);
    await uso.ejecutar('doc-1');

    const datos = guardado();
    const bandera = datos.banderas.find((b) => b.codigo === 'C2_EXTRACCION_NO_DISPONIBLE');
    expect(bandera).toBeDefined();
    expect(bandera!.severidad).toBe(SeveridadBandera.ALTA);
    expect(bandera!.mensaje).toContain('OpenAI respondió 500');
    expect(datos.estado).toBe(EstadoDocumento.EN_REVISION);
    expect(datos.extraccion).toBeNull();
    // No se reintenta con preproceso: no hubo lectura ilegible, hubo falla.
    expect(extractor.llamadas).toBe(1);
  });
});

describe('Capa 2 · tope de gasto diario', () => {
  it('alcanzado el tope no se llama al proveedor y el documento va a revisión', async () => {
    const extractor = new ExtractorDePrueba(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
    const { uso, guardado, consultasDeGasto } = pipeline(extractor, {
      sobrescrituras: [sobrescritura('ia.tope_diario_usd', 1)], gastoHoy: 5,
    });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(0);
    const datos = guardado();
    const bandera = datos.banderas.find((b) => b.codigo === 'C2_TOPE_DIARIO_ALCANZADO');
    expect(bandera).toBeDefined();
    expect(bandera!.severidad).toBe(SeveridadBandera.ALTA);
    expect(bandera!.mensaje).toContain('5.00 USD');
    expect(datos.estado).toBe(EstadoDocumento.EN_REVISION);
    expect(datos.extraccion).toBeNull();
    // El gasto se consulta desde la medianoche de Colombia (05:00 UTC).
    expect(consultasDeGasto()).toHaveLength(1);
    expect(consultasDeGasto()[0].getUTCHours()).toBe(5);
    expect(consultasDeGasto()[0].getUTCMinutes()).toBe(0);
  });

  it('con tope en cero no hay tope: se lee aunque haya gasto', async () => {
    const extractor = new ExtractorDePrueba(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
    const { uso, guardado, consultasDeGasto } = pipeline(extractor, {
      sobrescrituras: [sobrescritura('ia.tope_diario_usd', 0)], gastoHoy: 5,
    });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(1);
    expect(consultasDeGasto()).toHaveLength(0);
    expect(guardado().banderas.some((b) => b.codigo === 'C2_TOPE_DIARIO_ALCANZADO')).toBe(false);
    expect(guardado().estado).toBe(EstadoDocumento.AUTO_APROBADO);
  });

  it('por debajo del tope se lee con normalidad', async () => {
    const extractor = new ExtractorDePrueba(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
    const { uso, guardado } = pipeline(extractor, {
      sobrescrituras: [sobrescritura('ia.tope_diario_usd', 1)], gastoHoy: 0.5,
    });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(1);
    expect(guardado().banderas.some((b) => b.codigo === 'C2_TOPE_DIARIO_ALCANZADO')).toBe(false);
    expect(guardado().estado).toBe(EstadoDocumento.AUTO_APROBADO);
  });

  it('con el tope de fábrica (50 USD) un gasto igual al tope lo alcanza', async () => {
    const extractor = new ExtractorDePrueba(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
    const { uso, guardado } = pipeline(extractor, { gastoHoy: 50 });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(0);
    expect(guardado().banderas.some((b) => b.codigo === 'C2_TOPE_DIARIO_ALCANZADO')).toBe(true);
  });
});

describe('Capa 2 · criterios del manual respondidos por el modelo', () => {
  it('un criterio respondido «no» manda a revisión con bandera ALTA por criterio', async () => {
    const extractor = new ExtractorDePrueba(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS, {
      hallazgos: [
        hallazgo({ codigo: 'CRIT_1', cumple: 'no', detalle: 'No aparece el nombre', causalDevolucion: false }),
        hallazgo({ codigo: 'CRIT_2', cumple: 'si' }),
      ],
    })));
    const { uso, guardado } = pipeline(extractor);
    await uso.ejecutar('doc-1');

    const datos = guardado();
    const bandera = datos.banderas.find((b) => b.codigo === 'C2_CRITERIO_CRIT_1');
    expect(bandera).toBeDefined();
    expect(bandera!.severidad).toBe(SeveridadBandera.ALTA);
    expect(bandera!.capa).toBe(2);
    expect(bandera!.mensaje).toContain('No aparece el nombre');
    // No es causal de devolución: al estudiante solo se le dice que está en revisión.
    expect(bandera!.mensajeUsuario).toBe('Su documento quedó en revisión del docente.');
    expect(datos.banderas.some((b) => b.codigo === 'C2_CRITERIO_CRIT_2')).toBe(false);
    expect(datos.puntaje).toBe(70);
    expect(datos.estado).toBe(EstadoDocumento.EN_REVISION);
  });

  it('una causal de devolución explícita le dice al estudiante qué revisar', async () => {
    const extractor = new ExtractorDePrueba(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS, {
      hallazgos: [hallazgo({
        codigo: 'NOACEPTA_2', cumple: 'no', detalle: 'Es un carné, no el certificado', causalDevolucion: true,
      })],
    })));
    const { uso, guardado } = pipeline(extractor);
    await uso.ejecutar('doc-1');

    const bandera = guardado().banderas.find((b) => b.codigo === 'C2_CRITERIO_NOACEPTA_2');
    expect(bandera).toBeDefined();
    expect(bandera!.mensajeUsuario).toBe('Revise su documento: Es un carné, no el certificado');
  });

  it('lo no determinable se anota como informativo y no impide la aprobación', async () => {
    const extractor = new ExtractorDePrueba(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS, {
      hallazgos: [
        hallazgo({ codigo: 'CRIT_1', cumple: 'no_determinable' }),
        hallazgo({ codigo: 'VIGENCIA', cumple: 'no_determinable' }),
        hallazgo({ codigo: 'CRIT_2', cumple: 'si' }),
      ],
    })));
    const { uso, guardado } = pipeline(extractor);
    await uso.ejecutar('doc-1');

    const datos = guardado();
    const informativas = datos.banderas.filter((b) => b.codigo === 'C2_CRITERIOS_NO_DETERMINABLES');
    expect(informativas).toHaveLength(1);
    expect(informativas[0].severidad).toBe(SeveridadBandera.INFORMATIVA);
    expect(informativas[0].mensaje).toContain('2 criterio(s)');
    expect(informativas[0].mensaje).toContain('CRIT_1, VIGENCIA');
    expect(datos.banderas.some((b) => b.codigo.startsWith('C2_CRITERIO_'))).toBe(false);
    expect(datos.puntaje).toBe(98);
    expect(datos.estado).toBe(EstadoDocumento.AUTO_APROBADO);
  });
});

describe('Capa 2 · tipos que siempre revisa una persona', () => {
  it('un informe sin campos de extracción va a revisión aunque la lectura venga limpia', async () => {
    expect(camposDe(TipoDocumento.INFORME_1)).toHaveLength(0);
    const extractor = new ExtractorDePrueba(() => Promise.resolve(extraccionBuena(TipoDocumento.INFORME_1, {
      hallazgos: [hallazgo({ codigo: 'CRIT_1', cumple: 'si' })],
    })));
    const { uso, guardado } = pipeline(extractor, { tipo: TipoDocumento.INFORME_1 });
    await uso.ejecutar('doc-1');

    const datos = guardado();
    const bandera = datos.banderas.find((b) => b.codigo === 'C2_REVISION_HUMANA_OBLIGATORIA');
    expect(bandera).toBeDefined();
    expect(bandera!.severidad).toBe(SeveridadBandera.ALTA);
    expect(datos.estado).toBe(EstadoDocumento.EN_REVISION);
    // La lectura se conserva para orientar al revisor.
    expect(datos.extraccion).not.toBeNull();
    expect(datos.extraccion!.resumen).toBe('Documento de prueba');
  });
});

describe('Capa 2 · ilegible', () => {
  it('conserva la lectura (fecha y costo) y explica el motivo al estudiante', async () => {
    const extractor = new ExtractorDePrueba(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS, {
      ilegible: true, motivoIlegible: 'página en blanco', campos: {},
    })));
    const { uso, guardado } = pipeline(extractor);
    await uso.ejecutar('doc-1');

    // Primer intento y segundo intento sobre la copia preprocesada: ambos ilegibles.
    expect(extractor.llamadas).toBe(2);

    const datos = guardado();
    expect(datos.estado).toBe(EstadoDocumento.ILEGIBLE);
    expect(datos.motivoDevolucion).toContain('página en blanco');
    expect(datos.motivoDevolucion).toMatch(/buena luz|enfocado/);
    expect(datos.banderas.some((b) => b.codigo === 'C2_LEGIBLE_TRAS_PREPROCESO')).toBe(false);

    expect(datos.extraccion).not.toBeNull();
    expect(datos.extraccion!.ilegible).toBe(true);
    expect(esIsoValido(datos.extraccion!.leidoEn)).toBe(true);
    // Las dos lecturas (original y copia preprocesada) costaron: el gasto se acumula.
    expect(datos.extraccion!.costoUsd).toBeCloseTo(COSTO_LECTURA * 2, 6);
    expect(datos.extraccion!.intentos).toBe(2);
    expect(datos.extraccion!.motivoIlegible).toBe('página en blanco');
  });

  it('sin motivo del modelo, el mensaje al estudiante no queda con un «Lo que se detectó» vacío', async () => {
    const extractor = new ExtractorDePrueba(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS, {
      ilegible: true, motivoIlegible: '   ', campos: {},
    })));
    const { uso, guardado } = pipeline(extractor);
    await uso.ejecutar('doc-1');

    expect(guardado().estado).toBe(EstadoDocumento.ILEGIBLE);
    expect(guardado().motivoDevolucion).not.toContain('Lo que se detectó');
  });
});

describe('Capa 2 · techo del tope diario en el ambiente abierto', () => {
  const lector = () => new ExtractorDePrueba(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
  const banderaTope = (datos: DatosDocumento) => datos.banderas.find((b) => b.codigo === 'C2_TOPE_DIARIO_ALCANZADO');

  it('en AUTH_MODO=abierto el tope nunca supera IA_TOPE_DIARIO_USD aunque el parámetro sea mayor', async () => {
    const extractor = lector();
    const { uso, guardado } = pipeline(extractor, {
      sobrescrituras: [sobrescritura('ia.tope_diario_usd', 5000)], gastoHoy: 60,
      config: { AUTH_MODO: 'abierto', IA_TOPE_DIARIO_USD: 50 },
    });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(0);
    const datos = guardado();
    const bandera = banderaTope(datos);
    expect(bandera).toBeDefined();
    expect(bandera!.severidad).toBe(SeveridadBandera.ALTA);
    expect(bandera!.mensaje).toContain('60.00 USD');
    expect(bandera!.mensaje).toContain('(50 USD)');
    expect(datos.estado).toBe(EstadoDocumento.EN_REVISION);
    expect(datos.extraccion).toBeNull();
  });

  it('el techo también vale cuando el entorno lo entrega como texto', async () => {
    const extractor = lector();
    const { uso, guardado } = pipeline(extractor, {
      sobrescrituras: [sobrescritura('ia.tope_diario_usd', 5000)], gastoHoy: 60,
      config: { AUTH_MODO: 'abierto', IA_TOPE_DIARIO_USD: '50' },
    });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(0);
    expect(banderaTope(guardado())).toBeDefined();
  });

  it('sin IA_TOPE_DIARIO_USD en el entorno, el techo de fábrica es 50 USD', async () => {
    const extractor = lector();
    const { uso, guardado } = pipeline(extractor, {
      sobrescrituras: [sobrescritura('ia.tope_diario_usd', 5000)], gastoHoy: 60, config: { AUTH_MODO: 'abierto' },
    });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(0);
    expect(banderaTope(guardado())!.mensaje).toContain('(50 USD)');
  });

  it('en abierto, si el parámetro está por debajo del techo manda el parámetro', async () => {
    const extractor = lector();
    const { uso, guardado } = pipeline(extractor, {
      sobrescrituras: [sobrescritura('ia.tope_diario_usd', 10)], gastoHoy: 20,
      config: { AUTH_MODO: 'abierto', IA_TOPE_DIARIO_USD: 50 },
    });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(0);
    expect(banderaTope(guardado())!.mensaje).toContain('(10 USD)');
  });

  it('en abierto, poner el parámetro en cero no desactiva el techo', async () => {
    const extractor = lector();
    const { uso, guardado } = pipeline(extractor, {
      sobrescrituras: [sobrescritura('ia.tope_diario_usd', 0)], gastoHoy: 60,
      config: { AUTH_MODO: 'abierto', IA_TOPE_DIARIO_USD: 50 },
    });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(0);
    expect(banderaTope(guardado())!.mensaje).toContain('(50 USD)');
  });

  it('por debajo del techo se lee con normalidad', async () => {
    const extractor = lector();
    const { uso, guardado } = pipeline(extractor, {
      sobrescrituras: [sobrescritura('ia.tope_diario_usd', 5000)], gastoHoy: 49.99,
      config: { AUTH_MODO: 'abierto', IA_TOPE_DIARIO_USD: 50 },
    });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(1);
    expect(banderaTope(guardado())).toBeUndefined();
    expect(guardado().estado).toBe(EstadoDocumento.AUTO_APROBADO);
  });

  it('un techo que no es un número positivo deja mandar al parámetro', async () => {
    for (const techo of ['cincuenta', 0, -5]) {
      const extractor = lector();
      const { uso, guardado } = pipeline(extractor, {
        sobrescrituras: [sobrescritura('ia.tope_diario_usd', 5000)], gastoHoy: 60,
        config: { AUTH_MODO: 'abierto', IA_TOPE_DIARIO_USD: techo },
      });
      await uso.ejecutar('doc-1');

      expect(extractor.llamadas).toBe(1);
      expect(banderaTope(guardado())).toBeUndefined();
    }
  });

  it('en AUTH_MODO=oidc manda el parámetro: el techo de despliegue no aplica', async () => {
    const extractor = lector();
    const { uso, guardado } = pipeline(extractor, {
      sobrescrituras: [sobrescritura('ia.tope_diario_usd', 5000)], gastoHoy: 60,
      config: { AUTH_MODO: 'oidc', IA_TOPE_DIARIO_USD: 50 },
    });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(1);
    expect(banderaTope(guardado())).toBeUndefined();
  });

  it('sin configuración de entorno manda el parámetro', async () => {
    const extractor = lector();
    const { uso, guardado } = pipeline(extractor, {
      sobrescrituras: [sobrescritura('ia.tope_diario_usd', 5000)], gastoHoy: 60,
    });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(1);
    expect(banderaTope(guardado())).toBeUndefined();
  });
});

describe('Capa 2 · límite de lecturas por práctica y día', () => {
  const lector = () => new ExtractorDePrueba(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS)));
  const banderaLimite = (datos: DatosDocumento) => datos.banderas.find((b) => b.codigo === 'C2_LIMITE_LECTURAS_PRACTICA');

  it('alcanzado el límite de fábrica (40) no se llama al proveedor y el documento va a revisión', async () => {
    const extractor = lector();
    const { uso, guardado, consultasDeLecturas } = pipeline(extractor, { lecturasHoy: 40 });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(0);
    const datos = guardado();
    const bandera = banderaLimite(datos);
    expect(bandera).toBeDefined();
    expect(bandera!.severidad).toBe(SeveridadBandera.ALTA);
    expect(bandera!.capa).toBe(2);
    expect(bandera!.mensaje).toContain('(40)');
    expect(bandera!.mensajeUsuario).toBe('Su documento quedó en revisión del docente.');
    expect(datos.estado).toBe(EstadoDocumento.EN_REVISION);
    expect(datos.extraccion).toBeNull();

    // Se cuentan las lecturas de ESA práctica desde la medianoche de Colombia.
    expect(consultasDeLecturas()).toHaveLength(1);
    expect(consultasDeLecturas()[0].practicaId).toBe('p-1');
    expect(consultasDeLecturas()[0].desde.getUTCHours()).toBe(5);
    expect(consultasDeLecturas()[0].desde.getUTCMinutes()).toBe(0);
  });

  it('por debajo del límite se lee con normalidad', async () => {
    const extractor = lector();
    const { uso, guardado } = pipeline(extractor, { lecturasHoy: 39 });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(1);
    expect(banderaLimite(guardado())).toBeUndefined();
    expect(guardado().estado).toBe(EstadoDocumento.AUTO_APROBADO);
  });

  it('el límite se ajusta con el parámetro operativo', async () => {
    const extractor = lector();
    const { uso, guardado } = pipeline(extractor, {
      sobrescrituras: [sobrescritura('ia.lecturas_por_practica_dia', 5)], lecturasHoy: 5,
    });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(0);
    expect(banderaLimite(guardado())!.mensaje).toContain('(5)');
  });

  it('con el parámetro en cero no hay límite y ni siquiera se cuentan las lecturas', async () => {
    const extractor = lector();
    const { uso, guardado, consultasDeLecturas } = pipeline(extractor, {
      sobrescrituras: [sobrescritura('ia.lecturas_por_practica_dia', 0)], lecturasHoy: 1_000,
    });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(1);
    expect(consultasDeLecturas()).toHaveLength(0);
    expect(banderaLimite(guardado())).toBeUndefined();
    expect(guardado().estado).toBe(EstadoDocumento.AUTO_APROBADO);
  });

  it('el tope diario tiene prioridad: si ambos se alcanzan, la bandera es la del tope', async () => {
    const extractor = lector();
    const { uso, guardado, consultasDeLecturas } = pipeline(extractor, { gastoHoy: 50, lecturasHoy: 100 });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(0);
    const datos = guardado();
    expect(datos.banderas.some((b) => b.codigo === 'C2_TOPE_DIARIO_ALCANZADO')).toBe(true);
    expect(banderaLimite(datos)).toBeUndefined();
    // Alcanzado el tope no hace falta contar lecturas de la práctica.
    expect(consultasDeLecturas()).toHaveLength(0);
    expect(datos.estado).toBe(EstadoDocumento.EN_REVISION);
  });

  it('una lectura ilegible con reintento tras preproceso cuenta como una sola decisión de límite', async () => {
    // El límite se evalúa una vez por documento, antes de la primera lectura: el
    // segundo intento (copia preprocesada) no vuelve a consultar.
    const extractor = new ExtractorDePrueba(() => Promise.resolve(extraccionBuena(TipoDocumento.PLANILLA_HORAS, {
      ilegible: true, motivoIlegible: 'borroso', campos: {},
    })));
    const { uso, consultasDeLecturas } = pipeline(extractor, { lecturasHoy: 39 });
    await uso.ejecutar('doc-1');

    expect(extractor.llamadas).toBe(2);
    expect(consultasDeLecturas()).toHaveLength(1);
  });
});
