import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GestionarEmpresaUseCase } from '../src/application/use-cases/empresas/gestionar-empresa.use-case';
import { Empresa } from '../src/domain/entities/empresa.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { actorDe, empresaDe } from './soporte-autorizacion';

/**
 * Bandeja y detalle de empresas: solo quien administra el módulo empresarial y la
 * propia empresa. Un estudiante, un docente o un auxiliar no listan empresas ni
 * obtienen el nombre y correo del solicitante; lo que necesitan de su práctica
 * llega en el expediente.
 */

const A = empresaDe('empresa-a');
const B = empresaDe('empresa-b');

function casoDeUso(): GestionarEmpresaUseCase {
  const empresas = {
    listar: jest.fn().mockResolvedValue([A, B]),
    buscarPorId: jest.fn((id: string) => Promise.resolve([A, B].find((e: Empresa) => e.id === id) ?? null)),
  };
  return new GestionarEmpresaUseCase(empresas as never, { registrar: jest.fn() } as never, {} as never);
}

describe('Empresas · listar', () => {
  it.each([Rol.ESTUDIANTE, Rol.TUTOR, Rol.AUXILIAR])('%s → denegado', async (rol) => {
    await expect(casoDeUso().listar(undefined, actorDe(rol))).rejects.toThrow(ForbiddenException);
  });

  it.each([Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.EXTENSION])('%s → ve la bandeja completa', async (rol) => {
    const lista = await casoDeUso().listar(undefined, actorDe(rol));
    expect(lista.map((e) => e.id)).toEqual(['empresa-a', 'empresa-b']);
  });

  it('empresa → solo la propia', async () => {
    const lista = await casoDeUso().listar(undefined, actorDe(Rol.EMPRESA, { empresaId: 'empresa-a' }));
    expect(lista.map((e) => e.id)).toEqual(['empresa-a']);
  });

  it('empresa sin empresa asociada → nada', async () => {
    expect(await casoDeUso().listar(undefined, actorDe(Rol.EMPRESA, { empresaId: null }))).toEqual([]);
  });

  it('los perfiles internos ven las señales de pre-verificación; la empresa no', async () => {
    const interno = await casoDeUso().listar(undefined, actorDe(Rol.COORDINADOR));
    const propia = await casoDeUso().listar(undefined, actorDe(Rol.EMPRESA, { empresaId: 'empresa-a' }));
    expect(interno[0]).toHaveProperty('senales');
    expect(propia[0]).not.toHaveProperty('senales');
  });
});

describe('Empresas · detalle (autorización por objeto)', () => {
  it.each([Rol.ESTUDIANTE, Rol.TUTOR, Rol.AUXILIAR])('%s no consulta una empresa por su UUID', async (rol) => {
    await expect(casoDeUso().obtener('empresa-a', actorDe(rol))).rejects.toThrow(ForbiddenException);
  });

  it('empresa → la propia sí', async () => {
    const detalle = await casoDeUso().obtener('empresa-a', actorDe(Rol.EMPRESA, { empresaId: 'empresa-a' }));
    expect(detalle.id).toBe('empresa-a');
  });

  it('empresa → otra empresa: 404 genérico, no confirma que exista', async () => {
    await expect(casoDeUso().obtener('empresa-b', actorDe(Rol.EMPRESA, { empresaId: 'empresa-a' })))
      .rejects.toThrow(NotFoundException);
    await expect(casoDeUso().obtener('no-existe', actorDe(Rol.EMPRESA, { empresaId: 'empresa-a' })))
      .rejects.toThrow(NotFoundException);
  });

  it.each([Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.EXTENSION])('%s → cualquier empresa', async (rol) => {
    const detalle = await casoDeUso().obtener('empresa-b', actorDe(rol));
    expect(detalle).toMatchObject({ id: 'empresa-b', solicitanteCorreo: 'solicitante@empresa.example' });
  });
});
