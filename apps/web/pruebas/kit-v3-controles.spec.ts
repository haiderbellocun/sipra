import '@angular/compiler';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { etiquetaRol, inicialesDe } from '@shared/components/control-cuenta.component';

// Las pruebas corren con cwd = apps/web.
const fuente = (...p: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...p), 'utf8');
const cuenta = fuente('shared', 'components', 'control-cuenta.component.ts');
const tema = fuente('shared', 'components', 'control-tema.component.ts').replace(/\/\*[\s\S]*?\*\//g, ''); // sin comentarios
const shell = fuente('layout', 'shell.component.ts');
const ingreso = fuente('features', 'ingreso', 'ingreso.component.ts');

describe('Kit V3 · control de cuenta (funciones puras)', () => {
  it('rotula el rol como el armazón, con «· consulta» para permiso de lectura', () => {
    assert.equal(etiquetaRol('coordinador', 'escritura'), 'Coordinación de prácticas');
    assert.equal(etiquetaRol('estudiante'), 'Practicante');
    assert.equal(etiquetaRol('auxiliar', 'consulta'), 'Auxiliar de prácticas · consulta');
    assert.equal(etiquetaRol(null), '');
  });
  it('iniciales: primer y último nombre; «·» sin nombre', () => {
    assert.equal(inicialesDe('Andrés Felipe Mora Castaño'), 'AC');
    assert.equal(inicialesDe('Laura'), 'L');
    assert.equal(inicialesDe('  '), '·');
    assert.equal(inicialesDe(null), '·');
  });
});

describe('Kit V3 · un solo mecanismo de sesión y de tema', () => {
  it('cerrar sesión llama a SesionService.salir() y el control no toca el almacenamiento', () => {
    assert.match(cuenta, /\(click\)="sesion\.salir\(\)"/);
    assert.doesNotMatch(cuenta, /localStorage|sessionStorage|cambiarUsuario/);
  });
  it('el usuario de prueba se reconoce por modo «abierto» (sin otra fuente de verdad)', () => {
    assert.match(cuenta, /modo === 'abierto'/);
  });
  it('el control de tema solo delega en TemaService (sin clave propia ni matchMedia)', () => {
    assert.match(tema, /tema\.alternar\(\)/);
    assert.doesNotMatch(tema, /localStorage|sipra\.tema|matchMedia\(/);
  });
  it('shell e ingreso usan el MISMO control de tema; el shell, el de cuenta', () => {
    assert.match(shell, /<sipra-control-tema variante="rail"/);
    assert.match(shell, /<sipra-control-tema variante="etiqueta"/);
    assert.match(shell, /<sipra-control-cuenta variante="rail"/);
    assert.match(shell, /<sipra-control-cuenta variante="barra"/);
    assert.match(ingreso, /<sipra-control-tema [^>]*variante="icono"/);
    assert.doesNotMatch(shell + ingreso, /role="switch"/);
  });
  it('accesibilidad declarada: switch con nombre y estado; divulgación con aria-expanded/aria-controls', () => {
    assert.match(tema, /role="switch" \[attr\.aria-checked\]="claro" aria-label="Tema claro"/);
    assert.match(cuenta, /\[attr\.aria-expanded\]="abierto\(\)" \[attr\.aria-controls\]="idPanel"/);
    assert.match(cuenta, /document:keydown\.escape/);
  });
});
