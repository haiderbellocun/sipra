import { ComparacionTripleCampo, EstadoAdres, RecomendacionEps } from '../entities/adres';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DatosValidacionEps, EstadoProcesamientoEps,
} from '../entities/validacion-eps.entity';
import { recomendarEps } from './adres-resultado.domain-service';
import { diasDesdeExpedicion } from './comparacion-eps.domain-service';

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

/** Lo que la Mesa sabe del momento y de la política para explicar el caso con cifras. */
export interface ContextoMesa {
  ahora: Date;
  /** Vigencia institucional del certificado (`arl.dias_vigencia_eps`); `null` si no se pudo leer. */
  diasVigencia: number | null;
  /** El análisis del archivo marcó que no es un certificado de afiliación a EPS. */
  tipoIncorrecto?: boolean;
}

export type CampoClaveFaltante = 'numero_documento' | 'nombre' | 'fecha_expedicion';

/**
 * Datos sin los cuales no se puede decir si el certificado es de la persona ni si está vigente.
 * Solo se evalúa con el certificado ya procesado: antes de eso no se sabe qué se leyó.
 * Un dato ausente NUNCA equivale a «coincide»: es información insuficiente.
 */
/** La clasificación documental local concluyó que el archivo NO es un certificado de afiliación EPS (se leyó y es de otro tipo). */
export function esDocumentoIncorrecto(d: Pick<DatosValidacionEps, 'datosExtraidos'>): boolean {
  return d.datosExtraidos?.tipoDocumentoDetectado === 'documento_incorrecto';
}

export function camposClaveFaltantes(d: DatosValidacionEps): CampoClaveFaltante[] {
  if (d.estadoProcesamiento !== EstadoProcesamientoEps.PROCESADO) return [];
  const x = d.datosExtraidos;
  const faltan: CampoClaveFaltante[] = [];
  if (!x?.numeroDocumento) faltan.push('numero_documento');
  if (!x?.nombre) faltan.push('nombre');
  if (!x?.fechaExpedicion) faltan.push('fecha_expedicion');
  return faltan;
}

const EXPLICACION_FALTANTE: Record<CampoClaveFaltante, { titulo: string; explicacion: string }> = {
  numero_documento: {
    titulo: 'Información insuficiente: número de documento',
    explicacion: 'No se pudo leer el número de documento del certificado, así que no es posible confirmar que pertenece al estudiante. No se da por coincidente.',
  },
  nombre: {
    titulo: 'Información insuficiente: nombre del afiliado',
    explicacion: 'No se pudo leer el nombre del afiliado en el certificado, así que no se puede compararlo con el del estudiante. No se da por coincidente.',
  },
  fecha_expedicion: {
    titulo: 'Información insuficiente: fecha de expedición',
    explicacion: 'No se pudo leer la fecha de expedición (generación) del certificado, así que no se puede evaluar su vigencia.',
  },
};

const fechaLegible = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Detalle del vencimiento: fecha de expedición, antigüedad y regla institucional. */
export function explicacionVencido(fechaExpedicion: string | null, ctx?: ContextoMesa): string {
  const base = 'La fecha de expedición del certificado supera la vigencia institucional.';
  if (!ctx || !fechaExpedicion) return base;
  const dias = diasDesdeExpedicion(fechaExpedicion, ctx.ahora);
  if (dias === null) return base;
  const regla = ctx.diasVigencia !== null
    ? ` La regla institucional exige un certificado de no más de ${ctx.diasVigencia} días, contados desde la expedición (no desde el ingreso a la EPS).`
    : '';
  return `Expedido el ${fechaLegible(fechaExpedicion)}, hace ${dias} ${dias === 1 ? 'día' : 'días'}.${regla} Es un dato para su decisión: no se rechaza automáticamente.`;
}

/** Resultado del certificado frente a SIPRA en un campo de identidad. Un valor ausente es «insuficiente», nunca «coincide». */
export function veredictoCertificadoVsSipra(fila: ComparacionTripleCampo): 'coincide' | 'diferente' | 'insuficiente' | null {
  if (!['numero_documento', 'tipo_documento', 'nombre'].includes(fila.campo)) return null;
  if (fila.sipra === null || fila.certificado === null) return 'insuficiente';
  return fila.conflictos.includes('sipra_vs_certificado') ? 'diferente' : 'coincide';
}

export interface DiscrepanciaLegible {
  severidad: 'critica' | 'informativa' | 'insuficiente';
  campo: string;
  titulo: string;
  explicacion: string;
  /** Causa lógica (p. ej. `diferencia`, `afiliacion_inactiva`, `campo_faltante`): junto con campo, fuentes y severidad identifica la discrepancia. */
  codigo: string;
  /** Fuentes enfrentadas, en orden alfabético (`['adres', 'sipra']`); vacío si la discrepancia no enfrenta fuentes. */
  fuentes: string[];
}

/**
 * Clave DETERMINÍSTICA de una discrepancia: campo + causa + fuentes implicadas (sin importar el orden del par) + severidad.
 * No usa el texto visible: dos redacciones de la misma discrepancia son una sola, y el mismo texto con otras fuentes son dos.
 */
export function claveDiscrepancia(x: Pick<DiscrepanciaLegible, 'campo' | 'codigo' | 'fuentes' | 'severidad'>): string {
  return [x.campo, x.codigo, [...x.fuentes].sort().join('+'), x.severidad].join('|');
}

/** Cada discrepancia lógica una sola vez (se conserva la primera, que es la de mayor prioridad al construir la lista). */
export function deduplicarDiscrepancias(lista: readonly DiscrepanciaLegible[]): DiscrepanciaLegible[] {
  const vistas = new Set<string>();
  const salida: DiscrepanciaLegible[] = [];
  for (const x of lista) {
    const k = claveDiscrepancia(x);
    if (vistas.has(k)) continue;
    vistas.add(k);
    salida.push(x);
  }
  return salida;
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
export function construirDiscrepancias(
  d: DatosValidacionEps, triple: readonly ComparacionTripleCampo[], ctx?: ContextoMesa,
): DiscrepanciaLegible[] {
  // Documento de otro tipo: el problema es DOCUMENTAL y es uno solo; comparar sus datos con el estudiante o listar campos
  // «faltantes» sería ruido (no es un certificado de EPS al que le falten datos).
  if (esDocumentoIncorrecto(d)) {
    return [{
      severidad: 'critica', campo: 'documento', titulo: 'Documento incorrecto', codigo: 'tipo_documental_incorrecto', fuentes: [],
      explicacion: 'El archivo no parece un certificado de afiliación EPS: se detectaron indicadores de otro tipo de certificación.',
    }];
  }
  const salida: DiscrepanciaLegible[] = [];
  for (const fila of triple) {
    for (const par of fila.conflictos) {
      const critico = fila.critico || (par === 'sipra_vs_certificado' && ['numero_documento', 'nombre'].includes(fila.campo));
      salida.push({
        severidad: critico ? 'critica' : 'informativa', campo: fila.campo,
        titulo: `Diferencia en ${NOMBRE_CAMPO[fila.campo]}`, explicacion: textoPar(par, fila.campo),
        codigo: 'diferencia', fuentes: par.split('_vs_').sort(),
      });
    }
  }
  if (d.afiliacion === AfiliacionEps.INACTIVA) {
    salida.push({
      severidad: 'critica', campo: 'afiliacion', titulo: 'Afiliación no vigente', codigo: 'afiliacion_inactiva', fuentes: [],
      explicacion: d.afiliacionFuente === 'adres_bdua'
        ? 'ADRES indica que la afiliación del estudiante no está vigente.' : 'La fuente consultada indica que la afiliación no está vigente.',
    });
  }
  if (d.autenticidad === AutenticidadEps.INVALIDA) {
    salida.push({
      severidad: 'critica', campo: 'autenticidad', titulo: 'Certificado no auténtico', codigo: 'autenticidad_invalida', fuentes: [],
      explicacion: 'La fuente oficial no confirma el certificado o contradice su contenido.',
    });
  }
  if (d.hayBanderaCritica) {
    salida.push({
      severidad: 'critica', campo: 'documento', titulo: 'Alerta crítica del documento', codigo: 'alerta_documento', fuentes: [],
      explicacion: 'El análisis del archivo dejó una alerta crítica que debe revisarse en el documento.',
    });
  }
  for (const faltante of camposClaveFaltantes(d)) {
    salida.push({ severidad: 'insuficiente', campo: faltante, codigo: 'campo_faltante', fuentes: [], ...EXPLICACION_FALTANTE[faltante] });
  }
  if (d.vigenciaCertificado === 'vencido') {
    salida.push({
      severidad: 'informativa', campo: 'fecha_expedicion', titulo: 'Certificado vencido', codigo: 'vencido', fuentes: [],
      explicacion: explicacionVencido(d.datosExtraidos?.fechaExpedicion ?? null, ctx),
    });
  }
  for (const x of d.discrepancias) {
    if (x.resultado === 'fuentes_distintas') {
      salida.push({
        severidad: 'informativa', campo: x.campo, titulo: 'Lecturas distintas del mismo documento', codigo: 'lecturas_distintas', fuentes: ['ocr', 'texto_nativo'],
        explicacion: 'El texto digital y el OCR leyeron valores diferentes en este campo; se dejó sin valor para que una persona lo revise.',
      });
    } else if (x.comparacion === 'oficial_vs_certificado') {
      const critico = ['numero_documento', 'nombre', 'eps', 'fecha_expedicion'].includes(x.campo);
      salida.push({
        severidad: critico ? 'critica' : 'informativa', campo: x.campo, titulo: 'El verificador oficial contradice el certificado', codigo: 'oficial_vs_certificado', fuentes: ['certificado', 'oficial'],
        explicacion: 'La fuente oficial muestra un valor distinto al del certificado en este dato.',
      });
    }
  }
  return deduplicarDiscrepancias(salida);
}

// ── Recomendación vigente ───────────────────────────────────────────────────

/**
 * Todo lo que aplica al caso, en el ORDEN de importancia: 1) documento o tipo incorrecto, 2) discrepancia
 * crítica de identidad, 3) certificado vencido, 4) información insuficiente (ilegible o incompleto),
 * 5) autenticidad o afiliación inválidas. ADRES pendiente va después y no oculta nada de lo anterior.
 */
export function condicionesRecomendacion(
  d: DatosValidacionEps, hayDiscrepanciaCritica: boolean, ctx?: Pick<ContextoMesa, 'tipoIncorrecto'>,
): RecomendacionEps[] {
  // Documento de otro tipo: es lo único que importa hasta que se reemplace; lo demás (vencido, campos, ADRES) no aplica.
  if (esDocumentoIncorrecto(d)) return [RecomendacionEps.DOCUMENTO_INCORRECTO];
  const condiciones: RecomendacionEps[] = [];
  if (ctx?.tipoIncorrecto) condiciones.push(RecomendacionEps.DOCUMENTO_INCORRECTO);
  if (hayDiscrepanciaCritica) condiciones.push(RecomendacionEps.DISCREPANCIA_CRITICA);
  if (d.vigenciaCertificado === 'vencido') condiciones.push(RecomendacionEps.CERTIFICADO_VENCIDO);
  const incompleto = camposClaveFaltantes(d).length > 0
    || (d.estadoProcesamiento === EstadoProcesamientoEps.PROCESADO && d.coincidencia === CoincidenciaEps.INSUFICIENTE);
  if (incompleto) condiciones.push(RecomendacionEps.INFORMACION_INSUFICIENTE);
  if (d.autenticidad === AutenticidadEps.INVALIDA || d.afiliacion === AfiliacionEps.INACTIVA) {
    condiciones.push(RecomendacionEps.REVISION_RECHAZO);
  }
  return condiciones;
}

/** Recomendación a mostrar HOY (se recalcula con los ejes actuales; no es una decisión). */
export function recomendacionActual(
  d: DatosValidacionEps, hayDiscrepanciaCritica: boolean, ctx?: Pick<ContextoMesa, 'tipoIncorrecto'>,
): RecomendacionEps {
  const [principal] = condicionesRecomendacion(d, hayDiscrepanciaCritica, ctx);
  if (principal) return principal;
  const adresAbierto = ESTADOS_ADRES_ABIERTOS.includes(d.adres.estado);
  if (d.afiliacion === AfiliacionEps.NO_CONTRASTADA && adresAbierto) return RecomendacionEps.PENDIENTE_ADRES;
  return recomendarEps({
    afiliacion: d.afiliacion, autenticidad: d.autenticidad, coincidenciaCertificado: d.coincidencia,
    vigencia: d.vigenciaCertificado, hayBanderaCritica: d.hayBanderaCritica, hayDiscrepanciaCritica,
  });
}

// ── Decisión: justificación reforzada ───────────────────────────────────────

import { JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA } from './justificacion-decision';
// Se reexportan: la definición es compartida con la Mesa de Actas.
export { JUSTIFICACION_MINIMA, JUSTIFICACION_REFORZADA };

export function evaluarApartamiento(
  decision: 'aprobar' | 'devolver' | 'rechazar', recomendacion: RecomendacionEps,
): { apartaDeRecomendacion: boolean; minimoJustificacion: number; motivo: string | null } {
  const negativa = recomendacion === RecomendacionEps.DISCREPANCIA_CRITICA || recomendacion === RecomendacionEps.REVISION_RECHAZO
    || recomendacion === RecomendacionEps.DOCUMENTO_INCORRECTO;
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
  /** Días enteros desde la consulta a ADRES: informativo, sirve aun sin política (no declara nada vencido). */
  diasDesdeConsulta: number | null;
}

export function evaluarFrescuraAdres(consultadoEn: Date | null, dias: number | null | undefined, ahora: Date): FrescuraAdres {
  const diasDesdeConsulta = consultadoEn ? Math.max(0, Math.floor((ahora.getTime() - consultadoEn.getTime()) / MS_DIA)) : null;
  if (dias === null || dias === undefined || !Number.isFinite(dias) || dias <= 0) return { politicaDefinida: false, dias: null, vencida: null, diasDesdeConsulta };
  if (!consultadoEn) return { politicaDefinida: true, dias, vencida: null, diasDesdeConsulta };
  return { politicaDefinida: true, dias, vencida: ahora.getTime() - consultadoEn.getTime() > dias * MS_DIA, diasDesdeConsulta };
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
