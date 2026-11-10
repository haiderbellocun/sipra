import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { debeMostrarUsuariosDePrueba } from '../src/app/features/ingreso/usuarios-prueba';

const dev = { produccion: false, ambiente: 'dev' };
const abierto = { modo: 'abierto' as const, ambiente: 'dev', permiteSelectorDePerfil: true };

describe('debeMostrarUsuariosDePrueba', () => {
  it('visible en desarrollo con el selector habilitado por el servidor', () => {
    assert.equal(debeMostrarUsuariosDePrueba(abierto, dev), true);
  });

  it('visible en pruebas (qa) si el servidor lo habilita', () => {
    assert.equal(debeMostrarUsuariosDePrueba({ ...abierto, ambiente: 'qa' }, { produccion: false, ambiente: 'qa' }), true);
  });

  it('oculto con entorno.produccion = true aunque el servidor dijera abierto', () => {
    assert.equal(debeMostrarUsuariosDePrueba(abierto, { produccion: true, ambiente: 'dev' }), false);
  });

  it('oculto con ambiente pre o prod del cliente aunque el servidor dijera abierto', () => {
    for (const ambiente of ['pre', 'prod', 'PROD', 'preproduccion', 'produccion']) {
      assert.equal(debeMostrarUsuariosDePrueba(abierto, { produccion: false, ambiente }), false, ambiente);
    }
  });

  it('oculto si el servidor declara un ambiente pre o prod', () => {
    assert.equal(debeMostrarUsuariosDePrueba({ ...abierto, ambiente: 'prod' }, dev), false);
    assert.equal(debeMostrarUsuariosDePrueba({ ...abierto, ambiente: 'pre' }, dev), false);
  });

  it('oculto si el servidor no permite el selector o aún no respondió', () => {
    assert.equal(debeMostrarUsuariosDePrueba({ ...abierto, permiteSelectorDePerfil: false }, dev), false);
    assert.equal(debeMostrarUsuariosDePrueba({ modo: 'oidc', ambiente: 'dev', permiteSelectorDePerfil: false }, dev), false);
    assert.equal(debeMostrarUsuariosDePrueba(null, dev), false);
    assert.equal(debeMostrarUsuariosDePrueba(undefined, dev), false);
  });
});
