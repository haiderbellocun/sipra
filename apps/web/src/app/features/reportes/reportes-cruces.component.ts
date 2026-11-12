import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CruceAnalitica } from '@core/models/reportes-analitica.model';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { ReportesApiladasComponent } from './reportes-apiladas.component';
import { FiltrosAnalitica, RECEPTORES, SIN_DATO, TipoReceptor, compararNiveles, compararSemestres, nivel, semestre } from './reportes-analitica.util';
import { ReportesEstado } from './reportes.estado';
import { ESTILOS_REPORTES } from './reportes.estilos';

type Dimension = 'programa' | 'ciclo' | 'semestre' | 'modalidad' | 'sector' | 'ciudad' | 'tipoReceptor';
interface DefinicionCruce { id: CruceAnalitica; texto: string; filas: Dimension; columnas: Dimension; pregunta: string; requiereSemestre?: boolean }

/** Cruces disponibles (uno a la vez): cada uno responde una pregunta; no se pintan todos simultáneamente. */
export const CRUCES: readonly DefinicionCruce[] = [
  { id: 'programaModalidad', texto: 'Programa × modalidad', filas: 'programa', columnas: 'modalidad', pregunta: 'Qué programas concentran cada modalidad y cuáles son minoritarias.' },
  { id: 'programaNivel', texto: 'Programa × nivel', filas: 'programa', columnas: 'ciclo', pregunta: 'Qué programas pertenecen a cada nivel (ciclo registrado en la práctica).' },
  { id: 'nivelModalidad', texto: 'Nivel × modalidad', filas: 'ciclo', columnas: 'modalidad', pregunta: 'Qué modalidades usa cada nivel (distribución, no causalidad).' },
  { id: 'semestreModalidad', texto: 'Semestre × modalidad', filas: 'semestre', columnas: 'modalidad', pregunta: 'Cómo cambia la modalidad con el avance académico.', requiereSemestre: true },
  { id: 'programaSector', texto: 'Programa × sector', filas: 'programa', columnas: 'sector', pregunta: 'Qué sectores (sección CIIU) reciben estudiantes de cada programa.' },
  { id: 'programaCiudad', texto: 'Programa × ciudad', filas: 'programa', columnas: 'ciudad', pregunta: 'Dónde (municipio DIVIPOLA) hacen la práctica los estudiantes de cada programa.' },
  { id: 'modalidadSector', texto: 'Modalidad × sector', filas: 'modalidad', columnas: 'sector', pregunta: 'Qué sectores concentran cada modalidad.' },
  { id: 'nivelSector', texto: 'Nivel × sector', filas: 'ciclo', columnas: 'sector', pregunta: 'Sectores de cada nivel de formación.' },
  { id: 'receptorPrograma', texto: 'Interna/externa × programa', filas: 'tipoReceptor', columnas: 'programa', pregunta: 'Programas con estudiantes en práctica interna CUN o externa (distribución, no desempeño).' },
];

/**
 * Explorador de cruces (nivel 2 · análisis): un selector y una sola barra apilada a la vez, con «Ver como tabla». La fila y
 * la columna son cross-filter del contexto único; la categoría elegida se resalta y el resto se atenúa.
 */
@Component({
  selector: 'sipra-reportes-cruces',
  standalone: true,
  imports: [ReportesApiladasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .elige { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 12px; padding: 0; list-style: none; }
    .elige button { height: 30px; padding: 0 11px; font: 500 12px/1 var(--fuente); color: var(--text-secondary); background: none; border: 1px solid var(--border-subtle); border-radius: 15px; cursor: pointer; }
    .elige button[aria-pressed='true'] { color: var(--text-primary); border-color: var(--signal-active); background: color-mix(in srgb, var(--signal-active) 14%, transparent); font-weight: 600; }
    .elige button:focus-visible { outline: 2px solid var(--signal-active); outline-offset: 1px; }
    .marco { max-width: 1100px; }
  `],
  template: `
    @if (estado.datos(); as r) {
      <ul class="elige" aria-label="Cruce a analizar">
        @for (c of disponibles(); track c.id) {
          <li><button type="button" [attr.aria-pressed]="actual().id === c.id" (click)="elegido.set(c.id)">{{ c.texto }}</button></li>
        }
      </ul>
      <p class="ra-nota">{{ actual().pregunta }}</p>
      <div class="marco">
        <sipra-reportes-apiladas [titulo]="actual().texto" [rotuloFilas]="rotulo(actual().filas)" [rotuloColumnas]="rotulo(actual().columnas).toLowerCase()"
          [celdas]="r.cruces[actual().id]" [texto]="texto(actual().columnas)" [textoFila]="texto(actual().filas)" [ordenFilas]="orden(actual().filas)"
          [ordenColores]="colores(actual().columnas)" [seleccionFila]="seleccion(actual().filas)" [seleccionColumna]="seleccion(actual().columnas)"
          (elegirFila)="filtrar(actual().filas, $event)" (elegirColumna)="filtrar(actual().columnas, $event)" />
      </div>
    }
  `,
})
export class ReportesCrucesComponent {
  protected readonly estado = inject(ReportesEstado);
  protected readonly elegido = signal<CruceAnalitica>('programaModalidad');
  private readonly pipe = new EtiquetaPipe();

  protected readonly disponibles = computed(() => CRUCES.filter((c) => !c.requiereSemestre || this.estado.datos()?.dimensiones.semestre === 'sintetica'));
  protected readonly actual = computed(() => this.disponibles().find((c) => c.id === this.elegido()) ?? this.disponibles()[0]);

  private readonly filtroDe: Record<Dimension, keyof FiltrosAnalitica> = {
    programa: 'programa', ciclo: 'ciclo', semestre: 'semestre', modalidad: 'modalidad', sector: 'sector', ciudad: 'ciudad', tipoReceptor: 'tipoReceptor',
  };

  protected rotulo(d: Dimension): string {
    return { programa: 'Programa', ciclo: 'Nivel', semestre: 'Semestre', modalidad: 'Modalidad', sector: 'Sector', ciudad: 'Ciudad', tipoReceptor: 'Receptor' }[d];
  }
  protected texto(d: Dimension): (v: string) => string {
    switch (d) {
      case 'programa': return this.estado.nombrePrograma;
      case 'ciclo': return nivel;
      case 'semestre': return semestre;
      case 'modalidad': return (v) => this.pipe.transform(v);
      case 'sector': return this.estado.nombreSector;
      case 'ciudad': return this.estado.nombreCiudad;
      default: return (v) => (v ? RECEPTORES[v as TipoReceptor] ?? v : 'Sin información');
    }
  }
  protected orden(d: Dimension): ((a: string, b: string) => number) | undefined {
    return d === 'ciclo' ? compararNiveles : d === 'semestre' ? compararSemestres : undefined;
  }
  protected colores(d: Dimension): string[] | null {
    return d === 'ciclo' ? ['tecnico', 'tecnologo', 'profesional'] : d === 'semestre' ? this.estado.opciones().semestres.map(String) : null;
  }
  protected seleccion(d: Dimension): string {
    const v = this.estado.filtros()[this.filtroDe[d]];
    return typeof v === 'string' ? (v === SIN_DATO ? '' : v) : '';
  }
  /** '' en un cruce es «sin dato»: en sector/ciudad se filtra con el valor explícito; en semestre no es filtrable. */
  protected filtrar(d: Dimension, v: string): void {
    if (v === '' && (d === 'semestre' || d === 'tipoReceptor')) return;
    const valor = v === '' ? SIN_DATO : v;
    this.estado.alternar(this.filtroDe[d] as 'programa', valor as never);
  }
}
