import { ConfigService } from '@nestjs/config';
import {
  CostosIaUseCase, inicioDelDiaEnColombia,
} from '../src/application/use-cases/administracion/costos-ia.use-case';
import { ParametrosUseCase } from '../src/application/use-cases/administracion/parametros.use-case';
import { Actor } from '../src/application/use-cases/practicas/gestionar-practica.use-case';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { MATRIZ_MODALIDADES, documentosExigidos } from '../src/domain/entities/modalidad.entity';
import {
  TARIFAS_IA, VIGENCIA_TARIFAS, costoDe, tarifaDe, tokensImagen,
} from '../src/domain/entities/tarifas-ia';
import {
  CostosIaRepositoryPort, FilaGastoIa, FiltroGastoIa,
} from '../src/domain/ports/out/repositorios.port';
import {
  ConocimientoDocumentalDomainService,
} from '../src/domain/services/conocimiento-documental.domain-service';
import {
  CostosIaDomainService, SUPUESTOS_PREDETERMINADOS,
} from '../src/domain/services/costos-ia.domain-service';
import { esquemaLectura, tokensEsquemaAproximados } from '../src/domain/services/esquema-lectura';
import { Rol } from '../src/domain/value-objects/rol.vo';

/**
 * El costo de la lectura asistida se calcula, no se adivina: tarifa vigente,
 * regla de tokens por imagen del proveedor y matriz documental por modalidad.
 * Estas pruebas fijan la aritmética con los valores publicados y la agregación
 * del gasto real que muestra la página «Costos de IA».
 */

function tarifa(id: string) {
  const resuelta = tarifaDe(id);
  if (!resuelta) throw new Error(`Sin tarifa para ${id}`);
  return resuelta.tarifa;
}

describe('Tarifas de IA · resolución y costo', () => {
  it('resuelve una tarifa exacta por identificador', () => {
    const resuelta = tarifaDe('gpt-6-luna');
    expect(resuelta).not.toBeNull();
    expect(resuelta!.exacta).toBe(true);
    expect(resuelta!.tarifa).toMatchObject({
      id: 'gpt-6-luna', proveedor: 'openai', entradaUsdPorMillon: 0.1,
      entradaCacheUsdPorMillon: 0.01, salidaUsdPorMillon: 0.5, factorEscrituraCache: 1.25, razonador: true,
    });
  });

  it('un identificador con fecha se resuelve al modelo base, marcado como no exacto', () => {
    const resuelta = tarifaDe('gpt-6-luna-2026-09-22');
    expect(resuelta).not.toBeNull();
    expect(resuelta!.tarifa.id).toBe('gpt-6-luna');
    expect(resuelta!.exacta).toBe(false);
  });

  it('entre varios prefijos gana el más largo', () => {
    expect(tarifaDe('gpt-5.4-mini-2026-05-01')!.tarifa.id).toBe('gpt-5.4-mini');
    expect(tarifaDe('GPT-5.6-Terra')!.tarifa.id).toBe('gpt-5.6-terra');
  });

  it('un modelo que no está en la tabla devuelve null', () => {
    expect(tarifaDe('modelo-inexistente')).toBeNull();
  });

  it('cobra la escritura en caché con el recargo del modelo', () => {
    const luna = tarifa('gpt-6-luna');
    const sinEscritura = costoDe(luna, { entrada: 10_000, salida: 500 });
    const conEscritura = costoDe(luna, { entrada: 10_000, salida: 500, escrituraCache: 4_000 });
    // 10 000 × 0,10 + 500 × 0,50 = 1 250 → 0,00125 USD.
    expect(sinEscritura).toBeCloseTo(0.00125, 6);
    // 6 000 × 0,10 + 4 000 × 0,10 × 1,25 + 500 × 0,50 = 1 350 → 0,00135 USD.
    expect(conEscritura).toBeCloseTo(0.00135, 6);
    expect(conEscritura).toBeGreaterThan(sinEscritura);
  });

  it('la lectura desde caché cuesta la tarifa de caché', () => {
    const luna = tarifa('gpt-6-luna');
    // 8 000 × 0,10 + 2 000 × 0,01 + 500 × 0,50 = 1 070 → 0,00107 USD.
    expect(costoDe(luna, { entrada: 10_000, salida: 500, cache: 2_000, escrituraCache: 0 })).toBeCloseTo(0.00107, 6);
  });

  it('nunca produce un costo negativo', () => {
    const luna = tarifa('gpt-6-luna');
    expect(costoDe(luna, { entrada: -5, salida: -5, cache: -3, escrituraCache: -1 })).toBe(0);
    expect(costoDe(luna, { entrada: 100, salida: 0, cache: 5_000 })).toBeGreaterThanOrEqual(0);
  });
});

describe('Tarifas de IA · tokens por imagen', () => {
  it('parches de 32 px con multiplicador 1,2 y tope de 2 500', () => {
    const astra = tarifa('gpt-6-astra');
    // 32 × 32 = 1 024 parches × 1,2 = 1 228,8 → 1 229.
    expect(tokensImagen(astra, 1024, 1024)).toBe(1229);
    // 64 × 64 = 4 096 parches supera el tope: 2 500 × 1,2 = 3 000.
    expect(tokensImagen(astra, 2048, 2048)).toBe(3000);
  });

  it('mosaicos de 512 px para una página carta a 200 ppp', () => {
    // Encaja en 2 048, lado corto a 768: 2 × 2 mosaicos.
    expect(tokensImagen(tarifa('gpt-4.1'), 1700, 2200)).toBe(85 + 4 * 170);
    expect(tokensImagen(tarifa('gpt-4o-mini'), 1700, 2200)).toBe(2833 + 4 * 5667);
  });
});

describe('Estimador de costo por estudiante', () => {
  const estimador = new CostosIaDomainService();

  it('cubre todas las modalidades de la matriz con sus documentos exigidos', () => {
    const estimacion = estimador.estimarPorEstudiante('gpt-6-luna');
    expect(estimacion).not.toBeNull();
    const { modalidades } = estimacion!;

    expect(modalidades.map((m) => m.modalidad)).toEqual(MATRIZ_MODALIDADES.map((d) => d.modalidad));
    for (const m of modalidades) {
      expect(m.totalDocumentos).toBe(documentosExigidos(m.modalidad).length);
      expect(m.documentos).toHaveLength(m.totalDocumentos);
      expect(m.costoUsd).toBeGreaterThan(0);
      expect(m.costoConReenviosUsd).toBeGreaterThan(0);
      // Redondeado a seis decimales: la comparación tolera el último dígito.
      expect(m.costoConReenviosUsd).toBeCloseTo(m.costoUsd * 1.25, 5);
      for (const d of m.documentos) {
        expect(d.costoUsd).toBeGreaterThan(0);
        expect(d.tokensEntrada).toBeGreaterThan(d.paginas * estimacion!.tokensImagenPorPagina);
      }
    }
  });

  it('el promedio queda entre el mínimo y el máximo y escala a mil estudiantes', () => {
    const estimacion = estimador.estimarPorEstudiante('gpt-6-luna')!;
    expect(estimacion.tarifaExacta).toBe(true);
    expect(estimacion.promedioEstudianteUsd).toBeGreaterThanOrEqual(estimacion.minimoEstudianteUsd);
    expect(estimacion.promedioEstudianteUsd).toBeLessThanOrEqual(estimacion.maximoEstudianteUsd);
    expect(estimacion.porMilEstudiantesUsd).toBeCloseTo(estimacion.promedioEstudianteUsd * 1000, 2);
    expect(estimacion.supuestos).toEqual(SUPUESTOS_PREDETERMINADOS);
  });

  it('un modelo sin tarifa no se estima', () => {
    expect(estimador.estimarPorEstudiante('modelo-inexistente')).toBeNull();
  });

  it('la comparativa va de menor a mayor costo y cubre los modelos de OpenAI', () => {
    const comparativa = estimador.comparativa();
    const openai = TARIFAS_IA.filter((t) => t.proveedor === 'openai');
    expect(comparativa).toHaveLength(openai.length);
    // Primero los recomendables (sin retiro anunciado), del más barato al más
    // caro; después el resto, también por costo. gpt-5-nano es más barato que
    // Luna, pero se apaga en diciembre de 2026: va al final.
    const grupo = (c: { recomendacion: string; retiro: string | null }) =>
      (c.recomendacion === 'no_recomendado' || c.retiro ? 1 : 0);
    for (let i = 1; i < comparativa.length; i += 1) {
      expect(grupo(comparativa[i])).toBeGreaterThanOrEqual(grupo(comparativa[i - 1]));
      if (grupo(comparativa[i]) === grupo(comparativa[i - 1])) {
        expect(comparativa[i].promedioEstudianteUsd).toBeGreaterThanOrEqual(comparativa[i - 1].promedioEstudianteUsd);
      }
    }
    expect(comparativa[0].modelo).toBe('gpt-6-luna');
    expect(comparativa.find((c) => c.modelo === 'gpt-5-nano')!.promedioEstudianteUsd)
      .toBeLessThan(comparativa[0].promedioEstudianteUsd);
    expect(comparativa.find((c) => c.modelo === 'gpt-6-luna')!.recomendacion).toBe('principal');
  });
});

// ── Caso de uso: gasto real agregado ────────────────────────────────────────

const PERIODO = '2026-2';

function fila(parcial: Partial<FilaGastoIa>): FilaGastoIa {
  return {
    periodoAcademico: PERIODO, modalidad: 'pasantia',
    estudianteId: 'est-1', estudianteNombre: 'Ana Pérez',
    tipo: 'certificado_eps', modelo: 'gpt-6-luna', proveedor: 'openai',
    documentos: 1, tokensEntrada: 10_000, tokensSalida: 500, costoUsd: 0.001,
    ultimaLectura: new Date('2026-10-08T10:00:00Z'),
    ...parcial,
  };
}

const FILAS: FilaGastoIa[] = [
  fila({
    estudianteId: 'est-1', estudianteNombre: 'Ana Pérez', modelo: 'gpt-6-luna', tipo: 'certificado_eps',
    documentos: 3, tokensEntrada: 30_000, tokensSalida: 1_500, costoUsd: 0.0032,
    ultimaLectura: new Date('2026-10-08T10:00:00Z'),
  }),
  fila({
    estudianteId: 'est-1', estudianteNombre: 'Ana Pérez', modelo: 'gpt-5.6-terra', tipo: 'acta_inicio',
    documentos: 1, tokensEntrada: 12_000, tokensSalida: 600, costoUsd: 0.0312,
    ultimaLectura: new Date('2026-10-09T09:00:00Z'),
  }),
  fila({
    estudianteId: 'est-2', estudianteNombre: 'Bruno Gómez', modalidad: 'monitoria',
    modelo: 'gpt-6-luna', tipo: 'certificado_arl',
    documentos: 2, tokensEntrada: 20_000, tokensSalida: 1_000, costoUsd: 0.0025,
    ultimaLectura: new Date('2026-10-07T15:00:00Z'),
  }),
];

const FILA_HOY = fila({ estudianteId: 'est-9', estudianteNombre: 'Hoy', documentos: 1, costoUsd: 0.0007 });

class RepositorioCostosFalso implements CostosIaRepositoryPort {
  filtros: FiltroGastoIa[] = [];
  /** Con qué alcance se pidieron los periodos (undefined = institucional). */
  alcancesDePeriodos: (readonly string[] | undefined)[] = [];

  gastoAgrupado(filtro: FiltroGastoIa): Promise<FilaGastoIa[]> {
    this.filtros.push(filtro);
    // La consulta del periodo devuelve el gasto del periodo; la del día, una fila.
    return Promise.resolve(filtro.periodoAcademico === PERIODO ? FILAS : [FILA_HOY]);
  }

  periodosConGasto(escuelaIds?: readonly string[]): Promise<string[]> {
    this.alcancesDePeriodos.push(escuelaIds);
    return Promise.resolve([PERIODO]);
  }

  /** La consulta del periodo pedido y la del gasto de hoy, por separado. */
  consultas(): { periodo: FiltroGastoIa; hoy: FiltroGastoIa } {
    const periodo = this.filtros.find((f) => f.periodoAcademico === PERIODO);
    const hoy = this.filtros.find((f) => f.periodoAcademico === undefined && f.desde);
    if (!periodo || !hoy) throw new Error('Faltan consultas al repositorio');
    return { periodo, hoy };
  }
}

function actorDe(rol: Rol, escuelas: readonly string[] = []): Actor {
  return { id: 'u-1', correo: 'usuario@cun.edu.co', rol, permiso: 'consulta', escuelas, empresaId: null };
}

function parametrosDeFabrica(): ParametrosUseCase {
  return new ParametrosUseCase({
    listarSobrescrituras: () => Promise.resolve([]),
    guardar: () => Promise.resolve(),
    restaurar: () => Promise.resolve(),
  });
}

function configDe(valores: Record<string, string>): ConfigService {
  return { get: (clave: string) => valores[clave] } as unknown as ConfigService;
}

describe('CostosIaUseCase · resumen del gasto real', () => {
  let repositorio: RepositorioCostosFalso;
  let caso: CostosIaUseCase;

  beforeEach(() => {
    repositorio = new RepositorioCostosFalso();
    caso = new CostosIaUseCase(repositorio, parametrosDeFabrica(), configDe({ OPENAI_MODELO: 'gpt-6-luna' }));
  });

  it('suma costo y documentos, cuenta estudiantes y promedia', async () => {
    const resumen = await caso.resumen({ periodoAcademico: PERIODO });

    expect(resumen.totales.costoUsd).toBeCloseTo(0.0369, 6);
    expect(resumen.totales.documentos).toBe(6);
    expect(resumen.totales.estudiantes).toBe(2);
    expect(resumen.totales.tokensEntrada).toBe(62_000);
    expect(resumen.totales.tokensSalida).toBe(3_100);
    expect(resumen.totales.costoPromedioEstudianteUsd).toBeCloseTo(0.0369 / 2, 6);
    expect(resumen.totales.costoPromedioDocumentoUsd).toBeCloseTo(0.0369 / 6, 6);
    expect(resumen.totales.documentosSinCosto).toBe(0);
    expect(resumen.periodosDisponibles).toEqual([PERIODO]);
    expect(resumen.filtro).toEqual({ periodoAcademico: PERIODO, desde: null, hasta: null });
  });

  it('ordena los estudiantes por costo descendente y conserva la última lectura', async () => {
    const { porEstudiante } = await caso.resumen({ periodoAcademico: PERIODO });

    expect(porEstudiante.map((e) => e.estudianteId)).toEqual(['est-1', 'est-2']);
    expect(porEstudiante[0].costoUsd).toBeCloseTo(0.0344, 6);
    expect(porEstudiante[0].documentos).toBe(4);
    expect(porEstudiante[0].ultimaLectura).toBe('2026-10-09T09:00:00.000Z');
    expect(porEstudiante[0].modalidadEtiqueta).toBe('Pasantía');
    // La cédula no viaja a la página de costos: el nombre y el identificador bastan.
    expect('documento' in porEstudiante[1]).toBe(false);
    expect(porEstudiante[1].modalidadEtiqueta).toBe('Monitoría');
  });

  it('agrupa por modelo, tipo, modalidad y periodo', async () => {
    const resumen = await caso.resumen({ periodoAcademico: PERIODO });

    expect(resumen.porModelo).toHaveLength(2);
    expect(resumen.porModelo[0]).toMatchObject({ clave: 'gpt-5.6-terra', etiqueta: 'gpt-5.6-terra (openai)', documentos: 1 });
    expect(resumen.porModelo[1]).toMatchObject({ clave: 'gpt-6-luna', documentos: 5 });
    expect(resumen.porModelo[1].costoUsd).toBeCloseTo(0.0057, 6);

    expect(resumen.porTipo.map((t) => t.clave)).toEqual(['acta_inicio', 'certificado_eps', 'certificado_arl']);
    expect(resumen.porTipo[0].etiqueta).toBe('Acta de inicio');
    expect(resumen.porModalidad).toHaveLength(2);
    expect(resumen.porPeriodo).toEqual([
      { clave: PERIODO, etiqueta: PERIODO, documentos: 6, tokensEntrada: 62_000, tokensSalida: 3_100, costoUsd: 0.0369 },
    ]);
  });

  it('informa el tope diario vigente y el gasto de hoy desde la medianoche de Colombia', async () => {
    const resumen = await caso.resumen({ periodoAcademico: PERIODO });

    expect(resumen.topeDiarioUsd).toBe(50);
    expect(resumen.gastoHoyUsd).toBeCloseTo(0.0007, 6);

    const consultaHoy = repositorio.filtros.find((f) => f.periodoAcademico === undefined && f.desde);
    expect(consultaHoy).toBeDefined();
    expect(consultaHoy!.desde!.getTime()).toBe(inicioDelDiaEnColombia(new Date()).getTime());
  });

  it('la configuración vigente expone el tope y la vigencia de las tarifas', async () => {
    const configuracion = await caso.configuracion();
    expect(configuracion).toMatchObject({
      driver: 'simulado', modelo: 'gpt-6-luna', esfuerzo: 'low', topeDiarioUsd: 50, tarifasVigentesDesde: VIGENCIA_TARIFAS,
    });
  });
});

describe('CostosIaUseCase · estimación con ajustes', () => {
  const caso = new CostosIaUseCase(
    new RepositorioCostosFalso(), parametrosDeFabrica(), configDe({ OPENAI_MODELO: 'gpt-6-luna' }),
  );

  it('ignora un factor de reenvíos negativo y sí aplica cero tokens de texto', () => {
    const estimacion = caso.estimacion('gpt-6-luna', { factorReenvios: -3, tokensTextoPorPagina: 0 });
    expect(estimacion).not.toBeNull();
    expect(estimacion!.supuestos.factorReenvios).toBe(1.25);
    expect(estimacion!.supuestos.tokensTextoPorPagina).toBe(0);
    // Sin capa de texto, cada documento cuesta menos que con el supuesto de fábrica.
    const deFabrica = caso.estimacion('gpt-6-luna')!;
    expect(estimacion!.promedioEstudianteUsd).toBeLessThan(deFabrica.promedioEstudianteUsd);
  });

  it('un factor de reenvíos menor que uno se eleva a uno', () => {
    expect(caso.estimacion('gpt-6-luna', { factorReenvios: 0.5 })!.supuestos.factorReenvios).toBe(1);
  });

  it('sin modelo usa el configurado', () => {
    expect(caso.estimacion()!.modelo).toBe('gpt-6-luna');
    expect(caso.estimacion('   ')!.modelo).toBe('gpt-6-luna');
  });

  it('un modelo inexistente devuelve null', () => {
    expect(caso.estimacion('modelo-inexistente')).toBeNull();
  });

  it('la comparativa del caso de uso respeta los ajustes', () => {
    const comparativa = caso.comparativa({ tokensTextoPorPagina: 0 });
    expect(comparativa.length).toBeGreaterThan(0);
    expect(comparativa[0].promedioEstudianteUsd).toBeLessThanOrEqual(comparativa[1].promedioEstudianteUsd);
  });
});

describe('inicioDelDiaEnColombia', () => {
  it('antes de las 05:00 UTC todavía es el día anterior en Colombia', () => {
    expect(inicioDelDiaEnColombia(new Date('2026-10-09T03:30:00Z')).toISOString()).toBe('2026-10-08T05:00:00.000Z');
  });

  it('a mediodía UTC es el mismo día', () => {
    expect(inicioDelDiaEnColombia(new Date('2026-10-09T12:00:00Z')).toISOString()).toBe('2026-10-09T05:00:00.000Z');
  });

  it('exactamente a medianoche de Colombia empieza el día', () => {
    expect(inicioDelDiaEnColombia(new Date('2026-10-09T05:00:00Z')).toISOString()).toBe('2026-10-09T05:00:00.000Z');
  });
});

describe('CostosIaUseCase · alcance por escuela del resumen', () => {
  let repositorio: RepositorioCostosFalso;
  let caso: CostosIaUseCase;

  beforeEach(() => {
    repositorio = new RepositorioCostosFalso();
    caso = new CostosIaUseCase(repositorio, parametrosDeFabrica(), configDe({ OPENAI_MODELO: 'gpt-6-luna' }));
  });

  it('la coordinación de escuela solo ve el gasto de sus escuelas, también en los periodos', async () => {
    await caso.resumen({ periodoAcademico: PERIODO }, actorDe(Rol.COORDINADOR, ['ESC-ING']));

    const { periodo, hoy } = repositorio.consultas();
    expect(periodo.escuelaIds).toEqual(['ESC-ING']);
    expect(periodo.periodoAcademico).toBe(PERIODO);
    expect(repositorio.alcancesDePeriodos).toEqual([['ESC-ING']]);
    // El gasto de hoy frente al tope es institucional: sin alcance.
    expect('escuelaIds' in hoy).toBe(false);
    expect(hoy.desde).toBeInstanceOf(Date);
  });

  it('el alcance se suma al filtro sin perder fechas ni periodo', async () => {
    const desde = new Date('2026-10-01T05:00:00Z');
    const hasta = new Date('2026-10-09T05:00:00Z');
    await caso.resumen({ periodoAcademico: PERIODO, desde, hasta }, actorDe(Rol.COORDINADOR, ['ESC-ING', 'ESC-ADM']));

    const { periodo } = repositorio.consultas();
    expect(periodo).toEqual({ periodoAcademico: PERIODO, desde, hasta, escuelaIds: ['ESC-ING', 'ESC-ADM'] });
  });

  it('la coordinación del Área de Prácticas (sin escuelas) ve toda la institución', async () => {
    await caso.resumen({ periodoAcademico: PERIODO }, actorDe(Rol.COORDINADOR));

    const { periodo, hoy } = repositorio.consultas();
    expect('escuelaIds' in periodo).toBe(false);
    expect('escuelaIds' in hoy).toBe(false);
    expect(repositorio.alcancesDePeriodos).toEqual([undefined]);
  });

  it('administración ve todo aunque tenga escuelas asociadas', async () => {
    await caso.resumen({ periodoAcademico: PERIODO }, actorDe(Rol.ADMINISTRADOR, ['ESC-ING']));

    expect('escuelaIds' in repositorio.consultas().periodo).toBe(false);
    expect(repositorio.alcancesDePeriodos).toEqual([undefined]);
  });

  it('sin actor (uso interno) no hay alcance', async () => {
    await caso.resumen({ periodoAcademico: PERIODO });

    expect(repositorio.filtros.every((f) => !('escuelaIds' in f))).toBe(true);
    expect(repositorio.alcancesDePeriodos).toEqual([undefined]);
  });

  it('un docente ve sus escuelas y, sin escuelas, no ve a nadie', async () => {
    await caso.resumen({ periodoAcademico: PERIODO }, actorDe(Rol.TUTOR, ['ESC-ING']));
    expect(repositorio.consultas().periodo.escuelaIds).toEqual(['ESC-ING']);

    repositorio = new RepositorioCostosFalso();
    caso = new CostosIaUseCase(repositorio, parametrosDeFabrica(), configDe({}));
    await caso.resumen({ periodoAcademico: PERIODO }, actorDe(Rol.TUTOR));
    expect(repositorio.consultas().periodo.escuelaIds).toEqual(['__sin_escuela__']);
    expect(repositorio.alcancesDePeriodos).toEqual([['__sin_escuela__']]);
  });

  it('el gasto de hoy y el tope no cambian con el alcance', async () => {
    const institucional = await caso.resumen({ periodoAcademico: PERIODO }, actorDe(Rol.ADMINISTRADOR));
    const escuela = await caso.resumen({ periodoAcademico: PERIODO }, actorDe(Rol.COORDINADOR, ['ESC-ING']));

    expect(escuela.gastoHoyUsd).toBe(institucional.gastoHoyUsd);
    expect(escuela.topeDiarioUsd).toBe(institucional.topeDiarioUsd);
  });
});

describe('Estimador de costo · desglose de la entrada', () => {
  const estimador = new CostosIaDomainService();
  const conocimiento = new ConocimientoDocumentalDomainService();
  const codigosEps = conocimiento.criteriosEvaluables(TipoDocumento.CERTIFICADO_EPS).map((c) => c.codigo);

  it('la entrada es instrucción + esquema + mensaje de usuario (40) + páginas', () => {
    const luna = tarifa('gpt-6-luna');
    const d = estimador.estimarDocumento(TipoDocumento.CERTIFICADO_EPS, luna);

    expect(SUPUESTOS_PREDETERMINADOS.tokensMensajeUsuario).toBe(40);
    expect(d.tokensEntrada).toBe(d.tokensInstruccion + d.tokensEsquema + 40 + d.tokensPaginas);
    expect(d.tokensInstruccion).toBe(conocimiento.tokensInstruccionAproximados(TipoDocumento.CERTIFICADO_EPS));
    expect(d.tokensInstruccion).toBeGreaterThan(0);
    expect(d.tokensEsquema).toBeGreaterThan(100);
    expect(d.tokensEsquema).toBe(tokensEsquemaAproximados(TipoDocumento.CERTIFICADO_EPS, codigosEps));
    expect(d.paginas).toBe(1);
    expect(d.tokensPaginas).toBe(d.paginas * (tokensImagen(luna, 1700, 2200) + SUPUESTOS_PREDETERMINADOS.tokensTextoPorPagina));
    expect(d.tokensSalida).toBe(SUPUESTOS_PREDETERMINADOS.tokensRespuesta + SUPUESTOS_PREDETERMINADOS.tokensRazonamiento);
    expect(d.costoUsd).toBe(costoDe(luna, { entrada: d.tokensEntrada, salida: d.tokensSalida }));
  });

  it('el mensaje de usuario es un supuesto ajustable y mueve la entrada exactamente en su diferencia', () => {
    const luna = tarifa('gpt-6-luna');
    const base = estimador.estimarDocumento(TipoDocumento.CERTIFICADO_EPS, luna);
    const ajustada = estimador.estimarDocumento(TipoDocumento.CERTIFICADO_EPS, luna, {
      ...SUPUESTOS_PREDETERMINADOS, tokensMensajeUsuario: 100,
    });
    expect(ajustada.tokensEntrada - base.tokensEntrada).toBe(60);
    expect(ajustada.tokensPaginas).toBe(base.tokensPaginas);
    expect(ajustada.tokensEsquema).toBe(base.tokensEsquema);
  });

  it('un modelo sin razonamiento no suma tokens de razonamiento a la salida', () => {
    const d = estimador.estimarDocumento(TipoDocumento.CERTIFICADO_EPS, tarifa('gpt-4.1-mini'));
    expect(d.tokensSalida).toBe(SUPUESTOS_PREDETERMINADOS.tokensRespuesta);
  });

  it('las páginas pesan por tipo: un informe final de 12 páginas multiplica la entrada', () => {
    const luna = tarifa('gpt-6-luna');
    const eps = estimador.estimarDocumento(TipoDocumento.CERTIFICADO_EPS, luna);
    const informe = estimador.estimarDocumento(TipoDocumento.INFORME_FINAL, luna);
    expect(informe.paginas).toBe(12);
    expect(informe.tokensPaginas).toBe(12 * (eps.tokensPaginas / eps.paginas));
  });

  it('los tokens del esquema se aproximan a un cuarto de su longitud en JSON y crecen con los criterios', () => {
    const esquema = esquemaLectura(TipoDocumento.CERTIFICADO_EPS, codigosEps);
    expect(tokensEsquemaAproximados(TipoDocumento.CERTIFICADO_EPS, codigosEps))
      .toBe(Math.ceil(JSON.stringify(esquema).length / 4));
    expect(tokensEsquemaAproximados(TipoDocumento.CERTIFICADO_EPS, codigosEps))
      .toBeGreaterThan(tokensEsquemaAproximados(TipoDocumento.CERTIFICADO_EPS, []));
    // El esquema siempre lleva el catálogo completo de tipos en `tipo_detectado`: nunca es diminuto.
    expect(tokensEsquemaAproximados(TipoDocumento.INFORME_1, [])).toBeGreaterThan(100);
  });

  it('el caso de uso acepta el mensaje de usuario como ajuste', () => {
    const caso = new CostosIaUseCase(
      new RepositorioCostosFalso(), parametrosDeFabrica(), configDe({ OPENAI_MODELO: 'gpt-6-luna' }),
    );
    const estimacion = caso.estimacion('gpt-6-luna', { tokensMensajeUsuario: 0 })!;
    expect(estimacion.supuestos.tokensMensajeUsuario).toBe(0);
    expect(estimacion.promedioEstudianteUsd).toBeLessThan(caso.estimacion('gpt-6-luna')!.promedioEstudianteUsd);
  });
});
