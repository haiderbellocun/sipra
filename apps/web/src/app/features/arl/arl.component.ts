import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { CatalogoProceso, ConsolidadoArl, Periodo, Practica, RadicarArl, SolicitudArl } from '@core/models/modelos';
import { CronogramaComponent } from '@shared/components/cronograma.component';
import { EstadoComponent } from '@shared/components/estado.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { leerError } from '@shared/utils/errores';

/**
 * Portal de gestión de ARL dentro de SIPRA. El estudiante radica y sigue su
 * solicitud; el auxiliar de prácticas (y docente/coordinación) la valida con
 * la recomendación automática delante, decide con los motivos del manual y
 * remite el certificado, que queda en el expediente.
 */
@Component({
  selector: 'sipra-arl',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink, EstadoComponent, EtiquetaPipe, CronogramaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .cab { display:flex; gap:var(--sp-3); align-items:flex-start; flex-wrap:wrap; margin-bottom:var(--sp-4); } .cab > div { flex:1 1 30ch; } .cab p { margin:0; }
    .dos { display:grid; gap:var(--sp-4); grid-template-columns:1fr; } @media (width >= 1000px) { .dos { grid-template-columns:1fr 1.3fr; align-items:start; } }
    .rej { display:grid; gap:0 var(--sp-3); grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr)); }
    .fila { display:flex; gap:var(--sp-3); align-items:center; padding:var(--sp-2) 0; border-bottom:1px solid var(--borde); font-size:var(--fs-sm); cursor:pointer; }
    .fila:last-child { border-bottom:0; } .fila:hover { background:var(--superficie-2); } .fila.sel { background:var(--marca-suave); }
    .fila .q { flex:1; min-width:0; } .fila .n { font-weight:600; }
    .crit { display:grid; grid-template-columns:auto 1fr; gap:var(--sp-1) var(--sp-3); font-size:var(--fs-sm); align-items:start; margin:0; }
    .crit dt { white-space:nowrap; } .crit dd { margin:0; } .crit .d { color:var(--texto-tenue); font-size:var(--fs-xs); }
    .datos { display:grid; gap:var(--sp-2) var(--sp-4); grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr)); font-size:var(--fs-sm); }
    .datos .k { font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:.05em; color:var(--texto-tenue); }
    .motivos label { display:flex; gap:6px; align-items:flex-start; font-size:var(--fs-sm); padding:2px 0; }
    .filtros { display:flex; gap:var(--sp-2); flex-wrap:wrap; align-items:flex-end; margin-bottom:var(--sp-3); } .filtros .campo { margin:0; min-width:150px; }
    .conso { font-size:var(--fs-sm); } .conso h4 { margin:var(--sp-3) 0 var(--sp-1); }
  `],
  template: `
    <div class="cab">
      <div>
        <h1>{{ esEstudiante() ? 'Solicitud de afiliación a ARL' : 'Portal de gestión de ARL' }}</h1>
        <p class="pista">
          @if (esEstudiante()) { Solo para prácticas articuladas (dentro de la CUN), del tercer sector u organizaciones con cobertura acordada. Radique con al menos cinco días hábiles de anticipación al inicio; el certificado llega a su correo y queda en su expediente entre tres y cinco días hábiles. }
          @else { Validación de los soportes (EPS, identificación y acta o RUT/Cámara) con la recomendación automática del manual. La decisión es suya; las aprobadas van a Capital Social en el consolidado diario. }
        </p>
      </div>
    </div>


    <div class="dos">
      <!-- ── Izquierda: radicar (estudiante) o bandeja (internos) ─────── -->
      <section class="tarjeta">
        @if (esEstudiante()) {
          <h2>Radicar solicitud</h2>
          @if (!practica()) {
            <div class="vacio">Primero registre su práctica en <a routerLink="/registro">Registrar mi práctica</a>.</div>
          } @else if (practica(); as p) {
            @if (vigente()) {
              <div class="aviso aviso--info">Ya tiene la solicitud n.º {{ vigente()?.consecutivo }} en trámite. Puede consultarla a la derecha.</div>
            } @else if (p.arlVerificada) {
              <div class="aviso aviso--ok">Su práctica ya tiene la afiliación a ARL registrada.</div>
            } @else {
              <p class="pista">Práctica: <strong>{{ p.modalidad | etiqueta }}</strong> · {{ p.periodoAcademico }} · del {{ p.fechaInicio | date: 'd MMM' }} al {{ p.fechaFin | date: 'd MMM y' }}.
                Los soportes se toman de su expediente; cárguelos antes: <em>certificado de EPS, documento de identificación</em> y el <em>acta de inicio</em> (o RUT y Cámara si es CUNbre).</p>
              <div class="rej">
                <div class="campo"><label for="a-tid">Tipo de identificación</label><select id="a-tid" [(ngModel)]="r.tipoIdentificacion"><option value="CC">Cédula de ciudadanía</option><option value="TI">Tarjeta de identidad</option><option value="CE">Cédula de extranjería</option><option value="PA">Pasaporte</option></select></div>
                <div class="campo"><label for="a-nid">Número</label><input id="a-nid" [(ngModel)]="r.numeroIdentificacion" /></div>
                <div class="campo"><label for="a-eps">EPS</label><input id="a-eps" [(ngModel)]="r.epsNombre" placeholder="Nueva EPS, Sanitas, Sura…" /></div>
                <div class="campo"><label for="a-reg">Tipo de afiliación</label><select id="a-reg" [(ngModel)]="r.epsRegimen"><option value="convencional">Convencional (contributivo, beneficiario, subsidiado)</option><option value="regimen_especial">Régimen especial (fuerzas militares, policía…)</option><option value="fomag">FOMAG (magisterio)</option><option value="epsi">EPS indígena</option></select></div>
                <div class="campo"><label for="a-feps">Expedición del certificado de EPS</label><input id="a-feps" type="date" [(ngModel)]="r.fechaExpedicionEps" /></div>
                @if (esCunbre()) {
                  <div class="campo"><label for="a-frut">Expedición del RUT</label><input id="a-frut" type="date" [(ngModel)]="r.fechaExpedicionRut" /></div>
                  @if (practica()?.modalidad === 'cunbre_consolidado') { <div class="campo"><label for="a-fcam">Expedición de la Cámara de Comercio</label><input id="a-fcam" type="date" [(ngModel)]="r.fechaExpedicionCamara" /></div> }
                }
              </div>
              <p class="pista">No se aceptan: documentos borrosos o con contraseña, certificado del Sisbén o de ADRES, EPS con más de 30 días, planillas ni soportes de aportes o novedades.</p>
              <button type="button" class="boton boton--primario" [class.cargando]="guardando()" [disabled]="guardando()" (click)="radicar()">Radicar solicitud</button>
            }
          }
        } @else {
          <h2>Bandeja de solicitudes</h2>
          <div class="filtros">
            <div class="campo"><label for="f-est">Estado</label><select id="f-est" [(ngModel)]="filtroEstado" (ngModelChange)="cargarLista()"><option value="">Todas</option><option value="radicada">Radicadas</option><option value="aprobada">Aprobadas</option><option value="rechazada">Rechazadas</option><option value="certificado_enviado">Certificado enviado</option></select></div>
            <div class="campo"><label for="f-per">Periodo</label><input id="f-per" [(ngModel)]="filtroPeriodo" (keyup.enter)="cargarLista()" placeholder="2026C" /></div>
            <button type="button" class="boton compacto" (click)="cargarLista()">Filtrar</button>
            <button type="button" class="boton compacto" (click)="verConsolidado()">Consolidado de hoy</button>
          </div>
          @if (lista().length === 0) { <div class="vacio">Sin solicitudes con ese filtro.</div> }
          @for (s of lista(); track s.id) {
            <div class="fila" [class.sel]="seleccion()?.id === s.id" (click)="seleccionar(s)" (keyup.enter)="seleccionar(s)" tabindex="0" role="button">
              <div class="q"><div class="n">n.º {{ s.consecutivo }} · {{ s.estudianteNombre }}</div>
                <div class="pista">{{ s.modalidadEtiqueta }} · {{ s.periodoAcademico }} · inicio {{ s.fechaInicio }}</div></div>
              @if (s.recomendacion) { <sipra-estado [valor]="s.recomendacion" /> }
              <sipra-estado [valor]="s.estado" />
            </div>
          }
          @if (consolidado(); as c) {
            <div class="conso" style="margin-top:var(--sp-4);padding-top:var(--sp-3);border-top:1px solid var(--borde)">
              <h3>Consolidado del {{ c.fecha }}</h3>
              <h4>Aprobadas para Capital Social ({{ c.aprobadas.length }})</h4>
              @for (f of c.aprobadas; track f.consecutivo) { <div>· n.º {{ f.consecutivo }} {{ f.estudianteNombre }} ({{ f.numeroIdentificacion }}) · {{ f.modalidad }} · {{ f.fechaInicio }} a {{ f.fechaFin }} · {{ f.epsNombre }}</div> }
              <h4>Rechazadas ({{ c.rechazadas.length }})</h4>
              @for (f of c.rechazadas; track f.consecutivo) { <div>· n.º {{ f.consecutivo }} {{ f.estudianteNombre }} · {{ f.motivos.join('; ') }}</div> }
              <h4>Certificados remitidos ({{ c.certificadosEnviados.length }})</h4>
              @for (f of c.certificadosEnviados; track f.consecutivo) { <div>· n.º {{ f.consecutivo }} {{ f.estudianteNombre }}</div> }
            </div>
          }
        }
      </section>

      <!-- ── Derecha: detalle de la solicitud ───────────────────────────── -->
      <section class="tarjeta">
        @if (!seleccion()) {
          <div class="vacio"><img src="assets/ilustraciones/seguimiento.svg" alt="" width="600" height="360" /><span>{{ esEstudiante() ? 'Aquí verá el estado de su solicitud.' : 'Seleccione una solicitud para revisarla.' }}</span></div>
          @if (esEstudiante() && periodoPractica(); as per) {
            <div style="margin-top:var(--sp-4)">
              @if (per.cronograma.limiteSolicitudArl; as lim) { <div class="aviso" [class.aviso--info]="per.abiertas.solicitud_arl" [class.aviso--error]="!per.abiertas.solicitud_arl" style="margin-bottom:var(--sp-3)">
                {{ per.abiertas.solicitud_arl ? 'Plazo para solicitar la ARL: hasta el ' + lim + '.' : 'El plazo para solicitar la ARL cerró el ' + lim + '. Comuníquese con coordinación de prácticas.' }}</div> }
              <sipra-cronograma [periodo]="per" />
            </div>
          }
        } @else if (seleccion(); as s) {
          <div style="display:flex;gap:var(--sp-2);align-items:center;flex-wrap:wrap;margin-bottom:var(--sp-3)">
            <h2 style="margin:0;flex:1">Solicitud n.º {{ s.consecutivo }}</h2><sipra-estado [valor]="s.estado" />
            @if (s.recomendacion) { <span class="pista">recomendación:</span><sipra-estado [valor]="s.recomendacion" /> }
          </div>
          <div class="datos">
            <div><div class="k">Estudiante</div>{{ s.estudianteNombre }}<div class="pista">{{ s.tipoIdentificacion }} {{ s.numeroIdentificacion }} · {{ s.estudianteCorreo }}</div></div>
            <div><div class="k">Práctica</div>{{ s.modalidadEtiqueta }}<div class="pista">{{ s.periodoAcademico }} · {{ s.fechaInicio }} a {{ s.fechaFin }}</div></div>
            <div><div class="k">EPS</div>{{ s.epsNombre }} · {{ s.epsRegimen | etiqueta }}<div class="pista">expedido {{ s.fechaExpedicionEps ?? 'sin declarar' }}</div></div>
            <div><div class="k">Radicada</div>{{ s.radicadaEn | date: 'd MMM y, HH:mm' }}@if (s.decididaEn) { <div class="pista">decidida {{ s.decididaEn | date: 'd MMM y, HH:mm' }}</div> }</div>
          </div>

          <h3 style="margin-top:var(--sp-4)">Soportes</h3>
          @for (t of s.documentosExigidos; track t) {
            <div style="display:flex;gap:var(--sp-2);align-items:center;font-size:var(--fs-sm);padding:2px 0">
              <span style="flex:1">{{ t | etiqueta }}</span>
              @if (soporte(s, t); as d) { <sipra-estado [valor]="d.estado" /> } @else { <span class="etiqueta etiqueta--peligro">no cargado</span> }
            </div>
          }
          <p class="pista" style="margin-top:var(--sp-2)"><a [routerLink]="['/practicas', s.practicaId]">Abrir el expediente</a> para ver o revisar los archivos.</p>

          <h3 style="margin-top:var(--sp-4)">Validación automática</h3>
          <dl class="crit">
            @for (c of s.criterios; track c.criterio) { <dt><sipra-estado [valor]="c.resultado" /></dt><dd>{{ c.criterio }}<div class="d">{{ c.detalle }}</div></dd> }
          </dl>

          @if (s.estado === 'rechazada') {
            <div class="aviso aviso--error" style="margin-top:var(--sp-3)"><strong>Motivos:</strong> {{ s.motivosRechazoEtiquetas.join(' · ') }}@if (s.observacion) { <div>{{ s.observacion }}</div> }</div>
            @if (esEstudiante()) { <p class="pista">Corrija lo indicado en su expediente y radique de nuevo.</p> }
          }
          @if (s.estado === 'certificado_enviado') { <div class="aviso aviso--ok" style="margin-top:var(--sp-3)">Certificado remitido el {{ s.certificadoEnviadoEn | date: 'd MMM y' }}: ya está aprobado en el expediente.</div> }
          @if (esEstudiante() && s.estado === 'radicada') { <button type="button" class="boton compacto boton--peligro" style="margin-top:var(--sp-3)" [disabled]="guardando()" (click)="anular(s)">Retirar la solicitud</button> }

          @if (puedeDecidir() && (s.estado === 'radicada' || s.estado === 'aprobada' || s.estado === 'rechazada')) {
            <div style="margin-top:var(--sp-4);padding-top:var(--sp-3);border-top:1px solid var(--borde)">
              <h3>Decisión</h3>
              <div class="motivos">
                @for (m of catalogo()?.motivosRechazoArl ?? []; track m.codigo) {
                  <label><input type="checkbox" [checked]="motivosSel().includes(m.codigo)" (change)="alternarMotivo(m.codigo)" /> {{ m.etiqueta }}</label>
                }
              </div>
              <div class="campo" style="margin-top:var(--sp-2)"><label for="d-obs">Observación</label><textarea id="d-obs" [(ngModel)]="observacion"></textarea></div>
              <div class="acciones">
                @if (s.estado !== 'aprobada') { <button type="button" class="boton boton--primario" [class.cargando]="guardando()" [disabled]="guardando()" (click)="decidir(s, 'aprobar')">Aprobar</button> }
                @if (s.estado !== 'rechazada') { <button type="button" class="boton boton--peligro" [disabled]="guardando() || motivosSel().length === 0" (click)="decidir(s, 'rechazar')">Rechazar</button> }
              </div>
            </div>
          }

          @if (puedeEnviarCertificado() && s.estado === 'aprobada') {
            <div style="margin-top:var(--sp-4);padding-top:var(--sp-3);border-top:1px solid var(--borde)">
              <h3>Remitir certificado de ARL</h3>
              <p class="pista">El PDF que expide Capital Social queda aprobado en el expediente, registra la afiliación y avisa al estudiante.</p>
              <div class="rej">
                <div class="campo"><label for="c-fecha">Inicio de cobertura</label><input id="c-fecha" type="date" [(ngModel)]="fechaAfiliacion" /></div>
                <div class="campo"><label for="c-arch">Certificado (PDF)</label><input id="c-arch" type="file" accept="application/pdf" (change)="tomarCertificado($event)" /></div>
              </div>
              <button type="button" class="boton boton--primario" [class.cargando]="guardando()" [disabled]="guardando() || !certificado() || !fechaAfiliacion()" (click)="enviarCertificado(s)">Remitir certificado</button>
            </div>
          }
        }
      </section>
    </div>
  `,
})
export class ArlComponent implements OnInit {
  readonly sesion = inject(SesionService);
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);

  readonly lista = signal<SolicitudArl[]>([]);
  readonly seleccion = signal<SolicitudArl | null>(null);
  readonly practica = signal<Practica | null>(null);
  readonly catalogo = signal<CatalogoProceso | null>(null);
  readonly periodos = signal<Periodo[]>([]);
  readonly consolidado = signal<ConsolidadoArl | null>(null);
  readonly guardando = signal(false);
  readonly filtroEstado = signal('');
  readonly filtroPeriodo = signal('');
  readonly motivosSel = signal<string[]>([]);
  readonly observacion = signal('');
  readonly fechaAfiliacion = signal('');
  readonly certificado = signal<File | null>(null);

  readonly r: RadicarArl = { tipoIdentificacion: 'CC', numeroIdentificacion: '', epsNombre: '', epsRegimen: 'convencional', fechaExpedicionEps: '', fechaExpedicionRut: '', fechaExpedicionCamara: '' };

  readonly esEstudiante = computed(() => this.sesion.rol() === 'estudiante');
  readonly puedeDecidir = computed(() => ['auxiliar', 'tutor', 'coordinador', 'administrador'].includes(this.sesion.rol() ?? ''));
  readonly puedeEnviarCertificado = computed(() => ['auxiliar', 'coordinador', 'administrador'].includes(this.sesion.rol() ?? ''));
  readonly vigente = computed(() => this.lista().find((s) => ['radicada', 'aprobada'].includes(s.estado)) ?? null);
  readonly periodoPractica = computed(() => this.periodos().find((p) => p.codigo === this.practica()?.periodoAcademico) ?? null);
  readonly esCunbre = computed(() => ['cunbre_naciente', 'cunbre_consolidado'].includes(this.practica()?.modalidad ?? ''));

  async ngOnInit(): Promise<void> {
    void firstValueFrom(this.api.catalogoProceso()).then((c) => this.catalogo.set(c)).catch(() => undefined);
    if (this.esEstudiante()) {
      const propias = await firstValueFrom(this.api.listarPracticas()).catch(() => [] as Practica[]);
      this.practica.set(propias.filter((p) => !['certificada', 'cancelada', 'anulada', 'reprobada'].includes(p.estado))[0] ?? propias[0] ?? null);
      this.periodos.set(await firstValueFrom(this.api.listarPeriodos()).catch(() => [] as Periodo[]));
    }
    await this.cargarLista();
    if (this.esEstudiante()) this.seleccion.set(this.vigente() ?? this.lista()[0] ?? null);
  }

  async cargarLista(): Promise<void> {
    try {
      this.lista.set(await firstValueFrom(this.api.listarSolicitudesArl({ estado: this.filtroEstado() || undefined, periodo: this.filtroPeriodo() || undefined })));
      const sel = this.seleccion();
      if (sel) this.seleccion.set(this.lista().find((s) => s.id === sel.id) ?? sel);
    } catch (error) { this.avisos.error(leerError(error)); }
  }

  seleccionar(s: SolicitudArl): void { this.seleccion.set(s); this.motivosSel.set(s.motivosRechazo); this.observacion.set(s.observacion ?? ''); }
  soporte(s: SolicitudArl, tipo: string) { return s.documentos.find((d) => d.tipo === tipo) ?? null; }
  alternarMotivo(codigo: string): void { this.motivosSel.update((l) => (l.includes(codigo) ? l.filter((x) => x !== codigo) : [...l, codigo])); }
  tomarCertificado(evento: Event): void { this.certificado.set((evento.target as HTMLInputElement).files?.[0] ?? null); }

  async radicar(): Promise<void> {
    await this.ejecutar(async () => {
      const s = await firstValueFrom(this.api.radicarSolicitudArl({
        ...this.r, fechaExpedicionEps: this.r.fechaExpedicionEps || undefined,
        fechaExpedicionRut: this.r.fechaExpedicionRut || undefined, fechaExpedicionCamara: this.r.fechaExpedicionCamara || undefined,
      }));
      this.seleccion.set(s);
      return `Solicitud n.º ${s.consecutivo} radicada. Le enviamos la confirmación al correo institucional.`;
    });
  }

  async decidir(s: SolicitudArl, decision: 'aprobar' | 'rechazar'): Promise<void> {
    await this.ejecutar(async () => {
      const r = await firstValueFrom(this.api.decidirSolicitudArl(s.id, { decision, motivos: decision === 'rechazar' ? this.motivosSel() : undefined, observacion: this.observacion().trim() || undefined }));
      this.seleccion.set(r);
      return decision === 'aprobar' ? 'Solicitud aprobada. Remita el certificado cuando Capital Social lo expida.' : 'Solicitud rechazada; el estudiante recibió los motivos.';
    });
  }

  async enviarCertificado(s: SolicitudArl): Promise<void> {
    const archivo = this.certificado();
    if (!archivo) return;
    const formulario = new FormData();
    formulario.append('fechaAfiliacion', this.fechaAfiliacion());
    formulario.append('archivo', archivo, archivo.name);
    await this.ejecutar(async () => {
      this.seleccion.set(await firstValueFrom(this.api.enviarCertificadoArl(s.id, formulario)));
      this.certificado.set(null);
      return 'Certificado remitido: quedó aprobado en el expediente y la afiliación registrada.';
    });
  }

  async anular(s: SolicitudArl): Promise<void> {
    await this.ejecutar(async () => { this.seleccion.set(await firstValueFrom(this.api.anularSolicitudArl(s.id))); return 'Solicitud retirada.'; });
  }

  async verConsolidado(): Promise<void> {
    try { this.consolidado.set(await firstValueFrom(this.api.consolidadoArl())); } catch (error) { this.avisos.error(leerError(error)); }
  }

  private async ejecutar(accion: () => Promise<string>): Promise<void> {
    this.guardando.set(true);
    try { const texto = await accion(); this.avisos.exito(texto); await this.cargarLista(); }
    catch (error) { this.avisos.error(leerError(error)); }
    finally { this.guardando.set(false); }
  }
}
