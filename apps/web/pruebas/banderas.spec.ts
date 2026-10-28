import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TEXTO_BANDERA, textoBandera } from '../src/app/features/practicas/banderas';

describe('Alertas del análisis en lenguaje humano', () => {
  it('ninguna traducción lleva el código interno ni sus abreviaturas', () => {
    for (const [codigo, texto] of Object.entries(TEXTO_BANDERA)) {
      assert.doesNotMatch(texto, /C[0-3]_|_[A-Z]{3,}|hash|pdf417|nuip/i, codigo);
      assert.ok(texto.length > 15 && texto.endsWith('.'), `${codigo} debe ser una frase completa`);
    }
  });

  it('C0_HASH_DUPLICADO → el mismo archivo ya fue cargado anteriormente', () => {
    assert.equal(textoBandera('C0_HASH_DUPLICADO', 'El mismo archivo fue presentado en 2 expediente(s)'), 'El mismo archivo ya fue cargado anteriormente.');
  });

  it('un código desconocido usa el mensaje del servidor y, sin mensaje, una frase neutra; nunca el código', () => {
    assert.equal(textoBandera('C9_NUEVO', 'Mensaje del servidor'), 'Mensaje del servidor');
    assert.doesNotMatch(textoBandera('C9_NUEVO', null), /C9_/);
    assert.doesNotMatch(textoBandera('C9_NUEVO', '  '), /C9_/);
  });
});
