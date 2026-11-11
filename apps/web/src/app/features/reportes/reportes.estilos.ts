/**
 * Estilos comunes de las pestañas de Reportes (V3). Nombres propios con prefijo `ra-`: evitan las clases globales
 * de estilos.css (.tabla, .fila, .barra, .pista…). Tonos de señal con variantes profundas en claro (AA).
 */
export const ESTILOS_REPORTES = `
  :host { display: block; --ra-ok: var(--status-success); --ra-info: var(--status-available); --ra-aviso: var(--status-review);
    --ra-peligro: var(--status-critical); --ra-neutra: color-mix(in srgb, var(--text-secondary) 45%, transparent); --ra-regla: var(--vd-regla, var(--border-subtle)); }
  :host-context([data-theme='light']) { --ra-ok: #06695d; --ra-aviso: #7a4a00; --ra-peligro: #b8231f; --ra-info: #03587a; }
  :host-context([data-theme='dark']) { --text-muted: #94aeac; }
  .ra-sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .ra-rejilla { display: grid; gap: 28px 40px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); }
  .ra-bloque { min-width: 0; }
  .ra-bloque h2 { margin: 0 0 2px; font: 600 15px/22px var(--fuente); color: var(--text-primary); }
  .ra-nota { margin: 0 0 12px; font-size: 12px; line-height: 18px; color: var(--text-secondary); max-width: 78ch; }
  .ra-num { font-family: var(--fuente-mono); font-variant-numeric: tabular-nums; }

  /* Barra 100 %: decorativa; la tabla de al lado es la fuente accesible. */
  .ra-pila { display: flex; height: 14px; gap: 2px; margin: 4px 0 12px; }
  .ra-pila span { min-width: 3px; border-radius: 2px; }
  .ra-mini { display: flex; height: 6px; width: 100%; min-width: 80px; gap: 1px; background: color-mix(in srgb, var(--text-primary) 7%, transparent); border-radius: 3px; overflow: hidden; }
  .ra-mini span { display: block; height: 100%; }
  .t-ok { background: var(--ra-ok); } .t-info { background: var(--ra-info); } .t-aviso { background: var(--ra-aviso); }
  .t-peligro { background: var(--ra-peligro); } .t-neutra { background: var(--ra-neutra); }
  .t-info-suave { background: color-mix(in srgb, var(--ra-info) 50%, transparent); }
  /* Series de categorías (modalidades, niveles…): cinco tonos de la familia de señal + «otras». Sin arcoíris. */
  .s0 { background: var(--ra-info); } .s1 { background: var(--ra-ok); } .s2 { background: color-mix(in srgb, var(--ra-info) 50%, transparent); }
  .s3 { background: color-mix(in srgb, var(--ra-ok) 50%, transparent); } .s4 { background: color-mix(in srgb, var(--text-secondary) 75%, transparent); }
  .s-otras { background: var(--ra-neutra); }
  .ra-punto { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 8px; vertical-align: 1px; }

  .ra-tabla { width: 100%; border-collapse: collapse; font-size: 13px; }
  .ra-tabla caption { text-align: left; }
  .ra-tabla th { padding: 6px 10px; font: 600 11px/16px var(--fuente); letter-spacing: .04em; text-transform: uppercase; color: var(--text-secondary); text-align: left; border-bottom: 1px solid var(--border-default); white-space: nowrap; }
  .ra-tabla th[scope='row'] { font: 500 13px/18px var(--fuente); letter-spacing: 0; text-transform: none; color: var(--text-primary); border-bottom-color: var(--ra-regla); white-space: normal; }
  .ra-tabla td { padding: 7px 10px; color: var(--text-primary); border-bottom: 1px solid var(--ra-regla); vertical-align: middle; }
  .ra-tabla th.d, .ra-tabla td.d { text-align: right; font-family: var(--fuente-mono); font-variant-numeric: tabular-nums; }
  .ra-tabla tbody tr:hover td { background: color-mix(in srgb, var(--text-primary) 3%, transparent); }
  .ra-tabla tr.sub td { color: var(--text-secondary); }
  .ra-tabla tr.sub td:first-child { padding-left: 30px; }
  /* Posicionado: el texto solo para lectores (.ra-sr, absoluto) queda recortado aquí y no ensancha la página. */
  .ra-desliza { overflow-x: auto; position: relative; }
  .ra-tenue { color: var(--text-muted); }
  :host-context([data-theme='light']) .ra-tenue { color: var(--text-secondary); }

  /* Cifra que abre el detalle: botón real, subrayado al pasar. */
  .ra-ir { padding: 2px 4px; margin: -2px -4px; font: inherit; color: inherit; text-align: left; background: none; border: 0; border-radius: 4px; cursor: pointer; text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px; }
  .ra-ir:hover { text-decoration-color: currentColor; color: var(--signal-default); }
  :host-context([data-theme='light']) .ra-ir:hover { color: #03587a; }
  .ra-ir:focus-visible, .ra-abrir:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
  .ra-ir:disabled { cursor: default; text-decoration: none; color: var(--text-muted); }
  .ra-abrir { display: inline-grid; place-items: center; width: 22px; height: 22px; margin-right: 6px; padding: 0; color: var(--text-secondary); background: none; border: 1px solid var(--border-default); border-radius: 4px; cursor: pointer; vertical-align: -5px; }
  .ra-abrir svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; transition: transform 160ms var(--ease-out); }
  .ra-abrir[aria-expanded='true'] svg { transform: rotate(90deg); }
  @media (prefers-reduced-motion: reduce) { .ra-abrir svg { transition: none; } }
`;
