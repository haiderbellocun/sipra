import '@angular/compiler';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { tonoDe } from '@shared/components/senal-estado.component';

// Las pruebas corren con cwd = apps/web.
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...p), 'utf8');
const exp = src('features', 'practicas', 'expediente.component.ts');
const plantilla = /template: `([\s\S]*?)`,\n\}\)/.exec(exp)?.[1] ?? '';

describe('Expediente V3 (capa A)', () => {
  it('el Document Signal sale de los documentos exigidos reales (avance.momentos), sin tipos fijos', () => {
    assert.ok(plantilla.includes('<sipra-expediente-senal [momentos]="p.avance.momentos" '));
    const senal = src('features', 'practicas', 'expediente-senal.component.ts');
    assert.match(senal, /@for \(m of momentos\(\); track m\.momento\) \{\s*@for \(d of m\.documentos; track d\.tipo; let primero = \$first\)/);
    assert.doesNotMatch(senal, /rut_|camara_comercio|acta_inicio|certificado_eps/);
    assert.ok(senal.includes('<button type="button" (click)="ir.emit(d.tipo)" [attr.aria-label]='));
    assert.ok(senal.includes('<span class="est">{{ g.estado }}</span>'));
  });
  it('conserva las vistas de dominio con sus mismas entradas y salidas', () => {
    assert.match(plantilla, /<sipra-acta-estudiante \[practicaId\]="id\(\)" \[documentos\]="documentos\(\)" \[puedeCargar\]="puedeCargar\(\)" \(cargar\)="corregir\('acta_inicio'\)" \/>/);
    assert.match(plantilla, /<sipra-rut-estudiante \[practicaId\]="id\(\)" \[tipo\]="d\.tipo" \[documentos\]="documentos\(\)" \[puedeCargar\]="puedeCargar\(\)" \(cargar\)="corregir\(d\.tipo\)" \/>/);
    assert.match(plantilla, /<sipra-camara-estudiante \[practicaId\]="id\(\)" \[tipo\]="d\.tipo" \[documentos\]="documentos\(\)" \[puedeCargar\]="puedeCargar\(\)" \(cargar\)="corregir\(d\.tipo\)" \/>/);
  });
  it('mantiene carga, decisión y llamadas (presentación únicamente)', () => {
    assert.match(plantilla, /accept="application\/pdf,image\/jpeg,image\/png"/);
    for (const llamada of ['cargarDocumento', 'decidirDocumento', 'escribirBitacora', 'cerrarPractica', 'actualizarVacante', 'registrarArl', 'transicionarPractica', 'obtenerPractica', 'listarDocumentos', 'listarBitacora', 'estadoCierre']) {
      assert.match(exp, new RegExp(`this\\.api\\.${llamada}\\(`), llamada);
    }
    assert.match(plantilla, /class="zona"/); // «corregir()» lleva el foco a la zona de carga por esta clase
  });
  it('regreso a Prácticas y vacío V3 cuando no hay expediente', () => {
    assert.match(plantilla, /<nav class="migas" aria-label="Ruta"><a routerLink="\/practicas">/);
    assert.match(plantilla, /<sipra-estado-vacio titulo="Expediente no disponible"/);
    assert.match(plantilla, /<sipra-carga-senal /);
  });
  it('pestañas con aria-selected', () => {
    assert.equal((plantilla.match(/\[attr\.aria-selected\]=/g) ?? []).length, 3);
  });
});

describe('Kit V3 · señal de estado (estados de documento y overrides)', () => {
  it('tonos de documento con el criterio de sipra-estado', () => {
    assert.equal(tonoDe('aprobado'), 'ok');
    assert.equal(tonoDe('auto_aprobado'), 'ok');
    assert.equal(tonoDe('devuelto'), 'aviso');
    assert.equal(tonoDe('en_revision'), 'aviso');
    assert.equal(tonoDe('rechazado'), 'peligro');
    assert.equal(tonoDe('analizando'), 'info');
  });
  it('acepta tono y texto calculados por quien la usa, sin lógica de dominio propia', () => {
    const s = src('shared', 'components', 'senal-estado.component.ts');
    assert.match(s, /readonly tono = input<TonoV3 \| null>\(null\)/);
    assert.match(s, /readonly texto = input<string \| null>\(null\)/);
    assert.doesNotMatch(s, /guiaDocumento|rut|camara|acta/i);
  });
});
