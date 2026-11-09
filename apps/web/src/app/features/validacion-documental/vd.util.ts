import type {
  DocumentoDeExpediente, EstadoHumanoDocumento, FiltrosExpedientes, ProgresoExpediente, ReservaDocumento, ResumenDocumento, VistaRapida,
} from '@core/models/validacion-documental.model';

/** Cómo se ve cada estado humano común: SIEMPRE icono + texto (el color es un refuerzo, nunca el único canal). */
export interface RotuloEstado { texto: string; icono: string; tono: 'ok' | 'aviso' | 'peligro' | 'info' | 'neutra' }

export const ESTADO_VISUAL: Readonly<Record<EstadoHumanoDocumento, RotuloEstado>> = {
  pendiente_de_cargar: { texto: 'Pendiente de cargar', icono: '○', tono: 'neutra' },
  procesando: { texto: 'Procesando', icono: '…', tono: 'info' },
  disponible_para_revision: { texto: 'Disponible para revisión', icono: '!', tono: 'aviso' },
  en_revision: { texto: 'En revisión', icono: '◐', tono: 'info' },
  necesita_correccion: { texto: 'Necesita corrección', icono: '↩', tono: 'aviso' },
  aprobado: { texto: 'Aprobado', icono: '✓', tono: 'ok' },
  rechazado: { texto: 'Rechazado', icono: '✕', tono: 'peligro' },
  error: { texto: 'Error', icono: '⚠', tono: 'peligro' },
  no_aplica: { texto: 'No aplica', icono: '–', tono: 'neutra' },
};

export function rotuloEstado(estado: EstadoHumanoDocumento): RotuloEstado {
  return ESTADO_VISUAL[estado];
}

export const NOMBRE_MOTOR: Readonly<Record<string, string>> = {
  eps: 'Validación de EPS', acta: 'Acta de iniciación', rut: 'Mesa de RUT', camara: 'Mesa de Cámara', general: 'Revisión general',
};

/** «Tomado por Juan · 8 min», «Tomado por usted · 8 min», «Reserva vencida» o «Disponible». */
export function textoReservaDocumento(r: Pick<ReservaDocumento, 'estado' | 'por' | 'minutosRestantes'>): string {
  if (r.estado === 'libre') return 'Disponible';
  if (r.estado === 'vencida') return r.por ? `Reserva vencida (${r.por})` : 'Reserva vencida';
  const min = r.minutosRestantes === null ? '' : ` · ${r.minutosRestantes} min`;
  return r.estado === 'mia' ? `Tomado por usted${min}` : `Tomado por ${r.por ?? 'otra persona'}${min}`;
}

/** «2 / 6 aprobados». */
export function textoProgreso(p: Pick<ProgresoExpediente, 'aprobados' | 'total'>): string {
  return `${p.aprobados} / ${p.total} aprobados`;
}

/**
 * El expediente solo se rotula «Completo» cuando el servidor lo dice (`completo`); nunca se infiere en la pantalla. Es un estado
 * DOCUMENTAL, no una decisión académica.
 */
export function etiquetaProgreso(p: ProgresoExpediente): string {
  if (p.completo) return 'Documentación completa';
  if (p.total === 0) return 'Sin obligaciones documentales';
  return 'En curso';
}

/** Resumen de contadores: solo lo que tiene algún valor, en palabras. */
export function contadoresExpediente(p: ProgresoExpediente): { clave: string; texto: string; n: number }[] {
  return [
    { clave: 'pendientes', texto: 'Pendientes de cargar', n: p.pendientesDeCargar },
    { clave: 'revision', texto: 'Requieren revisión', n: p.requierenRevision },
    { clave: 'correccion', texto: 'Necesitan corrección', n: p.necesitanCorreccion },
  ];
}

// ── Navegación entre documentos del expediente (no vuelve a la cola) ─────────

type NavegableBasico = Pick<DocumentoDeExpediente, 'tipoDocumento' | 'requiereRevision' | 'reserva'>;

/**
 * Anterior / siguiente / siguiente pendiente. «Pendiente» = lo que una persona puede revisar ahora (disponible o ya suyo), salteando
 * lo que otra persona tiene tomado. Mismo criterio que `siguienteDocumento` del servidor.
 */
export function navegarDocumento<T extends NavegableBasico>(lista: readonly T[], actual: string | null, modo: 'siguiente' | 'anterior' | 'pendiente'): T | null {
  if (lista.length === 0) return null;
  const i = actual === null ? -1 : lista.findIndex((d) => d.tipoDocumento === actual);
  if (modo === 'siguiente') return lista[(i + 1) % lista.length];
  if (modo === 'anterior') return lista[(i - 1 + lista.length) % lista.length];
  for (let paso = 1; paso <= lista.length; paso += 1) {
    const d = lista[(i + paso) % lista.length];
    if (d.requiereRevision && d.reserva.estado !== 'otro') return d;
  }
  return null;
}

// ── Vistas rápidas y filtros ─────────────────────────────────────────────────

export const VISTAS_RAPIDAS: ReadonlyArray<{ clave: VistaRapida; titulo: string }> = [
  { clave: 'todos', titulo: 'Todos' },
  { clave: 'pendientes', titulo: 'Con pendientes' },
  { clave: 'problemas', titulo: 'Con problemas' },
  { clave: 'mis_documentos', titulo: 'Mis documentos' },
  { clave: 'por_vencer', titulo: 'Reservas por vencer' },
];

/** Quita los filtros vacíos (el servidor ignora lo que no viene). */
export function filtrosLimpios(f: FiltrosExpedientes): FiltrosExpedientes {
  const salida: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '' && !(k === 'vista' && v === 'todos')) salida[k] = String(v);
  return salida as FiltrosExpedientes;
}

/** Cuántos filtros «avanzados» hay activos (sin contar la vista rápida ni la búsqueda): para el botón «Más filtros». */
export function filtrosAvanzadosActivos(f: FiltrosExpedientes): number {
  const claves: Array<keyof FiltrosExpedientes> = ['escuela', 'modalidad', 'estado', 'conPendientes', 'conDiscrepancias', 'conDevueltos', 'ocr', 'reserva', 'antiguedadMinDias'];
  return claves.filter((k) => f[k] !== undefined && f[k] !== '').length;
}

/** Quién está trabajando un documento de la fila de la cola, en una frase corta (o `null`). */
export function textoTrabajando(items: readonly { nombre: string; documentos: number; esUsted: boolean }[]): string | null {
  if (items.length === 0) return null;
  return items.map((x) => `${x.esUsted ? 'Usted' : x.nombre} (${x.documentos})`).join(' · ');
}

/** Chip de la cola: «RUT · Tomado por Juan · 8 min» solo si hay reserva vigente; si no, solo el estado. */
export function textoChip(d: ResumenDocumento): string {
  const base = `${d.nombreHumano} · ${d.estadoHumanoEtiqueta}`;
  return d.reserva.estado === 'mia' || d.reserva.estado === 'otro' ? `${base} · ${textoReservaDocumento(d.reserva)}` : base;
}

/** El documento puede abrirse en el visor: hay archivo cargado. */
export const tieneArchivo = (d: Pick<DocumentoDeExpediente, 'documentoId'>): boolean => d.documentoId !== null;
