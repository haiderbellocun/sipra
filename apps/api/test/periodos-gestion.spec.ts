import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { GestionarPeriodosUseCase } from '../src/application/use-cases/administracion/gestionar-periodos.use-case';
import { ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import { DatosPeriodo, PeriodoAcademico, TipoVentana } from '../src/domain/entities/periodo.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';

const HOY = new Date('2026-08-03T12:00:00.000Z');
const admin = { id: 'adm', correo: 'admin@cun.edu.co', rol: Rol.ADMINISTRADOR, permiso: 'escritura' as const, escuelas: [], empresaId: null };
const docente = { ...admin, id: 'doc', rol: Rol.TUTOR, escuelas: ['ESC-NEG'] };

function armar() {
  const filas: DatosPeriodo[] = [];
  const caso = new GestionarPeriodosUseCase(
    {
      listar: async () => filas.map((f) => PeriodoAcademico.desde(f)),
      buscarPorCodigo: async (c: string) => { const f = filas.find((x) => x.codigo === c); return f ? PeriodoAcademico.desde(f) : null; },
      guardar: async (d: DatosPeriodo) => { const i = filas.findIndex((x) => x.codigo === d.codigo); if (i >= 0) filas[i] = d; else filas.push(d); return PeriodoAcademico.desde(d); },
    },
    { registrar: async () => undefined } as never,
  );
  return { caso, filas };
}

describe('Gestión de periodos', () => {
  it('crea el periodo con las ventanas habituales y lo presenta con su estado actual', async () => {
    const { caso } = armar();
    const p = await caso.crear({ codigo: '2026c', nombre: 'Segundo periodo', calendario: 'presencial', fechaInicio: '2026-07-20', fechaFin: '2026-12-04', cierreFur: '2026-08-21' }, admin, HOY);
    expect(p.codigo).toBe('2026C');
    expect(p.ventanas.registro_fur).toEqual({ desde: '2026-07-20', hasta: '2026-08-21' });
    expect(p.ventanas.carta_presentacion?.desde).toBe('2026-06-20');
    expect(p.abiertas.registro_fur).toBe(true);
    expect(p.abiertas.cargue_docente).toBe(false);
    expect(p.modalidadesOfertadas.length).toBeGreaterThan(10);
    await expect(caso.crear({ codigo: '2026C', nombre: 'x', calendario: 'presencial', fechaInicio: '2026-07-20', fechaFin: '2026-12-04', cierreFur: '2026-08-21' }, admin, HOY)).rejects.toBeInstanceOf(ConflictException);
    await expect(caso.crear({ codigo: '2027A', nombre: 'x', calendario: 'presencial', fechaInicio: '2027-01-25', fechaFin: '2027-06-04', cierreFur: '2027-07-01' }, admin, HOY)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('abre y cierra ventanas, limita modalidades y apaga la sincronización; solo coordinación o administración', async () => {
    const { caso } = armar();
    await caso.crear({ codigo: '2026C', nombre: 'x', calendario: 'presencial', fechaInicio: '2026-07-20', fechaFin: '2026-12-04', cierreFur: '2026-08-21' }, admin, HOY);
    const p = await caso.actualizar('2026C', {
      ventanas: { [TipoVentana.CARGUE_DOCENTE]: { desde: '2026-08-01', hasta: '2026-08-31' }, [TipoVentana.REGISTRO_FUR]: null },
      modalidadesHabilitadas: [ModalidadPractica.PASANTIA, ModalidadPractica.MONITORIA],
      sincronizacionDocentes: false,
    }, admin, HOY);
    expect(p.abiertas.cargue_docente).toBe(true);
    expect(p.ventanas.registro_fur).toBeUndefined();
    expect(p.abiertas.registro_fur).toBe(false);
    expect(p.modalidadesOfertadas).toEqual([ModalidadPractica.PASANTIA, ModalidadPractica.MONITORIA]);
    expect(p.sincronizacionDocentes).toBe(false);
    await expect(caso.actualizar('2026C', { activo: false }, docente, HOY)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(caso.actualizar('2026C', { ventanas: { [TipoVentana.CARTA_PRESENTACION]: { desde: '2026-09-01', hasta: '2026-08-01' } } }, admin, HOY)).rejects.toBeInstanceOf(BadRequestException);
  });
});
