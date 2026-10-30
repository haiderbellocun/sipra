import { UMBRALES_FIRMA, evaluarFirmasActa, MedicionZonaFirma } from '../src/domain/services/firmas-acta.domain-service';
import { actaSintetica } from './soporte-acta';

const CON_TRAZO: MedicionZonaFirma = { legible: true, densidadTinta: 0.03, alturaRelativaTrazo: 0.5 };
const EN_BLANCO: MedicionZonaFirma = { legible: true, densidadTinta: 0, alturaRelativaTrazo: 0 };
const SOLO_LINEA: MedicionZonaFirma = { legible: true, densidadTinta: 0.006, alturaRelativaTrazo: 0.02 };

describe('Acta de iniciación · presencia probable de firmas', () => {
  const texto = actaSintetica();

  it('15 · trazo en la zona de la empresa → firma de la empresa probable', () => {
    const f = evaluarFirmasActa(texto, { empresa: CON_TRAZO, practicante: EN_BLANCO });
    expect(f.firmaEmpresaPresente).toBe('si');
    expect(f.firmaPracticantePresente).toBe('no_determinable');
  });

  it('16 · trazo en la zona del practicante → firma del practicante probable', () => {
    const f = evaluarFirmasActa(texto, { empresa: EN_BLANCO, practicante: CON_TRAZO });
    expect(f.firmaEmpresaPresente).toBe('no_determinable');
    expect(f.firmaPracticantePresente).toBe('si');
  });

  it('ambas firmas probables', () => {
    const f = evaluarFirmasActa(texto, { empresa: CON_TRAZO, practicante: CON_TRAZO });
    expect([f.firmaEmpresaPresente, f.firmaPracticantePresente]).toEqual(['si', 'si']);
  });

  describe('17 · no determinable', () => {
    it('sin mediciones (nadie rasterizó las zonas)', () => {
      const f = evaluarFirmasActa(texto, null);
      expect([f.firmaEmpresaPresente, f.firmaPracticantePresente]).toEqual(['no_determinable', 'no_determinable']);
      expect(f.motivos).toEqual(['empresa_zona_sin_medir', 'practicante_zona_sin_medir']);
    });

    it('zona ilegible', () => {
      const f = evaluarFirmasActa(texto, { empresa: { ...CON_TRAZO, legible: false }, practicante: CON_TRAZO });
      expect(f.firmaEmpresaPresente).toBe('no_determinable');
      expect(f.firmaPracticantePresente).toBe('si');
    });

    it('una línea recta o una marca ambigua no es una firma probable ni una ausencia segura', () => {
      const f = evaluarFirmasActa(texto, { empresa: SOLO_LINEA, practicante: { legible: true, densidadTinta: 0.05, alturaRelativaTrazo: 0.05 } });
      expect(f.firmaEmpresaPresente).toBe('no_determinable');
      expect(f.firmaPracticantePresente).toBe('no_determinable');
    });

    it('si los rótulos de firma no están en lo que se leyó (página recortada) no se afirma nada', () => {
      const f = evaluarFirmasActa(actaSintetica({ sinRotulosFirma: true }), { empresa: CON_TRAZO, practicante: CON_TRAZO });
      expect(f.firmaEmpresaPresente).toBe('no_determinable');
      expect(f.firmaPracticantePresente).toBe('no_determinable');
      expect(f.motivos).toContain('empresa_rotulo_no_localizado');
    });
  });

  it('los umbrales son consistentes (hay una franja ambigua entre «sin tinta» y «con tinta»)', () => {
    expect(UMBRALES_FIRMA.densidadSinTinta).toBeLessThan(UMBRALES_FIRMA.densidadConTinta);
  });

  it('el resultado solo habla de presencia: no hay campos de autenticidad ni de identidad', () => {
    const f = evaluarFirmasActa(texto, { empresa: CON_TRAZO, practicante: CON_TRAZO });
    expect(Object.keys(f).sort()).toEqual(['firmaEmpresaPresente', 'firmaPracticantePresente', 'motivos']);
  });
});
