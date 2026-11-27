import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { permiteAutoAprobacionDelPipeline } from '../src/domain/services/politica-procesamiento';
import {
  INTERRUPTORES_RESCATE_POR_DEFECTO, InterruptoresRescateIa, decidirRescateIa,
} from '../src/domain/services/politica-rescate-ia';
import { SuficienciaLectura } from '../src/domain/services/suficiencia-lectura';

const SENSIBLES = [
  TipoDocumento.CERTIFICADO_EPS, TipoDocumento.ACTA_INICIO, TipoDocumento.RUT_NATURAL,
  TipoDocumento.RUT_JURIDICO, TipoDocumento.CAMARA_COMERCIO,
] as const;

const FLAG_DE: Record<(typeof SENSIBLES)[number], keyof InterruptoresRescateIa> = {
  [TipoDocumento.CERTIFICADO_EPS]: 'eps',
  [TipoDocumento.ACTA_INICIO]: 'acta',
  [TipoDocumento.RUT_NATURAL]: 'rut',
  [TipoDocumento.RUT_JURIDICO]: 'rut',
  [TipoDocumento.CAMARA_COMERCIO]: 'camara',
};

const TODO_ENCENDIDO: InterruptoresRescateIa = { habilitado: true, eps: true, rut: true, camara: true, acta: true };
const SOLO_GLOBAL: InterruptoresRescateIa = { ...INTERRUPTORES_RESCATE_POR_DEFECTO, habilitado: true };

const INSUFICIENTE: SuficienciaLectura = {
  estado: 'insuficiente',
  suficiente: false,
  faltantes: [{ campo: 'nombres', motivo: 'nulo' }, { campo: 'fecha_expedicion', motivo: 'confianza_baja' }],
};
const SUFICIENTE: SuficienciaLectura = { estado: 'suficiente', suficiente: true, faltantes: [] };
const NO_APLICA: SuficienciaLectura = { estado: 'no_aplica', suficiente: false, faltantes: [] };

describe('Política de IA de rescate (1.1)', () => {
  it('los interruptores nacen todos apagados', () => {
    expect(Object.values(INTERRUPTORES_RESCATE_POR_DEFECTO).every((v) => v === false)).toBe(true);
    expect(Object.isFrozen(INTERRUPTORES_RESCATE_POR_DEFECTO)).toBe(true);
  });

  it('1. global apagado → nunca hay rescate, aunque los flags por tipo estén encendidos', () => {
    const apagado = { ...TODO_ENCENDIDO, habilitado: false };
    for (const tipo of Object.values(TipoDocumento)) {
      for (const interruptores of [INTERRUPTORES_RESCATE_POR_DEFECTO, apagado, {}]) {
        expect(decidirRescateIa(tipo, interruptores, INSUFICIENTE))
          .toEqual({ permitido: false, motivo: 'rescate_deshabilitado', camposSolicitados: [] });
      }
    }
  });

  it('solo `true` estricto enciende un interruptor (fallo cerrado)', () => {
    const raro = { habilitado: 'true', eps: 1 } as unknown as InterruptoresRescateIa;
    expect(decidirRescateIa(TipoDocumento.CEDULA, raro, INSUFICIENTE).permitido).toBe(false);
    const globalSi = { habilitado: true, eps: 'true' } as unknown as InterruptoresRescateIa;
    expect(decidirRescateIa(TipoDocumento.CERTIFICADO_EPS, globalSi, INSUFICIENTE).motivo)
      .toBe('tipo_sensible_no_autorizado');
  });

  it('2. global encendido + flag del tipo sensible apagado → bloqueado', () => {
    for (const tipo of SENSIBLES) {
      expect(decidirRescateIa(tipo, SOLO_GLOBAL, INSUFICIENTE))
        .toEqual({ permitido: false, motivo: 'tipo_sensible_no_autorizado', camposSolicitados: [] });
      // Encender el flag de OTRO tipo sensible no lo desbloquea.
      const otros = { ...TODO_ENCENDIDO, [FLAG_DE[tipo]]: false };
      expect(decidirRescateIa(tipo, otros, INSUFICIENTE).permitido).toBe(false);
    }
  });

  it('3. global y flag sensible encendidos + faltantes → permitido', () => {
    for (const tipo of SENSIBLES) {
      const interruptores = { ...SOLO_GLOBAL, [FLAG_DE[tipo]]: true };
      expect(decidirRescateIa(tipo, interruptores, INSUFICIENTE))
        .toEqual({ permitido: true, motivo: 'permitido', camposSolicitados: ['nombres', 'fecha_expedicion'] });
    }
  });

  it('tipo no sensible con global encendido + faltantes → permitido sin flag específico', () => {
    expect(decidirRescateIa(TipoDocumento.CARTA_ACEPTACION, SOLO_GLOBAL, INSUFICIENTE).permitido).toBe(true);
  });

  it('4. lectura suficiente → no se invoca rescate', () => {
    for (const tipo of [TipoDocumento.CEDULA, ...SENSIBLES]) {
      expect(decidirRescateIa(tipo, TODO_ENCENDIDO, SUFICIENTE))
        .toEqual({ permitido: false, motivo: 'lectura_suficiente', camposSolicitados: [] });
    }
  });

  it('tipo sin campos («no_aplica») → no se invoca rescate', () => {
    expect(decidirRescateIa(TipoDocumento.INFORME_FINAL, TODO_ENCENDIDO, NO_APLICA))
      .toEqual({ permitido: false, motivo: 'tipo_sin_campos', camposSolicitados: [] });
  });

  it('5. camposSolicitados contiene únicamente los faltantes, sin repetir', () => {
    const repetidos: SuficienciaLectura = {
      estado: 'insuficiente',
      suficiente: false,
      faltantes: [
        { campo: 'nit', motivo: 'nulo' }, { campo: 'nit', motivo: 'ocr_debil' }, { campo: 'razon_social', motivo: 'ocr_debil' },
      ],
    };
    expect(decidirRescateIa(TipoDocumento.CONVENIO_PRACTICA, SOLO_GLOBAL, repetidos).camposSolicitados)
      .toEqual(['nit', 'razon_social']);
  });

  it('6. ningún rescate cambia la política de autoaprobación', () => {
    const antes = Object.values(TipoDocumento).map((t) => permiteAutoAprobacionDelPipeline(t));
    for (const tipo of Object.values(TipoDocumento)) {
      const decision = decidirRescateIa(tipo, TODO_ENCENDIDO, INSUFICIENTE);
      expect(Object.keys(decision).sort()).toEqual(['camposSolicitados', 'motivo', 'permitido']);
    }
    expect(Object.values(TipoDocumento).map((t) => permiteAutoAprobacionDelPipeline(t))).toEqual(antes);
  });

  it('7. los cinco tipos sensibles siguen sin autoaprobación del pipeline, aun con rescate permitido', () => {
    for (const tipo of SENSIBLES) {
      expect(decidirRescateIa(tipo, TODO_ENCENDIDO, INSUFICIENTE).permitido).toBe(true);
      expect(permiteAutoAprobacionDelPipeline(tipo)).toBe(false);
    }
  });
});
