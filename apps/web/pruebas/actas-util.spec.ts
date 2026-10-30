import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as modulo from '../src/app/features/actas/actas.util';
import {
  AYUDA_FIRMAS, OPCIONES_ARL, OPCIONES_REMUNERACION, TEXTO_RESULTADO_CORRECCION, apartaDeRecomendacionActa,
  descripcionCampo, devolucionValida, minimoJustificacion, ordenarCampos, presenciaFirma, previsualizarDevolucion, problemaPrincipal,
  resultadoActa, resultadoCampo, textoReserva, tonoEstudiante, valorDeTexto,
} from '../src/app/features/actas/actas.util';

/** Nada de lo que ve una persona puede ser un código interno, un enum o un valor sin traducir. */
const PROHIBIDO = /\b(null|undefined|enum|documento_incorrecto|discrepancia_critica|firma_faltante|no_determinable|revision_necesaria|aprobado_manual)\b|_/;

describe('Mesa de Actas · resultado principal', () => {
  it('las cuatro frases pedidas, sin enums', () => {
    assert.equal(resultadoActa('consistente').frase, 'Los datos principales del Acta coinciden con la práctica.');
    assert.equal(resultadoActa('discrepancia_critica').frase, 'Encontramos diferencias que requieren revisión.');
    assert.equal(resultadoActa('revisar').frase, 'Encontramos diferencias que requieren revisión.');
    assert.equal(resultadoActa('documento_incorrecto').frase, 'El archivo cargado no parece ser un Acta de Iniciación.');
    assert.equal(resultadoActa('no_determinable').frase, 'No pudimos verificar con suficiente confianza algunos datos del documento.');
    for (const c of ['consistente', 'discrepancia_critica', 'revisar', 'firma_faltante', 'documento_incorrecto', 'no_determinable']) {
      const r = resultadoActa(c);
      assert.doesNotMatch(`${r.titulo} ${r.frase} ${r.problema ?? ''}`, PROHIBIDO, c);
      assert.ok(r.icono.length > 0, 'todo estado lleva icono: no depende solo del color');
    }
  });
  it('una recomendación desconocida se trata como «no determinable» (nunca se muestra el código)', () => {
    assert.equal(resultadoActa('algo_nuevo').titulo, 'No determinable');
  });
  it('la bandeja señala UN problema por caso; lo consistente no lleva problema', () => {
    const base = { firmaEmpresa: 'si', firmaPracticante: 'si', inconsistenciaOperativa: false };
    assert.equal(problemaPrincipal({ ...base, recomendacion: 'consistente' }), null);
    assert.equal(problemaPrincipal({ ...base, recomendacion: 'documento_incorrecto' })?.texto, 'Parece ser otro documento');
    assert.equal(problemaPrincipal({ ...base, recomendacion: 'discrepancia_critica' })?.tono, 'peligro');
  });
  it('si falta una firma, el problema dice cuál', () => {
    const base = { recomendacion: 'firma_faltante', inconsistenciaOperativa: false };
    assert.equal(problemaPrincipal({ ...base, firmaEmpresa: 'no', firmaPracticante: 'si' })?.texto, 'Falta la firma de la empresa');
    assert.equal(problemaPrincipal({ ...base, firmaEmpresa: 'si', firmaPracticante: 'no' })?.texto, 'Falta la firma del practicante');
    assert.equal(problemaPrincipal({ ...base, firmaEmpresa: 'no', firmaPracticante: 'no' })?.texto, 'Faltan las firmas de la empresa y del practicante');
  });
  it('la inconsistencia operativa manda sobre cualquier otro problema', () => {
    const p = problemaPrincipal({ recomendacion: 'consistente', firmaEmpresa: 'si', firmaPracticante: 'si', inconsistenciaOperativa: true });
    assert.equal(p?.texto, 'Requiere revisión administrativa');
  });
});

describe('Mesa de Actas · firmas', () => {
  it('detectada / no detectada / no se pudo determinar, con icono, y sin lenguaje de autenticidad', () => {
    assert.equal(presenciaFirma('si').texto, 'Detectada');
    assert.equal(presenciaFirma('no').texto, 'No detectada');
    assert.equal(presenciaFirma('no_determinable').texto, 'No se pudo determinar');
    assert.equal(presenciaFirma(null).texto, 'Sin revisar');
    assert.equal(AYUDA_FIRMAS, 'SIPRA detecta presencia probable de firma; no valida su autenticidad.');
    for (const v of ['si', 'no', 'no_determinable', null]) assert.doesNotMatch(presenciaFirma(v).texto, /biom|auténtic|válid|huella/i);
  });
});

describe('Mesa de Actas · comparación', () => {
  const campo = (c: string, resultado = 'coincide', criticidad = 'baja') => ({ campo: c, etiqueta: c, sipra: 'a', acta: 'b', resultado, criticidad, nota: null });
  it('el orden de lectura es el pedido, sin importar cómo llegue de la API', () => {
    const llegan = ['funciones', 'responsable_arl', 'estudiante', 'nit', 'documento', 'programa', 'fecha_fin', 'empresa', 'jefe_inmediato', 'remuneracion', 'modalidad', 'fecha_inicio'];
    assert.deepEqual(ordenarCampos(llegan.map((c) => campo(c))).map((c) => c.campo), [
      'estudiante', 'documento', 'empresa', 'nit', 'fecha_inicio', 'fecha_fin', 'modalidad', 'remuneracion', 'responsable_arl', 'programa', 'jefe_inmediato', 'funciones',
    ]);
  });
  it('una diferencia crítica se marca «No coincide» y CRÍTICO; una no crítica, solo «No coincide» con tono de aviso', () => {
    const critica = resultadoCampo({ resultado: 'diferente', criticidad: 'critica' });
    assert.deepEqual([critica.texto, critica.critico, critica.tono], ['No coincide', true, 'peligro']);
    const leve = resultadoCampo({ resultado: 'diferente', criticidad: 'baja' });
    assert.deepEqual([leve.texto, leve.critico, leve.tono], ['No coincide', false, 'aviso']);
    assert.equal(resultadoCampo({ resultado: 'coincide', criticidad: 'critica' }).critico, false);
    assert.equal(resultadoCampo({ resultado: 'informacion_insuficiente', criticidad: 'media' }).texto, 'Sin información suficiente');
  });
  it('la fila se lee completa con lector de pantalla (no solo por color)', () => {
    const t = descripcionCampo({ campo: 'responsable_arl', etiqueta: 'Responsable ARL', sipra: 'CUN', acta: 'Empresa', resultado: 'diferente', criticidad: 'critica', nota: null });
    assert.match(t, /Responsable ARL: SIPRA CUN, Acta Empresa\. No coincide, crítico\./);
  });
});

describe('Mesa de Actas · reserva', () => {
  it('textos humanos por estado de la reserva', () => {
    assert.equal(textoReserva({ estado: 'mia', por: 'Ana' }).texto, 'Tomado por usted');
    assert.equal(textoReserva({ estado: 'otro', por: 'Ana' }).texto, 'Tomado por Ana');
    assert.equal(textoReserva({ estado: 'otro', por: null }).texto, 'Tomado por otra persona');
    assert.equal(textoReserva({ estado: 'libre', por: null }).texto, 'Disponible');
    assert.equal(textoReserva({ estado: 'vencida', por: 'Ana' }).texto, 'Disponible');
  });
});

describe('Mesa de Actas · decisión: las mismas reglas que el servidor', () => {
  it('aprobar contra la recomendación exige 40; aprobar lo consistente, no exige justificación reforzada', () => {
    for (const r of ['discrepancia_critica', 'documento_incorrecto', 'firma_faltante', 'no_determinable']) {
      assert.equal(apartaDeRecomendacionActa('aprobar', r), true, r);
      assert.equal(minimoJustificacion('aprobar', r), 40, r);
    }
    assert.equal(apartaDeRecomendacionActa('aprobar', 'consistente'), false);
    assert.equal(apartaDeRecomendacionActa('aprobar', 'revisar'), false);
    assert.equal(minimoJustificacion('aprobar', 'consistente'), 10);
  });
  it('rechazar un Acta que el sistema ve consistente exige 40; devolver nunca aparta', () => {
    assert.equal(minimoJustificacion('rechazar', 'consistente'), 40);
    assert.equal(minimoJustificacion('rechazar', 'discrepancia_critica'), 10);
    for (const r of ['consistente', 'documento_incorrecto']) assert.equal(apartaDeRecomendacionActa('devolver', r), false);
  });
  // Catálogo tal como lo entrega la API (aquí, inventado a propósito: la pantalla debe usar ESTE y no una copia propia).
  const CATALOGO = [
    { codigo: 'm_uno', titulo: 'Motivo uno', mensajeEstudiante: { que: 'Qué pasó uno.', hacer: 'Qué hacer uno.' }, requiereDetalle: false },
    { codigo: 'm_otro', titulo: 'Otro motivo', mensajeEstudiante: { que: 'Qué pasó otro.', hacer: 'Qué hacer otro.' }, requiereDetalle: true },
  ];
  it('no hay una lista local de motivos: el módulo de la pantalla no la exporta', () => {
    assert.equal('MOTIVOS_DEVOLUCION_ACTA' in modulo, false);
    assert.equal('MENSAJES_DEVOLUCION_ACTA' in modulo, false);
  });
  it('la previsualización sale del catálogo recibido, no de textos propios', () => {
    assert.deepEqual(previsualizarDevolucion(CATALOGO, 'm_uno', ''), { que: 'Qué pasó uno.', hacer: 'Qué hacer uno.' });
    assert.equal(previsualizarDevolucion(CATALOGO, 'm_uno', 'Es la página 2.')?.que, 'Qué pasó uno. Es la página 2.');
    assert.equal(previsualizarDevolucion(CATALOGO, 'm_otro', 'Falta el sello.')?.que, 'Falta el sello.');
    assert.equal(previsualizarDevolucion(CATALOGO, 'm_otro', '')?.que, 'Qué pasó otro.');
    assert.equal(previsualizarDevolucion(CATALOGO, 'falta_firma_empresa', ''), null, 'un código que el catálogo no trae no se inventa');
    assert.equal(previsualizarDevolucion([], 'm_uno', ''), null);
  });
  it('devolver exige un motivo del catálogo y, si el motivo lo pide, el detalle (mínimo 10)', () => {
    assert.equal(devolucionValida(CATALOGO, '', 'x'.repeat(50)), false);
    assert.equal(devolucionValida(CATALOGO, 'inexistente', 'x'.repeat(50)), false);
    assert.equal(devolucionValida(CATALOGO, 'm_uno', ''), true);
    assert.equal(devolucionValida(CATALOGO, 'm_otro', 'corto'), false);
    assert.equal(devolucionValida(CATALOGO, 'm_otro', 'x'.repeat(10)), true);
    assert.equal(devolucionValida([], 'm_uno', ''), false);
  });
});

describe('Mesa de Actas · corrección controlada', () => {
  it('el texto del detalle se convierte en el valor que espera la API', () => {
    assert.equal(valorDeTexto(OPCIONES_REMUNERACION, 'Remunerada'), 'remunerada');
    assert.equal(valorDeTexto(OPCIONES_REMUNERACION, 'No remunerada'), 'no_remunerada');
    assert.equal(valorDeTexto(OPCIONES_ARL, 'CUN'), 'cun');
    assert.equal(valorDeTexto(OPCIONES_ARL, 'Empresa'), 'empresa');
    assert.equal(valorDeTexto(OPCIONES_ARL, null), '');
    assert.equal(valorDeTexto(OPCIONES_ARL, 'No determinable'), '');
  });
  it('después de guardar se dice qué pasó, en lenguaje humano', () => {
    assert.match(TEXTO_RESULTADO_CORRECCION['recalculada'], /recalculó/);
    assert.match(TEXTO_RESULTADO_CORRECCION['marcada_posterior_a_decision'], /decisión histórica se conservó/);
    for (const t of Object.values(TEXTO_RESULTADO_CORRECCION)) assert.doesNotMatch(t, PROHIBIDO);
  });
});

describe('Estudiante · estados', () => {
  it('cada estado humano tiene un tono; uno desconocido no rompe', () => {
    for (const e of ['sin_cargar', 'en_cola', 'leyendo', 'con_el_equipo', 'por_corregir', 'validada', 'rechazada', 'por_revisar']) assert.ok(tonoEstudiante(e));
    assert.equal(tonoEstudiante('validada'), 'ok');
    assert.equal(tonoEstudiante('rechazada'), 'peligro');
    assert.equal(tonoEstudiante('raro'), 'neutra');
  });
});
