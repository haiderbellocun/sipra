import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SesionService } from '@core/auth/sesion.service';
import { ApiService } from '@core/services/api.service';
import { Periodo, Practica, TableroCumplimiento } from '@core/models/modelos';
import { CronogramaComponent } from '@shared/components/cronograma.component';
import { EtiquetaPipe } from '@shared/pipes/etiquetas.pipe';

type Tono = 'ok' | 'aviso' | 'peligro' | 'info' | 'neutra';

/** Tono de los estados y señales de práctica (el mismo criterio que `sipra-estado`). */
const TONO: Record<string, Tono> = {
  activa: 'ok', certificada: 'ok', finalizada: 'info',
  en_validacion: 'aviso', documentacion: 'aviso', inscrita: 'neutra',
  suspendida: 'peligro', cancelada: 'peligro', anulada: 'neutra', reprobada: 'peligro',
  al_dia: 'ok', requiere_atencion: 'aviso', en_riesgo: 'peligro',
};

interface Metrica { n: number; t: string; tono: Tono; contexto: string }

/**
 * Inicio orientado al perfil (V3 · Operations Home).
 *
 * Responde, en este orden: quién soy (contexto), qué hago ahora (siguiente paso), cómo voy (telemetría),
 * qué requiere atención (lista priorizada) y qué viene (hitos del periodo). Para el tutor la vista no es una
 * bandeja de documentos sino de estudiantes, ordenada por señal de riesgo: responde a *a quién debo llamar
 * hoy*, no a *qué documento falta*. Los datos, su carga y el orden son los de siempre; solo cambia la piel.
 *
 * Nombres de clase propios: evitan los globales de estilos.css (.hero, .n, .t, .vacio, .cargando, .mono, .et…).
 */
@Component({
  selector: 'sipra-inicio',
  standalone: true,
  imports: [RouterLink, EtiquetaPipe, CronogramaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; --enlace: var(--signal-default); --ok: var(--status-success); --aviso: var(--status-review); --peligro: var(--status-critical); --info: var(--status-available); }
    :host-context([data-theme="dark"]) { --text-muted: #94aeac; }
    .cod { font-family: var(--fuente-mono); }
    .kicker { margin: 0; font: 600 12px/16px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); }
    .kicker .cod { font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--text-muted); }

    /* ── A · Contexto + B · Siguiente paso (sin caja: tipografía y una regla) ── */
    .contexto { display: grid; gap: 20px 40px; padding-bottom: 24px; border-bottom: 1px solid var(--vd-regla, var(--border-subtle)); animation: entra 220ms var(--ease-out) both; }
    @media (width >= 1100px) { .contexto { grid-template-columns: minmax(0, 1fr) minmax(300px, 380px); align-items: start; } }
    .contexto h1 { margin: 6px 0 6px; font: 600 30px/38px var(--fuente); letter-spacing: -.02em; color: var(--text-primary); }
    .ruta { margin: 0; max-width: 64ch; font-size: 14px; line-height: 22px; color: var(--text-secondary); }
    .periodo { display: inline-flex; align-items: center; gap: 8px; margin-left: 12px; padding: 2px 8px; border: 1px solid var(--border-default); border-radius: 4px; font: 500 12px/16px var(--fuente-mono); color: var(--text-secondary); text-transform: none; letter-spacing: 0; vertical-align: 1px; }
    .periodo::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--signal-active); box-shadow: 0 0 6px var(--signal-active); }

    .siguiente { display: grid; gap: 10px; }
    .cta {
      display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px; padding: 0 18px 0 20px;
      font: 600 15px/20px var(--fuente); color: var(--text-inverse); text-decoration: none; background: var(--signal-active);
      clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%);
      transition: filter 160ms var(--ease-out), transform 160ms var(--ease-out);
    }
    .cta:hover { text-decoration: none; filter: brightness(1.06); transform: translateY(-1px); }
    .cta .flecha { font: 500 18px/1 var(--fuente-mono); }

    /* Command links: fila · etiqueta · metadato · flecha (sin tarjetas). */
    .comandos { display: grid; margin: 0; padding: 0; list-style: none; }
    .comandos a {
      display: grid; grid-template-columns: 1fr auto 16px; align-items: center; gap: 12px; min-height: 40px; padding: 0 4px;
      border-bottom: 1px solid var(--vd-regla, var(--border-subtle)); color: var(--text-primary); text-decoration: none; font-size: 14px; font-weight: 500;
      transition: color 160ms var(--ease-out), background 160ms var(--ease-out);
    }
    .comandos li:last-child a { border-bottom: 0; }
    .comandos a:hover { text-decoration: none; color: var(--enlace); background: color-mix(in srgb, var(--signal-active) 6%, transparent); }
    .comandos .meta { font: 500 12px/16px var(--fuente-mono); color: var(--text-secondary); }
    .comandos .fl { font: 500 14px/1 var(--fuente-mono); color: var(--text-muted); transition: transform 160ms var(--ease-out); }
    .comandos a:hover .fl { transform: translateX(2px); color: var(--enlace); }

    /* ── C · Telemetría: metric strip (una sola franja, separadores finos) ── */
    .tira { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr)); margin: 20px 0 0; padding: 0; list-style: none; animation: entra 220ms var(--ease-out) 40ms both; }
    .tira li { display: grid; gap: 2px; padding: 4px 20px 4px 18px; border-left: 1px solid var(--vd-regla, var(--border-subtle)); }
    .tira li:first-child { border-left: 0; padding-left: 0; }
    .tira .valor { font: 500 34px/40px var(--fuente-mono); letter-spacing: -.03em; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .tira .rotulo { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--text-primary); }
    .tira .ctx { font: 500 12px/16px var(--fuente-mono); color: var(--text-muted); }
    .punto { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--c); }

    /* ── Señal de estado: punto + texto (nunca solo color) ── */
    .senal { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; line-height: 16px; white-space: nowrap; color: var(--c, var(--text-secondary)); }
    .senal::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
    .tono-ok { --c: var(--ok); } .tono-aviso { --c: var(--aviso); } .tono-peligro { --c: var(--peligro); } .tono-info { --c: var(--info); } .tono-neutra { --c: var(--text-secondary); }

    /* ── D · Atención + hitos ── */
    .cuerpo { display: grid; gap: 24px; margin-top: 28px; }
    @media (width >= 1100px) { .cuerpo { grid-template-columns: minmax(0, 1.55fr) minmax(320px, 1fr); align-items: start; } }
    .zona { min-width: 0; padding: 18px 20px 6px; background: color-mix(in srgb, var(--surface-raised) 64%, transparent); border: 1px solid var(--border-subtle); border-radius: 8px; animation: entra 220ms var(--ease-out) 80ms both; }
    .zona + .zona { animation-delay: 120ms; }
    .zona-cab { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid var(--vd-regla, var(--border-subtle)); }
    .zona-cab h2 { margin: 0; font: 600 16px/22px var(--fuente); color: var(--text-primary); }
    .zona-cab .kicker { order: -1; flex-basis: 100%; margin-bottom: -6px; }
    .lnk { font-size: 13px; font-weight: 500; color: var(--enlace); text-decoration: none; }
    .lnk:hover { text-decoration: underline; }

    .filas { margin: 0; padding: 0; list-style: none; }
    .filas li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 16px; align-items: center; padding: 12px 8px; margin: 0 -8px; border-bottom: 1px solid var(--vd-regla, var(--border-subtle)); border-radius: 4px; transition: background 160ms var(--ease-out); }
    .filas li:last-child { border-bottom: 0; }
    .filas li:hover { background: color-mix(in srgb, var(--text-primary) 4%, transparent); }
    .nombre { font-size: 14px; font-weight: 600; line-height: 20px; }
    .nombre a { color: var(--text-primary); text-decoration: none; }
    .nombre a:hover { color: var(--enlace); text-decoration: underline; }
    .detalle { font-size: 12px; line-height: 16px; color: var(--text-secondary); }
    .detalle .cod { color: var(--text-muted); }
    .disparadores { grid-column: 1; display: flex; gap: 8px; align-items: baseline; font-size: 12px; line-height: 16px; color: var(--peligro); }
    .disparadores::before { content: ""; flex: none; width: 12px; height: 1px; background: currentColor; transform: translateY(-3px); }
    .estados { grid-column: 2; grid-row: 1 / span 3; display: grid; justify-items: end; gap: 6px; }

    /* Mi práctica (estudiante): telemetría N / T y señal por momento. */
    .mia { padding: 14px 0 12px; }
    .mia .tit { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; flex-wrap: wrap; }
    .mia .tit a { font-size: 15px; font-weight: 600; color: var(--text-primary); text-decoration: none; }
    .mia .tit a:hover { color: var(--enlace); text-decoration: underline; }
    .telemetria { display: flex; align-items: baseline; gap: 10px; margin: 16px 0 4px; }
    .telemetria .valor { font: 500 40px/44px var(--fuente-mono); letter-spacing: -.04em; color: var(--text-primary); }
    .telemetria .tot { font: 500 18px/24px var(--fuente-mono); color: var(--text-muted); }
    .telemetria .rotulo { font-size: 13px; color: var(--text-secondary); }
    .momentos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 14px 0 0; padding: 0; list-style: none; }
    .momentos li { position: relative; display: grid; align-content: start; gap: 2px; padding: 24px 12px 0 0; }
    .momentos li::before { content: ""; position: absolute; left: 0; right: 0; top: 7px; height: 1px; background: var(--border-default); }
    .momentos li.hecho::before { background: var(--ok); box-shadow: 0 0 6px color-mix(in srgb, var(--ok) 60%, transparent); }
    .nodo { position: absolute; left: 0; top: 0; width: 15px; height: 15px; border-radius: 50%; border: 1.5px solid var(--border-strong); background: var(--surface-canvas); }
    .momentos li.hecho .nodo { border-color: var(--ok); background: var(--ok); }
    .momentos li.actual .nodo { border-color: var(--signal-active); box-shadow: 0 0 0 4px color-mix(in srgb, var(--signal-active) 18%, transparent); animation: pulso 2.2s var(--ease-out) 1; }
    .mo-et { font-size: 13px; font-weight: 600; line-height: 18px; color: var(--text-primary); }
    .mo-ct { font: 500 12px/16px var(--fuente-mono); color: var(--text-muted); }
    .pendientes { margin: 18px 0 0; padding: 12px 0 0; border-top: 1px solid var(--vd-regla, var(--border-subtle)); }
    .pendientes h3 { margin: 0 0 8px; font: 600 12px/16px var(--fuente); letter-spacing: .08em; text-transform: uppercase; color: var(--text-secondary); }
    .pendientes ul { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px 16px; }
    .pendientes li { display: flex; gap: 10px; align-items: baseline; font-size: 13px; color: var(--text-primary); }
    .pendientes li::before { content: ""; flex: none; width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid var(--aviso); transform: translateY(-1px); }
    .mia .disparadores { margin-top: 12px; }

    .hitos { padding-bottom: 16px; }
    .hitos sipra-cronograma { margin-top: 14px; }
    .ayuda { margin: 14px 0 0; font-size: 13px; color: var(--text-secondary); }

    /* Vacío: Topology Orb. */
    .sin-datos { display: grid; justify-items: center; gap: 6px; padding: 28px 12px 24px; text-align: center; }
    .sin-datos svg { width: 120px; height: 84px; margin-bottom: 6px; }
    .sin-datos strong { font-size: 15px; color: var(--text-primary); }
    .sin-datos span { font-size: 13px; color: var(--text-secondary); }

    /* Carga: Document Signal (cinco nodos, la señal viaja); sin spinner. */
    .espera { display: grid; justify-items: center; gap: 14px; padding: 72px 0; color: var(--text-secondary); font-size: 13px; }
    .carril { position: relative; width: 200px; height: 14px; }
    .carril::before { content: ""; position: absolute; left: 7px; right: 7px; top: 6.5px; height: 1px; background: var(--border-default); }
    .carril i { position: absolute; top: 0; width: 13px; height: 13px; border-radius: 50%; border: 1.5px solid var(--border-strong); background: var(--surface-canvas); animation: nodo 2.4s var(--ease-out) infinite; }
    .carril i:nth-child(1) { left: 0; } .carril i:nth-child(2) { left: 46.75px; animation-delay: .3s; } .carril i:nth-child(3) { left: 93.5px; animation-delay: .6s; } .carril i:nth-child(4) { left: 140.25px; animation-delay: .9s; } .carril i:nth-child(5) { left: 187px; animation-delay: 1.2s; }

    @keyframes entra { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @keyframes pulso { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--signal-active) 40%, transparent); } 100% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--signal-active) 18%, transparent); } }
    @keyframes nodo { 0%, 100% { border-color: var(--border-strong); background: var(--surface-canvas); } 30% { border-color: var(--signal-active); background: var(--signal-active); box-shadow: 0 0 8px var(--signal-active); } }
    @media (prefers-reduced-motion: reduce) {
      .contexto, .tira, .zona, .momentos li.actual .nodo, .carril i { animation: none; }
      .cta, .comandos a, .comandos .fl, .filas li { transition: none; }
    }

    /* Claro: tonos de señal un paso más profundos sobre superficies polares (≥ 4.5:1 medido). */
    :host-context([data-theme="light"]) { --aviso: #7a4a00; --peligro: #b8231f; --enlace: #03587a; }

    /* ── Móvil: contexto → siguiente paso → progreso → atención → hitos ── */
    @media (width < 1100px) { .siguiente { max-width: 480px; } }
    @media (width < 700px) {
      .contexto h1 { font-size: 24px; line-height: 30px; }
      .periodo { display: flex; width: fit-content; margin: 8px 0 0; }
      .siguiente { max-width: none; }
      .tira { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .tira li { padding: 8px 12px; border-left: 0; border-top: 1px solid var(--vd-regla, var(--border-subtle)); }
      .tira li:nth-child(-n+2) { border-top: 0; }
      .tira li:first-child { padding-left: 12px; }
      .tira .valor { font-size: 28px; line-height: 34px; }
      .zona { padding: 16px 14px 4px; }
      .filas li { grid-template-columns: minmax(0, 1fr); }
      .estados { grid-column: 1; grid-row: auto; justify-items: start; grid-auto-flow: column; justify-content: start; gap: 12px; }
      .momentos { grid-template-columns: minmax(0, 1fr); gap: 12px; }
    }
  `],
  template: `
    @let rol = sesion.rol();
    @let interno = sesion.esInterno();
    <section class="contexto" aria-labelledby="inicio-titulo">
      <div>
        <p class="kicker">{{ etiquetaRol() }} <span class="cod">· {{ hoy }}</span>
          @if (periodoActual(); as per) { <span class="periodo" [attr.title]="per.nombre">Periodo {{ per.codigo }}</span> }
        </p>
        <h1 id="inicio-titulo">Hola, {{ sesion.sesion()?.nombre }}</h1>
        @switch (rol) {
          @case ('estudiante') {
            <p class="ruta">Su ruta: carta de presentación → registrar la práctica → solicitud de ARL (si la CUN la cubre) → cargar los documentos por momento → bitácora con su docente → cierre y nota.</p>
          }
          @case ('auxiliar') {
            <p class="ruta">Validación de las solicitudes de ARL de las modalidades articuladas y revisión documental. Las aprobadas van a Capital Social en el consolidado diario.</p>
          }
          @case ('tutor') {
            <p class="ruta">Sus estudiantes ordenados por señal de acompañamiento. La señal no es un estado: es un cálculo sobre la práctica que responde a quién conviene llamar hoy.</p>
          }
          @case ('empresa') {
            <p class="ruta">Sus practicantes activos y las vacantes que ha publicado.</p>
          }
          @default {
            <p class="ruta">Panorama institucional del proceso de prácticas y su cumplimiento normativo.</p>
          }
        }
      </div>

      @if (rol === 'estudiante' || rol === 'auxiliar') {
        <nav class="siguiente" aria-label="Siguiente paso">
          <p class="kicker">Siguiente paso</p>
          @if (rol === 'estudiante') {
            <a routerLink="/registro" class="cta">{{ practicas().length ? 'Carta y registro' : 'Registrar mi práctica' }}<span class="flecha" aria-hidden="true">→</span></a>
            <ul class="comandos">
              @if (practicas()[0]; as p) { <li><a [routerLink]="['/practicas', p.id]">Gestionar mi práctica<span class="meta">{{ p.periodoAcademico }}</span><span class="fl" aria-hidden="true">→</span></a></li> }
              <li><a routerLink="/arl">Solicitud de ARL<span class="meta"></span><span class="fl" aria-hidden="true">→</span></a></li>
              <li><a routerLink="/ayuda">Centro de ayuda<span class="meta"></span><span class="fl" aria-hidden="true">→</span></a></li>
              <li><a routerLink="/pqrs">PQRS<span class="meta"></span><span class="fl" aria-hidden="true">→</span></a></li>
            </ul>
          } @else {
            <a routerLink="/arl" class="cta">Bandeja de solicitudes de ARL<span class="flecha" aria-hidden="true">→</span></a>
            <ul class="comandos">
              <li><a routerLink="/practicas">Gestión de prácticas<span class="meta"></span><span class="fl" aria-hidden="true">→</span></a></li>
            </ul>
          }
        </nav>
      }
    </section>

    @if (cargando()) {
      <div class="espera" role="status">
        <div class="carril" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
        Cargando su inicio…
      </div>
    } @else {
      @if (rol !== 'estudiante') {
        <ul class="tira" aria-label="Cifras del alcance">
          @for (m of metricas(); track m.t) {
            <li [class]="'tono-' + m.tono">
              <span class="valor">{{ m.n }}</span>
              <span class="rotulo"><span class="punto" aria-hidden="true"></span>{{ m.t }}</span>
              <span class="ctx">{{ m.contexto }}</span>
            </li>
          }
        </ul>
      }

      <div class="cuerpo">
        <section class="zona" aria-labelledby="zona-atencion">
          <div class="zona-cab">
            <h2 id="zona-atencion">{{ interno ? 'A quién llamar hoy' : 'Mi práctica' }}</h2>
            <p class="kicker">{{ interno ? 'Requiere tu atención' : (rol === 'estudiante' ? 'Estado y progreso' : 'Practicantes') }}</p>
            @if (interno && priorizadas().length > 0) {
              <a routerLink="/practicas" class="lnk">Ver todas las prácticas →</a>
            }
          </div>

          @if (priorizadas().length === 0) {
            <div class="sin-datos">
              <svg viewBox="0 0 120 84" aria-hidden="true">
                <defs><radialGradient id="orbe-inicio" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="var(--signal-active)" stop-opacity=".35"/><stop offset="1" stop-color="var(--signal-active)" stop-opacity="0"/></radialGradient></defs>
                <circle cx="60" cy="42" r="40" fill="url(#orbe-inicio)"/>
                <g fill="none" stroke="var(--signal-default)" stroke-width="1"><ellipse cx="60" cy="42" rx="26" ry="26" opacity=".7"/><ellipse cx="60" cy="42" rx="26" ry="9" opacity=".5"/><ellipse cx="60" cy="42" rx="9" ry="26" opacity=".5"/></g>
                <g fill="var(--signal-active)"><circle cx="34" cy="42" r="2.5"/><circle cx="86" cy="42" r="2.5"/><circle cx="60" cy="16" r="2.5"/><circle cx="60" cy="68" r="2.5"/></g>
              </svg>
              <strong>Sin expedientes</strong><span>No hay expedientes dentro de su alcance todavía.</span>
            </div>
          } @else if (rol === 'estudiante' && miPractica(); as p) {
            <div class="mia">
              <div class="tit">
                <a [routerLink]="['/practicas', p.id]">{{ p.estudianteNombre }}</a>
                <span [class]="'senal tono-' + tono(p.estado)">{{ p.estado | etiqueta }}</span>
              </div>
              <div class="detalle">{{ p.modalidad | etiqueta }} · {{ p.empresaRazonSocial ?? 'sin empresa asignada' }} · <span class="cod">{{ p.periodoAcademico }}</span></div>
              <p class="telemetria">
                <span class="valor">{{ p.avance.aprobados }}</span><span class="tot">/{{ p.avance.exigidos }}</span>
                <span class="rotulo">documentos aprobados · {{ p.avance.porcentajeAprobado }} %</span>
              </p>
              @if (p.avance.momentos.length) {
                <ol class="momentos" aria-label="Avance por momento">
                  @for (mo of p.avance.momentos; track mo.momento) {
                    <li [class.hecho]="mo.completo" [class.actual]="mo.momento === p.avance.momentoActual" [attr.aria-current]="mo.momento === p.avance.momentoActual ? 'step' : null">
                      <span class="nodo" aria-hidden="true"></span>
                      <span class="mo-et">{{ mo.etiqueta }}</span>
                      <span class="mo-ct">{{ mo.aprobados }}/{{ mo.exigidos }} aprobados{{ mo.completo ? ' · completo' : '' }}</span>
                    </li>
                  }
                </ol>
              }
              @if (p.avance.pendientes.length) {
                <div class="pendientes">
                  <h3>Pendiente</h3>
                  <ul>@for (d of p.avance.pendientes; track d) { <li>{{ d | etiqueta }}</li> }</ul>
                </div>
              }
              @if (p.disparadoresSenal.length > 0) {
                <div class="disparadores">{{ p.disparadoresSenal.join(' · ') }}</div>
              }
            </div>
          } @else {
            <ul class="filas">
              @for (practica of priorizadas(); track practica.id) {
                <li>
                  <div class="nombre"><a [routerLink]="['/practicas', practica.id]">{{ practica.estudianteNombre }}</a></div>
                  <div class="detalle">
                    {{ practica.modalidad | etiqueta }} · {{ practica.empresaRazonSocial ?? 'sin empresa asignada' }} ·
                    <span class="cod">{{ practica.periodoAcademico }} · {{ practica.avance.porcentajeAprobado }} % aprobado</span>
                  </div>
                  @if (practica.disparadoresSenal.length > 0) {
                    <div class="disparadores">{{ practica.disparadoresSenal.join(' · ') }}</div>
                  }
                  <div class="estados">
                    <span [class]="'senal tono-' + tono(practica.estado)">{{ practica.estado | etiqueta }}</span>
                    @if (interno) { <span [class]="'senal tono-' + tono(practica.senal)">{{ practica.senal | etiqueta }}</span> }
                  </div>
                </li>
              }
            </ul>
          }
        </section>

        @if (periodoActual(); as per) {
          <section class="zona hitos" aria-labelledby="zona-hitos">
            <div class="zona-cab"><h2 id="zona-hitos">Próximos hitos</h2><p class="kicker">Actividad del periodo</p></div>
            <sipra-cronograma [periodo]="per" />
            @if (rol === 'estudiante') { <p class="ayuda">¿Dudas con las fechas? <a routerLink="/ayuda" [queryParams]="{ categoria: 'fechas_y_cronograma' }">Fechas y cronograma</a> en la ayuda.</p> }
          </section>
        }
      </div>
    }
  `,
})
export class InicioComponent implements OnInit {
  readonly sesion = inject(SesionService);
  private readonly api = inject(ApiService);

  readonly practicas = signal<Practica[]>([]);
  readonly tablero = signal<TableroCumplimiento | null>(null);
  readonly periodos = signal<Periodo[]>([]);
  readonly cargando = signal(true);

  /** El periodo de la práctica del estudiante; para los demás, el vigente más próximo con registro abierto. */
  readonly periodoActual = computed(() => {
    const lista = this.periodos().filter((p) => p.activo);
    const mia = this.practicas()[0]?.periodoAcademico;
    const hoy = new Date().toISOString().slice(0, 10);
    return lista.find((p) => p.codigo === mia)
      ?? lista.find((p) => p.fechaInicio <= hoy && hoy <= p.fechaFin && p.abiertas.registro_fur)
      ?? lista.find((p) => p.fechaInicio <= hoy && hoy <= p.fechaFin)
      ?? null;
  });

  readonly hoy = (() => {
    const f = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    return f.charAt(0).toUpperCase() + f.slice(1);
  })();

  readonly etiquetaRol = computed(() => {
    const etiquetas: Record<string, string> = {
      estudiante: 'Practicante', tutor: 'Docente facilitador', coordinador: 'Coordinación de prácticas',
      administrador: 'Administrador institucional', empresa: 'Empresa habilitada',
      extension: 'Dirección de Extensión', auxiliar: 'Auxiliar de prácticas',
    };
    const rol = this.sesion.rol();
    return rol ? (etiquetas[rol] ?? rol) : '';
  });

  readonly activas = computed(() => this.practicas().filter((p) => p.estado === 'activa').length);
  readonly requierenAtencion = computed(
    () => this.practicas().filter((p) => p.senal === 'requiere_atencion').length,
  );
  readonly enRiesgo = computed(() => this.practicas().filter((p) => p.senal === 'en_riesgo').length);

  /** Orden por urgencia: en riesgo primero, luego requiere atención. */
  readonly priorizadas = computed(() => {
    const peso: Record<string, number> = { en_riesgo: 0, requiere_atencion: 1, al_dia: 2 };
    return [...this.practicas()]
      .sort((a, b) => (peso[a.senal] ?? 3) - (peso[b.senal] ?? 3))
      .slice(0, 12);
  });

  /** La práctica del estudiante (la misma que ya enlazaba «Gestionar mi práctica»). */
  readonly miPractica = computed(() => this.practicas()[0] ?? null);

  /** Metric strip: las mismas cifras de siempre, con contexto relativo al total del alcance. */
  readonly metricas = computed<Metrica[]>(() => {
    const total = this.practicas().length;
    const de = `de ${total}`;
    const lista: Metrica[] = [
      { n: total, t: 'Expedientes en mi alcance', tono: 'info', contexto: 'total' },
      { n: this.activas(), t: 'Activas', tono: 'ok', contexto: de },
    ];
    if (this.sesion.esInterno()) {
      lista.push(
        { n: this.requierenAtencion(), t: 'Requieren atención', tono: 'aviso', contexto: de },
        { n: this.enRiesgo(), t: 'En riesgo', tono: 'peligro', contexto: de },
      );
      const t = this.tablero();
      if (t) lista.push({ n: t.practicasBloqueadas, t: 'Detenidas por ARL', tono: 'peligro', contexto: 'compuerta ARL' });
    }
    return lista;
  });

  tono(valor: string): Tono {
    return TONO[valor] ?? 'neutra';
  }

  async ngOnInit(): Promise<void> {
    try {
      this.practicas.set(await firstValueFrom(this.api.listarPracticas()));
      if (this.sesion.rol() !== 'empresa') {
        this.periodos.set(await firstValueFrom(this.api.listarPeriodos()).catch(() => [] as Periodo[]));
      }
      if (this.sesion.esInterno()) {
        this.tablero.set(await firstValueFrom(this.api.tableroCumplimiento(60)));
      }
    } finally {
      this.cargando.set(false);
    }
  }
}
