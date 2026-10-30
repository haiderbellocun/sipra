import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GestionarPracticaUseCase } from '../src/application/use-cases/practicas/gestionar-practica.use-case';
import { DatosPractica, EstadoPractica, Practica } from '../src/domain/entities/practica.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { actorDe, empresaDe, practicaDe, usuarioDe } from './soporte-autorizacion';

/**
 * Quién puede cambiar «quién asume la ARL» DESPUÉS del registro. El estudiante lo fija al registrar; luego solo
 * coordinación y administración lo cambian (no se amplían permisos: es un subconjunto de quienes ya editan la práctica).
 * El acta de iniciación nunca lo toca.
 */
function montar(inicial: Partial<DatosPractica> = {}) {
  let actual: DatosPractica = practicaDe({ estudianteId: 'estudiante-1', empresaId: 'empresa-a', estado: EstadoPractica.INSCRITA, responsableArlPractica: null, ...inicial }).instantanea();
  const auditorias: { accion: string; metadatos: Record<string, unknown> | null; actorRol: string | null }[] = [];
  let guardados = 0;
  const caso = new GestionarPracticaUseCase(
    {
      buscarPorId: () => Promise.resolve(Practica.desde(actual)),
      guardar: (d: DatosPractica) => { actual = d; guardados += 1; return Promise.resolve(Practica.desde(d)); },
    } as never,
    { listarPorPractica: () => Promise.resolve([]) } as never,
    { listarPorPractica: () => Promise.resolve([]) } as never,
    { buscarPorId: () => Promise.resolve(empresaDe('empresa-a')) } as never,
    { buscarPorId: (id: string) => Promise.resolve(usuarioDe(id === 'estudiante-1' ? Rol.ESTUDIANTE : Rol.TUTOR, { id })) } as never,
    { registrar: (r: { accion: string; metadatos: Record<string, unknown> | null; actorRol: string | null }) => { auditorias.push(r); return Promise.resolve(); } } as never,
    { numero: () => Promise.resolve(15) } as never,
  );
  return { caso, auditorias, estado: () => actual, guardados: () => guardados };
}

const estudiante = actorDe(Rol.ESTUDIANTE, { id: 'estudiante-1' });

describe('Responsable de la ARL de la práctica · quién lo cambia después del registro', () => {
  it.each([Rol.ESTUDIANTE, Rol.TUTOR, Rol.AUXILIAR])('%s NO puede cambiarlo: 403 y no se guarda nada (ni lo demás de la edición)', async (rol) => {
    const { caso, estado, guardados, auditorias } = montar({ tutorId: `${Rol.TUTOR}-1` });
    const actor = rol === Rol.ESTUDIANTE ? estudiante : actorDe(rol);
    await expect(caso.actualizarVacante('practica-1', { responsableArl: 'cun', cargo: 'Otro cargo' }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(guardados()).toBe(0);
    expect(estado().responsableArlPractica).toBeNull();
    expect(estado().cargo).not.toBe('Otro cargo');
    expect(auditorias).toHaveLength(0);
  });

  it.each([Rol.EMPRESA, Rol.EXTENSION])('%s sigue sin editar la práctica (regla existente)', async (rol) => {
    const { caso } = montar();
    await expect(caso.actualizarVacante('practica-1', { responsableArl: 'cun' }, actorDe(rol, { empresaId: 'empresa-a' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([Rol.COORDINADOR, Rol.ADMINISTRADOR])('%s SÍ puede cambiarlo, y queda en auditoría con el valor anterior y el nuevo', async (rol) => {
    const { caso, estado, auditorias } = montar({ responsableArlPractica: 'empresa' });
    const r = await caso.actualizarVacante('practica-1', { responsableArl: 'cun' }, actorDe(rol));
    expect(estado().responsableArlPractica).toBe('cun');
    expect(r.responsableArl).toBe('cun');
    const cambio = auditorias.find((a) => a.accion === 'responsable_arl_practica_actualizado')!;
    expect(cambio.metadatos).toEqual({ de: 'empresa', a: 'cun' });
    expect(cambio.actorRol).toBe(rol);
    expect(auditorias.map((a) => a.accion)).toContain('vacante_practica_actualizada');
  });

  it('coordinación puede fijarlo en una práctica histórica (null → valor)', async () => {
    const { caso, estado, auditorias } = montar({ responsableArlPractica: null });
    await caso.actualizarVacante('practica-1', { responsableArl: 'empresa' }, actorDe(Rol.COORDINADOR));
    expect(estado().responsableArlPractica).toBe('empresa');
    expect(auditorias.find((a) => a.accion === 'responsable_arl_practica_actualizado')!.metadatos).toEqual({ de: null, a: 'empresa' });
  });

  it('repetir el mismo valor no genera un cambio auditado de más', async () => {
    const { caso, auditorias } = montar({ responsableArlPractica: 'cun' });
    await caso.actualizarVacante('practica-1', { responsableArl: 'cun' }, actorDe(Rol.COORDINADOR));
    expect(auditorias.filter((a) => a.accion === 'responsable_arl_practica_actualizado')).toHaveLength(0);
  });

  it('el estudiante sigue editando los demás datos de la vacante, y eso NO toca el responsable de la ARL', async () => {
    const { caso, estado } = montar({ responsableArlPractica: 'cun' });
    await caso.actualizarVacante('practica-1', { cargo: 'Analista junior', ciudad: 'Medellín' }, estudiante);
    expect(estado()).toMatchObject({ cargo: 'Analista junior', ciudad: 'Medellín', responsableArlPractica: 'cun' });
  });

  it('en una práctica cerrada no se cambia', async () => {
    const { caso } = montar({ estado: EstadoPractica.CERTIFICADA, responsableArlPractica: 'cun' });
    await expect(caso.actualizarVacante('practica-1', { responsableArl: 'empresa' }, actorDe(Rol.COORDINADOR))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un valor distinto de empresa/cun no es válido en el dominio', () => {
    const p = practicaDe({ estado: EstadoPractica.INSCRITA });
    expect(() => p.definirResponsableArl('segun_cobertura' as never)).toThrow('Responsable de la ARL no válido');
  });
});
