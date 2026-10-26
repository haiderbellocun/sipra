import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { CategoriaAyuda, Practica, Pqrs, RadicarPqrs } from '@core/models/modelos';
import { EstadoComponent } from '@shared/components/estado.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { leerError } from '@shared/utils/errores';

/**
 * PQRS de Desarrollo Profesional. El estudiante radica y sigue sus
 * solicitudes; coordinación, auxiliares y administración atienden la bandeja.
 * Un segundo requerimiento abierto sobre el mismo tema se unifica con el
 * radicado inicial: la respuesta oficial va siempre allí.
 */
@Component({
  selector: 'sipra-pqrs',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink, EstadoComponent, EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .cab { display:flex; gap:var(--sp-3); align-items:flex-start; flex-wrap:wrap; margin-bottom:var(--sp-4); } .cab > div { flex:1 1 32ch; } .cab p { margin:0; }
    .dos { display:grid; gap:var(--sp-4); grid-template-columns:1fr; } @media (width >= 1000px) { .dos { grid-template-columns:1fr 1.2fr; align-items:start; } }
    .rej { display:grid; gap:0 var(--sp-3); grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr)); }
    .fila { display:flex; gap:var(--sp-3); align-items:center; padding:var(--sp-2) 0; border-bottom:1px solid var(--borde); font-size:var(--fs-sm); cursor:pointer; }
    .fila:last-child { border-bottom:0; } .fila:hover { background:var(--superficie-2); } .fila.sel { background:var(--marca-suave); }
    .fila .q { flex:1; min-width:0; } .fila .n { font-weight:600; } .fila .n span { color:var(--texto-tenue); font-weight:400; }
    .filtros { display:flex; gap:var(--sp-2); flex-wrap:wrap; align-items:flex-end; margin-bottom:var(--sp-3); } .filtros .campo { margin:0; min-width:150px; }
    .datos { display:grid; gap:var(--sp-2) var(--sp-4); grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr)); font-size:var(--fs-sm); }
    .datos .k { font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:.05em; color:var(--texto-tenue); }
    .texto { white-space:pre-line; font-size:var(--fs-sm); max-width:72ch; }
    .resp { border-left:3px solid var(--marca); padding:var(--sp-2) var(--sp-3); background:var(--superficie-2); border-radius:0 var(--r-sm) var(--r-sm) 0; margin-top:var(--sp-2); }
    .sug { margin-top:var(--sp-3); font-size:var(--fs-sm); } .sug li { margin:4px 0; }
  `],
  template: `
    <div class="cab">
      <div>
        <h1>{{ esEstudiante() ? 'Mis solicitudes (PQRS)' : 'Bandeja de PQRS' }}</h1>
        <p class="pista">
          @if (esEstudiante()) { Peticiones, quejas, reclamos y sugerencias sobre su proceso de prácticas. Antes de radicar, revise el <a routerLink="/ayuda">centro de ayuda</a>: la mayoría de las dudas ya tienen respuesta. Si envía dos solicitudes sobre el mismo tema, se unifican en el radicado inicial. }
          @else { Solicitudes de los estudiantes por categoría. La respuesta va en el radicado y le llega al estudiante por correo y en la plataforma. }
        </p>
      </div>
    </div>

    <div class="dos">
      <section class="tarjeta">
        @if (esEstudiante()) {
          <h2>Radicar una solicitud</h2>
          <div class="rej">
            <div class="campo"><label for="q-tipo">Tipo</label><select id="q-tipo" [(ngModel)]="f.tipo"><option value="peticion">Petición</option><option value="queja">Queja</option><option value="reclamo">Reclamo</option><option value="sugerencia">Sugerencia</option></select></div>
            <div class="campo"><label for="q-cat">Categoría</label><select id="q-cat" [(ngModel)]="f.categoria"><option value="">Seleccione…</option>@for (c of categorias(); track c.clave) { <option [value]="c.clave">{{ c.etiqueta }}</option> }</select></div>
          </div>
          @if (practica(); as p) { <p class="pista">Se asocia a su práctica {{ p.modalidad | etiqueta }} · {{ p.periodoAcademico }}.</p> }
          <div class="campo"><label for="q-asu">Asunto</label><input id="q-asu" [(ngModel)]="f.asunto" maxlength="160" placeholder="Resuma su solicitud en una línea" [attr.aria-invalid]="f.asunto.length > 0 && f.asunto.trim().length < 5 ? 'true' : null" />
              @if (f.asunto.length > 0 && f.asunto.trim().length < 5) { <span class="error-campo">El asunto necesita al menos 5 caracteres.</span> } @else { <span class="pista">{{ f.asunto.length }}/160</span> }</div>
          <div class="campo"><label for="q-desc">Descripción</label><textarea id="q-desc" [(ngModel)]="f.descripcion" rows="5" placeholder="Explique claramente el inconveniente: qué intentó, qué mensaje vio, fechas y documentos involucrados." [attr.aria-invalid]="f.descripcion.length > 0 && f.descripcion.trim().length < 20 ? 'true' : null"></textarea>
              @if (f.descripcion.length > 0 && f.descripcion.trim().length < 20) { <span class="error-campo">Faltan {{ 20 - f.descripcion.trim().length }} caracteres para describir el caso.</span> } @else { <span class="pista">{{ f.descripcion.length }}/4000</span> }</div>
          <div class="acciones">
            <button type="button" class="boton boton--primario" [class.cargando]="guardando()" [disabled]="guardando() || !f.categoria || f.asunto.trim().length < 5 || f.descripcion.trim().length < 20" (click)="radicar()">Radicar</button>
            @if (f.categoria) { <a class="boton" routerLink="/ayuda" [queryParams]="{ categoria: f.categoria }">Ver la ayuda de esta categoría</a> }
          </div>
          @if (lista().length) {
            <h3 style="margin-top:var(--sp-4)">Mis radicados</h3><div class="escalonado">
            @for (s of lista(); track s.id) {
              <div class="fila" [class.sel]="seleccion()?.id === s.id" (click)="seleccion.set(s)" (keyup.enter)="seleccion.set(s)" tabindex="0" role="button">
                <div class="q"><div class="n">n.º {{ s.radicado }} <span>· {{ s.asunto }}</span></div><div class="pista">{{ s.categoriaEtiqueta }} · {{ s.radicadaEn | date: 'd MMM y' }}</div></div>
                <sipra-estado [valor]="s.estado" />
              </div>
            }
            </div>
          }
        } @else {
          <h2>Solicitudes</h2>
          <div class="filtros">
            <div class="campo"><label for="f-est">Estado</label><select id="f-est" [(ngModel)]="filtroEstado" (ngModelChange)="cargarLista()"><option value="">Abiertas y respondidas</option><option value="radicada">Radicadas</option><option value="en_tramite">En trámite</option><option value="respondida">Respondidas</option><option value="cerrada">Cerradas</option><option value="unificada">Unificadas</option></select></div>
            <div class="campo"><label for="f-cat">Categoría</label><select id="f-cat" [(ngModel)]="filtroCategoria" (ngModelChange)="cargarLista()"><option value="">Todas</option>@for (c of categorias(); track c.clave) { <option [value]="c.clave">{{ c.etiqueta }}</option> }</select></div>
          </div>
          @if (visibles().length === 0) { <div class="vacio">Sin solicitudes con ese filtro.</div> }
          @for (s of visibles(); track s.id) {
            <div class="fila" [class.sel]="seleccion()?.id === s.id" (click)="seleccionar(s)" (keyup.enter)="seleccionar(s)" tabindex="0" role="button">
              <div class="q"><div class="n">n.º {{ s.radicado }} <span>· {{ s.estudiante?.nombre ?? s.estudianteId }}</span></div>
                <div class="pista">{{ s.tipo | etiqueta }} · {{ s.categoriaEtiqueta }} · {{ s.radicadaEn | date: 'd MMM y' }}</div></div>
              <sipra-estado [valor]="s.estado" />
            </div>
          }
        }
      </section>

      <section class="tarjeta">
        @if (!seleccion()) {
          <div class="vacio"><img src="assets/ilustraciones/documentos.svg" alt="" width="600" height="360" /><span>{{ esEstudiante() ? 'Aquí verá la respuesta a su solicitud.' : 'Seleccione una solicitud para atenderla.' }}</span></div>
        } @else if (seleccion(); as s) {
          <div style="display:flex;gap:var(--sp-2);align-items:center;flex-wrap:wrap;margin-bottom:var(--sp-3)">
            <h2 style="margin:0;flex:1">Radicado n.º {{ s.radicado }}</h2><sipra-estado [valor]="s.estado" />
          </div>
          <div class="datos">
            <div><div class="k">Estudiante</div>{{ s.estudiante?.nombre ?? '—' }}<div class="pista">{{ s.estudiante?.correo }}</div></div>
            <div><div class="k">Tipo y categoría</div>{{ s.tipo | etiqueta }}<div class="pista">{{ s.categoriaEtiqueta }}</div></div>
            <div><div class="k">Radicada</div>{{ s.radicadaEn | date: 'd MMM y, HH:mm' }}@if (s.respondidaEn) { <div class="pista">respondida {{ s.respondidaEn | date: 'd MMM y, HH:mm' }}</div> }</div>
            @if (s.practicaId) { <div><div class="k">Práctica</div><a [routerLink]="['/practicas', s.practicaId]">Abrir el expediente</a></div> }
          </div>
          <h3 style="margin-top:var(--sp-4)">{{ s.asunto }}</h3>
          <div class="texto">{{ s.descripcion }}</div>

          @if (s.estado === 'unificada') {
            <div class="aviso aviso--info" style="margin-top:var(--sp-3)">{{ s.respuesta }} @if (s.unificadaConRadicado) { <a href="#" (click)="$event.preventDefault(); irA(s.unificadaConId)">Ver el radicado n.º {{ s.unificadaConRadicado }}</a> }</div>
          } @else if (s.respuesta) {
            <div class="resp"><div class="k pista" style="font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.05em">Respuesta</div><div class="texto">{{ s.respuesta }}</div></div>
          } @else if (esEstudiante()) {
            <p class="pista" style="margin-top:var(--sp-3)">Su solicitud está {{ (s.estado | etiqueta).toLowerCase() }}. Le avisaremos por correo cuando haya respuesta.</p>
          }

          @if (esEstudiante() && s.sugerencias?.length) {
            <div class="sug"><strong>Mientras tanto, estas respuestas de la ayuda pueden servirle:</strong>
              <ul>@for (p of s.sugerencias; track p.numero) { <li><a routerLink="/ayuda" [queryParams]="{ categoria: p.categoria, pregunta: p.numero }">{{ p.pregunta }}</a></li> }</ul></div>
          }

          @if (puedeAtender() && s.estado !== 'cerrada' && s.estado !== 'unificada') {
            <div style="margin-top:var(--sp-4);padding-top:var(--sp-3);border-top:1px solid var(--borde)">
              <h3>{{ s.respuesta ? 'Complementar la respuesta' : 'Responder' }}</h3>
              <div class="campo"><label for="r-txt">Respuesta al estudiante</label><textarea id="r-txt" [(ngModel)]="respuesta" rows="4"></textarea></div>
              <div class="acciones">
                @if (s.estado === 'radicada') { <button type="button" class="boton compacto" [disabled]="guardando()" (click)="tomar(s)">Marcar en trámite</button> }
                <button type="button" class="boton boton--primario" [class.cargando]="guardando()" [disabled]="guardando() || respuesta().trim().length < 10" (click)="responder(s)">Enviar respuesta</button>
                @if (s.estado === 'respondida') { <button type="button" class="boton" [disabled]="guardando()" (click)="cerrar(s)">Cerrar</button> }
              </div>
            </div>
          }
          @if (esEstudiante() && s.estado === 'respondida') {
            <div class="acciones" style="margin-top:var(--sp-3)"><button type="button" class="boton compacto" [disabled]="guardando()" (click)="cerrar(s)">Quedé conforme, cerrar</button></div>
          }
        }
      </section>
    </div>
  `,
})
export class PqrsComponent implements OnInit {
  readonly sesion = inject(SesionService);
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly ruta = inject(ActivatedRoute);

  readonly categorias = signal<CategoriaAyuda[]>([]);
  readonly lista = signal<Pqrs[]>([]);
  readonly seleccion = signal<Pqrs | null>(null);
  readonly practica = signal<Practica | null>(null);
  readonly guardando = signal(false);
  readonly filtroEstado = signal('');
  readonly filtroCategoria = signal('');
  readonly respuesta = signal('');
  readonly f: RadicarPqrs = { tipo: 'peticion', categoria: '', asunto: '', descripcion: '' };

  readonly esEstudiante = computed(() => this.sesion.rol() === 'estudiante');
  readonly puedeAtender = computed(() => ['coordinador', 'auxiliar', 'administrador'].includes(this.sesion.rol() ?? ''));
  readonly visibles = computed(() => (this.filtroEstado() ? this.lista() : this.lista().filter((s) => s.estado !== 'cerrada' && s.estado !== 'unificada')));

  async ngOnInit(): Promise<void> {
    this.f.categoria = (this.ruta.snapshot.queryParamMap.get('categoria') ?? '') as RadicarPqrs['categoria'];
    void firstValueFrom(this.api.categoriasAyuda()).then((c) => this.categorias.set(c)).catch(() => undefined);
    if (this.esEstudiante()) {
      const propias = await firstValueFrom(this.api.listarPracticas()).catch(() => [] as Practica[]);
      this.practica.set(propias.filter((p) => !['certificada', 'cancelada', 'anulada', 'reprobada'].includes(p.estado))[0] ?? null);
    }
    await this.cargarLista();
    if (this.esEstudiante()) this.seleccion.set(this.lista()[0] ?? null);
  }

  async cargarLista(): Promise<void> {
    try {
      this.lista.set(await firstValueFrom(this.api.listarPqrs({ estado: this.filtroEstado() || undefined, categoria: this.filtroCategoria() || undefined })));
      const sel = this.seleccion();
      if (sel) this.seleccion.set(this.lista().find((s) => s.id === sel.id) ?? sel);
    } catch (error) { this.avisos.error(leerError(error)); }
  }

  seleccionar(s: Pqrs): void { this.seleccion.set(s); this.respuesta.set(''); }
  irA(id: string | null): void { const s = this.lista().find((x) => x.id === id); if (s) this.seleccion.set(s); }

  async radicar(): Promise<void> {
    await this.ejecutar(async () => {
      const s = await firstValueFrom(this.api.radicarPqrs({ ...this.f, practicaId: this.practica()?.id ?? null }));
      this.f.asunto = ''; this.f.descripcion = '';
      await this.cargarLista(); this.seleccion.set(s);
      return s.estado === 'unificada'
        ? `Ya tenía un radicado abierto sobre este tema: su solicitud se unificó con el n.º ${s.unificadaConRadicado}.`
        : `Radicado n.º ${s.radicado} recibido. Le enviamos la confirmación al correo institucional.`;
    });
  }

  async tomar(s: Pqrs): Promise<void> { await this.ejecutar(async () => { this.seleccion.set(await firstValueFrom(this.api.tomarPqrs(s.id))); await this.cargarLista(); return 'Solicitud en trámite.'; }); }

  async responder(s: Pqrs): Promise<void> {
    await this.ejecutar(async () => {
      this.seleccion.set(await firstValueFrom(this.api.responderPqrs(s.id, this.respuesta().trim())));
      this.respuesta.set(''); await this.cargarLista();
      return 'Respuesta enviada; el estudiante la recibe por correo y en la plataforma.';
    });
  }

  async cerrar(s: Pqrs): Promise<void> { await this.ejecutar(async () => { this.seleccion.set(await firstValueFrom(this.api.cerrarPqrs(s.id))); await this.cargarLista(); return 'Solicitud cerrada.'; }); }

  private async ejecutar(accion: () => Promise<string>): Promise<void> {
    this.guardando.set(true);
    try { this.avisos.exito(await accion()); }
    catch (error) { this.avisos.error(leerError(error)); }
    finally { this.guardando.set(false); }
  }
}
