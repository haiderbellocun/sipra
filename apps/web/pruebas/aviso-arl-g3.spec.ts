import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Rol } from '@core/models/modelos';
import { AYUDA_ARL, AperturaAvisoArl, MENSAJE_ARL, TITULO_ARL } from '../src/app/features/registro/aviso-arl';

// G3 · aviso institucional sobre la ARL en el registro de la práctica. Informativo: no cambia reglas ni el envío.
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...p), 'utf8');
const aviso = src('features', 'registro', 'aviso-arl.component.ts');
const registro = src('features', 'registro', 'registro.component.ts');
const plantilla = (t: string) => /template: `([\s\S]*?)`,\n\}\)/.exec(t)?.[1] ?? '';
const tAviso = plantilla(aviso);
const tRegistro = plantilla(registro);

describe('G3 · mensaje institucional', () => {
  it('es EXACTO, sin reinterpretar ni resumir', () => {
    assert.equal(MENSAJE_ARL, 'La afiliación a ARL por parte de la CUN aplica únicamente para prácticas articuladas y entidades del tercer sector');
    assert.equal(AYUDA_ARL, 'Revisa quién será responsable de tu afiliación antes de continuar con el registro de la práctica.');
    assert.equal(TITULO_ARL, 'Información sobre tu ARL');
  });

  it('se interpola como texto (sin entidades HTML visibles)', () => {
    assert.ok(tAviso.includes('<p class="mensaje" id="aviso-arl-mensaje">{{ mensaje }}</p>'));
    assert.doesNotMatch(MENSAJE_ARL + AYUDA_ARL, /&[a-z]+;|&#/);
    assert.doesNotMatch(tAviso, /&quot;|&ldquo;|&rdquo;/);
  });

  it('no es un error: sin rojo de peligro, sin alert() del navegador, sin consentimiento', () => {
    assert.doesNotMatch(aviso, /--peligro|alert\(|confirm\(/);
    assert.doesNotMatch(tAviso, /type="checkbox"|Acepto|acepto/);
    assert.doesNotMatch(aviso, /api\.|HttpClient|localStorage|sessionStorage/);
  });
});

describe('G3 · apertura automática: solo estudiante, una vez por formulario', () => {
  it('estudiante: abre al llegar a la sección; no vuelve a abrir solo en la misma interacción', () => {
    const a = new AperturaAvisoArl('estudiante');
    assert.equal(a.alLlegarASeccion(), true);
    assert.equal(a.alLlegarASeccion(), false);
    assert.equal(a.alLlegarASeccion(), false);
  });

  it('un nuevo formulario (nueva instancia) vuelve a mostrarlo: no hay persistencia global', () => {
    assert.equal(new AperturaAvisoArl('estudiante').alLlegarASeccion(), true);
  });

  for (const rol of ['coordinador', 'analista', 'director', 'administrador', 'tutor', 'auxiliar'] as Rol[]) {
    it(`${rol}: no recibe apertura automática`, () => {
      assert.equal(new AperturaAvisoArl(rol).alLlegarASeccion(), false);
    });
  }

  it('sin sesión: no abre', () => assert.equal(new AperturaAvisoArl(null).alLlegarASeccion(), false));

  it('el disparo automático solo se arma para el estudiante', () => {
    assert.match(registro, /if \(!grupo \|\| this\.sesion\.rol\(\) !== 'estudiante' \|\| typeof IntersectionObserver === 'undefined'\) return;/);
    assert.ok(registro.includes('private readonly aperturaArl = new AperturaAvisoArl(this.sesion.rol());'));
  });
});

describe('G3 · punto de entrada y reapertura manual', () => {
  it('se dispara al llegar a «¿Quién asume la ARL?» (vista o foco) y no en el inicio de sesión', () => {
    assert.match(tRegistro, /<fieldset #grupoArl class="grupo" \(focusin\)="llegarASeccionArl\(\)"[^>]*>\s*<legend>¿Quién asume la ARL\?<\/legend>/);
    assert.ok(registro.includes('new IntersectionObserver('));
    // Si la sección ya se ve al cargar la pantalla, no cuenta como «llegar» (no aparece apenas se entra).
    assert.match(registro, /if \(lecturaInicial\) \{ lecturaInicial = false; if \(visible\) return; \}/);
  });

  it('«Información sobre ARL» reabre el MISMO diálogo, para cualquier perfil', () => {
    assert.ok(tRegistro.includes('<button #infoArl type="button" class="info-arl" aria-haspopup="dialog" (click)="avisoArl().abrir(infoArl)">'));
    assert.ok(tRegistro.includes('Información sobre ARL</button>'));
    assert.equal((tRegistro.match(/<sipra-aviso-arl \/>/g) ?? []).length, 1);
    assert.equal((registro.match(/La afiliación a ARL por parte de la CUN/g) ?? []).length, 0, 'el texto no se duplica en el formulario');
  });
});

describe('G3 · accesibilidad del diálogo', () => {
  it('<dialog> nativo con showModal (foco atrapado, fondo inerte, Esc), aria-modal, título y descripción asociados', () => {
    assert.match(tAviso, /<dialog #dialogo class="aviso-arl" aria-modal="true" aria-labelledby="aviso-arl-titulo" aria-describedby="aviso-arl-mensaje aviso-arl-ayuda"/);
    assert.ok(tAviso.includes('id="aviso-arl-titulo"') && tAviso.includes('id="aviso-arl-mensaje"') && tAviso.includes('id="aviso-arl-ayuda"'));
    assert.ok(aviso.includes('el.showModal();'));
    // Foco atrapado explícito: Tab / Mayús+Tab giran dentro del diálogo.
    assert.ok(aviso.includes("host: { '(keydown)': 'atraparFoco($event)' },"));
    assert.match(aviso, /atraparFoco\(evento: KeyboardEvent\): void \{[\s\S]*ultimo\.focus\(\);[\s\S]*primero\.focus\(\);/);
  });

  it('«Entendido» (con foco inicial) y la X solo cierran; al cerrar se devuelve el foco', () => {
    assert.ok(tAviso.includes('<button #entendido type="button" class="boton boton--primario" (click)="cerrar()">Entendido</button>'));
    assert.ok(aviso.includes('this.entendido().nativeElement.focus();'));
    assert.ok(tAviso.includes('<button type="button" class="x" aria-label="Cerrar" (click)="cerrar()">'));
    assert.ok(tAviso.includes('(close)="alCerrar()"'));
    assert.match(aviso, /alCerrar\(\): void \{[\s\S]*destino\?\.focus\(\);/);
  });
});

describe('G3 · estilo (Signal Dark / Arctic Light) y no regresión del registro', () => {
  it('solo tokens del sistema: sin colores fijos (salvo sombras/fondo traslúcido), sin morados', () => {
    const estilos = /styles: \[`([\s\S]*?)`\]/.exec(aviso)?.[1] ?? '';
    assert.doesNotMatch(estilos, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(estilos, /purple|violet|magenta/i);
    for (const t of ['var(--superficie)', 'var(--texto)', 'var(--borde)', 'var(--marca)', 'var(--aviso)']) assert.ok(estilos.includes(t), t);
  });

  it('usa el sprite de iconos existente (escudo y cerrar), sin bibliotecas nuevas', () => {
    assert.ok(tAviso.includes('<use href="#sipra-seguridad" />') && tAviso.includes('<use href="#sipra-cerrar" />'));
  });

  it('abrir el aviso no marca «¿Quién asume la ARL?» como tocada (no aparece el error antes de poder elegir)', () => {
    assert.equal((tRegistro.match(/\(blur\)="tocarArl\(\)"/g) ?? []).length, 2);
    assert.match(registro, /tocarArl\(\): void \{\s*if \(this\.avisoArl\(\)\.abierto\) return;\s*this\.arlTocada\.set\(true\);/);
  });

  it('el envío del FUR no cambia: el aviso no toca `fur`, la sugerencia ni el payload', () => {
    assert.doesNotMatch(aviso, /responsableArl|fur\b|registrarPractica/);
    const metodos = registro.slice(registro.indexOf('llegarASeccionArl(): void'), registro.indexOf('elegirArl(valor'));
    assert.doesNotMatch(metodos, /this\.fur|responsableArl|registrar/);
  });
});
