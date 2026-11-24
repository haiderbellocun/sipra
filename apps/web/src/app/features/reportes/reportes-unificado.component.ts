import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MetricaV3 } from '@shared/components/tira-metricas.component';
import { EsqueletoComponent } from '@shared/components/esqueleto.component';
import { EstadoVacioComponent } from '@shared/components/estado-vacio.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { ItemBarra } from './reportes-analitica.util';
import { ReportesBarrasComponent } from './reportes-barras.component';
import { ReportesBumpComponent } from './reportes-bump.component';
import { ReportesComposicionComponent } from './reportes-composicion.component';
import { ReportesDonaComponent } from './reportes-dona.component';
import {
  CLAVE_ORG_SIN_CORRESPONDENCIA, DimensionFuente, FiltrosFuente, ReporteFuentes, avisosFuente, barrasDimension, lecturaSolape, pctRatio,
  rangos, rotuloFuente,
} from './reportes-fuentes.util';
import { num } from './reportes-graficos.util';
import { ReportesGruposComponent } from './reportes-grupos.component';
import { ReportesInsightsComponent } from './reportes-insights.component';
import { ReportesKpisComponent } from './reportes-kpis.component';
import { ReportesLineasComponent, SerieLinea } from './reportes-lineas.component';
import { ReportesNoDisponibleComponent } from './reportes-no-disponible.component';
import {
  ACENTOS_FUENTE, GRUPOS_FUENTE, categoriasEstado, celdasCruce, comparacionAB, ejePeriodos, gruposAB, lecturasFuente, lecturasOrganizacionesFuente,
  metricasFuenteV3, metricasOrganizacionesFuente, partesNivel, periodosCronologicos, rotulador, seriesPeriodo, seriesProgramas,
} from './reportes-paridad.util';
import { VISTAS_PERIODOS, VistaPeriodos } from './reportes-periodos.component';
import { ReportesStreamComponent } from './reportes-stream.component';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

export type VistaFuente = 'general' | 'organizaciones' | 'periodos';

/** Cifras de la tira por fuente (las mismas seis cifras agrupadas en todas las fuentes). */
export function metricasFuente(r: ReporteFuentes): MetricaV3[] {
  return metricasFuenteV3(r);
}

/** Filtro que aplica cada dimensión al elegir una categoría (la agrupación de organizaciones sin correspondencia no filtra). */
const FILTRO_DE: Partial<Record<DimensionFuente, Exclude<keyof FiltrosFuente, 'periodos'>>> = {
  programa: 'programa', nivel: 'nivel', regional: 'regional', modalidadEstudio: 'modalidadEstudio', modalidadPractica: 'modalidadPractica',
  estado: 'estado', organizacion: 'organizacion', ciudad: 'ciudad',
};

/** Máximo de programas en la evolución (igual que Actual). */
const MAX_LINEAS = 5;

/**
 * Reportes V3 en Histórico o Todos (H5 + §32 paridad visual). Misma estructura, rejilla, títulos y gráficas que la vista
 * Actual de cada pestaña; cambia el dato, no el diseño. La medida de los cruces es «prácticas». Lo que solo existe en el
 * expediente de SIPRA se declara no disponible en su mismo lugar. El indicador documental del SGP va aparte y nunca se
 * presenta como Cumplimiento.
 */
@Component({
  selector: 'sipra-reportes-unificado',
  standalone: true,
  imports: [
    ReportesKpisComponent, ReportesInsightsComponent, ReportesComposicionComponent, ReportesBarrasComponent, ReportesDonaComponent, ReportesLineasComponent,
    ReportesBumpComponent, ReportesStreamComponent, ReportesGruposComponent, ReportesNoDisponibleComponent, EsqueletoComponent, EstadoVacioComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .tira { margin: 0 0 10px; }
    .cob { display: flex; flex-wrap: wrap; gap: 6px 20px; align-items: center; margin: 0 0 12px; font: 500 12px/16px var(--fuente-mono); color: var(--text-secondary); }
    .cob b { font-family: var(--fuente); font-weight: 600; color: var(--text-primary); white-space: nowrap; }
    .ayuda-tip { position: relative; display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .ayuda-tip button { display: inline-grid; place-items: center; width: 20px; height: 20px; padding: 0; font: 600 11px/1 var(--fuente); color: var(--text-secondary);
      background: none; border: 1px solid var(--border-default); border-radius: 50%; cursor: help; }
    .ayuda-tip button:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 2px; }
    .ayuda-tip [role='tooltip'] { position: absolute; z-index: 5; top: calc(100% + 6px); left: 0; width: min(320px, 80vw); padding: 8px 10px; font: 400 12px/18px var(--fuente);
      color: var(--text-primary); background: var(--surface-raised, var(--superficie-2)); border: 1px solid var(--border-default); border-radius: 6px; visibility: hidden; opacity: 0; }
    .ayuda-tip:hover [role='tooltip'], .ayuda-tip:focus-within [role='tooltip'] { visibility: visible; opacity: 1; }
    .avisos { display: grid; gap: 4px; margin: 0 0 16px; padding: 8px 12px; list-style: none; font-size: 12px; line-height: 18px; color: var(--text-secondary);
      border-left: 2px solid var(--ra-aviso); background: color-mix(in srgb, var(--ra-aviso) 6%, transparent); }
    .union { margin: 0 0 24px; }
    .union-barra { display: flex; gap: 1px; height: 6px; border-radius: 3px; overflow: hidden; margin: 6px 0 8px; }
    .union-barra span { background: var(--c); }
    .union dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap: 8px 20px; margin: 0; }
    .union dt { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
    .union dt i { width: 7px; height: 7px; border-radius: 50%; background: var(--c); }
    .union dd { margin: 2px 0 0; font: 600 16px/20px var(--fuente-mono); color: var(--text-primary); }
    .union dd small { display: block; font: 400 12px/16px var(--fuente); color: var(--text-secondary); }
    .doc { display: grid; gap: 10px; margin: 8px 0 0; }
    .doc div { display: grid; gap: 2px; }
    .doc span { font-size: 12px; color: var(--text-secondary); }
    .doc b { font: 600 22px/28px var(--fuente-mono); color: var(--text-primary); }
    .error { display: grid; justify-items: start; gap: 10px; padding: 24px 0; }
    .error strong { font-size: 15px; color: var(--text-primary); }
    .error span { font-size: 13px; color: var(--text-secondary); }
    .bt { height: 34px; padding: 0 12px; font: 500 13px/1 var(--fuente); color: var(--text-primary); background: transparent; border: 1px solid var(--border-default); border-radius: 6px; cursor: pointer; }
    .bt:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 2px; }
    .rejilla-esq { display: grid; gap: 16px; }
    .alto-s sipra-reportes-no-disponible { --nd-alto: 190px; }
    .alto-l sipra-reportes-no-disponible { --nd-alto: 320px; }
    /* Organizaciones: misma rejilla que Actual. */
    .o-f1 { display: grid; gap: 24px 28px; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); align-items: start; }
    .o-f2 { display: grid; gap: 24px 28px; grid-template-columns: minmax(0, 11fr) minmax(0, 9fr); align-items: start; margin-top: 24px; }
    .o-f3 { margin-top: 24px; }
    .o-emp { --barras-y: clamp(11rem, 44%, 17rem); }
    .sub { margin: 22px 0 8px; font: 600 13px/18px var(--fuente); color: var(--text-primary); }
    /* Períodos: mismos controles que Actual. */
    .ancho { grid-column: 1 / -1; }
    .elegir { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 0 0 12px; font-size: 13px; color: var(--text-secondary); }
    .elegir select { height: 32px; padding: 0 8px; font: inherit; color: var(--text-primary); background: var(--vd-campo, color-mix(in srgb, var(--surface-raised) 70%, transparent)); border: 1px solid var(--border-default); border-radius: 6px; }
    .elegir select:focus-visible, .chk-p input:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .chk-p { display: inline-flex; gap: 6px; align-items: center; color: var(--text-primary); }
    .marco-l { margin: 4px 0 12px; }
    .elegir-p { margin: 0 0 10px; font-size: 13px; }
    .elegir-p summary { cursor: pointer; color: var(--text-secondary); width: max-content; }
    .ab { display: grid; gap: 24px 32px; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); align-items: start; }
    .ab td.sube { color: var(--gr-ok); } .ab td.baja { color: var(--gr-riesgo); } .ab td.nd { color: var(--text-muted); font-size: 12px; }
    .sub-ab { margin: 0 0 8px; font: 600 13px/18px var(--fuente); color: var(--text-primary); }
    .dims { display: inline-flex; gap: 2px; margin: 4px 0 12px; padding: 2px; border: 1px solid var(--border-default); border-radius: 7px; }
    .dims button { height: 30px; padding: 0 14px; font: 500 13px/1 var(--fuente); color: var(--text-secondary); background: none; border: 0; border-radius: 5px; cursor: pointer; }
    .dims button[aria-pressed='true'] { color: var(--text-primary); background: color-mix(in srgb, var(--bi-blue) 18%, transparent); font-weight: 650; }
    .dims button:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    details { margin-top: 12px; font-size: 13px; }
    summary { cursor: pointer; color: var(--text-secondary); width: max-content; }
    summary:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 2px; }
    @media (width < 1100px) { .o-f1, .o-f2, .ab { grid-template-columns: 1fr; } }
    @media (width < 700px) { .dims { display: flex; flex-wrap: wrap; } }
  `],
  template: `
    @if (estado.errorFuente() && !estado.datosFuente()) {
      <div class="error" role="alert">
        <strong>No fue posible calcular el reporte {{ rotulo() }}</strong>
        <span>{{ estado.errorFuente() }}</span>
        <button type="button" class="bt" (click)="estado.cargarFuente()">Reintentar</button>
      </div>
    } @else if (!estado.datosFuente()) {
      <!-- Esqueleto con la misma rejilla del reporte: cambiar de fuente no reacomoda la página. -->
      <div class="rejilla-esq" aria-busy="true">
        <sipra-esqueleto tipo="cifras" [cantidad]="6" />
        <div class="ra-g12"><div class="c7 alto-l"><sipra-esqueleto tipo="bloque" /></div><div class="c5 alto-l"><sipra-esqueleto tipo="filas" [cantidad]="6" /></div></div>
      </div>
    } @else if (estado.datosFuente(); as r) {
      <p class="cob">
        @for (g of rangos(); track g.fuente) {
          <span class="ayuda-tip"><b>{{ g.fuente }}</b> {{ g.texto }}
            <button type="button" [attr.aria-label]="'Qué significa la fecha de ' + g.fuente" [attr.aria-describedby]="'tip-' + g.fuente">i</button>
            <span role="tooltip" [id]="'tip-' + g.fuente">{{ g.ayuda }}</span></span>
        }
      </p>
      @if (avisos().length) {
        <ul class="avisos" aria-label="Notas de cobertura">@for (a of avisos(); track a) { <li>{{ a }}</li> }</ul>
      }
      @if (r.totales.practicas === 0) {
        @if (estado.activosFuente()) {
          <sipra-estado-vacio titulo="Sin prácticas para estos filtros" texto="Ningún registro de la fuente elegida cumple la combinación.">
            <button type="button" class="bt" (click)="estado.limpiarFuente()">Limpiar filtros</button>
          </sipra-estado-vacio>
        } @else if (r.cobertura.historicoFueraDeAlcance > 0) {
          <sipra-estado-vacio titulo="El histórico aún no se puede atribuir a su alcance"
            texto="Los registros del SGP no traen escuela; aparecerán aquí cuando sus programas tengan equivalencia confirmada con SINU." />
        } @else {
          <sipra-estado-vacio titulo="Sin registros en esta fuente" texto="No hay prácticas para mostrar en su alcance." />
        }
      } @else {
        @switch (vista()) {
          @case ('general') {
            <sipra-reportes-kpis class="tira" [etiqueta]="(estado.activosFuente() ? 'Resumen del universo filtrado · ' : 'Resumen · ') + rotulo()" [metricas]="metricas()" [acentos]="acentos" [grupos]="grupos" />
            @if (union().length) {
              <section class="union" aria-labelledby="u-t">
                <h2 id="u-t" class="ra-sr">Cómo se unieron las fuentes</h2>
                <div class="union-barra" aria-hidden="true">@for (u of union(); track u.clave) { <span [class]="'gt-' + tonoUnion[u.clave]" [style.flex-grow]="u.n"></span> }</div>
                <dl>@for (u of union(); track u.clave) {
                  <div><dt [class]="'gt-' + tonoUnion[u.clave]"><i aria-hidden="true"></i>{{ u.texto }}</dt><dd>{{ num(u.n) }}<small>{{ u.ayuda }}</small></dd></div>
                }</dl>
              </section>
            }
            <sipra-reportes-insights [lineas]="lecturas()" />

            <div class="ra-g12">
              <section class="ra-bloque ra-zona zona-academica c7 alto-l" aria-labelledby="u-op">
                <h2 id="u-op">Composición por modalidad y estado</h2>
                <p class="ra-nota">Cada barra es una modalidad; su largo es el número de prácticas y los colores, el estado de la práctica.@if (r.fuente !== 'current') { En el histórico, estado a la fecha de corte; empresa propia es una categoría del SGP. }</p>
                <sipra-reportes-composicion titulo="Prácticas por modalidad y estado" [celdas]="celdasModalidadEstado()" [categorias]="estados" [textoFila]="textoModalidad()"
                  rotuloColumnas="estado de la práctica" [seleccionFila]="f().modalidadPractica" [seleccionColumna]="f().estado"
                  (elegirFila)="filtrar('modalidadPractica', $event)" (elegirColumna)="filtrar('estado', $event)" />
              </section>
              <section class="ra-bloque ra-zona zona-academica c5 alto-l" aria-labelledby="u-prog">
                <h2 id="u-prog">Prácticas por programa</h2>
                <p class="ra-nota">Top 8 de {{ barras('programa').length }} · prácticas. Los programas del SGP sin equivalencia confirmada conservan su nombre de origen.</p>
                <sipra-reportes-barras titulo="Prácticas por programa" [items]="barras('programa')" [total]="r.totales.practicas" ejeX="Prácticas" unidad="prácticas" [seleccion]="f().programa" [limite]="8" (elegir)="filtrar('programa', $event)" />
              </section>
            </div>

            <div class="ra-g12">
              <section class="ra-bloque ra-zona zona-academica c4 alto-s" aria-labelledby="u-niv">
                <h2 id="u-niv">Nivel de formación</h2>
                <p class="ra-nota">Ciclo de la práctica.</p>
                <sipra-reportes-dona titulo="Prácticas por nivel de formación" [partes]="niveles()" unidad="prácticas" centro="prácticas" [seleccion]="f().nivel" (elegir)="filtrar('nivel', $event)" />
              </section>
              <section class="ra-bloque ra-zona zona-doc c4 alto-s" aria-labelledby="u-doc">
                <h2 id="u-doc">Documentación</h2>
                @if (r.indicadorDocumentalSgp; as d) {
                  <p class="ra-nota">Indicador documental SGP: promedio de documentos subidos y aprobados según el SGP. No es Cumplimiento ni se compara con el expediente de SIPRA.</p>
                  <div class="doc">
                    <div><span>Subidos (promedio)</span><b>{{ pctRatio(d.subidoPromedio) }}</b></div>
                    <div><span>Aprobados (promedio)</span><b>{{ pctRatio(d.aprobadoPromedio) }}</b></div>
                    <div><span>Registros con dato</span><b>{{ num(d.casos) }}</b></div>
                  </div>
                } @else {
                  <sipra-reportes-no-disponible motivo="El análisis documental se basa en el expediente de SIPRA; está en Actual, pestaña Documentos." />
                }
              </section>
              <section class="ra-bloque ra-zona zona-org c4 alto-s" aria-labelledby="u-rec">
                <h2 id="u-rec">Interna CUN y externa</h2>
                <sipra-reportes-no-disponible motivo="El SGP no registra el tipo de organización receptora. En Actual se muestra con su proporción." />
              </section>
            </div>
          }

          @case ('organizaciones') {
            <sipra-reportes-kpis class="tira" etiqueta="Organizaciones receptoras del filtro" [metricas]="metricasOrg()" [acentos]="acentos" />
            <sipra-reportes-insights class="zona-org" [lineas]="lecturasOrg()" />
            <div class="o-f1">
              <section class="ra-bloque ra-zona zona-org" aria-labelledby="u-pack">
                <h2 id="u-pack">Sectores y organizaciones</h2>
                <sipra-reportes-no-disponible motivo="El sector económico (sección CIIU) es un dato de las empresas registradas en SIPRA; el SGP no lo tiene." />
              </section>
              <section class="ra-bloque ra-zona zona-org o-emp" aria-labelledby="u-emp">
                <h2 id="u-emp">Organizaciones receptoras</h2>
                <p class="ra-nota">Top 10 de {{ barras('organizacion').length }}. Las organizaciones del SGP sin correspondencia confirmada se agrupan en una barra; no se infiere su equivalencia.</p>
                <sipra-reportes-barras titulo="Prácticas por organización" [items]="barras('organizacion')" [total]="r.totales.practicas" ejeX="Prácticas" unidad="prácticas" tono="c1" [limite]="10" [seleccion]="f().organizacion" (elegir)="filtrar('organizacion', $event)" />
              </section>
            </div>
            <section class="ra-bloque ra-zona zona-org o-f3" aria-labelledby="u-cruce">
              <h2 id="u-cruce">Programa × sector</h2>
              <sipra-reportes-no-disponible motivo="Requiere el sector económico de la organización, que el SGP no registra." />
            </section>
            <div class="o-f2">
              <section class="ra-bloque ra-zona zona-org" aria-labelledby="u-ciu">
                <h2 id="u-ciu">Prácticas por ciudad</h2>
                <p class="ra-nota">Ciudad del escenario de práctica: municipio DIVIPOLA en SIPRA; texto de origen en el SGP (los valores con datos personales se anularon al importar).</p>
                <sipra-reportes-barras titulo="Prácticas por ciudad" [items]="barras('ciudad')" [total]="r.totales.practicas" ejeX="Prácticas" unidad="prácticas" tono="c8" [limite]="10" [seleccion]="f().ciudad" (elegir)="filtrar('ciudad', $event)" />
              </section>
              <section class="ra-bloque ra-zona zona-org" aria-labelledby="u-rec2">
                <h2 id="u-rec2">Interna CUN y externa</h2>
                <sipra-reportes-no-disponible motivo="El SGP no registra el tipo de organización receptora." />
                <h3 class="sub">Sectores</h3>
                <sipra-reportes-no-disponible motivo="El SGP no registra el sector económico." />
              </section>
            </div>
            <div class="o-f2">
              <section class="ra-bloque ra-zona zona-org" aria-labelledby="u-reg">
                <h2 id="u-reg">Prácticas por regional</h2>
                <sipra-reportes-barras titulo="Prácticas por regional" [items]="barras('regional')" [total]="r.totales.practicas" ejeX="Prácticas" unidad="prácticas" tono="c8" [limite]="10" [seleccion]="f().regional" (elegir)="filtrar('regional', $event)" />
              </section>
              <section class="ra-bloque ra-zona zona-org" aria-labelledby="u-mes">
                <h2 id="u-mes">Modalidad de estudio</h2>
                <sipra-reportes-barras titulo="Prácticas por modalidad de estudio" [items]="barras('modalidadEstudio')" [total]="r.totales.practicas" ejeX="Prácticas" unidad="prácticas" tono="c1" [limite]="6" [seleccion]="f().modalidadEstudio" (elegir)="filtrar('modalidadEstudio', $event)" />
              </section>
            </div>
          }

          @case ('periodos') {
            <sipra-reportes-insights class="zona-tiempo" [lineas]="lecturas()" />
            <div class="ra-rejilla">
              <section class="ra-bloque ancho ra-zona zona-tiempo" aria-labelledby="u-comp">
                <h2 id="u-comp">Comparación de periodos</h2>
                <p class="ra-nota">Prácticas por periodo en orden académico@if (r.fuente === 'all') {, Actual e Histórico como series del mismo eje}; el periodo del eje filtra el reporte. La cobertura y la aprobación documental de Actual no están disponibles para información histórica.</p>
                @if (eje().length > 1) {
                  <div class="marco-l">
                    <sipra-reportes-lineas titulo="Prácticas por periodo" [categorias]="eje()" [series]="seriesPeriodo()" unidad="prácticas" [filtrable]="true" [seleccionX]="unico()" (elegirX)="fijar($event)" />
                  </div>
                }
                <details>
                  <summary>Ver prácticas por periodo</summary>
                  <div class="ra-desliza">
                    <table class="ra-tabla" style="margin-top:8px">
                      <caption class="ra-sr">Prácticas por periodo y fuente</caption>
                      <thead><tr><th scope="col">Periodo</th>@if (r.fuente === 'all') { <th scope="col" class="d">Actual</th><th scope="col" class="d">Histórico</th> }<th scope="col" class="d">Prácticas</th></tr></thead>
                      <tbody>
                        @for (p of tablaPeriodos(); track p.clave) {
                          <tr>
                            <th scope="row" class="ra-num"><button type="button" class="ra-ir" [attr.aria-pressed]="unico() === p.clave" (click)="fijar(p.clave)">{{ p.etiqueta }}</button></th>
                            @if (r.fuente === 'all') { <td class="d">{{ num(p.current) }}</td><td class="d">{{ num(p.historical) }}</td> }
                            <td class="d">{{ num(p.current + p.historical) }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>

              @if (eje().length > 1) {
                <section class="ra-bloque ancho ra-zona zona-academica" aria-labelledby="u-vista">
                  <h2 id="u-vista">{{ tituloVista() }}</h2>
                  <div class="dims" role="tablist" aria-label="Análisis entre periodos">
                    @for (v of vistas; track v.id) {
                      <button type="button" role="tab" [attr.aria-selected]="vistaP() === v.id" [attr.aria-pressed]="vistaP() === v.id" (click)="vistaP.set(v.id)">{{ textoVista(v.id, v.texto) }}</button>
                    }
                  </div>
                  @switch (vistaP()) {
                    @case ('volumen') {
                      <p class="ra-nota">Prácticas de cada programa por periodo, en orden académico. Empieza con los 5 programas de más prácticas; cambie la selección (hasta 5).</p>
                      <details class="elegir-p">
                        <summary>Programas: {{ lineasProgramas().length }} de {{ seriesRanking().length }} · elegir</summary>
                        <div class="elegir">
                          @for (s of programasPorVolumen(); track s.clave) {
                            <label class="chk-p"><input type="checkbox" [checked]="lineasProgramas().includes(s.clave)" [disabled]="!lineasProgramas().includes(s.clave) && lineasProgramas().length >= 5" (change)="alternarLinea(s.clave)" />{{ s.texto }}</label>
                          }
                        </div>
                      </details>
                      <sipra-reportes-lineas titulo="Prácticas por programa y periodo" [categorias]="eje()" [series]="seriesLineas()" unidad="prácticas" [filtrable]="true" [seleccionX]="unico()" (elegirX)="fijar($event)" />
                    }
                    @case ('ranking') {
                      <p class="ra-nota">Análisis secundario: puesto de cada programa en cada periodo, donde <strong>1 = el programa con más prácticas</strong>. La distancia entre líneas NO es volumen.</p>
                      <sipra-reportes-bump titulo="Ranking de programas por periodo" [categorias]="eje()" [series]="seriesRanking()" unidad="prácticas" />
                    }
                    @case ('composicion') {
                      <p class="ra-nota">Cómo se reparte el periodo entre modalidades: el grosor de cada banda es su número de prácticas. Cinco modalidades con color y «Otras».</p>
                      <sipra-reportes-stream titulo="Prácticas por modalidad y periodo" [categorias]="eje()" [celdas]="celdasPeriodoModalidad()" [texto]="textoModalidadPeriodo()" unidad="prácticas" />
                    }
                    @case ('ab') {
                      <p class="ra-nota">Periodo A frente a periodo B. Mismas definiciones en ambos lados; la diferencia es B − A.</p>
                      <div class="elegir">
                        <label>A <select [value]="a()" (change)="aSel.set(valor($event))">@for (p of eje(); track p) { <option [value]="p" [selected]="p === a()">{{ p }}</option> }</select></label>
                        <label>B <select [value]="b()" (change)="bSel.set(valor($event))">@for (p of eje(); track p) { <option [value]="p" [selected]="p === b()">{{ p }}</option> }</select></label>
                      </div>
                      <div class="ab">
                        <table class="ra-tabla">
                          <caption class="ra-sr">Comparación entre {{ a() }} y {{ b() }}</caption>
                          <thead><tr><th scope="col">Métrica</th><th scope="col" class="d">{{ a() }}</th><th scope="col" class="d">{{ b() }}</th><th scope="col" class="d">Diferencia</th></tr></thead>
                          <tbody>
                            @for (m of comparacion(); track m.texto) {
                              <tr><th scope="row" [title]="m.definicion">{{ m.texto }}</th><td class="d">{{ m.va }}</td><td class="d">{{ m.vb }}</td>
                                @if (m.delta === null) { <td class="d nd">{{ m.deltaTexto }}</td> } @else {
                                  <td class="d" [class.sube]="m.delta > 0" [class.baja]="m.delta < 0">{{ m.delta > 0 ? '+' : '' }}{{ m.deltaTexto }}</td>
                                }</tr>
                            }
                          </tbody>
                        </table>
                        <div>
                          <h3 class="sub-ab">Prácticas por programa: {{ a() }} frente a {{ b() }}</h3>
                          <sipra-reportes-grupos [titulo]="'Prácticas por programa en ' + a() + ' y ' + b()" [grupos]="grupos_ab()" [rotuloA]="'A · ' + a()" [rotuloB]="'B · ' + b()"
                            unidad="prácticas" ejeX="Prácticas" [seleccion]="f().programa" (elegir)="filtrar('programa', $event)" />
                        </div>
                      </div>
                    }
                  }
                </section>
              }
            </div>
          }
        }
      }
    }
  `,
})
export class ReportesUnificadoComponent {
  readonly vista = input.required<VistaFuente>();
  protected readonly estado = inject(ReportesEstado);
  protected readonly f = this.estado.filtrosFuente;
  protected readonly num = num;
  protected readonly pctRatio = pctRatio;
  protected readonly acentos = ACENTOS_FUENTE;
  protected readonly grupos = GRUPOS_FUENTE;
  protected readonly estados = categoriasEstado();
  protected readonly rotulo = computed(() => rotuloFuente(this.estado.fuente()));
  protected readonly tonoUnion: Record<string, string> = { current_only: 'principal', historical_only: 'comparacion', matched: 'ok', candidate_overlap: 'aviso', ambiguous_overlap: 'muted' };

  private readonly r = this.estado.datosFuente;
  private readonly etiqueta = new EtiquetaPipe();
  private readonly rotular = (codigo: string): string => this.etiqueta.transform(codigo);

  protected readonly metricas = computed(() => { const r = this.r(); return r ? metricasFuenteV3(r) : []; });
  protected readonly metricasOrg = computed(() => { const r = this.r(); return r ? metricasOrganizacionesFuente(r) : []; });
  protected readonly lecturas = computed(() => { const r = this.r(); return r ? lecturasFuente(r, this.rotular) : []; });
  protected readonly lecturasOrg = computed(() => { const r = this.r(); return r ? lecturasOrganizacionesFuente(r) : []; });
  protected readonly rangos = computed(() => { const r = this.r(); return r ? rangos(r) : []; });
  protected readonly avisos = computed(() => { const r = this.r(); return r ? avisosFuente(r) : []; });
  protected readonly union = computed(() => { const r = this.r(); return r ? lecturaSolape(r) : []; });
  protected readonly niveles = computed(() => { const r = this.r(); return r ? partesNivel(r) : []; });
  protected readonly celdasModalidadEstado = computed(() => { const r = this.r(); return r ? celdasCruce(r, 'modalidadEstado') : []; });
  protected readonly celdasPeriodoModalidad = computed(() => { const r = this.r(); return r ? celdasCruce(r, 'periodoModalidad') : []; });
  protected readonly textoModalidad = computed(() => { const r = this.r(); return r ? rotulador(r, 'modalidadEstado', 'fila', this.rotular) : (v: string) => v; });
  protected readonly textoModalidadPeriodo = computed(() => { const r = this.r(); return r ? rotulador(r, 'periodoModalidad', 'columna', this.rotular) : (v: string) => v; });

  // ── Períodos (mismas vistas y controles que Actual) ──
  protected readonly vistas = VISTAS_PERIODOS;
  protected readonly vistaP = signal<VistaPeriodos>('volumen');
  protected readonly tituloVista = computed(() => ({ volumen: 'Prácticas por programa entre periodos', composicion: 'Composición por modalidad', ranking: 'Movimiento en ranking', ab: 'Periodo A frente a periodo B' })[this.vistaP()]);
  protected textoVista(id: VistaPeriodos, texto: string): string { return id === 'volumen' ? 'Prácticas por programa' : texto; }
  protected readonly eje = computed(() => { const r = this.r(); return r ? ejePeriodos(r) : []; });
  protected readonly tablaPeriodos = computed(() => { const r = this.r(); return r ? periodosCronologicos(r) : []; });
  protected readonly seriesPeriodo = computed<SerieLinea[]>(() => { const r = this.r(); return r ? seriesPeriodo(r) : []; });
  protected readonly seriesRanking = computed(() => { const r = this.r(); return r ? seriesProgramas(r) : []; });
  protected readonly programasPorVolumen = computed(() => [...this.seriesRanking()].sort((a, b) => sumar(b.valores) - sumar(a.valores) || a.texto.localeCompare(b.texto)));
  private readonly eleccionLineas = signal<string[] | null>(null);
  protected readonly lineasProgramas = computed(() => (this.eleccionLineas() ?? this.programasPorVolumen().slice(0, MAX_LINEAS).map((s) => s.clave)).filter((k) => this.seriesRanking().some((s) => s.clave === k)));
  protected readonly seriesLineas = computed<SerieLinea[]>(() => this.lineasProgramas().map((k) => this.seriesRanking().find((s) => s.clave === k)!).map((s) => ({ clave: s.clave, texto: s.texto, valores: s.valores })));
  protected alternarLinea(k: string): void {
    const v = this.lineasProgramas();
    this.eleccionLineas.set(v.includes(k) ? v.filter((x) => x !== k) : [...v, k].slice(0, MAX_LINEAS));
  }
  protected readonly aSel = signal('');
  protected readonly bSel = signal('');
  protected readonly a = computed(() => (this.eje().includes(this.aSel()) ? this.aSel() : this.eje().at(-2) ?? ''));
  protected readonly b = computed(() => (this.eje().includes(this.bSel()) ? this.bSel() : this.eje().at(-1) ?? ''));
  protected readonly comparacion = computed(() => { const r = this.r(); return r ? comparacionAB(r, this.a(), this.b()) : []; });
  protected readonly grupos_ab = computed(() => { const r = this.r(); return r ? gruposAB(r, this.a(), this.b()) : []; });
  protected readonly unico = computed(() => (this.f().periodos.length === 1 ? this.f().periodos[0] : ''));
  protected fijar(periodo: string): void { this.estado.filtrarFuente({ periodos: this.unico() === periodo ? [] : [periodo] }); }
  protected valor(e: Event): string { return (e.target as HTMLSelectElement).value; }

  protected barras(d: DimensionFuente): ItemBarra[] { const r = this.r(); return r ? barrasDimension(r, d, this.rotular) : []; }

  protected filtrar(d: DimensionFuente, clave: string): void {
    const k = FILTRO_DE[d];
    if (!k || clave === CLAVE_ORG_SIN_CORRESPONDENCIA) return;
    this.estado.alternarFuente(k, clave as never);
  }
}

function sumar(v: readonly number[]): number { return v.reduce((a, b) => a + b, 0); }
