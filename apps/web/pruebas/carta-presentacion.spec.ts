import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Rol } from '@core/models/modelos';
import {
  TEXTO_CONFIRMACION, etiquetaArl, etiquetaEstado, nombreArchivo, puedeEmitirCarta, rutaVerificacion, solicitudDesde,
} from '../src/app/features/registro/carta-presentacion.util';

// Carta de presentación digital (presentación). El servidor emite, valida y firma con su referencia.
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...p), 'utf8');
const comp = src('features', 'registro', 'carta-presentacion.component.ts');
const plantilla = /template: `([\s\S]*?)`,\n\}\)/.exec(comp)?.[1] ?? '';
const estilos = /styles: \[`([\s\S]*?)`\]/.exec(comp)?.[1] ?? '';
const registro = src('features', 'registro', 'registro.component.ts');
const verificar = src('features', 'verificacion', 'verificar-carta.component.ts');
const rutas = src('app.routes.ts');
const api = src('core', 'services', 'api.service.ts');

describe('Carta · quién emite y qué se envía', () => {
  it('emiten estudiante, docente, auxiliar, coordinación y analista; dirección y administración solo consultan', () => {
    for (const r of ['estudiante', 'tutor', 'auxiliar', 'coordinador', 'analista'] as Rol[]) assert.equal(puedeEmitirCarta(r), true, r);
    for (const r of ['director', 'administrador', 'empresa', 'extension'] as Rol[]) assert.equal(puedeEmitirCarta(r), false, r);
  });
  it('la solicitud NO lleva nombre, documento propio, programa, nivel ni nombre de empresa: solo periodo, opción y (personal) documento', () => {
    assert.deepEqual(solicitudDesde('2026C', { practicaId: null, destinatario: 'generica', modalidad: 'monitoria' }, null), { periodoAcademico: '2026C', destinatario: 'generica', modalidad: 'monitoria' });
    assert.deepEqual(solicitudDesde('2026C', { practicaId: 'p1', destinatario: 'empresa', modalidad: 'pasantia' }, ' 1000000001 '), { periodoAcademico: '2026C', destinatario: 'empresa', practicaId: 'p1', estudianteDocumento: '1000000001' });
    assert.doesNotMatch(plantilla, /empresaRazonSocial|id="c-empresa"|id="c-nombre"|id="c-programa"/);
  });
  it('etiquetas de ARL y estado', () => {
    assert.equal(etiquetaArl('empresa'), 'La empresa');
    assert.equal(etiquetaArl('cun'), 'La CUN');
    assert.equal(etiquetaArl(null), 'Se define al registrar la práctica');
    assert.deepEqual(['vigente', 'reemplazada', 'anulada'].map((e) => etiquetaEstado(e as never)), ['Vigente', 'Reemplazada', 'Anulada']);
  });
  it('nombre de archivo comprensible y seguro', () => {
    assert.equal(nombreArchivo({ estudianteDocumento: '1000000001', generadaEn: '2026-11-18T15:00:00Z', id: 'abc' }), 'Carta_presentacion_1000000001_2026-11-18.pdf');
    assert.equal(nombreArchivo({ estudianteDocumento: '../x', generadaEn: 'raro', id: 'abcdefghij' }), 'Carta_presentacion_x_fecha.pdf');
  });
});

describe('Carta · flujo en Registro FUR y cartas', () => {
  it('es el Paso 1 del módulo existente (no otro módulo) y reemplaza el formulario anterior con empresa libre', () => {
    assert.match(registro, /<sipra-carta-presentacion \[periodos\]="periodos\(\)" \/>/);
    assert.doesNotMatch(registro, /cartaEmpresa|generarCarta\(|id="c-empresa"/);
  });
  it('vista previa con Destinatario, Estudiante, Documento, Programa, Nivel, Modalidad, Responsable ARL y el texto principal', () => {
    for (const t of ['Destinatario', 'Estudiante', 'Documento', 'Programa', 'Nivel', 'Modalidad', 'Responsable ARL']) assert.ok(plantilla.includes(`<dt>${t}</dt>`), t);
    assert.match(plantilla, /aria-label="Texto principal de la carta"/);
    assert.match(api, /cartas-presentacion\/vista-previa/);
  });
  it('bloqueos visibles (ARL sin definir, ventana cerrada) y «Generar carta» deshabilitado si no se puede', () => {
    assert.match(plantilla, /@for \(b of v\.bloqueos; track b\)/);
    assert.match(plantilla, /\[disabled\]="!v\.puedeGenerar \|\| cargando\(\)"/);
  });
  it('confirmación con el texto institucional, Cancelar con foco y retorno del foco', () => {
    assert.equal(TEXTO_CONFIRMACION, 'Se generará una carta institucional con estos datos. Una vez emitida quedará registrada en el historial.');
    assert.match(plantilla, /<dialog #confirmacion class="confirmar"/);
    assert.match(comp, /this\.cancelar\(\)\?\.nativeElement\.focus\(\)/);
    assert.match(comp, /alCerrar\(\): void \{ this\.origen\?\.focus\(\)/);
  });
  it('después de generar: Carta generada, Fecha, Referencia, Destinatario, Descargar PDF y Verificar', () => {
    for (const t of ['Carta generada', '<dt>Fecha</dt>', '<dt>Referencia</dt>', '<dt>Destinatario</dt>', 'Descargar PDF', 'Verificar']) assert.ok(plantilla.includes(t), t);
    assert.equal(rutaVerificacion('K7QM4-X2DPR'), '/verificar-carta/K7QM4-X2DPR');
  });
  it('historial compacto (fecha · REF · modalidad · estado · PDF), sin tabla', () => {
    assert.match(plantilla, /REF \{\{ c\.referencia \}\}/);
    assert.match(plantilla, /\{\{ estado\(c\.estado\) \}\}/);
    assert.doesNotMatch(plantilla, /<table/);
  });
  it('OnPush, sin overflow en móvil (rejillas fluidas y textos que parten)', () => {
    assert.match(comp, /ChangeDetectionStrategy\.OnPush/);
    assert.match(estilos, /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 200px\), 1fr\)\)/);
    assert.match(estilos, /overflow-wrap: anywhere/);
  });
});

describe('Carta · verificación pública', () => {
  it('ruta pública fuera del armazón (sin sesión)', () => {
    const bloque = /path: 'verificar-carta\/:referencia',[\s\S]*?\}/.exec(rutas)?.[0] ?? '';
    assert.ok(bloque && !bloque.includes('canActivate'));
    assert.ok(rutas.indexOf("path: 'verificar-carta/:referencia'") < rutas.indexOf('canActivate: [sesionGuard]'));
  });
  it('muestra solo lo mínimo y «Carta no encontrada» si no existe', () => {
    for (const t of ['Referencia', 'Estudiante', 'Identificación', 'Programa', 'Nivel', 'Modalidad', 'Fecha de expedición']) assert.ok(verificar.includes(`<dt>${t}</dt>`), t);
    assert.match(verificar, /Carta no encontrada/);
    assert.doesNotMatch(verificar, /correoInstitucional|practicaId|escuela|auditor/i);
  });
});
