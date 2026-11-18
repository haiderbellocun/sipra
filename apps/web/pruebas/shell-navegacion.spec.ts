import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Rol } from '@core/models/modelos';
import {
  MESAS_ESPECIALIZADAS, NAVEGACION, estaActiva, mesasPara, navegacionPara,
} from '../src/app/layout/navegacion';

// Ajuste de UX del armazón (posterior a G6): navegación agrupada, tema y cuenta en la barra superior.
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...p), 'utf8');
const shell = src('layout', 'shell.component.ts');
const plantilla = /template: `([\s\S]*?)`,\n\}\)/.exec(shell)?.[1] ?? '';
const estilos = /styles: \[`([\s\S]*?)`\]/.exec(shell)?.[1] ?? '';
const rutas = src('app.routes.ts');
const vd = src('features', 'validacion-documental', 'validacion-documental.component.ts');
const vdMesas = src('features', 'validacion-documental', 'vd-mesas.component.ts');

const ROLES: Rol[] = ['estudiante', 'tutor', 'coordinador', 'analista', 'director', 'administrador', 'empresa', 'extension', 'auxiliar'];
const lateral = plantilla.slice(plantilla.indexOf('<aside class="lateral"'), plantilla.indexOf('</aside>'));
const nav = plantilla.slice(plantilla.indexOf('<ng-template #navegacion'), plantilla.indexOf('</ng-template>'));
const topbar = plantilla.slice(plantilla.indexOf('<header class="topbar">'), plantilla.indexOf('</header>'));
const etiquetas = (rol: Rol) => navegacionPara(rol).flatMap((g) => g.items.map((i) => i.etiqueta));
const grupos = (rol: Rol) => navegacionPara(rol).map((g) => g.id);

/** rolGuard de cada ruta de primer nivel, leído del código real de app.routes.ts. */
function guardDe(ruta: string): string[] | null {
  const p = ruta.replace(/^\//, '');
  const bloque = p === 'validacion-documental'
    ? /segmentos\[0\]\?\.path === 'validacion-documental'[\s\S]*?(?=\n {6}\},?\n)/.exec(rutas)?.[0]
    : new RegExp(`path: '${p.replace('/', '\\/')}',[\\s\\S]*?(?=\\n {6}\\},?\\n)`).exec(rutas)?.[0];
  assert.ok(bloque, `ruta ${ruta} no encontrada en app.routes.ts`);
  const m = /rolGuard\(([^)]*)\)/.exec(bloque!);
  return m ? m[1].split(',').map((x) => x.trim().replace(/'/g, '')) : null; // null = cualquier sesión
}

describe('Shell · la barra lateral es solo navegación', () => {
  it('ni tema, ni cuenta, ni cierre de sesión en la barra lateral ni en el cajón', () => {
    for (const parte of [lateral, nav]) {
      assert.doesNotMatch(parte, /sipra-control-tema|sipra-control-cuenta|Tema claro|Tema oscuro|salir\(\)|Cerrar sesión/);
    }
  });
  it('tema y cuenta en la barra superior (a la derecha), con un único mecanismo de tema', () => {
    assert.match(topbar, /<div class="der">\s*<sipra-control-tema class="tema-grande" variante="etiqueta" \/>\s*<sipra-control-tema class="tema-chico" variante="icono" \/>\s*<sipra-control-cuenta variante="barra" \/>/);
    const tema = src('shared', 'components', 'control-tema.component.ts');
    assert.match(tema, /\(click\)="tema\.alternar\(\)"/); // TemaService, sin cambios
    assert.match(tema, /role="switch" \[attr\.aria-checked\]="claro" aria-label="Tema claro"/);
    assert.match(tema, /'Cambiar a tema oscuro' : 'Cambiar a tema claro'/); // tooltip: no depende solo del icono
  });
  it('la cuenta muestra nombre, rol y correo (truncables, con título) y conserva solo «Cerrar sesión»', () => {
    const cuenta = src('shared', 'components', 'control-cuenta.component.ts');
    assert.match(cuenta, /<span class="nombre">\{\{ s\?\.nombre \}\}<\/span><span class="rol-b">\{\{ rol\(\) \}\}<\/span>/);
    assert.match(cuenta, /<p class="correo" \[attr\.title\]="s\?\.correo">/);
    assert.match(cuenta, /\.txt \.nombre \{[^}]*text-overflow: ellipsis/);
    assert.equal((cuenta.match(/\(click\)="sesion\.salir\(\)"/g) ?? []).length, 1);
  });
  it('barra superior sticky (56 px) y logo fijo con navegación de scroll independiente', () => {
    assert.match(estilos, /--alto-barra: 56px/);
    assert.match(estilos, /\.topbar \{\s*position: sticky; top: 0;/);
    assert.match(estilos, /\.lat-cab \{ flex: none;/);
    assert.match(estilos, /\.nav \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/);
  });
});

describe('Navegación · grupos, orden y visibilidad por perfil', () => {
  it('grupos en orden: Principal, Operación, Análisis, Validación, Gestión, Soporte', () => {
    assert.deepEqual(NAVEGACION.map((g) => g.etiqueta), ['Principal', 'Operación', 'Análisis', 'Validación', 'Gestión', 'Soporte']);
    assert.match(estilos, /\.g-tit \{[^}]*font: 600 11px\/18px[^}]*text-transform: uppercase/); // discretos, sin tarjetas
  });
  it('Gestión NO va después de Soporte', () => {
    const ids = NAVEGACION.map((g) => g.id);
    assert.ok(ids.indexOf('gestion') < ids.indexOf('soporte'));
  });
  it('los grupos vacíos no se renderizan (estudiante sin Análisis, Validación ni Gestión)', () => {
    assert.deepEqual(grupos('estudiante'), ['principal', 'operacion', 'soporte']);
    for (const rol of ROLES) for (const g of navegacionPara(rol)) assert.ok(g.items.length > 0, `${rol}/${g.id}`);
  });
  it('estudiante: menú pequeño, sin infraestructura administrativa', () => {
    assert.deepEqual(etiquetas('estudiante'), ['Inicio', 'Prácticas', 'Registrar mi práctica', 'Solicitud de ARL', 'Bolsa de empleo', 'PQRS', 'Ayuda']);
  });
  it('director: lectura institucional y gobierno (G1), sin operación ni validación', () => {
    assert.deepEqual(etiquetas('director'), ['Inicio', 'Prácticas', 'Cumplimiento', 'Bolsa de empleo', 'Reportes', 'Gestión de periodos', 'Gestión de usuarios', 'Ayuda']);
  });
  it('administrador: sin «Registrar mi práctica»; con Gestión completa y Auditoría', () => {
    const e = etiquetas('administrador');
    assert.ok(e.includes('Auditoría') && e.includes('Gestión de usuarios') && e.includes('Validación documental'));
    assert.ok(!e.includes('Registrar mi práctica'));
  });
  it('coordinador y analista: mismas herramientas operativas (G5/G6 se deciden dentro de Prácticas)', () => {
    assert.deepEqual(etiquetas('coordinador'), etiquetas('analista'));
    assert.deepEqual(grupos('coordinador'), ['principal', 'operacion', 'analisis', 'validacion', 'soporte']);
  });
  it('docente facilitador y auxiliar: Validación documental sí; Gestión no', () => {
    for (const rol of ['tutor', 'auxiliar'] as Rol[]) {
      assert.ok(etiquetas(rol).includes('Validación documental'), rol);
      assert.ok(!grupos(rol).includes('gestion'), rol);
    }
  });
  it('orden consistente: para todo perfil, sus entradas respetan el orden global', () => {
    const global = NAVEGACION.flatMap((g) => g.items.map((i) => i.etiqueta));
    for (const rol of ROLES) {
      const propias = etiquetas(rol);
      assert.deepEqual(propias, global.filter((e) => propias.includes(e)), rol);
    }
  });
  it('MATRIZ perfil → enlace → ruta: cada enlace visible lo admite el rolGuard real de su ruta (nada termina en 403 por rol)', () => {
    const items = [...NAVEGACION.flatMap((g) => g.items), ...MESAS_ESPECIALIZADAS];
    for (const item of items) {
      const guard = guardDe(item.ruta);
      for (const rol of ROLES) {
        const visible = item.roles === null || item.roles.includes(rol);
        if (visible) assert.ok(guard === null || guard.includes(rol), `${rol} ve «${item.etiqueta}» (${item.ruta}) pero la ruta lo rechaza`);
      }
      // Y la entrada no esconde a quien la ruta sí admite (salvo «Registrar mi práctica» / «Registro FUR», que se reparten /registro).
      if (item.roles !== null && guard !== null && item.ruta !== '/registro') assert.deepEqual([...item.roles].sort(), [...guard].sort(), item.etiqueta);
    }
  });
});

describe('Validación documental · punto único de primer nivel', () => {
  it('EPS, Actas, RUT y Cámara ya NO son entradas de primer nivel', () => {
    const primerNivel = NAVEGACION.flatMap((g) => g.items.map((i) => i.ruta));
    for (const r of ['/eps', '/actas', '/mesa-rut', '/mesa-camara']) assert.ok(!primerNivel.includes(r), r);
    assert.deepEqual(NAVEGACION.find((g) => g.id === 'validacion')!.items.map((i) => i.etiqueta), ['Validación documental']);
  });
  it('las rutas históricas siguen existiendo y son navegables desde Validación documental (sin funciones huérfanas)', () => {
    for (const r of ['eps', 'actas', 'mesa-rut', 'mesa-camara']) assert.match(rutas, new RegExp(`path: '${r}'`));
    assert.match(vd, /<sipra-vd-mesas \/>/);
    assert.match(vdMesas, /<nav class="mesas" aria-label="Mesas especializadas">[\s\S]*?\[routerLink\]="m\.ruta"/);
    assert.match(vdMesas, /mesasPara\(this\.sesion\.rol\(\)\)/);
    assert.deepEqual(mesasPara('coordinador').map((m) => m.etiqueta), ['EPS', 'Actas', 'RUT', 'Cámara']);
    assert.deepEqual(mesasPara('tutor').map((m) => m.etiqueta), ['RUT', 'Cámara']);
    assert.deepEqual(mesasPara('auxiliar').map((m) => m.etiqueta), ['EPS', 'Actas']);
    assert.deepEqual(mesasPara('estudiante'), []);
    assert.deepEqual(mesasPara('director'), []);
  });
  it('ruta hija: una mesa especializada o un expediente marcan activa a «Validación documental»; subrutas de Gestión, a su entrada', () => {
    const vdItem = NAVEGACION.find((g) => g.id === 'validacion')!.items[0];
    for (const url of ['/validacion-documental', '/validacion-documental/abc', '/eps', '/mesa-rut?x=1', '/actas/123', '/mesa-camara#a']) assert.ok(estaActiva(vdItem, url), url);
    assert.ok(!estaActiva(vdItem, '/practicas'));
    const practicas = NAVEGACION.flatMap((g) => g.items).find((i) => i.ruta === '/practicas')!;
    assert.ok(estaActiva(practicas, '/practicas/123'));
    assert.ok(!estaActiva(practicas, '/practicasx'));
    assert.match(nav, /\[class\.activo\]="activa\(item\)" \[attr\.aria-current\]="activa\(item\) \? 'page' : null"/);
  });
});

describe('Shell · responsive, contraída y teclado', () => {
  it('escritorio ≥ 1024: barra lateral de 264 px; contraída de 68 px con tooltip en hover y foco', () => {
    assert.match(estilos, /--ancho-lat: 264px/);
    assert.match(estilos, /:host\(\.colapsada\) \{ --ancho-lat: 68px; \}/);
    assert.match(estilos, /:host\(\.colapsada\) \.lateral \.nav a:hover \.tip, :host\(\.colapsada\) \.lateral \.nav a:focus-visible \.tip \{ display: block; \}/);
    assert.match(nav, /\[attr\.aria-label\]="item\.etiqueta"/); // el nombre accesible no depende de la etiqueta visible
    assert.match(topbar, /aria-controls="sipra-lateral" \[attr\.aria-expanded\]="!colapsada\(\)"/);
  });
  it('móvil y tablet (< 1024): cajón <dialog> con ☰, cierre al navegar y retorno del foco', () => {
    assert.match(estilos, /\.lateral \{ display: none; \}/);
    assert.match(plantilla, /<dialog #cajon class="cajon-nav" aria-label="Menú de SIPRA"/);
    assert.match(topbar, /aria-label="Abrir menú" aria-haspopup="dialog" \(click\)="abrirCajon\(\)"/);
    assert.match(nav, /\(click\)="movil && cerrarCajon\(\)"/);
    assert.match(shell, /alCerrarCajon\(\): void \{ this\.botonMenu\(\)\.nativeElement\.focus/);
    assert.doesNotMatch(plantilla, /barra-inf/);
  });
  it('foco visible en enlaces y botones del armazón; estado activo sin brillo', () => {
    assert.match(estilos, /\.nav a:focus-visible \{ outline: 2px solid/);
    assert.match(estilos, /\.icono-btn:focus-visible \{ outline: 2px solid/);
    assert.doesNotMatch(/\.nav a\.activo[^}]*\}/.exec(estilos)?.[0] ?? '', /box-shadow/);
  });
  it('el estado contraído se recuerda con try/catch (funciona sin almacenamiento)', () => {
    assert.match(shell, /try \{ localStorage\.setItem\(CLAVE_COLAPSO/);
    assert.match(shell, /try \{ return localStorage\.getItem\(CLAVE_COLAPSO\) === '1'; \} catch \{ return false; \}/);
  });
  it('Validación documental descuenta la barra superior en su alto completo', () => {
    assert.match(vd, /height:calc\(100dvh - var\(--alto-cinta, 0px\) - var\(--alto-barra, 0px\) - 16px\)/);
  });
});
