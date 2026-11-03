/**
 * Dónde puede existir el RUES SIMULADO (`RuesSimuladoAdapter`, con NIT inventados).
 *
 * Solo en desarrollo (`SIPRA_AMBIENTE=dev`) y en las pruebas automatizadas (`NODE_ENV=test`). En `qa`, `pre` y `prod`
 * nunca: sin un adaptador real, RUES queda `no_disponible` / no verificable y no devuelve ningún dato. Una señal
 * «RUES ok» salida de datos simulados en un ambiente real sería una verificación falsa.
 *
 * `qa` queda fuera a propósito: es un proyecto de nube separado, con personas probando; si CUN decide lo contrario,
 * se cambia aquí y en `politica-rues.spec.ts`.
 */
export function ambientePermiteRuesSimulado(ambiente: unknown, nodeEnv: unknown = undefined): boolean {
  // `NODE_ENV=test` solo vale si no se declaró ambiente: un `SIPRA_AMBIENTE=prod` con NODE_ENV=test sigue sin simulado.
  return ambiente === 'dev' || (nodeEnv === 'test' && (ambiente === undefined || ambiente === null || ambiente === ''));
}
