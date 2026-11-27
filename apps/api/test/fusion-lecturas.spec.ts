import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { CampoExtraido, ResultadoExtraccion } from '../src/domain/ports/out/servicios-externos.port';
import { CampoRescatado, fusionarLecturas } from '../src/domain/services/fusion-lecturas';

/** Datos 100 % sintéticos. */
const CEDULA = TipoDocumento.CEDULA; // numero_documento, nombres, apellidos, fecha_expedicion
const EPS = TipoDocumento.CERTIFICADO_EPS;

function campo(valor: string | null, confianza = 0.95, fuente?: CampoExtraido['fuente']): CampoExtraido {
  return { valor, confianza, evidencia: null, ...(fuente !== undefined ? { fuente } : {}) };
}

function lectura(campos: Record<string, CampoExtraido>, ocr?: 'insuficiente' | 'debil' | 'procesable'): ResultadoExtraccion {
  const base: ResultadoExtraccion = {
    tipoDetectado: null, campos, ilegible: false, modelo: 'prueba', tokensEntrada: 0, tokensSalida: 0, costoUsd: 0,
  };
  if (!ocr) return base;
  return {
    ...base,
    lecturaLocal: {
      textoNativo: null,
      ocr: { ejecutado: true, paginas: [1], confianzaMedia: 80, giros: [0], suficiencia: ocr },
      qr: { paginasEscaneadas: 0, hallazgos: [] },
      discrepanciasFuentes: [], limitesAplicados: [], errores: [], duracionMs: 1,
    },
  };
}

const ia = (valor: string | null, confianza = 0.9): CampoRescatado => ({ valor, confianza, evidencia: 'zona superior' });

describe('Fusión de lecturas (IA de rescate · 1.2)', () => {
  it('1. local null + IA válida → la IA llena el campo con fuente ia_rescate y valor normalizado', () => {
    const r = fusionarLecturas(CEDULA, lectura({ fecha_expedicion: campo(null, 0, 'ocr') }), {
      fecha_expedicion: ia('05/03/2026', 0.42),
    });
    expect(r.campos.fecha_expedicion).toEqual({ valor: '2026-03-05', confianza: 0.42, evidencia: 'zona superior', fuente: 'ia_rescate' });
    expect(r.fuentesFinales.fecha_expedicion).toBe('ia_rescate');
    expect(r.camposRescatados).toEqual(['fecha_expedicion']);
    expect(r.discrepancias).toEqual([]);
    expect(r.requiereRevisionHumana).toBe(false);
  });

  it('campo ausente en la lectura base o lectura base null → también se llena', () => {
    expect(fusionarLecturas(CEDULA, lectura({}), { nombres: ia('Ana') }).campos.nombres.fuente).toBe('ia_rescate');
    expect(fusionarLecturas(CEDULA, null, { nombres: ia('Ana') }).camposRescatados).toEqual(['nombres']);
  });

  it('2. QR + IA diferente → gana QR (aun con confianza baja declarada) y se registra discrepancia', () => {
    const r = fusionarLecturas(EPS, lectura({ documento_afiliado: campo('1000000001', 0.1, 'qr') }), {
      documento_afiliado: ia('1000000009', 0.99),
    });
    expect(r.campos.documento_afiliado).toMatchObject({ valor: '1000000001', fuente: 'qr', confianza: 0.1 });
    expect(r.discrepancias).toEqual([
      { campo: 'documento_afiliado', codigo: 'IA_CONTRADICE_LECTURA_CONFIABLE', fuenteConservada: 'qr', debilidadLocal: null },
    ]);
    expect(r.requiereRevisionHumana).toBe(true);
  });

  it('3. texto_nativo + IA diferente → gana local + discrepancia', () => {
    const r = fusionarLecturas(CEDULA, lectura({ nombres: campo('Ana María', 0.95, 'texto_nativo') }), { nombres: ia('Ana Lucía') });
    expect(r.campos.nombres).toMatchObject({ valor: 'Ana María', fuente: 'texto_nativo' });
    expect(r.discrepancias.map((d) => [d.campo, d.codigo])).toEqual([['nombres', 'IA_CONTRADICE_LECTURA_CONFIABLE']]);
  });

  it('texto_nativo con confianza baja tampoco se reemplaza: sigue por encima de la IA', () => {
    const r = fusionarLecturas(CEDULA, lectura({ nombres: campo('Ana María', 0.3, 'texto_nativo') }), { nombres: ia('Ana Lucía', 1) });
    expect(r.campos.nombres).toMatchObject({ valor: 'Ana María', fuente: 'texto_nativo', confianza: 0.3 });
    expect(r.discrepancias[0].codigo).toBe('IA_CONTRADICE_LECTURA_CONFIABLE');
  });

  it('4. OCR confiable + IA diferente → no se sobrescribe; discrepancia', () => {
    const r = fusionarLecturas(CEDULA, lectura({ apellidos: campo('Rojas Díaz', 0.9, 'ocr') }, 'procesable'), {
      apellidos: ia('Rojas Ruiz', 1),
    });
    expect(r.campos.apellidos).toMatchObject({ valor: 'Rojas Díaz', fuente: 'ocr', confianza: 0.9 });
    expect(r.discrepancias).toEqual([
      { campo: 'apellidos', codigo: 'IA_CONTRADICE_LECTURA_CONFIABLE', fuenteConservada: 'ocr', debilidadLocal: null },
    ]);
  });

  describe('5. OCR débil + IA válida (comportamiento explícito)', () => {
    it('IA diferente → no se elige en silencio: se conserva el OCR, discrepancia con el motivo de la debilidad', () => {
      const r = fusionarLecturas(CEDULA, lectura({ apellidos: campo('Roj4s', 0.9, 'ocr') }, 'debil'), { apellidos: ia('Rojas') });
      expect(r.campos.apellidos).toMatchObject({ valor: 'Roj4s', fuente: 'ocr', confianza: 0.9 });
      expect(r.camposRescatados).toEqual([]);
      expect(r.discrepancias).toEqual([
        { campo: 'apellidos', codigo: 'IA_DIFIERE_DE_LECTURA_DEBIL', fuenteConservada: 'ocr', debilidadLocal: 'ocr_debil' },
      ]);
      expect(r.requiereRevisionHumana).toBe(true);
    });

    it('confianza baja local + IA diferente → discrepancia con debilidad confianza_baja', () => {
      const r = fusionarLecturas(CEDULA, lectura({ nombres: campo('Anna', 0.4, 'ocr') }), { nombres: ia('Ana') });
      expect(r.discrepancias[0]).toMatchObject({ codigo: 'IA_DIFIERE_DE_LECTURA_DEBIL', debilidadLocal: 'confianza_baja' });
    });

    it('valor local mal formado + IA válida distinta → discrepancia con debilidad valor_mal_formado', () => {
      const r = fusionarLecturas(CEDULA, lectura({ fecha_expedicion: campo('31/04/2026', 0.9, 'ocr') }, 'procesable'), {
        fecha_expedicion: ia('2026-04-30'),
      });
      expect(r.campos.fecha_expedicion.valor).toBe('31/04/2026');
      expect(r.discrepancias[0]).toMatchObject({ codigo: 'IA_DIFIERE_DE_LECTURA_DEBIL', debilidadLocal: 'valor_mal_formado' });
    });

    it('IA igual al OCR débil → corroborado, sin discrepancia, sin cambiar fuente ni confianza', () => {
      const r = fusionarLecturas(CEDULA, lectura({ apellidos: campo('ROJAS', 0.5, 'ocr') }, 'debil'), { apellidos: ia('Rojas', 1) });
      expect(r.campos.apellidos).toEqual({ valor: 'ROJAS', confianza: 0.5, evidencia: null, fuente: 'ocr' });
      expect(r.camposCorroborados).toEqual(['apellidos']);
      expect(r.discrepancias).toEqual([]);
    });
  });

  it('6. IA inválida → descartada (solo campo y código), se conserva lo local', () => {
    const r = fusionarLecturas(CEDULA, lectura({ fecha_expedicion: campo(null, 0), numero_documento: campo('1032456786', 0.4, 'ocr') }), {
      fecha_expedicion: ia('2026-02-30'),
      numero_documento: ia('10324A6786'),
    });
    expect(r.campos.fecha_expedicion.fuente).toBe('sin_valor');
    expect(r.campos.numero_documento).toMatchObject({ valor: '1032456786', fuente: 'ocr' });
    expect(r.descartes).toEqual([
      { campo: 'numero_documento', motivo: 'documento_formato_invalido' },
      { campo: 'fecha_expedicion', motivo: 'fecha_invalida' },
    ]);
    expect(r.camposRescatados).toEqual([]);
    expect(r.discrepancias).toEqual([]);
  });

  it('7. campos de la IA fuera del esquema → ignorados (no se crean) y solo se cuentan', () => {
    const r = fusionarLecturas(CEDULA, lectura({}), { nit: ia('901458772'), diagnostico_medico: ia('dato sensible') });
    expect(r.campos).not.toHaveProperty('nit');
    expect(r.campos).not.toHaveProperty('diagnostico_medico');
    expect(r.camposFueraDeEsquemaIgnorados).toBe(2);
    expect(JSON.stringify(r)).not.toContain('diagnostico_medico');
  });

  it('8. varios campos → cada uno conserva su fuente correcta', () => {
    const r = fusionarLecturas(CEDULA, lectura({
      numero_documento: campo('1032456786', 0.95, 'texto_nativo'),
      nombres: campo('Ana', 0.9, 'ocr'),
      apellidos: campo(null, 0, 'ocr'),
      fecha_expedicion: campo('2026-03-05', 0.9),
    }, 'procesable'), {
      apellidos: ia('Rojas'),
      nombres: ia('Ana'),
    });
    expect(r.fuentesFinales).toEqual({
      numero_documento: 'texto_nativo',
      nombres: 'ocr',
      apellidos: 'ia_rescate',
      fecha_expedicion: 'lectura_base',
    });
    expect(r.camposRescatados).toEqual(['apellidos']);
  });

  it('9. IA null o sin el campo → no modifica el campo local', () => {
    const base = lectura({ nombres: campo('Ana', 0.4, 'ocr'), apellidos: campo(null, 0, 'ocr') });
    for (const rescate of [null, {}, { nombres: ia(null), apellidos: null }, { nombres: undefined }]) {
      const r = fusionarLecturas(CEDULA, base, rescate);
      expect(r.campos.nombres).toMatchObject({ valor: 'Ana', fuente: 'ocr', confianza: 0.4 });
      expect(r.campos.apellidos.fuente).toBe('sin_valor');
      expect(r.camposRescatados).toEqual([]);
      expect(r.discrepancias).toEqual([]);
      expect(r.descartes).toEqual([]);
    }
  });

  it('10. mismo valor local e IA (con otro formato) → sin discrepancia innecesaria', () => {
    const r = fusionarLecturas(CEDULA, lectura({
      numero_documento: campo('1.032.456.786', 0.95, 'texto_nativo'),
      nombres: campo('José', 0.95, 'texto_nativo'),
      fecha_expedicion: campo('05/03/2026', 0.95, 'texto_nativo'),
    }), {
      numero_documento: ia('1032456786'),
      nombres: ia('JOSE'),
      fecha_expedicion: ia('2026-03-05'),
    });
    expect(r.discrepancias).toEqual([]);
    expect(r.camposCorroborados).toEqual([]);
    expect(r.campos.numero_documento.valor).toBe('1.032.456.786');
  });

  it('la IA no puede declarar otra fuente: lo que aporta siempre es ia_rescate', () => {
    const conFuenteFalsa = { valor: 'Ana', confianza: 1, evidencia: null, fuente: 'qr' } as CampoRescatado;
    expect(fusionarLecturas(CEDULA, lectura({}), { nombres: conFuenteFalsa }).campos.nombres.fuente).toBe('ia_rescate');
  });

  it('la confianza declarada por la IA es metadato acotado a [0, 1]', () => {
    const r = fusionarLecturas(CEDULA, lectura({}), {
      nombres: { valor: 'Ana', confianza: 7 }, apellidos: { valor: 'Rojas', confianza: Number.NaN },
    });
    expect(r.campos.nombres.confianza).toBe(1);
    expect(r.campos.apellidos.confianza).toBe(0);
    expect(r.campos.nombres.evidencia).toBeNull();
  });

  it('las discrepancias no contienen valores (ni el local ni el de la IA)', () => {
    const r = fusionarLecturas(CEDULA, lectura({ numero_documento: campo('1032456786', 0.95, 'texto_nativo') }), {
      numero_documento: ia('1099999999'),
    });
    const texto = JSON.stringify(r.discrepancias);
    expect(texto).not.toContain('1032456786');
    expect(texto).not.toContain('1099999999');
  });

  it('los campos de la lectura base fuera del esquema se conservan sin tocar', () => {
    const r = fusionarLecturas(CEDULA, lectura({ extra_local: campo('x', 0.8, 'ocr') }), {});
    expect(r.campos.extra_local).toEqual({ valor: 'x', confianza: 0.8, evidencia: null, fuente: 'ocr' });
    expect(r.fuentesFinales.extra_local).toBe('ocr');
  });

  it('tipo sin campos → nada que fusionar', () => {
    const r = fusionarLecturas(TipoDocumento.INFORME_FINAL, null, { nombres: ia('Ana') });
    expect(r.campos).toEqual({});
    expect(r.camposFueraDeEsquemaIgnorados).toBe(1);
  });
});
