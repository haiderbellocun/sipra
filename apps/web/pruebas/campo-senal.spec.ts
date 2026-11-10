import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CAPAS, REACCION_VACIA, calcularReaccion, generarCampo } from '../src/app/features/ingreso/campo-senal';

describe('generarCampo (determinista)', () => {
  const campo = generarCampo();

  it('misma semilla, mismo campo; otra semilla, otro campo', () => {
    assert.deepEqual(generarCampo(), campo);
    assert.notDeepEqual(generarCampo(7).nodos[0], campo.nodos[0]);
  });

  it('cantidad: 34 curvas y 90 partículas en 3 capas', () => {
    assert.equal(campo.curvas.length, 34);
    assert.equal(campo.nodos.length, 90);
    assert.ok(campo.nodos.length <= 96);
    for (const capa of [0, 1, 2]) {
      assert.equal(campo.nodos.filter((n) => n.capa === capa).length, CAPAS[capa].n);
    }
  });

  it('radios: partículas pequeñas, de 1,2 (lejos) a 1,9 (cerca) — diámetro ≈ 3 como en el frame', () => {
    assert.ok(campo.nodos.filter((n) => n.capa === 0).every((n) => n.r === 1.2));
    assert.ok(campo.nodos.filter((n) => n.capa === 2).every((n) => n.r === 1.9));
  });

  it('amplitud de deriva entre 4 y 16 px (lejos 4–6; cerca hasta 16)', () => {
    for (const n of campo.nodos) {
      for (const a of [Math.abs(n.dx), Math.abs(n.dy)]) { assert.ok(a >= 4 && a <= 16, `amplitud ${a}`); }
      if (n.capa === 0) assert.ok(Math.abs(n.dx) <= 6 && Math.abs(n.dy) <= 6);
    }
  });

  it('duraciones entre 10 y 24 s y retrasos negativos', () => {
    for (const n of campo.nodos) { assert.ok(n.dur >= 10 && n.dur <= 24, `dur ${n.dur}`); assert.ok(n.retraso <= 0 && n.retraso >= -n.dur); }
    for (const c of campo.curvas) { assert.ok(c.dur >= 10 && c.dur <= 24); assert.ok(c.retraso <= 0); }
  });

  it('las fases NO coinciden: muchas duraciones y retrasos distintos', () => {
    assert.ok(new Set(campo.nodos.map((n) => n.dur)).size > 40);
    assert.ok(new Set(campo.nodos.map((n) => n.retraso)).size > 40);
    assert.ok(new Set(campo.curvas.map((c) => c.retraso)).size > 15);
  });

  it('todos los nodos caen dentro del viewBox', () => {
    for (const n of campo.nodos) { assert.ok(n.x >= 0 && n.x <= 1440 && n.y >= 0 && n.y <= 1024); }
  });
});

describe('calcularReaccion (proximidad del puntero)', () => {
  const nodos = generarCampo().nodos;
  const o = { radio: 170, maxDesplazamiento: 4, maxConexiones: 3, zonaProtegida: false };

  it('ningún desplazamiento supera 4 px y los brillos están en (0, 1]', () => {
    for (const nodo of nodos.slice(0, 20)) {
      const r = calcularReaccion(nodos, { x: nodo.x + 1, y: nodo.y - 1 }, o);
      for (const n of r.nodos) {
        assert.ok(Math.hypot(n.dx, n.dy) <= 4 + 1e-9);
        assert.ok(n.brillo > 0 && n.brillo <= 1);
      }
    }
  });

  it('ningún nodo fuera del radio reacciona', () => {
    const p = { x: 400, y: 300 };
    const r = calcularReaccion(nodos, p, o);
    for (const n of r.nodos) assert.ok(Math.hypot(nodos[n.indice].x - p.x, nodos[n.indice].y - p.y) < o.radio);
    const dentro = nodos.filter((n) => Math.hypot(n.x - p.x, n.y - p.y) < o.radio).length;
    assert.equal(r.nodos.length, dentro);
  });

  it('hasta 3 conexiones temporales, entre nodos que reaccionan', () => {
    const r = calcularReaccion(nodos, { x: 400, y: 300 }, { ...o, radio: 600 });
    assert.ok(r.conexiones.length > 0 && r.conexiones.length <= 3);
    const idx = new Set(r.nodos.map((n) => n.indice));
    for (const [a, b] of r.conexiones) assert.ok(idx.has(a) && idx.has(b) && a !== b);
  });

  it('en zona protegida o sin puntero no hay efecto alguno', () => {
    assert.equal(calcularReaccion(nodos, { x: nodos[0].x, y: nodos[0].y }, { ...o, zonaProtegida: true }), REACCION_VACIA);
    assert.equal(calcularReaccion(nodos, null, o), REACCION_VACIA);
  });

  it('las capas lejanas se mueven menos que las cercanas a igual distancia', () => {
    const lejos = { x: 100, y: 100, capa: 0 as const };
    const cerca = { x: 100, y: 100, capa: 2 as const };
    const r = calcularReaccion([lejos, cerca], { x: 110, y: 100 }, o);
    assert.ok(Math.hypot(r.nodos[0].dx, r.nodos[0].dy) < Math.hypot(r.nodos[1].dx, r.nodos[1].dy));
  });
});
