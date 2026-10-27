/**
 * Interruptores operativos del flujo EPS (parte pura). Se leen de la configuración EN CADA USO
 * (no se cachean): apagar una pieza durante un incidente solo exige cambiar la variable de
 * entorno de la revisión de Cloud Run, sin desplegar código nuevo. Apagar NO borra nada: el
 * trabajo queda en espera. La autoaprobación no tiene interruptor que la encienda (ver las
 * reglas de ambiente de `configuracion.ts`).
 */
export const INTERRUPTORES_EPS = {
  /** Lectura local del certificado, Mesa y decisiones. Por defecto encendido. */
  validacion: 'EPS_VALIDACION_HABILITADA',
  /** Consulta ADRES asistida (preparar, cargar, procesar). Por defecto encendido. */
  adres: 'ADRES_ASISTIDO_HABILITADO',
  /** OCR local. Apagado: se lee texto nativo y QR; lo demás queda para revisión humana. Por defecto encendido. */
  ocr: 'EPS_OCR_HABILITADO',
  /** Verificación contra un mecanismo OFICIAL registrado. Por defecto APAGADO. */
  verificacion: 'VERIFICACION_EPS_HABILITADA',
} as const;

export type ClaveInterruptorEps = (typeof INTERRUPTORES_EPS)[keyof typeof INTERRUPTORES_EPS];

/** Valor por defecto de cada interruptor: solo la verificación externa nace apagada. */
export function valorPorDefectoEps(clave: ClaveInterruptorEps): boolean {
  return clave !== INTERRUPTORES_EPS.verificacion;
}

/** Interpreta lo que llegó de la configuración (booleano o texto); vacío o ausente = valor por defecto. */
export function interruptorActivo(valor: unknown, clave: ClaveInterruptorEps): boolean {
  if (valor === undefined || valor === null || valor === '') return valorPorDefectoEps(clave);
  return valor === true || (typeof valor === 'string' && valor.toLowerCase() === 'true');
}
