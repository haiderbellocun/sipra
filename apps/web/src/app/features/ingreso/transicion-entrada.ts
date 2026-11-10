/** Duración de la transición de entrada (ms): dentro del rango aprobado de 350–500. */
export const DURACION_TRANSICION_MS = 420;

/**
 * La línea de señal del login «se convierte en el rail» de la aplicación: una capa
 * temporal (fuera del componente, así sobrevive al cambio de vista) nace sobre el rail
 * del campo y se contrae hacia el borde izquierdo, donde vive el rail del armazón.
 *
 * - Solo `opacity` + `transform`.
 * - NO retrasa la navegación: se lanza justo antes de navegar y corre por su cuenta.
 * - Con `prefers-reduced-motion: reduce` no hace nada.
 */
export function lanzarTransicionEntrada(origen: DOMRect | null, anchoRailAplicacion = 64): void {
  if (typeof document === 'undefined' || typeof matchMedia !== 'function') return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const alto = window.innerHeight;
  const x0 = origen ? origen.left + origen.width / 2 : window.innerWidth / 2;
  const y0 = origen ? origen.top + origen.height / 2 : alto / 2;
  const x1 = anchoRailAplicacion / 2;

  const capa = document.createElement('div');
  capa.setAttribute('aria-hidden', 'true');
  Object.assign(capa.style, {
    position: 'fixed', left: '0', top: '0', width: '2px', height: `${alto}px`, zIndex: '9999',
    pointerEvents: 'none', background: 'linear-gradient(to bottom, transparent, var(--signal-active) 30%, var(--signal-active) 70%, transparent)',
    transformOrigin: `0 ${y0}px`, willChange: 'transform, opacity',
  });
  document.body.appendChild(capa);

  const animacion = capa.animate([
    { transform: `translateX(${x0}px) scaleY(.06)`, opacity: 0.9 },
    { transform: `translateX(${(x0 + x1) / 2}px) scaleY(.6)`, opacity: 0.9, offset: 0.55 },
    { transform: `translateX(${x1}px) scaleY(1)`, opacity: 0 },
  ], { duration: DURACION_TRANSICION_MS, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'forwards' });
  const limpiar = (): void => capa.remove();
  animacion.addEventListener('finish', limpiar);
  animacion.addEventListener('cancel', limpiar);
}
