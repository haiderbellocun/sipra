import type {
  DocumentoDeExpediente, EstadoHumanoDocumento, ItemExpediente, ProgresoExpediente, ReservaDocumento, ResumenDocumento,
} from '@core/models/validacion-documental.model';

/**
 * Lógica PURA de presentación del «Document Signal» (V3): qué señal visual le corresponde a cada documento, cómo se arma el rail,
 * qué se anima y qué énfasis lleva la barra de decisión. NADA de esto decide ni valida: solo traduce los datos reales del expediente
 * (estado humano, criticidad, reserva) a icono + color + etiqueta + animación. Sin Angular ni DOM: se prueba con `node --test`.
 */

export type ClaveSenal = 'aprobado' | 'revision' | 'critico' | 'correccion' | 'disponible' | 'pendiente' | 'reservado' | 'procesando' | 'rechazado';

/** Cómo se mueve el nodo ACTIVO. Los demás nodos no se animan nunca (como máximo un elemento pulsa a la vez). */
export type AnimacionNodo = 'ninguna' | 'pulso-lento' | 'pulso-unico' | 'barrido-unico' | 'vivo-sutil';

export interface SenalVisual {
  clave: ClaveSenal;
  /** Clave de icono (ver `ICONO_SENAL`): el icono acompaña SIEMPRE al color y a la etiqueta. */
  icono: ClaveSenal;
  /** Variable CSS del color de relleno/trazo. */
  token: string;
  /** Variable CSS del color cuando se usa como TEXTO (en el rojo oscuro el texto usa un tono más claro). */
  tokenTexto: string;
  etiqueta: string;
  animacion: AnimacionNodo;
  /** Halo permanente (solo lo lleva lo crítico cuando es el nodo activo). */
  glow: boolean;
}

export const SENAL: Readonly<Record<ClaveSenal, SenalVisual>> = {
  aprobado: { clave: 'aprobado', icono: 'aprobado', token: '--status-success', tokenTexto: '--status-success', etiqueta: 'Aprobado', animacion: 'barrido-unico', glow: false },
  revision: { clave: 'revision', icono: 'revision', token: '--status-review', tokenTexto: '--status-review', etiqueta: 'Revisión necesaria', animacion: 'pulso-lento', glow: false },
  critico: { clave: 'critico', icono: 'critico', token: '--status-critical', tokenTexto: '--text-danger', etiqueta: 'Discrepancia crítica', animacion: 'pulso-unico', glow: true },
  correccion: { clave: 'correccion', icono: 'correccion', token: '--status-returned', tokenTexto: '--status-returned', etiqueta: 'Necesita corrección', animacion: 'pulso-lento', glow: false },
  disponible: { clave: 'disponible', icono: 'disponible', token: '--status-available', tokenTexto: '--status-available', etiqueta: 'Disponible para revisión', animacion: 'ninguna', glow: false },
  pendiente: { clave: 'pendiente', icono: 'pendiente', token: '--status-pending', tokenTexto: '--status-pending', etiqueta: 'Pendiente de cargar', animacion: 'ninguna', glow: false },
  reservado: { clave: 'reservado', icono: 'reservado', token: '--signal-default', tokenTexto: '--signal-default', etiqueta: 'En revisión', animacion: 'vivo-sutil', glow: false },
  procesando: { clave: 'procesando', icono: 'procesando', token: '--status-available', tokenTexto: '--status-available', etiqueta: 'Procesando', animacion: 'ninguna', glow: false },
  rechazado: { clave: 'rechazado', icono: 'rechazado', token: '--status-critical', tokenTexto: '--text-danger', etiqueta: 'Rechazado', animacion: 'ninguna', glow: false },
};

/** Trazos SVG (viewBox 24, trazo 2, sin relleno salvo `disponible`). Cada señal tiene su forma: no depende del color. */
export const ICONO_SENAL: Readonly<Record<ClaveSenal, string>> = {
  aprobado: 'M5.5 12.5l4.2 4.2L18.5 7.8',
  revision: 'M12 6.5v7M12 17.4h.01',
  critico: 'M12 4.2l8.4 14.6H3.6zM12 10v4M12 16.6h.01',
  correccion: 'M9.5 7L4.5 12l5 5M5 12h9.5a5 5 0 015 5v1',
  disponible: 'M12 12h.01',
  pendiente: 'M8 12h8',
  reservado: 'M7.5 11V8.5a4.5 4.5 0 019 0V11M6 11h12v8.5H6z',
  procesando: 'M7 12h.01M12 12h.01M17 12h.01',
  rechazado: 'M7 7l10 10M17 7L7 17',
};

type EntradaSenal = Pick<DocumentoDeExpediente, 'estadoHumano' | 'reserva'> & Partial<Pick<DocumentoDeExpediente, 'criticidad' | 'informacionInsuficiente' | 'requiereRevision'>>;

/**
 * Estado humano + criticidad + reserva → señal. Reglas (en este orden):
 * aprobado → aprobado; necesita corrección → coral; rechazado/error → rechazado; pendiente/no aplica → pendiente; procesando → procesando;
 * en revisión (alguien lo tiene tomado) → candado, SALVO que sea crítico: lo crítico se ve rojo aunque esté reservado (el candado se
 * dibuja aparte, ver `tieneCandado`); disponible → ámbar si pide atención o falta información, rojo si es crítico, cian si es normal.
 */
export function senalDeDocumento(d: EntradaSenal): SenalVisual {
  switch (d.estadoHumano) {
    case 'aprobado': return SENAL.aprobado;
    case 'necesita_correccion': return SENAL.correccion;
    case 'rechazado': case 'error': return SENAL.rechazado;
    case 'pendiente_de_cargar': case 'no_aplica': return SENAL.pendiente;
    case 'procesando': return SENAL.procesando;
    case 'en_revision': return d.criticidad === 'critico' ? SENAL.critico : SENAL.reservado;
    case 'disponible_para_revision': default:
      if (d.criticidad === 'critico') return SENAL.critico;
      if (d.criticidad === 'atencion' || d.informacionInsuficiente) return SENAL.revision;
      return SENAL.disponible;
  }
}

/** El candado se ve cuando alguien (usted u otra persona) tiene el documento tomado, sea cual sea su color. */
export const tieneCandado = (r: Pick<ReservaDocumento, 'estado'>): boolean => r.estado === 'mia' || r.estado === 'otro';

// ── Movimiento ────────────────────────────────────────────────────────────

/** `prefers-reduced-motion: reduce` ⇒ NADA se anima: los estados quedan estáticos. */
export const debeAnimar = (prefiereMovimientoReducido: boolean | null | undefined): boolean => prefiereMovimientoReducido !== true;

/**
 * Animación efectiva de un nodo. Solo el ACTIVO se anima (un elemento a la vez); un pendiente nunca; con movimiento reducido, nada.
 * El barrido del aprobado no es permanente: lo dispara el rail UNA vez al cambiar el estado real (ver `cambioAAprobado`).
 */
export function animacionNodo(senal: SenalVisual, opciones: { activo: boolean; reducido: boolean }): AnimacionNodo {
  if (!opciones.activo || !debeAnimar(opciones.reducido)) return 'ninguna';
  return senal.animacion;
}

/** Duración (ms) de la transición de color del nodo al cambiar de estado: devolver 250, aprobar 350, rechazar 140 (sobrio). */
export function duracionTransicion(destino: ClaveSenal): number {
  switch (destino) {
    case 'aprobado': return 350;
    case 'correccion': return 250;
    case 'rechazado': return 140;
    default: return 220;
  }
}

/** Claves de los documentos que PASARON a aprobado entre dos lecturas del expediente (para disparar el barrido una sola vez). */
export function cambioAAprobado(antes: ReadonlyMap<string, ClaveSenal>, ahora: ReadonlyMap<string, ClaveSenal>): string[] {
  const salida: string[] = [];
  for (const [tipo, clave] of ahora) if (clave === 'aprobado' && antes.has(tipo) && antes.get(tipo) !== 'aprobado') salida.push(tipo);
  return salida;
}

// ── Document Signal rail ──────────────────────────────────────────────────

/** Con más nodos que esto el rail deja de ser lineal: desborda con degradado en los bordes y botones de desplazamiento. */
export const UMBRAL_DESBORDE = 8;
export const modoRail = (n: number): 'lineal' | 'desborde' => (n > UMBRAL_DESBORDE ? 'desborde' : 'lineal');

export interface NodoRail {
  tipo: string;
  indice: number;
  nombre: string;
  etiquetaEstado: string;
  senal: SenalVisual;
  activo: boolean;
  candado: boolean;
  version: number | null;
  reenvio: boolean;
  adicional: boolean;
  sinCargar: boolean;
  problema: string | null;
  /** Texto completo de la reserva (para lectores de pantalla y para la lista) y su versión corta para el nodo. */
  reservaTexto: string | null;
  reservaCorta: string | null;
}

/** «Camila Rodríguez» → «Camila R.»; un solo nombre queda igual. */
export function abreviarNombre(nombre: string | null | undefined): string {
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return 'otra persona';
  if (partes.length === 1) return partes[0];
  return `${partes[0]} ${partes[1].charAt(0).toUpperCase()}.`;
}

/** «Tú · 12 min» / «Camila R. · 8 min» (solo con reserva vigente). */
export function reservaCorta(r: Pick<ReservaDocumento, 'estado' | 'por' | 'minutosRestantes'>): string | null {
  if (r.estado !== 'mia' && r.estado !== 'otro') return null;
  const min = r.minutosRestantes === null ? '' : ` · ${r.minutosRestantes} min`;
  return `${r.estado === 'mia' ? 'Tú' : abreviarNombre(r.por)}${min}`;
}

/** Un nodo por documento REAL del expediente (nunca una lista fija), en el orden en que llega. */
export function construirRail(documentos: readonly DocumentoDeExpediente[], activo: string | null, textoReserva: (r: ReservaDocumento) => string): NodoRail[] {
  return documentos.map((d, indice) => {
    const senal = senalDeDocumento(d);
    return {
      tipo: d.tipoDocumento, indice, nombre: d.nombreHumano, etiquetaEstado: d.estadoHumanoEtiqueta || senal.etiqueta, senal, activo: d.tipoDocumento === activo,
      candado: tieneCandado(d.reserva), version: d.version, reenvio: d.esReenvio, adicional: !d.obligatorio, sinCargar: d.documentoId === null,
      problema: d.problemaPrincipal, reservaTexto: d.reserva.estado !== 'libre' ? textoReserva(d.reserva) : null, reservaCorta: reservaCorta(d.reserva),
    };
  });
}

/** Índice del nodo activo (0 si no hay ninguno): alimenta `--i`, que mueve el indicador y el flujo con `transform`. */
export const indiceActivo = (nodos: readonly Pick<NodoRail, 'activo'>[]): number => Math.max(0, nodos.findIndex((n) => n.activo));

/** Fracción (0–1) del flujo de la línea: del primer nodo al activo. Con un solo nodo, 0. */
export const fraccionFlujo = (indice: number, total: number): number => (total <= 1 ? 0 : Math.min(1, Math.max(0, indice / (total - 1))));

/** Navegación con flechas entre nodos (← → Inicio Fin); devuelve el índice destino o `null` si la tecla no navega. */
export function indiceConTecla(tecla: string, actual: number, total: number): number | null {
  if (total <= 0) return null;
  switch (tecla) {
    case 'ArrowRight': case 'ArrowDown': return Math.min(total - 1, actual + 1);
    case 'ArrowLeft': case 'ArrowUp': return Math.max(0, actual - 1);
    case 'Home': return 0;
    case 'End': return total - 1;
    default: return null;
  }
}

// ── Progreso ──────────────────────────────────────────────────────────────

/** «3 de 6 aprobados» (lectores de pantalla y barra de progreso). */
export const textoAprobados = (p: Pick<ProgresoExpediente, 'aprobados' | 'total'>): string => `${p.aprobados} de ${p.total} aprobados`;

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

/** Resumen humano junto a la cifra: SOLO lo que tiene valor. */
export function resumenProgreso(p: ProgresoExpediente): string[] {
  const filas: string[] = [];
  if (p.requierenRevision > 0) filas.push(plural(p.requierenRevision, 'en revisión', 'en revisión'));
  if (p.pendientesDeCargar > 0) filas.push(plural(p.pendientesDeCargar, 'pendiente', 'pendientes'));
  if (p.necesitanCorreccion > 0) filas.push(plural(p.necesitanCorreccion, 'devuelto', 'devueltos'));
  if (p.rechazados > 0) filas.push(plural(p.rechazados, 'rechazado', 'rechazados'));
  if (p.errores > 0) filas.push(plural(p.errores, 'con error', 'con error'));
  return filas;
}

// ── Barra de decisión ─────────────────────────────────────────────────────

export type AccionDecision = 'rechazar' | 'devolver' | 'aprobar';
/** Posiciones FIJAS, izquierda → derecha: Rechazar (discreto) | Devolver | Aprobar. Nunca cambian; solo cambia el énfasis. */
export const ORDEN_ACCIONES: readonly AccionDecision[] = ['rechazar', 'devolver', 'aprobar'];

/**
 * Qué acción lleva el énfasis (botón primario con chaflán y glow) según el TONO de la recomendación que el motor YA entrega:
 * revisión o discrepancia (aviso/peligro) → Devolver primario y Aprobar secundario; consistente (ok) → Aprobar primario.
 * Sin recomendación clara (info, neutra, ninguna) se conserva el comportamiento anterior: Aprobar. Rechazar nunca es primario.
 */
export function enfasisDecision(tono: string | null | undefined): Exclude<AccionDecision, 'rechazar'> {
  return tono === 'aviso' || tono === 'peligro' ? 'devolver' : 'aprobar';
}

/** El tono de la recomendación se lee de la clase `rec--<tono>` que pinta el motor. */
export function tonoDeClases(clases: string | null | undefined): string | null {
  const m = /(?:^|\s)rec--(ok|aviso|peligro|info|neutra)(?:\s|$)/.exec(clases ?? '');
  return m ? m[1] : null;
}

// ── Cola ──────────────────────────────────────────────────────────────────

export interface PuntoCola { tipo: string; senal: SenalVisual }

/** Un punto por documento OBLIGATORIO (el resumen de la cola no trae criticidad: el color sale del estado humano y la reserva). */
export function puntosCola(documentos: readonly ResumenDocumento[]): PuntoCola[] {
  return documentos.filter((d) => d.obligatorio).map((d) => ({ tipo: d.tipoDocumento, senal: senalDeDocumento({ estadoHumano: d.estadoHumano as EstadoHumanoDocumento, reserva: { ...d.reserva, hasta: null } }) }));
}

/** Estado de la fila en texto con color: lo más urgente primero. */
export function estadoFila(x: Pick<ItemExpediente, 'indicadores' | 'progreso' | 'esperandoDesde'>): { texto: string; tono: 'peligro' | 'aviso' | 'ok' | 'info' | 'neutra' } {
  const i = x.indicadores;
  if (i.criticos > 0) return { texto: `${plural(i.criticos, 'crítico', 'críticos')}${i.reenvios > 0 ? ` · ${plural(i.reenvios, 'reenvío', 'reenvíos')}` : ''}`, tono: 'peligro' };
  if (i.reenvios > 0) return { texto: plural(i.reenvios, 'reenvío', 'reenvíos'), tono: 'aviso' };
  if (i.informacionInsuficiente > 0) return { texto: 'Información insuficiente', tono: 'aviso' };
  if (x.progreso.completo) return { texto: 'Documentación completa', tono: 'ok' };
  if (x.esperandoDesde) return { texto: 'Por revisar', tono: 'info' };
  return { texto: 'Sin documentos por revisar', tono: 'neutra' };
}

/** Antigüedad en el feed: «3 d», «hoy» o «—». */
export function antiguedadCorta(x: Pick<ItemExpediente, 'esperandoDesde' | 'diasEsperando'>): string {
  if (!x.esperandoDesde) return '—';
  return x.diasEsperando <= 0 ? 'hoy' : `${x.diasEsperando} d`;
}

/** «Tú (1) · Camila R. (2)»: quién tiene documentos tomados en este expediente (o `null`). */
export function reservasFila(items: readonly { nombre: string; documentos: number; esUsted: boolean }[]): string | null {
  if (items.length === 0) return null;
  return items.map((x) => `${x.esUsted ? 'Tú' : abreviarNombre(x.nombre)} (${x.documentos})`).join(' · ');
}

/** Chip de reserva del encabezado: «Tu reserva · 12 min», «Reservado · Camila R. · 8 min» o «Reserva vencida» (solo si hay algo que decir). */
export function chipReserva(r: Pick<ReservaDocumento, 'estado' | 'por' | 'minutosRestantes'> | null | undefined): { texto: string; tono: 'mia' | 'otro' | 'vencida' } | null {
  if (!r) return null;
  const min = r.minutosRestantes === null ? '' : ` · ${r.minutosRestantes} min`;
  if (r.estado === 'mia') return { texto: `Tu reserva${min}`, tono: 'mia' };
  if (r.estado === 'otro') return { texto: `Reservado · ${abreviarNombre(r.por)}${min}`, tono: 'otro' };
  if (r.estado === 'vencida') return { texto: 'Reserva vencida', tono: 'vencida' };
  return null;
}
