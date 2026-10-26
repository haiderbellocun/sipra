import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Periodo } from '@core/models/modelos';

interface Hito { clave: string; etiqueta: string; fecha: string | null; detalle: string; estado: 'pasado' | 'hoy' | 'proximo' | 'sin_fecha' }

/**
 * Fechas clave del proceso en el periodo, tal como las publica el Área de
 * Prácticas: inicio, límite para registrar y solicitar la ARL (dos meses),
 * jornadas de inducción, fecha de cargue de documentos y cierre.
 */
@Component({
  selector: 'sipra-cronograma',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display:block; }
    .cab { display:flex; gap:var(--sp-2); align-items:baseline; flex-wrap:wrap; margin-bottom:var(--sp-2); }
    .cab h3 { margin:0; font-size:var(--fs-md); } .cab .pista { flex:1; }
    ol { list-style:none; margin:0; padding:0; display:grid; gap:0; }
    li { display:grid; grid-template-columns:14px minmax(0,1fr); gap:var(--sp-3); position:relative; padding-bottom:var(--sp-3); }
    li:last-child { padding-bottom:0; }
    li::before { content:""; position:absolute; left:6px; top:14px; bottom:-2px; width:2px; background:var(--borde); }
    li:last-child::before { display:none; }
    .pt { width:14px; height:14px; border-radius:50%; border:2px solid var(--borde); background:var(--superficie); margin-top:3px; }
    .pasado .pt { background:var(--borde); } .hoy .pt { border-color:var(--marca); background:var(--marca); box-shadow:0 0 0 3px var(--marca-suave); }
    .proximo .pt { border-color:var(--marca); }
    .f { font-variant-numeric:tabular-nums; font-weight:600; font-size:var(--fs-sm); display:flex; gap:var(--sp-2); align-items:baseline; flex-wrap:wrap; }
    .pasado .f { color:var(--texto-tenue); font-weight:500; }
    .e { font-size:var(--fs-sm); } .d { font-size:var(--fs-xs); color:var(--texto-tenue); }
    .falta { font-size:var(--fs-xs); font-weight:500; color:var(--marca); }
    .pasado .falta { color:var(--texto-tenue); }
  `],
  template: `
    @if (periodo(); as p) {
      <div class="cab"><h3>Cronograma {{ p.codigo }}</h3><span class="pista">{{ p.nombre }}</span></div>
      <ol>
        @for (h of hitos(); track h.clave) {
          <li [class]="h.estado">
            <span class="pt" aria-hidden="true"></span>
            <div>
              <div class="f">{{ h.fecha ? fecha(h.fecha) : 'Por definir' }} @if (restante(h); as r) { <span class="falta">{{ r }}</span> }</div>
              <div class="e">{{ h.etiqueta }}</div>
              <div class="d">{{ h.detalle }}</div>
            </div>
          </li>
        }
      </ol>
    }
  `,
})
export class CronogramaComponent {
  readonly periodo = input<Periodo | null>(null);
  /** Qué hitos resaltar: el estudiante que registra mira el límite; el de ARL, la solicitud. */
  readonly hoy = input<string>(new Date().toISOString().slice(0, 10));

  readonly hitos = computed<Hito[]>(() => {
    const p = this.periodo();
    if (!p) return [];
    const c = p.cronograma;
    const base: Omit<Hito, 'estado'>[] = [
      { clave: 'inicio', etiqueta: 'Inicio del periodo académico', fecha: c.inicio, detalle: 'Abre el registro de la práctica y la solicitud de ARL.' },
      ...c.jornadasInduccion.map((j, i) => ({
        clave: `induccion-${i}`, etiqueta: `Jornada de inducción ${c.jornadasInduccion.length > 1 ? i + 1 : ''}`.trim(), fecha: j,
        detalle: 'Presentación del proceso, modalidades y plataforma. Asista a una de las jornadas.',
      })),
      { clave: 'limite', etiqueta: 'Último día para registrar la práctica y solicitar la ARL', fecha: c.limiteRegistro,
        detalle: 'Dos meses después del inicio. Después de esta fecha solo coordinación atiende excepciones.' },
      { clave: 'cargue', etiqueta: 'Fecha de cargue de documentos finales', fecha: c.fechaCargueDocumentos,
        detalle: 'Seguimiento final, carta de finalización y los pendientes del expediente.' },
      { clave: 'cierre', etiqueta: 'Cierre del periodo académico', fecha: c.cierre, detalle: 'La nota se reporta a SINU entre diez y quince días hábiles después del cierre de la práctica.' },
    ];
    const hoy = this.hoy();
    return base
      .sort((a, b) => (a.fecha ?? '9999').localeCompare(b.fecha ?? '9999'))
      .map((h) => ({ ...h, estado: !h.fecha ? 'sin_fecha' : h.fecha < hoy ? 'pasado' : h.fecha === hoy ? 'hoy' : 'proximo' }));
  });

  fecha(iso: string): string {
    const f = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
    return f.charAt(0).toUpperCase() + f.slice(1);
  }

  restante(h: Hito): string | null {
    if (!h.fecha || h.estado === 'pasado') return null;
    if (h.estado === 'hoy') return 'hoy';
    const dias = Math.round((Date.parse(`${h.fecha}T00:00:00Z`) - Date.parse(`${this.hoy()}T00:00:00Z`)) / 86_400_000);
    if (dias > 60 || !['limite', 'cargue'].includes(h.clave)) return null;
    return dias === 1 ? 'falta 1 día' : `faltan ${dias} días`;
  }
}
