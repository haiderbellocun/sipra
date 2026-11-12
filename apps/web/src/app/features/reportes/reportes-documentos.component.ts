import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { MetricaV3 } from '@shared/components/tira-metricas.component';
import { ReportesBarrasComponent } from './reportes-barras.component';
import { ReportesKpisComponent } from './reportes-kpis.component';
import { ReportesLineasComponent, SerieLinea } from './reportes-lineas.component';
import { ReportesProporcionComponent } from './reportes-proporcion.component';
import { ReportesInsightsComponent, insights } from './reportes-insights.component';
import { GrupoSwarm, PuntoSwarm, ReportesSwarmComponent } from './reportes-swarm.component';
import { ReportesMatrizComponent } from './reportes-matriz.component';
import { num } from './reportes-graficos.util';
import {
  CATEGORIAS_EXPEDIENTE, CATEGORIAS_OBLIGACION, Cobertura, ItemBarra, semanaCorta, FiltrosAnalitica, RECEPTORES, SIN_DATO, SituacionExpediente, TASAS, TipoReceptor, compararNiveles, horas, nivel,
  partes, partesGrafico, pct1, razon, segunOrden, semestre,
} from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

type DimensionSalud = 'programa' | 'ciclo' | 'semestre' | 'modalidad' | 'periodo' | 'receptor' | 'sector' | 'ciudad';
export const DIMENSIONES_SALUD: readonly { id: DimensionSalud; texto: string }[] = [
  { id: 'programa', texto: 'Programa' }, { id: 'ciclo', texto: 'Nivel' }, { id: 'semestre', texto: 'Semestre' }, { id: 'modalidad', texto: 'Modalidad' },
  { id: 'periodo', texto: 'Periodo' }, { id: 'receptor', texto: 'Interna / externa' }, { id: 'sector', texto: 'Sector' }, { id: 'ciudad', texto: 'Ciudad' },
];
interface FilaSalud { clave: string; texto: string; c: Cobertura }

/**
 * Salud documental por dimensión académica (programa, nivel, modalidad, periodo) con TASAS (no solo volumen) y
 * Documentos de la Mesa Única como dimensiones: tipo de documento × estado de su última versión (obligaciones),
 * fricción por versiones y decisiones auditadas, y tiempo de carga a decisión. No hay un reporte por motor.
 */
@Component({
  selector: 'sipra-reportes-documentos',
  standalone: true,
  imports: [EtiquetaPipe, ReportesKpisComponent, ReportesProporcionComponent, ReportesBarrasComponent, ReportesLineasComponent, ReportesInsightsComponent, ReportesSwarmComponent, ReportesMatrizComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .ancho { grid-column: 1 / -1; }
    .ra-tabla td.mini { min-width: 140px; }
    summary:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    details { margin-top: 12px; font-size: 13px; }
    summary { cursor: pointer; color: var(--text-secondary); width: max-content; }
    .dims { display: inline-flex; gap: 2px; margin: 0 0 10px; padding: 2px; border: 1px solid var(--border-default); border-radius: 7px; }
    .dims button { height: 28px; padding: 0 12px; font: 500 12px/1 var(--fuente); color: var(--text-secondary); background: none; border: 0; border-radius: 5px; cursor: pointer; }
    .dims button[aria-pressed='true'] { color: var(--text-primary); background: color-mix(in srgb, var(--signal-active) 18%, transparent); font-weight: 600; }
    .dims button:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .sub-t { margin: 22px 0 6px; font: 600 13px/18px var(--fuente); color: var(--text-primary); }
    .cifras-t { display: flex; flex-wrap: wrap; gap: 8px 40px; margin: 6px 0 4px; }
    .cifras-t div { display: grid; gap: 2px; }
    .cifras-t dt { font: 500 12px/16px var(--fuente); color: var(--text-secondary); }
    .cifras-t dd { margin: 0; font: 500 28px/32px var(--fuente-mono); letter-spacing: -.02em; color: color-mix(in srgb, var(--bi-sky) 55%, var(--text-primary)); }
    .detalle-doc { margin-top: 32px; }
    .detalle-doc > summary { padding: 10px 0; font: 600 14px/20px var(--fuente); color: var(--text-primary); }
    .detalle-doc section { margin-top: 24px; }
    .tabla-larga { max-height: 520px; overflow: auto; }
    .tabla-larga thead th { position: sticky; top: 0; z-index: 1; background: var(--surface-raised); }
    .tabla-larga .ra-tabla td, .tabla-larga .ra-tabla th { padding-block: 5px; }
  `],
  template: `
    @if (estado.datos(); as r) {
      <sipra-reportes-insights class="zona-doc" [lineas]="lecturas()" />

      <!-- A. Salud documental -->
      <div class="ra-g12">
        <section class="ra-bloque ra-zona zona-doc c12" aria-labelledby="d-resumen">
          <h2 id="d-resumen">Salud documental</h2>
          <p class="ra-nota">Obligaciones exigidas por la matriz de cada modalidad, según el estado de su última versión (las versiones nuevas no suman obligaciones). {{ tasas.aprobacion.texto }} = {{ tasas.aprobacion.definicion }}.</p>
          <sipra-reportes-kpis class="compacta" etiqueta="Obligaciones documentales" [metricas]="resumen()" />
          <div style="margin-top:16px">
            <sipra-reportes-proporcion titulo="Obligaciones por estado de su última versión" [partes]="total()" unidad="obligaciones" base="de las exigidas" [seleccionable]="false" />
          </div>
        </section>
        <section class="ra-bloque ra-zona zona-doc c12" aria-labelledby="d-sit">
          <h2 id="d-sit">Situación del expediente</h2>
          <p class="ra-nota">Una por práctica. Elegir una situación filtra todo el reporte.</p>
          <sipra-reportes-proporcion titulo="Prácticas por situación del expediente (elegir una filtra el reporte)" [partes]="expedientes()" unidad="prácticas" base="de las prácticas filtradas"
            [seleccion]="estado.filtros().situacion" (elegir)="situacion($event)" />
        </section>
      </div>

      <!-- B. Tipos con problemas -->
      <div class="ra-g12">
        <section class="ra-bloque ra-zona zona-doc c7 alto-m" aria-labelledby="d-mapa">
          <h2 id="d-mapa">Tipo de documento × estado</h2>
          <p class="ra-nota">Obligaciones por estado de su última versión; la intensidad es la proporción dentro de cada tipo (compara tipos de distinto volumen). La celda abre esas prácticas en la tabla.</p>
          <sipra-reportes-matriz titulo="Obligaciones por tipo de documento y estado" rotuloFilas="Tipo de documento" rotuloColumnas="Estado" unidad="obligaciones" tono="c2" normalizar="fila"
            [celdas]="celdasEstado()" [ordenColumnas]="ordenEstados" [textoFila]="etiquetaTipo" [textoColumna]="textoEstado" [cortoColumna]="cortoEstado" [limite]="12"
            pieCelda="Clic para ver las prácticas" (elegirFila)="estado.abrirDetalle({ tipo: $event })" (elegirCelda)="abrirCelda($event)" />
        </section>
        <section class="ra-bloque ra-zona zona-doc c5 alto-m" aria-labelledby="d-corr">
          <h2 id="d-corr">Tipos con más correcciones</h2>
          <p class="ra-nota">Obligaciones en corrección o rechazadas por tipo de documento. Por volumen: cantidad; por tasa: sobre los exigidos de ese tipo. Cada barra abre las prácticas afectadas.</p>
          <div class="dims" role="group" aria-label="Medir las correcciones por">
            <button type="button" [attr.aria-pressed]="medidaCorr() === 'volumen'" (click)="medidaCorr.set('volumen')">Por volumen</button>
            <button type="button" [attr.aria-pressed]="medidaCorr() === 'tasa'" (click)="medidaCorr.set('tasa')">Por tasa</button>
          </div>
          <div>
            <sipra-reportes-barras titulo="Tipos de documento con más correcciones" [items]="correcciones()" [total]="0" [unidad]="medidaCorr() === 'tasa' ? 'en corrección' : 'obligaciones en corrección'"
              [ejeX]="medidaCorr() === 'tasa' ? '% de los exigidos' : 'Obligaciones'" [formato]="medidaCorr() === 'tasa' ? tasaFmt : null" tono="riesgo" [limite]="8"
              [seleccion]="estado.segmento()?.estadoDocumental === 'correccion' ? estado.segmento()?.tipo ?? '' : ''" (elegir)="abrirCorrecciones($event)" />
          </div>
        </section>
      </div>

      <!-- C. Tiempo de decisión -->
      <div class="ra-g12">
        <section class="ra-bloque ra-zona zona-tiempo c12" aria-labelledby="d-tiempo">
          <h2 id="d-tiempo">Tiempos de decisión</h2>
          <p class="ra-nota">De la carga de cada versión a su decisión humana auditada. Sin meta institucional: no se muestra SLA.</p>
          @if (r.tiempos.decisiones) {
            <dl class="cifras-t">
              <div><dt>Mediana</dt><dd>{{ horas(r.tiempos.medianaHoras) }}</dd></div>
              <div><dt>P90</dt><dd>{{ horas(r.tiempos.p90Horas) }}</dd></div>
              <div><dt>Decisiones</dt><dd>{{ num(r.tiempos.decisiones) }}</dd></div>
            </dl>
            <h3 class="sub-t" id="d-swarm">¿Cuánto tarda una decisión?</h3>
          <p class="ra-nota">Cada punto es una decisión humana auditada (de la carga de la versión a su decisión), en escala logarítmica. La línea marca la mediana del grupo.
            @if (r.tiempos.muestras.length < r.tiempos.decisiones) { Se dibujan {{ num(r.tiempos.muestras.length) }} de {{ num(r.tiempos.decisiones) }} decisiones (muestra determinista); medianas y p90 usan todas. }</p>
          <div class="dims" role="group" aria-label="Agrupar los tiempos por">
            <button type="button" [attr.aria-pressed]="grupoSwarm() === 'tipo'" (click)="grupoSwarm.set('tipo')">Tipo de documento</button>
            <button type="button" [attr.aria-pressed]="grupoSwarm() === 'programa'" (click)="grupoSwarm.set('programa')">Programa</button>
          </div>
          <sipra-reportes-swarm titulo="Tiempo de carga a decisión" [puntos]="swarm().puntos" [grupos]="swarm().grupos" [rotulo]="grupoSwarm() === 'tipo' ? 'Tipo de documento' : 'Programa'" />
        
            <details>
              <summary>Ver la mediana por tipo de documento</summary>
          @if (r.tiempos.decisiones) {
            
            <table class="ra-tabla ra-una-linea">
              <caption class="ra-sr">Mediana de carga a decisión por tipo de documento</caption>
              <thead><tr><th scope="col">Documento</th><th scope="col" class="d">Decisiones</th><th scope="col" class="d">Mediana</th></tr></thead>
              <tbody>@for (t of r.tiempos.porTipo; track t.tipo) { <tr><th scope="row" [attr.title]="t.tipo | etiqueta">{{ t.tipo | etiqueta }}</th><td class="d">{{ t.decisiones }}</td><td class="d">{{ horas(t.medianaHoras) }}</td></tr> }</tbody>
            </table>
          } @else { <p class="ra-nota">Sin decisiones auditadas en este filtro.</p> }
          
            </details>
          } @else { <p class="ra-nota">Sin decisiones auditadas en este filtro.</p> }
        </section>
      </div>

      <!-- D. Evolución temporal -->
      <div class="ra-g12">
        <section class="ra-bloque ra-zona zona-tiempo c12" aria-labelledby="d-mov">
          <h2 id="d-mov">Movimiento de las últimas 12 semanas</h2>
          <p class="ra-nota">Cargas, aprobaciones y devoluciones por semana (lunes a domingo, hora de Colombia; la última está en curso).</p>          <sipra-reportes-lineas titulo="Cargas y decisiones por semana" [categorias]="semanas()" [series]="seriesSemanas()" unidad="" />
          <details>
            <summary>Ver el movimiento semanal como tabla</summary>
            <p class="ra-nota" style="margin-top:8px">Lunes a domingo, hora de Colombia; la última semana está en curso.</p>
            <table class="ra-tabla">
              <caption class="ra-sr">Cargas y decisiones por semana</caption>
              <thead><tr><th scope="col">Semana</th><th scope="col" class="d">Cargas</th><th scope="col" class="d">Aprob.</th><th scope="col" class="d">Devol.</th><th scope="col" class="d">Rech.</th></tr></thead>
              <tbody>@for (w of r.semanas; track w.semana) { <tr><td>{{ semanaCorta(w.semana) }}</td><td class="d">{{ w.cargas }}</td><td class="d">{{ w.aprobaciones }}</td><td class="d">{{ w.devoluciones }}</td><td class="d">{{ w.rechazos }}</td></tr> }</tbody>
            </table>
          </details>
        
        </section>
      </div>

      <!-- E. Tablas detalladas (a pedido, a todo el ancho) -->
      <details class="detalle-doc">
        <summary>Ver tablas detalladas: grupos afectados, tipos de documento, correcciones y versiones</summary>
        <section class="ra-bloque" aria-labelledby="d-salud">
          <h2 id="d-salud">¿Qué grupos están afectados?</h2>
          <p class="ra-nota">{{ tasas.devolucion.texto }} = {{ tasas.devolucion.definicion }}; {{ tasas.versiones.texto }} = {{ tasas.versiones.definicion }}. El volumen crece con el tamaño del grupo; la tasa permite comparar. De menor a mayor aprobación; el nombre filtra el reporte.</p>
          <div class="dims" role="group" aria-label="Agrupar la salud documental por">
            @for (d of dimensionesVisibles(); track d.id) { <button type="button" [attr.aria-pressed]="dimension() === d.id" (click)="dimension.set(d.id)">{{ d.texto }}</button> }
          </div>
          <div class="ra-desliza tabla-larga">
            <table class="ra-tabla ra-una-linea">
              <caption class="ra-sr">Salud documental por {{ rotuloDimension() }}</caption>
              <thead><tr><th scope="col">{{ rotuloDimension() }}</th><th scope="col" class="d">Estudiantes</th><th scope="col" class="d">Exigidos</th><th scope="col" class="d">Aprobación</th><th scope="col"><span class="ra-sr">Estados de las obligaciones</span></th><th scope="col" class="d">En corrección</th><th scope="col" class="d">Devoluciones</th><th scope="col" class="d">Devol./doc.</th><th scope="col" class="d">Versiones/doc.</th></tr></thead>
              <tbody>
                @for (fila of salud(); track fila.clave) {
                  <tr>
                    <th scope="row"><button type="button" class="ra-ir" [attr.aria-pressed]="activo(fila.clave)" (click)="filtrar(fila.clave)">{{ fila.texto }}</button></th>
                    <td class="d">{{ fila.c.estudiantes }}</td>
                    <td class="d">{{ fila.c.exigidos }}</td>
                    <td class="d" [title]="fila.c.aprobados + ' / ' + fila.c.exigidos">{{ pct1(fila.c.aprobados, fila.c.exigidos) }}</td>
                    <td class="mini"><span class="ra-mini" aria-hidden="true">@for (c of categorias; track c.clave) { <span [class]="'t-' + (c.clase ?? c.tono)" [style.flex-grow]="fila.c.obligaciones[c.clave]"></span> }</span></td>
                    <td class="d">{{ fila.c.correccion }}</td>
                    <td class="d">{{ fila.c.devoluciones }}</td>
                    <td class="d" [title]="fila.c.devoluciones + ' / ' + fila.c.documentos">{{ razon(fila.c.devoluciones, fila.c.documentos) }}</td>
                    <td class="d" [title]="fila.c.versiones + ' / ' + fila.c.documentos">{{ razon(fila.c.versiones, fila.c.documentos) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <section class="ra-bloque" aria-labelledby="d-tipo">
          <h2 id="d-tipo">¿Qué documentos tienen problemas?</h2>
          <p class="ra-nota">Volumen (cantidades) y tasa (sobre los exigidos de ese tipo) por separado. Cada cifra abre las prácticas afectadas en la tabla de abajo.</p>
          <div class="dims" role="group" aria-label="Ordenar los tipos de documento por">
            @for (o of ordenesTipo; track o.id) { <button type="button" [attr.aria-pressed]="ordenTipo() === o.id" (click)="ordenTipo.set(o.id)">{{ o.texto }}</button> }
          </div>
          <div class="ra-desliza tabla-larga">
            <table class="ra-tabla ra-una-linea">
              <caption class="ra-sr">Obligaciones por tipo de documento: volumen y tasa</caption>
              <thead><tr><th scope="col">Documento</th><th scope="col" class="d">Exigidos</th><th scope="col" class="d">Pendientes</th><th scope="col" class="d">En revisión</th><th scope="col" class="d">En corrección</th><th scope="col" class="d">Aprobados</th><th scope="col" class="d">% aprobación</th><th scope="col" class="d">% corrección</th></tr></thead>
              <tbody>
                @for (t of tipos(); track t.tipo) {
                  <tr>
                    <th scope="row" [attr.title]="t.tipo | etiqueta">{{ t.tipo | etiqueta }}</th>
                    <td class="d">{{ t.exigidos }}</td>
                    <td class="d">@if (t.sin_cargar) { <button type="button" class="ra-ir" (click)="estado.abrirDetalle({ tipo: t.tipo, estadoDocumental: 'sin_cargar' })" [attr.aria-label]="(t.tipo | etiqueta) + ': ' + t.sin_cargar + ' pendientes. Ver prácticas'">{{ t.sin_cargar }}</button> } @else { <span class="ra-tenue">0</span> }</td>
                    <td class="d">@if (t.en_revision) { <button type="button" class="ra-ir" (click)="estado.abrirDetalle({ tipo: t.tipo, estadoDocumental: 'en_revision' })" [attr.aria-label]="(t.tipo | etiqueta) + ': ' + t.en_revision + ' en revisión. Ver prácticas'">{{ t.en_revision }}</button> } @else { <span class="ra-tenue">0</span> }</td>
                    <td class="d">@if (t.correccion) { <button type="button" class="ra-ir" (click)="estado.abrirDetalle({ tipo: t.tipo, estadoDocumental: 'correccion' })" [attr.aria-label]="(t.tipo | etiqueta) + ': ' + t.correccion + ' en corrección. Ver prácticas'">{{ t.correccion }}</button> } @else { <span class="ra-tenue">0</span> }</td>
                    <td class="d">{{ t.aprobado }}</td>
                    <td class="d" [title]="t.aprobado + ' / ' + t.exigidos">{{ pct1(t.aprobado, t.exigidos) }}</td>
                    <td class="d" [title]="(t.correccion + t.rechazado) + ' / ' + t.exigidos">{{ pct1(t.correccion + t.rechazado, t.exigidos) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <section class="ra-bloque" aria-labelledby="d-fric">
          <h2 id="d-fric">Correcciones y versiones</h2>
          <p class="ra-nota">Por tipo: documentos (práctica y tipo), versiones, reenvíos y decisiones auditadas de devolver o rechazar.</p>
          @if (r.friccion.length) {
            <div class="ra-desliza tabla-larga">
              <table class="ra-tabla ra-una-linea">
                <caption class="ra-sr">Versiones, reenvíos, devoluciones y rechazos por tipo de documento</caption>
                <thead><tr><th scope="col">Documento</th><th scope="col" class="d">Docs.</th><th scope="col" class="d">Versiones</th><th scope="col" class="d">Prom.</th><th scope="col" class="d">Con reenvío</th><th scope="col" class="d">Devol.</th><th scope="col" class="d">Rech.</th></tr></thead>
                <tbody>@for (f of r.friccion; track f.tipo) {
                  <tr><th scope="row" [attr.title]="f.tipo | etiqueta">{{ f.tipo | etiqueta }}</th><td class="d">{{ f.documentos }}</td><td class="d">{{ f.versiones }}</td><td class="d">{{ f.promedioVersiones }}</td><td class="d">{{ f.conReenvio }}</td><td class="d">{{ f.devoluciones }}</td><td class="d">{{ f.rechazos }}</td></tr>
                }</tbody>
              </table>
            </div>
          } @else { <p class="ra-nota">Aún no hay documentos cargados en este filtro.</p> }
        </section>
      </details>
    }
  `,
})
export class ReportesDocumentosComponent {
  protected readonly estado = inject(ReportesEstado);
  protected readonly dimensiones = DIMENSIONES_SALUD;
  protected readonly dimension = signal<DimensionSalud>('programa');
  protected readonly semanaCorta = semanaCorta;
  /** Orden de la tabla por tipo: la vista separa volumen (pendientes) de tasa (aprobación, corrección). */
  protected readonly ordenesTipo = [
    { id: 'aprobacion', texto: 'Menor % aprobación' }, { id: 'pendientes', texto: 'Más pendientes' }, { id: 'correccion', texto: 'Mayor % corrección' },
  ] as const;
  protected readonly ordenTipo = signal<'aprobacion' | 'pendientes' | 'correccion'>('aprobacion');
  protected readonly tipos = computed(() => {
    const filas = [...(this.estado.datos()?.porTipo ?? [])];
    const tasa = (n: number, d: number) => (d ? n / d : 0);
    const orden = this.ordenTipo();
    return filas.sort((a, b) => orden === 'pendientes' ? b.sin_cargar - a.sin_cargar
      : orden === 'correccion' ? tasa(b.correccion + b.rechazado, b.exigidos) - tasa(a.correccion + a.rechazado, a.exigidos)
        : tasa(a.aprobado, a.exigidos) - tasa(b.aprobado, b.exigidos));
  });
  protected readonly expedientes = computed(() => { const r = this.estado.datos(); return r ? partesGrafico(partes(CATEGORIAS_EXPEDIENTE, r.expedientes)) : []; });
  /** Correcciones por tipo: volumen = en corrección + rechazadas; tasa = esa cifra / exigidos del tipo (en %, un decimal). */
  protected readonly medidaCorr = signal<'volumen' | 'tasa'>('volumen');
  protected readonly correcciones = computed<ItemBarra[]>(() => {
    const tasa = this.medidaCorr() === 'tasa';
    return (this.estado.datos()?.porTipo ?? []).filter((t) => t.correccion + t.rechazado > 0).map((t) => {
      const n = t.correccion + t.rechazado;
      return { clave: t.tipo, texto: this.pipe.transform(t.tipo), n: tasa ? Math.round((n * 1000) / (t.exigidos || 1)) / 10 : n,
        detalle: tasa ? [`${n} de ${t.exigidos} exigidos`] : [`${pct1(n, t.exigidos)} de los ${t.exigidos} exigidos`] };
    }).sort((a, b) => b.n - a.n || a.texto.localeCompare(b.texto));
  });
  protected readonly tasaFmt = (n: number): string => `${n.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
  protected readonly semanas = computed(() => (this.estado.datos()?.semanas ?? []).map((w) => semanaCorta(w.semana)));
  protected readonly seriesSemanas = computed<SerieLinea[]>(() => {
    const w = this.estado.datos()?.semanas ?? [];
    return [
      { clave: 'cargas', texto: 'Cargas', valores: w.map((x) => x.cargas), tono: 'principal' },
      { clave: 'aprobaciones', texto: 'Aprobaciones', valores: w.map((x) => x.aprobaciones), tono: 'ok' },
      { clave: 'devoluciones', texto: 'Devoluciones', valores: w.map((x) => x.devoluciones + x.rechazos), tono: 'riesgo' },
    ];
  });
  /** Seis cifras de salud documental sobre las obligaciones exigidas (cargadas = vigentes; no se suman con aprobadas). */
  protected readonly resumen = computed<MetricaV3[]>(() => {
    const r = this.estado.datos();
    if (!r) return [];
    const o = r.documental, ex = r.resumen.exigidos;
    return [
      { n: ex, t: 'Exigidos', tono: 'neutra', contexto: 'obligaciones' },
      { n: r.resumen.cargados, t: 'Cargados vigentes', tono: 'info', contexto: `${pct1(r.resumen.cargados, ex)} · sin reenvío pendiente` },
      { n: o.aprobado, t: 'Aprobados', tono: 'ok', contexto: pct1(o.aprobado, ex) },
      { n: o.sin_cargar, t: 'Pendientes', tono: 'neutra', contexto: `sin cargar · ${pct1(o.sin_cargar, ex)}` },
      { n: o.en_revision + o.en_proceso, t: 'En revisión', tono: 'info', contexto: `o en análisis · ${pct1(o.en_revision + o.en_proceso, ex)}` },
      { n: o.correccion + o.rechazado, t: 'Corrección', tono: 'aviso', contexto: `o rechazo · ${pct1(o.correccion + o.rechazado, ex)}` },
    ];
  });
  protected readonly tasas = TASAS;
  protected readonly pct1 = pct1;
  protected readonly razon = razon;
  private readonly pipe = new EtiquetaPipe();
  private readonly filtroDe: Record<DimensionSalud, keyof FiltrosAnalitica> = {
    programa: 'programa', ciclo: 'ciclo', semestre: 'semestre', modalidad: 'modalidad', periodo: 'periodos', receptor: 'tipoReceptor', sector: 'sector', ciudad: 'ciudad',
  };
  /** Semestre solo con el overlay sintético de pruebas; en producción la opción no aparece. */
  protected readonly dimensionesVisibles = computed(() => DIMENSIONES_SALUD.filter((d) => d.id !== 'semestre' || this.estado.datos()?.dimensiones.semestre === 'sintetica'));

  protected readonly rotuloDimension = computed(() => DIMENSIONES_SALUD.find((d) => d.id === this.dimension())?.texto ?? '');
  protected readonly salud = computed<FilaSalud[]>(() => {
    const r = this.estado.datos();
    if (!r) return [];
    const filas: FilaSalud[] = this.dimension() === 'programa' ? r.programas.map((p) => ({ clave: p.programa, texto: p.nombre ?? p.programa, c: p }))
      : this.dimension() === 'ciclo' ? [...r.niveles].sort((a, b) => compararNiveles(a.ciclo, b.ciclo)).map((n) => ({ clave: n.ciclo, texto: nivel(n.ciclo), c: n }))
        : this.dimension() === 'semestre' ? r.semestres.map((s) => ({ clave: s.semestre === null ? '' : String(s.semestre), texto: semestre(s.semestre), c: s }))
          : this.dimension() === 'receptor' ? r.receptores.filter((x) => x.tipo).map((x) => ({ clave: x.tipo as string, texto: RECEPTORES[x.tipo as TipoReceptor], c: x }))
          : this.dimension() === 'sector' ? r.sectores.map((x) => ({ clave: x.sector ?? SIN_DATO, texto: x.nombre ?? 'Sin información', c: x }))
          : this.dimension() === 'ciudad' ? r.ciudades.map((x) => ({ clave: x.ciudad ?? SIN_DATO, texto: x.nombre ?? 'Sin municipio registrado', c: x }))
          : this.dimension() === 'modalidad' ? r.modalidades.map((m) => ({ clave: m.modalidad, texto: this.pipe.transform(m.modalidad), c: m }))
            : [...r.periodos].sort((a, b) => segunOrden(r.ordenPeriodos)(a.periodo, b.periodo)).map((p) => ({ clave: p.periodo, texto: p.periodo, c: p }));
    if (['periodo', 'ciclo', 'semestre', 'receptor'].includes(this.dimension())) return filas;
    const tasa = (f: FilaSalud) => (f.c.exigidos ? f.c.aprobados / f.c.exigidos : 2);
    return filas.sort((a, b) => tasa(a) - tasa(b) || b.c.estudiantes - a.c.estudiantes);
  });

  protected activo(clave: string): boolean {
    const f = this.estado.filtros();
    return this.dimension() === 'periodo' ? f.periodos.length === 1 && f.periodos[0] === clave : f[this.filtroDe[this.dimension()]] === clave;
  }

  protected filtrar(clave: string): void {
    const d = this.dimension();
    if (d === 'semestre' && clave === '') return;
    if (d === 'periodo') this.estado.filtrar({ periodos: this.activo(clave) ? [] : [clave] });
    else this.estado.alternar(this.filtroDe[d] as 'programa' | 'ciclo' | 'semestre' | 'modalidad' | 'tipoReceptor' | 'sector' | 'ciudad', clave as never);
  }
  protected readonly categorias = CATEGORIAS_OBLIGACION;
  protected readonly horas = horas;
  protected readonly total = computed(() => { const r = this.estado.datos(); return r ? partesGrafico(partes(CATEGORIAS_OBLIGACION, r.documental)) : []; });
  protected situacion(s: string): void { this.estado.alternar('situacion', s as SituacionExpediente); }
  protected readonly num = num;
  protected readonly lecturas = computed(() => {
    const r = this.estado.datos(), t = (v: string) => this.pipe.transform(v);
    return r ? insights.documentos(r, { programa: this.estado.nombrePrograma, modalidad: t, tipo: t, escuela: this.estado.nombreEscuela }) : [];
  });
  protected readonly etiquetaTipo = (v: string): string => this.pipe.transform(v);
  /** Estados en su orden de lectura (de resuelto a no iniciado), con los textos del resto del reporte. */
  protected readonly ordenEstados = CATEGORIAS_OBLIGACION.map((c) => c.clave as string);
  protected readonly textoEstado = (v: string): string => CATEGORIAS_OBLIGACION.find((c) => c.clave === v)?.texto ?? v;
  protected readonly cortoEstado = (v: string): string => ({ aprobado: 'Aprob.', en_revision: 'Revisión', en_proceso: 'Análisis', correccion: 'Correc.', rechazado: 'Rech.', sin_cargar: 'Sin cargar' })[v] ?? v;
  protected readonly celdasEstado = computed(() => (this.estado.datos()?.porTipo ?? []).flatMap((t) => this.ordenEstados
    .map((k) => ({ fila: t.tipo, columna: k, estudiantes: t[k as keyof typeof t] as number, practicas: t[k as keyof typeof t] as number })).filter((c) => c.estudiantes > 0)));
  protected abrirCelda(c: { fila: string; columna: string }): void {
    void this.estado.abrirDetalle({ tipo: c.fila, estadoDocumental: c.columna as 'aprobado' });
  }
  /** Enjambre: puntos de la muestra del servidor; grupos = 8 mayores (por tipo, medianas del servidor sobre TODAS las decisiones). */
  protected readonly grupoSwarm = signal<'tipo' | 'programa'>('tipo');
  protected readonly swarm = computed<{ puntos: PuntoSwarm[]; grupos: GrupoSwarm[] }>(() => {
    const r = this.estado.datos();
    if (!r) return { puntos: [], grupos: [] };
    const porTipo = this.grupoSwarm() === 'tipo';
    const clave = (m: { tipo: string; programa: string }) => (porTipo ? m.tipo : m.programa);
    const cuenta = new Map<string, number[]>();
    for (const m of r.tiempos.muestras) { const v = cuenta.get(clave(m)) ?? []; v.push(m.horas); cuenta.set(clave(m), v); }
    const top = [...cuenta.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, 8);
    const grupos: GrupoSwarm[] = top.map(([k, hs]) => {
      const servidor = porTipo ? r.tiempos.porTipo.find((t) => t.tipo === k) : undefined;
      return { clave: k, texto: porTipo ? this.pipe.transform(k) : this.estado.nombrePrograma(k), n: servidor?.decisiones ?? hs.length, mediana: servidor ? servidor.medianaHoras : mediana(hs) };
    });
    const visibles = new Set(top.map(([k]) => k));
    const puntos = r.tiempos.muestras.filter((m) => visibles.has(clave(m)))
      .map((m) => ({ grupo: clave(m), horas: m.horas, detalle: porTipo ? this.estado.nombrePrograma(m.programa) : this.pipe.transform(m.tipo) }));
    return { puntos, grupos };
  });
  /** La barra abre (o cierra, si ya está abierto) el recorte «en corrección» de ese tipo en la tabla granular. */
  protected abrirCorrecciones(tipo: string): void {
    const s = this.estado.segmento();
    void this.estado.abrirDetalle(s?.tipo === tipo && s.estadoDocumental === 'correccion' ? {} : { tipo, estadoDocumental: 'correccion' });
  }
}

/** Mediana simple (para agrupar por programa sobre la muestra; por tipo se usa la mediana del servidor). */
function mediana(v: readonly number[]): number | null {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil(0.5 * o.length) - 1)];
}
