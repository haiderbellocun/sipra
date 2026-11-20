import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TableroCumplimientoUseCase, TAMANO_PAGINA_CUMPLIMIENTO } from '../src/application/use-cases/obligaciones/tablero-cumplimiento.use-case';
import { EstadoObligacion, diasRestantesHasta, semaforoObligacion } from '../src/domain/entities/obligacion.entity';
import {
  AlcanceCumplimiento, CumplimientoLecturaPort, FilaObligacionAlcance, FiltroCumplimiento,
} from '../src/domain/ports/out/cumplimiento-lectura.port';
import { ObligacionRepositoryPort, UsuarioRepositoryPort } from '../src/domain/ports/out/repositorios.port';
import { categoriaDe, clasificar, ordenOperativo, porTipo, resumir } from '../src/domain/services/cumplimiento.domain-service';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { actorDe, usuarioDe } from './soporte-autorizacion';

// Datos sintéticos. «Ahora» fijo para que los días sean deterministas.
const AHORA = new Date('2026-11-18T12:00:00Z');
const enDias = (d: number) => new Date(AHORA.getTime() + d * 86_400_000);

type FilaFalsa = FilaObligacionAlcance & { tutorId?: string | null; estudianteId?: string };
let secuencia = 0;
const F = (extra: Partial<FilaFalsa> = {}): FilaFalsa => {
  secuencia += 1;
  return {
    obligacionId: `o-${String(secuencia).padStart(4, '0')}`, tipo: 'afiliacion_arl', estado: EstadoObligacion.PENDIENTE,
    fechaLimite: enDias(30), practicaId: `p-${secuencia}`, practicaEstado: 'activa', periodo: '26V06', escuelaId: 'ESC-ING',
    escuelaNombre: 'Ingeniería', programaId: 'PRG-1', estudianteNombre: 'Estudiante sintético', tutorId: null, ...extra,
  };
};

/** Puerto falso que aplica el alcance y los filtros igual que el SQL del adaptador. */
class LecturaFalsa implements CumplimientoLecturaPort {
  llamadas: { alcance: AlcanceCumplimiento; filtro: FiltroCumplimiento }[] = [];
  constructor(public filas: FilaFalsa[] = []) {}
  async obligaciones(alcance: AlcanceCumplimiento, f: FiltroCumplimiento) {
    this.llamadas.push({ alcance, filtro: f });
    return this.filas.filter((x) => (alcance.todas || alcance.escuelas.includes(x.escuelaId) || (alcance.tutorId !== null && x.tutorId === alcance.tutorId))
      && (!f.periodo || x.periodo === f.periodo) && (!f.escuela || x.escuelaId === f.escuela)
      && (!f.programa || x.programaId === f.programa) && (!f.tipo || x.tipo === f.tipo)
      && (!f.estudianteIds || f.estudianteIds.includes(x.estudianteId ?? '')));
  }
  async opciones() { return { periodos: ['26V06'], escuelas: [{ codigo: 'ESC-ING', nombre: 'Ingeniería' }], programas: ['PRG-1'] }; }
}

const obligacionesFalsas = { listarPendientes: jest.fn(async () => []), guardar: jest.fn() } as unknown as ObligacionRepositoryPort;
const crear = (lectura: LecturaFalsa, usuarios?: Partial<UsuarioRepositoryPort>) =>
  new TableroCumplimientoUseCase(obligacionesFalsas, lectura, usuarios as UsuarioRepositoryPort | undefined);

describe('Cumplimiento V3 · dominio puro', () => {
  it('el semáforo extraído conserva la regla: vencida < 0, crítica ≤ 3, alerta ≤ 10, vigente > 10, cumplida manda', () => {
    expect(semaforoObligacion(EstadoObligacion.PENDIENTE, enDias(-1), AHORA)).toBe('vencida');
    expect(semaforoObligacion(EstadoObligacion.PENDIENTE, enDias(3), AHORA)).toBe('critica');
    expect(semaforoObligacion(EstadoObligacion.PENDIENTE, enDias(10), AHORA)).toBe('alerta');
    expect(semaforoObligacion(EstadoObligacion.PENDIENTE, enDias(11), AHORA)).toBe('vigente');
    expect(semaforoObligacion(EstadoObligacion.CUMPLIDA, enDias(-50), AHORA)).toBe('cumplida');
    expect(diasRestantesHasta(enDias(-2.5), AHORA)).toBe(-3);
  });

  it('categorías: crítica y alerta son «próxima»; vigente es «en plazo»', () => {
    expect(categoriaDe('critica')).toBe('proxima');
    expect(categoriaDe('alerta')).toBe('proxima');
    expect(categoriaDe('vigente')).toBe('en_plazo');
  });

  it('no_aplica queda fuera de las aplicables y se cuenta aparte', () => {
    const { aplicables, noAplica } = clasificar([F({ estado: EstadoObligacion.NO_APLICA }), F(), F({ estado: EstadoObligacion.CUMPLIDA })], AHORA);
    expect(noAplica).toBe(1);
    expect(resumir(aplicables, noAplica)).toEqual({ aplicables: 2, cumplidas: 1, enPlazo: 1, proximas: 0, vencidas: 0, noAplica: 1 });
  });

  it('orden operativo: vencidas (más antigua) → próximas (más cercana) → en plazo → cumplidas, desempate por id', () => {
    const filas = [F({ estado: EstadoObligacion.CUMPLIDA }), F({ fechaLimite: enDias(40) }), F({ fechaLimite: enDias(5) }),
      F({ fechaLimite: enDias(2) }), F({ fechaLimite: enDias(-1) }), F({ fechaLimite: enDias(-9) }), F({ fechaLimite: enDias(-9) })];
    const orden = clasificar(filas, AHORA).aplicables.sort(ordenOperativo);
    expect(orden.map((o) => o.categoria)).toEqual(['vencida', 'vencida', 'vencida', 'proxima', 'proxima', 'en_plazo', 'cumplida']);
    expect(orden[0].fila.obligacionId < orden[1].fila.obligacionId).toBe(true);
    expect(orden[2].diasRestantes).toBe(-1);
    expect(orden[3].diasRestantes).toBe(2);
  });

  it('por tipo: más vencidas primero', () => {
    const { aplicables } = clasificar([F({ tipo: 'b' }), F({ tipo: 'a', fechaLimite: enDias(-1) }), F({ tipo: 'b', estado: EstadoObligacion.CUMPLIDA })], AHORA);
    const r = porTipo(aplicables);
    expect(r.map((t) => t.tipo)).toEqual(['a', 'b']);
    expect(r[1]).toMatchObject({ aplicables: 2, cumplidas: 1, enPlazo: 1 });
  });
});

describe('Cumplimiento V3 · caso de uso', () => {
  it('alcance G1 por rol', () => {
    const uc = crear(new LecturaFalsa());
    for (const rol of [Rol.ADMINISTRADOR, Rol.DIRECTOR, Rol.EXTENSION]) expect(uc.alcanceDe(actorDe(rol)).todas).toBe(true);
    expect(uc.alcanceDe(actorDe(Rol.COORDINADOR))).toEqual({ todas: true, escuelas: [], tutorId: null });
    expect(uc.alcanceDe(actorDe(Rol.ANALISTA, { escuelas: ['ESC-ING'] }))).toEqual({ todas: false, escuelas: ['ESC-ING'], tutorId: null });
    expect(uc.alcanceDe(actorDe(Rol.TUTOR, { id: 't1' }))).toEqual({ todas: false, escuelas: [], tutorId: 't1' });
    for (const rol of [Rol.ESTUDIANTE, Rol.EMPRESA, Rol.AUXILIAR]) expect(() => uc.alcanceDe(actorDe(rol))).toThrow(ForbiddenException);
  });

  it('el docente sin escuelas ve solo sus prácticas asignadas (antes veía todo)', async () => {
    const lectura = new LecturaFalsa([F({ tutorId: 't1' }), F({ tutorId: 'otro', escuelaId: 'ESC-SAL' }), F({ tutorId: null })]);
    const t = await crear(lectura).construir(actorDe(Rol.TUTOR, { id: 't1' }), {}, AHORA);
    expect(t.indicadores.aplicables).toBe(1);
    expect(t.alcance.tipo).toBe('asignados');
  });

  it('la coordinación por escuela no alcanza otras escuelas', async () => {
    const lectura = new LecturaFalsa([F({ escuelaId: 'ESC-ING' }), F({ escuelaId: 'ESC-SAL' })]);
    const t = await crear(lectura).construir(actorDe(Rol.COORDINADOR, { escuelas: ['ESC-SAL'] }), {}, AHORA);
    expect(t.listado.filas.map((f) => f.escuelaId)).toEqual(['ESC-SAL']);
    expect(t.alcance).toEqual({ tipo: 'escuelas', escuelas: ['ESC-SAL'] });
  });

  it('indicadores con cumplidas reales, atención ordenada y campos de compatibilidad', async () => {
    const lectura = new LecturaFalsa([
      F({ estado: EstadoObligacion.CUMPLIDA }), F({ estado: EstadoObligacion.VENCIDA, fechaLimite: enDias(-4) }),
      F({ fechaLimite: enDias(2) }), F({ fechaLimite: enDias(8) }), F({ fechaLimite: enDias(25) }), F({ estado: EstadoObligacion.NO_APLICA }),
      F({ practicaEstado: 'en_validacion', fechaLimite: enDias(1) }),
    ]);
    const t = await crear(lectura).construir(actorDe(Rol.ADMINISTRADOR), {}, AHORA);
    expect(t.indicadores).toEqual({ aplicables: 6, cumplidas: 1, enPlazo: 1, proximas: 3, vencidas: 1, noAplica: 1 });
    expect(t.atencion.total).toBe(4);
    expect(t.atencion.filas.map((f) => f.diasRestantes)).toEqual([-4, 1, 2, 8]);
    expect(t.resumen).toEqual({ cumplida: 1, vencida: 1, critica: 2, alerta: 1, vigente: 1 });
    expect(t.practicasBloqueadas).toBe(1);
    expect(t.generadoEn).toBe(AHORA.toISOString());
    expect(t.atencion.filas[0]).toMatchObject({ norma: expect.any(String), categoria: 'vencida', escuelaNombre: 'Ingeniería' });
  });

  it('el filtro de estado afecta al listado, no a los indicadores; los demás filtros van a la consulta', async () => {
    const lectura = new LecturaFalsa([F({ estado: EstadoObligacion.CUMPLIDA }), F({ fechaLimite: enDias(-1) }), F()]);
    const t = await crear(lectura).construir(actorDe(Rol.DIRECTOR), { estado: 'vencida', periodo: '26V06', tipo: 'afiliacion_arl' }, AHORA);
    expect(t.listado.total).toBe(1);
    expect(t.indicadores.aplicables).toBe(3);
    expect(lectura.llamadas[0].filtro).toMatchObject({ periodo: '26V06', tipo: 'afiliacion_arl' });
    expect(t.filtros).toMatchObject({ estado: 'vencida', periodo: '26V06' });
  });

  it('paginación en el servidor y página fuera de rango acotada', async () => {
    const lectura = new LecturaFalsa(Array.from({ length: 60 }, () => F()));
    const uc = crear(lectura);
    const p3 = await uc.construir(actorDe(Rol.ADMINISTRADOR), { pagina: 3 }, AHORA);
    expect(p3.listado).toMatchObject({ total: 60, pagina: 3, paginas: 3, tamano: TAMANO_PAGINA_CUMPLIMIENTO });
    expect(p3.listado.filas).toHaveLength(10);
    expect((await uc.construir(actorDe(Rol.ADMINISTRADOR), { pagina: 99 }, AHORA)).listado.pagina).toBe(3);
  });

  it('filtros no válidos se rechazan', async () => {
    const uc = crear(new LecturaFalsa());
    await expect(uc.construir(actorDe(Rol.ADMINISTRADOR), { tipo: 'inventado' }, AHORA)).rejects.toThrow(BadRequestException);
    await expect(uc.construir(actorDe(Rol.ADMINISTRADOR), { estado: 'devuelta' }, AHORA)).rejects.toThrow(BadRequestException);
    await expect(uc.construir(actorDe(Rol.ADMINISTRADOR), { periodo: "26'; DROP" }, AHORA)).rejects.toThrow(BadRequestException);
  });

  it('la búsqueda se resuelve con la búsqueda de usuarios y solo cuenta estudiantes', async () => {
    const lectura = new LecturaFalsa([F({ estudianteId: 'e1' }), F({ estudianteId: 'e2' })]);
    const buscarTexto = jest.fn(async () => [usuarioDe(Rol.ESTUDIANTE, { id: 'e1' }), usuarioDe(Rol.TUTOR, { id: 'e2' })]);
    const t = await crear(lectura, { buscarTexto }).construir(actorDe(Rol.ADMINISTRADOR), { busqueda: '  Ana ' }, AHORA);
    expect(buscarTexto).toHaveBeenCalledWith('Ana', 50);
    expect(lectura.llamadas[0].filtro.estudianteIds).toEqual(['e1']);
    expect(t.indicadores.aplicables).toBe(1);
  });
});
