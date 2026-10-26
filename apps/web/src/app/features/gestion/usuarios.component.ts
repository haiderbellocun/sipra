import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { AvisosService } from '@core/ui/avisos.service';
import { UsuarioAdministrativo } from '@core/models/modelos';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';
import { leerError } from '@shared/utils/errores';

/** Gestión de usuarios administrativos (SGP, apartado Gestión). */
@Component({
  selector: 'sipra-usuarios',
  standalone: true,
  imports: [FormsModule, EtiquetaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .dos { display:grid; gap:var(--sp-4); grid-template-columns:1fr; } @media (width >= 1000px) { .dos { grid-template-columns:1.5fr 1fr; align-items:start; } }
    .filtros { display:flex; gap:var(--sp-2); flex-wrap:wrap; align-items:flex-end; margin-bottom:var(--sp-3); } .filtros .campo { margin:0; min-width:160px; }
    .rej { display:grid; gap:0 var(--sp-3); grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr)); }
    td.compacto { white-space:nowrap; }
  `],
  template: `
    <p class="pista" style="max-width:72ch;margin-bottom:var(--sp-4)">
      Usuarios con acceso administrativo: administrador, coordinador de prácticas, auxiliar y docente facilitador, con permiso de
      <strong>consulta</strong> (solo ve) o <strong>escritura</strong> (ve, valida y registra). El estudiante existe desde la matrícula en SINU.
      «Eliminar» inhabilita: el histórico conserva quién hizo qué.
    </p>

    <div class="dos">
      <section class="tarjeta">
        <div class="filtros">
          <div class="campo"><label for="u-nombre">Nombre</label><input id="u-nombre" [(ngModel)]="fNombre" (keyup.enter)="cargar()" /></div>
          <div class="campo"><label for="u-perfil">Perfil</label><select id="u-perfil" [(ngModel)]="fPerfil" (ngModelChange)="cargar()"><option value="">Todos</option><option value="administrador">Administrador</option><option value="coordinador">Coordinador de prácticas</option><option value="auxiliar">Auxiliar</option><option value="tutor">Docente facilitador</option><option value="extension">Extensión</option></select></div>
          <div class="campo"><label for="u-estado">Estado</label><select id="u-estado" [(ngModel)]="fEstado" (ngModelChange)="cargar()"><option value="">Todos</option><option value="activo">Activos</option><option value="inactivo">Inactivos</option></select></div>
          <button type="button" class="boton compacto" (click)="cargar()">Buscar</button>
          <button type="button" class="boton compacto boton--primario" (click)="nuevo()">+ Crear usuario</button>
        </div>
        <div class="tabla-envoltura">
          <table class="tabla">
            <thead><tr><th>Nombre</th><th>Correo</th><th>Perfil</th><th>Permiso</th><th>Escuelas</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              @for (u of usuarios(); track u.id) {
                <tr>
                  <td>{{ u.nombre }}<div class="pista">{{ u.documento ?? '—' }}</div></td>
                  <td>{{ u.correo }}</td>
                  <td class="compacto">{{ u.rolEtiqueta }}</td>
                  <td class="compacto">{{ u.permiso | etiqueta }}</td>
                  <td>{{ u.escuelas.length ? u.escuelas.join(', ') : 'Institucional' }}</td>
                  <td class="compacto"><span class="etiqueta" [class.etiqueta--ok]="u.activo" [class.etiqueta--neutra]="!u.activo">{{ u.activo ? 'activo' : 'inactivo' }}</span></td>
                  <td class="compacto"><button type="button" class="boton compacto" (click)="editar(u)">Editar</button>
                    @if (u.activo) { <button type="button" class="boton compacto boton--peligro" (click)="eliminar(u)">Eliminar</button> }</td>
                </tr>
              } @empty { <tr><td colspan="7" class="vacio">Sin usuarios con ese filtro.</td></tr> }
            </tbody>
          </table>
        </div>
      </section>

      <section class="tarjeta">
        <h2>{{ editando() ? 'Editar usuario' : 'Crear usuario' }}</h2>
        <div class="rej">
          <div class="campo"><label for="e-nombre">Nombre completo</label><input id="e-nombre" [(ngModel)]="f.nombre" /></div>
          <div class="campo"><label for="e-correo">Correo institucional</label><input id="e-correo" type="email" [(ngModel)]="f.correo" [disabled]="!!editando()" placeholder="nombre@cun.edu.co" /></div>
          <div class="campo"><label for="e-doc">Documento</label><input id="e-doc" [(ngModel)]="f.documento" /></div>
          <div class="campo"><label for="e-rol">Tipo de actor</label><select id="e-rol" [(ngModel)]="f.rol" [disabled]="!!editando()">
            <option value="coordinador">Coordinador de prácticas (y analista)</option><option value="auxiliar">Auxiliar</option><option value="tutor">Docente facilitador</option>
            @if (sesion.rol() === 'administrador') { <option value="administrador">Administrador</option><option value="extension">Extensión</option> }</select></div>
          <div class="campo"><label for="e-permiso">Tipo de permiso</label><select id="e-permiso" [(ngModel)]="f.permiso"><option value="escritura">Escritura</option><option value="consulta">Consulta</option></select></div>
          <div class="campo"><label for="e-esc">Escuelas (códigos separados por coma)</label><input id="e-esc" [(ngModel)]="f.escuelas" placeholder="Vacío = institucional" /></div>
          <div class="campo"><label for="e-activo">Estado</label><select id="e-activo" [(ngModel)]="f.activo"><option [ngValue]="true">Activo</option><option [ngValue]="false">Inhabilitado</option></select></div>
        </div>
        <div class="acciones">
          <button type="button" class="boton boton--primario" [class.cargando]="guardando()" [disabled]="guardando()" (click)="guardar()">{{ editando() ? 'Guardar cambios' : 'Registrar usuario' }}</button>
          @if (editando()) { <button type="button" class="boton" (click)="nuevo()">Cancelar</button> }
        </div>
      </section>
    </div>
  `,
})
export class UsuariosComponent implements OnInit {
  readonly sesion = inject(SesionService);
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);

  readonly usuarios = signal<UsuarioAdministrativo[]>([]);
  readonly editando = signal<UsuarioAdministrativo | null>(null);
  readonly guardando = signal(false);
  readonly fNombre = signal(''); readonly fPerfil = signal(''); readonly fEstado = signal('');
  readonly f = { nombre: '', correo: '', documento: '', rol: 'tutor', permiso: 'escritura', escuelas: '', activo: true };

  async ngOnInit(): Promise<void> { await this.cargar(); }

  async cargar(): Promise<void> {
    try { this.usuarios.set(await firstValueFrom(this.api.listarUsuarios({ nombre: this.fNombre() || undefined, perfil: this.fPerfil() || undefined, estado: this.fEstado() || undefined }))); }
    catch (error) { this.avisos.error(leerError(error)); }
  }

  nuevo(): void { this.editando.set(null); Object.assign(this.f, { nombre: '', correo: '', documento: '', rol: 'tutor', permiso: 'escritura', escuelas: '', activo: true }); }
  editar(u: UsuarioAdministrativo): void { this.editando.set(u); Object.assign(this.f, { nombre: u.nombre, correo: u.correo, documento: u.documento ?? '', rol: u.rol, permiso: u.permiso, escuelas: u.escuelas.join(', '), activo: u.activo }); }

  async guardar(): Promise<void> {
    const escuelas = this.f.escuelas.split(',').map((e) => e.trim()).filter(Boolean);
    await this.ejecutar(async () => {
      const e = this.editando();
      if (e) { await firstValueFrom(this.api.actualizarUsuario(e.id, { nombre: this.f.nombre, documento: this.f.documento, permiso: this.f.permiso, escuelas, activo: this.f.activo })); return 'Usuario actualizado.'; }
      await firstValueFrom(this.api.crearUsuario({ ...this.f, escuelas }));
      this.nuevo();
      return 'Usuario creado. Ingresa con su correo institucional.';
    });
  }

  async eliminar(u: UsuarioAdministrativo): Promise<void> {
    if (!confirm(`¿Inhabilitar a ${u.nombre}? El histórico lo conserva.`)) return;
    await this.ejecutar(async () => { await firstValueFrom(this.api.eliminarUsuario(u.id)); return 'Usuario inhabilitado.'; });
  }

  private async ejecutar(accion: () => Promise<string>): Promise<void> {
    this.guardando.set(true);
    try { this.avisos.exito(await accion()); await this.cargar(); }
    catch (error) { this.avisos.error(leerError(error)); }
    finally { this.guardando.set(false); }
  }
}
