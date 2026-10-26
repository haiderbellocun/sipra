/**
 * Formato de dinero en español de Colombia. Los pipes de Angular formatean en
 * en-US porque la aplicación no registra un `LOCALE_ID`; las cifras de costo
 * de IA son tan pequeñas (milésimas de centavo) que merecen un formato propio.
 */
const USD_4 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const USD_2 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COP_0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const ENTERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

/** `US$ 0,0064` para cifras pequeñas; `US$ 12,50` desde un dólar. */
export function formatearUsd(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '—';
  return `US$ ${(Math.abs(valor) < 1 ? USD_4 : USD_2).format(valor)}`;
}

/** `$ 26`: pesos sin decimales a la TRM indicada. */
export function formatearCop(usd: number | null | undefined, trm: number): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd) || !Number.isFinite(trm) || trm <= 0) return '—';
  return `$ ${COP_0.format(usd * trm)}`;
}

/** Enteros con separador de miles es-CO (`12.345`). */
export function formatearEntero(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '—';
  return ENTERO.format(valor);
}
