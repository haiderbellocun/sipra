import { camposDe } from '../entities/campos-extraccion';
import { TipoDocumento } from '../entities/documento.entity';
import { CampoExtraido, ResultadoExtraccion } from '../ports/out/servicios-externos.port';
import { normalizarTexto } from './normalizacion-identidad';
import { MotivoFaltante, evaluarSuficienciaLectura } from './suficiencia-lectura';
import { MotivoValorInvalido, validarValorRescatado } from './validacion-valores-rescatados';

/**
 * Fusión campo por campo de una lectura base (local o del extractor configurado) con una lectura de IA de
 * rescate (subfase 1.2, dominio puro).
 *
 * REGLA DE ORO: la IA solo LLENA campos vacíos. Un valor existente nunca se sustituye: si la IA trae otro
 * valor, se conserva el existente y se registra una discrepancia para revisión humana. Precedencia:
 *
 *   [fuente oficial verificada — aún no representada en `CampoExtraido`; iría por encima de todo]
 *   > qr > texto_nativo > OCR confiable (o lectura base confiable) > ia_rescate validada > OCR débil
 *
 * Como nunca se reemplaza un valor, «ia_rescate > OCR débil» no se traduce en sobrescritura: un OCR débil que
 * la IA contradice queda en discrepancia (no se elige en silencio), y uno que la IA repite queda corroborado
 * sin cambiar su fuente ni su confianza.
 *
 * La confianza que declare la IA se guarda como metadato del campo rescatado; no interviene en la precedencia.
 * La fuente que la IA dijera tener (p. ej. «qr») se ignora: todo lo que aporta es `ia_rescate`.
 *
 * Tipo de salida propio (`CampoFusionado`): `CampoExtraido.fuente` no se amplía todavía porque fluye a la
 * comparación EPS y a sus fuentes persistidas; se decidirá al integrar el pipeline (subfase 1.5).
 */

/** Fuente final de un campo. `lectura_base`: valor de un extractor que no declara fuente (p. ej. el configurado). */
export type FuenteFinal = 'qr' | 'texto_nativo' | 'ocr' | 'lectura_base' | 'ia_rescate' | 'sin_valor';

export interface CampoFusionado {
  valor: string | null;
  /** En `ia_rescate` es la confianza que declaró el modelo: metadato, no autoridad. */
  confianza: number;
  evidencia: string | null;
  fuente: FuenteFinal;
}

/** Lo que aporta la IA de rescate por campo. Cualquier otra propiedad (incluida una «fuente») se ignora. */
export interface CampoRescatado {
  valor: string | null;
  confianza?: number;
  evidencia?: string | null;
}

export type CodigoDiscrepancia =
  /** La IA trae otro valor para un campo leído con una fuente de mayor autoridad. */
  | 'IA_CONTRADICE_LECTURA_CONFIABLE'
  /** La IA trae otro valor para un campo leído de forma débil (OCR débil, confianza baja o valor mal formado). */
  | 'IA_DIFIERE_DE_LECTURA_DEBIL';

/** Solo nombres y códigos: ni el valor local ni el de la IA. */
export interface DiscrepanciaFusion {
  campo: string;
  codigo: CodigoDiscrepancia;
  fuenteConservada: FuenteFinal;
  /** Por qué la lectura base era débil (solo en `IA_DIFIERE_DE_LECTURA_DEBIL`). */
  debilidadLocal: MotivoFaltante | 'valor_mal_formado' | null;
}

export interface DescarteIa {
  campo: string;
  motivo: MotivoValorInvalido;
}

export interface ResultadoFusion {
  /** Todos los campos del esquema, más los campos de la lectura base que estén fuera de él (sin tocar). */
  campos: Record<string, CampoFusionado>;
  fuentesFinales: Record<string, FuenteFinal>;
  discrepancias: DiscrepanciaFusion[];
  /** Campos vacíos que llenó la IA con un valor válido. */
  camposRescatados: string[];
  /** Campos débiles cuyo valor la IA repitió (comparación normalizada). No cambia su fuente ni su confianza. */
  camposCorroborados: string[];
  /** Valores de la IA descartados por la validación determinística (solo campo y código). */
  descartes: DescarteIa[];
  /** Cuántos campos trajo la IA fuera de `camposDe(tipo)`; se ignoran sin registrar sus nombres. */
  camposFueraDeEsquemaIgnorados: number;
  /** Hay al menos una discrepancia: una persona debe decidir. */
  requiereRevisionHumana: boolean;
}

type CalidadLocal =
  | { tipo: 'vacio' }
  | { tipo: 'confiable' }
  | { tipo: 'debil'; motivo: MotivoFaltante | 'valor_mal_formado' };

function fuenteDe(campo: CampoExtraido | undefined): FuenteFinal {
  if (!campo || campo.valor === null || campo.valor.trim() === '') return 'sin_valor';
  return campo.fuente ?? 'lectura_base';
}

function aFusionado(campo: CampoExtraido | undefined): CampoFusionado {
  const fuente = fuenteDe(campo);
  if (!campo || fuente === 'sin_valor') {
    return { valor: null, confianza: campo?.confianza ?? 0, evidencia: campo?.evidencia ?? null, fuente: 'sin_valor' };
  }
  return { valor: campo.valor, confianza: campo.confianza, evidencia: campo.evidencia, fuente };
}

function confianzaComoMetadato(valor: number | undefined): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return 0;
  return Math.min(1, Math.max(0, valor));
}

export function fusionarLecturas(
  tipo: TipoDocumento,
  base: ResultadoExtraccion | null,
  rescate: Readonly<Record<string, CampoRescatado | null | undefined>> | null,
): ResultadoFusion {
  const esquema = [...new Set(camposDe(tipo))];
  const enEsquema = new Set(esquema);
  const camposBase = base?.campos ?? {};
  const aportes = rescate ?? {};

  // La debilidad de la lectura base sale del mismo criterio que decide pedir el rescate.
  const debilidad = new Map(evaluarSuficienciaLectura(tipo, base).faltantes.map((f) => [f.campo, f.motivo]));

  const campos: Record<string, CampoFusionado> = {};
  const discrepancias: DiscrepanciaFusion[] = [];
  const camposRescatados: string[] = [];
  const camposCorroborados: string[] = [];
  const descartes: DescarteIa[] = [];

  // Los campos de la lectura base fuera del esquema se conservan tal cual: la fusión no borra datos.
  for (const [nombre, campo] of Object.entries(camposBase)) {
    if (!enEsquema.has(nombre)) campos[nombre] = aFusionado(campo);
  }

  for (const nombre of esquema) {
    const local = camposBase[nombre];
    const actual = aFusionado(local);
    campos[nombre] = actual;

    const aporte = aportes[nombre];
    if (!aporte || aporte.valor === null || aporte.valor === undefined) continue; // IA sin dato: no cambia nada.

    const candidato = validarValorRescatado(tipo, nombre, aporte.valor);
    if (!candidato.valido || candidato.valorNormalizado === null) {
      descartes.push({ campo: nombre, motivo: candidato.motivo ?? 'valor_ausente' });
      continue;
    }

    const calidad = calidadLocal(tipo, nombre, local, actual, debilidad.get(nombre));
    if (calidad.tipo === 'vacio') {
      campos[nombre] = {
        valor: candidato.valorNormalizado,
        confianza: confianzaComoMetadato(aporte.confianza),
        evidencia: aporte.evidencia ?? null,
        fuente: 'ia_rescate',
      };
      camposRescatados.push(nombre);
      continue;
    }

    if (mismoValor(tipo, nombre, actual.valor as string, candidato.valorNormalizado)) {
      if (calidad.tipo === 'debil') camposCorroborados.push(nombre);
      continue;
    }

    discrepancias.push(
      calidad.tipo === 'confiable'
        ? { campo: nombre, codigo: 'IA_CONTRADICE_LECTURA_CONFIABLE', fuenteConservada: actual.fuente, debilidadLocal: null }
        : { campo: nombre, codigo: 'IA_DIFIERE_DE_LECTURA_DEBIL', fuenteConservada: actual.fuente, debilidadLocal: calidad.motivo },
    );
  }

  const fuentesFinales: Record<string, FuenteFinal> = {};
  for (const [nombre, campo] of Object.entries(campos)) fuentesFinales[nombre] = campo.fuente;

  return {
    campos,
    fuentesFinales,
    discrepancias,
    camposRescatados,
    camposCorroborados,
    descartes,
    camposFueraDeEsquemaIgnorados: Object.keys(aportes).filter((k) => !enEsquema.has(k)).length,
    requiereRevisionHumana: discrepancias.length > 0,
  };
}

function calidadLocal(
  tipo: TipoDocumento,
  nombre: string,
  local: CampoExtraido | undefined,
  actual: CampoFusionado,
  motivoSuficiencia: MotivoFaltante | undefined,
): CalidadLocal {
  if (actual.fuente === 'sin_valor' || motivoSuficiencia === 'nulo') return { tipo: 'vacio' };
  // QR y texto nativo con valor están por encima de la IA siempre, declaren la confianza que declaren.
  if (actual.fuente === 'qr' || actual.fuente === 'texto_nativo') return { tipo: 'confiable' };
  if (motivoSuficiencia) return { tipo: 'debil', motivo: motivoSuficiencia };
  // Un valor local que no pasa la misma validación que se exige a la IA tampoco es confiable.
  if (!validarValorRescatado(tipo, nombre, local?.valor).valido) return { tipo: 'debil', motivo: 'valor_mal_formado' };
  return { tipo: 'confiable' };
}

/**
 * Comparación normalizada (solo para decidir si hay discrepancia; los valores guardados no se tocan): el valor
 * local pasa por la misma normalización que el candidato y, como texto, se ignoran mayúsculas, tildes y espacios.
 */
function mismoValor(tipo: TipoDocumento, nombre: string, local: string, candidatoNormalizado: string): boolean {
  const localNormalizado = validarValorRescatado(tipo, nombre, local).valorNormalizado ?? local;
  return normalizarTexto(localNormalizado) === normalizarTexto(candidatoNormalizado);
}
