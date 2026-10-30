import {
  CamposActaLeidos, ClasificacionActa, DatosSipraActa, ComparacionActa, FirmasActa, FuenteLecturaActa,
} from '../entities/acta-iniciacion';
import { compararActaConSipra } from './comparacion-acta.domain-service';
import { clasificarActa } from './clasificacion-acta.domain-service';
import { extraerCamposActa } from './extraccion-acta.domain-service';
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
}

export function analizarActa(
  texto: string,
  fuente: FuenteLecturaActa,
  sipra: DatosSipraActa | null,
  mediciones: MedicionesFirmas | null = null,
  confianzaOcr?: number,
): AnalisisActa {
  const clasificacion = clasificarActa(texto);
  const campos = extraerCamposActa(texto, fuente, confianzaOcr);
  const firmas = evaluarFirmasActa(texto, mediciones);
  return {
    clasificacion, campos, firmas,
    comparacion: sipra ? compararActaConSipra({ clasificacion, campos }, sipra) : null,
  };
}
