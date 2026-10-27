import { ComparacionTripleCampo, EstadoAdres, RecomendacionEps } from '../entities/adres';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DatosValidacionEps,
} from '../entities/validacion-eps.entity';
import { recomendarEps } from './adres-resultado.domain-service';

/**
 * Reglas de la Mesa operativa de EPS. Todas son determinísticas y explicables;
 * no hay IA ni puntajes opacos. La Mesa MUESTRA lo que ya decidieron los casos de
 * uso de las fases anteriores; aquí solo se ordena, se explica y se exige
 * justificación cuando la persona se aparta de la recomendación.
 */

// ── Prioridad operativa ─────────────────────────────────────────────────────

/** Pesos de la prioridad. Cambiarlos exige cambiar también la expresión SQL de «tomar siguiente» (hay una prueba que las compara). */
export const PESOS_PRIORIDAD = {
  /** Un punto por cada día completo desde que llegó, hasta este tope. */
  antiguedadMaxDias: 30,
  /** La práctica empieza dentro de este número de días (o ya empezó). */
  inicioPracticaDias: 15,
  inicioPractica: 20,
  /** El estudiante volvió a cargar el certificado (versión 2 o posterior). */
  reenvio: 10,
  /** Hay una discrepancia crítica que una persona debe revisar. */
  discrepanciaCritica: 10,
  /** La afiliación aún está por contrastar con ADRES. */
  adresPendiente: 5,
} as const;

/** Estados ADRES en los que todavía hay trabajo por hacer. */
export const ESTADOS_ADRES_ABIERTOS: readonly EstadoAdres[] = [
  EstadoAdres.PENDIENTE, EstadoAdres.EN_CONSULTA, EstadoAdres.EVIDENCIA_RECIBIDA, EstadoAdres.ERROR, EstadoAdres.NO_DETERMINABLE,
];

export interface EntradaPrioridad {
  recibidaEn: Date;
  fechaInicioPractica: Date | null;
  version: number;
  discrepanciaCritica: boolean;
  adresPendiente: boolean;
}

export interface Prioridad {
  puntaje: number;
  /** Cada razón con sus puntos, para mostrarlas tal cual. */
  razones: string[];
}

const MS_DIA = 86_400_000;

export function calcularPrioridad(e: EntradaPrioridad, ahora: Date): Prioridad {
  const razones: string[] = [];
  let puntaje = 0;
  const dias = Math.max(0, Math.floor((ahora.getTime() - e.recibidaEn.getTime()) / MS_DIA));
  const antiguedad = Math.min(PESOS_PRIORIDAD.antiguedadMaxDias, dias);
  if (antiguedad > 0) { puntaje += antiguedad; razones.push(`Antigüedad: ${dias} ${dias === 1 ? 'día' : 'días'} (+${antiguedad})`); }
  if (e.fechaInicioPractica && e.fechaInicioPractica.getTime() <= ahora.getTime() + PESOS_PRIORIDAD.inicioPracticaDias * MS_DIA) {
    puntaje += PESOS_PRIORIDAD.inicioPractica;
    razones.push(`La práctica inicia pronto o ya inició (+${PESOS_PRIORIDAD.inicioPractica})`);
  }
  if (e.version > 1) { puntaje += PESOS_PRIORIDAD.reenvio; razones.push(`El estudiante volvió a cargar el certificado (+${PESOS_PRIORIDAD.reenvio})`); }
  if (e.discrepanciaCritica) { puntaje += PESOS_PRIORIDAD.discrepanciaCritica; razones.push(`Tiene una discrepancia crítica (+${PESOS_PRIORIDAD.discrepanciaCritica})`); }
  if (e.adresPendiente) { puntaje += PESOS_PRIORIDAD.adresPendiente; razones.push(`Falta contrastar la afiliación con ADRES (+${PESOS_PRIORIDAD.adresPendiente})`); }
  return { puntaje, razones };
}

// ── Discrepancias legibles ──────────────────────────────────────────────────

export interface DiscrepanciaLegible {
  severidad: 'critica' | 'informativa';
  campo: string;
  titulo: string;
  explicacion: string;
}

const NOMBRE_CAMPO: Record<ComparacionTripleCampo['campo'], string> = {
  numero_documento: 'el número de documento', tipo_documento: 'el tipo de documento', nombre: 'el nombre',
  eps: 'la EPS', regimen: 'el régimen', estado: 'el estado de la afiliación',
};

const FUENTE: Record<'sipra' | 'certificado' | 'adres', string> = { sipra: 'SIPRA', certificado: 'el certificado', adres: 'ADRES' };

function textoPar(par: ComparacionTripleCampo['conflictos'][number], campo: ComparacionTripleCampo['campo']): string {
  const [a, b] = par.split('_vs_') as Array<'sipra' | 'certificado' | 'adres'>;
  return `${FUENTE[a][0].toUpperCase()}${FUENTE[a].slice(1)} y ${FUENTE[b]} no coinciden en ${NOMBRE_CAMPO[campo]}.`;
}

/**
 * Convierte la validación y la comparación triple en una lista que una persona
 * entiende, separando lo CRÍTICO de lo informativo. Cada texto explica qué pasa y
 * qué fuentes chocan; no hay códigos técnicos sueltos.
 */
export function construirDiscrepancias(d: DatosValidacionEps, triple: readonly ComparacionTripleCampo[]): DiscrepanciaLegible[] {
  const salida: DiscrepanciaLegible[] = [];
  for (const fila of triple) {
    for (const par of fila.conflictos) {
      const critico = fila.critico || (par === 'sipra_vs_certificado' && ['numero_documento', 'nombre'].includes(fila.campo));
      salida.push({
        severidad: critico ? 'critica' : 'informativa', campo: fila.campo,
        titulo: `Diferencia en ${NOMBRE_CAMPO[fila.campo]}`, explicacion: textoPar(par, fila.campo),
      });
    }
  }
  if (d.afiliacion === AfiliacionEps.INACTIVA) {
    salida.push({
      severidad: 'critica', campo: 'afiliacion', titulo: 'Afiliación no vigente',
      explicacion: d.afiliacionFuente === 'adres_bdua'
        ? 'ADRES indica que la afiliación del estudiante no está vigente.' : 'La fuente consultada indica que la afiliación no está vigente.',
    });
  }
  if (d.autenticidad === AutenticidadEps.INVALIDA) {
    salida.push({
      severidad: 'critica', campo: 'autenticidad', titulo: 'Certificado no auténtico',
      explicacion: 'La fuente oficial no confirma el certificado o contradice su contenido.',
    });
  }
  if (d.hayBanderaCritica) {
    salida.push({
      severidad: 'critica', campo: 'documento', titulo: 'Alerta crítica del documento',
      explicacion: 'El análisis del archivo dejó una alerta crítica que debe revisarse en el documento.',
    });
  }
  if (d.vigenciaCertificado === 'vencido') {
    salida.push({
      severidad: 'informativa', campo: 'fecha_expedicion', titulo: 'Certificado vencido',
      explicacion: 'La fecha de expedición del certificado supera la vigencia institucional.',
    });
  }
  for (const x of d.discrepancias) {
    if (x.resultado === 'fuentes_distintas') {
      salida.push({
        severidad: 'informativa', campo: x.campo, titulo: 'Lecturas distintas del mismo documento',
        explicacion: 'El texto digital y el OCR leyeron valores diferentes en este campo; se dejó sin valor para que una persona lo revise.',
      });
    } else if (x.comparacion === 'oficial_vs_certificado') {
      const critico = ['numero_documento', 'nombre', 'eps', 'fecha_expedicion'].includes(x.campo);
      salida.push({
        severidad: critico ? 'critica' : 'informativa', campo: x.campo, titulo: 'El verificador oficial contradice el certificado',
        explicacion: 'La fuente oficial muestra un valor distinto al del certificado en este dato.',
      });
    }
  }
  return salida;
}

// ── Recomendación vigente ───────────────────────────────────────────────────

/** Recomendación a mostrar HOY (se recalcula con los ejes actuales; no es una decisión). */
export function recomendacionActual(d: DatosValidacionEps, hayDiscrepanciaCritica: boolean): RecomendacionEps {
  const adresAbierto = ESTADOS_ADRES_ABIERTOS.includes(d.adres.estado);
  if (d.afiliacion === AfiliacionEps.NO_CONTRASTADA && adresAbierto && !hayDiscrepanciaCritica && d.autenticidad !== AutenticidadEps.INVALIDA) {
    return RecomendacionEps.PENDIENTE_ADRES;
  }
  return recomendarEps({
    afiliacion: d.afiliacion, autenticidad: d.autenticidad, coincidenciaCertificado: d.coincidencia,
    vigencia: d.vigenciaCertificado, hayBanderaCritica: d.hayBanderaCritica, hayDiscrepanciaCritica,
  });
}

// ── Decisión: justificación reforzada ───────────────────────────────────────

export const JUSTIFICACION_MINIMA = 10;
export const JUSTIFICACION_REFORZADA = 40;

export function evaluarApartamiento(
  decision: 'aprobar' | 'devolver' | 'rechazar', recomendacion: RecomendacionEps,
): { apartaDeRecomendacion: boolean; minimoJustificacion: number; motivo: string | null } {
  const negativa = recomendacion === RecomendacionEps.DISCREPANCIA_CRITICA || recomendacion === RecomendacionEps.REVISION_RECHAZO;
  if (decision === 'aprobar' && negativa) {
    return { apartaDeRecomendacion: true, minimoJustificacion: JUSTIFICACION_REFORZADA, motivo: 'Aprueba aunque el sistema recomienda revisar o rechazar' };
  }
  if (decision === 'rechazar' && recomendacion === RecomendacionEps.CANDIDATO_AUTOAPROBACION) {
    return { apartaDeRecomendacion: true, minimoJustificacion: JUSTIFICACION_REFORZADA, motivo: 'Rechaza un caso que cumple todos los criterios' };
  }
  return { apartaDeRecomendacion: false, minimoJustificacion: JUSTIFICACION_MINIMA, motivo: null };
}

// ── Motivos de devolución ───────────────────────────────────────────────────

export enum MotivoDevolucionEps {
  ILEGIBLE = 'documento_ilegible',
  VENCIDO = 'certificado_vencido',
  DATOS_NO_COINCIDEN = 'datos_no_coinciden',
  INCORRECTO = 'certificado_incorrecto',
  FALTA_INFORMACION = 'falta_informacion',
  OTRO = 'otro',
}

/** Lo que lee el estudiante: dice qué corregir. */
export const MENSAJES_DEVOLUCION_EPS: Readonly<Record<MotivoDevolucionEps, string>> = {
  [MotivoDevolucionEps.ILEGIBLE]: 'No pudimos leer su certificado de EPS. Cárguelo de nuevo con buena luz, completo y enfocado, o descargue el PDF original de su EPS.',
  [MotivoDevolucionEps.VENCIDO]: 'Su certificado de EPS está vencido. Descargue uno nuevo, expedido recientemente, y cárguelo otra vez.',
  [MotivoDevolucionEps.DATOS_NO_COINCIDEN]: 'Los datos de su certificado de EPS no coinciden con los de su registro (nombre o documento). Verifique que sea su propio certificado y cárguelo de nuevo.',
  [MotivoDevolucionEps.INCORRECTO]: 'El documento cargado no es un certificado de afiliación a EPS. Cargue el certificado de afiliación correspondiente.',
  [MotivoDevolucionEps.FALTA_INFORMACION]: 'A su certificado de EPS le falta información necesaria (por ejemplo, la entidad, el estado de la afiliación o la fecha de expedición). Cargue uno completo.',
  [MotivoDevolucionEps.OTRO]: 'Su certificado de EPS necesita una corrección.',
};

export function mensajeDevolucion(motivo: MotivoDevolucionEps, detalle: string | null): string {
  const base = MENSAJES_DEVOLUCION_EPS[motivo];
  const extra = detalle?.trim();
  return extra ? `${base} ${extra}` : base;
}

// ── Frescura de la consulta ADRES (sin política definida todavía) ───────────

export interface FrescuraAdres {
  /** Hay un plazo institucional configurado. Mientras no lo haya, NADA se marca como vencido. */
  politicaDefinida: boolean;
  dias: number | null;
  vencida: boolean | null;
}

export function evaluarFrescuraAdres(consultadoEn: Date | null, dias: number | null | undefined, ahora: Date): FrescuraAdres {
  if (dias === null || dias === undefined || !Number.isFinite(dias) || dias <= 0) return { politicaDefinida: false, dias: null, vencida: null };
  if (!consultadoEn) return { politicaDefinida: true, dias, vencida: null };
  return { politicaDefinida: true, dias, vencida: ahora.getTime() - consultadoEn.getTime() > dias * MS_DIA };
}

/**
 * ¿Hay una discrepancia crítica según lo PERSISTIDO en la validación? Es la
 * definición que usa la prioridad (y su expresión SQL de «tomar siguiente»): solo
 * mira campos guardados, para que ambas den siempre lo mismo.
 */
export function tieneDiscrepanciaCriticaPersistida(d: DatosValidacionEps): boolean {
  return d.coincidencia === CoincidenciaEps.DISCREPANCIA || d.autenticidad === AutenticidadEps.INVALIDA || d.afiliacion === AfiliacionEps.INACTIVA
    || d.hayBanderaCritica || d.adres.comparacion.some((c) => c.critico);
}
