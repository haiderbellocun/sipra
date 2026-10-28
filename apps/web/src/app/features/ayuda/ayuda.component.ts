import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { EsqueletoComponent } from '@shared/components/esqueleto.component';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { CategoriaAyuda, PreguntaFrecuente } from '@core/models/modelos';
import { leerError } from '@shared/utils/errores';

/**
 * Centro de ayuda: las 123 preguntas y respuestas de Desarrollo Profesional,
 * organizadas en las mismas dieciséis categorías del formulario de PQRS. Se
 * abre desde cualquier pantalla con `?categoria=` para llegar al tema justo.
 */
@Component({
  selector: 'sipra-ayuda',
  standalone: true,
  imports: [EsqueletoComponent, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .cab { display:flex; gap:var(--sp-3); align-items:flex-start; flex-wrap:wrap; margin-bottom:var(--sp-4); } .cab > div { flex:1 1 32ch; } .cab p { margin:0; }
    .buscar { display:flex; gap:var(--sp-2); align-items:center; margin-bottom:var(--sp-4); }
    .buscar input { flex:1; min-width:0; font:inherit; font-size:var(--fs-md); padding:var(--sp-2) var(--sp-4); min-height:44px; border:1px solid var(--borde-campo); border-radius:var(--r-sm); background:var(--superficie); color:inherit; }
    .dos { display:grid; gap:var(--sp-4); grid-template-columns:1fr; } @media (width >= 900px) { .dos { grid-template-columns:260px minmax(0,1fr); align-items:start; } }
    /* Índice de categorías: se queda a la vista mientras se lee la respuesta y se desplaza por dentro si es largo. */
    @media (width >= 900px) { .cats { position:sticky; top:calc(var(--alto-cinta, 0px) + 62px + 12px); max-height:calc(100dvh - 140px); overflow:auto; overscroll-behavior:contain; } }
    @media (width < 900px) { .cats.cats { flex-direction:row; flex-wrap:nowrap; overflow-x:auto; gap:var(--sp-1); } .cats.cats button { white-space:nowrap; flex:none; border:1px solid var(--borde); min-height:44px; align-items:center; } }
    .mas { display:flex; justify-content:center; padding-top:var(--sp-3); }
    .cats { display:flex; flex-direction:column; gap:2px; } .cats button { all:unset; cursor:pointer; display:flex; justify-content:space-between; gap:var(--sp-2); padding:7px 10px; border-radius:var(--r-sm); font-size:var(--fs-sm); }
    .cats button:hover { background:var(--superficie-2); } .cats button.sel { background:var(--marca-suave); color:var(--marca); font-weight:600; }
    .cats button:focus-visible { outline:2px solid var(--marca); } .cats .n { color:var(--texto-tenue); font-variant-numeric:tabular-nums; font-size:var(--fs-xs); white-space:nowrap; flex:none; }
    .preg { border-bottom:1px solid var(--borde); } .preg:last-child { border-bottom:0; }
    .preg summary { cursor:pointer; padding:var(--sp-3) 0; font-weight:600; font-size:var(--fs-sm); list-style:none; display:flex; gap:var(--sp-2); }
    .preg summary::-webkit-details-marker { display:none; } .preg summary::before { content:"+"; color:var(--marca); width:1em; flex:none; }
    .preg[open] summary::before { content:"–"; } .preg .r { padding:0 0 var(--sp-3) calc(1em + var(--sp-2)); font-size:var(--fs-sm); white-space:pre-line; max-width:72ch; }
    .preg .c { font-size:var(--fs-xs); color:var(--texto-tenue); margin-left:auto; font-weight:400; white-space:nowrap; }
    mark { background:var(--marca-suave); color:inherit; }
  `],
  template: `
    <div class="cab">
      <div>
        <h1>Centro de ayuda</h1>
        <p class="pista">Preguntas y respuestas de Desarrollo Profesional sobre el proceso de prácticas. Si no encuentra su caso,
          @if (puedeRadicar()) { <a routerLink="/pqrs" [queryParams]="{ categoria: categoria() || null }">radique una PQRS</a> } @else { escriba a desarrollo_profesional&#64;cun.edu.co }.</p>
      </div>
    </div>
    <div class="buscar">
      <input type="search" [ngModel]="texto()" (ngModelChange)="texto.set($event); buscar()" placeholder="Busque: ARL, carta, acta, nota…" aria-label="Buscar en la ayuda" />
    </div>
    <div class="dos">
      <nav class="tarjeta cats escalonado" aria-label="Categorías">
        <button type="button" [class.sel]="!categoria()" (click)="elegir('')"><span>Todas las categorías</span><span class="n">{{ total() }}</span></button>
        @for (c of categorias(); track c.clave) {
          <button type="button" [class.sel]="categoria() === c.clave" (click)="elegir(c.clave)"><span>{{ c.etiqueta }}</span><span class="n">{{ cuenta(c.clave) }}</span></button>
        }
      </nav>
      <section class="tarjeta">
        @if (cargando()) { <sipra-esqueleto tipo="filas" [cantidad]="6" /> }
        @else if (resultados().length === 0) { <div class="vacio"><img src="assets/ilustraciones/sinresultados.svg" alt="" width="600" height="360" /><strong>Sin resultados</strong><span>Ninguna pregunta coincide. Pruebe con otra palabra o <a routerLink="/pqrs">radique su consulta</a>.</span><button type="button" class="boton compacto" (click)="texto.set(''); elegir('')">Limpiar la búsqueda</button></div> }
        @else {
          <p class="pista" style="margin:0 0 var(--sp-2)">{{ resultados().length }} {{ resultados().length === 1 ? 'pregunta' : 'preguntas' }}@if (categoria()) { · {{ etiqueta(categoria()) }} }</p>
          @for (p of visibles(); track p.numero) {
            <details class="preg" [open]="resultados().length <= 3 || destacada() === p.numero">
              <summary><span>{{ p.pregunta }}</span>@if (!categoria()) { <span class="c">{{ etiqueta(p.categoria) }}</span> }</summary>
              <div class="r">{{ p.respuesta }}</div>
            </details>
          }
          @if (visibles().length < resultados().length) {
            <div class="mas"><button type="button" class="boton" (click)="limite.set(limite() + PASO)">Mostrar más ({{ resultados().length - visibles().length }} restantes)</button></div>
          }
        }
      </section>
    </div>
  `,
})
export class AyudaComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly ruta = inject(ActivatedRoute);
  readonly sesion = inject(SesionService);

  readonly categorias = signal<CategoriaAyuda[]>([]);
  readonly todas = signal<PreguntaFrecuente[]>([]);
  readonly resultados = signal<PreguntaFrecuente[]>([]);
  readonly categoria = signal('');
  readonly texto = signal('');
  readonly destacada = signal<number | null>(null);
  readonly cargando = signal(true);
  /** Sin categoría ni búsqueda, la lista completa (más de cien preguntas) se muestra por tandas, no de golpe. */
  readonly PASO = 15;
  readonly limite = signal(15);
  readonly visibles = computed(() => (this.categoria() || this.texto().trim() ? this.resultados() : this.resultados().slice(0, this.limite())));
  readonly total = computed(() => this.todas().length);
  readonly conteo = computed(() => this.todas().reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.categoria]: (acc[p.categoria] ?? 0) + 1 }), {}));
  readonly puedeRadicar = computed(() => this.sesion.rol() === 'estudiante');
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    const q = this.ruta.snapshot.queryParamMap;
    this.categoria.set(q.get('categoria') ?? '');
    this.texto.set(q.get('texto') ?? '');
    const n = Number(q.get('pregunta'));
    if (n) this.destacada.set(n);
    try {
      const [categorias, todas] = await Promise.all([firstValueFrom(this.api.categoriasAyuda()), firstValueFrom(this.api.buscarPreguntas(''))]);
      this.categorias.set(categorias); this.todas.set(todas);
      // Sin pedir un tema, se abre en la primera categoría: una lista corta y un índice, no 123 preguntas seguidas.
      if (!this.categoria() && !this.texto() && categorias.length > 0) this.categoria.set(categorias[0].clave);
      await this.consultar();
    } catch (error) { this.avisos.error(leerError(error)); }
    finally { this.cargando.set(false); }
  }

  elegir(clave: string): void { this.categoria.set(clave); this.limite.set(this.PASO); void this.consultar(); }

  buscar(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => void this.consultar(), 250);
  }

  cuenta(clave: string): number { return this.conteo()[clave] ?? 0; }

  etiqueta(clave: string): string { return this.categorias().find((c) => c.clave === clave)?.etiqueta ?? clave; }

  private async consultar(): Promise<void> {
    try { this.resultados.set(await firstValueFrom(this.api.buscarPreguntas(this.texto().trim(), this.categoria() || undefined))); }
    catch (error) { this.avisos.error(leerError(error)); }
  }
}
