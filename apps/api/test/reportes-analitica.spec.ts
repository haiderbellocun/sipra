import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  FACETAS, MAX_MUESTRAS_TIEMPO, MODALIDADES_ARTICULADAS, ReportesAnaliticaUseCase, SIN_DATO, SIN_EMPRESA, tipoReceptor, celdaCsv, compararCiclos, compararPeriodos,
} from '../src/application/use-cases/reportes/reportes-analitica.use-case';
import { EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { ModalidadPractica, documentosExigidos } from '../src/domain/entities/modalidad.entity';
import {
  FiltroAnalitica, PracticaAnalitica, ReportesAnaliticaPort, VersionAnalitica,
} from '../src/domain/ports/out/reportes-analitica.port';
import { Rol } from '../src/domain/value-objects/rol.vo';

/** Datos sintéticos. «Ahora» es miércoles 2026-09-16 10:00 en Bogotá (15:00 UTC). */
const AHORA = new Date('2026-09-16T15:00:00.000Z');
const h = (iso: string) => new Date(iso);

const practica = (s: Partial<PracticaAnalitica>): PracticaAnalitica => ({
  id: 'p', estudianteId: 'e', estudiante: 'Estudiante Sintético', programaId: 'ADM-PRO', escuelaId: 'ESC-NEG', escuela: 'Negocios',
  periodoAcademico: '2026C', ciclo: 'profesional', semestre: null, programaNombre: null, sector: null, sectorNombre: null, ciudad: null, ciudadNombre: null, internacional: false, modalidad: ModalidadPractica.PASANTIA, estado: 'activa', empresa: 'Andina S.A.S.', ...s,
});
const version = (s: Partial<VersionAnalitica>): VersionAnalitica => ({
  id: 'v', practicaId: 'p1', tipo: TipoDocumento.CERTIFICADO_ARL, version: 1, estado: EstadoDocumento.EN_REVISION,
  cargadoEn: h('2026-09-14T14:00:00.000Z'), decididoEn: null, decision: null, ...s,
});

const PRACTICAS: PracticaAnalitica[] = [
  // Misma estudiante con dos prácticas: cuenta 1 estudiante y 2 prácticas.
  practica({ id: 'p1', estudianteId: 'e1', estudiante: 'Ana Sintética' }),
  practica({ id: 'p2', estudianteId: 'e1', estudiante: 'Ana Sintética', periodoAcademico: '2026A', estado: 'cerrada' }),
  practica({ id: 'p3', estudianteId: 'e2', estudiante: 'Beto Sintético', escuelaId: 'ESC-ING', escuela: 'Ingeniería', programaId: 'ING-SIS', empresa: null }),
  practica({ id: 'p4', estudianteId: 'e3', estudiante: 'Caro Sintética', modalidad: 'modalidad_inexistente' }),
];
const VERSIONES: VersionAnalitica[] = [
  // p1 · ARL: v1 devuelta y v2 aprobada → una sola obligación (aprobada), dos versiones, un reenvío.
  version({ id: 'v1', practicaId: 'p1', tipo: TipoDocumento.CERTIFICADO_ARL, version: 1, estado: EstadoDocumento.DEVUELTO,
    cargadoEn: h('2026-09-07T14:00:00.000Z'), decididoEn: h('2026-09-07T16:00:00.000Z'), decision: 'devolver' }),
  version({ id: 'v2', practicaId: 'p1', tipo: TipoDocumento.CERTIFICADO_ARL, version: 2, estado: EstadoDocumento.APROBADO,
    cargadoEn: h('2026-09-14T14:00:00.000Z'), decididoEn: h('2026-09-14T18:00:00.000Z'), decision: 'aprobar' }),
  // p1 · EPS en revisión (cargado, sin decisión).
  version({ id: 'v3', practicaId: 'p1', tipo: TipoDocumento.CERTIFICADO_EPS, estado: EstadoDocumento.EN_REVISION }),
  // p3 · EPS devuelto → expediente que requiere corrección.
  version({ id: 'v4', practicaId: 'p3', tipo: TipoDocumento.CERTIFICADO_EPS, estado: EstadoDocumento.DEVUELTO,
    cargadoEn: h('2026-09-15T13:00:00.000Z'), decididoEn: h('2026-09-15T23:00:00.000Z'), decision: 'devolver' }),
];

const coordinacionGeneral = { id: 'coo-1', correo: 'coordinacion@cun.edu.co', rol: Rol.COORDINADOR, permiso: 'consulta' as const, escuelas: [], empresaId: null };
const docenteNegocios = { id: 'doc-1', correo: 'docente@cun.edu.co', rol: Rol.TUTOR, permiso: 'escritura' as const, escuelas: ['ESC-NEG'], empresaId: null };
const estudiante = { id: 'e1', correo: 'ana@estudiante.cun.edu.co', rol: Rol.ESTUDIANTE, permiso: 'escritura' as const, escuelas: [], empresaId: null };

/** Puerto falso que aplica los filtros como lo hace el SQL del adaptador. */
/** Fechas de inicio como las de `periodos_academicos` (los demás códigos no están en la entidad). */
const INICIOS: Record<string, string> = { '2026A': '2026-01-26', '2026C': '2026-07-20', '2026-1': '2026-02-01', '2026-2': '2026-08-01' };

function armar(practicas = PRACTICAS, versiones = VERSIONES, conSemestre = false) {
  const consultas: FiltroAnalitica[] = [];
  const auditoria: Record<string, unknown>[] = [];
  const cumple = (p: PracticaAnalitica, f: FiltroAnalitica) =>
    (!f.periodos || f.periodos.includes(p.periodoAcademico)) && (!f.escuelaIds || f.escuelaIds.includes(p.escuelaId))
    && (!f.programaId || p.programaId === f.programaId) && (!f.modalidad || p.modalidad === f.modalidad) && (!f.estado || p.estado === f.estado)
    && (!f.ciclo || p.ciclo === f.ciclo) && (f.semestre === undefined || p.semestre === f.semestre)
    && (!f.modalidades || f.modalidades.includes(p.modalidad))
    && (!f.sector || (f.sector === '__sin_dato__' ? p.sector === null : p.sector === f.sector))
    && (!f.ciudad || (f.ciudad === '__internacional__' ? conSemestre && p.internacional : f.ciudad === '__sin_dato__' ? p.ciudad === null && !(conSemestre && p.internacional) : p.ciudad === f.ciudad)) && (!f.empresa || (f.empresa === SIN_EMPRESA ? p.empresa === null : p.empresa === f.empresa));
  const puerto: ReportesAnaliticaPort = {
    periodos: async (escuelas) => practicas.filter((p) => !escuelas || escuelas.includes(p.escuelaId)).map((p) => ({ codigo: p.periodoAcademico, inicio: INICIOS[p.periodoAcademico] ?? null })),
    periodosSinteticos: async (escuelas) => (conSemestre ? [...new Set(practicas.filter((p) => p.semestre !== null && (!escuelas || escuelas.includes(p.escuelaId))).map((p) => p.periodoAcademico))] : []),
    semestreSintetico: () => conSemestre,
    programasSinteticos: () => conSemestre,
    ubicacionSintetica: () => conSemestre,
    universo: async (escuelas) => {
      const visibles = practicas.filter((p) => !escuelas || escuelas.includes(p.escuelaId));
      return { estudiantes: new Set(visibles.map((p) => p.estudianteId)).size, practicas: visibles.length };
    },
    // Como el adaptador real: sin la ubicación sintética, la marca internacional nunca llega.
    practicas: async (f) => { consultas.push(f); return practicas.filter((p) => cumple(p, f)).map((p) => (conSemestre ? p : { ...p, internacional: false })); },
    versiones: async (f) => {
      const ids = new Set(practicas.filter((p) => cumple(p, f)).map((p) => p.id));
      return versiones.filter((v) => ids.has(v.practicaId));
    },
  };
  const caso = new ReportesAnaliticaUseCase(puerto, { registrar: async (r: Record<string, unknown>) => { auditoria.push(r); } } as never);
  return { caso, consultas, auditoria };
}

const EXIGIDOS = documentosExigidos(ModalidadPractica.PASANTIA).length;

describe('Reportes · analítica (solo lectura)', () => {
  it('exige un perfil de reportes', async () => {
    const { caso } = armar();
    await expect(caso.analitica({}, estudiante)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(caso.detalle({}, {}, estudiante)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(caso.csv({}, {}, estudiante)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cuenta estudiantes únicos y prácticas por separado, sin duplicar por versiones', async () => {
    const { caso } = armar();
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.resumen.practicas).toBe(4);
    expect(r.resumen.estudiantes).toBe(3);
    // Tres prácticas con matriz conocida; la modalidad desconocida no suma obligaciones ni se inventa.
    expect(r.resumen.exigidos).toBe(3 * EXIGIDOS);
    expect(r.expedientes.sin_matriz).toBe(1);
    // Las dos versiones de el ARL de p1 son UNA obligación aprobada.
    expect(r.documental.aprobado).toBe(1);
    expect(r.documental.en_revision).toBe(1);
    expect(r.documental.correccion).toBe(1);
    const suma = Object.values(r.documental).reduce((n, x) => n + x, 0);
    expect(suma).toBe(r.resumen.exigidos);
    expect(r.resumen.aprobados).toBe(1);
    // Cargado no se mezcla con aprobado: la EPS en revisión cuenta como cargada y no como aprobada.
    expect(r.resumen.cargados).toBe(2);
  });

  it('clasifica los expedientes en categorías excluyentes que suman las prácticas', async () => {
    const { caso } = armar();
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.expedientes.requiere_correccion).toBe(1);
    expect(r.expedientes.en_curso).toBe(1);
    expect(r.expedientes.sin_iniciar).toBe(1);
    expect(Object.values(r.expedientes).reduce((n, x) => n + x, 0)).toBe(r.resumen.practicas);
  });

  it('mide fricción y tiempos solo con eventos auditados', async () => {
    const { caso } = armar();
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    const arl = r.friccion.find((f) => f.tipo === String(TipoDocumento.CERTIFICADO_ARL));
    expect(arl).toMatchObject({ documentos: 1, versiones: 2, conReenvio: 1, devoluciones: 1, rechazos: 0, promedioVersiones: 2 });
    expect(r.tiempos.decisiones).toBe(3);
    expect(r.tiempos.medianaHoras).toBe(4);
    expect(r.tiempos.p90Horas).toBe(10);
  });

  it('arma 12 semanas que empiezan el lunes en hora de Bogotá', async () => {
    const { caso } = armar();
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.semanas).toHaveLength(12);
    const actual = r.semanas[11];
    expect(actual.semana).toBe('2026-09-14');
    // Cargas del 14 y 15 de septiembre (v2, v3, v4) y decisiones de esa semana.
    expect(actual).toMatchObject({ cargas: 3, aprobaciones: 1, devoluciones: 1 });
    expect(r.semanas[10]).toMatchObject({ semana: '2026-09-07', cargas: 1, devoluciones: 1 });
  });

  it('una carga del domingo 21:00 en Bogotá cae en la semana del domingo, no en la del lunes UTC', async () => {
    const { caso } = armar([PRACTICAS[0]], [version({ id: 'x', practicaId: 'p1', cargadoEn: h('2026-09-14T02:00:00.000Z') })]);
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.semanas[10]).toMatchObject({ semana: '2026-09-07', cargas: 1 });
    expect(r.semanas[11].cargas).toBe(0);
  });

  it('agrupa por periodo en orden cronológico y separa escuela → programa', async () => {
    const { caso } = armar();
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.periodos.map((p) => p.periodo)).toEqual(['2026A', '2026C']);
    expect(r.periodosDisponibles).toEqual(['2026C', '2026A']);
    const negocios = r.escuelas.find((e) => e.escuela === 'ESC-NEG');
    expect(negocios).toMatchObject({ nombre: 'Negocios', practicas: 3, estudiantes: 2 });
    expect(negocios?.programas.reduce((n, p) => n + p.practicas, 0)).toBe(3);
    expect(r.empresas.map(({ empresa, practicas, estudiantes }) => ({ empresa, practicas, estudiantes }))).toEqual([{ empresa: 'Andina S.A.S.', practicas: 3, estudiantes: 2 }, { empresa: null, practicas: 1, estudiantes: 1 }]);
  });

  it('el docente solo alcanza sus escuelas aunque pida otra', async () => {
    const { caso, consultas } = armar();
    const propia = await caso.analitica({}, docenteNegocios, AHORA);
    expect(propia.resumen.practicas).toBe(3);
    expect(consultas.every((c) => c.escuelaIds?.join() === 'ESC-NEG')).toBe(true);
    const ajena = await caso.analitica({ escuela: 'ESC-ING' }, docenteNegocios, AHORA);
    expect(ajena.resumen.practicas).toBe(0);
    expect(ajena.periodosDisponibles).toEqual(['2026C', '2026A']);
  });

  it('los filtros viajan al puerto', async () => {
    const { caso, consultas } = armar();
    const r = await caso.analitica({ periodos: ['2026C'], modalidad: ModalidadPractica.PASANTIA, estado: 'activa', programa: 'ADM-PRO' }, coordinacionGeneral, AHORA);
    expect(consultas[0]).toMatchObject({ periodos: ['2026C'], modalidad: 'pasantia', estado: 'activa', programaId: 'ADM-PRO' });
    expect(r.resumen).toMatchObject({ practicas: 1, estudiantes: 1 });
  });

  it('sin datos devuelve ceros y listas vacías, no errores', async () => {
    const { caso } = armar([], []);
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.resumen).toMatchObject({ estudiantes: 0, practicas: 0, exigidos: 0, cargados: 0, aprobados: 0, correccion: 0, completos: 0, versiones: 0, devoluciones: 0 });
    expect(r.universo).toEqual({ estudiantes: 0, practicas: 0 });
    expect(r.niveles).toEqual([]);
    expect(r.programas).toEqual([]);
    expect(r.cruces.programaModalidad).toEqual([]);
    expect(r.tiempos).toEqual({ decisiones: 0, medianaHoras: null, p90Horas: null, porTipo: [], muestras: [] });
    expect(r.semanas.every((s) => s.cargas === 0)).toBe(true);
    expect(r.periodos).toEqual([]);
    expect(r.empresas).toEqual([]);
  });

  it('el detalle coincide con los agregados', async () => {
    const { caso } = armar();
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    const todo = await caso.detalle({}, {}, coordinacionGeneral);
    expect(todo.total).toBe(r.resumen.practicas);
    expect(todo.estudiantesUnicos).toBe(r.resumen.estudiantes);
    const correccion = await caso.detalle({}, { situacion: 'requiere_correccion' }, coordinacionGeneral);
    expect(correccion.total).toBe(r.expedientes.requiere_correccion);
    const epsRevision = await caso.detalle({}, { tipo: TipoDocumento.CERTIFICADO_EPS, estadoDocumental: 'en_revision' }, coordinacionGeneral);
    expect(epsRevision.filas.map((f) => f.practicaId)).toEqual(['p1']);
    expect(Object.keys(todo.filas[0])).not.toEqual(expect.arrayContaining(['documento', 'correo']));
  });

  it('rechaza segmentos desconocidos', async () => {
    const { caso } = armar();
    await expect(caso.detalle({}, { situacion: 'otra' as never }, coordinacionGeneral)).rejects.toBeInstanceOf(BadRequestException);
    await expect(caso.detalle({}, { estadoDocumental: 'x' as never }, coordinacionGeneral)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el CSV es filtrado, sin datos sensibles, protegido contra fórmulas y auditado', async () => {
    const { caso, auditoria } = armar([practica({ id: 'p1', estudianteId: 'e1', estudiante: '=HYPERLINK("x")' })], []);
    const archivo = await caso.csv({ periodos: ['2026C'] }, {}, coordinacionGeneral);
    const texto = archivo.contenido.toString('utf8');
    expect(texto.startsWith('\uFEFFEstudiante;Programa')).toBe(true);
    expect(texto).toContain(`"'=HYPERLINK(""x"")"`);
    expect(texto).not.toMatch(/correo|documento de identidad/i);
    expect(archivo.filas).toBe(1);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ accion: 'reporte_generado', entidad: 'reporte_analitica', metadatos: { periodos: ['2026C'], filas: 1 } });
  });

  it('ordena periodos y protege celdas', () => {
    expect(['2026C', '2025-2', '2026A', '2026-1', 'otro'].sort(compararPeriodos)).toEqual(['2025-2', '2026-1', '2026A', '2026C', 'otro']);
    expect(celdaCsv('+57 300')).toBe(`'+57 300`);
    expect(celdaCsv('a;b')).toBe('"a;b"');
    expect(celdaCsv(null)).toBe('');
  });
});

/** Universo sintético más grande para cerrar cifras por dimensión y cruces (sin datos reales). */
const PROGRAMAS = ['SIS-PRO', 'SIS-TGO', 'ADM-PRO'];
const CICLOS = ['profesional', 'tecnologo', 'profesional'];
const MODALIDADES = [ModalidadPractica.PASANTIA, ModalidadPractica.SOCIAL, ModalidadPractica.MONITORIA];
const GRANDE: PracticaAnalitica[] = Array.from({ length: 30 }, (_, i) => practica({
  id: `g${i}`, estudianteId: `s${i % 24}`, estudiante: `Persona Sintética ${i % 24}`,
  programaId: PROGRAMAS[i % 3], ciclo: CICLOS[i % 3], escuelaId: i % 3 === 2 ? 'ESC-NEG' : 'ESC-ING',
  escuela: i % 3 === 2 ? 'Negocios' : 'Ingeniería', modalidad: MODALIDADES[Math.floor(i / 3) % 3],
  periodoAcademico: i < 24 ? '2026-2' : '2026-1', empresa: i % 4 === 0 ? null : `Empresa Demo ${i % 5}`,
}));
// Varias versiones por práctica: nunca deben multiplicar estudiantes ni prácticas.
const GRANDE_V: VersionAnalitica[] = GRANDE.flatMap((p, i) => [
  version({ id: `${p.id}-a1`, practicaId: p.id, tipo: TipoDocumento.CERTIFICADO_EPS, version: 1, estado: EstadoDocumento.DEVUELTO, decision: 'devolver', decididoEn: h('2026-09-14T20:00:00.000Z') }),
  version({ id: `${p.id}-a2`, practicaId: p.id, tipo: TipoDocumento.CERTIFICADO_EPS, version: 2, estado: i % 2 ? EstadoDocumento.APROBADO : EstadoDocumento.DEVUELTO }),
  version({ id: `${p.id}-b1`, practicaId: p.id, tipo: TipoDocumento.CERTIFICADO_ARL, version: 1, estado: EstadoDocumento.EN_REVISION }),
]);
const unicos = (l: PracticaAnalitica[]) => new Set(l.map((p) => p.estudianteId)).size;

describe('Reportes · jerarquía analítica y consistencia', () => {
  it('general → programa → detalle: los números cierran por estudiantes únicos', async () => {
    const { caso } = armar(GRANDE, GRANDE_V);
    const general = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(general.resumen).toMatchObject({ practicas: 30, estudiantes: 24 });
    expect(general.universo).toEqual({ estudiantes: 24, practicas: 30 });
    for (const programa of PROGRAMAS) {
      const esperado = GRANDE.filter((p) => p.programaId === programa);
      const fila = general.programas.find((x) => x.programa === programa);
      const filtrado = await caso.analitica({ programa }, coordinacionGeneral, AHORA);
      const detalle = await caso.detalle({ programa }, {}, coordinacionGeneral);
      expect(fila).toMatchObject({ estudiantes: unicos(esperado), practicas: esperado.length });
      expect(filtrado.resumen).toMatchObject({ estudiantes: unicos(esperado), practicas: esperado.length });
      expect(detalle).toMatchObject({ total: esperado.length, estudiantesUnicos: unicos(esperado) });
      // El universo «en alcance» no cambia con el filtro.
      expect(filtrado.universo.estudiantes).toBe(24);
    }
  });

  it('los cruces cierran contra el filtro combinado (periodo+programa, programa+nivel, programa+modalidad, nivel+modalidad)', async () => {
    const { caso } = armar(GRANDE, GRANDE_V);
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    const casos: [keyof typeof r.cruces, (c: { fila: string; columna: string }) => Record<string, unknown>][] = [
      ['periodoPrograma', (c) => ({ periodos: [c.fila], programa: c.columna })],
      ['programaNivel', (c) => ({ programa: c.fila, ciclo: c.columna })],
      ['programaModalidad', (c) => ({ programa: c.fila, modalidad: c.columna })],
      ['nivelModalidad', (c) => ({ ciclo: c.fila, modalidad: c.columna })],
      ['periodoModalidad', (c) => ({ periodos: [c.fila], modalidad: c.columna })],
      ['periodoNivel', (c) => ({ periodos: [c.fila], ciclo: c.columna })],
    ];
    for (const [cruce, filtro] of casos) {
      expect(r.cruces[cruce].reduce((n, c) => n + c.practicas, 0)).toBe(30);
      for (const celda of r.cruces[cruce]) {
        const d = await caso.detalle(filtro(celda), {}, coordinacionGeneral);
        expect([cruce, d.total, d.estudiantesUnicos]).toEqual([cruce, celda.practicas, celda.estudiantes]);
      }
    }
  });

  it('nivel de formación: orden técnico, tecnólogo, profesional y avance por nivel que suma el total', async () => {
    const { caso } = armar(GRANDE, GRANDE_V);
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.niveles.map((n) => n.ciclo)).toEqual(['tecnologo', 'profesional']);
    expect(r.niveles.reduce((n, x) => n + x.exigidos, 0)).toBe(r.resumen.exigidos);
    expect(r.niveles.reduce((n, x) => n + x.aprobados, 0)).toBe(r.resumen.aprobados);
    expect(['profesional', 'otro', 'tecnico', 'tecnologo'].sort(compararCiclos)).toEqual(['tecnico', 'tecnologo', 'profesional', 'otro']);
    expect(r.programas.find((p) => p.programa === 'SIS-TGO')?.ciclos).toEqual(['tecnologo']);
  });

  it('volumen y tasa de corrección por programa: historial sin multiplicar prácticas', async () => {
    const { caso } = armar(GRANDE, GRANDE_V);
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    const sis = r.programas.find((p) => p.programa === 'SIS-PRO');
    expect(sis).toMatchObject({ practicas: 10, versiones: 30, documentos: 20, conReenvio: 10, devoluciones: 10 });
    // Las obligaciones por estado suman los exigidos del programa.
    expect(Object.values(sis!.obligaciones).reduce((n, x) => n + x, 0)).toBe(sis!.exigidos);
  });

  it('situación del expediente como filtro: agregados y detalle iguales', async () => {
    const { caso } = armar(GRANDE, GRANDE_V);
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    const s = await caso.analitica({ situacion: 'requiere_correccion' }, coordinacionGeneral, AHORA);
    const d = await caso.detalle({ situacion: 'requiere_correccion' }, {}, coordinacionGeneral);
    expect(s.resumen.practicas).toBe(r.expedientes.requiere_correccion);
    expect(d.total).toBe(s.resumen.practicas);
    expect(d.estudiantesUnicos).toBe(s.resumen.estudiantes);
    await expect(caso.analitica({ situacion: 'x' as never }, coordinacionGeneral)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('empresa: todas listadas, NULL como sin empresa y filtrable sin inventar un nombre', async () => {
    const { caso } = armar(GRANDE, GRANDE_V);
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.empresas.reduce((n, e) => n + e.practicas, 0)).toBe(30);
    const sin = r.empresas.find((e) => e.empresa === null);
    const d = await caso.detalle({ empresa: SIN_EMPRESA }, {}, coordinacionGeneral);
    expect(d.total).toBe(sin?.practicas);
    expect(d.filas.every((f) => f.empresa === null)).toBe(true);
  });

  it('la búsqueda del detalle encuentra por nombre, programa o empresa sin tildes y no cambia los agregados', async () => {
    const { caso } = armar(GRANDE, GRANDE_V);
    expect((await caso.detalle({}, {}, coordinacionGeneral, 'sintetica 5')).filas.every((f) => f.estudiante.startsWith('Persona Sintética 5'))).toBe(true);
    expect((await caso.detalle({}, {}, coordinacionGeneral, 'adm-pro')).total).toBe(10);
    expect((await caso.detalle({}, {}, coordinacionGeneral, 'empresa demo 1')).total).toBeGreaterThan(0);
  });

  it('el docente no alcanza otras escuelas con las dimensiones nuevas', async () => {
    const { caso } = armar(GRANDE, GRANDE_V);
    const r = await caso.analitica({ programa: 'SIS-PRO' }, docenteNegocios, AHORA);
    expect(r.resumen.practicas).toBe(0);
    const propio = await caso.analitica({}, docenteNegocios, AHORA);
    expect(propio.programas.map((p) => p.programa)).toEqual(['ADM-PRO']);
    expect(propio.universo.practicas).toBe(10);
  });

  it('el detalle puede limitar las filas sin cambiar sus totales', async () => {
    const { caso } = armar(GRANDE, GRANDE_V);
    const d = await caso.detalle({}, {}, coordinacionGeneral, '', 5);
    expect(d).toMatchObject({ total: 30, estudiantesUnicos: 24 });
    expect(d.filas).toHaveLength(5);
  });

  it('el CSV incluye nivel, pendientes y devoluciones del filtro y de la búsqueda', async () => {
    const { caso, auditoria } = armar(GRANDE, GRANDE_V);
    const archivo = await caso.csv({ programa: 'SIS-TGO', ciclo: 'tecnologo' }, {}, coordinacionGeneral, 'Persona');
    const [cabecera, ...filas] = archivo.contenido.toString('utf8').trim().split('\r\n');
    expect(cabecera).toContain('Nivel de formación;Modalidad');
    expect(cabecera).toContain('Pendientes;En corrección;Devoluciones (historial)');
    expect(filas).toHaveLength(10);
    expect(auditoria[0]).toMatchObject({ metadatos: { programa: 'SIS-TGO', ciclo: 'tecnologo', buscar: 'Persona', filas: 10 } });
  });
});

describe('Reportes · semestre sintético aislado y orden de periodos', () => {
  const CON_SEMESTRE = GRANDE.map((p, i) => ({ ...p, semestre: i % 7 === 6 ? null : 4 + (i % 6) }));

  it('sin fuente de semestre: dimensión no disponible, sin grupos y el filtro responde 400', async () => {
    const { caso } = armar(GRANDE, GRANDE_V);
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.dimensiones.semestre).toBe('no_disponible');
    expect(r.semestres).toEqual([]);
    expect(r.cruces.semestreModalidad).toEqual([]);
    await expect(caso.analitica({ semestre: 8 }, coordinacionGeneral)).rejects.toBeInstanceOf(BadRequestException);
    const csv = (await caso.csv({}, {}, coordinacionGeneral)).contenido.toString('utf8');
    expect(csv).not.toContain('Semestre');
  });

  it('con el overlay sintético: semestres en orden numérico, sin información al final, y cifras que cierran con el detalle', async () => {
    const { caso } = armar(CON_SEMESTRE, GRANDE_V, true);
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.dimensiones.semestre).toBe('sintetica');
    expect(r.semestres.map((s) => s.semestre)).toEqual([4, 5, 6, 7, 8, 9, null]);
    expect(r.semestres.reduce((n, s) => n + s.practicas, 0)).toBe(30);
    for (const s of r.semestres.filter((x) => x.semestre !== null)) {
      const d = await caso.detalle({ semestre: s.semestre as number }, {}, coordinacionGeneral);
      expect([s.semestre, d.total, d.estudiantesUnicos]).toEqual([s.semestre, s.practicas, s.estudiantes]);
      expect(Object.values(s.obligaciones).reduce((n, x) => n + x, 0)).toBe(s.exigidos);
    }
    for (const c of r.cruces.semestreModalidad.filter((x) => x.fila !== '')) {
      const d = await caso.detalle({ semestre: Number(c.fila), modalidad: c.columna }, {}, coordinacionGeneral);
      expect(d.total).toBe(c.practicas);
    }
    const prog = r.cruces.programaSemestre.find((c) => c.columna === '8');
    const d = await caso.detalle({ programa: prog!.fila, semestre: 8 }, {}, coordinacionGeneral);
    expect(d.estudiantesUnicos).toBe(prog!.estudiantes);
    expect((await caso.csv({}, {}, coordinacionGeneral)).contenido.toString('utf8')).toContain('Semestre (dato sintético de prueba)');
  });

  it('ordena los periodos por la fecha de inicio de la entidad; los códigos sin fecha van al final y se declaran', async () => {
    const mezcla = GRANDE.slice(0, 5).map((p, i) => ({ ...p, periodoAcademico: ['26V01', '2026C', '335', '2026A', '2026-2'][i] }));
    const { caso } = armar(mezcla, []);
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.ordenPeriodos).toEqual(['2026A', '2026C', '2026-2', '26V01', '335']);
    expect(r.periodos.map((p) => p.periodo)).toEqual(r.ordenPeriodos);
    expect(r.periodosDisponibles).toEqual(['2026-2', '2026C', '2026A', '26V01', '335']);
    expect(r.periodosSinFecha.sort()).toEqual(['26V01', '335']);
  });
});

describe('Reportes · nombres de programa sintéticos', () => {
  it('sin mapping: nombre null y el código como dato; con mapping: nombre en agregados, detalle, búsqueda y CSV', async () => {
    const sin = armar(GRANDE, GRANDE_V);
    const r0 = await sin.caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r0.dimensiones.nombrePrograma).toBe('no_disponible');
    expect(r0.programas.every((p) => p.nombre === null)).toBe(true);
    const nombres: Record<string, string> = { 'SIS-PRO': 'Ingeniería de Sistemas', 'SIS-TGO': 'Tecnología en Sistemas', 'ADM-PRO': 'Administración de Empresas' };
    const con = armar(GRANDE.map((p) => ({ ...p, programaNombre: nombres[p.programaId] })), GRANDE_V, true);
    const r = await con.caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.dimensiones.nombrePrograma).toBe('sintetico');
    expect(r.programas.find((p) => p.programa === 'SIS-PRO')?.nombre).toBe('Ingeniería de Sistemas');
    const d = await con.caso.detalle({}, {}, coordinacionGeneral, 'ingenieria de sistemas');
    expect(d.total).toBe(10);
    expect(d.filas[0].programaNombre).toBe('Ingeniería de Sistemas');
    expect((await con.caso.csv({ programa: 'SIS-PRO' }, {}, coordinacionGeneral)).contenido.toString('utf8')).toContain('Nombre del programa (dato sintético de prueba)');
  });
});

describe('Reportes · organización receptora (sector CIIU, ciudad DIVIPOLA, interna CUN por modalidad articulada)', () => {
  const SECTORES: [string, string][] = [['J', 'Información y comunicaciones'], ['C', 'Industrias manufactureras'], ['P', 'Educación']];
  const CIUDADES: [string, string][] = [['11001', 'Bogotá, D.C.'], ['05001', 'Medellín']];
  const ORG = GRANDE.map((p, i) => {
    const interna = i % 5 === 0;
    const [sector, sectorNombre] = interna ? SECTORES[2] : SECTORES[i % 2];
    const [ciudad, ciudadNombre] = interna ? CIUDADES[0] : i % 7 === 3 ? [null, null] : CIUDADES[i % 2];
    return { ...p, modalidad: interna ? ModalidadPractica.MONITORIA : ModalidadPractica.PASANTIA, empresa: interna ? 'CUN · Práctica interna' : `Empresa ${i % 4}`,
      sector, sectorNombre, ciudad, ciudadNombre };
  });

  it('interna CUN = modalidad articulada del dominio (las 7 articuladas), externa = las demás', () => {
    expect([...MODALIDADES_ARTICULADAS].sort()).toEqual(['cunbre_consolidado', 'cunbre_naciente', 'investigacion', 'monitoria', 'pasantia_investigativa', 'practica_tecnica_investigacion', 'social']);
    expect(tipoReceptor('monitoria')).toBe('interna_cun');
    expect(tipoReceptor('pasantia')).toBe('externa');
    expect(tipoReceptor('inexistente')).toBeNull();
  });

  it('receptores, sectores y ciudades suman el universo y cierran contra el detalle filtrado', async () => {
    const { caso } = armar(ORG, GRANDE_V);
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.receptores.map((x) => [x.tipo, x.practicas])).toEqual([['interna_cun', 6], ['externa', 24]]);
    expect(r.sectores.reduce((n, x) => n + x.practicas, 0)).toBe(30);
    expect(r.ciudades.reduce((n, x) => n + x.practicas, 0)).toBe(30);
    expect(r.etiquetas.sectores['P']).toBe('Educación');
    for (const t of ['interna_cun', 'externa'] as const) {
      const d = await caso.detalle({ tipoReceptor: t }, {}, coordinacionGeneral);
      expect(d.total).toBe(r.receptores.find((x) => x.tipo === t)?.practicas);
      expect(d.filas.every((f) => f.tipoReceptor === t)).toBe(true);
    }
    for (const s of r.sectores) {
      const d = await caso.detalle({ sector: s.sector ?? SIN_DATO }, {}, coordinacionGeneral);
      expect([s.sector, d.total, d.estudiantesUnicos]).toEqual([s.sector, s.practicas, s.estudiantes]);
    }
    const sinCiudad = r.ciudades.find((c) => c.ciudad === null);
    expect((await caso.detalle({ ciudad: SIN_DATO }, {}, coordinacionGeneral)).total).toBe(sinCiudad?.practicas);
    for (const c of r.cruces.programaSector) {
      const d = await caso.detalle({ programa: c.fila, sector: c.columna || SIN_DATO }, {}, coordinacionGeneral);
      expect(d.total).toBe(c.practicas);
    }
    const interna = await caso.analitica({ tipoReceptor: 'interna_cun' }, coordinacionGeneral, AHORA);
    expect(interna.sectores.map((x) => x.nombre)).toEqual(['Educación']);
    await expect(caso.analitica({ tipoReceptor: 'otra' as never }, coordinacionGeneral)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('los filtros nuevos no amplían el alcance del docente', async () => {
    const { caso, consultas } = armar(ORG, GRANDE_V);
    const r = await caso.analitica({ sector: 'J', ciudad: '05001', tipoReceptor: 'externa' }, docenteNegocios, AHORA);
    expect(consultas.at(-1)?.escuelaIds).toEqual(['ESC-NEG']);
    expect(r.resumen.practicas).toBe(ORG.filter((p) => p.escuelaId === 'ESC-NEG' && p.sector === 'J' && p.ciudad === '05001' && p.modalidad === ModalidadPractica.PASANTIA).length);
  });

  it('el CSV lleva organización, tipo, sector y ciudad, sin NIT ni contacto', async () => {
    const { caso } = armar(ORG, GRANDE_V);
    const csv = (await caso.csv({}, {}, coordinacionGeneral)).contenido.toString('utf8');
    expect(csv).toContain('Organización receptora;Tipo de receptor;Sector económico (sección CIIU);Ciudad');
    expect(csv).toContain('interna_cun');
    expect(csv).not.toMatch(/\bnit\b|tel[eé]fono|correo|direcci[oó]n/i);
  });
});

describe('Reportes · internacional frente a sin información', () => {
  const MIX = GRANDE.map((p, i) => ({ ...p, ciudad: i < 10 ? '11001' : null, ciudadNombre: i < 10 ? 'Bogotá, D.C.' : null, internacional: i >= 10 && i < 16 }));

  it('sin ubicación sintética (producción): las receptoras sin municipio quedan todas en «sin dato»', async () => {
    const { caso } = armar(MIX, GRANDE_V);
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.dimensiones.ubicacionInternacional).toBe('no_disponible');
    expect(r.ciudades.map((c) => [c.ciudad, c.practicas])).toEqual([[null, 20], ['11001', 10]]);
  });

  it('con ubicación sintética (dev): «Internacional · sin DIVIPOLA» separado de «Sin información», y el filtro cierra', async () => {
    const { caso } = armar(MIX, GRANDE_V, true);
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.dimensiones.ubicacionInternacional).toBe('sintetica');
    expect(r.ciudades.map((c) => [c.ciudad, c.nombre, c.practicas])).toEqual([[null, null, 14], ['11001', 'Bogotá, D.C.', 10], ['__internacional__', 'Internacional · sin DIVIPOLA', 6]]);
    expect((await caso.detalle({ ciudad: '__internacional__' }, {}, coordinacionGeneral)).total).toBe(6);
    expect((await caso.detalle({ ciudad: SIN_DATO }, {}, coordinacionGeneral)).total).toBe(14);
    const d = await caso.detalle({ ciudad: '__internacional__' }, {}, coordinacionGeneral);
    expect(d.filas.every((f) => f.ciudad === 'Internacional · sin DIVIPOLA')).toBe(true);
  });
});

/**
 * V3.2 · filtrado por facetas. Universo sintético: dos programas, dos niveles, interna y externa, dos sectores, dos ciudades
 * (una en el exterior) y dos periodos; con semestre sintético (dev).
 */
describe('Reportes · facetas (cross-filter con lo no elegido visible)', () => {
  const P = [
    practica({ id: 'f1', estudianteId: 'g1', programaId: 'ING-SIS', ciclo: 'profesional', semestre: 8, sector: 'J', sectorNombre: 'Información', ciudad: '11001', ciudadNombre: 'Bogotá', periodoAcademico: '2026A', empresa: 'Uno S.A.S.' }),
    practica({ id: 'f2', estudianteId: 'g2', programaId: 'ING-SIS', ciclo: 'tecnologo', semestre: 5, sector: 'P', sectorNombre: 'Educación', ciudad: '05001', ciudadNombre: 'Medellín', periodoAcademico: '2026A', empresa: 'Dos S.A.S.' }),
    practica({ id: 'f3', estudianteId: 'g3', programaId: 'ADM-PRO', ciclo: 'profesional', semestre: 8, sector: 'J', sectorNombre: 'Información', ciudad: null, internacional: true, periodoAcademico: '2026C', empresa: 'Tres Ltd.' }),
    practica({ id: 'f4', estudianteId: 'g4', programaId: 'ADM-PRO', ciclo: 'profesional', semestre: 9, modalidad: MODALIDADES_ARTICULADAS[0], sector: 'P', sectorNombre: 'Educación', ciudad: '11001', ciudadNombre: 'Bogotá', periodoAcademico: '2026C', empresa: 'CUN' }),
    practica({ id: 'f5', estudianteId: 'g5', programaId: 'ADM-PRO', ciclo: 'tecnologo', semestre: null, periodoAcademico: '2026-2', empresa: null }),
  ];
  const V = [
    version({ id: 'w1', practicaId: 'f1', estado: EstadoDocumento.APROBADO, cargadoEn: h('2026-09-01T10:00:00Z'), decididoEn: h('2026-09-01T14:00:00Z'), decision: 'aprobar' }),
    version({ id: 'w2', practicaId: 'f3', estado: EstadoDocumento.DEVUELTO, cargadoEn: h('2026-09-02T10:00:00Z'), decididoEn: h('2026-09-03T10:00:00Z'), decision: 'devolver' }),
  ];
  const conjunto = (r: { programa?: string }[], k: string) => r.map((x) => (x as Record<string, unknown>)[k]).sort();

  it('sin filtros, cada faceta es el universo filtrado (y no hay consulta extra)', async () => {
    const { caso, consultas } = armar(P, V, true);
    const r = await caso.analitica({}, coordinacionGeneral, AHORA);
    expect(consultas).toHaveLength(1);
    for (const k of FACETAS) expect(r.facetas[k]).toEqual({ estudiantes: r.resumen.estudiantes, practicas: r.resumen.practicas });
  });

  it('cada dimensión ignora SU filtro y respeta los demás; resumen y detalle usan todos (una sola consulta extra)', async () => {
    const { caso, consultas } = armar(P, V, true);
    const filtro = { programa: 'ING-SIS', ciclo: 'profesional' };
    const r = await caso.analitica(filtro, coordinacionGeneral, AHORA);
    expect(consultas).toHaveLength(2);
    expect(r.resumen.practicas).toBe(1);
    // Programa: respeta nivel profesional, ignora programa → ING-SIS (resaltado) y ADM-PRO (atenuado).
    expect(r.programas.map((p) => [p.programa, p.practicas]).sort()).toEqual([['ADM-PRO', 2], ['ING-SIS', 1]]);
    // Nivel: respeta programa, ignora nivel → los dos niveles de ING-SIS.
    expect(r.niveles.map((n) => [n.ciclo, n.practicas])).toEqual([['tecnologo', 1], ['profesional', 1]]);
    // Invariante: cada faceta coincide con el reporte pedido SIN ese filtro.
    const sinPrograma = await caso.analitica({ ciclo: 'profesional' }, coordinacionGeneral, AHORA);
    expect(r.programas).toEqual(sinPrograma.programas);
    expect(r.facetas.programa).toEqual({ estudiantes: sinPrograma.resumen.estudiantes, practicas: sinPrograma.resumen.practicas });
    const sinNivel = await caso.analitica({ programa: 'ING-SIS' }, coordinacionGeneral, AHORA);
    expect(r.niveles).toEqual(sinNivel.niveles);
    // Lo que no es faceta sigue con todos los filtros.
    expect(r.periodos.map((p) => p.practicas)).toEqual([1]);
    const d = await caso.detalle(filtro, {}, coordinacionGeneral);
    expect(d.total).toBe(r.resumen.practicas);
  });

  it('invariantes por faceta: sector, ciudad (internacional / sin dato), receptor, empresa, semestre y situación', async () => {
    const { caso } = armar(P, V, true);
    const filtros = [
      { sector: 'J' }, { sector: SIN_DATO }, { ciudad: '__internacional__' }, { ciudad: SIN_DATO }, { ciudad: '11001' },
      { tipoReceptor: 'interna_cun' as const }, { empresa: SIN_EMPRESA }, { empresa: 'Uno S.A.S.' }, { semestre: 8 },
      { situacion: 'requiere_correccion' as const }, { sector: 'P', ciudad: '11001', periodos: ['2026C'] },
    ];
    const campo = { sector: 'sectores', ciudad: 'ciudades', tipoReceptor: 'receptores', empresa: 'empresas', semestre: 'semestres' } as const;
    for (const f of filtros) {
      const r = await caso.analitica(f, coordinacionGeneral, AHORA);
      for (const k of Object.keys(f).filter((x) => x !== 'periodos') as (keyof typeof f)[]) {
        const sin = await caso.analitica({ ...f, [k]: undefined }, coordinacionGeneral, AHORA);
        if (k === 'situacion') expect(r.expedientes).toEqual(sin.expedientes);
        else expect(r[campo[k as keyof typeof campo]]).toEqual(sin[campo[k as keyof typeof campo]]);
        expect(r.facetas[k as keyof typeof r.facetas].practicas).toBe(sin.resumen.practicas);
      }
      // El universo filtrado (KPI, detalle) no cambia: el mismo que el SQL con todos los filtros.
      const d = await caso.detalle(f, {}, coordinacionGeneral);
      expect(r.resumen.practicas).toBe(d.total);
    }
  });

  it('las distribuciones suman su universo: interna + externa = prácticas; situaciones = prácticas', async () => {
    const { caso } = armar(P, V, true);
    for (const f of [{}, { programa: 'ADM-PRO' }, { tipoReceptor: 'externa' as const }, { situacion: 'completo' as const }]) {
      const r = await caso.analitica(f, coordinacionGeneral, AHORA);
      expect(r.receptores.reduce((n, x) => n + x.practicas, 0)).toBe(r.facetas.tipoReceptor.practicas);
      expect(Object.values(r.expedientes).reduce((n, x) => n + x, 0)).toBe(r.facetas.situacion.practicas);
      expect(r.cruces.modalidadSituacion.reduce((n, c) => n + c.practicas, 0)).toBe(r.facetas.situacion.practicas);
      expect(r.programas.reduce((n, x) => n + x.practicas, 0)).toBe(r.facetas.programa.practicas);
    }
  });

  it('dataset sintético: periodos del overlay en orden cronológico (dev); sin overlay, null', async () => {
    const dev = await armar(P, V, true).caso.analitica({}, coordinacionGeneral, AHORA);
    expect(dev.dataset).toEqual({ periodos: ['2026A', '2026C'] });
    const prod = await armar(P, V, false).caso.analitica({}, coordinacionGeneral, AHORA);
    expect(prod.dataset).toBeNull();
  });

  it('jerarquía escuela → programa → nivel → semestre suma los estudiantes; sin overlay, semestre null', async () => {
    const r = await armar(P, V, true).caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.jerarquia.reduce((n, j) => n + j.estudiantes, 0)).toBe(r.resumen.estudiantes);
    expect(r.jerarquia.find((j) => j.programa === 'ADM-PRO' && j.semestre === 8)).toMatchObject({ ciclo: 'profesional', estudiantes: 1 });
    const prod = await armar(P, V, false).caso.analitica({}, coordinacionGeneral, AHORA);
    expect(prod.jerarquia.every((j) => j.semestre === null)).toBe(true);
  });

  it('tiempos: una muestra por decisión (tipo, programa, horas); estadísticas sobre todas; tope de puntos', async () => {
    const r = await armar(P, V, true).caso.analitica({}, coordinacionGeneral, AHORA);
    expect(r.tiempos.muestras).toEqual([
      { tipo: TipoDocumento.CERTIFICADO_ARL, programa: 'ING-SIS', horas: 4 },
      { tipo: TipoDocumento.CERTIFICADO_ARL, programa: 'ADM-PRO', horas: 24 },
    ]);
    const muchas = Array.from({ length: 4000 }, (_, i) => version({ id: `m${String(i).padStart(5, '0')}`, practicaId: 'f1', cargadoEn: h('2026-09-01T10:00:00Z'), decididoEn: h('2026-09-01T12:00:00Z'), decision: 'aprobar' }));
    const g = await armar(P, muchas, true).caso.analitica({}, coordinacionGeneral, AHORA);
    expect(g.tiempos.decisiones).toBe(4000);
    expect(g.tiempos.muestras.length).toBe(MAX_MUESTRAS_TIEMPO);
    const otra = await armar(P, muchas, true).caso.analitica({}, coordinacionGeneral, AHORA);
    expect(otra.tiempos.muestras).toEqual(g.tiempos.muestras);
  });

  it('las facetas no amplían el alcance del docente', async () => {
    const { caso, consultas } = armar();
    await caso.analitica({ programa: 'ADM-PRO', ciclo: 'profesional' }, docenteNegocios, AHORA);
    expect(consultas.length).toBe(2);
    expect(consultas.every((c) => c.escuelaIds?.join() === 'ESC-NEG')).toBe(true);
    void conjunto;
  });
});

/** V3.3 · reconciliación de la tira de KPI: todas las cifras pertenecen a universos que cierran (sin cambiar definiciones). */
describe('Reportes · reconciliación de KPI', () => {
  it('situaciones = prácticas; exigidas = cargadas vigentes + por reenviar (corrección + rechazo) + sin cargar; aprobadas ≤ cargadas ≤ exigidas', async () => {
    const { caso } = armar();
    for (const f of [{}, { programa: 'ADM-PRO' }, { modalidad: ModalidadPractica.PASANTIA }, { periodos: ['2026C'] }]) {
      const r = await caso.analitica(f, coordinacionGeneral, AHORA);
      const s = r.resumen, o = r.documental;
      expect(Object.values(r.expedientes).reduce((n, x) => n + x, 0)).toBe(r.facetas.situacion.practicas);
      expect(Object.values(o).reduce((n, x) => n + x, 0)).toBe(s.exigidos);
      // «Cargada» es la del dominio (versión vigente que no requiere reenvío): devuelta, ilegible o rechazada va aparte.
      expect(s.cargados + o.correccion + o.rechazado + o.sin_cargar).toBe(s.exigidos);
      expect(s.aprobados).toBe(o.aprobado);
      expect(s.aprobados).toBeLessThanOrEqual(s.cargados);
      expect(s.cargados).toBeLessThanOrEqual(s.exigidos);
      expect(s.completos).toBe(r.expedientes.completo);
      expect(r.receptores.reduce((n, x) => n + x.practicas, 0)).toBe(r.facetas.tipoReceptor.practicas);
    }
  });
});
