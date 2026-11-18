import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  MENSAJES_CONSULTA, documentoConsultaValido, mensajeErrorConsulta, nombreArchivoPublico,
} from '../src/app/features/verificacion/consulta-carta.util';

// Consulta PÚBLICA de la carta vigente por número de identificación (sin sesión). El servidor decide y limita.
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...p), 'utf8');
const comp = src('features', 'verificacion', 'consultar-carta.component.ts');
const plantilla = /template: `([\s\S]*?)`,\n\}\)/.exec(comp)?.[1] ?? '';
const estilos = /styles: \[`([\s\S]*?)`\]/.exec(comp)?.[1] ?? '';
const verificar = src('features', 'verificacion', 'verificar-carta.component.ts');
const rutas = src('app.routes.ts');
const api = src('core', 'services', 'api.service.ts');

describe('Consulta pública · acceso y datos pedidos', () => {
  it('ruta pública /consultar-carta fuera del armazón (sin sesión ni sidebar)', () => {
    const bloque = /path: 'consultar-carta',[\s\S]*?\}/.exec(rutas)?.[0] ?? '';
    assert.ok(bloque && !bloque.includes('canActivate'));
    assert.ok(rutas.indexOf("path: 'consultar-carta'") < rutas.indexOf('canActivate: [sesionGuard]'));
  });
  it('la identificación es el ÚNICO dato pedido (sin correo, nombre, fecha, empresa ni contraseña)', () => {
    assert.equal((plantilla.match(/<input /g) ?? []).length, 1);
    assert.match(plantilla, /<label for="cc-doc">Número de identificación<\/label>/);
    assert.doesNotMatch(plantilla, /type="password"|correo|fecha de nacimiento|empresa/i);
  });
  it('la cédula viaja en el cuerpo de un POST (no en la URL); la descarga usa el token temporal', () => {
    assert.match(api, /this\.http\.post<[^>]+>\(`\$\{this\.base\}\/cartas-presentacion\/publica\/consultar`, \{ documento \}\)/);
    assert.match(api, /cartas-presentacion\/publica\/descargar`, \{ params: \{ token \}/);
    assert.doesNotMatch(rutas, /consultar-carta\/:/);
  });
  it('validación previa igual a la del servidor (sin búsquedas parciales: se envía tal cual)', () => {
    assert.equal(documentoConsultaValido('1.013.115.164'), true);
    assert.equal(documentoConsultaValido('AB 12 34'), true);
    for (const malo of ['', '12', "1' OR 1=1", '<b>1234</b>', 'x'.repeat(21)]) assert.equal(documentoConsultaValido(malo), false, malo);
  });
});

describe('Consulta pública · resultado, descarga y mensajes', () => {
  it('resultado compacto: estado, estudiante, programa, nivel, modalidad, fecha, destinatario, referencia; descarga y verificación', () => {
    for (const t of ['Carta de presentación vigente', '<dt>Estudiante</dt>', '<dt>Programa</dt>', '<dt>Nivel</dt>', '<dt>Modalidad</dt>', '<dt>Fecha de expedición</dt>', '<dt>Destinatario</dt>', '<dt>Referencia</dt>', 'Descargar carta PDF', 'Verificar autenticidad']) {
      assert.ok(plantilla.includes(t), t);
    }
    assert.doesNotMatch(plantilla, /<table|hash|historial|auditor/i);
  });
  it('mensajes por estado: 429 límite, 410 ya no vigente, 403 enlace vencido, 400 inválida', () => {
    assert.equal(mensajeErrorConsulta({ status: 429 }), MENSAJES_CONSULTA.limite);
    assert.equal(mensajeErrorConsulta({ status: 410 }), 'La carta consultada ya no se encuentra vigente.');
    assert.equal(mensajeErrorConsulta({ status: 403 }), MENSAJES_CONSULTA.enlace);
    assert.equal(mensajeErrorConsulta({ status: 400 }), MENSAJES_CONSULTA.invalida);
    assert.equal(mensajeErrorConsulta(new Error('x')), MENSAJES_CONSULTA.general);
  });
  it('el archivo descargado se nombra con la referencia (no con la cédula)', () => {
    assert.equal(nombreArchivoPublico('K7QM4-X2DPR'), 'Carta_presentacion_K7QM4-X2DPR.pdf');
  });
  it('móvil: campo y botón grandes (48 px), acciones a ancho completo', () => {
    assert.match(estilos, /input \{ width: 100%;[^}]*min-height: 48px/);
    assert.match(estilos, /button\.principal \{ min-height: 48px/);
    assert.match(estilos, /@media \(max-width: 480px\)[\s\S]*\.acciones > \* \{ flex: 1 1 100%; \}/);
  });
  it('enlaces entre experiencias: verificación (QR) ↔ consulta por identificación', () => {
    assert.match(verificar, /<a routerLink="\/consultar-carta">Consultar carta por identificación<\/a>/);
    assert.match(plantilla, /\[routerLink\]="\['\/verificar-carta', c\.referencia\]"/);
  });
});
