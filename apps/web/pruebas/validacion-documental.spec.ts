import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DocumentoDeExpediente, EstadoHumanoDocumento, ProgresoExpediente, ResumenDocumento } from '@core/models/validacion-documental.model';
import { TIPOS_CON_MOTOR_ESPECIALIZADO, decisionGeneralPermitida, tieneMotorEspecializado } from '../src/app/shared/utils/motores-documentales';
import {
  ESTADO_VISUAL, NOMBRE_MOTOR, VISTAS_RAPIDAS, contadoresExpediente, etiquetaProgreso, filtrosAvanzadosActivos, filtrosLimpios, navegarDocumento,
  rotuloEstado, textoChip, textoProgreso, textoReservaDocumento, textoTrabajando,
} from '../src/app/features/validacion-documental/vd.util';

const ESTADOS: EstadoHumanoDocumento[] = [
  'pendiente_de_cargar', 'procesando', 'disponible_para_revision', 'en_revision', 'necesita_correccion', 'aprobado', 'rechazado', 'error', 'no_aplica',
];

const doc = (tipo: string, sobre: Partial<DocumentoDeExpediente> = {}): DocumentoDeExpediente => ({
  documentoId: 'd-' + tipo, practicaId: 'p', estudianteId: 'e', tipoDocumento: tipo, nombreHumano: tipo, motor: 'general', version: 1, estadoInterno: 'en_revision',
  estadoHumano: 'aprobado', estadoHumanoEtiqueta: 'Aprobado', fechaCarga: null, problemaPrincipal: null, requiereRevision: false, criticidad: 'normal',
  informacionInsuficiente: false, esReenvio: false, versionesAnteriores: 0, reserva: { estado: 'libre', por: null, hasta: null, minutosRestantes: null },
  validacionId: null, obligatorio: true, operable: true, puedeTomar: false, puedeDecidir: false, ...sobre,
});
const porRevisar = (tipo: string, reserva: DocumentoDeExpediente['reserva'] = { estado: 'libre', por: null, hasta: null, minutosRestantes: null }) =>
  doc(tipo, { requiereRevision: true, estadoHumano: 'disponible_para_revision', reserva });

const progreso = (sobre: Partial<ProgresoExpediente> = {}): ProgresoExpediente => ({
  total: 6, aprobados: 2, pendientesDeCargar: 2, requierenRevision: 2, necesitanCorreccion: 0, procesando: 0, rechazados: 0, errores: 0, completo: false, porcentaje: 33, ...sobre,
});

describe('Validación documental · estado humano común (solo presentación)', () => {
  it('los nueve estados tienen etiqueta, icono y tono; el icono acompaña SIEMPRE al texto', () => {
    assert.deepEqual(Object.keys(ESTADO_VISUAL).sort(), [...ESTADOS].sort());
    for (const e of ESTADOS) {
      const r = rotuloEstado(e);
      assert.ok(r.texto.length > 0 && r.icono.length > 0, e);
      assert.doesNotMatch(r.texto, /_/, 'nada de códigos internos');
    }
  });

  it('las etiquetas son las pedidas', () => {
    assert.deepEqual(ESTADOS.map((e) => rotuloEstado(e).texto), [
      'Pendiente de cargar', 'Procesando', 'Disponible para revisión', 'En revisión', 'Necesita corrección', 'Aprobado', 'Rechazado', 'Error', 'No aplica',
    ]);
  });

  it('cada motor tiene nombre humano y el general también', () => {
    for (const m of ['eps', 'acta', 'rut', 'camara', 'general']) assert.ok(NOMBRE_MOTOR[m]);
  });
});

describe('Validación documental · reserva por documento', () => {
  it('«Tomado por Juan · 8 min», «Tomado por usted», «Disponible» y vencida', () => {
    assert.equal(textoReservaDocumento({ estado: 'otro', por: 'Juan', minutosRestantes: 8 }), 'Tomado por Juan · 8 min');
    assert.equal(textoReservaDocumento({ estado: 'mia', por: 'Ana', minutosRestantes: 4 }), 'Tomado por usted · 4 min');
    assert.equal(textoReservaDocumento({ estado: 'libre', por: null, minutosRestantes: null }), 'Disponible');
    assert.match(textoReservaDocumento({ estado: 'vencida', por: 'Juan', minutosRestantes: 0 }), /vencida/i);
  });

  it('el chip de la cola agrega la reserva solo si está vigente', () => {
    const base: ResumenDocumento = { tipoDocumento: 'rut_juridico', nombreHumano: 'RUT', motor: 'rut', estadoHumano: 'en_revision', estadoHumanoEtiqueta: 'En revisión', obligatorio: true, reserva: { estado: 'otro', por: 'Juan', minutosRestantes: 8 } };
    assert.equal(textoChip(base), 'RUT · En revisión · Tomado por Juan · 8 min');
    assert.equal(textoChip({ ...base, estadoHumano: 'aprobado', estadoHumanoEtiqueta: 'Aprobado', reserva: { estado: 'libre', por: null, minutosRestantes: null } }), 'RUT · Aprobado');
    assert.equal(textoTrabajando([{ nombre: 'Juan', documentos: 1, esUsted: false }, { nombre: 'Usted', documentos: 2, esUsted: true }]), 'Juan (1) · Usted (2)');
    assert.equal(textoTrabajando([]), null);
  });
});

describe('Validación documental · progreso del expediente', () => {
  it('«2 / 6 aprobados» y contadores en palabras', () => {
    assert.equal(textoProgreso(progreso()), '2 / 6 aprobados');
    assert.deepEqual(contadoresExpediente(progreso({ necesitanCorreccion: 1 })).map((c) => [c.texto, c.n]), [
      ['Pendientes de cargar', 2], ['Requieren revisión', 2], ['Necesitan corrección', 1],
    ]);
  });

  it('solo se dice «completa» cuando el servidor lo dice; nunca por inferencia', () => {
    assert.equal(etiquetaProgreso(progreso({ aprobados: 6, completo: false })), 'En curso');
    assert.equal(etiquetaProgreso(progreso({ aprobados: 6, completo: true })), 'Documentación completa');
    assert.equal(etiquetaProgreso(progreso({ total: 0, aprobados: 0, completo: false })), 'Sin obligaciones documentales');
  });
});

describe('Validación documental · navegación entre documentos (sin volver a la cola)', () => {
  const lista = [doc('eps', { requiereRevision: true }), doc('rut'), porRevisar('camara'), doc('acta'), doc('arl')];

  it('siguiente y anterior dan la vuelta', () => {
    assert.equal(navegarDocumento(lista, 'eps', 'siguiente')?.tipoDocumento, 'rut');
    assert.equal(navegarDocumento(lista, 'arl', 'siguiente')?.tipoDocumento, 'eps');
    assert.equal(navegarDocumento(lista, 'eps', 'anterior')?.tipoDocumento, 'arl');
    assert.equal(navegarDocumento([], 'eps', 'siguiente'), null);
  });

  it('«siguiente pendiente» salta lo que ya está resuelto y lo que otra persona tiene tomado', () => {
    assert.equal(navegarDocumento(lista, 'eps', 'pendiente')?.tipoDocumento, 'camara');
    const conAjeno = [doc('eps'), porRevisar('rut', { estado: 'otro', por: 'Juan', hasta: null, minutosRestantes: 8 }), porRevisar('camara')];
    assert.equal(navegarDocumento(conAjeno, 'eps', 'pendiente')?.tipoDocumento, 'camara');
    // Con un documento ya tomado por mí, sí se ofrece.
    const mio = [doc('eps'), porRevisar('rut', { estado: 'mia', por: null, hasta: null, minutosRestantes: 8 })];
    assert.equal(navegarDocumento(mio, 'eps', 'pendiente')?.tipoDocumento, 'rut');
  });

  it('sin nada pendiente devuelve null (la pantalla avisa y no se mueve)', () => {
    assert.equal(navegarDocumento([doc('eps'), doc('rut')], 'eps', 'pendiente'), null);
  });

  it('sin documento activo, «siguiente pendiente» empieza por el principio', () => {
    assert.equal(navegarDocumento(lista, null, 'pendiente')?.tipoDocumento, 'eps');
  });
});

describe('Validación documental · vistas rápidas y filtros', () => {
  it('las cinco vistas rápidas pedidas', () => {
    assert.deepEqual(VISTAS_RAPIDAS.map((v) => v.titulo), ['Todos', 'Con pendientes', 'Con problemas', 'Mis documentos', 'Reservas por vencer']);
  });

  it('los filtros vacíos y la vista «todos» no viajan al servidor', () => {
    assert.deepEqual(filtrosLimpios({ vista: 'todos', buscar: '', escuela: 'ING', estado: '', ocr: 'si' }), { escuela: 'ING', ocr: 'si' });
    assert.deepEqual(filtrosLimpios({ vista: 'mis_documentos' }), { vista: 'mis_documentos' });
  });

  it('el contador de «Más filtros» no cuenta la vista ni la búsqueda', () => {
    assert.equal(filtrosAvanzadosActivos({ vista: 'problemas', buscar: 'ana' }), 0);
    assert.equal(filtrosAvanzadosActivos({ escuela: 'ING', ocr: 'si', conDevueltos: 'si', reserva: '' }), 3);
  });
});

describe('Regresión del hueco del RUT · decisión general vs motor especializado', () => {
  it('los cinco tipos con motor especializado NO ofrecen la decisión general', () => {
    assert.deepEqual([...TIPOS_CON_MOTOR_ESPECIALIZADO].sort(), ['acta_inicio', 'camara_comercio', 'certificado_eps', 'rut_juridico', 'rut_natural']);
    for (const t of ['certificado_eps', 'acta_inicio', 'rut_natural', 'rut_juridico', 'camara_comercio']) {
      assert.equal(decisionGeneralPermitida(t), false, t);
      assert.equal(tieneMotorEspecializado(t), true, t);
    }
  });

  it('los demás tipos conservan la decisión general', () => {
    for (const t of ['cedula', 'certificado_arl', 'planilla_horas', 'plan_mejoramiento', 'entregable_mentoria_1', 'evaluacion_final_cunbre', 'carta_aceptacion']) {
      assert.equal(decisionGeneralPermitida(t), true, t);
      assert.equal(tieneMotorEspecializado(t), false, t);
    }
  });
});
