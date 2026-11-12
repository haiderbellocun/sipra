import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { MetricaV3 } from '@shared/components/tira-metricas.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { ReportesBarrasComponent } from './reportes-barras.component';
import { ReportesDonaComponent } from './reportes-dona.component';
import { ReportesKpisComponent } from './reportes-kpis.component';
import { ReportesMatrizComponent } from './reportes-matriz.component';
import { ReportesInsightsComponent } from './reportes-insights.component';
import { HojaPack, ReportesPackComponent } from './reportes-pack.component';
import { partesReceptor } from './reportes-general.component';
import {
  ItemBarra, ReporteAnalitica, SIN_DATO, SIN_EMPRESA, pct1,
} from './reportes-analitica.util';
import { TonoGrafico, num } from './reportes-graficos.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

/** Clave de ciudad de las receptoras en el exterior (solo dataset sintético de dev; SIPRA no guarda país). */
export const INTERNACIONAL = '__internacional__';

/**
 * KPI de Organizaciones, solo con totales que la API ya entrega: receptoras (con nombre), empresas externas, prácticas
 * internas CUN, sectores CIIU y municipios DIVIPOLA con estudiantes, e internacionales (solo si el dataset las distingue).
 */
export function metricasOrganizaciones(r: ReporteAnalitica): MetricaV3[] {
  const conNombre = r.empresas.filter((e) => e.empresa !== null && e.estudiantes > 0);
  const externas = conNombre.filter((e) => e.tipo === 'externa');
  const internas = r.receptores.find((x) => x.tipo === 'interna_cun')?.practicas ?? 0;
  const m: MetricaV3[] = [
    { n: conNombre.length, t: 'Organizaciones receptoras', tono: 'info', contexto: 'con estudiantes en el filtro' },
    { n: externas.length, t: 'Empresas externas', tono: 'info', contexto: `${num(externas.reduce((n, e) => n + e.practicas, 0))} prácticas` },
    { n: internas, t: 'Prácticas internas CUN', tono: 'neutra', contexto: `${pct1(internas, r.resumen.practicas)} de las prácticas` },
    { n: r.sectores.filter((s) => s.sector).length, t: 'Sectores', tono: 'neutra', contexto: 'secciones CIIU' },
    { n: r.ciudades.filter((c) => c.ciudad && c.ciudad !== INTERNACIONAL).length, t: 'Ciudades', tono: 'neutra', contexto: 'municipios DIVIPOLA' },
  ];
  if (r.dimensiones.ubicacionInternacional === 'sintetica') {
    const n = r.ciudades.find((c) => c.ciudad === INTERNACIONAL)?.estudiantes ?? 0;
    m.push({ n, t: 'Internacionales', tono: 'neutra', contexto: 'estudiantes, sin DIVIPOLA' });
  }
  return m;
}

/**
 * Hasta tres lecturas deterministas (sin IA, sin conclusiones causales), cada una solo si su denominador existe:
 * concentración de la ciudad principal en las prácticas externas, alcance del sector principal en programas y peso de
 * la práctica interna CUN.
 */
export function insightsOrganizaciones(r: ReporteAnalitica, nombres: { ciudad: (c: string) => string; sector: (c: string) => string }): string[] {
  const salida: string[] = [];
  const porCiudad = new Map<string, number>();
  let externas = 0;
  for (const e of r.empresas) {
    if (e.tipo !== 'externa') continue;
    externas += e.practicas;
    if (e.ciudad && e.ciudad !== INTERNACIONAL) porCiudad.set(e.ciudad, (porCiudad.get(e.ciudad) ?? 0) + e.practicas);
  }
  const [ciudad] = [...porCiudad.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ciudad && externas > 0) salida.push(`${nombres.ciudad(ciudad[0])} concentra el ${pct1(ciudad[1], externas)} de las prácticas externas.`);
  const [sector] = r.sectores.filter((s) => s.sector && s.estudiantes > 0).sort((a, b) => b.estudiantes - a.estudiantes);
  if (sector) {
    const programas = new Set(r.cruces.programaSector.filter((c) => c.columna === sector.sector && c.estudiantes > 0).map((c) => c.fila)).size;
    if (programas > 0) salida.push(`El sector ${sector.nombre ?? nombres.sector(sector.sector as string)} recibe estudiantes de ${programas} programa${programas === 1 ? '' : 's'}.`);
  }
  const internas = r.receptores.find((x) => x.tipo === 'interna_cun')?.practicas ?? 0;
  if (r.resumen.practicas > 0 && internas > 0) salida.push(`El ${pct1(internas, r.resumen.practicas)} de las prácticas son internas CUN.`);
  return salida.slice(0, 3);
}

/**
 * Organizaciones (nivel 2 · análisis): ¿dónde hacen prácticas nuestros estudiantes? Organización receptora, empresa,
 * sector económico (sección CIIU), ciudad (DIVIPOLA) e interna CUN frente a externa. La CUN va separada del ranking externo.
 * Al elegir una organización aparece su franja de detalle (programas, modalidades, niveles y estado documental de sus
 * estudiantes, del mismo reporte filtrado) y «Ver estudiantes» lleva a la tabla granular. Sin API nueva.
 */
@Component({
  selector: 'sipra-reportes-organizaciones',
  standalone: true,
  imports: [ReportesKpisComponent, ReportesInsightsComponent, ReportesBarrasComponent, ReportesDonaComponent, ReportesMatrizComponent, ReportesPackComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .tira { margin: 0 0 26px; }
    .o-f1 { display: grid; gap: 24px 28px; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); align-items: start; }
    .o-f2 { display: grid; gap: 24px 28px; grid-template-columns: minmax(0, 11fr) minmax(0, 9fr); align-items: start; margin-top: 24px; }
    .o-f3 { margin-top: 24px; }
    .o-emp { --barras-y: clamp(11rem, 44%, 17rem); }
    .sub { margin: 22px 0 8px; font: 600 13px/18px var(--fuente); color: var(--text-primary); }
    .cun { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin: 0 0 12px; padding: 8px 10px; font-size: 13px; color: var(--text-secondary);
      border-left: 2px solid var(--gr-interna); background: color-mix(in srgb, var(--gr-interna) 8%, transparent); border-radius: 0 4px 4px 0; }
    .cun strong { font: 600 15px/20px var(--fuente-mono); color: var(--text-primary); }
    .enlace { padding: 0; font: inherit; color: var(--signal-default); background: none; border: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
    :host-context([data-theme='light']) .enlace { color: #03587a; }
    .enlace:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 2px; }
    .ins { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
    .ins li { padding-left: 12px; font-size: 13px; line-height: 19px; color: var(--text-primary); border-left: 2px solid var(--gr-principal); }
    /* Franja contextual de la organización elegida. */
    .org { margin: 0 0 26px; padding: 16px 18px; border: 1px solid var(--border-default); border-left: 3px solid var(--gr-principal); border-radius: 6px;
      background: color-mix(in srgb, var(--gr-principal) 5%, transparent); }
    .org-cab { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 20px; }
    .org-cab h2 { margin: 0; font: 600 16px/22px var(--fuente); color: var(--text-primary); }
    .org-cab span { font-size: 12px; color: var(--text-secondary); }
    .org-datos { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px 18px; margin: 14px 0 6px; padding: 0; list-style: none; }
    .org-datos li { display: grid; gap: 2px; font-size: 12px; color: var(--text-secondary); }
    .org-datos strong { font: 600 18px/24px var(--fuente-mono); color: var(--text-primary); }
    .org-datos strong.txt { font: 500 13px/18px var(--fuente); }
    .org-graf { display: grid; gap: 22px 40px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 16px; }
    .org-graf h3 { margin: 0 0 8px; font: 600 13px/18px var(--fuente); color: var(--text-primary); }
    .org-acc { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 14px; }
    .org-acc button.primario { height: 32px; padding: 0 14px; font: 600 13px/1 var(--fuente); color: var(--text-inverse); background: var(--gr-principal); border: 0; border-radius: 6px; cursor: pointer; }
    :host-context([data-theme='light']) .org-acc button.primario { color: #ffffff; }
    .org-acc button.primario:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
    @media (width < 1100px) { .o-f1, .o-f2, .org-graf { grid-template-columns: 1fr; } }
  `],
  template: `
    @if (estado.datos(); as r) {
      <sipra-reportes-kpis class="tira" etiqueta="Organizaciones receptoras del filtro" [metricas]="metricas()" [acentos]="acentos" />
      <sipra-reportes-insights class="zona-org" [lineas]="insights().slice(0, 2)" />

      @if (organizacion(); as o) {
        <section class="org" aria-labelledby="o-det">
          <div class="org-cab"><h2 id="o-det">{{ o.nombre }}</h2><span>{{ o.tipo }}</span></div>
          <ul class="org-datos">
            <li>Sector<strong class="txt">{{ o.sector }}</strong></li>
            <li>Ciudad<strong class="txt">{{ o.ciudad }}</strong></li>
            <li>Estudiantes<strong>{{ num(r.resumen.estudiantes) }}</strong></li>
            <li>Programas<strong>{{ r.cruces.programaModalidad.length ? programasOrg() : 0 }}</strong></li>
            <li>Modalidades<strong>{{ modalidadesOrg() }}</strong></li>
            <li>Aprobación documental<strong>{{ pct1(r.resumen.aprobados, r.resumen.exigidos) }}</strong></li>
          </ul>
          <div class="org-graf">
            <div><h3>Programas de sus estudiantes</h3>
              <sipra-reportes-barras titulo="Estudiantes de la organización por programa" [items]="programasDeOrg()" [total]="r.resumen.estudiantes" [limite]="5" [seleccionable]="false" /></div>
            <div><h3>Modalidades</h3>
              <sipra-reportes-barras titulo="Estudiantes de la organización por modalidad" [items]="modalidadesDeOrg()" [total]="r.resumen.estudiantes" [limite]="5" tono="c1" [seleccionable]="false" /></div>
          </div>
          <div class="org-acc">
            <button type="button" class="primario" (click)="verEstudiantes()">Ver estudiantes</button>
            <button type="button" class="enlace" (click)="estado.quitar('empresa')">Quitar la organización del filtro</button>
          </div>
        </section>
      }

      <div class="o-f1">
        <section class="ra-bloque ra-zona zona-org" aria-labelledby="o-pack">
          <h2 id="o-pack">Sectores y organizaciones</h2>
          <p class="ra-nota">Cada burbuja grande es un sector (sección CIIU); dentro, sus organizaciones externas. El área es el número de estudiantes.</p>
          <sipra-reportes-pack titulo="Estudiantes por sector económico y organización" [hojas]="hojasPack()" [textoGrupo]="nombreSector" [seleccion]="f().empresa" (elegir)="estado.alternar('empresa', $event)" />
        </section>
        <section class="ra-bloque ra-zona zona-org o-emp" aria-labelledby="o-emp">
          <h2 id="o-emp">Organizaciones receptoras externas</h2>
          @if (internas(); as n) {
            <p class="cun"><span>CUN · práctica interna</span><strong>{{ num(n) }}</strong><span>estudiantes, fuera de este ranking</span>
              <button type="button" class="enlace" [attr.aria-pressed]="f().tipoReceptor === 'interna_cun'" (click)="estado.alternar('tipoReceptor', 'interna_cun')">Ver solo internas</button></p>
          }
          <p class="ra-nota">Top 10 de {{ empresas().length }} empresas. El tooltip muestra sector y ciudad.</p>
          <sipra-reportes-barras titulo="Estudiantes por organización externa" [items]="empresas()" [total]="r.facetas.empresa.estudiantes" ejeX="Estudiantes" tono="c1" [seleccion]="f().empresa" (elegir)="estado.alternar('empresa', $event)" />
        </section>
      </div>

      <section class="ra-bloque ra-zona zona-org o-f3" aria-labelledby="o-cruce">
        <h2 id="o-cruce">Programa × sector</h2>
        <p class="ra-nota">Qué sectores reciben estudiantes de cada programa (estudiantes únicos por celda). Top 10 programas; el encabezado filtra la fila o la columna y la celda filtra ambas.</p>
        <sipra-reportes-matriz titulo="Estudiantes por programa y sector" rotuloFilas="Programa" rotuloColumnas="Sector" [celdas]="r.cruces.programaSector" tono="c1"
          [textoFila]="estado.nombrePrograma" [textoColumna]="estado.nombreSector" [cortoColumna]="codigoSector"
          [seleccionFila]="f().programa" [seleccionColumna]="f().sector ? (f().sector === sinDato ? '' : f().sector) : null"
          (elegirFila)="estado.alternar('programa', $event)" (elegirColumna)="sector($event)" (elegirCelda)="celda($event)" />
      </section>

      <div class="o-f2">
        <section class="ra-bloque ra-zona zona-org" aria-labelledby="o-ciudad">
          <h2 id="o-ciudad">Estudiantes por ciudad</h2>
          <p class="ra-nota">Municipio DIVIPOLA de la organización.@if (r.dimensiones.ubicacionInternacional === 'sintetica') { «Internacional · sin DIVIPOLA» es del dataset sintético (SIPRA no guarda país); «Sin municipio registrado» es un dato faltante. } No hay mapa: el repositorio no tiene geometría DIVIPOLA confiable.</p>
          <sipra-reportes-barras titulo="Estudiantes por ciudad" [items]="ciudades()" [total]="r.facetas.ciudad.estudiantes" ejeX="Estudiantes" tono="c8" [seleccion]="f().ciudad" [limite]="10" (elegir)="estado.alternar('ciudad', $event)" />
        </section>
        <section class="ra-bloque ra-zona zona-org" aria-labelledby="o-rec">
          <h2 id="o-rec">Interna CUN y externa</h2>
          <p class="ra-nota">Interna = modalidad articulada del dominio.</p>
          <sipra-reportes-dona titulo="Estudiantes por tipo de organización receptora" [partes]="receptores()" centro="estudiantes" [seleccion]="f().tipoReceptor" (elegir)="tipo($event)" />
          <h3 class="sub">Sectores</h3>
          <sipra-reportes-barras titulo="Estudiantes por sector económico" [items]="sectores()" [total]="r.facetas.sector.estudiantes" [limite]="6" tono="c1" [seleccion]="f().sector" (elegir)="estado.alternar('sector', $event)" />
        </section>
      </div>
    }
  `,
})
export class ReportesOrganizacionesComponent implements OnInit {
  protected readonly estado = inject(ReportesEstado);
  protected readonly f = this.estado.filtros;
  protected readonly pct1 = pct1;
  protected readonly num = num;
  protected readonly acentos: TonoGrafico[] = ['c1', 'externa', 'interna', 'c2', 'c8', 'c5'];
  protected readonly nombreSector = (c: string): string => (c === '' ? 'Sin sector registrado' : this.estado.nombreSector(c));
  /** Burbujas: organizaciones EXTERNAS por sector (la CUN va aparte, como en el ranking). */
  protected readonly hojasPack = computed<HojaPack[]>(() => (this.estado.datos()?.empresas ?? []).filter((e) => e.tipo === 'externa' && e.estudiantes > 0)
    .map((e) => ({ clave: e.empresa ?? SIN_EMPRESA, texto: e.empresa ?? 'Sin empresa registrada', grupo: e.sector ?? '', n: e.estudiantes,
      detalle: [`Ciudad: ${e.ciudad ? this.estado.nombreCiudad(e.ciudad) : 'sin municipio'}`] })));
  /** Programas y modalidades de la organización elegida: del cruce del universo filtrado (coincide con sus cifras). */
  protected readonly programasDeOrg = computed<ItemBarra[]>(() => sumarPor(this.estado.datos()?.cruces.programaModalidad ?? [], 'fila')
    .map(([k, n]) => ({ clave: k, texto: this.estado.nombrePrograma(k), n })));
  protected readonly modalidadesDeOrg = computed<ItemBarra[]>(() => sumarPor(this.estado.datos()?.cruces.programaModalidad ?? [], 'columna')
    .map(([k, n]) => ({ clave: k, texto: this.etiqueta.transform(k), n })));
  protected readonly programasOrg = computed(() => this.programasDeOrg().length);
  protected readonly modalidadesOrg = computed(() => this.modalidadesDeOrg().length);
  protected readonly sinDato = SIN_DATO;
  private readonly etiqueta = new EtiquetaPipe();

  protected readonly metricas = computed(() => { const r = this.estado.datos(); return r ? metricasOrganizaciones(r) : []; });
  protected readonly insights = computed(() => { const r = this.estado.datos(); return r ? insightsOrganizaciones(r, { ciudad: this.estado.nombreCiudad, sector: this.estado.nombreSector }) : []; });
  /** Ranking EXTERNO: la CUN (receptora de las internas) va aparte para no mezclar un registro institucional con empresas. */
  protected readonly empresas = computed<ItemBarra[]>(() => (this.estado.datos()?.empresas ?? [])
    .filter((e) => e.tipo !== 'interna_cun').map((e) => ({
      clave: e.empresa ?? SIN_EMPRESA, texto: e.empresa ?? 'Sin empresa registrada', n: e.estudiantes,
      detalle: [`Sector: ${e.sector ? this.estado.nombreSector(e.sector) : 'sin información'}`, `Ciudad: ${e.ciudad ? this.estado.nombreCiudad(e.ciudad) : 'sin municipio'}`],
    })));
  protected readonly internas = computed(() => this.estado.datos()?.receptores.find((x) => x.tipo === 'interna_cun')?.estudiantes ?? 0);
  protected readonly sectores = computed<ItemBarra[]>(() => (this.estado.datos()?.sectores ?? [])
    .map((s) => ({ clave: s.sector ?? SIN_DATO, texto: s.nombre ?? 'Sin información', n: s.estudiantes, detalle: s.sector ? [`Sección CIIU ${s.sector}`] : ['Organización sin actividad CIIU registrada'] })));
  protected readonly ciudades = computed<ItemBarra[]>(() => (this.estado.datos()?.ciudades ?? [])
    .map((c) => ({
      clave: c.ciudad ?? SIN_DATO, texto: c.nombre ?? 'Sin municipio registrado', n: c.estudiantes,
      detalle: c.ciudad === INTERNACIONAL ? ['Receptora en el exterior: sin código DIVIPOLA'] : c.ciudad ? [`DIVIPOLA ${c.ciudad}`] : ['Dato faltante'],
    })));
  protected readonly receptores = computed(() => { const r = this.estado.datos(); return r ? partesReceptor(r) : []; });

  /** Franja de la organización elegida (empresa en el contexto): datos de la propia fila y del reporte ya filtrado. */
  protected readonly organizacion = computed(() => {
    const r = this.estado.datos(), e = this.f().empresa;
    if (!r || !e) return null;
    const fila = r.empresas.find((x) => (x.empresa ?? SIN_EMPRESA) === e);
    return {
      nombre: e === SIN_EMPRESA ? 'Sin empresa registrada' : e,
      tipo: fila?.tipo === 'interna_cun' ? 'Interna CUN' : 'Organización externa',
      sector: fila?.sector ? this.estado.nombreSector(fila.sector) : 'Sin información',
      ciudad: fila?.ciudad ? this.estado.nombreCiudad(fila.ciudad) : 'Sin municipio registrado',
    };
  });
  protected readonly programas = computed<ItemBarra[]>(() => (this.estado.datos()?.programas ?? []).map((p) => ({ clave: p.programa, texto: p.nombre ?? p.programa, n: p.estudiantes, detalle: [p.nombreEscuela] })));
  protected readonly modalidades = computed<ItemBarra[]>(() => [...(this.estado.datos()?.modalidades ?? [])]
    .sort((a, b) => b.estudiantes - a.estudiantes).map((m) => ({ clave: m.modalidad, texto: this.etiqueta.transform(m.modalidad), n: m.estudiantes })));
  protected readonly codigoSector = (c: string): string => (c === '' ? '—' : c);

  ngOnInit(): void {
    // Igual que Estudiantes: la navegación termina en la tabla granular del contexto (Abrir expediente).
    if (!this.estado.segmento()) void this.estado.abrirDetalle({});
  }

  protected tipo(t: string): void { this.estado.alternar('tipoReceptor', t as 'interna_cun' | 'externa'); }
  /** '' en el cruce es «sin dato»: se filtra con el valor explícito. */
  protected sector(c: string): void { this.estado.alternar('sector', c === '' ? SIN_DATO : c); }
  protected celda(c: { fila: string; columna: string }): void {
    const sector = c.columna === '' ? SIN_DATO : c.columna, f = this.f();
    if (f.programa === c.fila && f.sector === sector) this.estado.filtrar({ programa: '', sector: '' });
    else this.estado.filtrar({ programa: c.fila, sector });
  }
  protected verEstudiantes(): void {
    void this.estado.abrirDetalle({});
    requestAnimationFrame(() => document.querySelector('sipra-reportes-detalle')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  }
}

function sumarPor(celdas: readonly { fila: string; columna: string; estudiantes: number }[], k: 'fila' | 'columna'): [string, number][] {
  const m = new Map<string, number>();
  for (const c of celdas) m.set(c[k], (m.get(c[k]) ?? 0) + c.estudiantes);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
