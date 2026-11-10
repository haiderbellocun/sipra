/**
 * Tema visual (Hybrid Signal Dark · Arctic Signal Light).
 *
 * La preferencia se guarda con la clave y los valores que ya usaba SIPRA
 * ('sipra.tema': 'oscuro' | 'claro'). El documento lleva dos atributos: `data-theme`
 * (dark | light, el que leen los tokens) y `data-modo` (oscuro | claro, compatibilidad).
 * Las funciones son puras para poder probarlas sin navegador.
 */
export type ModoTema = 'oscuro' | 'claro';
export const CLAVE_TEMA = 'sipra.tema';

/** Preferencia guardada > preferencia del sistema > oscuro (predeterminado de SIPRA). */
export function resolverTema(guardado: string | null | undefined, prefiereClaro: boolean): ModoTema {
  if (guardado === 'claro' || guardado === 'oscuro') return guardado;
  return prefiereClaro ? 'claro' : 'oscuro';
}

export function atributosTema(modo: ModoTema): { theme: 'dark' | 'light'; modo: ModoTema } {
  return { theme: modo === 'claro' ? 'light' : 'dark', modo };
}

/** El cambio de tema se anima (fundido de 240 ms) solo si el navegador lo soporta y no se pidió reducir el movimiento. */
export function debeAnimarTema(reducirMovimiento: boolean, soportaTransicionDeVista: boolean): boolean {
  return soportaTransicionDeVista && !reducirMovimiento;
}
