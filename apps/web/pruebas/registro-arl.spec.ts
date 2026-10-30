import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ayudaArl, etiquetaResponsableArl, sugerenciaArl, valorArlAlElegirModalidad,
} from '../src/app/features/registro/arl-registro';

const PROHIBIDO = /segun_cobertura|undefined|null|enum|catálogo/i;

describe('Registro (FUR) · «¿Quién asume la ARL?»', () => {
  describe('la modalidad solo SUGIERE', () => {
    it('el catálogo «cun» o «empresa» se propone; «según cobertura» no se resuelve por modalidad', () => {
      assert.equal(sugerenciaArl('cun'), 'cun');
      assert.equal(sugerenciaArl('empresa'), 'empresa');
      assert.equal(sugerenciaArl('segun_cobertura'), null);
      assert.equal(sugerenciaArl(undefined), null);
      assert.equal(sugerenciaArl(''), null);
    });

    it('al elegir modalidad la sugerencia queda marcada (visible) si la persona aún no eligió', () => {
      assert.equal(valorArlAlElegirModalidad('', false, 'empresa'), 'empresa');
      assert.equal(valorArlAlElegirModalidad('', false, 'cun'), 'cun');
    });

    it('sin sugerencia (según cobertura) no se marca nada: hay que elegir', () => {
      assert.equal(valorArlAlElegirModalidad('', false, null), '');
      // Si antes había una sugerencia y ahora no hay, tampoco queda una opción marcada por la modalidad anterior.
      assert.equal(valorArlAlElegirModalidad('cun', false, null), '');
    });

    it('si la persona ya eligió, cambiar de modalidad NO le pisa la elección', () => {
      assert.equal(valorArlAlElegirModalidad('cun', true, 'empresa'), 'cun');
      assert.equal(valorArlAlElegirModalidad('empresa', true, null), 'empresa');
    });
  });

  describe('la ayuda dice qué pasa, en lenguaje de quien registra', () => {
    it('sin modalidad: explica que quien registra confirma', () => {
      assert.match(ayudaArl(false, null, ''), /Tú confirmas/);
    });
    it('con sugerencia y sin cambios: «Sugerencia según la modalidad» y que se puede cambiar', () => {
      assert.match(ayudaArl(true, 'empresa', 'empresa'), /^Sugerencia según la modalidad: Empresa\./);
      assert.match(ayudaArl(true, 'cun', 'cun'), /^Sugerencia según la modalidad: CUN\./);
      assert.match(ayudaArl(true, 'empresa', 'empresa'), /puedes cambiarla si el acuerdo de esta práctica establece algo diferente/);
    });
    it('si la persona eligió otra opción, lo dice y aclara que se guarda lo suyo', () => {
      const t = ayudaArl(true, 'empresa', 'cun');
      assert.match(t, /Sugerencia según la modalidad: Empresa/);
      assert.match(t, /se guarda lo que tú elijas/);
    });
    it('sin sugerencia: pide indicar según lo acordado', () => {
      assert.match(ayudaArl(true, null, ''), /según lo acordado/);
    });
    it('nunca muestra códigos ni valores internos', () => {
      for (const t of [ayudaArl(false, null, ''), ayudaArl(true, 'empresa', 'empresa'), ayudaArl(true, 'empresa', 'cun'), ayudaArl(true, null, '')]) {
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
