import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// Las pruebas corren con cwd = apps/web.
const leer = (...p: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...p), 'utf8');
const vistas = {
  rut: leer('features', 'rut', 'rut-estudiante.component.ts'),
  camara: leer('features', 'camara', 'camara-estudiante.component.ts'),
  acta: leer('features', 'actas', 'acta-estudiante.component.ts'),
};
const explicacion = leer('shared', 'components', 'explicacion-documento.component.ts');

describe('Vistas estudiante V3 (RUT, Cámara, Acta): solo presentación', () => {
  for (const [marca, src] of Object.entries(vistas)) {
    it(`${marca}: estado con señal V3 y el texto exacto del servidor en data-${marca}-estado`, () => {
      assert.ok(src.includes(`<sipra-senal-estado data-${marca}-estado [tono]="tono(e)" [texto]="e.etiqueta" />`));
    });
    it(`${marca}: explicación sin caja, con la acción existente dentro de data-${marca}-mensaje`, () => {
      assert.ok(src.includes(`<sipra-explicacion-documento data-${marca}-mensaje [tono]="tono(e)" [que]="e.que" [hacer]="e.hacer">`));
      assert.match(src, /\(click\)="cargar\.emit\(\)">\{\{ e\.estado === '(rechazado|rechazada)' \? 'Subir (un nuevo RUT|un nuevo certificado|una nueva Acta)' : 'Subir nueva versión' \}\}<\/button>/);
      assert.doesNotMatch(src, /class="caja|etiqueta etiqueta--/);
    });
    it(`${marca}: conserva entradas, salida y consulta`, () => {
      assert.match(src, /readonly practicaId = input\.required<string>\(\);/);
      assert.match(src, /readonly puedeCargar = input<boolean>\(false\);/);
      assert.match(src, /readonly cargar = output<void>\(\);/);
      assert.match(src, /this\.api\.estadoDeMi(Rut|Camara|Acta)\(id\)/);
    });
  }
});

describe('Kit V3 · explicación de documento', () => {
  it('responde «¿Qué pasó?» y «¿Qué debo hacer?» y anuncia los cambios', () => {
    assert.ok(explicacion.includes('<span class="rotulo">¿Qué pasó?</span> {{ que() }}'));
    assert.ok(explicacion.includes('<span class="rotulo">¿Qué debo hacer?</span> {{ hacer() }}'));
    assert.match(explicacion, /host: \{ role: 'status'/);
  });
  it('aprobado en silencio (sin línea ni fondo) y sin lógica de dominio', () => {
    assert.match(explicacion, /:host\(\[data-tono='ok'\]\) \{ padding-left: 0; border-left: 0; background: none; \}/);
    assert.doesNotMatch(explicacion.replace(/\/\*[\s\S]*?\*\//g, ''), /ApiService|inject\(|rut|camara|acta/i);
  });
});
