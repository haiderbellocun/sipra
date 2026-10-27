import '@angular/compiler';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpErrorResponse } from '@angular/common/http';
import { ReservaMesa } from '@core/models/modelos';
import {
  AFILIACION, AUTENTICIDAD, ESTADO_ADRES, ESTADO_RESERVA, RECOMENDACION, RESULTADO_COMPARACION,
  apartaDeRecomendacion, reservaVencidaAhora, textoRestante, traducirErrorEps,
} from '../src/app/features/eps/eps.util';

const http = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

describe('eps.util · rótulos', () => {
  it('todo rótulo lleva icono y texto (nada se comunica solo con color)', () => {
    for (const grupo of [AUTENTICIDAD, AFILIACION, ESTADO_ADRES, RECOMENDACION, RESULTADO_COMPARACION, ESTADO_RESERVA]) {
      for (const [clave, r] of Object.entries(grupo)) {
        assert.ok(r.icono.length > 0 && r.texto.length > 0, `${clave} sin icono o texto`);
      }
    }
  });

  it('la recomendación se rotula como ayuda, nunca como "aprobado"', () => {
    for (const r of Object.values(RECOMENDACION)) assert.doesNotMatch(r.texto, /aprobad/i);
  });
});

describe('eps.util · apartaDeRecomendacion', () => {
  it('aprobar contra discrepancia crítica o posible rechazo se aparta', () => {
    assert.equal(apartaDeRecomendacion('aprobar', 'discrepancia_critica'), true);
    assert.equal(apartaDeRecomendacion('aprobar', 'recomendar_revision_rechazo'), true);
  });
  it('rechazar a un candidato se aparta', () => {
    assert.equal(apartaDeRecomendacion('rechazar', 'candidato_autoaprobacion'), true);
  });
  it('lo demás no se aparta', () => {
    assert.equal(apartaDeRecomendacion('aprobar', 'candidato_autoaprobacion'), false);
    assert.equal(apartaDeRecomendacion('devolver', 'discrepancia_critica'), false);
    assert.equal(apartaDeRecomendacion('rechazar', 'discrepancia_critica'), false);
  });
});

describe('eps.util · reserva', () => {
  const ahora = Date.parse('2026-10-26T12:00:00Z');
  const hasta = (ms: number): string => new Date(ahora + ms).toISOString();

  it('textoRestante muestra minutos, segundos o "venció"', () => {
    assert.equal(textoRestante(hasta(10 * 60_000 + 5_000), ahora), '10 min');
    assert.equal(textoRestante(hasta(45_000), ahora), '45 s');
    assert.equal(textoRestante(hasta(-1), ahora), 'venció');
    assert.equal(textoRestante(null, ahora), '');
  });

  it('reservaVencidaAhora solo aplica a una reserva propia cuya hora ya pasó', () => {
    const r = (estado: ReservaMesa['estado'], ms: number | null): ReservaMesa => ({ estado, responsable: 'x', hasta: ms === null ? null : hasta(ms) });
    assert.equal(reservaVencidaAhora(r('mia', -1), ahora), true);
    assert.equal(reservaVencidaAhora(r('mia', 1000), ahora), false);
    assert.equal(reservaVencidaAhora(r('ajena', -1000), ahora), false);
    assert.equal(reservaVencidaAhora(r('libre', null), ahora), false);
  });
});

describe('eps.util · traducirErrorEps', () => {
  it('traduce cada código HTTP relevante a un mensaje claro', () => {
    assert.match(traducirErrorEps(http(0)), /conexión/i);
    assert.match(traducirErrorEps(http(401)), /sesión/i);
    assert.match(traducirErrorEps(http(403)), /permiso/i);
    assert.match(traducirErrorEps(http(404)), /ya no existe|alcance/i);
    assert.match(traducirErrorEps(http(410)), /venció|ya se usó/i);
    assert.match(traducirErrorEps(http(415)), /PDF/);
    assert.match(traducirErrorEps(http(500)), /servidor/i);
  });

  it('409 usa el mensaje del servidor si es comprensible; si no, uno genérico', () => {
    assert.equal(traducirErrorEps(http(409, { message: 'El caso está reservado por otro funcionario' })), 'El caso está reservado por otro funcionario');
    assert.match(traducirErrorEps(http(409, null)), /cambió|otra persona/i);
  });

  it('422 con arreglo de mensajes los une', () => {
    assert.equal(traducirErrorEps(http(422, { message: ['Falta el motivo', 'Justificación corta'] })), 'Falta el motivo. Justificación corta');
  });

  it('no filtra trazas ni detalles internos del servidor', () => {
    const texto = traducirErrorEps(http(409, { message: 'Error at Object.<anonymous> (C:\\app\\x.ts:1:1) stack' }));
    assert.doesNotMatch(texto, /Object|C:\\/);
  });

  it('un error que no es HTTP da un mensaje neutro', () => {
    assert.match(traducirErrorEps(new Error('boom')), /No fue posible/);
  });
});
