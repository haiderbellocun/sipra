import { DatosCamaraExtraidos, DatosRutExtraidos, EstadoRegistral } from '../entities/documento-empresarial';

/**
 * Vigencia de los documentos empresariales, con cada concepto en su propio eje.
 *
 * ── RUT ──
 * La inscripción en el RUT tiene vigencia INDEFINIDA (el propio formulario lo dice). La fecha de generación del PDF
 * es un dato informativo: una fecha antigua NO equivale a un RUT vencido. Este dominio no produce «RUT no vigente»
 * por antigüedad, ni «año en curso», ni 30/60/90 días.
 *
 * LEGADO (no se toca todavía): `criterios-documentales.ts` marca `delAnoEnCurso = true` para RUT y Cámara, y de ahí
 * dependen `conocimiento-documental.domain-service.ts` (criterio ANO_EN_CURSO, causal de devolución) y
 * `validacion-arl.domain-service.ts` (RUT_NO_VIGENTE / CAMARA_NO_VIGENTE en la solicitud de ARL), con sus pruebas
 * (`proceso-sgp-catalogo`, `conocimiento-documental`, `solicitud-arl`). Este módulo NO los importa: la validación
 * nueva está desacoplada para retirar el legado de forma controlada, como política institucional independiente.
 *
 * ── Cámara ──
 * Estado registral, renovación, antigüedad del certificado y autenticidad son cuatro cosas distintas. No existe una
 * bandera `vigente`. La antigüedad solo bloquea si CUN define `camaraMaxDiasExpedicion` (por defecto `null`: no
 * bloquea). Los «60 días» de verificación en línea que imprime el certificado son otra cosa que su antigüedad y que
 * la vigencia del registro mercantil.
 */

// ── RUT ─────────────────────────────────────────────────────────────────────

export interface VigenciaRut {
  /** Siempre `true`: la vigencia del RUT es indefinida. */
  vigenciaIndefinida: true;
  /** Dato informativo (AAAA-MM-DD), tal como se leyó. */
  fechaGeneracion: string | null;
  anioGeneracion: number | null;
}

export function vigenciaRut(datos: Pick<DatosRutExtraidos, 'fechaGeneracion'>): VigenciaRut {
  const f = datos.fechaGeneracion;
  const valida = f !== null && /^\d{4}-\d{2}-\d{2}$/.test(f);
  return { vigenciaIndefinida: true, fechaGeneracion: valida ? f : null, anioGeneracion: valida ? Number(f.slice(0, 4)) : null };
}

// ── Cámara ──────────────────────────────────────────────────────────────────

export interface PoliticaCamara {
  /** Máximo de días desde la expedición. `null` = no se bloquea por antigüedad hasta que CUN lo defina. */
  camaraMaxDiasExpedicion: number | null;
}

/** Sin política institucional definida: no se inventa ningún plazo. */
export const POLITICA_CAMARA_POR_DEFECTO: PoliticaCamara = { camaraMaxDiasExpedicion: null };

/** Acepta solo un entero positivo; cualquier otra cosa (ausente, 0, negativo, texto) equivale a «sin política». */
export function normalizarPoliticaCamara(valor: unknown): PoliticaCamara {
  const n = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  return { camaraMaxDiasExpedicion: typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null };
}

export interface AntiguedadCertificado {
  fechaExpedicion: string | null;
  diasDesdeExpedicion: number | null;
  politicaDias: number | null;
  /** `null` = no se pudo o no se debe decidir (sin fecha, o sin política institucional). */
  cumplePolitica: boolean | null;
}

export interface EvaluacionCamara {
  estadoRegistral: EstadoRegistral;
  ultimoAnioRenovado: number | null;
  fechaRenovacion: string | null;
  antiguedad: AntiguedadCertificado;
  /** Hasta cuándo el certificado se puede verificar en línea, si el propio documento lo declara. NO es vigencia registral. */
  verificacionDisponibleHasta: string | null;
}

/**
 * Estado registral a partir de la etiqueta que el certificado MUESTRA de forma explícita («Estado de la matrícula: ACTIVA»).
 * Sin etiqueta —lo normal en los certificados— es `no_determinable`: la matrícula, la renovación, la firma o el código NO
 * implican «activo». Una etiqueta que no es activa ni cancelada (liquidación, suspendida…) es `otro`.
 */
export function estadoRegistralDesdeEtiqueta(etiqueta: string | null | undefined): EstadoRegistral {
  const e = (etiqueta ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toUpperCase();
  if (!e) return EstadoRegistral.NO_DETERMINABLE;
  if (/^(ACTIV[OA])$/.test(e)) return EstadoRegistral.ACTIVO;
  if (/^(CANCELAD[OA])$/.test(e)) return EstadoRegistral.CANCELADO;
  return EstadoRegistral.OTRO;
}

/** Fecha civil de hoy en Colombia (AAAA-MM-DD). */
function hoyEnColombia(ahora: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

function aUtcDia(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function sumarDias(iso: string, dias: number): string {
  return new Date(aUtcDia(iso) + dias * 86_400_000).toISOString().slice(0, 10);
}

export function evaluarCamara(
  datos: Pick<DatosCamaraExtraidos, 'estadoRegistral' | 'ultimoAnioRenovado' | 'fechaRenovacion' | 'fechaExpedicion' | 'diasVerificacionDocumento'>,
  ahora: Date,
  politica: PoliticaCamara = POLITICA_CAMARA_POR_DEFECTO,
): EvaluacionCamara {
  const expedicion = datos.fechaExpedicion !== null && ISO.test(datos.fechaExpedicion) ? datos.fechaExpedicion : null;
  const dias = expedicion === null ? null : Math.floor((aUtcDia(hoyEnColombia(ahora)) - aUtcDia(expedicion)) / 86_400_000);
  const max = politica.camaraMaxDiasExpedicion;
  return {
    // El estado solo es el que el documento muestra explícitamente. La renovación NO lo convierte en «activo».
    estadoRegistral: datos.estadoRegistral,
    ultimoAnioRenovado: datos.ultimoAnioRenovado,
    fechaRenovacion: datos.fechaRenovacion,
    antiguedad: {
      fechaExpedicion: expedicion,
      diasDesdeExpedicion: dias !== null && dias >= 0 ? dias : null,
      politicaDias: max,
      cumplePolitica: max === null || dias === null || dias < 0 ? null : dias <= max,
    },
    verificacionDisponibleHasta:
      expedicion !== null && datos.diasVerificacionDocumento !== null && datos.diasVerificacionDocumento > 0
        ? sumarDias(expedicion, datos.diasVerificacionDocumento)
        : null,
  };
}
