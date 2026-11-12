import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ReportesCrucesComponent } from './reportes-cruces.component';
import { ReportesTreemapComponent } from './reportes-treemap.component';
import { ReportesBarrasComponent } from './reportes-barras.component';
import { ReportesDonaComponent } from './reportes-dona.component';
import { ReportesColumnasComponent } from './reportes-columnas.component';
import { TONOS_NIVEL } from './reportes-general.component';
import { ParteGrafico } from './reportes-graficos.util';
import { ReportesInsightsComponent, insights } from './reportes-insights.component';
import { ReportesMatrizComponent } from './reportes-matriz.component';
import { EjeRadar, ReportesRadarComponent, SerieRadar } from './reportes-radar.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { Cobertura, ItemBarra, compararNiveles, compararSemestres, nivel, pct1, porcentaje, semestre } from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

/**
 * Estudiantes (nivel 2 · análisis): composición académica (escuela → programa), un explorador de cruces y, al final, la
 * tabla granular (nivel 3) que lleva al Expediente. Organización, sector y ciudad viven en su pestaña (Organizaciones).
 * Todo filtra el mismo contexto. Sin ranking de personas: las filas agregadas son unidades académicas.
 */
@Component({
  selector: 'sipra-reportes-estudiantes',
  standalone: true,
  imports: [ReportesCrucesComponent, ReportesInsightsComponent, ReportesTreemapComponent, ReportesMatrizComponent, ReportesRadarComponent, ReportesBarrasComponent, ReportesDonaComponent, ReportesColumnasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .cob { display: grid; grid-template-columns: minmax(80px, 1fr) 3rem; gap: 8px; align-items: center; }
    .ancho { grid-column: 1 / -1; }
    .seccion { grid-column: 1 / -1; margin: 8px 0 -14px; font: 600 11px/16px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); border-top: 1px solid var(--ra-regla); padding-top: 18px; }
    .seccion:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
    .comparar { display: inline-flex; gap: 8px; align-items: center; margin: 0 0 12px; font-size: 13px; color: var(--text-secondary); }
    .comparar select { height: 30px; max-width: 260px; padding: 0 8px; font: inherit; color: var(--text-primary); background: var(--vd-campo, color-mix(in srgb, var(--surface-raised) 70%, transparent)); border: 1px solid var(--border-default); border-radius: 6px; }
    .comparar select:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
  `],
  template: `
    @if (estado.datos(); as r) {
      <sipra-reportes-insights [lineas]="lecturas()" />
      <div class="ra-g12">
        <section class="ra-bloque ra-zona zona-academica c8 alto-l" aria-labelledby="e-jer">
          <h2 id="e-jer">Estudiantes por escuela</h2>
          <p class="ra-nota">Empiece por las escuelas y entre a programas, nivel y semestre. El tamaño de cada bloque es su número de estudiantes.</p>
          <sipra-reportes-treemap titulo="Estudiantes por escuela, programa, nivel y semestre" [filas]="r.jerarquia" [textos]="textosJerarquia" [seleccion]="{ escuela: f().escuela, programa: f().programa }" (filtrar)="filtrarRama($event)" />
        </section>
        <section class="ra-bloque ra-zona zona-academica c4 alto-l" aria-labelledby="e-prog">
          <h2 id="e-prog">Estudiantes por programa</h2>
          <p class="ra-nota">Top 10 de {{ programas().length }}.</p>
          <sipra-reportes-barras titulo="Estudiantes por programa" [items]="programas()" [total]="r.facetas.programa.estudiantes" ejeX="Estudiantes" [seleccion]="f().programa" (elegir)="estado.alternar('programa', $event)" />
        </section>
      </div>
      <div class="ra-g12">
        <section class="ra-bloque ra-zona zona-academica c7 alto-m" aria-labelledby="e-mapa">
          <h2 id="e-mapa">{{ r.dimensiones.semestre === 'sintetica' ? 'Programa × semestre' : 'Programa × nivel' }}</h2>
          <p class="ra-nota">Estudiantes por celda: más intenso = más estudiantes. El encabezado filtra la fila o la columna.</p>
          @if (r.dimensiones.semestre === 'sintetica') {
            <sipra-reportes-matriz titulo="Estudiantes por programa y semestre" rotuloFilas="Programa" rotuloColumnas="Semestre" [celdas]="r.cruces.programaSemestre" [ordenColumnas]="ordenSemestres()"
              [textoFila]="estado.nombrePrograma" [textoColumna]="textoSemestre" [cortoColumna]="cortoSemestre" tono="c0" [seleccionFila]="f().programa" [seleccionColumna]="f().semestre || null"
              (elegirFila)="estado.alternar('programa', $event)" (elegirColumna)="semestreDe($event)" (elegirCelda)="celdaSemestre($event)" />
          } @else {
            <sipra-reportes-matriz titulo="Estudiantes por programa y nivel" rotuloFilas="Programa" rotuloColumnas="Nivel" [celdas]="r.cruces.programaNivel" [ordenColumnas]="['tecnico', 'tecnologo', 'profesional']"
              [textoFila]="estado.nombrePrograma" [textoColumna]="nivel" [cortoColumna]="nivel" tono="c0" [seleccionFila]="f().programa" [seleccionColumna]="f().ciclo || null"
              (elegirFila)="estado.alternar('programa', $event)" (elegirColumna)="estado.alternar('ciclo', $event)" />
          }
        </section>
        <section class="ra-bloque ra-zona zona-academica c5 alto-m" aria-labelledby="e-perfil">
          <h2 id="e-perfil">Perfil del programa</h2>
          <p class="ra-nota">Cinco tasas de 0 a 100 (no volumen), frente al conjunto o a otro programa.</p>
          @if (perfil(); as p) {
            <div class="comparar"><label>Comparar con <select (change)="comparado.set(valor($event))">
              <option value="" [selected]="!comparado()">Conjunto de programas del filtro</option>
              @for (o of r.programas; track o.programa) { @if (o.programa !== f().programa) { <option [value]="o.programa" [selected]="comparado() === o.programa">{{ o.nombre ?? o.programa }}</option> } }
            </select></label></div>
            <sipra-reportes-radar [titulo]="'Perfil de ' + p.series[0].texto" [ejes]="ejesPerfil" [series]="p.series" />
          } @else {
            <p class="ra-nota">Elija un programa (en el mapa, el ranking o aquí) para ver su perfil.</p>
            <label class="comparar">Programa <select (change)="estado.alternar('programa', valor($event))"><option value="">—</option>
              @for (o of r.programas; track o.programa) { <option [value]="o.programa">{{ o.nombre ?? o.programa }}</option> }</select></label>
          }
        </section>
      </div>
      <div class="ra-g12">
        <section class="ra-bloque ra-zona zona-academica c6 alto-s" aria-labelledby="e-niv">
          <h2 id="e-niv">Nivel de formación</h2>
          <sipra-reportes-dona titulo="Estudiantes por nivel de formación" [partes]="niveles()" centro="estudiantes" [seleccion]="f().ciclo" (elegir)="estado.alternar('ciclo', $event)" />
        </section>
        @if (r.dimensiones.semestre === 'sintetica') {
          <section class="ra-bloque ra-zona zona-academica c6 alto-s" aria-labelledby="e-sem">
            <h2 id="e-sem">Semestre</h2>
            <sipra-reportes-columnas titulo="Estudiantes por semestre" [items]="semestres()" [total]="r.facetas.semestre.estudiantes" ejeX="Semestre" [corto]="numeroSemestre" [seleccion]="f().semestre" (elegir)="estado.alternar('semestre', $event)" />
          </section>
        }
      </div>
      <div class="ra-rejilla" style="margin-top:32px">
        <h2 class="seccion">Cifras exactas</h2>
        <section class="ra-bloque ancho" aria-labelledby="e-esc">
          <h2 id="e-esc">Escuelas y programas</h2>
          <p class="ra-nota">Estudiantes únicos. Aprobado = obligaciones aprobadas / exigidas. El nombre filtra el reporte; la flecha despliega los programas.</p>
          <div class="ra-desliza">
            <table class="ra-tabla">
              <caption class="ra-sr">Estudiantes, prácticas y cobertura por escuela y programa</caption>
              <thead><tr><th scope="col">Escuela / programa</th><th scope="col">Nivel</th><th scope="col" class="d">Estudiantes</th><th scope="col" class="d">Prácticas</th><th scope="col" class="d">Completos</th><th scope="col" class="d">En corrección</th><th scope="col" style="min-width:150px">Aprobado</th></tr></thead>
              <tbody>
                @for (e of r.escuelas; track e.escuela) {
                  <tr>
                    <th scope="row"><button type="button" class="ra-abrir" [attr.aria-expanded]="abiertas().has(e.escuela)" [attr.aria-controls]="'prog-' + e.escuela" (click)="alternar(e.escuela)"><span class="ra-sr">Programas de {{ e.nombre }}</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4"/></svg></button><button type="button" class="ra-ir" [attr.aria-pressed]="f().escuela === e.escuela" (click)="estado.alternar('escuela', e.escuela)">{{ e.nombre }}</button></th>
                    <td></td>
                    <td class="d">{{ e.estudiantes }}</td><td class="d">{{ e.practicas }}</td><td class="d">{{ e.completos }}</td><td class="d">{{ e.correccion }}</td>
                    <td><span class="cob"><span class="ra-mini" aria-hidden="true"><span class="t-ok" [style.width.%]="pct(e.aprobados, e.exigidos) ?? 0"></span></span><span class="d ra-num">{{ pct(e.aprobados, e.exigidos) ?? '—' }} %</span></span></td>
                  </tr>
                  @if (abiertas().has(e.escuela) || f().escuela === e.escuela) {
                    @for (p of e.programas; track p.programa) {
                      <tr class="sub" [attr.id]="$first ? 'prog-' + e.escuela : null">
                        <td><button type="button" class="ra-ir" [attr.aria-pressed]="f().programa === p.programa" (click)="estado.alternar('programa', p.programa)" [title]="p.programa">{{ estado.nombrePrograma(p.programa) }}</button></td>
                        <td>{{ ciclos(p.programa) }}</td>
                        <td class="d">{{ p.estudiantes }}</td><td class="d">{{ p.practicas }}</td><td class="d">{{ p.completos }}</td><td class="d">{{ p.correccion }}</td>
                        <td><span class="cob"><span class="ra-mini" aria-hidden="true"><span class="t-ok" [style.width.%]="pct(p.aprobados, p.exigidos) ?? 0"></span></span><span class="d ra-num">{{ pct(p.aprobados, p.exigidos) ?? '—' }} %</span></span></td>
                      </tr>
                    }
                  }
                }
              </tbody>
            </table>
          </div>
        </section>
        @if (r.dimensiones.semestre !== 'sintetica') {
          <p class="ra-nota ancho">Semestre: no disponible. SIPRA no lo guarda en la práctica (vive en SINU, por estudiante) y no se infiere del periodo.</p>
        }

        <p class="ra-nota ancho">Organización receptora, empresa, sector y ciudad: pestaña <button type="button" class="ra-ir" (click)="estado.pestana.set('organizaciones')">Organizaciones</button>.</p>

        <h2 class="seccion">Cruces</h2>
        <section class="ra-bloque ancho" aria-label="Explorador de cruces">
          <sipra-reportes-cruces />
        </section>
      </div>
    }
  `,
})
export class ReportesEstudiantesComponent implements OnInit {
  protected readonly estado = inject(ReportesEstado);
  protected readonly f = this.estado.filtros;
  protected readonly abiertas = signal<ReadonlySet<string>>(new Set());
  protected readonly pct = porcentaje;
  protected readonly nivel = nivel;
  private readonly etiqueta = new EtiquetaPipe();
  protected readonly lecturas = computed(() => {
    const r = this.estado.datos(), t = (v: string) => this.etiqueta.transform(v);
    return r ? insights.estudiantes(r, { programa: this.estado.nombrePrograma, modalidad: t, tipo: t, escuela: this.estado.nombreEscuela }) : [];
  });
  protected readonly textosJerarquia: ((v: string) => string)[] = [this.estado.nombreEscuela, this.estado.nombrePrograma, nivel, (v) => semestre(v)];
  protected readonly textoSemestre = (v: string): string => semestre(v);
  protected readonly cortoSemestre = (v: string): string => (v === '' ? '—' : v);
  protected readonly ordenSemestres = computed(() => [...new Set((this.estado.datos()?.cruces.programaSemestre ?? []).map((c) => c.columna))].sort(compararSemestres));
  /** Ejes del perfil: solo tasas 0–100 con la misma definición que el resto del reporte. */
  protected readonly ejesPerfil: EjeRadar[] = EJES_PERFIL;
  protected readonly programas = computed<ItemBarra[]>(() => (this.estado.datos()?.programas ?? []).map((p) => ({ clave: p.programa, texto: p.nombre ?? p.programa, n: p.estudiantes, detalle: [p.nombreEscuela] })));
  protected readonly niveles = computed<ParteGrafico[]>(() => {
    const r = this.estado.datos();
    if (!r) return [];
    return [...r.niveles].sort((a, b) => compararNiveles(a.ciclo, b.ciclo))
      .map((n, k) => ({ clave: n.ciclo, texto: nivel(n.ciclo), n: n.estudiantes, pct: pct1(n.estudiantes, r.facetas.ciclo.estudiantes), tono: TONOS_NIVEL[k % TONOS_NIVEL.length] }));
  });
  protected readonly semestres = computed<ItemBarra[]>(() => (this.estado.datos()?.semestres ?? [])
    .filter((x) => x.semestre !== null).map((x) => ({ clave: String(x.semestre), texto: semestre(x.semestre), n: x.estudiantes })));
  protected readonly numeroSemestre = (i: ItemBarra): string => i.clave;
  protected readonly comparado = signal('');
  protected readonly perfil = computed(() => {
    const r = this.estado.datos(), sel = this.f().programa;
    const p = r?.programas.find((x) => x.programa === sel);
    if (!r || !p) return null;
    const otro = r.programas.find((x) => x.programa === this.comparado());
    const conjunto = sumarCobertura(r.programas);
    const series: SerieRadar[] = [
      { clave: p.programa, texto: p.nombre ?? p.programa, valores: perfilDe(p), tono: 'principal' },
      otro ? { clave: otro.programa, texto: otro.nombre ?? otro.programa, valores: perfilDe(otro), tono: 'comparacion' }
        : { clave: '__conjunto__', texto: 'Conjunto del filtro', valores: perfilDe(conjunto), tono: 'comparacion' },
    ];
    return { series };
  });

  protected valor(e: Event): string { return (e.target as HTMLSelectElement).value; }
  protected filtrarRama(n: { nivel: number; clave: string }): void {
    if (n.nivel === 0) this.estado.alternar('escuela', n.clave); else this.estado.alternar('programa', n.clave);
  }
  protected semestreDe(c: string): void { if (c !== '') this.estado.alternar('semestre', c); }
  protected celdaSemestre(c: { fila: string; columna: string }): void {
    if (c.columna === '') return;
    const f = this.f();
    if (f.programa === c.fila && f.semestre === c.columna) this.estado.filtrar({ programa: '', semestre: '' });
    else this.estado.filtrar({ programa: c.fila, semestre: c.columna });
  }

  ngOnInit(): void {
    // La navegación analítica termina en la tabla granular: en Estudiantes está siempre abierta para el contexto.
    if (!this.estado.segmento()) void this.estado.abrirDetalle({});
  }

  protected ciclos(programa: string): string {
    return (this.estado.datos()?.programas.find((p) => p.programa === programa)?.ciclos ?? []).map(nivel).join(', ');
  }

  protected alternar(escuela: string): void {
    this.abiertas.update((s) => { const n = new Set(s); if (n.has(escuela)) n.delete(escuela); else n.add(escuela); return n; });
  }
}

export const EJES_PERFIL: EjeRadar[] = [
  { clave: 'cobertura', texto: 'Cobertura', definicion: 'obligaciones cargadas / exigidas' },
  { clave: 'aprobacion', texto: 'Aprobación', definicion: 'obligaciones aprobadas / exigidas' },
  { clave: 'completos', texto: 'Completos', definicion: 'expedientes completos / prácticas' },
  { clave: 'sinCorreccion', texto: 'Sin corrección', definicion: '100 − obligaciones en corrección / exigidas' },
  { clave: 'sinReenvio', texto: 'Sin reenvío', definicion: '100 − documentos con reenvío / documentos cargados' },
];

/** Perfil 0–100 de un grupo (programa o conjunto): todas tasas, null sin denominador (no se inventa un cero). */
export function perfilDe(c: Cobertura): (number | null)[] {
  const t = (n: number, d: number) => (d > 0 ? Math.round((n * 1000) / d) / 10 : null);
  const inv = (v: number | null) => (v === null ? null : Math.round((100 - v) * 10) / 10);
  return [t(c.cargados, c.exigidos), t(c.aprobados, c.exigidos), t(c.completos, c.practicas), inv(t(c.correccion, c.exigidos)), inv(t(c.conReenvio, c.documentos))];
}

/** Suma de coberturas (el «conjunto» del radar): mismas definiciones, sobre todos los programas de la faceta. */
export function sumarCobertura(grupos: readonly Cobertura[]): Cobertura {
  const z = { estudiantes: 0, practicas: 0, exigidos: 0, cargados: 0, aprobados: 0, correccion: 0, completos: 0, versiones: 0, documentos: 0, conReenvio: 0, devoluciones: 0, rechazos: 0 };
  for (const g of grupos) for (const k of Object.keys(z) as (keyof typeof z)[]) z[k] += g[k];
  return { ...z, obligaciones: { sin_cargar: 0, en_proceso: 0, en_revision: 0, correccion: 0, rechazado: 0, aprobado: 0 } };
}
