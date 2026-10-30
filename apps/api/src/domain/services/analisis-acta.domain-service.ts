import {
  CamposActaLeidos, ClasificacionActa, DatosSipraActa, ComparacionActa, FirmasActa, FuenteLecturaActa,
} from '../entities/acta-iniciacion';
import { compararActaConSipra } from './comparacion-acta.domain-service';
import { clasificarActa } from './clasificacion-acta.domain-service';
import { extraerConDiagnostico } from './extraccion-acta.domain-service';
import { MedicionesFirmas, evaluarFirmasActa } from './firmas-acta.domain-service';

/**
 * Texto del documento → clasificación → extracción → firmas → comparación contra SIPRA.
 * Fachada de dominio puro: no lee archivos ni toca la base; recibe el texto ya leído.
 * No decide: entrega el resultado para que una persona lo revise.
 */
export interface AnalisisActa {
  clasificacion: ClasificacionActa;
  campos: CamposActaLeidos;
  firmas: FirmasActa;
  comparacion: ComparacionActa | null;
  /** Letra a mano o foto/escaneo dudoso: lo leído por OCR no se usa para decidir coincidencias críticas. */
  lecturaDudosa: boolean;
}

/** Por debajo de esta confianza media del OCR, o con este número de datos descartados por ruido, la lectura es dudosa. */
export const CONFIANZA_OCR_DUDOSA = 0.88;
export const RUIDO_MINIMO_LECTURA_DUDOSA = 3;

export function analizarActa(
  texto: string,
  fuente: FuenteLecturaActa,
  sipra: DatosSipraActa | null,
  mediciones: MedicionesFirmas | null = null,
  confianzaOcr?: number,
): AnalisisActa {
  const clasificacion = clasificarActa(texto);
  const { campos, descartadosPorRuido } = extraerConDiagnostico(texto, fuente, confianzaOcr);
  const lecturaDudosa = fuente === 'ocr'
    && ((confianzaOcr !== undefined && confianzaOcr < CONFIANZA_OCR_DUDOSA) || descartadosPorRuido >= RUIDO_MINIMO_LECTURA_DUDOSA);
  const firmas = evaluarFirmasActa(texto, mediciones, lecturaDudosa);
  return {
    clasificacion, campos, firmas, lecturaDudosa,
    comparacion: sipra ? compararActaConSipra({ clasificacion, campos, lecturaDudosa }, sipra) : null,
  };
}
