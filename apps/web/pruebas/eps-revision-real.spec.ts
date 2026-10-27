import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CERTIFICADO_VS_SIPRA, RECOMENDACION, SEVERIDAD_DISCREPANCIA, apartaDeRecomendacion, fechaIso,
} from '../src/app/features/eps/eps.util';

/** Rótulos y fechas de la revisión de certificados reales: un dato ausente nunca se muestra como «coincide». */

describe('eps.util · revisión de certificados reales', () => {
  it('fechaIso no corre el día por la zona horaria y tolera lo que no es fecha', () => {
    assert.equal(fechaIso('2014-01-13'), '13/01/2014');
    assert.equal(fechaIso('2026-10-26T03:00:00.000Z'), '26/10/2026');
    assert.equal(fechaIso(null), '—');
    assert.equal(fechaIso('no es fecha'), '—');
  });

  it('«Certificado vs SIPRA»: ausente es información insuficiente, no coincidencia', () => {
    assert.equal(CERTIFICADO_VS_SIPRA['insuficiente'].texto, 'Información insuficiente');
    assert.notEqual(CERTIFICADO_VS_SIPRA['insuficiente'].tono, CERTIFICADO_VS_SIPRA['coincide'].tono);
    assert.equal(CERTIFICADO_VS_SIPRA['diferente'].tono, 'peligro');
  });

  it('cada severidad de discrepancia lleva icono y texto (no solo color)', () => {
    for (const s of ['critica', 'informativa', 'insuficiente']) {
      assert.ok(SEVERIDAD_DISCREPANCIA[s].icono.length > 0 && SEVERIDAD_DISCREPANCIA[s].texto.length > 0);
    }
    assert.equal(SEVERIDAD_DISCREPANCIA['insuficiente'].texto, 'Información insuficiente');
  });

  it('las recomendaciones nuevas tienen rótulo: documento incorrecto y certificado vencido', () => {
    assert.equal(RECOMENDACION['documento_incorrecto'].tono, 'peligro');
    assert.equal(RECOMENDACION['certificado_vencido'].texto, 'Certificado vencido');
  });

  it('aprobar contra «documento incorrecto» se aparta (justificación reforzada); contra «vencido» no', () => {
    assert.equal(apartaDeRecomendacion('aprobar', 'documento_incorrecto'), true);
    assert.equal(apartaDeRecomendacion('aprobar', 'certificado_vencido'), false);
  });
});
