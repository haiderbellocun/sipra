/**
 * Tipos documentales que revisa y decide un MOTOR ESPECIALIZADO (EPS, Actas, RUT, Cámara). Su decisión pertenece a la Mesa de su
 * motor (reserva por documento, versión vigente, justificación y motivo, transacción única y auditoría): el camino general de
 * decisión NO debe ofrecerse para ellos (la API responde 403). Espejo de `TIPOS_CON_MOTOR_ESPECIALIZADO` del dominio del API.
 */
export const TIPOS_CON_MOTOR_ESPECIALIZADO: readonly string[] = [
  'certificado_eps', 'acta_inicio', 'rut_natural', 'rut_juridico', 'camara_comercio',
];

/** ¿La pantalla puede ofrecer Aprobar / Devolver / Rechazar por el camino general de documentos para este tipo? */
export function decisionGeneralPermitida(tipo: string): boolean {
  return !TIPOS_CON_MOTOR_ESPECIALIZADO.includes(tipo);
}

/** Qué motor revisa un tipo (para enlazar a la Mesa de Validación Documental). */
export function tieneMotorEspecializado(tipo: string): boolean {
  return TIPOS_CON_MOTOR_ESPECIALIZADO.includes(tipo);
}
