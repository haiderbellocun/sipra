import ExcelJS from 'exceljs';
import { COLUMNAS_SGP, ColumnaSgp } from '../src/domain/historico/registro-historico';
import { Nit } from '../src/domain/value-objects/nit.vo';

/**
 * Fixture SINTÉTICO del Excel del SGP para el histórico (H2). Se GENERA en cada corrida (nunca se versiona un .xlsx
 * ni se extrae una fila del archivo real): documentos, NIT, nombres, programas y regionales son inventados.
 *
 * Las columnas personales llevan VALORES CENTINELA. Si alguno aparece en la base, en la salida o en un error, la
 * minimización está rota.
 */
export const CENTINELAS = [
  'SECRET-STUDENT-NAME-XYZ', 'secret-student-email-xyz@example.invalid', 'SECRET-STUDENT-PHONE-XYZ',
  'SECRET-TEACHER-NAME-XYZ', 'SECRET-FUNCTIONS-TEXT-XYZ', 'SECRET-BOSS-NAME-XYZ', 'SECRET-BOSS-ROLE-XYZ',
  'secret-boss-email-xyz@example.invalid', 'SECRET-BOSS-PHONE-XYZ', 'SECRET-COMPANY-NAME-XYZ',
] as const;

/** Documento sintético que, en la fila 3, viene como TEXTO con puntos: debe dar la MISMA clave que su forma numérica. */
export const DOCUMENTO_TEXTO_EQUIVALENTE = { id: 9_000_003, valor: '9.100.000.002', idsNumericos: [9_000_128] };

export const FIXTURE = {
  reales: 250,
  fantasmas: 60,
  primerId: 9_000_001,
  /** v2: ids modificados (contenido), id con documento cambiado, ids nuevos y ids que desaparecen. */
  v2: {
    modificados: [9_000_010, 9_000_020, 9_000_030, 9_000_040, 9_000_050],
    documentoCambiado: 9_000_060,
    nuevos: 10,
    retirados: [9_000_240, 9_000_241, 9_000_242],
  },
} as const;

/** Generador determinístico (mulberry32): mismo fixture en cada corrida. */
function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const nitConDv = (base: number): number => base * 10 + Nit.calcularDigitoVerificacion(String(base));
const fecha = (a: number, m: number, d: number, h = 0, mi = 0): Date => new Date(Date.UTC(a, m - 1, d, h, mi, 0));

type Fila = Partial<Record<ColumnaSgp, string | number | Date | null>>;

const PERIODOS = ['2023A', '2023B', '2024A', '2024B', '2025A', '2025C', '23V02', '24V03', '25V05', '26V04', '24P01', '25P06'];
const MODALIDADES = [
  'VALIDACIÓN DE LA EXPERIENCIA LABORAL', 'PASANTÍA', 'CONTRATO DE APRENDIZAJE', 'COMBINACIÓN DE FUNCIONES',
  'MONITORÍA', 'PROYECCIÓN SOCIAL', 'EMPRENDIMIENTO CUNBRE - NACIENTE', 'PRÁCTICA INVESTIGATIVA',
];
const ESTADOS = ['Cerrado', 'Cerrado', 'Cerrado', 'Anulado', 'Reprueba', 'Inscrito', 'En Práctica'];
const ASIGNATURAS: [string, string | null][] = [
  ['PRÁCTICA NIVEL TÉCNICO ', 'Técnico'], ['PRACTICA NIVEL TECNOLÓGICO', 'Tecnologo'], ['PRACTICA NIVEL PROFESIONAL UNIVERSITARIO', 'Profesional'],
];

export function filasFixtureSgp(variante: 1 | 2 | 3): Fila[] {
  const r = azar(20261119);
  const filas: Fila[] = [];
  for (let i = 0; i < FIXTURE.reales; i += 1) {
    const id = FIXTURE.primerId + i;
    const estudiante = 9_100_000_000 + (i % 125);
    const [asignatura, nivel] = ASIGNATURAS[i % 3];
    const juridica = nitConDv(999_000_000 + (i % 25));
    const inicio = fecha(2024, 1 + (i % 10), 1 + (i % 25));
    const fin = fecha(2024, 3 + (i % 10), 1 + (i % 25));
    filas.push({
      '#': id,
      'Documento': estudiante,
      'Nombre Estudiante': CENTINELAS[0],
      'Email Estudiante': CENTINELAS[1],
      'Telefono Estudiante': CENTINELAS[2],
      'Programa': `PROGRAMA SINTÉTICO ${String.fromCharCode(65 + (i % 6))}`,
      'Regional': i % 7 === 0 ? 'REGIONAL SINTÉTICA SUR ' : 'REGIONAL SINTÉTICA NORTE',
      'Nivel Formación': i % 2 === 0 ? nivel : null,
      'Semestre Segun Creditos': 1 + (i % 10),
      'Modalidad': ['VIRTUAL', 'PRESENCIAL', 'A DISTANCIA'][i % 3],
      'Codigo Asignatura': i % 2 === 0 ? 99001 + (i % 3) : `SIN${i % 3}`,
      'Nombre Asignatura': asignatura,
      'Estado Práctica': ESTADOS[i % ESTADOS.length],
      'Periodo Inscripción Asignatura': PERIODOS[i % PERIODOS.length],
      'Modalidad Práctica': MODALIDADES[i % MODALIDADES.length],
      'Nombre Docente': CENTINELAS[3],
      'Documento Docente': 92_000_000 + (i % 12),
      'Nit Empresa': juridica,
      'Nombre Empresa': `ORGANIZACIÓN SINTÉTICA ${i % 25} S.A.S.`,
      'Cargo Estudiante': 'CARGO SINTÉTICO',
      'Horario': 'L-V 8:00 a 17:00',
      'Salario': [1_423_500, 0, 1_300_000, '1.750.000'][i % 4],
      'Funciones Relevantes': CENTINELAS[4],
      'Área': 'Administración / Oficina',
      'Cargo Jefe Inmediato': CENTINELAS[6],
      'Nombre Jefe Inmediato': CENTINELAS[5],
      'Email Jefe Inmediato': CENTINELAS[7],
      'Telefono Jefe Inmediato': CENTINELAS[8],
      'Ciudad': ['Bogotá', 'Bogota D.C.', 'CIUDAD SINTÉTICA'][i % 3],
      'Fecha inicio Práctica': inicio,
      'Fecha Finalización Práctica': fin,
      'Documentos Subidos': Math.round(r() * 100) / 100,
      'Documentos Aprobados': 0,
      'Registros Bitacora': Math.floor(r() * 15),
      'Fecha Creación': fecha(2024, 1 + (i % 10), 1),
      'Ultimo movimiento Estudiante': fecha(2026, 9, 1 + (i % 20), 10, 30),
      'Ultimo movimiento Docente': fecha(2026, 9, 2 + (i % 20), 11, 45),
      'Pensum': i % 2 === 0 ? 1037 : '1072N',
    });
    const f = filas[i];
    f['Documentos Aprobados'] = Math.round((f['Documentos Subidos'] as number) * r() * 100) / 100;
  }
  const fila = (id: number): Fila => filas[id - FIXTURE.primerId];

  // ── Casos de borde ────────────────────────────────────────────────────────
  // i = 2 → estudiante 9100000002; la fila i = 127 lo trae numérico: las dos deben dar la misma clave.
  fila(9_000_003)['Documento'] = DOCUMENTO_TEXTO_EQUIVALENTE.valor;
  fila(9_000_005)['Fecha Finalización Práctica'] = '0000-00-00';
  fila(9_000_006)['Fecha inicio Práctica'] = '0001-01-01';
  fila(9_000_007)['Documento'] = null; // documento ausente
  fila(9_000_008)['Fecha Finalización Práctica'] = fecha(2223, 3, 9);
  fila(9_000_009)['Fecha inicio Práctica'] = fecha(2024, 6, 1);
  fila(9_000_009)['Fecha Finalización Práctica'] = fecha(2024, 3, 1); // fin antes de inicio
  fila(9_000_011)['Modalidad Práctica'] = 'EMPRESA PROPIA';
  fila(9_000_012)['Modalidad Práctica'] = 'EMPRESA PROPIA';
  fila(9_000_013)['Periodo Inscripción Asignatura'] = '2023I';
  fila(9_000_014)['Periodo Inscripción Asignatura'] = '22T01';
  fila(9_000_015)['Periodo Inscripción Asignatura'] = 'PERIODO-RARO';
  fila(9_000_016)['Salario'] = -658000;
  fila(9_000_017)['Salario'] = 9_000_000_000;
  fila(9_000_018)['Salario'] = '.908.526';
  fila(9_000_019)['Salario'] = 'SMLV';
  fila(9_000_021)['Documento Docente'] = null;
  // Empresa ambigua: el mismo NIT con dos nombres, y un nombre con dos NIT.
  fila(9_000_022)['Nit Empresa'] = nitConDv(999_100_001);
  fila(9_000_022)['Nombre Empresa'] = 'ALFA SINTÉTICA LTDA';
  fila(9_000_023)['Nit Empresa'] = nitConDv(999_100_001);
  fila(9_000_023)['Nombre Empresa'] = 'ALFA SINTÉTICA COMERCIAL';
  fila(9_000_024)['Nit Empresa'] = nitConDv(999_100_002);
  fila(9_000_024)['Nombre Empresa'] = 'BETA SINTÉTICA';
  fila(9_000_025)['Nit Empresa'] = nitConDv(999_100_003);
  fila(9_000_025)['Nombre Empresa'] = 'BETA SINTÉTICA';
  // Persona natural como empresa (cédula sintética de 10 dígitos + DV) y nombre centinela.
  fila(9_000_026)['Nit Empresa'] = Number(`${1_099_000_001}${Nit.calcularDigitoVerificacion('1099000001')}`);
  fila(9_000_026)['Nombre Empresa'] = `${CENTINELAS[9]} PERSONA NATURAL`;
  fila(9_000_027)['Nit Empresa'] = '123';
  fila(9_000_028)['Nit Empresa'] = `\t.${String(999_100_004).replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')}-${Nit.calcularDigitoVerificacion('999100004')}`;
  // Filas idénticas con «#» distinto (se conservan las dos).
  Object.assign(fila(9_000_031), { ...fila(9_000_032), '#': 9_000_031 });
  // Mismo estudiante, mismo periodo, dos registros no anulados.
  Object.assign(fila(9_000_033), { 'Documento': 9_100_000_500, 'Periodo Inscripción Asignatura': '25V05', 'Estado Práctica': 'Cerrado' });
  Object.assign(fila(9_000_034), { 'Documento': 9_100_000_500, 'Periodo Inscripción Asignatura': '25V05', 'Estado Práctica': 'Reprueba' });
  // Fila truncada después de «Nit Empresa».
  const truncada = fila(9_000_035);
  for (const c of COLUMNAS_SGP.slice(COLUMNAS_SGP.indexOf('Nit Empresa') + 1)) truncada[c] = null;
  // Nivel en conflicto con la asignatura.
  fila(9_000_036)['Nombre Asignatura'] = 'PRÁCTICA NIVEL TÉCNICO ';
  fila(9_000_036)['Nivel Formación'] = 'Profesional';

  if (variante >= 2) {
    for (const id of FIXTURE.v2.modificados) {
      fila(id)['Estado Práctica'] = 'Cerrado';
      fila(id)['Registros Bitacora'] = 99;
    }
    fila(FIXTURE.v2.documentoCambiado)['Documento'] = 9_100_000_999;
    const nuevas: Fila[] = [];
    for (let k = 0; k < FIXTURE.v2.nuevos; k += 1) {
      nuevas.push({ ...filas[100 + k], '#': FIXTURE.primerId + FIXTURE.reales + k, 'Registros Bitacora': 7 });
    }
    const quedan = filas.filter((f) => !(FIXTURE.v2.retirados as readonly number[]).includes(f['#'] as number));
    // v3 = v2 + un registro más: otro archivo (otro SHA-256) con el mismo contenido de v2.
    if (variante === 3) nuevas.push({ ...filas[200], '#': FIXTURE.primerId + FIXTURE.reales + FIXTURE.v2.nuevos });
    return [...quedan, ...nuevas];
  }
  return filas;
}

/** Escribe el fixture como .xlsx real: filas reales, una fila vacía interior y filas fantasma sin «#». */
export async function escribirFixtureSgp(ruta: string, variante: 1 | 2 | 3, opciones: { omitirColumna?: ColumnaSgp } = {}): Promise<{ reales: number; fantasmas: number }> {
  const columnas = COLUMNAS_SGP.filter((c) => c !== opciones.omitirColumna);
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Reporte Prácticas general');
  // Formato de fecha ANTES de escribir: las celdas heredan el estilo de la columna al crearse.
  for (const c of ['Fecha inicio Práctica', 'Fecha Finalización Práctica', 'Fecha Creación'] as const) {
    if (columnas.includes(c)) hoja.getColumn(columnas.indexOf(c) + 1).numFmt = 'yyyy-mm-dd';
  }
  for (const c of ['Ultimo movimiento Estudiante', 'Ultimo movimiento Docente'] as const) {
    if (columnas.includes(c)) hoja.getColumn(columnas.indexOf(c) + 1).numFmt = 'yyyy-mm-dd hh:mm:ss';
  }
  hoja.addRow([...columnas]);
  const filas = filasFixtureSgp(variante);
  filas.forEach((f, k) => {
    hoja.addRow(columnas.map((c) => f[c] ?? null));
    if (k === 34) hoja.addRow([]); // fila vacía interior tras la truncada, como en el archivo real
  });
  // El defecto del archivo real: `Nombre Asignatura` rellenado hacia abajo sin ningún otro dato.
  const colAsignatura = columnas.indexOf('Nombre Asignatura') + 1;
  for (let k = 0; k < FIXTURE.fantasmas; k += 1) {
    const fila = hoja.addRow([]);
    fila.getCell(colAsignatura).value = 'PRÁCTICA NIVEL TÉCNICO ';
  }
  await libro.xlsx.writeFile(ruta);
  return { reales: filas.length, fantasmas: FIXTURE.fantasmas };
}

/**
 * Lote SINTÉTICO grande para el benchmark (H3): `n` registros con variedad realista (estudiantes que repiten, ~n/20
 * organizaciones con variantes de nombre, periodos de los tres calendarios, fechas, salarios) y filas fantasma en la
 * proporción del archivo real (~6,3 por registro). Nada sale del Excel real.
 */
export async function escribirLoteSinteticoGrande(ruta: string, n: number, opciones: { fantasmasPorRegistro?: number; semilla?: number } = {}): Promise<{ reales: number; fantasmas: number }> {
  const r = azar(opciones.semilla ?? 42);
  const plantilla = filasFixtureSgp(1)[40];
  const libro = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: ruta, useStyles: true, useSharedStrings: true });
  const hoja = libro.addWorksheet('Reporte Prácticas general');
  hoja.columns = COLUMNAS_SGP.map((c) => ({ key: c, style: /Fecha|movimiento/.test(c) ? { numFmt: 'yyyy-mm-dd' } : {} }));
  hoja.addRow([...COLUMNAS_SGP]).commit();
  const orgs = Math.max(5, Math.floor(n / 20));
  const fantasmas = Math.round(n * (opciones.fantasmasPorRegistro ?? 6.3));
  const colAsignatura = COLUMNAS_SGP.indexOf('Nombre Asignatura');
  for (let i = 0; i < n; i += 1) {
    const org = Math.floor(r() * orgs);
    const inicio = fecha(2020 + Math.floor(r() * 7), 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 27));
    const fin = new Date(inicio.getTime() + (20 + Math.floor(r() * 300)) * 86_400_000);
    const sufijo = r() < 0.2 ? ' S.A.S.' : r() < 0.1 ? ' LTDA VARIANTE' : '';
    const f: Fila = {
      ...plantilla,
      '#': 10_000_000 + i,
      'Documento': 8_000_000_000 + Math.floor(r() * (n / 2)),
      'Documento Docente': 70_000_000 + Math.floor(r() * 300),
      'Programa': `PROGRAMA SINTÉTICO ${String.fromCharCode(65 + Math.floor(r() * 19))}`,
      'Estado Práctica': ESTADOS[Math.floor(r() * ESTADOS.length)],
      'Periodo Inscripción Asignatura': PERIODOS[Math.floor(r() * PERIODOS.length)],
      'Modalidad Práctica': MODALIDADES[Math.floor(r() * MODALIDADES.length)],
      'Nit Empresa': nitConDv(998_000_000 + org),
      'Nombre Empresa': `ORGANIZACIÓN SINTÉTICA ${org}${sufijo}`,
      'Fecha inicio Práctica': inicio,
      'Fecha Finalización Práctica': r() < 0.05 ? '0000-00-00' : fin,
      'Salario': [1_300_000, 0, 1_423_500, '1.750.000', 'SMLV'][Math.floor(r() * 5)],
      'Registros Bitacora': Math.floor(r() * 20),
      'Fecha Creación': inicio,
      'Ultimo movimiento Estudiante': new Date(fin.getTime() + 86_400_000),
      'Ultimo movimiento Docente': new Date(fin.getTime() + 2 * 86_400_000),
    };
    hoja.addRow(COLUMNAS_SGP.map((c) => f[c] ?? null)).commit();
  }
  // El defecto del archivo real: filas con solo `Nombre Asignatura` rellenado, al final.
  for (let k = 0; k < fantasmas; k += 1) {
    const fila: (string | null)[] = new Array<string | null>(COLUMNAS_SGP.length).fill(null);
    fila[colAsignatura] = 'PRÁCTICA NIVEL TÉCNICO ';
    hoja.addRow(fila).commit();
  }
  hoja.commit();
  await libro.commit();
  return { reales: n, fantasmas };
}
