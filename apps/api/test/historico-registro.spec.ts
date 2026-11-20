import {
  COLUMNAS_EXCLUIDAS, FilaSgp, RegistroHistorico, VersionVigente, aplicarMarcasDeLote, esFilaReal, exigirIdsUnicos, resumenOrganizaciones,
  planificarImportacion, transformarFilaSgp,
} from '../src/domain/historico/registro-historico';
import { SeudonimizadorHistorico } from '../src/domain/historico/seudonimizacion-historico';
import { CENTINELAS, filasFixtureSgp } from './soporte-historico-sgp';

const seud = SeudonimizadorHistorico.desdeSecreto('prueba-sintetica-registro-'.padEnd(48, 'r'), 'v1');
const transformar = (celdas: FilaSgp, fila = 2): RegistroHistorico => transformarFilaSgp({ filaOrigen: fila, celdas }, 'SGP_SINTETICO', seud);
const base = (): FilaSgp => ({ ...filasFixtureSgp(1)[40] });

describe('Histórico SGP · filas reales', () => {
  it('la ÚNICA condición de fila real es «#» no vacío (no un dropna genérico)', () => {
    expect(esFilaReal({ '#': 1, 'Documento': null, 'Programa': null })).toBe(true);
    expect(esFilaReal({ '#': null, 'Nombre Asignatura': 'PRÁCTICA NIVEL TÉCNICO ' })).toBe(false);
    expect(esFilaReal({ '#': '  ', 'Nombre Asignatura': 'x' })).toBe(false);
  });
  it('el transformador rechaza una fila sin «#» (error de programación del lector)', () => {
    expect(() => transformar({ '#': null })).toThrow(/no tiene «#»/);
  });
});

describe('Histórico SGP · transformación minimizada', () => {
  it('ningún valor centinela de las columnas personales llega al registro', () => {
    const r = transformar(base());
    const texto = JSON.stringify(r);
    for (const c of CENTINELAS) expect(texto).not.toContain(c);
    expect(texto).not.toContain('9100000040');
  });

  it('el content_hash es estable y no depende de columnas personales ni del orden de las claves', () => {
    const a = base();
    const invertida = Object.fromEntries(Object.entries(a).reverse()) as FilaSgp;
    expect(transformar(invertida).contentHash).toBe(transformar(a).contentHash);
    const otroNombre = { ...a, 'Nombre Estudiante': 'OTRO NOMBRE SINTÉTICO', 'Funciones Relevantes': 'otra' };
    expect(transformar(otroNombre).contentHash).toBe(transformar(a).contentHash);
    expect(transformar({ ...a, 'Registros Bitacora': 99 }).contentHash).not.toBe(transformar(a).contentHash);
    expect(transformar(a, 77).contentHash).toBe(transformar(a, 2).contentHash); // la fila de origen no es contenido
  });

  it('el documento no entra al content_hash (se detecta por la clave, no se puede revertir desde el hash)', () => {
    const a = base();
    const b = { ...a, 'Documento': 9_199_999_999 };
    expect(transformar(b).contentHash).toBe(transformar(a).contentHash);
    expect(transformar(b).studentKey).not.toBe(transformar(a).studentKey);
  });

  it('fila truncada después de «Nit Empresa» → TRUNCATED_SOURCE_ROW y observed (no se descarta)', () => {
    const r = transformar(filasFixtureSgp(1)[34]);
    expect(r.qualityFlags).toContain('TRUNCATED_SOURCE_ROW');
    expect(r.qualityStatus).toBe('observed');
  });

  it('fin anterior al inicio → END_BEFORE_START, sin duración y sin rechazar', () => {
    const r = transformar(filasFixtureSgp(1)[8]);
    expect(r.qualityFlags).toContain('END_BEFORE_START');
    expect(r.duracionDias).toBeNull();
    expect(r.fechaInicio).not.toBeNull();
  });

  it('calidad de organización en la fila: persona natural, identificador inválido y pista de tipo sustentada', () => {
    const natural = transformar(filasFixtureSgp(1)[25]);
    expect(natural.organizationFlags).toContain('IDENTIFIER_PERSON_NATURAL');
    expect(natural.organizationTypeHint).toBe('NATURAL_PERSON');
    expect(natural.qualityFlags.join(',')).not.toMatch(/COMPANY|IDENTIFIER/);
    const invalido = transformar(filasFixtureSgp(1)[26]);
    expect(invalido.organizationFlags).toContain('IDENTIFIER_INVALID');
    expect(invalido.organizationTypeHint).toBeNull();
    expect(transformar(base()).organizationTypeHint).toBe('LEGAL_ENTITY');
  });

  it('EMPRESA PROPIA → pendiente institucional, sin inventar equivalencia', () => {
    const r = transformar(filasFixtureSgp(1)[10]);
    expect(r).toMatchObject({ modalidadPracticaNormalizada: null, modalidadMappingStatus: 'PENDING_INSTITUTIONAL_MAPPING' });
    expect(r.qualityFlags).toContain('MODALITY_MAPPING_PENDING');
  });

  it('estado abierto queda como estado de corte; programa sin código SINU inventado', () => {
    const r = transformar({ ...base(), 'Estado Práctica': 'En Práctica' });
    expect(r).toMatchObject({ estadoAnalitico: 'en_practica', esEstadoDeCorte: true, codigoSinu: null, programaMappingStatus: 'PENDING_INSTITUTIONAL_MAPPING' });
  });

  it('las columnas excluidas son exactamente las personales y el texto libre', () => {
    expect([...COLUMNAS_EXCLUIDAS].sort()).toEqual([
      'Cargo Jefe Inmediato', 'Email Estudiante', 'Email Jefe Inmediato', 'Funciones Relevantes', 'Nombre Docente',
      'Nombre Estudiante', 'Nombre Jefe Inmediato', 'Telefono Estudiante', 'Telefono Jefe Inmediato',
    ]);
  });
});

describe('Histórico SGP · marcas de lote', () => {
  const lote = filasFixtureSgp(1).map((c, i) => transformar(c, i + 2));
  aplicarMarcasDeLote(lote, '2026-09-22T17:25:00.000Z');
  const de = (id: number): RegistroHistorico => lote.find((r) => r.sourceRecordId === String(id))!;

  it('filas idénticas con «#» distinto: se conservan las dos y se marcan', () => {
    expect(de(9_000_031).qualityFlags).toContain('IDENTICAL_CONTENT');
    expect(de(9_000_032).qualityFlags).toContain('IDENTICAL_CONTENT');
    expect(lote).toHaveLength(250);
  });
  it('mismo estudiante y periodo con dos registros no anulados → DUPLICATE_ACTIVE_IN_PERIOD', () => {
    expect(de(9_000_033).qualityFlags).toContain('DUPLICATE_ACTIVE_IN_PERIOD');
    expect(de(9_000_034).qualityFlags).toContain('DUPLICATE_ACTIVE_IN_PERIOD');
  });
  it('H3: un NIT con varios nombres NO vuelve observada la práctica (es calidad de la ORGANIZACIÓN)', () => {
    for (const id of [9_000_022, 9_000_023, 9_000_024, 9_000_025]) {
      expect(de(id).qualityFlags.join(',')).not.toMatch(/COMPANY|ALIAS/);
    }
    expect(lote.some((x) => (x.qualityFlags as string[]).includes('COMPANY_IDENTIFIER_AMBIGUOUS'))).toBe(false);
    const org = resumenOrganizaciones(lote);
    expect(org.conVariosAlias).toBeGreaterThanOrEqual(1); // 999100001 con dos nombres
    expect(org.conAliasCompartido).toBeGreaterThanOrEqual(2); // «BETA SINTÉTICA» con dos NIT
    expect(org.requierenRevision).toBeGreaterThanOrEqual(3);
  });
  it('duplicados idénticos: el representante (menor #) cuenta; el otro apunta a él', () => {
    expect(de(9_000_031).duplicadoDe).toBeNull();
    expect(de(9_000_032).duplicadoDe).toBe('9000031');
  });
  it('la fecha de corte se fija en todos los registros', () => {
    expect(new Set(lote.map((r) => r.estadoFechaCorte))).toEqual(new Set(['2026-09-22T17:25:00.000Z']));
  });
  it('dos veces el mismo «#» en un archivo → error (identidad de origen no única)', () => {
    expect(() => exigirIdsUnicos([lote[0], lote[0]])).toThrow(/dos veces/);
  });
});

describe('Histórico SGP · planificación del versionado', () => {
  const lote = filasFixtureSgp(1).map((c, i) => transformar(c, i + 2));
  const vigente = (r: RegistroHistorico, cambios: Partial<VersionVigente> = {}): VersionVigente => ({
    id: `id-${r.sourceRecordId}`, version: 1, contentHash: r.contentHash, hmacKeyVersion: 'v1', studentKey: r.studentKey,
    teacherKey: r.teacherKey, organizationKey: r.organizationKey, empresaAliasHash: r.empresaAliasHash, ...cambios,
  });

  it('A: id nuevo → versión 1', () => {
    expect(planificarImportacion(lote, new Map()).nuevos).toHaveLength(250);
  });
  it('B: mismo contenido → sin cambios', () => {
    const p = planificarImportacion(lote, new Map(lote.map((r) => [r.sourceRecordId, vigente(r)])));
    expect(p).toMatchObject({ nuevos: [], versionados: [], sinCambios: 250, ausentes: 0 });
  });
  it('C: contenido distinto o identidad distinta → nueva versión; ausentes solo se cuentan', () => {
    const mapa = new Map(lote.map((r) => [r.sourceRecordId, vigente(r)]));
    mapa.set(lote[0].sourceRecordId, vigente(lote[0], { contentHash: 'f'.repeat(64), version: 3 }));
    mapa.set(lote[1].sourceRecordId, vigente(lote[1], { studentKey: 'e'.repeat(64) }));
    mapa.set('9999999', vigente(lote[2]));
    const p = planificarImportacion(lote, mapa);
    expect(p.versionados.map((v) => v.registro.sourceRecordId)).toEqual([lote[0].sourceRecordId, lote[1].sourceRecordId]);
    expect(p.versionados[0].anterior.version).toBe(3);
    expect(p.sinCambios).toBe(248);
    expect(p.ausentes).toBe(1);
  });
});
