import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CampoComparadoCamara, DetalleCamara, MotivoDevolucionCamara } from '@core/models/modelos';
import {
  AVISO_OCR, RESULTADO_CAMARA, TEXTO_AUTENTICIDAD, apartaDeRecomendacionCamara, descripcionCampo, devolucionValida, estadoVersion,
  minimoJustificacion, motivosParaPersona, personaDeCertificado, previsualizarDevolucion, problemaPrincipal, resultadoCamara, resultadoCampo,
  textoExpedicion, textoMetodo, textoPersona, textoRenovacion, textoReserva, textoTipoDetectado, textoTipoEsperado, textoVentana,
  textosVerificacion, tonoEstudiante,
} from '../src/app/features/camara/camara.util';

const campo = (c: string, resultado: CampoComparadoCamara['resultado'], criticidad: CampoComparadoCamara['criticidad'] = 'critico'): CampoComparadoCamara => ({
  campo: c, etiqueta: c, sipra: 'S', camara: 'C', resultado, resultadoTexto: '', criticidad, causa: null, advertencia: null,
});

const MOTIVOS: MotivoDevolucionCamara[] = [
  { codigo: 'razon_social_no_coincide', titulo: 'La razón social no coincide', mensajeEstudiante: { que: 'La razón social no coincide.', hacer: 'Corrige.' }, requiereDetalle: false, aplicaA: ['juridica'] },
  { codigo: 'nombre_no_coincide', titulo: 'El nombre no coincide', mensajeEstudiante: { que: 'El nombre no coincide.', hacer: 'Corrige.' }, requiereDetalle: false, aplicaA: ['natural'] },
  { codigo: 'documento_ilegible', titulo: 'Ilegible', mensajeEstudiante: { que: 'No se lee.', hacer: 'Sube otro.' }, requiereDetalle: false, aplicaA: ['natural', 'juridica'] },
  { codigo: 'otro', titulo: 'Otro motivo', mensajeEstudiante: { que: 'Hay algo que corregir.', hacer: 'Mira el detalle.' }, requiereDetalle: true, aplicaA: ['natural', 'juridica'] },
];

describe('camara.util · resultado principal (nunca códigos internos)', () => {
  it('cada recomendación de la API tiene un título humano sin guiones bajos', () => {
    for (const c of ['consistente', 'discrepancia_critica', 'representante_diferente', 'matricula_cancelada', 'persona_distinta', 'tipo_certificado_diferente',
      'documento_incorrecto', 'lectura_dudosa', 'informacion_insuficiente', 'no_determinable']) {
      assert.ok(RESULTADO_CAMARA[c], c);
      assert.doesNotMatch(RESULTADO_CAMARA[c].titulo + RESULTADO_CAMARA[c].frase, /_/);
    }
    assert.equal(resultadoCamara('algo_nuevo').titulo, 'No determinable');
  });
  it('los siete estados que ve quien revisa existen con su texto', () => {
    const titulos = new Set(Object.values(RESULTADO_CAMARA).map((r) => r.titulo));
    for (const t of ['Consistente', 'Revisión necesaria', 'Documento no corresponde', 'Tipo de certificado diferente', 'Persona distinta', 'Información insuficiente', 'No determinable']) {
      assert.ok(titulos.has(t), t);
    }
  });
  it('persona distinta NO dice «documento inválido»', () => {
    assert.doesNotMatch(resultadoCamara('persona_distinta').frase, /inválid/i);
    assert.match(resultadoCamara('persona_distinta').frase, /certificado válido/);
  });
  it('matrícula cancelada: alerta importante, pero solo revisión (sin «rechazo» automático)', () => {
    assert.equal(resultadoCamara('matricula_cancelada').frase, 'El certificado declara que la matrícula está cancelada.');
    assert.equal(resultadoCamara('matricula_cancelada').tono, 'peligro');
    assert.doesNotMatch(JSON.stringify(RESULTADO_CAMARA), /rechaz/i);
  });
  it('la bandeja señala una sola línea; lo consistente no señala nada; la inconsistencia pesa más', () => {
    assert.equal(problemaPrincipal({ recomendacion: 'consistente', inconsistenciaOperativa: false, problemaPrincipal: null }), null);
    assert.equal(problemaPrincipal({ recomendacion: 'representante_diferente', inconsistenciaOperativa: false, problemaPrincipal: 'El representante legal no coincide con el registrado en SIPRA' })?.texto,
      'El representante legal no coincide con el registrado en SIPRA');
    assert.match(problemaPrincipal({ recomendacion: 'consistente', inconsistenciaOperativa: true, problemaPrincipal: null })?.texto ?? '', /administrativa/);
  });
  it('ningún texto afirma que el certificado es auténtico ni vigente', () => {
    assert.doesNotMatch(JSON.stringify(RESULTADO_CAMARA), /aut[eé]ntic|vigente/i);
  });
});

describe('camara.util · método de lectura', () => {
  it('el aviso del servidor manda; con OCR el aviso exacto; texto digital sin dudas; nunca un porcentaje', () => {
    assert.equal(textoMetodo({ metodo: 'ocr', dudosa: true, aviso: AVISO_OCR }), 'Leído por OCR · revisar contra el documento');
    assert.equal(textoMetodo({ metodo: 'ocr', dudosa: false, aviso: null }), AVISO_OCR);
    assert.equal(textoMetodo({ metodo: 'texto', dudosa: false, aviso: null }), 'Texto digital');
    // Un PDF digital con lectura dudosa NO se dice «leído por OCR»: no lo fue.
    assert.doesNotMatch(textoMetodo({ metodo: 'texto', dudosa: true, aviso: null }) ?? '', /OCR/);
    assert.equal(textoMetodo({ metodo: null, dudosa: false, aviso: null }), null);
    assert.doesNotMatch(AVISO_OCR, /%|\d/);
  });
});

describe('camara.util · comparación SIPRA ↔ Cámara', () => {
  it('un crítico que no coincide es «No coincide · CRÍTICO» (icono + texto); el representante (importante) no es crítico', () => {
    assert.deepEqual(resultadoCampo(campo('nit', 'diferente')), { texto: 'No coincide', icono: '✗', tono: 'peligro', critico: true });
    const rep = resultadoCampo(campo('representante_legal', 'diferente', 'importante'));
    assert.equal(rep.critico, false);
    assert.equal(rep.texto, 'No coincide');
    assert.equal(rep.tono, 'aviso');
  });
  it('lo que no se pudo comparar NUNCA se muestra como «No coincide» (la lectura dudosa llega como información insuficiente)', () => {
    assert.equal(resultadoCampo(campo('nit', 'informacion_insuficiente')).texto, 'Información insuficiente');
    assert.equal(resultadoCampo(campo('nit', 'no_aplica')).texto, 'No aplica');
    assert.equal(resultadoCampo(campo('nit', 'coincide')).texto, 'Coincide');
    assert.equal(resultadoCampo(campo('ciiu', 'informativo', 'informativo')).texto, 'Informativo');
  });
  it('la descripción para lector de pantalla dice el resultado y si es crítico o importante', () => {
    assert.match(descripcionCampo({ ...campo('nit', 'diferente'), etiqueta: 'NIT' }), /NIT: SIPRA S, Cámara C\. No coincide, crítico\./);
    assert.match(descripcionCampo({ ...campo('representante_legal', 'diferente', 'importante'), etiqueta: 'Representante legal' }), /No coincide, importante\./);
    assert.match(descripcionCampo({ ...campo('nit', 'coincide'), etiqueta: 'NIT', sipra: null }), /SIPRA sin dato/);
  });
});

describe('camara.util · renovación, expedición y verificación', () => {
  it('la renovación es solo información: nunca «vigente»', () => {
    const t = textoRenovacion({ ultimoAnioRenovado: 2026, fechaRenovacion: '2026-03-31' });
    assert.equal(t, 'Último año renovado: 2026 · Fecha de renovación: 2026-03-31');
    assert.doesNotMatch(t, /vigent/i);
    assert.match(textoRenovacion({ ultimoAnioRenovado: null, fechaRenovacion: null }), /sin dato.*sin dato/);
  });
  it('la expedición es un dato: sin política NUNCA «vencido», «no vigente» ni «expirado», aunque sea de hace años', () => {
    const vieja = textoExpedicion({ fecha: '2015-01-01', diasDesdeExpedicion: 4000, politicaDias: null, cumplePolitica: null });
    assert.equal(vieja.aviso, null);
    assert.doesNotMatch(vieja.texto, /vencid|no vigente|expirad/i);
    assert.match(vieja.texto, /Fecha de expedición: 2015-01-01 \(hace 4000 días\)/);
    assert.equal(textoExpedicion({ fecha: null, diasDesdeExpedicion: null, politicaDias: null, cumplePolitica: null }).texto, 'Fecha de expedición: sin dato');
  });
  it('si el backend informa una política y no se cumple, se avisa con la política que el backend dice (no hay valor local)', () => {
    const e = textoExpedicion({ fecha: '2026-01-01', diasDesdeExpedicion: 100, politicaDias: 30, cumplePolitica: false });
    assert.equal(e.aviso, 'Supera los 30 días que define la política institucional.');
    assert.equal(textoExpedicion({ fecha: '2026-01-01', diasDesdeExpedicion: 10, politicaDias: 30, cumplePolitica: true }).aviso, null);
  });
  it('la ventana es «Código de verificación disponible hasta…», jamás «Certificado vigente hasta»', () => {
    assert.equal(textoVentana('2026-11-09'), 'Código de verificación disponible hasta 2026-11-09');
    assert.doesNotMatch(textoVentana('2026-11-09') ?? '', /vigente/i);
    assert.equal(textoVentana(null), null);
  });
  it('código, URL y firma: solo presencia; la autenticidad NO se verifica', () => {
    const v: DetalleCamara['verificacion'] = {
      codigoDetectado: true, urlDetectada: true, firmaPdfPresente: true, disponibleHasta: null,
      autenticidad: { estado: 'no_verificable', etiqueta: 'No verificada', aviso: '' },
    };
    assert.deepEqual(textosVerificacion(v), ['Código de verificación detectado', 'URL oficial detectada', 'Firma PDF presente']);
    assert.deepEqual(textosVerificacion({ ...v, codigoDetectado: false, urlDetectada: false, firmaPdfPresente: null }),
      ['Código de verificación no detectado', 'URL oficial no detectada', 'Firma PDF no determinada']);
    assert.equal(TEXTO_AUTENTICIDAD, 'Autenticidad: no verificada');
    assert.doesNotMatch(textosVerificacion(v).join(' ') + TEXTO_AUTENTICIDAD, /aut[eé]ntico/i);
  });
});

describe('camara.util · tipos y reserva', () => {
  it('rotula lo esperado, lo detectado y la persona', () => {
    assert.equal(textoTipoEsperado('camara_comercio'), 'Certificado de Cámara de Comercio');
    assert.equal(textoTipoDetectado('camara_existencia_representacion'), 'Existencia y representación legal');
    assert.equal(textoTipoDetectado('camara_matricula_persona_natural'), 'Matrícula mercantil · persona natural');
    assert.equal(textoTipoDetectado('rut_persona_juridica'), 'RUT');
    assert.equal(textoTipoDetectado(null), 'No determinable');
    assert.equal(textoPersona('persona_natural'), 'Persona natural');
    assert.equal(textoPersona('juridica'), 'Persona jurídica');
    assert.equal(textoPersona(null), 'No determinada');
    assert.equal(personaDeCertificado('persona_juridica'), 'juridica');
    assert.equal(personaDeCertificado(null), null);
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

describe('camara.util · decisión (espejo de la regla del servidor)', () => {
  it('aprobar un certificado consistente: sin justificación larga; con cualquier otra recomendación: 40', () => {
    assert.equal(apartaDeRecomendacionCamara('aprobar', 'consistente'), false);
    assert.equal(minimoJustificacion('aprobar', 'consistente'), 10);
    for (const r of ['discrepancia_critica', 'representante_diferente', 'matricula_cancelada', 'persona_distinta', 'tipo_certificado_diferente', 'lectura_dudosa',
      'informacion_insuficiente', 'documento_incorrecto', 'no_determinable']) {
      assert.equal(apartaDeRecomendacionCamara('aprobar', r), true, r);
      assert.equal(minimoJustificacion('aprobar', r), 40, r);
    }
  });
  it('rechazar un certificado consistente exige justificación ampliada (40); rechazar otro, la mínima; devolver nunca se aparta', () => {
    assert.equal(minimoJustificacion('rechazar', 'consistente'), 40);
    assert.equal(minimoJustificacion('rechazar', 'discrepancia_critica'), 10);
    assert.equal(apartaDeRecomendacionCamara('devolver', 'consistente'), false);
  });
  it('los motivos son los del catálogo de la API, filtrados por tipo de certificado (no hay lista local)', () => {
    assert.deepEqual(motivosParaPersona(MOTIVOS, 'juridica').map((m) => m.codigo), ['razon_social_no_coincide', 'documento_ilegible', 'otro']);
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

describe('camara.util · estudiante', () => {
  it('los seis estados humanos tienen tono', () => {
    for (const e of ['pendiente', 'en_procesamiento', 'en_revision', 'necesita_correccion', 'aprobado', 'rechazado']) assert.ok(tonoEstudiante(e));
    assert.equal(tonoEstudiante('aprobado'), 'ok');
    assert.equal(tonoEstudiante('rechazado'), 'peligro');
    assert.equal(tonoEstudiante('lo_que_sea'), 'neutra');
  });
});
