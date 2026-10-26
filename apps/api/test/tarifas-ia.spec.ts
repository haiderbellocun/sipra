import {
  ESFUERZOS_RAZONAMIENTO, MODELO_OPENAI_PREDETERMINADO, TARIFAS_IA, TARIFA_RESPALDO, TarifaModelo,
  costoDe, esfuerzoEfectivo, tarifaDe, tokensImagen,
} from '../src/domain/entities/tarifas-ia';

/**
 * La tabla de tarifas es la fuente de verdad del costo de cada lectura y de
 * los parámetros que admite cada modelo. Estas pruebas fijan tres cosas que
 * una revisión adversaria encontró frágiles: qué esfuerzo se envía de verdad,
 * qué identificadores resuelven tarifa (y cuáles no) y cuántos tokens cobra
 * una página según la regla publicada por el proveedor.
 */

function tarifa(id: string): TarifaModelo {
  const resuelta = tarifaDe(id);
  if (!resuelta) throw new Error(`Sin tarifa para ${id}`);
  return resuelta.tarifa;
}

describe('Tarifas de IA · esfuerzo efectivo', () => {
  it('un esfuerzo admitido viaja tal cual, sin degradar', () => {
    expect(esfuerzoEfectivo(tarifa('gpt-6-luna'), 'low')).toEqual({ efectivo: 'low', degradado: false });
    expect(esfuerzoEfectivo(tarifa('gpt-6-luna'), 'none')).toEqual({ efectivo: 'none', degradado: false });
    expect(esfuerzoEfectivo(tarifa('gpt-6-luna'), 'max')).toEqual({ efectivo: 'max', degradado: false });
  });

  it('minimal no existe en gpt-6-luna: sube a low', () => {
    expect(esfuerzoEfectivo(tarifa('gpt-6-luna'), 'minimal')).toEqual({ efectivo: 'low', degradado: true });
  });

  it('none no existe en gpt-6-astra: sube a low (saltando minimal, que tampoco)', () => {
    expect(esfuerzoEfectivo(tarifa('gpt-6-astra'), 'none')).toEqual({ efectivo: 'low', degradado: true });
    expect(esfuerzoEfectivo(tarifa('gpt-6-astra'), 'minimal')).toEqual({ efectivo: 'low', degradado: true });
  });

  it('none no existe en gpt-5-mini: sube a minimal, el vecino inmediato', () => {
    expect(esfuerzoEfectivo(tarifa('gpt-5-mini'), 'none')).toEqual({ efectivo: 'minimal', degradado: true });
  });

  it('por encima del máximo del modelo baja al mayor admitido', () => {
    expect(esfuerzoEfectivo(tarifa('gpt-5-mini'), 'xhigh')).toEqual({ efectivo: 'high', degradado: true });
    expect(esfuerzoEfectivo(tarifa('gpt-5.4'), 'max')).toEqual({ efectivo: 'xhigh', degradado: true });
  });

  it('un modelo sin razonamiento no lleva esfuerzo, se pida lo que se pida', () => {
    expect(esfuerzoEfectivo(tarifa('gpt-4.1-mini'), 'low')).toEqual({ efectivo: null, degradado: false });
    expect(esfuerzoEfectivo(tarifa('gpt-4.1-mini'), 'none')).toEqual({ efectivo: null, degradado: false });
    expect(esfuerzoEfectivo(tarifa('gpt-4o'), 'high')).toEqual({ efectivo: null, degradado: false });
  });

  it('la tarifa de respaldo degrada none a low: no asume que el modelo desconocido lo admita', () => {
    expect(esfuerzoEfectivo(TARIFA_RESPALDO, 'none')).toEqual({ efectivo: 'low', degradado: true });
    expect(esfuerzoEfectivo(TARIFA_RESPALDO, 'medium')).toEqual({ efectivo: 'medium', degradado: false });
  });

  it('un valor que no es un esfuerzo termina en uno que el modelo sí admite', () => {
    const luna = tarifa('gpt-6-luna');
    const { efectivo, degradado } = esfuerzoEfectivo(luna, 'ultra');
    expect(degradado).toBe(true);
    expect(efectivo).not.toBeNull();
    expect(luna.esfuerzos).toContain(efectivo);
  });

  it('el orden de esfuerzos de la API va de none a max', () => {
    expect(ESFUERZOS_RAZONAMIENTO).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  });
});

describe('Tarifas de IA · esfuerzos y reglas de imagen por modelo', () => {
  it('cada modelo razonador declara esfuerzos válidos y ninguno sin razonamiento los declara', () => {
    const validos = new Set<string>(ESFUERZOS_RAZONAMIENTO);
    for (const t of TARIFAS_IA) {
      expect(t.esfuerzos.length > 0).toBe(t.razonador);
      for (const e of t.esfuerzos) expect(validos.has(e)).toBe(true);
    }
  });

  it('gpt-6-luna y gpt-5.6 no admiten minimal pero sí none', () => {
    for (const id of ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']) {
      expect(tarifa(id).esfuerzos).not.toContain('minimal');
      expect(tarifa(id).esfuerzos).toContain('none');
      expect(tarifa(id).esfuerzos).toContain('max');
    }
  });

  it('gpt-6-astra y los Sol no admiten none ni minimal', () => {
    for (const id of ['gpt-6-astra', 'gpt-6-sol', 'gpt-6.1-sol']) {
      expect(tarifa(id).esfuerzos).not.toContain('none');
      expect(tarifa(id).esfuerzos).not.toContain('minimal');
      expect(tarifa(id).esfuerzos[0]).toBe('low');
    }
  });

  it('GPT-5 admite minimal pero no none; GPT-5.4 al revés y sin max', () => {
    expect(tarifa('gpt-5-mini').esfuerzos).toEqual(['minimal', 'low', 'medium', 'high']);
    expect(tarifa('gpt-5.4').esfuerzos).toEqual(['none', 'low', 'medium', 'high', 'xhigh']);
  });

  it('los modelos sin razonamiento no tienen esfuerzos', () => {
    for (const id of ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini']) {
      expect(tarifa(id).razonador).toBe(false);
      expect(tarifa(id).esfuerzos).toEqual([]);
    }
  });

  it('las reglas de imagen no publicadas por el proveedor quedan marcadas', () => {
    const publicada = (id: string): boolean | undefined => {
      const regla = tarifa(id).imagen;
      return regla.tipo === 'parches' ? regla.publicada : undefined;
    };
    for (const id of ['gpt-5-mini', 'gpt-5-nano', 'gpt-4.1-nano', 'gpt-6-luna']) expect(publicada(id)).toBe(false);
    for (const id of ['gpt-6-astra', 'gpt-5.6-luna', 'gpt-4.1-mini', 'gpt-5.2']) expect(publicada(id)).toBe(true);
  });

  it('los identificadores son únicos y el predeterminado está en la tabla', () => {
    const ids = TARIFAS_IA.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(MODELO_OPENAI_PREDETERMINADO);
    expect(tarifa(MODELO_OPENAI_PREDETERMINADO).recomendacion).toBe('principal');
  });
});

describe('Tarifas de IA · resolución estricta del identificador', () => {
  it('solo el prefijo seguido de una fecha de snapshot o de latest resuelve', () => {
    expect(tarifaDe('gpt-6-luna-2026-09-22')).toMatchObject({ exacta: false });
    expect(tarifaDe('gpt-6-luna-2026-09-22')!.tarifa.id).toBe('gpt-6-luna');
    expect(tarifaDe('gpt-6-luna-latest')!.tarifa.id).toBe('gpt-6-luna');
    expect(tarifaDe('gpt-5-2026-08-07')!.tarifa.id).toBe('gpt-5');
    expect(tarifaDe('gpt-5.1-2026-11-13')!.tarifa.id).toBe('gpt-5.1');
  });

  it('una variante con tarifa propia (pro, codex, chat) no hereda la del modelo base', () => {
    expect(tarifaDe('gpt-5.5-pro')).toBeNull();
    expect(tarifaDe('gpt-5.1-codex')).toBeNull();
    expect(tarifaDe('gpt-6-luna-chat')).toBeNull();
  });

  it('gpt-5.10 no es gpt-5.1 ni gpt-5', () => {
    expect(tarifaDe('gpt-5.10')).toBeNull();
    expect(tarifaDe('gpt-5.10-2026-01-01')).toBeNull();
  });

  it('una fecha incompleta o con otro formato no resuelve', () => {
    expect(tarifaDe('gpt-6-luna-2026-09')).toBeNull();
    expect(tarifaDe('gpt-6-luna-20260922')).toBeNull();
    expect(tarifaDe('gpt-6-luna-preview')).toBeNull();
  });

  it('ignora mayúsculas y espacios alrededor', () => {
    expect(tarifaDe('  GPT-6-Luna ')).toMatchObject({ exacta: true });
    expect(tarifaDe('')).toBeNull();
  });
});

describe('Tarifas de IA · tarifa de respaldo', () => {
  it('es deliberadamente más cara que cualquier modelo recomendable', () => {
    expect(TARIFA_RESPALDO.id).toBe('desconocido');
    expect(TARIFA_RESPALDO.razonador).toBe(true);
    expect(TARIFA_RESPALDO.esfuerzos).toEqual(['low', 'medium', 'high']);
    const recomendables = TARIFAS_IA.filter(
      (m) => m.proveedor === 'openai' && (m.recomendacion === 'principal' || m.recomendacion === 'alternativa'),
    );
    expect(recomendables.length).toBeGreaterThan(0);
    for (const t of recomendables) {
      expect(TARIFA_RESPALDO.entradaUsdPorMillon).toBeGreaterThan(t.entradaUsdPorMillon);
      expect(TARIFA_RESPALDO.salidaUsdPorMillon).toBeGreaterThan(t.salidaUsdPorMillon);
    }
  });

  it('valora una lectura típica a 2 / 0,2 / 10 USD por millón', () => {
    // 8 000 × 2 + 2 000 × 0,2 + 500 × 10 = 21 400 → 0,0214 USD.
    expect(costoDe(TARIFA_RESPALDO, { entrada: 10_000, salida: 500, cache: 2_000 })).toBeCloseTo(0.0214, 6);
  });
});

describe('Tarifas de IA · tokens por imagen con reducción proporcional', () => {
  it('una página carta a 200 ppp supera el tope de 2 500 parches y se reduce (gpt-6-luna)', () => {
    expect(tokensImagen(tarifa('gpt-6-luna'), 1700, 2200)).toBe(2890);
  });

  it('gpt-6-astra: cuadrados bajo y sobre el tope, y una apaisada que no se reduce', () => {
    const astra = tarifa('gpt-6-astra');
    expect(tokensImagen(astra, 1024, 1024)).toBe(1229);
    expect(tokensImagen(astra, 2048, 2048)).toBe(3000);
    // 66 × 32 = 2 112 parches, bajo el tope: 2 112 × 1,2 = 2 534,4 → 2 535.
    expect(tokensImagen(astra, 2100, 1000)).toBe(2535);
  });

  it('mosaicos de gpt-4.1: una página carta y una foto vertical cuestan lo mismo (2 × 2 mosaicos)', () => {
    expect(tokensImagen(tarifa('gpt-4.1'), 1700, 2200)).toBe(765);
    expect(tokensImagen(tarifa('gpt-4.1'), 800, 1067)).toBe(765);
  });

  it('gpt-4o-mini cobra una página completa a más de 25 000 tokens', () => {
    expect(tokensImagen(tarifa('gpt-4o-mini'), 1700, 2200)).toBe(25501);
  });

  it('gpt-5-mini, con tope de 6 144, no reduce la página carta: 3 200 parches × 1,2', () => {
    expect(tokensImagen(tarifa('gpt-5-mini'), 1700, 2200)).toBe(3840);
  });

  it('una foto de 12 Mpx apaisada se reduce primero a 2 048 y luego al tope de parches', () => {
    expect(tokensImagen(tarifa('gpt-6-luna'), 4032, 3024)).toBe(2942);
  });

  it('el resultado nunca supera tope × multiplicador ni baja de un parche', () => {
    const luna = tarifa('gpt-6-luna');
    expect(tokensImagen(luna, 20_000, 20_000)).toBeLessThanOrEqual(Math.ceil(2500 * 1.2));
    expect(tokensImagen(luna, 1, 1)).toBe(Math.ceil(1 * 1.2));
    expect(tokensImagen(luna, 0, -5)).toBe(Math.ceil(1 * 1.2));
  });
});
