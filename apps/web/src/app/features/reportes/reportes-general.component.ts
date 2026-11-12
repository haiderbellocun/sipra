import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { MetricaV3 } from '@shared/components/tira-metricas.component';
import { ReportesBarrasComponent } from './reportes-barras.component';
import { ReportesColumnasComponent } from './reportes-columnas.component';
import { ReportesDonaComponent } from './reportes-dona.component';
import { ReportesInsightsComponent, insights } from './reportes-insights.component';
import { ReportesKpisComponent } from './reportes-kpis.component';
import { ReportesComposicionComponent } from './reportes-composicion.component';
import { ReportesProporcionComponent } from './reportes-proporcion.component';
import {
  CATEGORIAS_EXPEDIENTE, ItemBarra, RECEPTORES, ReporteAnalitica, SituacionExpediente, TipoReceptor, compararNiveles, nivel, partes, partesGrafico, pct1, porcentaje, semestre,
} from './reportes-analitica.util';
import { ParteGrafico, TonoGrafico, num, tonoDe } from './reportes-graficos.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

/**
 * Franja ejecutiva (6 cifras). Estudiantes = DISTINCT; prácticas = filas; cobertura = obligaciones cargadas / exigidas;
 * aprobación = aprobadas / exigidas. Con filtros, el contexto muestra el denominador «en alcance».
 */
export function metricasGenerales(r: ReporteAnalitica, filtrado = false, situacion = ''): MetricaV3[] {
  const { resumen: s, expedientes: e, universo: u } = r;
  const cobertura = porcentaje(s.cargados, s.exigidos);
  const aprobacion = porcentaje(s.aprobados, s.exigidos);
  // La distribución de situaciones es una faceta (ignora su propio filtro); la cifra de la tira es del universo filtrado.
  const correccion = situacion ? (situacion === 'requiere_correccion' ? s.practicas : 0) : e.requiere_correccion;
  return [
    { n: s.estudiantes, t: 'Estudiantes', tono: 'info', contexto: filtrado ? `únicos · de ${num(u.estudiantes)} en alcance` : 'únicos en su alcance' },
    { n: s.practicas, t: 'Prácticas', tono: 'neutra', contexto: filtrado ? `de ${num(u.practicas)} en alcance` : 'registradas en su alcance' },
    { n: s.completos, t: 'Expedientes completos', tono: 'ok', contexto: `${num(s.completos)} / ${num(s.practicas)} · ${pct1(s.completos, s.practicas)}` },
    { n: correccion, t: 'Requieren corrección', tono: correccion ? 'aviso' : 'neutra', contexto: `${num(correccion)} / ${num(s.practicas)} · ${pct1(correccion, s.practicas)}` },
    { n: cobertura ?? 0, t: 'Cobertura vigente %', tono: 'info', contexto: `${num(s.cargados)} / ${num(s.exigidos)} obligaciones` },
    { n: aprobacion ?? 0, t: 'Aprobación %', tono: 'ok', contexto: `${num(s.aprobados)} / ${num(s.exigidos)} obligaciones` },
  ];
}

/** Agrupación de la tira por universo: personas y prácticas · expedientes · obligaciones documentales. */
export const GRUPOS_GENERAL = [{ titulo: 'Operación', n: 2 }, { titulo: 'Expedientes', n: 2 }, { titulo: 'Documentación', n: 2 }] as const;

/**
 * Reconciliación visible (sin cambiar definiciones): situaciones = prácticas; obligaciones = vigentes + por reenviar +
 * sin cargar. «Cargada» es la del dominio (versión vigente que NO requiere reenvío): devuelta, ilegible o rechazada va aparte.
 */
export function reconciliacion(r: ReporteAnalitica, situacionActiva = ''): { situaciones: ParteGrafico[]; practicas: number; obligaciones: ParteGrafico[]; exigidas: number; cierra: boolean } {
  const s = r.resumen, o = r.documental;
  const sit = situacionActiva ? { ...Object.fromEntries(CATEGORIAS_EXPEDIENTE.map((c) => [c.clave, 0])), [situacionActiva]: s.practicas } as Record<SituacionExpediente, number> : r.expedientes;
  const porReenviar = o.correccion + o.rechazado;
  const obligaciones: ParteGrafico[] = [
    { clave: 'vigentes', texto: 'cargadas vigentes', n: s.cargados, pct: pct1(s.cargados, s.exigidos), tono: 'info' },
    { clave: 'reenvio', texto: 'por reenviar (corrección o rechazo)', n: porReenviar, pct: pct1(porReenviar, s.exigidos), tono: 'aviso' },
    { clave: 'sin_cargar', texto: 'sin cargar', n: o.sin_cargar, pct: pct1(o.sin_cargar, s.exigidos), tono: 'muted' },
  ];
  const situaciones = partesGrafico(partes(CATEGORIAS_EXPEDIENTE, sit));
  return { situaciones, practicas: s.practicas, obligaciones, exigidas: s.exigidos,
    cierra: situaciones.reduce((n, x) => n + x.n, 0) === s.practicas && obligaciones.reduce((n, x) => n + x.n, 0) === s.exigidos };
}

/** Interna CUN / externa como partes (% de un decimal sobre el universo de esa faceta). Interna = teal; externa = azul. */
export function partesReceptor(r: ReporteAnalitica): ParteGrafico[] {
  const tono: Record<TipoReceptor, TonoGrafico> = { interna_cun: 'interna', externa: 'externa' };
  const base = r.facetas?.tipoReceptor.estudiantes ?? r.resumen.estudiantes;
  return r.receptores.filter((x) => x.tipo).map((x) => ({
    clave: x.tipo as string, texto: RECEPTORES[x.tipo as TipoReceptor], n: x.estudiantes, pct: pct1(x.estudiantes, base), tono: tono[x.tipo as TipoReceptor],
  }));
}

/** Acentos de la tira ejecutiva (microseñal por cifra; no seis tarjetas de colores). */
export const ACENTOS_GENERAL: readonly TonoGrafico[] = ['c0', 'c8', 'ok', 'aviso', 'info', 'c4'];
/** Nivel de formación: rampa fría coordinada (técnico → tecnólogo → profesional). */
export const TONOS_NIVEL: readonly TonoGrafico[] = ['c8', 'info', 'c0'];

/**
 * General · página ejecutiva (V3.3, claridad antes que sofisticación). Tira de KPI agrupada por universo con denominadores
 * visibles y una línea de reconciliación; dos lecturas; composición por modalidad y situación (barras apiladas con
 * cantidades absolutas, 7/12) junto al ranking de programas (5/12); luego nivel, semestre e interna/externa (4/12 cada uno).
 * Toda categoría es un filtro; con un filtro activo, su gráfica muestra lo elegido y atenúa el resto (facetas).
 */
@Component({
  selector: 'sipra-reportes-general',
  standalone: true,
  imports: [ReportesKpisComponent, ReportesInsightsComponent, ReportesComposicionComponent, ReportesBarrasComponent, ReportesColumnasComponent, ReportesDonaComponent, ReportesProporcionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .tira { margin: 0 0 10px; }
    .rec { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 32px; margin: 0 0 24px; }
    .rec-i { display: grid; gap: 5px; font-size: 12px; color: var(--text-secondary); }
    .rec-barra { display: flex; gap: 1px; height: 6px; border-radius: 3px; overflow: hidden; }
    .rec-barra span { background: var(--c); }
    .rec-txt { display: flex; flex-wrap: wrap; gap: 2px 12px; }
    .rec-txt b { font: 650 12px/16px var(--fuente-mono); color: var(--text-primary); }
    .rec-txt i { display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: var(--c); font-style: normal; }
    .rec-txt .igual { color: var(--text-primary); }
    .ir { justify-self: start; padding: 4px 0; font: 500 13px/18px var(--fuente); color: var(--signal-default); background: none; border: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
    :host-context([data-theme='light']) .ir { color: #03587a; }
    .ir:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    @media (width < 900px) { .rec { grid-template-columns: 1fr; } }
  `],
  template: `
    @if (estado.datos(); as r) {
      <sipra-reportes-kpis class="tira" [etiqueta]="filtrado() ? 'Resumen del universo filtrado' : 'Resumen del alcance'" [metricas]="metricas()" [acentos]="acentos" [grupos]="grupos" />
      @if (cuadre(); as c) {
        <div class="rec" aria-label="Cómo cuadran las cifras">
          <div class="rec-i">
            <span class="rec-barra" aria-hidden="true">@for (p of c.situaciones; track p.clave) { <span [class]="'gt-' + p.tono" [style.flex-grow]="p.n"></span> }</span>
            <span class="rec-txt">@for (p of c.situaciones; track p.clave) { <span [class]="'gt-' + p.tono"><i></i><b>{{ num(p.n) }}</b> {{ p.texto.toLowerCase() }}</span> }<span class="igual">= <b>{{ num(c.practicas) }}</b> prácticas</span></span>
          </div>
          <div class="rec-i">
            <span class="rec-barra" aria-hidden="true">@for (p of c.obligaciones; track p.clave) { <span [class]="'gt-' + p.tono" [style.flex-grow]="p.n"></span> }</span>
            <span class="rec-txt">@for (p of c.obligaciones; track p.clave) { <span [class]="'gt-' + p.tono"><i></i><b>{{ num(p.n) }}</b> {{ p.texto }}</span> }<span class="igual">= <b>{{ num(c.exigidas) }}</b> obligaciones exigidas</span></span>
          </div>
        </div>
      }
      <sipra-reportes-insights [lineas]="lecturas()" />

      <div class="ra-g12">
        <section class="ra-bloque ra-zona zona-academica c7 alto-l" aria-labelledby="g-op">
          <h2 id="g-op">Composición por modalidad y situación</h2>
          <p class="ra-nota">Cada barra es una modalidad; su largo es el número de prácticas y los colores, la situación del expediente.</p>
          <sipra-reportes-composicion titulo="Prácticas por modalidad y situación del expediente" [celdas]="r.cruces.modalidadSituacion" [categorias]="situaciones()" [textoFila]="etiquetaModalidad"
            [seleccionFila]="f().modalidad" [seleccionColumna]="f().situacion" (elegirFila)="estado.alternar('modalidad', $event)" (elegirColumna)="situacion($event)" />
        </section>
        <section class="ra-bloque ra-zona zona-academica c5 alto-l" aria-labelledby="g-prog">
          <h2 id="g-prog">Estudiantes por programa</h2>
          <p class="ra-nota">Top 8 de {{ programas().length }} · estudiantes únicos.</p>
          <sipra-reportes-barras titulo="Estudiantes por programa" [items]="programas()" [total]="r.facetas.programa.estudiantes" ejeX="Estudiantes" [seleccion]="f().programa" [limite]="8" (elegir)="estado.alternar('programa', $event)" />
        </section>
      </div>

      <div class="ra-g12">
        <section class="ra-bloque ra-zona zona-academica c4 alto-s" aria-labelledby="g-niv">
          <h2 id="g-niv">Nivel de formación</h2>
          <p class="ra-nota">Ciclo registrado en la práctica.</p>
          <sipra-reportes-dona titulo="Estudiantes por nivel de formación" [partes]="niveles()" centro="estudiantes" [seleccion]="f().ciclo" (elegir)="estado.alternar('ciclo', $event)" />
        </section>
        @if (r.dimensiones.semestre === 'sintetica') {
          <section class="ra-bloque ra-zona zona-academica c4 alto-s" aria-labelledby="g-semestre">
            <h2 id="g-semestre">Semestre</h2>
            <p class="ra-nota">Dato sintético de prueba (SIPRA no lo guarda en producción).</p>
            <sipra-reportes-columnas titulo="Estudiantes por semestre" [items]="semestres()" [total]="r.facetas.semestre.estudiantes" ejeX="Semestre" [corto]="numeroSemestre"
              [seleccion]="f().semestre" (elegir)="estado.alternar('semestre', $event)" />
          </section>
        } @else {
          <section class="ra-bloque ra-zona zona-doc c4 alto-s" aria-labelledby="g-doc">
            <h2 id="g-doc">Documentación</h2>
            <p class="ra-nota">El análisis por tipo, grupo y tiempo está en Documentos.</p>
            <button type="button" class="ir" (click)="estado.pestana.set('documentos')">Ir a Documentos</button>
          </section>
        }
        <section class="ra-bloque ra-zona zona-org c4 alto-s" aria-labelledby="g-rec">
          <h2 id="g-rec">Interna CUN y externa</h2>
          <p class="ra-nota">Interna = modalidad articulada («escenario dentro de la institución»).</p>
          <sipra-reportes-proporcion titulo="Estudiantes por tipo de organización receptora" [partes]="receptores()" [grande]="true" [seleccion]="f().tipoReceptor" (elegir)="tipo($event)" />
        </section>
      </div>
    }
  `,
})
export class ReportesGeneralComponent {
  protected readonly estado = inject(ReportesEstado);
  private readonly etiqueta = new EtiquetaPipe();
  protected readonly acentos = ACENTOS_GENERAL;
  protected readonly grupos = GRUPOS_GENERAL;
  protected readonly cuadre = computed(() => { const r = this.estado.datos(); return r ? reconciliacion(r, this.f().situacion) : null; });
  protected readonly num = num;

  protected readonly f = this.estado.filtros;
  protected readonly filtrado = computed(() => this.estado.activos() > 0);
  protected readonly metricas = computed(() => { const r = this.estado.datos(); return r ? metricasGenerales(r, this.filtrado(), this.f().situacion) : []; });
  protected readonly lecturas = computed(() => { const r = this.estado.datos(); return r ? insights.general(r, this.nombres) : []; });
  protected readonly etiquetaModalidad = (v: string): string => this.etiqueta.transform(v);
  private readonly nombres = { programa: this.estado.nombrePrograma, modalidad: this.etiquetaModalidad, tipo: this.etiquetaModalidad, escuela: this.estado.nombreEscuela };
  /** Situaciones en su orden semántico, con su color fijo (completo verde, en curso cielo, corrección ámbar, sin iniciar gris). */
  protected readonly situaciones = computed<ParteGrafico[]>(() => CATEGORIAS_EXPEDIENTE.map((c) => ({ clave: c.clave, texto: c.texto, n: 0, pct: '', tono: tonoDe(c.tono, c.clase) })));
  /** Solo el nombre del programa en la etiqueta; la escuela va al tooltip. Familia azul (dato principal). */
  protected readonly programas = computed<ItemBarra[]>(() => (this.estado.datos()?.programas ?? [])
    .map((p) => ({ clave: p.programa, texto: p.nombre ?? p.programa, n: p.estudiantes, detalle: [p.nombreEscuela] })));
  protected readonly niveles = computed<ParteGrafico[]>(() => {
    const r = this.estado.datos();
    if (!r) return [];
    return [...r.niveles].sort((a, b) => compararNiveles(a.ciclo, b.ciclo))
      .map((n, k) => ({ clave: n.ciclo, texto: nivel(n.ciclo), n: n.estudiantes, pct: pct1(n.estudiantes, r.facetas.ciclo.estudiantes), tono: TONOS_NIVEL[k % TONOS_NIVEL.length] }));
  });
  /** Semestres en orden numérico (no por volumen): el eje es académico. «Sin información» no es filtrable. */
  protected readonly semestres = computed<ItemBarra[]>(() => (this.estado.datos()?.semestres ?? [])
    .filter((s) => s.semestre !== null).map((s) => ({ clave: String(s.semestre), texto: semestre(s.semestre), n: s.estudiantes })));
  protected readonly receptores = computed(() => { const r = this.estado.datos(); return r ? partesReceptor(r) : []; });
  protected readonly numeroSemestre = (i: ItemBarra): string => i.clave;

  protected tipo(t: string): void { this.estado.alternar('tipoReceptor', t as TipoReceptor); }
  protected situacion(s: string): void { this.estado.alternar('situacion', s as SituacionExpediente); }
}
