import {
  CATALOGO_PARAMETROS, NaturalezaParametro, ParametroDesconocidoError,
  ParametroNormativoError, TipoParametro, ValorParametroInvalidoError,
  definicionDe, validarCambio, validarCoherenciaUmbrales,
} from '../src/domain/entities/parametro.entity';

describe('M12 · catálogo de parámetros', () => {
  it('no admite una clave que nadie declaró', () => {
    expect(() => validarCambio('pipeline.inventado', 10)).toThrow(ParametroDesconocidoError);
  });

  it('no permite cambiar lo que fija una norma, y dice cuál', () => {
    let error: Error | undefined;
    try { validarCambio('vacantes.vigencia_maxima_meses', 12); } catch (e) { error = e as Error; }
    expect(error).toBeInstanceOf(ParametroNormativoError);
    expect(error?.message).toContain('Resolución 2605 de 2014');
  });

  it('la compuerta de ARL no se puede desactivar desde administración', () => {
    expect(() => validarCambio('arl.exige_afiliacion_previa', false))
      .toThrow(ParametroNormativoError);
  });

  describe('validación de valores operativos', () => {
    it('acepta un valor dentro del rango', () => {
      expect(validarCambio('pipeline.umbral_verde', 90)).toBe(90);
    });

    it('convierte el texto de un formulario a número', () => {
      expect(validarCambio('acompanamiento.dias_sin_actividad', '21')).toBe(21);
    });

    it('rechaza por debajo del mínimo', () => {
      expect(() => validarCambio('plan_mejoramiento.dias_plazo', 3))
        .toThrow(/no puede ser menor que 7/);
    });

    it('rechaza por encima del máximo', () => {
      expect(() => validarCambio('pipeline.umbral_verde', 120))
        .toThrow(/no puede ser mayor que 100/);
    });

    it('rechaza un decimal donde se espera un entero', () => {
      expect(() => validarCambio('auditoria.consultas_por_hora', 12.5))
        .toThrow(ValorParametroInvalidoError);
    });

    it('rechaza texto que no es un número', () => {
      expect(() => validarCambio('pipeline.umbral_verde', 'ochenta'))
        .toThrow(/se esperaba un número/);
    });
  });

  describe('coherencia entre los dos umbrales del pipeline', () => {
    it('acepta aprobación por encima de revisión', () => {
      expect(() => validarCoherenciaUmbrales(85, 60)).not.toThrow();
    });

    it('rechaza que se crucen, porque desaparecería la revisión humana', () => {
      expect(() => validarCoherenciaUmbrales(55, 60)).toThrow(/revisión humana/);
    });

    it('rechaza que sean iguales', () => {
      expect(() => validarCoherenciaUmbrales(70, 70)).toThrow(ValorParametroInvalidoError);
    });
  });

  describe('integridad del catálogo', () => {
    it('no tiene claves repetidas', () => {
      const claves = CATALOGO_PARAMETROS.map((d) => d.clave);
      expect(new Set(claves).size).toBe(claves.length);
    });

    it('todo parámetro normativo cita su norma', () => {
      for (const d of CATALOGO_PARAMETROS.filter((x) => x.naturaleza === NaturalezaParametro.NORMATIVO)) {
        expect(d.norma).toBeTruthy();
      }
    });

    it('todo valor por defecto respeta su propio rango', () => {
      for (const d of CATALOGO_PARAMETROS) {
        if (d.tipo === TipoParametro.BOOLEANO) continue;
        const v = d.valorPorDefecto as number;
        if (d.minimo !== undefined) expect(v).toBeGreaterThanOrEqual(d.minimo);
        if (d.maximo !== undefined) expect(v).toBeLessThanOrEqual(d.maximo);
      }
    });

    it('los umbrales del pipeline por defecto son coherentes entre sí', () => {
      const verde = definicionDe('pipeline.umbral_verde').valorPorDefecto as number;
      const amarillo = definicionDe('pipeline.umbral_amarillo').valorPorDefecto as number;
      expect(() => validarCoherenciaUmbrales(verde, amarillo)).not.toThrow();
    });

    it('cada parámetro explica para qué sirve', () => {
      for (const d of CATALOGO_PARAMETROS) {
        expect(d.descripcion.length).toBeGreaterThan(40);
      }
    });
  });
});
