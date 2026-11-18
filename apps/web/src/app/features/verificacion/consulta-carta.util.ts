/** Consulta pública de cartas (presentación). El servidor normaliza, limita y decide; aquí solo validación previa y mensajes. */

/** Validación previa (la misma regla del servidor): 4–20 letras o dígitos tras quitar espacios y puntos. */
export function documentoConsultaValido(bruto: string): boolean {
  return /^[0-9A-Za-z]{4,20}$/.test((bruto ?? '').replace(/[\s.]/g, ''));
}

export const MENSAJES_CONSULTA = {
  limite: 'Demasiadas consultas desde esta conexión. Intenta de nuevo en unos minutos.',
  noVigente: 'La carta consultada ya no se encuentra vigente.',
  enlace: 'El enlace de descarga venció. Consulta de nuevo la carta.',
  invalida: 'Escribe un número de identificación válido (solo números o letras).',
  general: 'No fue posible completar la consulta. Intenta de nuevo.',
} as const;

/** Mensaje por estado HTTP (en la descarga el cuerpo del error llega como Blob: no se lee, se decide por el estado). */
export function mensajeErrorConsulta(error: unknown): string {
  const estado = typeof error === 'object' && error !== null ? (error as { status?: number }).status : undefined;
  switch (estado) {
    case 429: return MENSAJES_CONSULTA.limite;
    case 410: return MENSAJES_CONSULTA.noVigente;
    case 403: return MENSAJES_CONSULTA.enlace;
    case 400: return MENSAJES_CONSULTA.invalida;
    default: return MENSAJES_CONSULTA.general;
  }
}

/** Nombre del archivo descargado: la referencia (no la cédula). */
export function nombreArchivoPublico(referencia: string): string {
  return `Carta_presentacion_${referencia.replace(/[^0-9A-Z-]/g, '')}.pdf`;
}
