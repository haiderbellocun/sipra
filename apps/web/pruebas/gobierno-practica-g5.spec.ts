import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  CAMPOS_PRACTICA, FormularioPractica, cambiosFormulario, cuerpoModificacion, problemasEdicion,
} from '../src/app/features/practicas/gobierno-practica';

// G5 · Gobierno y modificación controlada de prácticas (presentación). El servidor autoriza, valida y audita.
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', 'app', ...p), 'utf8');
const comp = src('features', 'practicas', 'practica-gobierno.component.ts');
const plantilla = /template: `([\s\S]*?)`,\n\}\)/.exec(comp)?.[1] ?? '';
const exp = src('features', 'practicas', 'expediente.component.ts');
const plantillaExp = /template: `([\s\S]*?)`,\n\}\)/.exec(exp)?.[1] ?? '';
const api = src('core', 'services', 'api.service.ts');

const base: FormularioPractica = {
  modalidad: 'pasantia', area: 'TI', cargo: 'Practicante', tipoRemuneracion: 'remunerada', salario: '1300000', responsableArl: 'empresa',
  horario: 'L-V', ciudad: 'Bogotá', jefeInmediatoNombre: 'Jefe Sintético', jefeInmediatoCargo: 'Líder', jefeInmediatoCorreo: 'jefe@ejemplo.test',
  jefeInmediatoTelefono: '3000000000', funcionesRelevantes: 'Soporte',
};
const legible = (_c: keyof FormularioPractica, v: string) => v;

describe('G5 · formulario de la práctica', () => {
  it('sin cambios no hay resumen (Guardar queda deshabilitado)', () => {
    assert.deepEqual(cambiosFormulario(base, { ...base }, legible), []);
  });
  it('el resumen muestra «de → a» por campo', () => {
    const c = cambiosFormulario(base, { ...base, modalidad: 'contrato_aprendizaje', cargo: 'Aprendiz' }, legible);
    assert.deepEqual(c.map((x) => [x.etiqueta, x.de, x.a]), [['Modalidad', 'pasantia', 'contrato_aprendizaje'], ['Cargo', 'Practicante', 'Aprendiz']]);
  });
  it('el cuerpo envía SOLO lo que cambió, con justificación y versión (control optimista)', () => {
    const cuerpo = cuerpoModificacion(base, { ...base, cargo: 'Aprendiz' }, '  Ajuste pactado con la empresa ', 'v-1');
    assert.deepEqual(cuerpo, { justificacion: 'Ajuste pactado con la empresa', actualizadaEn: 'v-1', cargo: 'Aprendiz' });
  });
  it('el responsable de la ARL solo viaja si se cambió explícitamente (nunca se infiere de la modalidad)', () => {
    const cuerpo = cuerpoModificacion(base, { ...base, modalidad: 'contrato_aprendizaje' }, 'Cambio de modalidad acordado', 'v');
    assert.equal('responsableArl' in cuerpo, false);
    assert.equal(cuerpo['modalidad'], 'contrato_aprendizaje');
  });
  it('no se «borran» modalidad, remuneración ni responsable; pasar a no remunerada no envía salario', () => {
    const vacio = cuerpoModificacion(base, { ...base, responsableArl: '', tipoRemuneracion: '' }, 'Justificación suficiente', 'v');
    assert.equal('responsableArl' in vacio, false); assert.equal('tipoRemuneracion' in vacio, false);
    const nr = cuerpoModificacion(base, { ...base, tipoRemuneracion: 'no_remunerada' }, 'Justificación suficiente', 'v');
    assert.equal(nr['tipoRemuneracion'], 'no_remunerada'); assert.equal('salario' in nr, false);
    const sal = cuerpoModificacion(base, { ...base, salario: '1500000' }, 'Justificación suficiente', 'v');
    assert.equal(sal['salario'], 1500000);
  });
  it('justificación obligatoria (mínimo 10) y correo válido', () => {
    assert.ok(problemasEdicion(base, 'corta').justificacion);
    assert.equal(problemasEdicion(base, 'Motivo suficiente').justificacion, undefined);
    assert.ok(problemasEdicion({ ...base, jefeInmediatoCorreo: 'no-es-correo' }, 'Motivo suficiente').jefeInmediatoCorreo);
  });
  it('fechas, periodo, empresa, estado y nota NO son campos editables', () => {
    const claves = CAMPOS_PRACTICA.map((c) => c.clave as string);
    for (const prohibido of ['fechaInicio', 'fechaFin', 'periodoId', 'empresaId', 'estado', 'nota']) assert.ok(!claves.includes(prohibido), prohibido);
  });
});

describe('G5 · componente de gobierno', () => {
  it('OnPush y <dialog> nativo para el editor y el cambio de estado', () => {
    assert.match(comp, /ChangeDetectionStrategy\.OnPush/);
    assert.match(plantilla, /<dialog #editor class="cajon"/);
    assert.match(plantilla, /<dialog #estado class="confirmar"/);
  });
  it('los botones solo existen con gobierno.puedeModificar (lo proyecta el servidor para coordinación y analista)', () => {
    const i = plantilla.indexOf('@if (g.puedeModificar)');
    assert.ok(i > 0 && plantilla.indexOf('Editar práctica') > i && plantilla.indexOf('Cambiar estado') > i);
    assert.match(plantilla, /Los cambios de datos y de estado de la práctica los hacen coordinación y analista/);
    // Los diálogos tampoco se renderizan para quien no modifica.
    const j = plantilla.lastIndexOf('@if (g.puedeModificar)');
    assert.ok(j > i && plantilla.indexOf('<dialog #editor') > j && plantilla.indexOf('<dialog #estado') > j);
  });
  it('Guardar deshabilitado sin cambios o con problemas; resumen de cambios visible', () => {
    assert.match(plantilla, /\[disabled\]="!puedeGuardar\(\) \|\| guardando\(\)"/);
    assert.match(comp, /puedeGuardar = computed\(\(\) => this\.cambios\(\)\.length > 0 && Object\.keys\(this\.problemas\(\)\)\.length === 0\)/);
    assert.match(plantilla, /Resumen de cambios/);
  });
  it('el diálogo de estado muestra el estado actual, los destinos bloqueados con su motivo y exige justificación', () => {
    assert.match(plantilla, /Estado actual: <strong>\{\{ g\.etiquetaEstadoOperativo \}\}<\/strong>/);
    assert.match(plantilla, /\[disabled\]="!d\.disponible"/);
    assert.match(plantilla, /@if \(d\.motivo\) \{ <small>\{\{ d\.motivo \}\}<\/small> \}/);
    assert.match(comp, /this\.justificacionEstado\(\)\.trim\(\)\.length >= JUSTIFICACION_MINIMA/);
  });
  it('usa las rutas G5 y envía la versión', () => {
    assert.match(api, /\/practicas\/\$\{id\}\/datos/);
    assert.match(api, /\/practicas\/\$\{id\}\/estado-operativo/);
    assert.match(comp, /actualizadaEn: this\.practica\(\)\.gobierno\?\.actualizadaEn/);
  });
  it('el expediente ya no tiene el editor de vacante ni los botones técnicos de transición', () => {
    assert.doesNotMatch(exp, /guardarVacante|puedeEditarVacante|transicionarPractica|transicionesPosibles/);
    assert.match(plantillaExp, /<sipra-practica-gobierno \[practica\]="p" \(actualizada\)="recargar\(\)" \/>/);
  });
});
