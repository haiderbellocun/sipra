import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { GestionarPeriodosUseCase } from '../src/application/use-cases/administracion/gestionar-periodos.use-case';
import { DatosPeriodo, EstadoCargueEstudiante, PeriodoAcademico, TipoVentana } from '../src/domain/entities/periodo.entity';
import { EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  decidirCargueDeTipo, evaluarCargueEstudiante, mensajeCargue, subsanacionesVigentes,
} from '../src/domain/services/cargue-estudiante.domain-service';
import { diaAcademicoColombia } from '../src/domain/services/fechas-colombia';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { DocumentosController } from '../src/infrastructure/controllers/documentos.controller';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import { CargueEstudiantePeriodo1756000023000 } from '../src/infrastructure/persistence/postgres/migrations/1756000023000-CargueEstudiantePeriodo';

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Instante en hora de Colombia (UTC−5). */
const col = (iso: string, hora = 12) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), hora + 5));

const periodo = (o: { activo?: boolean; habilitado?: boolean } = {}) => PeriodoAcademico.desde({
  codigo: '2027A', nombre: '2027A', calendario: 'presencial', fechaInicio: dia('2027-01-20'), fechaFin: dia('2027-06-30'),
  ventanas: { [TipoVentana.CARGUE_ESTUDIANTE]: { desde: dia('2027-02-01'), hasta: dia('2027-05-30') } },
  jornadasInduccion: [], fechaCargueDocumentos: dia('2027-05-30'), sincronizacionDocentes: true, modalidadesHabilitadas: [],
  activo: o.activo ?? true, cargueEstudianteHabilitado: o.habilitado ?? true, creadoEn: dia('2027-01-01'), actualizadoEn: dia('2027-01-01'),
});

describe('G2 · dominio: estadoCargueEstudiante (fechas académicas inclusivas, día de Colombia)', () => {
  const casos: [string, Date, EstadoCargueEstudiante][] = [
    ['antes de «desde»', col('2027-01-31', 23), EstadoCargueEstudiante.AUN_NO_ABRE],
    ['exactamente «desde», 00:00', col('2027-02-01', 0), EstadoCargueEstudiante.ABIERTO],
    ['entre fechas', col('2027-03-15'), EstadoCargueEstudiante.ABIERTO],
    ['exactamente «hasta», 11 p. m.', col('2027-05-30', 23), EstadoCargueEstudiante.ABIERTO],
    ['el día posterior', col('2027-05-31', 0), EstadoCargueEstudiante.CERRADO_POR_FECHA],
  ];
  it.each(casos)('%s', (_, ahora, esperado) => {
    expect(periodo().estadoCargueEstudiante(ahora)).toBe(esperado);
  });

  it('periodo inactivo: cerrado (PERIODO_INACTIVO), aun dentro de la ventana', () => {
    expect(periodo({ activo: false }).estadoCargueEstudiante(col('2027-03-15'))).toBe(EstadoCargueEstudiante.PERIODO_INACTIVO);
  });

  it('cargue inhabilitado manualmente: cerrado (INHABILITADO), aun dentro de la ventana', () => {
    expect(periodo({ habilitado: false }).estadoCargueEstudiante(col('2027-03-15'))).toBe(EstadoCargueEstudiante.INHABILITADO);
  });

  it('periodo inexistente: SIN_PERIODO y bloqueado para el estudiante', () => {
    expect(evaluarCargueEstudiante(null, col('2027-03-15'))).toEqual({ estado: EstadoCargueEstudiante.SIN_PERIODO, permitido: false, desde: null, hasta: null });
  });

  it('`ventanaAbierta(CARGUE_ESTUDIANTE)` usa la misma regla (incluida la habilitación manual)', () => {
    expect(periodo().ventanaAbierta(TipoVentana.CARGUE_ESTUDIANTE, col('2027-03-15'))).toBe(true);
    expect(periodo({ habilitado: false }).ventanaAbierta(TipoVentana.CARGUE_ESTUDIANTE, col('2027-03-15'))).toBe(false);
  });

  it('el día académico de Colombia no cambia a las 7 p. m. (como sí lo haría el día UTC)', () => {
    expect(diaAcademicoColombia(col('2027-05-30', 23))).toBe(Date.UTC(2027, 4, 30));
    expect(diaAcademicoColombia(col('2027-05-31', 0))).toBe(Date.UTC(2027, 4, 31));
  });

  it('los periodos anteriores a G2 (sin el dato) quedan habilitados', () => {
    const d = periodo().instantanea() as Partial<DatosPeriodo>;
    delete d.cargueEstudianteHabilitado;
    expect(PeriodoAcademico.desde(d as DatosPeriodo).cargueEstudianteHabilitado).toBe(true);
  });

  it('fijar la ventana: «hasta» < «desde» o fuera del periodo es imposible; no borra la habilitación', () => {
    const p = periodo({ habilitado: false });
    expect(() => p.fijarVentanaCargueEstudiante({ desde: dia('2027-05-30'), hasta: dia('2027-02-01') })).toThrow(/anterior a «desde»/);
    expect(() => p.fijarVentanaCargueEstudiante({ desde: dia('2027-01-10'), hasta: dia('2027-02-01') })).toThrow(/dentro de las fechas del periodo/);
    expect(() => p.fijarVentanaCargueEstudiante({ desde: dia('2027-02-01'), hasta: dia('2027-07-15') })).toThrow(/dentro de las fechas del periodo/);
    p.fijarVentanaCargueEstudiante({ desde: dia('2027-02-15'), hasta: dia('2027-06-30') });
    expect(p.ventana(TipoVentana.CARGUE_ESTUDIANTE)).toEqual({ desde: dia('2027-02-15'), hasta: dia('2027-06-30') });
    expect(p.instantanea().fechaCargueDocumentos).toEqual(dia('2027-06-30'));
    expect(p.cargueEstudianteHabilitado).toBe(false);
  });

  it('mensajes operativos (sin «error»)', () => {
    const e = (estado: EstadoCargueEstudiante) => mensajeCargue({ estado, permitido: false, desde: dia('2027-02-01'), hasta: dia('2027-05-30') });
    expect(e(EstadoCargueEstudiante.AUN_NO_ABRE)).toMatch(/del 1 de febrero de 2027 al 30 de mayo de 2027/);
    expect(e(EstadoCargueEstudiante.CERRADO_POR_FECHA)).toMatch(/finalizó el 30 de mayo de 2027/);
    expect(e(EstadoCargueEstudiante.INHABILITADO)).toMatch(/Área de Prácticas ha restringido/);
    for (const estado of Object.values(EstadoCargueEstudiante)) expect(e(estado)).not.toMatch(/error/i);
  });
});

describe('G2 · dominio: subsanaciones', () => {
  it('solo la última versión cuenta, por tipo, y vence a los N días (inclusivo)', () => {
    const v = (tipo: TipoDocumento, version: number, estado: EstadoDocumento, en: Date) => ({ tipo, version, estado, actualizadoEn: en });
    const lista = subsanacionesVigentes([
      v(TipoDocumento.RUT_NATURAL, 1, EstadoDocumento.DEVUELTO, col('2027-06-03')),
      v(TipoDocumento.CERTIFICADO_EPS, 1, EstadoDocumento.DEVUELTO, col('2027-06-01')),
      v(TipoDocumento.CERTIFICADO_EPS, 2, EstadoDocumento.RECIBIDO, col('2027-06-02')),
    ], [], 8, col('2027-06-11', 23));
    expect(lista).toEqual([{ tipo: TipoDocumento.RUT_NATURAL, vence: dia('2027-06-11'), origen: 'devolucion' }]);
    expect(subsanacionesVigentes([v(TipoDocumento.RUT_NATURAL, 1, EstadoDocumento.DEVUELTO, col('2027-06-03'))], [], 8, col('2027-06-12', 0))).toEqual([]);
  });

  it('la excepción aplica solo con la ventana CERRADA POR FECHA', () => {
    const subs = [{ tipo: TipoDocumento.RUT_NATURAL, vence: dia('2027-06-11'), origen: 'devolucion' as const }];
    const con = (estado: EstadoCargueEstudiante) => decidirCargueDeTipo({ estado, permitido: false, desde: null, hasta: null }, TipoDocumento.RUT_NATURAL, subs).permitido;
    expect(con(EstadoCargueEstudiante.CERRADO_POR_FECHA)).toBe(true);
    for (const estado of [EstadoCargueEstudiante.INHABILITADO, EstadoCargueEstudiante.PERIODO_INACTIVO, EstadoCargueEstudiante.SIN_PERIODO, EstadoCargueEstudiante.AUN_NO_ABRE]) {
      expect(con(estado)).toBe(false);
    }
  });
});

const HOY = col('2027-03-10');
const admin = { id: 'adm', correo: 'admin@cun.edu.co', rol: Rol.ADMINISTRADOR, permiso: 'escritura' as const, escuelas: [], empresaId: null };
const director = { ...admin, id: 'dir', correo: 'direccion@cun.edu.co', rol: Rol.DIRECTOR };

function armar() {
  const filas: DatosPeriodo[] = [];
  const auditoria: { metadatos: Record<string, unknown>; actorRol: Rol }[] = [];
  const caso = new GestionarPeriodosUseCase(
    {
      listar: async () => filas.map((f) => PeriodoAcademico.desde(f)),
      buscarPorCodigo: async (c: string) => { const f = filas.find((x) => x.codigo === c); return f ? PeriodoAcademico.desde(f) : null; },
      guardar: async (d: DatosPeriodo) => { const i = filas.findIndex((x) => x.codigo === d.codigo); if (i >= 0) filas[i] = d; else filas.push(d); return PeriodoAcademico.desde(d); },
    },
    { registrar: async (r: { metadatos: Record<string, unknown>; actorRol: Rol }) => { auditoria.push(r); } } as never,
  );
  return { caso, filas, auditoria };
}
const base = { codigo: '2027A', nombre: 'Primer periodo', calendario: 'presencial' as const, fechaInicio: '2027-01-20', fechaFin: '2027-06-30' };

describe('G2 · gestión de periodos: ventana de cargue y habilitación', () => {
  it('crea con la ventana explícita y la habilitación elegida; la respuesta trae el estado efectivo', async () => {
    const { caso } = armar();
    const p = await caso.crear({ ...base, cargueEstudiante: { habilitado: true, desde: '2027-02-01', hasta: '2027-05-30' } }, director, HOY);
    expect(p.cargueEstudiante).toEqual({ habilitado: true, estado: EstadoCargueEstudiante.ABIERTO, desde: '2027-02-01', hasta: '2027-05-30' });
    expect(p.ventanas.cargue_estudiante).toEqual({ desde: '2027-02-01', hasta: '2027-05-30' });
    expect(p.cronograma.fechaCargueDocumentos).toBe('2027-05-30');
  });

  it('sin bloque de cargue usa la sugerencia visible (inicio → dos semanas antes del cierre), habilitado', async () => {
    const { caso } = armar();
    const p = await caso.crear(base, admin, HOY);
    expect(p.cargueEstudiante).toMatchObject({ habilitado: true, desde: '2027-01-20', hasta: '2027-06-16' });
  });

  it('imposible guardar «hasta» < «desde» o fuera del periodo (al crear y al editar)', async () => {
    const { caso } = armar();
    await expect(caso.crear({ ...base, cargueEstudiante: { habilitado: true, desde: '2027-05-30', hasta: '2027-02-01' } }, admin, HOY)).rejects.toBeInstanceOf(BadRequestException);
    await expect(caso.crear({ ...base, cargueEstudiante: { habilitado: true, desde: '2027-01-02', hasta: '2027-02-01' } }, admin, HOY)).rejects.toBeInstanceOf(BadRequestException);
    await caso.crear(base, admin, HOY);
    await expect(caso.actualizar('2027A', { ventanaCargueEstudiante: { desde: '2027-03-01', hasta: '2027-07-30' } }, admin, HOY)).rejects.toBeInstanceOf(BadRequestException);
    await expect(caso.actualizar('2027A', { ventanas: { cargue_estudiante: null } }, admin, HOY)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('inhabilitar conserva las fechas; volver a habilitar también', async () => {
    const { caso } = armar();
    await caso.crear({ ...base, cargueEstudiante: { habilitado: true, desde: '2027-02-01', hasta: '2027-05-30' } }, director, HOY);
    const off = await caso.actualizar('2027A', { cargueEstudianteHabilitado: false }, director, HOY);
    expect(off.cargueEstudiante).toEqual({ habilitado: false, estado: EstadoCargueEstudiante.INHABILITADO, desde: '2027-02-01', hasta: '2027-05-30' });
    expect(off.activo).toBe(true);
    const on = await caso.actualizar('2027A', { cargueEstudianteHabilitado: true }, director, HOY);
    expect(on.cargueEstudiante).toEqual({ habilitado: true, estado: EstadoCargueEstudiante.ABIERTO, desde: '2027-02-01', hasta: '2027-05-30' });
  });

  it('una fecha ya pasada cierra el cargue de inmediato', async () => {
    const { caso } = armar();
    await caso.crear(base, admin, HOY);
    const p = await caso.actualizar('2027A', { ventanaCargueEstudiante: { desde: '2027-02-01', hasta: '2027-03-01' } }, admin, HOY);
    expect(p.cargueEstudiante.estado).toBe(EstadoCargueEstudiante.CERRADO_POR_FECHA);
  });

  it('audita actor, rol, periodo, campo, valor anterior y nuevo', async () => {
    const { caso, auditoria } = armar();
    await caso.crear({ ...base, cargueEstudiante: { habilitado: true, desde: '2027-02-01', hasta: '2027-05-30' } }, director, HOY);
    await caso.actualizar('2027A', { cargueEstudianteHabilitado: false, ventanaCargueEstudiante: { desde: '2027-02-01', hasta: '2027-05-15' }, activo: false }, director, HOY);
    const ultimo = auditoria[auditoria.length - 1];
    expect(ultimo.actorRol).toBe(Rol.DIRECTOR);
    expect(ultimo.metadatos.periodo).toBe('2027A');
    expect(ultimo.metadatos.cambios).toEqual(expect.arrayContaining([
      { campo: 'activo', anterior: true, nuevo: false },
      { campo: 'cargueEstudianteHabilitado', anterior: true, nuevo: false },
      { campo: 'cargueEstudiante.hasta', anterior: '2027-05-30', nuevo: '2027-05-15' },
    ]));
    expect((ultimo.metadatos.cambios as { campo: string }[]).some((c) => c.campo === 'cargueEstudiante.desde')).toBe(false); // no cambió
  });

  it('crear, editar, activar, habilitar y cambiar fechas: solo administrador y director', async () => {
    const { caso } = armar();
    await caso.crear(base, admin, HOY);
    for (const rol of [Rol.COORDINADOR, Rol.ANALISTA, Rol.TUTOR, Rol.AUXILIAR, Rol.ESTUDIANTE]) {
      const a = { ...admin, id: `${rol}-1`, rol };
      await expect(caso.crear({ ...base, codigo: '2027B' }, a, HOY)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(caso.actualizar('2027A', { cargueEstudianteHabilitado: false }, a, HOY)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(caso.actualizar('2027A', { ventanaCargueEstudiante: { desde: '2027-02-01', hasta: '2027-05-30' } }, a, HOY)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(caso.actualizar('2027A', { activo: false }, a, HOY)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});

describe('G2 · el controlador rechaza ANTES de leer el multipart', () => {
  it('si la prevalidación falla, `request.parts()` nunca se consume', async () => {
    let partesLeidas = false;
    const controlador = new DocumentosController(
      { prevalidarCargue: async () => { throw new ForbiddenException('El período de entrega finalizó'); }, cargar: async () => ({}) } as never,
      { get: () => 10 } as never,
    );
    const request = { parts: async function* () { partesLeidas = true; yield { type: 'file' }; } };
    const actor = { id: 'est-1', correo: 'e@estudiante.cun.edu.co', rol: Rol.ESTUDIANTE, permiso: 'escritura' as const, escuelas: [], empresaId: null };
    await expect(controlador.cargar('11111111-1111-4111-8111-111111111111', request as never, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(partesLeidas).toBe(false);
  });
});

describe('G2 · migración 23 (sin ejecutar)', () => {
  async function sqlDe(metodo: 'up' | 'down'): Promise<string[]> {
    const emitido: string[] = [];
    await new CargueEstudiantePeriodo1756000023000()[metodo]({ query: (q: string) => { emitido.push(q.replace(/\s+/g, ' ').trim()); return Promise.resolve(undefined); } } as unknown as QueryRunner);
    return emitido;
  }

  it('está registrada al final, justo después de la 22 (roles)', () => {
    expect(MIGRACIONES[MIGRACIONES.length - 1]).toBe(CargueEstudiantePeriodo1756000023000);
    expect(MIGRACIONES[MIGRACIONES.length - 2].name).toBe('RolesGobiernoOperativo1756000022000');
  });

  it('up: solo agrega la columna NOT NULL DEFAULT true en periodos_academicos (los periodos existentes quedan habilitados); no toca filas', async () => {
    const up = await sqlDe('up');
    expect(up).toEqual(['ALTER TABLE periodos_academicos ADD COLUMN IF NOT EXISTS cargue_estudiante_habilitado boolean NOT NULL DEFAULT true']);
    expect(up.join(' ')).not.toMatch(/UPDATE |INSERT |DELETE |DROP TABLE|TRUNCATE|ventanas|fecha_/i);
  });

  it('down: solo quita la columna', async () => {
    expect(await sqlDe('down')).toEqual(['ALTER TABLE periodos_academicos DROP COLUMN IF EXISTS cargue_estudiante_habilitado']);
  });
});
