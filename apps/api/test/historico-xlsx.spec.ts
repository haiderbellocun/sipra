import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AplicacionNoAutorizadaError, ImportarHistoricoUseCase,
} from '../src/application/use-cases/historico/importar-historico.use-case';
import { SeudonimizadorHistorico } from '../src/domain/historico/seudonimizacion-historico';
import { HistoricoRepositorio } from '../src/domain/ports/out/historico-repositorio.port';
import { LectorXlsxSgp, sha256DeArchivo } from '../src/infrastructure/historico/lector-xlsx-sgp';
import { LectorXlsxFlujoSgp, decodificarXml } from '../src/infrastructure/historico/lector-xlsx-flujo';
import { ejecutarCli } from '../herramientas/historico-importar';
import { CENTINELAS, DOCUMENTO_TEXTO_EQUIVALENTE, FIXTURE, escribirFixtureSgp } from './soporte-historico-sgp';

/** Repositorio espía: cuenta cualquier intento de escritura. */
function repositorioEspia(): HistoricoRepositorio & { escrituras: number } {
  const espia = {
    escrituras: 0,
    importacionCompletada: async () => null,
    vigentes: async () => new Map(),
    aplicar: async () => { espia.escrituras += 1; throw new Error('no debía escribir'); },
    registrarFallo: async () => { espia.escrituras += 1; return 'x'; },
    revertir: async () => { espia.escrituras += 1; throw new Error('no debía escribir'); },
    practicasActuales: async () => [],
    proponerCorrespondencias: async () => { espia.escrituras += 1; throw new Error('no debía escribir'); },
  };
  return espia;
}

describe('Histórico SGP · lector XLSX, simulacro y privacidad', () => {
  let dir: string;
  let v1: string;
  const seud = SeudonimizadorHistorico.desdeSecreto('prueba-sintetica-xlsx-'.padEnd(48, 'x'), 'v1');

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sipra-historico-'));
    v1 = join(dir, 'sgp-sintetico-v1.xlsx');
    await escribirFixtureSgp(v1, 1);
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('solo cuentan las filas con «#»: las fantasma (Nombre Asignatura rellenado) se descartan', async () => {
    const lector = new LectorXlsxSgp(v1);
    const filas = [];
    for await (const f of lector.filasReales()) filas.push(f);
    const e = lector.estadisticas();
    expect(filas).toHaveLength(FIXTURE.reales);
    expect(e).toMatchObject({ filasReales: FIXTURE.reales, filasDescartadas: FIXTURE.fantasmas, filasFisicas: FIXTURE.reales + FIXTURE.fantasmas });
    expect(filas.every((f) => f.celdas['#'] !== null)).toBe(true);
  });

  it('las columnas personales NUNCA salen de la hoja', async () => {
    const lector = new LectorXlsxSgp(v1);
    for await (const f of lector.filasReales()) {
      for (const c of ['Nombre Estudiante', 'Email Estudiante', 'Telefono Estudiante', 'Nombre Docente', 'Funciones Relevantes',
        'Nombre Jefe Inmediato', 'Email Jefe Inmediato', 'Telefono Jefe Inmediato', 'Cargo Jefe Inmediato'] as const) {
        expect(c in f.celdas).toBe(false);
      }
    }
  });

  it('fechas de Excel llegan como fecha; identificadores numéricos sin pérdida', async () => {
    const lector = new LectorXlsxSgp(v1);
    const it = lector.filasReales()[Symbol.asyncIterator]();
    const { value } = await it.next();
    expect(value!.celdas['Fecha inicio Práctica']).toBeInstanceOf(Date);
    expect(value!.celdas['#']).toBe(FIXTURE.primerId);
    await it.return?.();
  });

  it('cabecera incompleta → error claro, sin leer datos', async () => {
    const ruta = join(dir, 'sin-columna.xlsx');
    await escribirFixtureSgp(ruta, 1, { omitirColumna: 'Pensum' });
    const lector = new LectorXlsxSgp(ruta);
    await expect((async () => { for await (const fila of lector.filasReales()) void fila; })()).rejects.toThrow(/faltan columnas.*Pensum/);
  });

  it('SHA-256 por flujo, estable', async () => {
    expect(await sha256DeArchivo(v1)).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256DeArchivo(v1)).toBe(await sha256DeArchivo(v1));
  });

  it('DRY RUN: proyecta, marca y NO escribe (ni la fila de importación)', async () => {
    const repo = repositorioEspia();
    const lineas: string[] = [];
    const r = await new ImportarHistoricoUseCase(new LectorXlsxSgp(v1), seud, repo)
      .ejecutar({ modo: 'dry-run', sourceSystem: 'SGP_SINTETICO', compuertaEntorno: true, informar: (l) => lineas.push(l) });
    expect(repo.escrituras).toBe(0);
    expect(r).toMatchObject({ resultado: 'DRY_RUN', importacionId: null, nuevos: FIXTURE.reales, comparadoConBase: true });
    expect(r.marcas.TRUNCATED_SOURCE_ROW).toBe(1);
    expect(r.marcas.END_BEFORE_START).toBe(1);
    expect(r.marcas.MODALITY_MAPPING_PENDING).toBe(2);
    expect(r.marcas.STUDENT_ID_MISSING).toBe(1);
    expect(r.organizaciones.requierenRevision).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(r.marcas)).not.toMatch(/COMPANY/);
    expect(lineas.join('\n')).toMatch(/DRY RUN: no se escribió nada/);
  });

  it('APPLY sin compuerta de entorno, con clave efímera o sin base → rechazado y CERO escrituras', async () => {
    const repo = repositorioEspia();
    const caso = new ImportarHistoricoUseCase(new LectorXlsxSgp(v1), seud, repo);
    await expect(caso.ejecutar({ modo: 'apply', sourceSystem: 'SGP_SINTETICO', compuertaEntorno: false })).rejects.toThrow(AplicacionNoAutorizadaError);
    await expect(new ImportarHistoricoUseCase(new LectorXlsxSgp(v1), SeudonimizadorHistorico.efimero(), repo)
      .ejecutar({ modo: 'apply', sourceSystem: 'SGP_SINTETICO', compuertaEntorno: true })).rejects.toThrow(/efímera/);
    await expect(new ImportarHistoricoUseCase(new LectorXlsxSgp(v1), seud, null)
      .ejecutar({ modo: 'apply', sourceSystem: 'SGP_SINTETICO', compuertaEntorno: true })).rejects.toThrow(/base de datos/);
    expect(repo.escrituras).toBe(0);
  });

  it('el documento en texto con puntos y su forma numérica dan la MISMA clave', async () => {
    const r = await new ImportarHistoricoUseCase(new LectorXlsxSgp(v1), seud, null)
      .ejecutar({ modo: 'dry-run', sourceSystem: 'SGP_SINTETICO', compuertaEntorno: false });
    // 125 estudiantes sintéticos + los dos inventados para los casos de borde − el ausente.
    expect(r.agregados.estudiantesDistintos).toBe(126);
    expect(DOCUMENTO_TEXTO_EQUIVALENTE.idsNumericos).toHaveLength(1);
  });

  it('CLI: la salida completa (incluido --json) no contiene ningún centinela, documento ni NIT', async () => {
    const salida: string[] = [];
    const errores: string[] = [];
    const original = { log: console.log, error: console.error, warn: console.warn };
    console.log = (...a: unknown[]) => { salida.push(a.join(' ')); };
    console.error = (...a: unknown[]) => { errores.push(a.join(' ')); };
    console.warn = (...a: unknown[]) => { errores.push(a.join(' ')); };
    try {
      await ejecutarCli(['--file', v1, '--source-system', 'SGP_SINTETICO', '--json'], {}, (l) => salida.push(l));
      await ejecutarCli(['--file', v1, '--apply'], {}, (l) => salida.push(l)).catch((e: Error) => errores.push(`${e.name}: ${e.message}`));
    } finally {
      Object.assign(console, original);
    }
    const todo = [...salida, ...errores].join('\n');
    expect(errores.join('\n')).toMatch(/HISTORICO_HMAC_KEY no está definida/); // APPLY sin clave: fail-closed
    for (const c of CENTINELAS) expect(todo).not.toContain(c);
    expect(todo).not.toMatch(/91000000\d\d/); // documentos sintéticos
    expect(todo).not.toMatch(/9990000\d\d\d/); // NIT sintéticos
  });
});

describe('Histórico SGP · lector en flujo propio (H3)', () => {
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'sipra-historico-flujo-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  const huellasDe = async (f: { filasReales: () => AsyncIterable<{ filaOrigen: number; celdas: Record<string, unknown> }> }): Promise<string[]> => {
    const out: string[] = [];
    for await (const r of f.filasReales()) {
      out.push(`${r.filaOrigen}:${JSON.stringify(Object.entries(r.celdas).sort().map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))}`);
    }
    return out;
  };

  it('entrega EXACTAMENTE las mismas filas que el lector de exceljs (v1 y v2)', async () => {
    for (const v of [1, 2] as const) {
      const ruta = join(dir, `v${v}.xlsx`);
      await escribirFixtureSgp(ruta, v);
      const [a, b] = [await huellasDe(new LectorXlsxSgp(ruta)), await huellasDe(new LectorXlsxFlujoSgp(ruta))];
      expect(b).toEqual(a);
    }
  });

  it('descarta las filas fantasma y nunca extrae columnas personales', async () => {
    const ruta = join(dir, 'v1b.xlsx');
    await escribirFixtureSgp(ruta, 1);
    const lector = new LectorXlsxFlujoSgp(ruta);
    for await (const f of lector.filasReales()) {
      for (const c of ['Nombre Estudiante', 'Email Estudiante', 'Funciones Relevantes', 'Nombre Jefe Inmediato'] as const) expect(c in f.celdas).toBe(false);
    }
    expect(lector.estadisticas()).toMatchObject({ filasReales: FIXTURE.reales, filasDescartadas: FIXTURE.fantasmas });
  });

  it('no deja archivos temporales en el directorio temporal del sistema', async () => {
    const ruta = join(dir, 'v1c.xlsx');
    await escribirFixtureSgp(ruta, 1);
    const antes = new Set(await readdir(tmpdir()));
    for await (const f of new LectorXlsxFlujoSgp(ruta).filasReales()) void f;
    const nuevos = (await readdir(tmpdir())).filter((n) => !antes.has(n));
    expect(nuevos).toEqual([]);
  });

  it('cabecera incompleta → error claro', async () => {
    const ruta = join(dir, 'sin.xlsx');
    await escribirFixtureSgp(ruta, 1, { omitirColumna: 'Pensum' });
    await expect((async () => { for await (const f of new LectorXlsxFlujoSgp(ruta).filasReales()) void f; })()).rejects.toThrow(/faltan columnas.*Pensum/);
  });

  it('entidades XML se decodifican; los escapes _xHHHH_ quedan literales (igual que exceljs)', () => {
    expect(decodificarXml('A &amp; B &lt;C&gt; &#233; &#x41;')).toBe('A & B <C> é A');
    expect(decodificarXml('X_x001F_Y')).toBe('X_x001F_Y');
  });
});
