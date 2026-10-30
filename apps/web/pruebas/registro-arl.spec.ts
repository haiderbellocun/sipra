import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as modulo from '../src/app/features/registro/arl-registro';
import {
  ERROR_ARL_SIN_ELEGIR, ayudaArl, etiquetaResponsableArl, sugerenciaArl,
} from '../src/app/features/registro/arl-registro';

const PROHIBIDO = /segun_cobertura|undefined|null|enum|catálogo/i;

describe('Registro (FUR) · «¿Quién asume la ARL?»', () => {
  describe('la modalidad solo SUGIERE: nunca marca una opción', () => {
    it('el catálogo «cun» o «empresa» se sugiere; «según cobertura» no se resuelve por modalidad', () => {
      assert.equal(sugerenciaArl('cun'), 'cun');
      assert.equal(sugerenciaArl('empresa'), 'empresa');
      assert.equal(sugerenciaArl('segun_cobertura'), null);
      assert.equal(sugerenciaArl(undefined), null);
      assert.equal(sugerenciaArl(''), null);
    });
    it('el módulo ya no ofrece ninguna función que seleccione por la persona', () => {
      assert.equal('valorArlAlElegirModalidad' in modulo, false);
    });
    it('el error es humano y dice qué hacer', () => {
      assert.equal(ERROR_ARL_SIN_ELEGIR, 'Selecciona quién asume la ARL.');
    });
  });

  describe('la ayuda dice qué pasa, en lenguaje de quien registra', () => {
    it('sin modalidad: explica que quien registra confirma', () => {
      assert.match(ayudaArl(false, null, ''), /Tú confirmas/);
    });
    it('con sugerencia y sin elección: la muestra y pide confirmar quién asume la ARL', () => {
      assert.match(ayudaArl(true, 'empresa', ''), /^Sugerencia según la modalidad: Empresa./);
      assert.match(ayudaArl(true, 'cun', ''), /^Sugerencia según la modalidad: CUN./);
      assert.match(ayudaArl(true, 'empresa', ''), /La modalidad sugiere esta opción, pero confirma quién asume la ARL en esta práctica./);
    });
    it('si la persona eligió algo distinto, se lo dice sin bloquear; si coincide, también', () => {
      assert.match(ayudaArl(true, 'empresa', 'cun'), /Tu elección es diferente de la sugerencia de la modalidad./);
      assert.match(ayudaArl(true, 'empresa', 'empresa'), /Tu elección coincide con la sugerencia./);
    });
    it('cambiar de modalidad solo cambia la sugerencia: la elección es la misma', () => {
      // La ayuda depende de (sugerencia, elección): con la misma elección, otra modalidad solo cambia el mensaje.
      assert.match(ayudaArl(true, 'cun', 'empresa'), /Sugerencia según la modalidad: CUN..*diferente/);
      assert.match(ayudaArl(true, null, 'empresa'), /según lo acordado/);
    });
    it('sin sugerencia: pide indicar según lo acordado', () => {
      assert.match(ayudaArl(true, null, ''), /según lo acordado/);
    });
    it('nunca muestra códigos ni valores internos', () => {
      for (const t of [ayudaArl(false, null, ''), ayudaArl(true, 'empresa', 'empresa'), ayudaArl(true, 'empresa', 'cun'), ayudaArl(true, 'cun', ''), ayudaArl(true, null, '')]) {
        assert.doesNotMatch(t, PROHIBIDO);
      }
    });
  });

  describe('cómo se ve el dato guardado', () => {
    it('empresa y CUN con su nombre; las prácticas anteriores a este dato, «No informado» (no se inventa)', () => {
      assert.equal(etiquetaResponsableArl('empresa'), 'Empresa');
      assert.equal(etiquetaResponsableArl('cun'), 'CUN');
      assert.equal(etiquetaResponsableArl(null), 'No informado');
      assert.equal(etiquetaResponsableArl(undefined), 'No informado');
      assert.equal(etiquetaResponsableArl('segun_cobertura'), 'No informado');
    });
  });
});
