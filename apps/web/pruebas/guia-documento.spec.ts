import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DIAS_SUBSANACION, guiaDocumento, lineaVersionAnterior } from '../src/app/features/practicas/guia-documento';

const PROHIBIDO = /documento_incorrecto|en_revision|ocr|pipeline|analizando|auto_aprobado|C[0-9]_|banderas?|token|pdf\.js/i;

describe('Guía del documento para quien estudia: qué pasó y qué hacer, en lenguaje humano', () => {
  const estados: Array<[string | null, string, boolean]> = [
    [null, 'Pendiente de cargar', false], ['recibido', 'Procesando', false], ['analizando', 'Procesando', false],
    ['en_revision', 'En revisión', false], ['ilegible', 'Necesita corrección', true], ['devuelto', 'Necesita corrección', true],
    ['aprobado', 'Aprobado', false], ['auto_aprobado', 'Aprobado', false], ['rechazado', 'Rechazado', false],
  ];


  for (const [estado, etiqueta, corregir] of estados) {
    it(`«${estado}» → «${etiqueta}», con qué pasó y qué hacer`, () => {
      const g = guiaDocumento(estado, 'Certificado de EPS');
      assert.equal(g.estado, etiqueta);
      assert.equal(g.necesitaCorreccion, corregir);
      assert.ok(g.que.length > 10 && g.hacer.length > 10, 'siempre dice qué pasó Y qué hacer');
    });
    it(`«${estado}» no muestra códigos ni nombres internos`, () => {
      const g = guiaDocumento(estado, 'Certificado de EPS');
      assert.doesNotMatch(`${g.estado} ${g.que} ${g.hacer}`, PROHIBIDO);
    });
  }

  it('devuelto: nombra el documento y el plazo de subsanación', () => {
    const g = guiaDocumento('devuelto', 'Certificado de EPS');
    assert.match(g.que, /^Tu certificado de EPS necesita una corrección.$/); // las siglas se conservan
    assert.match(g.hacer, new RegExp(`${DIAS_SUBSANACION} días`));
  });

  it('un estado desconocido no rompe ni muestra el código', () => {
    const g = guiaDocumento('algo_nuevo', 'Acta de inicio');
    assert.doesNotMatch(`${g.estado} ${g.que} ${g.hacer}`, /algo_nuevo/);
  });

  it('la versión anterior se resume en una línea', () => {
    assert.equal(lineaVersionAnterior(2, 'devuelto', 'Certificado de EPS'), 'Versión 2 · Necesita corrección');
  });
});
