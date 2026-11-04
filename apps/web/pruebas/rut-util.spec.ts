import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CampoComparadoRut, MotivoDevolucionRut } from '@core/models/modelos';
import {
  AVISO_OCR, FRASE_DOCUMENTO_INCORRECTO, FRASE_PERSONA_DISTINTA, RESULTADO_RUT, TEXTO_AUTENTICIDAD, apartaDeRecomendacionRut, descripcionCampo,
  devolucionValida, estadoVersion, minimoJustificacion, motivosParaPersona, previsualizarDevolucion, problemaPrincipal, resultadoCampo, resultadoRut,
  separarCampos, textoMetodo, textoPersona, textoReserva, textoTipoDetectado, textoTipoEsperado, textosQr, tonoEstudiante,
} from '../src/app/features/rut/rut.util';

const campo = (c: string, resultado: CampoComparadoRut['resultado'], criticidad: CampoComparadoRut['criticidad'] = 'critico'): CampoComparadoRut => ({
  campo: c, etiqueta: c, sipra: 'S', rut: 'R', resultado, resultadoTexto: '', criticidad, advertencia: null,
});

const MOTIVOS: MotivoDevolucionRut[] = [
  { codigo: 'nit_no_coincide', titulo: 'El NIT no coincide', mensajeEstudiante: { que: 'El NIT no coincide.', hacer: 'Corrige.' }, requiereDetalle: false, aplicaA: ['juridica'] },
  { codigo: 'nombre_no_coincide', titulo: 'El nombre no coincide', mensajeEstudiante: { que: 'El nombre no coincide.', hacer: 'Corrige.' }, requiereDetalle: false, aplicaA: ['natural'] },
  { codigo: 'documento_ilegible', titulo: 'Ilegible', mensajeEstudiante: { que: 'No se lee.', hacer: 'Sube otro.' }, requiereDetalle: false, aplicaA: ['natural', 'juridica'] },
  { codigo: 'otro', titulo: 'Otro motivo', mensajeEstudiante: { que: 'Hay algo que corregir.', hacer: 'Mira el detalle.' }, requiereDetalle: true, aplicaA: ['natural', 'juridica'] },
];

describe('rut.util · resultado principal (nunca códigos internos)', () => {
  it('cada recomendación de la API tiene un título humano', () => {
    for (const c of ['consistente', 'discrepancia_critica', 'persona_distinta', 'documento_incorrecto', 'lectura_dudosa', 'informacion_insuficiente', 'no_determinable']) {
      assert.ok(RESULTADO_RUT[c], c);
      assert.doesNotMatch(RESULTADO_RUT[c].titulo + RESULTADO_RUT[c].frase, /_/);
    }
    assert.equal(resultadoRut('algo_nuevo').titulo, 'No determinable');
  });
  it('persona distinta NO dice «documento inválido»; documento incorrecto dice que el archivo no corresponde', () => {
    assert.equal(resultadoRut('persona_distinta').frase, FRASE_PERSONA_DISTINTA);
    assert.match(FRASE_PERSONA_DISTINTA, /RUT válido, pero corresponde a un tipo de persona diferente al esperado/);
    assert.doesNotMatch(FRASE_PERSONA_DISTINTA, /inválid/i);
    assert.equal(resultadoRut('documento_incorrecto').frase, FRASE_DOCUMENTO_INCORRECTO);
    assert.equal(FRASE_DOCUMENTO_INCORRECTO, 'El archivo no corresponde al tipo de documento esperado.');
  });
  it('la bandeja señala una sola línea; lo consistente no señala nada; la inconsistencia pesa más', () => {
    assert.equal(problemaPrincipal({ recomendacion: 'consistente', inconsistenciaOperativa: false }), null);
    assert.match(problemaPrincipal({ recomendacion: 'lectura_dudosa', inconsistenciaOperativa: false })?.texto ?? '', /OCR/);
    assert.match(problemaPrincipal({ recomendacion: 'consistente', inconsistenciaOperativa: true })?.texto ?? '', /administrativa/);
  });
  it('ningún texto de resultado afirma que el RUT es auténtico', () => {
    assert.doesNotMatch(JSON.stringify(RESULTADO_RUT), /aut[eé]ntic/i);
  });
});

describe('rut.util · método de lectura', () => {
  it('texto digital, o el aviso de OCR; con lectura dudosa un aviso de revisión; nunca un porcentaje', () => {
    assert.equal(textoMetodo('texto', false), 'Texto digital');
    assert.equal(textoMetodo('ocr', false), AVISO_OCR);
    assert.equal(textoMetodo('ocr', true), AVISO_OCR);
    // Un PDF digital con lectura dudosa NO se dice «leído por OCR»: no lo fue.
    assert.match(textoMetodo('texto', true) ?? '', /^Texto digital · lectura poco segura/);
    assert.equal(AVISO_OCR, 'Leído por OCR · revisar contra el documento');
    assert.equal(textoMetodo(null, false), null);
    assert.doesNotMatch(AVISO_OCR, /%|\d/);
  });
});

describe('rut.util · comparación SIPRA ↔ RUT', () => {
  it('un crítico que no coincide es «No coincide · CRÍTICO» (icono + texto, no solo color); uno informativo, no', () => {
    assert.deepEqual(resultadoCampo(campo('nit', 'diferente')), { texto: 'No coincide', icono: '✗', tono: 'peligro', critico: true });
    assert.equal(resultadoCampo(campo('ciiu', 'diferente', 'informativo')).critico, false);
  });
  it('lo que no se pudo comparar NUNCA se muestra como «No coincide»', () => {
    assert.equal(resultadoCampo(campo('nit', 'informacion_insuficiente')).texto, 'Información insuficiente');
    assert.equal(resultadoCampo(campo('nit', 'no_aplica')).texto, 'No aplica');
    assert.equal(resultadoCampo(campo('nit', 'coincide')).texto, 'Coincide');
    assert.equal(resultadoCampo(campo('ciiu', 'informativo', 'informativo')).texto, 'Informativo');
  });
  it('críticos e informativos se separan y se ordenan: PN (documento, nombre) y PJ (NIT, DV, razón social)', () => {
    const pn = separarCampos([campo('fecha_generacion', 'informativo', 'informativo'), campo('nombre', 'coincide'), campo('ciiu', 'informativo', 'informativo'), campo('documento', 'coincide'), campo('divipola', 'informativo', 'informativo')]);
    assert.deepEqual(pn.criticos.map((c) => c.campo), ['documento', 'nombre']);
    assert.deepEqual(pn.informativos.map((c) => c.campo), ['ciiu', 'divipola', 'fecha_generacion']);
    const pj = separarCampos([campo('razon_social', 'coincide'), campo('dv', 'coincide'), campo('nit', 'coincide')]);
    assert.deepEqual(pj.criticos.map((c) => c.campo), ['nit', 'dv', 'razon_social']);
    assert.equal(pj.informativos.length, 0);
  });
  it('la descripción para lector de pantalla dice el resultado y si es crítico', () => {
    assert.match(descripcionCampo({ ...campo('nit', 'diferente'), etiqueta: 'NIT' }), /NIT: SIPRA S, RUT R\. No coincide, crítico\./);
    assert.match(descripcionCampo({ ...campo('nit', 'coincide'), etiqueta: 'NIT', sipra: null }), /SIPRA sin dato/);
  });
});

describe('rut.util · QR y autenticidad', () => {
  it('solo «QR detectado / no determinado» y «Destino DIAN detectado»; la autenticidad NO se verifica', () => {
    assert.deepEqual(textosQr({ qr: 'detectado', destinoOficialDian: true }), ['QR detectado', 'Destino DIAN detectado']);
    assert.deepEqual(textosQr({ qr: 'no_determinado', destinoOficialDian: false }), ['QR no determinado']);
    assert.equal(TEXTO_AUTENTICIDAD, 'Autenticidad: no verificada');
    assert.doesNotMatch(textosQr({ qr: 'detectado', destinoOficialDian: true }).join(' ') + TEXTO_AUTENTICIDAD, /RUT aut[eé]ntico/i);
  });
});

describe('rut.util · tipos y reserva', () => {
  it('rotula lo esperado, lo detectado y la persona', () => {
    assert.equal(textoTipoEsperado('rut_natural'), 'RUT persona natural');
    assert.equal(textoTipoDetectado('rut_persona_juridica'), 'RUT persona jurídica');
    assert.equal(textoTipoDetectado('camara_existencia_representacion'), 'Certificado de Cámara de Comercio');
    assert.equal(textoTipoDetectado(null), 'No determinable');
    assert.equal(textoPersona('natural'), 'Persona natural');
    assert.equal(textoPersona(null), 'No determinada');
  });
  it('la reserva se dice en palabras', () => {
    assert.equal(textoReserva({ estado: 'mia', por: 'Usted' }).texto, 'Tomado por usted');
    assert.equal(textoReserva({ estado: 'otro', por: 'Ana' }).texto, 'Tomado por Ana');
    assert.equal(textoReserva({ estado: 'vencida', por: 'Ana' }).texto, 'Disponible');
  });
  it('los estados de la versión son humanos', () => {
    assert.equal(estadoVersion('aprobado_manual').texto, 'Aprobado');
    assert.equal(estadoVersion('devuelto').texto, 'Devuelto');
    assert.equal(estadoVersion('inventado_x').texto, 'inventado x');
  });
});

describe('rut.util · decisión (espejo de la regla del servidor)', () => {
  it('aprobar un RUT consistente: sin justificación larga; con cualquier otra recomendación: 40', () => {
    assert.equal(apartaDeRecomendacionRut('aprobar', 'consistente'), false);
    assert.equal(minimoJustificacion('aprobar', 'consistente'), 10);
    for (const r of ['discrepancia_critica', 'persona_distinta', 'lectura_dudosa', 'informacion_insuficiente', 'documento_incorrecto', 'no_determinable']) {
      assert.equal(apartaDeRecomendacionRut('aprobar', r), true, r);
      assert.equal(minimoJustificacion('aprobar', r), 40, r);
    }
  });
  it('rechazar un RUT consistente exige justificación ampliada (40); rechazar otro, la mínima; devolver nunca se aparta', () => {
    assert.equal(minimoJustificacion('rechazar', 'consistente'), 40);
    assert.equal(minimoJustificacion('rechazar', 'discrepancia_critica'), 10);
    assert.equal(apartaDeRecomendacionRut('devolver', 'consistente'), false);
  });
  it('los motivos son los del catálogo de la API, filtrados por tipo de RUT (no hay lista local)', () => {
    assert.deepEqual(motivosParaPersona(MOTIVOS, 'juridica').map((m) => m.codigo), ['nit_no_coincide', 'documento_ilegible', 'otro']);
    assert.deepEqual(motivosParaPersona(MOTIVOS, 'natural').map((m) => m.codigo), ['nombre_no_coincide', 'documento_ilegible', 'otro']);
    assert.equal(motivosParaPersona(MOTIVOS, null).length, 4);
  });
  it('devolver exige motivo del catálogo y, con «otro», un detalle de 10 caracteres', () => {
    assert.equal(devolucionValida(MOTIVOS, '', ''), false);
    assert.equal(devolucionValida(MOTIVOS, 'inventado', ''), false);
    assert.equal(devolucionValida(MOTIVOS, 'documento_ilegible', ''), true);
    assert.equal(devolucionValida(MOTIVOS, 'otro', 'corto'), false);
    assert.equal(devolucionValida(MOTIVOS, 'otro', 'Falta la segunda hoja'), true);
  });
  it('el estudiante verá «qué pasó» y «qué debo hacer»; con «otro», lo que escribió quien devuelve', () => {
    assert.deepEqual(previsualizarDevolucion(MOTIVOS, 'documento_ilegible', ''), { que: 'No se lee.', hacer: 'Sube otro.' });
    assert.deepEqual(previsualizarDevolucion(MOTIVOS, 'documento_ilegible', 'Está borroso.'), { que: 'No se lee. Está borroso.', hacer: 'Sube otro.' });
    assert.equal(previsualizarDevolucion(MOTIVOS, 'otro', 'Falta la hoja 2')?.que, 'Falta la hoja 2');
    assert.equal(previsualizarDevolucion(MOTIVOS, 'nada', ''), null);
  });
});

describe('rut.util · estudiante', () => {
  it('los seis estados humanos tienen tono', () => {
    for (const e of ['pendiente', 'en_procesamiento', 'en_revision', 'necesita_correccion', 'aprobado', 'rechazado']) assert.ok(tonoEstudiante(e));
    assert.equal(tonoEstudiante('aprobado'), 'ok');
    assert.equal(tonoEstudiante('rechazado'), 'peligro');
    assert.equal(tonoEstudiante('lo_que_sea'), 'neutra');
  });
});
