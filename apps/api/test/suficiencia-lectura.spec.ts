import { camposDe } from '../src/domain/entities/campos-extraccion';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { ResumenLecturaLocal } from '../src/domain/ports/out/lector-documento-local.port';
import { CampoExtraido, ResultadoExtraccion } from '../src/domain/ports/out/servicios-externos.port';
import {
  CONFIANZA_MINIMA_CAMPO, evaluarSuficienciaLectura,
} from '../src/domain/services/suficiencia-lectura';

/** Datos 100 % sintéticos. */
const TIPO = TipoDocumento.CEDULA;

function campo(valor: string | null, confianza = 0.95, fuente?: CampoExtraido['fuente']): CampoExtraido {
  return { valor, confianza, evidencia: null, ...(fuente !== undefined ? { fuente } : {}) };
}

function lecturaCompleta(tipo: TipoDocumento = TIPO, fuente?: CampoExtraido['fuente']): ResultadoExtraccion {
  const campos: Record<string, CampoExtraido> = {};
  for (const c of camposDe(tipo)) campos[c] = campo(`valor-sintetico-${c}`, 0.95, fuente);
  return {
    tipoDetectado: tipo, campos, ilegible: false, modelo: 'prueba', tokensEntrada: 0, tokensSalida: 0, costoUsd: 0,
  };
}

function conOcr(lectura: ResultadoExtraccion, suficiencia: 'insuficiente' | 'debil' | 'procesable'): ResultadoExtraccion {
  const resumen = {
    textoNativo: null,
    ocr: { ejecutado: true, paginas: [1], confianzaMedia: 80, giros: [0], suficiencia },
    qr: { paginasEscaneadas: 0, hallazgos: [] },
    discrepanciasFuentes: [], limitesAplicados: [], errores: [], duracionMs: 1,
  } as ResumenLecturaLocal;
  return { ...lectura, lecturaLocal: resumen };
}

describe('Suficiencia de lectura (IA de rescate · 1.1)', () => {
  it('usa el mismo criterio de confianza que banderasPorConfianza del pipeline (0.7)', () => {
    expect(CONFIANZA_MINIMA_CAMPO).toBe(0.7);
  });

  it('1. lectura completa → suficiente, sin faltantes', () => {
    const r = evaluarSuficienciaLectura(TIPO, lecturaCompleta());
    expect(r).toEqual({ estado: 'suficiente', suficiente: true, faltantes: [] });
  });

  it('2. campo del esquema en null (o ausente, o vacío) → faltante «nulo»', () => {
    const lectura = lecturaCompleta();
    lectura.campos.numero_documento = campo(null);
    delete lectura.campos.nombres;
    lectura.campos.apellidos = campo('   ');
    const r = evaluarSuficienciaLectura(TIPO, lectura);
    expect(r.estado).toBe('insuficiente');
    expect(r.suficiente).toBe(false);
    expect(r.faltantes).toEqual([
      { campo: 'numero_documento', motivo: 'nulo' },
      { campo: 'nombres', motivo: 'nulo' },
      { campo: 'apellidos', motivo: 'nulo' },
    ]);
  });

  it('sin lectura (null) → todos los campos del esquema quedan «nulo»', () => {
    const r = evaluarSuficienciaLectura(TIPO, null);
    expect(r.faltantes.map((f) => f.campo)).toEqual([...camposDe(TIPO)]);
    expect(r.faltantes.every((f) => f.motivo === 'nulo')).toBe(true);
  });

  it('3. confianza inferior al criterio → «confianza_baja»; justo en el criterio no falta', () => {
    const lectura = lecturaCompleta();
    lectura.campos.nombres = campo('sintetico', 0.69);
    lectura.campos.apellidos = campo('sintetico', CONFIANZA_MINIMA_CAMPO);
    lectura.campos.fecha_expedicion = campo('2026-01-01', Number.NaN);
    const r = evaluarSuficienciaLectura(TIPO, lectura);
    expect(r.faltantes).toEqual([
      { campo: 'nombres', motivo: 'confianza_baja' },
      { campo: 'fecha_expedicion', motivo: 'confianza_baja' },
    ]);
  });

  it('4. OCR débil o insuficiente degrada los campos de fuente OCR → «ocr_debil»', () => {
    for (const nivel of ['debil', 'insuficiente'] as const) {
      const lectura = conOcr(lecturaCompleta(TIPO, 'ocr'), nivel);
      lectura.campos.numero_documento = campo('123', 0.9, 'texto_nativo');
      const r = evaluarSuficienciaLectura(TIPO, lectura);
      expect(r.faltantes).toEqual(
        camposDe(TIPO).filter((c) => c !== 'numero_documento').map((c) => ({ campo: c, motivo: 'ocr_debil' })),
      );
    }
  });

  it('OCR procesable o no ejecutado no degrada los campos de fuente OCR', () => {
    expect(evaluarSuficienciaLectura(TIPO, conOcr(lecturaCompleta(TIPO, 'ocr'), 'procesable')).suficiente).toBe(true);
    const sinEjecutar = conOcr(lecturaCompleta(TIPO, 'ocr'), 'debil');
    sinEjecutar.lecturaLocal = { ...sinEjecutar.lecturaLocal!, ocr: { ...sinEjecutar.lecturaLocal!.ocr, ejecutado: false } };
    expect(evaluarSuficienciaLectura(TIPO, sinEjecutar).suficiente).toBe(true);
  });

  it('5. campo leído del QR no se degrada por confianza (ni por OCR débil)', () => {
    const lectura = conOcr(lecturaCompleta(TipoDocumento.CERTIFICADO_EPS, 'qr'), 'debil');
    lectura.campos.documento_afiliado = campo('1000000001', 0.1, 'qr');
    const r = evaluarSuficienciaLectura(TipoDocumento.CERTIFICADO_EPS, lectura);
    expect(r).toEqual({ estado: 'suficiente', suficiente: true, faltantes: [] });
  });

  it('un campo QR sin valor sigue faltando como «nulo»', () => {
    const lectura = lecturaCompleta(TipoDocumento.CERTIFICADO_EPS, 'qr');
    lectura.campos.regimen = campo(null, 0, 'qr');
    expect(evaluarSuficienciaLectura(TipoDocumento.CERTIFICADO_EPS, lectura).faltantes)
      .toEqual([{ campo: 'regimen', motivo: 'nulo' }]);
  });

  it('6. varios faltantes: cada campo una sola vez y con un único motivo', () => {
    const lectura = conOcr(lecturaCompleta(TIPO, 'ocr'), 'debil');
    lectura.campos.numero_documento = campo(null, 0.1, 'ocr');
    lectura.campos.nombres = campo('sintetico', 0.2, 'ocr');
    lectura.campos.campo_fuera_de_esquema = campo(null);
    const r = evaluarSuficienciaLectura(TIPO, lectura);
    const nombres = r.faltantes.map((f) => f.campo);
    expect(new Set(nombres).size).toBe(nombres.length);
    expect(nombres).not.toContain('campo_fuera_de_esquema');
    expect(r.faltantes).toEqual([
      { campo: 'numero_documento', motivo: 'nulo' },
      { campo: 'nombres', motivo: 'confianza_baja' },
      { campo: 'apellidos', motivo: 'ocr_debil' },
      { campo: 'fecha_expedicion', motivo: 'ocr_debil' },
    ]);
  });

  it('7. tipo sin campos → «no_aplica» explícito, nunca suficiente', () => {
    expect(camposDe(TipoDocumento.INFORME_FINAL)).toHaveLength(0);
    for (const lectura of [null, lecturaCompleta(TipoDocumento.INFORME_FINAL)]) {
      expect(evaluarSuficienciaLectura(TipoDocumento.INFORME_FINAL, lectura))
        .toEqual({ estado: 'no_aplica', suficiente: false, faltantes: [] });
    }
  });
});
