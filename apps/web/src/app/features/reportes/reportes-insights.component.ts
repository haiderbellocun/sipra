import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CATEGORIAS_EXPEDIENTE, ReporteAnalitica, horas, nivel, pct1, segunOrden } from './reportes-analitica.util';
import { ESTILOS_REPORTES } from './reportes.estilos';

/** Máximo de lecturas por pestaña: dos frases cortas, no un párrafo. */
export const MAX_INSIGHTS = 2;

type Nombres = { programa: (c: string) => string; modalidad: (c: string) => string; tipo: (c: string) => string; escuela: (c: string) => string };

/**
 * Lecturas deterministas (reglas fijas sobre las cifras de la respuesta; sin IA, sin causalidad). Cada regla exige su
 * denominador y un mínimo de volumen; si no se cumple, la frase no aparece. Siempre dentro del universo de su gráfica.
 */
export const insights = {
  general(r: ReporteAnalitica, n: Nombres): string[] {
    const s: string[] = [];
    const [top] = [...r.niveles].sort((a, b) => b.estudiantes - a.estudiantes);
    if (top && r.facetas.ciclo.estudiantes > 0) s.push(`${nivel(top.ciclo)} concentra el ${pct1(top.estudiantes, r.facetas.ciclo.estudiantes)} de los estudiantes.`);
    // Modalidad con mayor proporción de expedientes que requieren corrección (mínimo 20 prácticas para no leer ruido).
    const porMod = new Map<string, { t: number; c: number }>();
    for (const c of r.cruces.modalidadSituacion) {
      const m = porMod.get(c.fila) ?? { t: 0, c: 0 };
      m.t += c.practicas; if (c.columna === 'requiere_correccion') m.c += c.practicas;
      porMod.set(c.fila, m);
    }
    const [peor] = [...porMod.entries()].filter(([, m]) => m.t >= 20).sort((a, b) => b[1].c / b[1].t - a[1].c / a[1].t || a[0].localeCompare(b[0]));
    const etiqueta = CATEGORIAS_EXPEDIENTE.find((c) => c.clave === 'requiere_correccion')?.texto.toLowerCase();
    if (peor && peor[1].c > 0) s.push(`${n.modalidad(peor[0])} tiene la mayor proporción de expedientes que ${etiqueta === 'requiere corrección' ? 'requieren corrección' : etiqueta} (${pct1(peor[1].c, peor[1].t)}).`);
    return s.slice(0, MAX_INSIGHTS);
  },
  estudiantes(r: ReporteAnalitica, n: Nombres): string[] {
    const s: string[] = [];
    const [p] = r.programas;
    if (p && r.facetas.programa.estudiantes > 0) s.push(`${p.nombre ?? n.programa(p.programa)} reúne el ${pct1(p.estudiantes, r.facetas.programa.estudiantes)} de los estudiantes del filtro.`);
    const [e] = [...r.escuelas].sort((a, b) => b.estudiantes - a.estudiantes);
    if (e && r.resumen.estudiantes > 0 && r.escuelas.length > 1) s.push(`${e.nombre} agrupa ${e.programas.length} programa${e.programas.length === 1 ? '' : 's'} y el ${pct1(e.estudiantes, r.resumen.estudiantes)} de los estudiantes.`);
    return s.slice(0, MAX_INSIGHTS);
  },
  documentos(r: ReporteAnalitica, n: Nombres): string[] {
    const s: string[] = [];
    const [t] = [...r.porTipo].sort((a, b) => (b.correccion + b.rechazado) - (a.correccion + a.rechazado) || a.tipo.localeCompare(b.tipo));
    if (t && t.correccion + t.rechazado > 0) s.push(`${n.tipo(t.tipo)} acumula ${t.correccion + t.rechazado} obligaciones en corrección o rechazo (${pct1(t.correccion + t.rechazado, t.exigidos)} de sus exigidas).`);
    if (r.tiempos.decisiones >= 20 && r.tiempos.medianaHoras !== null && r.tiempos.p90Horas !== null) {
      s.push(`La mitad de las decisiones se toma en menos de ${horas(r.tiempos.medianaHoras)}; el 10 % tarda más de ${horas(r.tiempos.p90Horas)}.`);
    }
    return s.slice(0, MAX_INSIGHTS);
  },
  periodos(r: ReporteAnalitica, n: Nombres): string[] {
    const s: string[] = [];
    const sinFecha = new Set(r.periodosSinFecha);
    const orden = [...r.periodos].filter((p) => !sinFecha.has(p.periodo)).sort((a, b) => segunOrden(r.ordenPeriodos)(a.periodo, b.periodo));
    if (orden.length >= 2) {
      const a = orden.at(-2)!, b = orden.at(-1)!;
      const ta = a.exigidos ? (a.cargados * 100) / a.exigidos : null, tb = b.exigidos ? (b.cargados * 100) / b.exigidos : null;
      if (ta !== null && tb !== null) s.push(`La cobertura documental pasó de ${pct1(a.cargados, a.exigidos)} en ${a.periodo} a ${pct1(b.cargados, b.exigidos)} en ${b.periodo}.`);
      // Programa que más estudiantes ganó entre el primer y el último periodo con fecha (volumen, no puesto).
      const de = (periodo: string) => new Map(r.cruces.periodoPrograma.filter((c) => c.fila === periodo).map((c) => [c.columna, c.estudiantes]));
      const p0 = de(orden[0].periodo), p1 = de(b.periodo);
      const [mejor] = [...new Set([...p0.keys(), ...p1.keys()])].map((k) => ({ k, a: p0.get(k) ?? 0, z: p1.get(k) ?? 0 })).map((x) => ({ ...x, d: x.z - x.a }))
        .sort((x, y) => y.d - x.d || x.k.localeCompare(y.k));
      if (mejor && mejor.d > 0) s.push(`${n.programa(mejor.k)} pasó de ${mejor.a} a ${mejor.z} estudiantes entre ${orden[0].periodo} y ${b.periodo}.`);
    }
    return s.slice(0, MAX_INSIGHTS);
  },
};

/** Franja de lecturas de una pestaña: acento selectivo en el borde, texto en tinta normal (no un párrafo coloreado). */
@Component({
  selector: 'sipra-reportes-insights',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [ESTILOS_REPORTES, `
    .in { display: flex; flex-wrap: wrap; gap: 8px 28px; margin: 0 0 22px; padding: 0; list-style: none; }
    .in li { display: flex; gap: 10px; align-items: baseline; max-width: 64ch; font-size: 13px; line-height: 19px; color: var(--text-primary); }
    .in li::before { content: ''; flex: none; width: 3px; height: 14px; border-radius: 2px; background: var(--zona, var(--bi-blue)); transform: translateY(2px); }
    .in-t { font: 600 11px/16px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); margin: 0 0 6px; }
  `],
  template: `
    @if (lineas().length) {
      <p class="in-t" id="ins-t">Lecturas</p>
      <ul class="in" aria-labelledby="ins-t">@for (l of lineas(); track l) { <li>{{ l }}</li> }</ul>
    }
  `,
})
export class ReportesInsightsComponent {
  readonly lineas = input.required<string[]>();
}
