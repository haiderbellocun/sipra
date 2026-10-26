import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import {
  CostosIaUseCase, ResumenGastoIa,
} from '../src/application/use-cases/administracion/costos-ia.use-case';
import { Actor } from '../src/application/use-cases/practicas/gestionar-practica.use-case';
import { FiltroGastoIa } from '../src/domain/ports/out/repositorios.port';
import {
  ComparativaModelo, EstimacionPorEstudiante, SupuestosEstimacion,
} from '../src/domain/services/costos-ia.domain-service';
import { Rol } from '../src/domain/value-objects/rol.vo';
import {
  AjustesEstimacionDto, CostosIaController, FiltroResumenCostosDto,
} from '../src/infrastructure/controllers/costos-ia.controller';

/**
 * Los parámetros de consulta de «Costos de IA» se validan antes de llegar al
 * caso de uso: nada de arreglos donde va una cadena, números absurdos ni
 * fechas que no lo son. Y el controlador, instanciado a mano, debe rechazar
 * un rango invertido y pasar el actor tal cual al caso de uso.
 */

type Clase<T> = new () => T;

async function erroresDe<T extends object>(clase: Clase<T>, consulta: Record<string, unknown>): Promise<ValidationError[]> {
  return validate(plainToInstance(clase, consulta));
}

/** Como lo hace el ValidationPipe de la aplicación: con conversión implícita de tipos. */
async function erroresConConversion<T extends object>(clase: Clase<T>, consulta: Record<string, unknown>): Promise<ValidationError[]> {
  return validate(plainToInstance(clase, consulta, { enableImplicitConversion: true }));
}

function restricciones(errores: ValidationError[], propiedad: string): string[] {
  const error = errores.find((e) => e.property === propiedad);
  return Object.keys(error?.constraints ?? {});
}

describe('FiltroResumenCostosDto', () => {
  it('acepta un periodo y un rango de fechas ISO', async () => {
    const errores = await erroresDe(FiltroResumenCostosDto, {
      periodo: '2026-2', desde: '2026-10-01', hasta: '2026-10-09T23:59:59Z',
    });
    expect(errores).toEqual([]);
  });

  it('acepta la consulta vacía: todos los filtros son opcionales', async () => {
    expect(await erroresDe(FiltroResumenCostosDto, {})).toEqual([]);
  });

  it('un periodo repetido en la URL llega como arreglo y se rechaza', async () => {
    const errores = await erroresDe(FiltroResumenCostosDto, { periodo: ['2026-1', '2026-2'] });
    expect(restricciones(errores, 'periodo')).toContain('isString');
  });

  it('un periodo demasiado largo se rechaza', async () => {
    const errores = await erroresDe(FiltroResumenCostosDto, { periodo: 'x'.repeat(21) });
    expect(restricciones(errores, 'periodo')).toContain('maxLength');
  });

  it('«ayer» no es una fecha ISO', async () => {
    const errores = await erroresDe(FiltroResumenCostosDto, { desde: 'ayer' });
    expect(restricciones(errores, 'desde')).toContain('isIso8601');
    expect(restricciones(await erroresDe(FiltroResumenCostosDto, { hasta: '09/10/2026' }), 'hasta')).toContain('isIso8601');
  });
});

describe('AjustesEstimacionDto', () => {
  it('acepta ajustes válidos', async () => {
    const errores = await erroresDe(AjustesEstimacionDto, {
      modelo: 'gpt-6-luna', factorReenvios: 1.5, tokensTextoPorPagina: 0, tokensRazonamiento: 300,
      tokensRespuesta: 400, anchoPaginaPx: 1700, altoPaginaPx: 2200,
    });
    expect(errores).toEqual([]);
  });

  it('con la conversión implícita del pipe, los números llegan como texto y valen', async () => {
    expect(await erroresConConversion(AjustesEstimacionDto, { factorReenvios: '1.5', anchoPaginaPx: '1700' })).toEqual([]);
    const errores = await erroresConConversion(AjustesEstimacionDto, { factorReenvios: 'muchos' });
    expect(restricciones(errores, 'factorReenvios')).toContain('isNumber');
  });

  it('un factor de reenvíos astronómico se rechaza por el máximo', async () => {
    const errores = await erroresDe(AjustesEstimacionDto, { factorReenvios: 1e308 });
    expect(restricciones(errores, 'factorReenvios')).toContain('max');
  });

  it('las dimensiones y la respuesta no pueden ser cero ni minúsculas', async () => {
    const errores = await erroresDe(AjustesEstimacionDto, { anchoPaginaPx: 10, altoPaginaPx: 0, tokensRespuesta: 0, factorReenvios: 0.5 });
    expect(restricciones(errores, 'anchoPaginaPx')).toContain('min');
    expect(restricciones(errores, 'altoPaginaPx')).toContain('min');
    expect(restricciones(errores, 'tokensRespuesta')).toContain('min');
    expect(restricciones(errores, 'factorReenvios')).toContain('min');
  });

  it('un modelo repetido o demasiado largo se rechaza', async () => {
    expect(restricciones(await erroresDe(AjustesEstimacionDto, { modelo: ['a', 'b'] }), 'modelo')).toContain('isString');
    expect(restricciones(await erroresDe(AjustesEstimacionDto, { modelo: 'm'.repeat(61) }), 'modelo')).toContain('maxLength');
  });

  it('un número que no es finito se rechaza', async () => {
    expect(restricciones(await erroresDe(AjustesEstimacionDto, { tokensTextoPorPagina: Number.NaN }), 'tokensTextoPorPagina')).toContain('isNumber');
    expect(restricciones(await erroresDe(AjustesEstimacionDto, { tokensRazonamiento: Number.POSITIVE_INFINITY }), 'tokensRazonamiento')).toContain('isNumber');
  });
});

// ── Controlador instanciado a mano ──────────────────────────────────────────

class CostosIaFalso {
  resumenes: { filtro: FiltroGastoIa; actor?: Actor }[] = [];
  estimaciones: { modelo?: string; ajustes: Partial<SupuestosEstimacion> }[] = [];
  comparativas: Partial<SupuestosEstimacion>[] = [];

  resumen(filtro: FiltroGastoIa, actor?: Actor): Promise<ResumenGastoIa> {
    this.resumenes.push({ filtro, actor });
    return Promise.resolve({ gastoHoyUsd: 0, topeDiarioUsd: 50 } as ResumenGastoIa);
  }

  estimacion(modelo?: string, ajustes: Partial<SupuestosEstimacion> = {}): EstimacionPorEstudiante | null {
    this.estimaciones.push({ modelo, ajustes });
    return modelo === 'inexistente' ? null : ({ modelo: modelo ?? 'gpt-6-luna' } as EstimacionPorEstudiante);
  }

  comparativa(ajustes: Partial<SupuestosEstimacion> = {}): ComparativaModelo[] {
    this.comparativas.push(ajustes);
    return [];
  }
}

function actorDe(rol: Rol, escuelas: readonly string[] = []): Actor {
  return { id: 'u-1', correo: 'coordinacion@cun.edu.co', rol, permiso: 'consulta', escuelas, empresaId: null };
}

describe('CostosIaController · resumen', () => {
  let falso: CostosIaFalso;
  let controlador: CostosIaController;
  const actor = actorDe(Rol.COORDINADOR, ['ESC-ING']);

  beforeEach(() => {
    falso = new CostosIaFalso();
    controlador = new CostosIaController(falso as unknown as CostosIaUseCase);
  });

  it('rechaza un rango con «desde» posterior a «hasta» sin llamar al caso de uso', () => {
    expect(() => controlador.resumen({ desde: '2026-10-09', hasta: '2026-10-01' }, actor))
      .toThrow(BadRequestException);
    expect(() => controlador.resumen({ desde: '2026-10-09', hasta: '2026-10-01' }, actor))
      .toThrow('«desde» no puede ser posterior a «hasta»');
    expect(falso.resumenes).toHaveLength(0);
  });

  it('un rango de un solo instante (desde = hasta) se admite', async () => {
    await controlador.resumen({ desde: '2026-10-09T00:00:00Z', hasta: '2026-10-09T00:00:00Z' }, actor);
    expect(falso.resumenes).toHaveLength(1);
  });

  it('una fecha que no se puede interpretar se rechaza aunque pase el DTO', () => {
    expect(() => controlador.resumen({ desde: '2026-13-45' }, actor)).toThrow(BadRequestException);
    expect(() => controlador.resumen({ hasta: 'no-fecha' }, actor)).toThrow(/hasta no es una fecha válida/);
    expect(falso.resumenes).toHaveLength(0);
  });

  it('pasa el actor tal cual y el filtro normalizado al caso de uso', async () => {
    await controlador.resumen({ periodo: '  2026-2 ', desde: '2026-10-01', hasta: '2026-10-09' }, actor);

    expect(falso.resumenes).toHaveLength(1);
    const [{ filtro, actor: recibido }] = falso.resumenes;
    expect(recibido).toBe(actor);
    expect(filtro.periodoAcademico).toBe('2026-2');
    // Una fecha sin hora es un día de Colombia: medianoche de Bogotá (05:00 UTC).
    expect(filtro.desde?.toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(filtro.hasta?.toISOString()).toBe('2026-10-09T05:00:00.000Z');
    // El controlador no decide alcance: ni inventa ni filtra escuelas, eso lo hace el caso de uso con el actor.
    expect('escuelaIds' in filtro).toBe(false);
  });

  it('un periodo en blanco y fechas vacías se traducen a «sin filtro»', async () => {
    await controlador.resumen({ periodo: '   ', desde: '  ', hasta: '' }, actorDe(Rol.ADMINISTRADOR));
    expect(falso.resumenes[0].filtro).toEqual({ periodoAcademico: undefined, desde: undefined, hasta: undefined });
    expect(falso.resumenes[0].actor?.rol).toBe(Rol.ADMINISTRADOR);
  });
});

describe('CostosIaController · estimación y comparativa', () => {
  let falso: CostosIaFalso;
  let controlador: CostosIaController;

  beforeEach(() => {
    falso = new CostosIaFalso();
    controlador = new CostosIaController(falso as unknown as CostosIaUseCase);
  });

  it('solo pasa los supuestos numéricos presentes; el modelo va aparte', () => {
    controlador.estimacion({ modelo: 'gpt-6-luna', factorReenvios: 2, tokensTextoPorPagina: 0 });
    expect(falso.estimaciones).toEqual([{ modelo: 'gpt-6-luna', ajustes: { factorReenvios: 2, tokensTextoPorPagina: 0 } }]);
  });

  it('sin ajustes el caso de uso recibe un objeto vacío', () => {
    controlador.estimacion({});
    controlador.comparativa({});
    expect(falso.estimaciones[0]).toEqual({ modelo: undefined, ajustes: {} });
    expect(falso.comparativas).toEqual([{}]);
  });

  it('un modelo que el caso de uso no conoce es una petición inválida', () => {
    expect(() => controlador.estimacion({ modelo: 'inexistente' })).toThrow(BadRequestException);
    expect(() => controlador.estimacion({ modelo: 'inexistente' })).toThrow(/"inexistente" no está en la tabla de tarifas/);
  });
});
