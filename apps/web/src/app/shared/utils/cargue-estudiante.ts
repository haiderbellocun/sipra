import { CargueEstudiante, EstadoCargueEstudiante } from '@core/models/modelos';

/**
 * Presentación del cargue del estudiante (G2). NO decide nada: el estado y lo permitido vienen
 * calculados del servidor (`cargueEstudiante`). Aquí solo hay rótulos, formato de fechas y, para el
 * formulario de periodos, la sugerencia visible y el aviso previo de una fecha ya pasada.
 */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** `2027-05-30` → `30 may` (fechas académicas: se leen como texto, sin zona horaria). */
export function fechaCorta(iso: string | null | undefined, conAnio = false): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MESES[m - 1]}${conAnio ? ` ${a}` : ''}`;
}

/** `2027-05-30` → `30 de mayo de 2027`. */
export function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} de ${MESES_LARGOS[m - 1]} de ${a}`;
}

/** Rótulo operativo del estado (para la gestión de periodos). No depende solo del color. */
export const ROTULO_ESTADO_CARGUE: Readonly<Record<EstadoCargueEstudiante, string>> = {
  abierto: 'Abierto',
  aun_no_abre: 'Programado',
  cerrado_por_fecha: 'Cerrado',
  inhabilitado: 'Inhabilitado',
  periodo_inactivo: 'Periodo inactivo',
  sin_ventana: 'Sin ventana',
  sin_periodo: 'Sin periodo',
};

export type TonoCargue = 'ok' | 'pendiente' | 'neutro' | 'pausa';

export function tonoEstadoCargue(estado: EstadoCargueEstudiante): TonoCargue {
  switch (estado) {
    case 'abierto': return 'ok';
    case 'aun_no_abre': return 'pendiente';
    case 'inhabilitado': return 'pausa';
    default: return 'neutro';
  }
}

/** Hoy en Colombia (UTC−5, sin horario de verano) como `AAAA-MM-DD`. Solo para avisos previos. */
export function hoyColombiaIso(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** Sugerencia visible al crear un periodo: desde el inicio hasta dos semanas antes del cierre. */
export function sugerenciaVentana(fechaInicio: string, fechaFin: string): { desde: string; hasta: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaFin) || fechaFin <= fechaInicio) return null;
  const hasta = new Date(Date.parse(`${fechaFin}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  return { desde: fechaInicio, hasta: hasta > fechaInicio ? hasta : fechaFin };
}

/**
 * Validación previa de la ventana (la definitiva es del servidor): orden y pertenencia al periodo.
 * Devuelve el texto del problema o `null`.
 */
export function problemaVentana(desde: string, hasta: string, inicioPeriodo: string, finPeriodo: string): string | null {
  if (!desde || !hasta) return 'Indique las dos fechas de cargue.';
  if (hasta < desde) return 'La fecha «hasta» no puede ser anterior a «desde».';
  if (desde < inicioPeriodo || hasta > finPeriodo) return 'Las fechas de cargue deben estar dentro de las fechas del periodo.';
  return null;
}

/** Aviso previo: al guardar esta ventana el cargue quedará cerrado de inmediato. */
export function avisoFechaPasada(hasta: string, ahora: Date = new Date()): string | null {
  return hasta && hasta < hoyColombiaIso(ahora) ? 'Esta fecha ya pasó. Al guardar, el cargue quedará cerrado inmediatamente.' : null;
}

export const CONFIRMAR_INHABILITAR =
  'Los estudiantes de este período no podrán cargar nuevos documentos hasta que vuelvas a habilitarlo.';

// ── Expediente del estudiante ──────────────────────────────────────────────

export interface BannerCargue {
  tono: TonoCargue;
  titulo: string;
  detalle: string;
}

/** Pieza compacta del expediente, según el estado que calculó el servidor. */
export function bannerCargue(c: CargueEstudiante | null | undefined): BannerCargue {
  if (!c) {
    return { tono: 'neutro', titulo: 'Cargue no disponible', detalle: 'No encontramos una ventana de cargue habilitada para tu período académico. Comunícate con el Área de Prácticas.' };
  }
  switch (c.estado) {
    case 'abierto':
      return { tono: 'ok', titulo: 'Cargue habilitado', detalle: c.hasta ? `Puedes cargar documentos hasta el ${fechaLarga(c.hasta)}.` : c.mensaje };
    case 'aun_no_abre':
      return {
        tono: 'pendiente', titulo: 'Cargue disponible próximamente',
        detalle: c.desde && c.hasta ? `Podrás cargar documentos del ${fechaLarga(c.desde)} al ${fechaLarga(c.hasta)}.` : c.mensaje,
      };
    case 'cerrado_por_fecha':
      return {
        tono: 'neutro', titulo: 'Cargue cerrado',
        detalle: `${c.hasta ? `El período de entrega finalizó el ${fechaLarga(c.hasta)}. ` : ''}Puedes consultar tus documentos existentes, pero ya no cargar nuevas versiones.`,
      };
    case 'inhabilitado':
      return { tono: 'pausa', titulo: 'Cargue temporalmente inhabilitado', detalle: 'El Área de Prácticas ha restringido el cargue para este período.' };
    default:
      return { tono: 'neutro', titulo: 'Cargue no disponible', detalle: c.mensaje };
  }
}

/** Motivo breve para los botones deshabilitados (tooltip y texto accesible). */
export function motivoBloqueo(c: CargueEstudiante | null | undefined): string {
  if (!c) return 'No hay una ventana de cargue habilitada para tu período.';
  switch (c.estado) {
    case 'aun_no_abre': return 'El período de cargue aún no inicia.';
    case 'cerrado_por_fecha': return 'El período de cargue finalizó.';
    case 'inhabilitado': return 'El cargue está temporalmente inhabilitado.';
    default: return 'No hay una ventana de cargue habilitada para tu período.';
  }
}

/** Subsanación vigente de ESE tipo (solo aplica con la ventana cerrada por fecha; ya viene filtrada del servidor). */
export function subsanacionDe(c: CargueEstudiante | null | undefined, tipo: string): { vence: string } | null {
  return c?.subsanaciones.find((s) => s.tipo === tipo) ?? null;
}

/** ¿El estudiante puede cargar este tipo? Sin proyección, falla cerrada. */
export function estudiantePuedeCargarTipo(c: CargueEstudiante | null | undefined, tipo: string): boolean {
  if (!c) return false;
  return c.permitido || subsanacionDe(c, tipo) !== null;
}
