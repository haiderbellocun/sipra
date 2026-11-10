import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  ReportesAnaliticaUseCase, celdaCsv, compararPeriodos,
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
  periodoAcademico: '2026C', modalidad: ModalidadPractica.PASANTIA, estado: 'activa', empresa: 'Andina S.A.S.', ...s,
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
function armar(practicas = PRACTICAS, versiones = VERSIONES) {
  const consultas: FiltroAnalitica[] = [];
  const auditoria: Record<string, unknown>[] = [];
  const cumple = (p: PracticaAnalitica, f: FiltroAnalitica) =>
    (!f.periodos || f.periodos.includes(p.periodoAcademico)) && (!f.escuelaIds || f.escuelaIds.includes(p.escuelaId))
    && (!f.programaId || p.programaId === f.programaId) && (!f.modalidad || p.modalidad === f.modalidad) && (!f.estado || p.estado === f.estado);
  const puerto: ReportesAnaliticaPort = {
    periodos: async (escuelas) => practicas.filter((p) => !escuelas || escuelas.includes(p.escuelaId)).map((p) => p.periodoAcademico),
    practicas: async (f) => { consultas.push(f); return practicas.filter((p) => cumple(p, f)); },
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
    expect(r.empresas).toEqual([{ empresa: 'Andina S.A.S.', practicas: 3, estudiantes: 2 }]);
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
    expect(r.resumen).toEqual({ estudiantes: 0, practicas: 0, exigidos: 0, cargados: 0, aprobados: 0, correccion: 0, completos: 0 });
    expect(r.tiempos).toEqual({ decisiones: 0, medianaHoras: null, p90Horas: null, porTipo: [] });
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
