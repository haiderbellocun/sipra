import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DistribucionDocentesUseCase, MENSAJE_PREVIA_OBSOLETA } from '../src/application/use-cases/practicas/distribucion-docentes.use-case';
import { GestionarPracticaUseCase } from '../src/application/use-cases/practicas/gestionar-practica.use-case';
import { AccionAuditada, RegistroAuditoria } from '../src/domain/entities/auditoria.entity';
import { DatosEntradaBitacora } from '../src/domain/entities/bitacora.entity';
import { DatosPractica, EstadoPractica, ESTADOS_TERMINALES_PRACTICA, Practica } from '../src/domain/entities/practica.entity';
import { DistribucionDocentesPort } from '../src/domain/ports/out/distribucion-docentes.port';
import {
  CargaDocenteEscuela, DocenteCandidato, PracticaPorDistribuir, distribuirDocentes, firmaCanonica,
} from '../src/domain/services/distribucion-docentes.domain-service';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { actorDe, empresaDe, practicaDe, usuarioDe } from './soporte-autorizacion';

// ── Fábricas sintéticas ──────────────────────────────────────────────────────
const P = (n: number, escuela = 'ESC-ING', extra: Partial<PracticaPorDistribuir> = {}): PracticaPorDistribuir => ({
  id: `p-${String(n).padStart(5, '0')}`, escuelaId: escuela, programaId: 'PRG', estudianteId: `e-${String(n).padStart(5, '0')}`, ...extra,
});
const practicas = (n: number, escuela = 'ESC-ING', desde = 0) => Array.from({ length: n }, (_, i) => P(desde + i, escuela));
const D = (id: string, nombre: string, escuelas: string[] = ['ESC-ING'], extra: Partial<DocenteCandidato> = {}): DocenteCandidato => ({
  id, nombre, rol: 'tutor', activo: true, permiso: 'escritura', escuelas, ...extra,
});
const finales = (r: ReturnType<typeof distribuirDocentes>) => r.docentes.map((d) => d.final);
const correr = (practicasIn: PracticaPorDistribuir[], docentes: DocenteCandidato[], cargas: CargaDocenteEscuela[] = [], alcance: string[] | null = null) =>
  distribuirDocentes({ practicas: practicasIn, docentes, cargas, alcance });

function barajar<T>(lista: T[], semilla: number): T[] {
  const a = [...lista];
  let s = semilla;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

describe('G6 · algoritmo de distribución (dominio puro)', () => {
  it('1 estudiante / 1 docente', () => {
    const r = correr(practicas(1), [D('t1', 'Ana')]);
    expect(r.asignaciones).toEqual([{ practicaId: 'p-00000', tutorId: 't1' }]);
    expect(r.docentes[0]).toMatchObject({ actual: 0, nuevos: 1, final: 1 });
  });

  it('10 / 2 → 5 y 5; 11 / 2 → 6 y 5', () => {
    expect(finales(correr(practicas(10), [D('t1', 'Ana'), D('t2', 'Beto')]))).toEqual([5, 5]);
    expect(finales(correr(practicas(11), [D('t1', 'Ana'), D('t2', 'Beto')]))).toEqual([6, 5]);
  });

  it('100 / 6 → 17,17,17,17,16,16 (diferencia ≤ 1)', () => {
    const docentes = ['Ana', 'Beto', 'Carla', 'Darío', 'Elena', 'Fabio'].map((n, i) => D(`t${i}`, n));
    const f = finales(correr(practicas(100), docentes));
    expect(f).toEqual([17, 17, 17, 17, 16, 16]);
    expect(Math.max(...f) - Math.min(...f)).toBeLessThanOrEqual(1);
  });

  it('la carga previa cuenta: A=12, B=4 y 4 nuevos → los 4 a B (no 2/2)', () => {
    const r = correr(practicas(4), [D('a', 'Ana'), D('b', 'Beto')], [{ tutorId: 'a', escuelaId: 'ESC-ING', cantidad: 12 }, { tutorId: 'b', escuelaId: 'ESC-ING', cantidad: 4 }]);
    expect(r.docentes.map((d) => [d.actual, d.nuevos, d.final])).toEqual([[12, 0, 12], [4, 4, 8]]);
  });

  it('A=20, B=10, C=10 y 15 nuevos → acerca las cargas (no 5/5/5)', () => {
    const r = correr(practicas(15), [D('a', 'Ana'), D('b', 'Beto'), D('c', 'Carla')],
      [{ tutorId: 'a', escuelaId: 'ESC-ING', cantidad: 20 }, { tutorId: 'b', escuelaId: 'ESC-ING', cantidad: 10 }, { tutorId: 'c', escuelaId: 'ESC-ING', cantidad: 10 }]);
    expect(r.docentes.map((d) => d.final)).toEqual([20, 18, 17]);
    expect(r.docentes[0].nuevos).toBe(0);
  });

  it('la carga de OTRA escuela fuera del alcance del docente no cuenta', () => {
    const r = correr(practicas(2), [D('a', 'Ana'), D('b', 'Beto')], [{ tutorId: 'a', escuelaId: 'ESC-DER', cantidad: 50 }]);
    expect(finales(r)).toEqual([1, 1]);
  });

  it('docente inactivo, de solo consulta o sin escuelas: no recibe y se informa el motivo', () => {
    const r = correr(practicas(6), [D('a', 'Ana'), D('b', 'Beto', ['ESC-ING'], { activo: false }), D('c', 'Carla', ['ESC-ING'], { permiso: 'consulta' }), D('d', 'Dora', [])]);
    expect(new Set(r.asignaciones.map((x) => x.tutorId))).toEqual(new Set(['a']));
    expect(r.excluidos.map((e) => [e.id, e.motivo])).toEqual([['b', 'inactivo'], ['c', 'solo_consulta'], ['d', 'sin_escuelas']]);
  });

  it('ignora usuarios que no son docentes facilitadores', () => {
    const r = correr(practicas(2), [D('a', 'Ana'), D('x', 'Coord', ['ESC-ING'], { rol: 'coordinador' })]);
    expect(r.asignaciones.every((x) => x.tutorId === 'a')).toBe(true);
  });

  it('escuelas incompatibles y multiescuela: ESC-ING solo a A o C; ESC-NEG solo a B o C', () => {
    const docentes = [D('a', 'Ana', ['ESC-ING']), D('b', 'Beto', ['ESC-NEG']), D('c', 'Carla', ['ESC-ING', 'ESC-NEG'])];
    const lista = [...practicas(6, 'ESC-ING'), ...practicas(6, 'ESC-NEG', 100)];
    const r = correr(lista, docentes);
    const escuelaDe = new Map(lista.map((p) => [p.id, p.escuelaId]));
    for (const a of r.asignaciones) {
      const d = docentes.find((x) => x.id === a.tutorId)!;
      expect(d.escuelas).toContain(escuelaDe.get(a.practicaId));
    }
    expect(finales(r)).toEqual([4, 4, 4]);
  });

  it('sin docente elegible: «No asignables» por escuela con motivo; nunca fuera de alcance', () => {
    const r = correr([...practicas(3, 'ESC-ING'), ...practicas(2, 'ESC-DER', 50), ...practicas(1, 'ESC-SAL', 80)], [D('a', 'Ana', ['ESC-ING'])]);
    expect(r.asignaciones).toHaveLength(3);
    expect(r.noAsignables.map((g) => [g.escuelaId, g.cantidad, g.motivo])).toEqual([
      ['ESC-DER', 2, 'No hay docentes activos con alcance compatible.'], ['ESC-SAL', 1, 'No hay docentes activos con alcance compatible.'],
    ]);
  });

  it('docente de escuela sin demanda queda con menos: no es error y no se fuerzan estudiantes de otra escuela', () => {
    const r = correr(practicas(10, 'ESC-ING'), [D('a', 'Ana', ['ESC-ING']), D('b', 'Beto', ['ESC-NEG'])]);
    expect(r.docentes.map((d) => [d.id, d.nuevos])).toEqual([['a', 10], ['b', 0]]);
  });

  it('determinismo: varias permutaciones de prácticas, docentes y cargas producen la MISMA salida', () => {
    const docentes = [D('t3', 'Óscar'), D('t1', 'ana'), D('t2', 'Ána', ['ESC-ING', 'ESC-NEG']), D('t4', 'Beto', ['ESC-NEG'])];
    const lista = [...practicas(37, 'ESC-ING'), ...practicas(23, 'ESC-NEG', 500)];
    const cargas = [{ tutorId: 't3', escuelaId: 'ESC-ING', cantidad: 3 }, { tutorId: 't4', escuelaId: 'ESC-NEG', cantidad: 2 }];
    const base = correr(lista, docentes, cargas);
    for (let s = 1; s <= 8; s++) {
      expect(correr(barajar(lista, s), barajar(docentes, s + 11), barajar(cargas, s + 5))).toEqual(base);
    }
    expect(firmaCanonica({ periodoAcademico: '2026C', alcance: null, practicas: barajar(lista, 3), docentes: barajar(docentes, 4), cargas }))
      .toBe(firmaCanonica({ periodoAcademico: '2026C', alcance: null, practicas: lista, docentes, cargas: [...cargas].reverse() }));
  });

  it('desempate estable por nombre normalizado y luego id (sin azar)', () => {
    const r = correr(practicas(1), [D('z', 'Beto'), D('b', 'ána'), D('a', 'Ana')]);
    expect(r.asignaciones[0].tutorId).toBe('a'); // «ana» == «ana» → id «a» < «b»
  });

  it('rendimiento: 10.000 prácticas y 60 docentes en pocas centésimas de segundo', () => {
    const escuelas = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'];
    const lista = Array.from({ length: 10_000 }, (_, i) => P(i, escuelas[i % 6]));
    const docentes = Array.from({ length: 60 }, (_, i) => D(`t${i}`, `Docente ${i}`, [escuelas[i % 6], escuelas[(i + 1) % 6]]));
    const t = Date.now();
    const r = correr(lista, docentes);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(r.asignaciones).toHaveLength(10_000);
    const f = finales(r);
    expect(Math.max(...f) - Math.min(...f)).toBeLessThanOrEqual(1);
  });
});

// ── Caso de uso con un puerto en memoria que replica la semántica del adaptador ──
interface FilaPractica { id: string; escuelaId: string; programaId: string; estudianteId: string; periodo: string; tutorId: string | null; estado: EstadoPractica }

function montar(opciones: { filas?: FilaPractica[]; docentes?: DocenteCandidato[]; periodoActivo?: boolean } = {}) {
  const filas = new Map((opciones.filas ?? []).map((f) => [f.id, { ...f }]));
  const auditoria: RegistroAuditoria[] = [];
  const bitacora: DatosEntradaBitacora[] = [];
  let escrituras = 0;
  const docentes = opciones.docentes ?? [D('t1', 'Laura Gómez', ['ESC-ING']), D('t2', 'Carlos Ruiz', ['ESC-ING', 'ESC-NEG'])];
  const vivo = (f: FilaPractica) => !ESTADOS_TERMINALES_PRACTICA.includes(f.estado);
  const puerto: DistribucionDocentesPort = {
    practicasSinDocente: (periodo, escuelas) => Promise.resolve([...filas.values()]
      .filter((f) => f.periodo === periodo && f.tutorId === null && vivo(f) && (escuelas === null || escuelas.includes(f.escuelaId)))
      .map(({ id, escuelaId, programaId, estudianteId }) => ({ id, escuelaId, programaId, estudianteId }))),
    cargas: (periodo) => {
      const m = new Map<string, CargaDocenteEscuela>();
      for (const f of filas.values()) {
        if (f.periodo !== periodo || !f.tutorId || !vivo(f)) continue;
        const k = `${f.tutorId}|${f.escuelaId}`;
        m.set(k, { tutorId: f.tutorId, escuelaId: f.escuelaId, cantidad: (m.get(k)?.cantidad ?? 0) + 1 });
      }
      return Promise.resolve([...m.values()]);
    },
    aplicar: (lote) => {
      // Todo o nada: si alguna ya tiene docente o es terminal, no se escribe nada.
      if (lote.asignaciones.some((a) => { const f = filas.get(a.practicaId); return !f || f.tutorId !== null || !vivo(f); })) return Promise.resolve(false);
      for (const a of lote.asignaciones) filas.get(a.practicaId)!.tutorId = a.tutorId;
      auditoria.push(...lote.auditoria); bitacora.push(...lote.bitacora); escrituras += 1;
      return Promise.resolve(true);
    },
  };
  const caso = new DistribucionDocentesUseCase(
    puerto,
    {
      listar: () => Promise.resolve(docentes.map((d) => usuarioDe(Rol.TUTOR, { id: d.id, nombre: d.nombre, rol: d.rol as Rol, activo: d.activo, permiso: d.permiso, escuelas: [...d.escuelas] }))),
      buscarPorId: (id: string) => Promise.resolve(usuarioDe(Rol.ANALISTA, { id, nombre: 'Paola Cárdenas' })),
    } as never,
    { buscarPorCodigo: (c: string) => Promise.resolve(c === '2026C' ? { instantanea: () => ({ activo: opciones.periodoActivo ?? true }) } : null) } as never,
  );
  return { caso, filas, auditoria, bitacora, escrituras: () => escrituras };
}

const fila = (n: number, escuela = 'ESC-ING', extra: Partial<FilaPractica> = {}): FilaPractica => ({
  id: `p-${n}`, escuelaId: escuela, programaId: 'PRG', estudianteId: `e-${n}`, periodo: '2026C', tutorId: null, estado: EstadoPractica.DOCUMENTACION, ...extra,
});
const coord = actorDe(Rol.COORDINADOR);
const analista = actorDe(Rol.ANALISTA);

describe('G6 · permisos', () => {
  it.each([Rol.COORDINADOR, Rol.ANALISTA])('%s previsualiza y aplica', async (rol) => {
    const { caso, filas } = montar({ filas: [fila(1), fila(2)] });
    const v = await caso.previsualizar('2026C', undefined, actorDe(rol));
    await caso.aplicar({ periodoAcademico: '2026C', huella: v.huella }, actorDe(rol));
    expect([...filas.values()].every((f) => f.tutorId !== null)).toBe(true);
  });

  it.each([Rol.ADMINISTRADOR, Rol.DIRECTOR, Rol.TUTOR, Rol.AUXILIAR, Rol.ESTUDIANTE, Rol.EMPRESA, Rol.EXTENSION])('%s → 403 en vista previa y aplicación', async (rol) => {
    const { caso, escrituras } = montar({ filas: [fila(1)] });
    await expect(caso.previsualizar('2026C', undefined, actorDe(rol))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(caso.aplicar({ periodoAcademico: '2026C', huella: 'x' }, actorDe(rol))).rejects.toBeInstanceOf(ForbiddenException);
    expect(escrituras()).toBe(0);
  });
});

describe('G6 · periodo, vista previa y aplicación', () => {
  it('periodo obligatorio y existente', async () => {
    const { caso } = montar();
    await expect(caso.previsualizar('', undefined, coord)).rejects.toBeInstanceOf(BadRequestException);
    await expect(caso.previsualizar('1999A', undefined, coord)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('la vista previa NO escribe y devuelve actual / nuevos / final, no asignables y excluidos', async () => {
    const { caso, escrituras, filas } = montar({
      filas: [fila(1), fila(2), fila(3), fila(9, 'ESC-ING', { tutorId: 't1' }), fila(20, 'ESC-DER')],
      docentes: [D('t1', 'Laura Gómez'), D('t2', 'Carlos Ruiz'), D('t3', 'Inactivo', ['ESC-ING'], { activo: false })],
    });
    const v = await caso.previsualizar('2026C', undefined, coord);
    expect(escrituras()).toBe(0);
    expect([...filas.values()].filter((f) => f.tutorId === null)).toHaveLength(4);
    expect(v).toMatchObject({ periodoAcademico: '2026C', pendientes: 4, asignables: 3, sinDocenteCompatible: 1, puedeAplicar: true });
    expect(v.docentes.map((d) => [d.nombre, d.actual, d.nuevos, d.final])).toEqual([['Carlos Ruiz', 0, 2, 2], ['Laura Gómez', 1, 1, 2]]);
    expect(v.noAsignables).toEqual([{ escuelaId: 'ESC-DER', cantidad: 1, motivo: 'No hay docentes activos con alcance compatible.' }]);
    expect(v.docentesExcluidos.map((d) => d.nombre)).toEqual(['Inactivo']);
  });

  it('aplicar: asigna solo las pendientes, no mueve las existentes y deja fuera las no asignables', async () => {
    const { caso, filas } = montar({ filas: [fila(1), fila(2), fila(9, 'ESC-ING', { tutorId: 'otro' }), fila(20, 'ESC-DER')] });
    const v = await caso.previsualizar('2026C', undefined, analista);
    const r = await caso.aplicar({ periodoAcademico: '2026C', huella: v.huella }, analista);
    expect(r).toEqual({ periodoAcademico: '2026C', asignados: 2, docentes: 2, sinDocenteCompatible: 1 });
    expect(filas.get('p-9')!.tutorId).toBe('otro');
    expect(filas.get('p-20')!.tutorId).toBeNull();
  });

  it('prácticas terminales y de otro periodo no entran', async () => {
    const { caso } = montar({ filas: [fila(1), ...ESTADOS_TERMINALES_PRACTICA.map((e, i) => fila(30 + i, 'ESC-ING', { estado: e })), fila(40, 'ESC-ING', { periodo: '2026A' })] });
    expect((await caso.previsualizar('2026C', undefined, coord)).pendientes).toBe(1);
  });

  it('inscrito y en práctica sí reciben docente', async () => {
    const { caso } = montar({ filas: [fila(1, 'ESC-ING', { estado: EstadoPractica.INSCRITA }), fila(2, 'ESC-ING', { estado: EstadoPractica.ACTIVA })] });
    expect((await caso.previsualizar('2026C', undefined, coord)).asignables).toBe(2);
  });

  it('periodo inactivo: se consulta, pero no se aplica', async () => {
    const { caso, escrituras } = montar({ filas: [fila(1)], periodoActivo: false });
    const v = await caso.previsualizar('2026C', undefined, coord);
    expect(v.puedeAplicar).toBe(false);
    expect(v.motivoNoAplicable).toMatch(/no está activo/);
    await expect(caso.aplicar({ periodoAcademico: '2026C', huella: v.huella }, coord)).rejects.toBeInstanceOf(BadRequestException);
    expect(escrituras()).toBe(0);
  });

  it('sin pendientes no hay nada que aplicar', async () => {
    const { caso } = montar({ filas: [fila(1, 'ESC-ING', { tutorId: 't1' })] });
    const v = await caso.previsualizar('2026C', undefined, coord);
    expect(v.puedeAplicar).toBe(false);
    await expect(caso.aplicar({ periodoAcademico: '2026C', huella: v.huella }, coord)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('G6 · concurrencia y vista previa obsoleta', () => {
  it('otra asignación entre la vista previa y la aplicación → 409 y no sobrescribe al docente existente', async () => {
    const { caso, filas, escrituras } = montar({ filas: [fila(1), fila(2)] });
    const v = await caso.previsualizar('2026C', undefined, coord);
    filas.get('p-1')!.tutorId = 'manual';
    await expect(caso.aplicar({ periodoAcademico: '2026C', huella: v.huella }, coord)).rejects.toThrow(MENSAJE_PREVIA_OBSOLETA);
    expect(filas.get('p-1')!.tutorId).toBe('manual');
    expect(filas.get('p-2')!.tutorId).toBeNull();
    expect(escrituras()).toBe(0);
  });

  it('un docente inhabilitado o un estudiante nuevo desde la vista previa → 409', async () => {
    const m = montar({ filas: [fila(1)] });
    const v = await m.caso.previsualizar('2026C', undefined, coord);
    m.filas.set('p-5', fila(5));
    await expect(m.caso.aplicar({ periodoAcademico: '2026C', huella: v.huella }, coord)).rejects.toBeInstanceOf(ConflictException);
  });

  it('dos aplicaciones con la misma vista previa: la segunda → 409 (sin doble asignación)', async () => {
    const { caso, auditoria } = montar({ filas: [fila(1), fila(2)] });
    const v = await caso.previsualizar('2026C', undefined, coord);
    await caso.aplicar({ periodoAcademico: '2026C', huella: v.huella }, coord);
    await expect(caso.aplicar({ periodoAcademico: '2026C', huella: v.huella }, analista)).rejects.toBeInstanceOf(ConflictException);
    expect(auditoria.filter((a) => a.accion === AccionAuditada.DISTRIBUCION_DOCENTES_APLICADA)).toHaveLength(1);
  });

  it('si el lote falla en la base (carrera tras la huella), 409 y nada escrito', async () => {
    const m = montar({ filas: [fila(1), fila(2)] });
    const v = await m.caso.previsualizar('2026C', undefined, coord);
    const original = m.filas.get('p-2')!;
    // La huella coincide, pero la fila cambia justo antes del UPDATE condicional.
    const port = (m.caso as unknown as { repo: DistribucionDocentesPort }).repo;
    const aplicar = port.aplicar.bind(port);
    port.aplicar = (lote) => { original.tutorId = 'carrera'; return aplicar(lote); };
    await expect(m.caso.aplicar({ periodoAcademico: '2026C', huella: v.huella }, coord)).rejects.toBeInstanceOf(ConflictException);
    expect(m.filas.get('p-1')!.tutorId).toBeNull();
    expect(m.escrituras()).toBe(0);
  });
});

describe('G6 · alcance por escuela', () => {
  it('actor restringido a ESC-ING no distribuye ESC-NEG (403) y su universo es solo ESC-ING', async () => {
    const { caso } = montar({ filas: [fila(1, 'ESC-ING'), fila(2, 'ESC-NEG')] });
    const ing = actorDe(Rol.COORDINADOR, { escuelas: ['ESC-ING'] });
    await expect(caso.previsualizar('2026C', 'ESC-NEG', ing)).rejects.toBeInstanceOf(ForbiddenException);
    const v = await caso.previsualizar('2026C', undefined, ing);
    expect(v.escuelas).toEqual(['ESC-ING']);
    expect(v.pendientes).toBe(1);
  });

  it('opción explícita «una escuela» para coordinación institucional', async () => {
    const { caso } = montar({ filas: [fila(1, 'ESC-ING'), fila(2, 'ESC-NEG')] });
    const v = await caso.previsualizar('2026C', 'ESC-NEG', coord);
    expect(v.pendientes).toBe(1);
    expect(v.docentes.map((d) => d.nombre)).toEqual(['Carlos Ruiz']);
  });

  it('docente ESC-NEG no recibe ESC-ING', async () => {
    const { caso, filas } = montar({ filas: [fila(1, 'ESC-ING')], docentes: [D('neg', 'Nora', ['ESC-NEG']), D('ing', 'Iván', ['ESC-ING'])] });
    const v = await caso.previsualizar('2026C', undefined, coord);
    await caso.aplicar({ periodoAcademico: '2026C', huella: v.huella }, coord);
    expect(filas.get('p-1')!.tutorId).toBe('ing');
  });
});

describe('G6 · auditoría e historial', () => {
  it('evento de lote + uno por práctica (actor, periodo, cantidad, práctica, docente, fecha, método) y nota en la bitácora', async () => {
    const { caso, auditoria, bitacora } = montar({ filas: [fila(1), fila(2), fila(20, 'ESC-DER')] });
    const v = await caso.previsualizar('2026C', undefined, analista);
    const ahora = new Date('2026-11-18T15:00:00.000Z');
    await caso.aplicar({ periodoAcademico: '2026C', huella: v.huella }, analista, ahora);
    const lote = auditoria.find((a) => a.accion === AccionAuditada.DISTRIBUCION_DOCENTES_APLICADA)!;
    expect(lote).toMatchObject({ actorId: analista.id, actorRol: Rol.ANALISTA, ocurridoEn: ahora, entidad: 'periodo' });
    expect(lote.metadatos).toMatchObject({ periodoAcademico: '2026C', asignados: 2, noAsignables: 1, huella: v.huella, metodo: 'automatico' });
    const individuales = auditoria.filter((a) => a.accion === AccionAuditada.TUTOR_ASIGNADO);
    expect(individuales.map((a) => a.entidadId).sort()).toEqual(['p-1', 'p-2']);
    expect(individuales[0].metadatos).toMatchObject({ metodo: 'automatico', periodoAcademico: '2026C', loteId: lote.metadatos!['loteId'] });
    expect(individuales[0].metadatos!['tutorId']).toBeDefined();
    expect(bitacora).toHaveLength(2);
    expect(bitacora[0].mensaje).toMatch(/^Docente facilitador asignado: (Laura Gómez|Carlos Ruiz)\. Distribución automática del periodo 2026C, por Analista de prácticas \(Paola Cárdenas\)\.$/);
  });
});

// ── Asignación manual endurecida (PATCH /practicas/:id/tutor) ──
function montarManual(inicial: Partial<DatosPractica>, docente: Parameters<typeof usuarioDe>[1] | null) {
  let actual: DatosPractica = practicaDe({ escuelaId: 'ESC-ING', estado: EstadoPractica.DOCUMENTACION, ...inicial }).instantanea();
  const auditorias: RegistroAuditoria[] = [];
  const notas: string[] = [];
  const caso = new GestionarPracticaUseCase(
    { buscarPorId: () => Promise.resolve(Practica.desde(actual)), guardar: (d: DatosPractica) => { actual = { ...d }; return Promise.resolve(Practica.desde(d)); } } as never,
    { listarPorPractica: () => Promise.resolve([]) } as never,
    { listarPorPractica: () => Promise.resolve([]) } as never,
    { buscarPorId: () => Promise.resolve(empresaDe('empresa-a')) } as never,
    {
      buscarPorId: (id: string) => Promise.resolve(id === 'doc-1' ? (docente ? usuarioDe(Rol.TUTOR, { id, nombre: 'Laura Gómez', escuelas: ['ESC-ING'], ...docente }) : null)
        : usuarioDe(Rol.COORDINADOR, { id, nombre: id === 'tutor-viejo' ? 'Carlos Ruiz' : 'Ana Coord' })),
    } as never,
    { registrar: (r: RegistroAuditoria) => { auditorias.push(r); return Promise.resolve(); } } as never,
    { numero: () => Promise.resolve(15), booleano: () => Promise.resolve(false) } as never,
    undefined, undefined, undefined,
    { anotarCambioDeGobierno: (_p: string, m: string) => { notas.push(m); return Promise.resolve(); } } as never,
  );
  return { caso, estado: () => actual, auditorias, notas };
}

describe('G6 · asignación manual', () => {
  it.each([Rol.ADMINISTRADOR, Rol.DIRECTOR, Rol.TUTOR, Rol.AUXILIAR])('%s → 403', async (rol) => {
    const { caso } = montarManual({ tutorId: null }, {});
    await expect(caso.asignarTutor('practica-1', 'doc-1', actorDe(rol))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('coordinación asigna un docente válido: auditoría «manual» y nota en la bitácora', async () => {
    const { caso, estado, auditorias, notas } = montarManual({ tutorId: null }, {});
    await caso.asignarTutor('practica-1', 'doc-1', coord);
    expect(estado().tutorId).toBe('doc-1');
    expect(auditorias[0]).toMatchObject({ accion: 'tutor_asignado', entidadId: 'practica-1' });
    expect(auditorias[0].metadatos).toMatchObject({ tutorId: 'doc-1', metodo: 'manual', anteriorTutorId: null });
    expect(notas[0]).toMatch(/Docente facilitador asignado: Laura Gómez\. Asignación manual/);
  });

  it.each([
    ['no existe', null],
    ['no es docente', { rol: Rol.COORDINADOR }],
    ['inhabilitado', { activo: false }],
    ['solo consulta', { permiso: 'consulta' as const }],
    ['fuera de alcance', { escuelas: ['ESC-NEG'] }],
    ['alcance vacío (solo asignados)', { escuelas: [] }],
  ])('docente %s → 400 sin guardar', async (_c, docente) => {
    const { caso, estado } = montarManual({ tutorId: null }, docente);
    await expect(caso.asignarTutor('practica-1', 'doc-1', coord)).rejects.toBeInstanceOf(BadRequestException);
    expect(estado().tutorId).toBeNull();
  });

  it('práctica terminal → 400', async () => {
    const { caso } = montarManual({ tutorId: null, estado: EstadoPractica.ANULADA }, {});
    await expect(caso.asignarTutor('practica-1', 'doc-1', coord)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reemplazar un docente ya asignado exige justificación; con ella queda auditado de → a', async () => {
    const { caso, estado, auditorias, notas } = montarManual({ tutorId: 'tutor-viejo' }, {});
    await expect(caso.asignarTutor('practica-1', 'doc-1', analista)).rejects.toBeInstanceOf(BadRequestException);
    expect(estado().tutorId).toBe('tutor-viejo');
    await caso.asignarTutor('practica-1', 'doc-1', analista, 'Cambio por incapacidad del docente.');
    expect(estado().tutorId).toBe('doc-1');
    expect(auditorias[0]).toMatchObject({ justificacion: 'Cambio por incapacidad del docente.' });
    expect(auditorias[0].metadatos).toMatchObject({ anteriorTutorId: 'tutor-viejo', metodo: 'manual' });
    expect(notas[0]).toMatch(/Docente facilitador cambiado: Carlos Ruiz → Laura Gómez/);
  });
});

describe('G6 · DTO de aplicación', () => {
  it('acepta los códigos de periodo reales (2026C, 26P05, 26V06) y rechaza vacíos o con caracteres extraños', async () => {
    const { validate } = await import('class-validator');
    const { plainToInstance } = await import('class-transformer');
    const { AplicarDistribucionDto } = await import('../src/application/dtos/distribucion-docentes.dto');
    const errores = async (periodoAcademico: string) =>
      (await validate(plainToInstance(AplicarDistribucionDto, { periodoAcademico, huella: 'h' }))).length;
    for (const ok of ['2026C', '26P05', '26V06', '26G06']) expect(await errores(ok)).toBe(0);
    for (const mal of ['', 'X', "26C'; DROP", '2026 C']) expect(await errores(mal)).toBeGreaterThan(0);
  });
});
