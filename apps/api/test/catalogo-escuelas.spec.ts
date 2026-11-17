import 'reflect-metadata';
import { CatalogoController } from '../src/infrastructure/controllers/catalogo.controller';
import { CLAVE_AUTENTICADO } from '../src/infrastructure/auth/roles.decorator';

/** G4 · catálogo de escuelas para elegir el alcance de un usuario (solo lectura, cualquier sesión). */
describe('G4 · GET /catalogo/escuelas', () => {
  it('devuelve las escuelas del catálogo institucional tal como las entrega el puerto', async () => {
    const escuelas = [{ codigo: 'ESC-ING', nombre: 'Escuela de Ingenierías' }];
    const controlador = new CatalogoController({} as never, { estados: async () => [], escuelas: async () => escuelas });
    await expect(controlador.escuelas()).resolves.toEqual(escuelas);
  });

  it('es de solo lectura y para cualquier sesión (política @Autenticado del controlador)', () => {
    expect(Reflect.getMetadata(CLAVE_AUTENTICADO, CatalogoController)).toBe(true);
    const manejador = (CatalogoController.prototype as unknown as Record<string, () => void>).escuelas;
    expect(Reflect.getMetadata('method', manejador)).toBe(0); // GET
  });
});
