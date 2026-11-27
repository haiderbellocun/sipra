import { CAMPOS_POR_TIPO } from '../src/domain/entities/campos-extraccion';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { Nit } from '../src/domain/value-objects/nit.vo';
import {
  claseDeCampo, validarValorRescatado,
} from '../src/domain/services/validacion-valores-rescatados';

/** Datos 100 % sintéticos. 901458772 → DV 2 (ejemplo del propio `Nit`). */
const RUT = TipoDocumento.RUT_JURIDICO;
const CEDULA = TipoDocumento.CEDULA;

describe('Validación determinística de valores rescatados (1.2)', () => {
  it('el ejemplo de NIT sintético es coherente con el algoritmo DIAN', () => {
    expect(Nit.calcularDigitoVerificacion('901458772')).toBe(2);
  });

  describe('texto', () => {
    it('rechaza vacío, solo espacios, null, undefined y relleno de formulario', () => {
      expect(validarValorRescatado(RUT, 'razon_social', '')).toEqual({ valido: false, valorNormalizado: null, motivo: 'valor_vacio' });
      expect(validarValorRescatado(RUT, 'razon_social', '   \t\n ').motivo).toBe('valor_vacio');
      expect(validarValorRescatado(RUT, 'razon_social', null).motivo).toBe('valor_ausente');
      expect(validarValorRescatado(RUT, 'razon_social', undefined).motivo).toBe('valor_ausente');
      expect(validarValorRescatado(RUT, 'razon_social', '_____').motivo).toBe('valor_de_relleno');
      expect(validarValorRescatado(RUT, 'razon_social', '- - .').motivo).toBe('valor_de_relleno');
    });

    it('normaliza sin alterar semántica: solo recorta y colapsa espacios (conserva mayúsculas y tildes)', () => {
      expect(validarValorRescatado(RUT, 'razon_social', '  Comercializadora   Ñandú  S.A.S. '))
        .toEqual({ valido: true, valorNormalizado: 'Comercializadora Ñandú S.A.S.', motivo: null });
    });
  });

  describe('campo desconocido', () => {
    it('un campo fuera de camposDe(tipo) es inválido aunque el valor sea bueno', () => {
      expect(validarValorRescatado(CEDULA, 'nit', '901458772').motivo).toBe('campo_fuera_de_esquema');
      expect(validarValorRescatado(CEDULA, 'campo_inventado', 'x').motivo).toBe('campo_fuera_de_esquema');
      expect(validarValorRescatado(TipoDocumento.INFORME_FINAL, 'nombres', 'x').motivo).toBe('campo_fuera_de_esquema');
    });
  });

  describe('fechas (fechaIsoDe)', () => {
    it('fecha válida en varios formatos → AAAA-MM-DD', () => {
      for (const entrada of ['2026-03-05', '05/03/2026', '5-3-2026', '5 de marzo de 2026', ' 2026-3-5 ']) {
        expect(validarValorRescatado(CEDULA, 'fecha_expedicion', entrada))
          .toEqual({ valido: true, valorNormalizado: '2026-03-05', motivo: null });
      }
    });

    it('fecha inexistente o ininteligible → fecha_invalida', () => {
      for (const entrada of ['2026-02-30', '31/04/2026', '2026-13-01', 'ayer', '2026/03', '20260305']) {
        expect(validarValorRescatado(CEDULA, 'fecha_expedicion', entrada).motivo).toBe('fecha_invalida');
      }
    });

    it('todo campo del catálogo que empieza por «fecha_» se valida como fecha', () => {
      const todos = new Set(Object.values(CAMPOS_POR_TIPO).flat());
      for (const campo of todos) if (campo?.startsWith('fecha_')) expect(claseDeCampo(campo)).toBe('fecha');
    });
  });

  describe('NIT (Nit / controlarNitLeido)', () => {
    it('NIT válido: con separadores, o con DV correcto (que se verifica y se quita: el campo es sin DV)', () => {
      expect(validarValorRescatado(RUT, 'nit', '901458772').valorNormalizado).toBe('901458772');
      expect(validarValorRescatado(RUT, 'nit', '901.458.772').valorNormalizado).toBe('901458772');
      expect(validarValorRescatado(RUT, 'nit', '901.458.772-2'))
        .toEqual({ valido: true, valorNormalizado: '901458772', motivo: null });
      expect(validarValorRescatado(RUT, 'nit', '901458772 - 2').valorNormalizado).toBe('901458772');
    });

    it('DV que no corresponde → nit_dv_no_coincide (nunca se corrige)', () => {
      expect(validarValorRescatado(RUT, 'nit', '901458772-3'))
        .toEqual({ valido: false, valorNormalizado: null, motivo: 'nit_dv_no_coincide' });
    });

    it('DV del contexto se contrasta con el NIT', () => {
      expect(validarValorRescatado(RUT, 'nit', '901458772', { digitoVerificacionNit: 2 }).valido).toBe(true);
      expect(validarValorRescatado(RUT, 'nit', '901458772', { digitoVerificacionNit: '7' }).motivo).toBe('nit_dv_no_coincide');
      expect(validarValorRescatado(RUT, 'nit', '901458772', { digitoVerificacionNit: null }).valido).toBe(true);
    });

    it('formato inválido → nit_formato_invalido', () => {
      for (const entrada of ['90145877A', '12345', '1234567890123456', 'NIT', '9014-58772']) {
        expect(validarValorRescatado(RUT, 'nit', entrada).motivo).toBe('nit_formato_invalido');
      }
    });
  });

  describe('documento de identidad (normalizarDocumento)', () => {
    it('acepta separadores y prefijo declarado; devuelve solo el número', () => {
      expect(validarValorRescatado(CEDULA, 'numero_documento', '1.032.456.786').valorNormalizado).toBe('1032456786');
      expect(validarValorRescatado(CEDULA, 'numero_documento', 'C.C. 1032456786').valorNormalizado).toBe('1032456786');
      expect(validarValorRescatado(TipoDocumento.CERTIFICADO_EPS, 'documento_afiliado', '1 000 000 001'))
        .toEqual({ valido: true, valorNormalizado: '1000000001', motivo: null });
    });

    it('formato inválido → documento_formato_invalido (sin consultar ninguna fuente)', () => {
      for (const entrada of ['123', '10324567A6', 'ABC', '1032-456-786', '12345678901234567']) {
        expect(validarValorRescatado(CEDULA, 'numero_documento', entrada).motivo).toBe('documento_formato_invalido');
      }
    });
  });

  it('nunca devuelve el valor en el motivo', () => {
    const r = validarValorRescatado(CEDULA, 'numero_documento', 'SECRETO-123');
    expect(r.valido).toBe(false);
    expect(JSON.stringify(r)).not.toContain('SECRETO');
  });
});
