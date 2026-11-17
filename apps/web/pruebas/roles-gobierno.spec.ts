import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROLES_OPERACION_PRACTICAS, tieneRol } from '@core/auth/roles';

// G1 (0.39.1): la interfaz compara roles de forma exacta, igual que `@Roles` en la API.
describe('G1 · roles en la interfaz', () => {
  it('operación de prácticas = coordinador + analista; el director no pertenece', () => {
    assert.deepEqual([...ROLES_OPERACION_PRACTICAS].sort(), ['analista', 'coordinador']);
    assert.equal(ROLES_OPERACION_PRACTICAS.includes('director'), false);
  });

  it("una lista con 'coordinador' NO admite por sí sola al analista ni al director", () => {
    assert.equal(tieneRol(['coordinador', 'administrador'], 'coordinador'), true);
    assert.equal(tieneRol(['coordinador', 'administrador'], 'analista'), false);
    assert.equal(tieneRol(['coordinador', 'administrador'], 'director'), false);
  });

  it('las listas declaran explícitamente a quien corresponde', () => {
    assert.equal(tieneRol(['coordinador', 'analista'], 'analista'), true);
    assert.equal(tieneRol(['administrador', 'director'], 'director'), true);
    assert.equal(tieneRol(['administrador', 'director'], 'coordinador'), false);
    assert.equal(tieneRol(['coordinador'], null), false);
  });
});
