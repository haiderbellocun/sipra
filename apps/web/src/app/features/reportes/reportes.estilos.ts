/**
 * Estilos comunes de las pestañas de Reportes (V3). Nombres propios con prefijo `ra-`: evitan las clases globales
 * de estilos.css (.tabla, .fila, .barra, .pista…). Tonos de señal con variantes profundas en claro (AA).
 */
export const ESTILOS_REPORTES = `
  :host { display: block; --ra-ok: var(--status-success); --ra-info: var(--status-available); --ra-aviso: var(--status-review);
    --ra-peligro: var(--status-critical); --ra-neutra: color-mix(in srgb, var(--text-secondary) 45%, transparent); --ra-regla: var(--vd-regla, var(--border-subtle)); }
  :host-context([data-theme='light']) { --ra-ok: #06695d; --ra-aviso: #7a4a00; --ra-peligro: #b8231f; --ra-info: #03587a; }
  :host-context([data-theme='dark']) { --text-muted: #94aeac; }

  /* ── SIPRA Charts Theme (V3.3) ─ paleta BI por FAMILIAS (sin morado ni arcoíris): académico = blue/sky/cyan;
     organizaciones = teal/emerald/lime; atención = amber/orange; crítico = coral/rose; neutro = slate. Base clara: #2563EB,
     #0284C7, #0891B2→#0E7490, #0F766E, #15803D, #4D7C0F, #D97706→#B45309, #EA580C→#C2410C, #E05A47→#C2412E, #BE123C, #64748B (los
     ajustados alcanzan 3:1 como marca sobre el lienzo claro). En oscuro, las variantes claras de cada familia. Significados FIJOS:
     completo = emerald; en curso = sky; corrección = amber; rechazado/riesgo = rose; sin iniciar = slate; interna CUN = teal;
     externa = blue; programa = blue. En claro las cifras van en tinta (no en el color de la serie): el color queda en la marca. */
  :host { --bi-blue: #60a5fa; --bi-sky: #38bdf8; --bi-cyan: #22d3ee; --bi-teal: #2dd4bf; --bi-emerald: #4ade80; --bi-lime: #a3e635;
    --bi-amber: #fbbf24; --bi-orange: #fb923c; --bi-coral: #f2846f; --bi-rose: #fb7185; --bi-gris: #94a3b8; --gr-valor: var(--c);
    --gr-muted: rgb(148 163 184 / .30); --gr-rejilla: rgb(159 233 224 / .13); --gr-eje: rgb(159 233 224 / .34); --gr-texto-eje: var(--text-muted);
    --gr-hover: color-mix(in srgb, var(--text-primary) 4%, transparent); --gr-dur: 380ms; --gr-ease: cubic-bezier(.25, .8, .25, 1); }
  :host-context([data-theme='light']) { --bi-blue: #2563eb; --bi-sky: #0284c7; --bi-cyan: #0e7490; --bi-teal: #0f766e; --bi-emerald: #15803d; --bi-lime: #4d7c0f;
    --bi-amber: #b45309; --bi-orange: #c2410c; --bi-coral: #c2412e; --bi-rose: #be123c; --bi-gris: #64748b; --gr-valor: var(--text-primary);
    --gr-muted: rgb(71 85 105 / .22); --gr-rejilla: rgb(40 70 100 / .12); --gr-eje: rgb(40 70 100 / .38); --gr-texto-eje: var(--text-secondary); }
  :host { --gr-principal: var(--bi-blue); --gr-comparacion: var(--bi-orange); --gr-ok: var(--bi-emerald); --gr-info: var(--bi-sky); --gr-aviso: var(--bi-amber);
    --gr-riesgo: var(--bi-rose); --gr-interna: var(--bi-teal); --gr-externa: var(--bi-blue); }
  .gt-principal { --c: var(--gr-principal); } .gt-comparacion { --c: var(--gr-comparacion); } .gt-ok { --c: var(--gr-ok); } .gt-info { --c: var(--gr-info); }
  .gt-aviso { --c: var(--gr-aviso); } .gt-riesgo { --c: var(--gr-riesgo); } .gt-muted { --c: var(--gr-muted); }
  .gt-interna { --c: var(--gr-interna); } .gt-externa { --c: var(--gr-externa); }
  .gt-principal-suave { --c: color-mix(in srgb, var(--gr-principal) 50%, transparent); }
  .gt-comparacion-suave { --c: color-mix(in srgb, var(--gr-comparacion) 50%, transparent); }
  .gt-info-suave { --c: color-mix(in srgb, var(--gr-info) 50%, transparent); }
  .gt-c0 { --c: var(--bi-blue); } .gt-c1 { --c: var(--bi-teal); } .gt-c2 { --c: var(--bi-amber); } .gt-c3 { --c: var(--bi-rose); } .gt-c4 { --c: var(--bi-emerald); }
  .gt-c5 { --c: var(--bi-sky); } .gt-c6 { --c: var(--bi-orange); } .gt-c7 { --c: var(--bi-lime); } .gt-c8 { --c: var(--bi-cyan); } .gt-c9 { --c: var(--bi-coral); }
  /* Zonas analíticas: un tinte casi imperceptible por familia (académica = azul, organizaciones = teal, documentación = ámbar). */
  .ra-zona { padding: 18px 20px 20px; border-radius: 10px; background: linear-gradient(180deg, color-mix(in srgb, var(--zona, var(--bi-blue)) 5%, transparent), transparent 70%);
    border: 1px solid color-mix(in srgb, var(--zona, var(--bi-blue)) 10%, transparent); }
  .zona-academica { --zona: var(--bi-blue); } .zona-org { --zona: var(--bi-teal); } .zona-doc { --zona: var(--bi-amber); } .zona-tiempo { --zona: var(--bi-sky); }
  @media (width < 700px) { .ra-zona { padding: 14px 12px; } }
  /* Rejilla de 12 columnas y ritmo: 32 px entre filas de sección, 20 px entre gráficas, 12–16 px título → gráfica.
     Las tarjetas de una fila se estiran a la misma altura; los cuerpos de gráfica usan tres alturas (S, M, L). */
  .ra-g12 { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 20px; align-items: stretch; margin-top: 32px; }
  .ra-g12:first-child { margin-top: 0; }
  .c4 { grid-column: span 4; } .c5 { grid-column: span 5; } .c6 { grid-column: span 6; } .c7 { grid-column: span 7; } .c8 { grid-column: span 8; } .c12 { grid-column: span 12; }
  .ra-zona > .ra-nota { margin-bottom: 14px; }
  :host { --alto-s: 240px; --alto-m: 340px; --alto-l: 460px; }
  .alto-s { min-height: var(--alto-s); } .alto-m { min-height: var(--alto-m); } .alto-l { min-height: var(--alto-l); }
  @media (width < 1100px) { .c4, .c5, .c6, .c7, .c8 { grid-column: span 12; } .alto-s, .alto-m, .alto-l { min-height: 0; } }
  /* Tablas densas: una línea por fila; el texto largo se recorta con «…» (el nombre completo en el title de la celda). */
  .ra-una-linea th[scope='row'], .ra-una-linea td { white-space: nowrap; }
  .ra-una-linea th[scope='row'] { max-width: 22rem; overflow: hidden; text-overflow: ellipsis; }
  /* Marco de gráfica: referencia de posición del tooltip; título de eje y «Ver todos» comunes. */
  .gr-marco { position: relative; }
  .gr-eje-t { font: 500 11px/14px var(--fuente); color: var(--gr-texto-eje); letter-spacing: .02em; }
  .gr-mas { margin-top: 8px; padding: 4px 0; font: 500 12px/16px var(--fuente); color: var(--text-secondary); background: none; border: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
  .gr-mas:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 2px; }
  .gr-leyenda { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0; padding: 0; list-style: none; font-size: 12px; color: var(--text-secondary); }
  .gr-muestra { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 2px; background: var(--c); vertical-align: -1px; }
  @media (prefers-reduced-motion: reduce) { .gr-marco * { transition: none !important; } }
  .ra-sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .ra-rejilla { display: grid; gap: 28px 40px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); }
  .ra-bloque { min-width: 0; }
  .ra-bloque h2 { margin: 0 0 2px; font: 650 15px/22px var(--fuente); letter-spacing: -.005em; color: var(--text-primary); }
  .ra-nota { margin: 0 0 12px; font-size: 12px; line-height: 18px; color: var(--text-secondary); max-width: 78ch; }
  .ra-num { font-family: var(--fuente-mono); font-variant-numeric: tabular-nums; }

  /* Barra 100 %: decorativa; la tabla de al lado es la fuente accesible. */
  .ra-pila { display: flex; height: 14px; gap: 2px; margin: 4px 0 12px; }
  .ra-pila span { min-width: 3px; border-radius: 2px; transition: opacity 140ms var(--ease-out); }
  /* Selección: lo no elegido baja de intensidad (solo la marca gráfica; el texto conserva su contraste AA). */
  .ra-pila span.atenuada { opacity: .28; }
  .ra-mini { display: flex; height: 6px; width: 100%; min-width: 80px; gap: 1px; background: color-mix(in srgb, var(--text-primary) 7%, transparent); border-radius: 3px; overflow: hidden; }
  .ra-mini span { display: block; height: 100%; }
  .t-ok { background: var(--gr-ok); } .t-info { background: var(--gr-info); } .t-aviso { background: var(--gr-aviso); }
  .t-peligro { background: var(--gr-riesgo); } .t-neutra { background: var(--gr-muted); }
  .t-info-suave { background: color-mix(in srgb, var(--gr-info) 50%, transparent); }
  /* Series de categorías (cruces): las cinco primeras de la paleta categórica + «otras» en gris. */
  .s0 { background: var(--bi-blue); } .s1 { background: var(--bi-teal); } .s2 { background: var(--bi-amber); }
  .s3 { background: var(--bi-rose); } .s4 { background: var(--bi-emerald); }
  .s-otras { background: var(--gr-muted); }
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
