import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ClasificacionDocumentoEmpresarial as C, EstadoRegistral, EstadoValidacionDocumentoEmpresarial as Estado } from '../src/domain/entities/documento-empresarial';
import { EstadoDocumento } from '../src/domain/entities/documento.entity';
import { TipoEvidenciaDocumentoEmpresarial } from '../src/domain/entities/validacion-documento-empresarial.entity';
import { MENSAJES_DEVOLUCION_CAMARA, MotivoDevolucionCamara } from '../src/domain/services/mesa-camara.domain-service';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { actorDe, practicaDe, usuarioDe } from './soporte-autorizacion';
import { CEDULA_NATURAL, DV_NATURAL, NIT_JURIDICA } from './soporte-documento-empresarial';
import {
  AHORA_CAMARA as AHORA, HASH_CAMARA, MIN, TEXTO_40_CAMARA, adminCamara, coordCamara, lecturaCamara, lecturaDudosaOcr, lecturaExistencia, lecturaPn,
  montarMesaCamara, tutorCamara as tutor,
} from './soporte-mesa-camara';

type Mesa = ReturnType<typeof montarMesaCamara>;
type Opciones = Parameters<Mesa['crear']>[0];

/** Un caso procesado (en revisión) y, si se pide, ya tomado por `quien`. */
async function caso(m: Mesa, id: string, opciones: Partial<Opciones> = {}, quien?: ReturnType<typeof tutor>) {
  const c = await m.crear({ id, ...opciones });
  if (quien) await m.mesa.tomar(c.validacionId as string, quien, AHORA);
  return c as { documentoId: string; validacionId: string; practicaId: string; estudianteId: string };
}
const fila = (m: Mesa, validacionId: string) => m.validaciones.filas.get(validacionId)!;
const docDe = (m: Mesa, documentoId: string) => m.documentos.filas.get(documentoId)!;
const comparacionDe = (m: Mesa, validacionId: string) => fila(m, validacionId).comparacion as unknown as { veredicto: string; hayDiscrepancia: boolean; discrepanciaImportante: boolean };
const DISCREPANTE: Partial<Opciones> = { sipra: { razonSocial: 'OTRA COMERCIALIZADORA S.A.S.' } };
const REP_DIFERENTE: Partial<Opciones> = { sipra: { representanteLegal: 'LUIS MIGUEL TORRES DIAZ' } };
const CANCELADA = lecturaExistencia({ estadoRegistral: EstadoRegistral.CANCELADO });

/** Todos los TEXTOS (valores, no claves) de una respuesta. */
function textos(valor: unknown, salida: string[] = []): string[] {
  if (typeof valor === 'string') salida.push(valor);
  else if (Array.isArray(valor)) valor.forEach((v) => textos(v, salida));
  else if (valor && typeof valor === 'object') Object.values(valor).forEach((v) => textos(v, salida));
  return salida;
}

describe('Mesa de Cámara · decisión humana', () => {
  it('aprobar un certificado consistente NO exige justificación larga: documento y validación quedan decididos por la persona', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    const respuesta = await m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA);
    expect(respuesta.estado).toBe(EstadoDocumento.APROBADO);
    expect(docDe(m, c.documentoId)).toMatchObject({ estado: EstadoDocumento.APROBADO, decididoPor: t.id });
    expect(fila(m, c.validacionId)).toMatchObject({ estado: Estado.APROBADO_MANUAL, decididoPor: t.id, decididoEn: AHORA, asignadoA: null, reservaHasta: null });
    expect(m.auditoria.acciones('decision_camara')).toHaveLength(1);
    expect(m.auditoria.acciones('decision_documento')).toHaveLength(1);
    expect(m.auditoria.acciones('decision_rut')).toHaveLength(0);
  });

  it('el sistema NUNCA decide solo: aun consistente, el caso queda en revisión hasta que una persona decide', async () => {
    const m = montarMesaCamara();
    const c = await caso(m, 'c1');
    expect(comparacionDe(m, c.validacionId).veredicto).toBe('consistente');
    expect(fila(m, c.validacionId).estado).toBe(Estado.REVISION);
    expect(docDe(m, c.documentoId).estado).toBe(EstadoDocumento.EN_REVISION);
  });

  it('aprobar CONTRA una discrepancia crítica exige 40 caracteres; con ellos procede y queda constancia del apartamiento', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', DISCREPANTE, t);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar', justificacion: 'corta' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    expect(fila(m, c.validacionId).estado).toBe(Estado.REVISION);
    await m.mesa.decidir(c.validacionId, t, { decision: 'aprobar', justificacion: TEXTO_40_CAMARA }, AHORA);
    expect(fila(m, c.validacionId).estado).toBe(Estado.APROBADO_MANUAL);
    expect(m.auditoria.acciones('decision_camara')[0].metadatos).toMatchObject({ recomendacion: 'discrepancia_critica', apartaDeRecomendacion: true });
    const evidencia = m.validaciones.evidencias.find((e) => e.tipo === TipoEvidenciaDocumentoEmpresarial.DECISION_HUMANA)!;
    expect(evidencia).toMatchObject({ actorId: t.id, resultado: 'aprobar', fecha: AHORA });
    expect(evidencia.datos).toMatchObject({ accion: 'aprobar', rol: Rol.TUTOR, justificacion: TEXTO_40_CAMARA });
  });

  it('REPRESENTANTE distinto: es revisión necesaria (no crítica); aprobar exige 40 y la recomendación lo dice sin llamarlo discrepancia crítica', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', REP_DIFERENTE, t);
    expect(comparacionDe(m, c.validacionId)).toMatchObject({ veredicto: 'revision_necesaria', hayDiscrepancia: false, discrepanciaImportante: true });
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.recomendacion).toBe('representante_diferente');
    expect(d.resumen).toMatchObject({ etiqueta: 'Revisión necesaria', nivel: 'atencion' });
    expect(d.criticos.map((x) => x.campo)).toEqual(['nit', 'dv', 'razon_social']);
    expect(d.criticos.every((x) => x.resultado === 'coincide')).toBe(true);
    expect(d.representante).toMatchObject({ resultado: 'diferente', resultadoTexto: 'No coincide', criticidad: 'importante' });
    expect(d.representante!.aviso).toMatch(/revíselo antes de decidir/);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar', justificacion: 'ok' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar', justificacion: TEXTO_40_CAMARA }, AHORA)).resolves.toBeDefined();
  });

  it('REPRESENTANTE ausente en SIPRA o en el certificado: NO frena; queda «Información insuficiente» como dato pendiente de contraste humano', async () => {
    for (const sobre of [{ sipra: { representanteLegal: null } }, { lectura: lecturaExistencia({ representanteLegal: null }) }] as Partial<Opciones>[]) {
      const m = montarMesaCamara();
      const t = tutor();
      const c = await caso(m, 'c1', sobre, t);
      expect(comparacionDe(m, c.validacionId).veredicto).toBe('consistente');
      const d = await m.mesa.detalle(c.validacionId, t, AHORA);
      expect(d.recomendacion).toBe('consistente');
      expect(d.representante).toMatchObject({ resultado: 'informacion_insuficiente', resultadoTexto: 'Información insuficiente', aviso: 'Dato importante pendiente de contraste humano.' });
      await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA)).resolves.toBeDefined();
    }
  });

  it('la recomendación NUNCA bloquea una decisión humana válida: devolver/rechazar un consistente o aprobar uno dudoso se permite', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const a = await caso(m, 'a', {}, t);
    await expect(m.mesa.decidir(a.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionCamara.INFORMACION_INCOMPLETA }, AHORA)).resolves.toBeDefined();
    const b = await caso(m, 'b', { lectura: lecturaDudosaOcr() }, t);
    await expect(m.mesa.decidir(b.validacionId, t, { decision: 'aprobar', justificacion: TEXTO_40_CAMARA }, AHORA)).resolves.toBeDefined();
  });

  it('lectura dudosa por OCR: aprobar exige 40; los críticos son «Información insuficiente» (NUNCA «No coincide»), con aviso OCR y sin confianza global', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', { ...DISCREPANTE, lectura: lecturaDudosaOcr() }, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.lectura).toMatchObject({ metodo: 'ocr', dudosa: true, aviso: 'Leído por OCR · revisar contra el documento' });
    expect(d.recomendacion).toBe('lectura_dudosa');
    expect(d.criticos.length).toBeGreaterThan(0);
    for (const campo of d.criticos) {
      expect(campo).toMatchObject({ resultado: 'informacion_insuficiente', resultadoTexto: 'Información insuficiente', advertencia: 'Leído por OCR · revisar contra el documento' });
      expect(campo.resultadoTexto).not.toMatch(/no coincide/i);
    }
    expect(JSON.stringify(d)).not.toMatch(/confianza/i);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar', justificacion: 'corta' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar', justificacion: TEXTO_40_CAMARA }, AHORA)).resolves.toBeDefined();
  });

  it('lectura dudosa de un PDF digital (p. ej. DV que no cuadra): se avisa «lectura poco segura», no «OCR»', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', { lectura: lecturaExistencia({}, { lecturaDudosa: true }) }, t);
    expect((await m.mesa.detalle(c.validacionId, t, AHORA)).lectura).toMatchObject({ metodo: 'texto', aviso: 'Lectura poco segura · revisar contra el documento' });
  });

  it('PERSONA distinta: se esperaba una persona jurídica y el certificado es de persona natural; no se compara como PJ y aprobarlo exige 40', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', { lectura: lecturaPn() }, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d).toMatchObject({ recomendacion: 'persona_distinta', resumen: { etiqueta: 'Persona distinta' }, tipoCertificado: 'persona_natural' });
    expect(d.criticos.every((x) => x.resultado === 'no_aplica')).toBe(true);
    expect(fila(m, c.validacionId).expectativa).toBe('persona_distinta');
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    // Es un certificado real de otra persona, no un documento inválido: devolver por «persona no coincide» procede.
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionCamara.PERSONA_NO_COINCIDE }, AHORA)).resolves.toBeDefined();
  });

  it('documento incorrecto: no hay comparación ni campos; aprobar exige 40; devolver «no es un certificado de Cámara» procede', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', { lectura: lecturaCamara(C.DOCUMENTO_INCORRECTO, null) }, t);
    expect(fila(m, c.validacionId).comparacion).toBeNull();
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d).toMatchObject({ recomendacion: 'documento_incorrecto', resumen: { etiqueta: 'Documento no corresponde' }, criticos: [], representante: null });
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionCamara.DOCUMENTO_INCORRECTO }, AHORA)).resolves.toBeDefined();
  });

  it('un RUT cargado como Cámara es «Tipo de certificado diferente»; un no determinable, «No determinable»', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const rut = await caso(m, 'rut', { lectura: lecturaCamara(C.RUT_PERSONA_JURIDICA, null) }, t);
    expect(await m.mesa.detalle(rut.validacionId, t, AHORA)).toMatchObject({ recomendacion: 'tipo_certificado_diferente', resumen: { etiqueta: 'Tipo de certificado diferente' } });
    const nd = await caso(m, 'nd', { lectura: lecturaCamara(C.NO_DETERMINABLE, null) }, t);
    expect(await m.mesa.detalle(nd.validacionId, t, AHORA)).toMatchObject({ recomendacion: 'no_determinable', resumen: { etiqueta: 'No determinable' } });
  });

  it('información insuficiente (SIPRA sin DV): «Información insuficiente»; aprobar exige 40', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', { lectura: lecturaExistencia({ dv: null }) }, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d).toMatchObject({ recomendacion: 'informacion_insuficiente', resumen: { etiqueta: 'Información insuficiente' } });
    expect(d.criticos.find((x) => x.campo === 'dv')).toMatchObject({ resultado: 'informacion_insuficiente', causa: 'El certificado no trae dígito de verificación' });
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('matrícula CANCELADA declarada: alerta importante que lleva a revisión humana, sin rechazo automático', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', { lectura: CANCELADA }, t);
    expect(fila(m, c.validacionId).estado).toBe(Estado.REVISION);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.estadoRegistral).toEqual({ estado: 'cancelado', etiqueta: 'Cancelado', alerta: 'El certificado declara que la matrícula está cancelada.' });
    expect(d).toMatchObject({ recomendacion: 'matricula_cancelada', resumen: { etiqueta: 'Revisión necesaria', nivel: 'alerta' } });
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionCamara.MATRICULA_CANCELADA }, AHORA)).resolves.toBeDefined();
  });

  it('estado registral: «No determinable» por defecto y «Activo» solo informan; ninguno aprueba ni genera alerta', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const nd = await caso(m, 'nd', {}, t);
    expect((await m.mesa.detalle(nd.validacionId, t, AHORA)).estadoRegistral).toEqual({ estado: 'no_determinable', etiqueta: 'No determinable', alerta: null });
    const activo = await caso(m, 'ac', { lectura: lecturaExistencia({ estadoRegistral: EstadoRegistral.ACTIVO }) }, t);
    const d = await m.mesa.detalle(activo.validacionId, t, AHORA);
    expect(d.estadoRegistral).toEqual({ estado: 'activo', etiqueta: 'Activo', alerta: null });
    expect(d.recomendacion).toBe('consistente');
  });

  it('renovación, antigüedad y ventana: solo información; jamás «vigente», «vencido», «no vigente» ni «auténtico»', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', { lectura: lecturaExistencia({ fechaExpedicion: '2015-01-01', ultimoAnioRenovado: 2019, fechaRenovacion: '2019-03-31', verificacionDisponibleHasta: '2026-11-09' }) }, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.renovacion).toEqual({ ultimoAnioRenovado: 2019, fechaRenovacion: '2019-03-31' });
    expect(d.expedicion).toMatchObject({ fecha: '2015-01-01', politicaDias: null, cumplePolitica: null });
    expect(d.verificacion).toMatchObject({ disponibleHasta: '2026-11-09', codigoDetectado: true, urlDetectada: true, firmaPdfPresente: true });
    expect(d.verificacion.autenticidad).toMatchObject({ etiqueta: 'No verificada', estado: 'no_verificable' });
    expect(d.recomendacion).toBe('consistente');
    const todos = textos(d).join(' | ');
    expect(todos).not.toMatch(/vencid|no vigente|expirad|certificado vigente|aut[eé]ntico/i);
    expect(d.renovacion).not.toHaveProperty('vigente');
  });

  it('el certificado se describe en palabras y los informativos quedan aparte de los críticos', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.certificado).toBe('Certificado de existencia y representación legal');
    expect(d.informativos.map((x) => x.campo)).toEqual(['matricula', 'camara', 'fecha_matricula', 'domicilio', 'ciiu']);
    expect(d.criticos.map((x) => x.etiqueta)).toEqual(['NIT', 'Dígito de verificación', 'Razón social']);
  });

  it('PN: identificación/NIT, DV y nombre son críticos; no hay sección de representante', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', { lectura: lecturaPn(), sipra: { nitNumero: CEDULA_NATURAL, nitDv: Number(DV_NATURAL), razonSocial: 'MARIA FERNANDA LOPEZ RIVERA', representanteLegal: null } }, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.criticos.map((x) => x.etiqueta)).toEqual(['Identificación / NIT', 'Dígito de verificación', 'Nombre del comerciante']);
    expect(d.representante).toBeNull();
    expect(d.tipoCertificado).toBe('persona_natural');
  });

  it('matrícula de sociedad: el representante es informativo y no frena aunque no figure', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', { lectura: lecturaCamara(C.CAMARA_MATRICULA_SOCIEDAD, { ...lecturaExistencia().datos!, tipoCertificado: 'matricula_mercantil', representanteLegal: null }) }, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.representante).toMatchObject({ resultado: 'no_aplica', criticidad: 'informativo' });
    expect(d.recomendacion).toBe('consistente');
  });

  it('el camino general de decisión de documentos YA NO decide la Cámara: solo la Mesa', async () => {
    const m = montarMesaCamara();
    const c = await caso(m, 'c1');
    await expect(m.gestionar.decidir(c.documentoId, { decision: 'aprobar', justificacion: TEXTO_40_CAMARA }, tutor())).rejects.toBeInstanceOf(ForbiddenException);
    expect(docDe(m, c.documentoId).estado).toBe(EstadoDocumento.EN_REVISION);
  });
});

describe('Mesa de Cámara · devolver y rechazar', () => {
  it('devolver exige un motivo del catálogo; el motivo no aplicable al tipo de certificado se rechaza', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'devolver' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: 'inventado' as never }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    // «El nombre del comerciante no coincide» no aplica a un certificado de persona jurídica.
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionCamara.NOMBRE_NO_COINCIDE }, AHORA)).rejects.toThrow(/no aplica/);
    expect(fila(m, c.validacionId).estado).toBe(Estado.REVISION);
  });

  it('devolver con motivo: queda el mensaje del catálogo, el motivo en la validación, aviso al estudiante y bitácora', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    await m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionCamara.REPRESENTANTE_NO_COINCIDE }, AHORA);
    expect(fila(m, c.validacionId)).toMatchObject({ estado: Estado.DEVUELTO, motivoDecision: 'representante_no_coincide', decididoPor: t.id });
    expect(docDe(m, c.documentoId)).toMatchObject({ estado: EstadoDocumento.DEVUELTO, motivoDevolucion: MENSAJES_DEVOLUCION_CAMARA[MotivoDevolucionCamara.REPRESENTANTE_NO_COINCIDE].que });
    expect(m.notificar).toHaveBeenCalled();
    expect(m.anotarDevolucion).toHaveBeenCalledTimes(1);
  });

  it('con el motivo «otro» el detalle es obligatorio y es lo que lee el estudiante', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionCamara.OTRO }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionCamara.OTRO, justificacion: 'Falta la última página con las firmas del certificado.' }, AHORA);
    expect(docDe(m, c.documentoId).motivoDevolucion).toBe('Falta la última página con las firmas del certificado.');
    const estado = await m.estudiante.estado(c.practicaId, actorDe(Rol.ESTUDIANTE, { id: c.estudianteId }));
    expect(estado).toMatchObject({ estado: 'necesita_correccion', que: 'Falta la última página con las firmas del certificado.' });
  });

  it('rechazar exige confirmación explícita y justificación; rechazar un consistente exige 40; rechazar una discrepancia, la mínima', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const consistente = await caso(m, 'a', {}, t);
    await expect(m.mesa.decidir(consistente.validacionId, t, { decision: 'rechazar', justificacion: TEXTO_40_CAMARA }, AHORA)).rejects.toThrow(/confirme el rechazo/);
    await expect(m.mesa.decidir(consistente.validacionId, t, { decision: 'rechazar', justificacion: 'no sirve', confirmar: true }, AHORA)).rejects.toThrow(/al menos 40/);
    await expect(m.mesa.decidir(consistente.validacionId, t, { decision: 'rechazar', justificacion: TEXTO_40_CAMARA, confirmar: true }, AHORA)).resolves.toBeDefined();
    expect(fila(m, consistente.validacionId)).toMatchObject({ estado: Estado.RECHAZADO, decididoPor: t.id });
    expect(docDe(m, consistente.documentoId).estado).toBe(EstadoDocumento.RECHAZADO);
    const discrepante = await caso(m, 'b', DISCREPANTE, t);
    await expect(m.mesa.decidir(discrepante.validacionId, t, { decision: 'rechazar', confirmar: true }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.mesa.decidir(discrepante.validacionId, t, { decision: 'rechazar', justificacion: 'La razón social es de otra empresa.', confirmar: true }, AHORA)).resolves.toBeDefined();
  });

  it('un caso ya decidido NO se decide otra vez: 409 y no se escribe nada más', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    await m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA);
    const antes = JSON.stringify([...m.documentos.filas.values()]) + JSON.stringify([...m.validaciones.filas.values()]) + m.validaciones.evidencias.length + m.auditoria.registros.length;
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'rechazar', justificacion: TEXTO_40_CAMARA, confirmar: true }, AHORA)).rejects.toBeInstanceOf(ConflictException);
    const despues = JSON.stringify([...m.documentos.filas.values()]) + JSON.stringify([...m.validaciones.filas.values()]) + m.validaciones.evidencias.length + m.auditoria.registros.length;
    expect(despues).toBe(antes);
  });

  it('el catálogo de motivos lo sirve el servidor, con mensaje al estudiante, a qué certificado aplica y qué exige detalle', () => {
    const m = montarMesaCamara();
    const catalogo = m.mesa.motivosDevolucion(tutor());
    expect(catalogo.map((x) => x.codigo).sort()).toEqual([
      'documento_ilegible', 'documento_incorrecto', 'dv_no_coincide', 'informacion_incompleta', 'matricula_cancelada', 'nit_no_coincide', 'nombre_no_coincide',
      'otro', 'persona_no_coincide', 'razon_social_no_coincide', 'representante_no_coincide', 'tipo_certificado_incorrecto',
    ]);
    for (const x of catalogo) {
      expect(x.titulo.length).toBeGreaterThan(0);
      expect(x.mensajeEstudiante.que.length).toBeGreaterThan(0);
      expect(x.mensajeEstudiante.hacer.length).toBeGreaterThan(0);
      expect(x.requiereDetalle).toBe(String(x.codigo) === 'otro');
    }
    expect(catalogo.find((x) => String(x.codigo) === 'razon_social_no_coincide')!.aplicaA).toEqual(['juridica']);
    expect(catalogo.find((x) => String(x.codigo) === 'nombre_no_coincide')!.aplicaA).toEqual(['natural']);
  });
});

describe('Mesa de Cámara · reserva operativa', () => {
  it('tomar reserva 15 minutos a nombre de quien toma y lo audita; liberar la devuelve a la bandeja', async () => {
    const m = montarMesaCamara();
    const c = await caso(m, 'c1');
    await expect(m.mesa.tomar(c.validacionId, tutor('t1'), AHORA)).resolves.toMatchObject({ estado: 'mia' });
    expect(fila(m, c.validacionId)).toMatchObject({ asignadoA: 't1', reservaHasta: new Date(AHORA.getTime() + 15 * MIN) });
    expect(m.auditoria.acciones('camara_asignada')).toHaveLength(1);
    await m.mesa.liberar(c.validacionId, tutor('t1'), AHORA);
    expect(fila(m, c.validacionId)).toMatchObject({ asignadoA: null, reservaHasta: null });
    expect(m.auditoria.acciones('camara_liberada')).toHaveLength(1);
  });

  it('un segundo funcionario no toma un caso con reserva vigente (409), ni lo libera, ni lo decide por encima', async () => {
    const m = montarMesaCamara();
    const c = await caso(m, 'c1', {}, tutor('t1'));
    const ahora = new Date(AHORA.getTime() + 5 * MIN);
    await expect(m.mesa.tomar(c.validacionId, tutor('t2'), ahora)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.mesa.liberar(c.validacionId, tutor('t2'), ahora)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.mesa.decidir(c.validacionId, tutor('t2'), { decision: 'aprobar' }, ahora)).rejects.toBeInstanceOf(ConflictException);
    expect(fila(m, c.validacionId).asignadoA).toBe('t1');
  });

  it('la reserva vence sola: otro la toma, y quien la perdió ya no puede decidir (409)', async () => {
    const m = montarMesaCamara();
    const c = await caso(m, 'c1', {}, tutor('t1'));
    const despues = new Date(AHORA.getTime() + 16 * MIN);
    await expect(m.mesa.decidir(c.validacionId, tutor('t1'), { decision: 'aprobar' }, despues)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.mesa.tomar(c.validacionId, tutor('t2'), despues)).resolves.toMatchObject({ estado: 'mia' });
    await expect(m.mesa.decidir(c.validacionId, tutor('t1'), { decision: 'aprobar' }, despues)).rejects.toBeInstanceOf(ConflictException);
  });

  it('sin reserva no se decide (409)', async () => {
    const m = montarMesaCamara();
    const c = await caso(m, 'c1');
    await expect(m.mesa.decidir(c.validacionId, tutor(), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([['coordinación', coordCamara()], ['administración', adminCamara()]])('%s libera la reserva de otra persona (auditado como administrativa)', async (_n, supervisor) => {
    const m = montarMesaCamara();
    const c = await caso(m, 'c1', {}, tutor('t1'));
    await m.mesa.liberar(c.validacionId, supervisor, AHORA);
    expect(fila(m, c.validacionId).asignadoA).toBeNull();
    expect(m.auditoria.acciones('camara_liberada')[0]).toMatchObject({ actorId: supervisor.id, metadatos: { administrativa: true } });
  });

  it('CONCURRENCIA · 25 personas toman el mismo caso a la vez: UNA gana y 24 reciben 409', async () => {
    const m = montarMesaCamara();
    const c = await caso(m, 'c1');
    const r = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => m.mesa.tomar(c.validacionId, tutor(`t${i}`), AHORA)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.filter((x) => x.status === 'rejected' && x.reason instanceof ConflictException)).toHaveLength(24);
    expect(m.auditoria.acciones('camara_asignada')).toHaveLength(1);
  });

  it('«tomar siguiente»: respeta la prioridad y dos personas a la vez reciben casos distintos', async () => {
    const m = montarMesaCamara();
    await caso(m, 'normal');
    const incorrecto = await caso(m, 'incorrecto', { lectura: lecturaCamara(C.DOCUMENTO_INCORRECTO, null) });
    await caso(m, 'critico', DISCREPANTE);
    const [r1, r2] = await Promise.all([m.mesa.tomarSiguiente(tutor('t1'), {}, AHORA), m.mesa.tomarSiguiente(tutor('t2'), {}, AHORA)]);
    expect([r1.estado, r2.estado]).toEqual(['tomado', 'tomado']);
    expect(r1.validacionId).not.toBe(r2.validacionId);
    expect(new Set([r1.validacionId, r2.validacionId]).has(incorrecto.validacionId)).toBe(true);
    expect((await m.mesa.tomarSiguiente(tutor('t3'), {}, AHORA)).estado).toBe('tomado');
    expect((await m.mesa.tomarSiguiente(tutor('t4'), {}, AHORA)).estado).toBe('sin_casos');
  });

  it('un caso que aún no se procesó no se puede tomar ni decidir: 409', async () => {
    const m = montarMesaCamara();
    const c = await m.crear({ id: 'c1', sinProcesar: true });
    await expect(m.mesa.tomar(c.validacionId as string, tutor(), AHORA)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.mesa.decidir(c.validacionId as string, tutor(), { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('Mesa de Cámara · decisión atómica y concurrente', () => {
  it('CONCURRENCIA · 12 decisiones simultáneas sobre el mismo caso: UNA aplica, 11 reciben 409 y no hay escrituras de más', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    const r = await Promise.allSettled(Array.from({ length: 12 }, () => m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.filter((x) => x.status === 'rejected' && x.reason instanceof ConflictException)).toHaveLength(11);
    expect(m.validaciones.evidencias.filter((e) => e.tipo === TipoEvidenciaDocumentoEmpresarial.DECISION_HUMANA)).toHaveLength(1);
    expect(m.auditoria.acciones('decision_camara')).toHaveLength(1);
    expect(m.auditoria.acciones('decision_documento')).toHaveLength(1);
  });

  it('los 409 de una decisión hablan del certificado de Cámara, no del RUT', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const v1 = await caso(m, 'v1', { practicaId: 'p1', version: 1 }, t);
    await caso(m, 'v2', { practicaId: 'p1', version: 2 });
    await expect(m.mesa.decidir(v1.validacionId, t, { decision: 'aprobar' }, AHORA)).rejects.toThrow(/certificado/);
    await expect(m.mesa.decidir(v1.validacionId, t, { decision: 'aprobar' }, AHORA)).rejects.not.toThrow(/RUT/);
  });

  it.each(['tras_documento', 'tras_validacion', 'tras_evidencia', 'tras_auditoria_documento'] as const)(
    'ROLLBACK COMPLETO si la operación se interrumpe en «%s»: ni documento, ni validación, ni evidencia, ni auditoría',
    async (punto) => {
      const m = montarMesaCamara();
      const t = tutor();
      const c = await caso(m, 'c1', {}, t);
      const antes = { doc: { ...docDe(m, c.documentoId) }, val: { ...fila(m, c.validacionId) }, ev: m.validaciones.evidencias.length, au: m.auditoria.registros.length };
      m.decision.alPunto = (p) => { if (p === punto) throw new Error('interrupción simulada'); };
      await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA)).rejects.toThrow('interrupción simulada');
      expect(docDe(m, c.documentoId)).toEqual(antes.doc);
      expect(fila(m, c.validacionId)).toEqual(antes.val);
      expect(m.validaciones.evidencias).toHaveLength(antes.ev);
      expect(m.auditoria.registros).toHaveLength(antes.au);
      m.decision.alPunto = undefined;
      await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA)).resolves.toBeDefined();
    },
  );

  it('los avisos y la bitácora ocurren DESPUÉS del commit: si la decisión se revierte, no se avisa al estudiante', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    m.decision.alPunto = (p) => { if (p === 'tras_evidencia') throw new Error('interrupción simulada'); };
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionCamara.ILEGIBLE }, AHORA)).rejects.toThrow();
    expect(m.notificar).not.toHaveBeenCalled();
    expect(m.anotarDevolucion).not.toHaveBeenCalled();
  });

  it('la evidencia de la decisión es de solo inserción y sin datos personales del documento', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    const previas = JSON.stringify(m.validaciones.evidencias);
    await m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA);
    expect(JSON.stringify(m.validaciones.evidencias.slice(0, (JSON.parse(previas) as unknown[]).length))).toBe(previas);
    const evidencia = m.validaciones.evidencias.find((e) => e.tipo === TipoEvidenciaDocumentoEmpresarial.DECISION_HUMANA)!;
    expect(Object.keys(evidencia.datos).sort()).toEqual(['accion', 'justificacion', 'motivo', 'rol']);
    expect(JSON.stringify(evidencia)).not.toContain(NIT_JURIDICA);
  });
});

describe('Mesa de Cámara · reenvío y versiones', () => {
  it('una Cámara nueva tras la devolución es OTRA versión con SU validación; la anterior queda histórica y no se reabre', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const v1 = await caso(m, 'v1', { practicaId: 'p1', version: 1 }, t);
    await m.mesa.decidir(v1.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionCamara.ILEGIBLE }, AHORA);
    const v2 = await caso(m, 'v2', { practicaId: 'p1', version: 2 });
    expect(v2.validacionId).not.toBe(v1.validacionId);
    expect(fila(m, v1.validacionId)).toMatchObject({ estado: Estado.DEVUELTO, motivoDecision: 'documento_ilegible' });
    expect(fila(m, v2.validacionId).estado).toBe(Estado.REVISION);
    const bandeja = await m.mesa.listar(coordCamara(), {}, AHORA);
    expect(bandeja.items.map((i) => i.validacionId)).toEqual([v2.validacionId]);
    expect(bandeja.items[0].esReenvio).toBe(true);
    const detalle = await m.mesa.detalle(v2.validacionId, t, AHORA);
    expect(detalle.versiones.map((x) => [x.version, x.vigente])).toEqual([[2, true], [1, false]]);
    expect(detalle.versiones[1]).toMatchObject({ estado: 'devuelto', motivo: 'documento_ilegible' });
  });

  it('flujo completo: devuelve → el estudiante lee el mensaje → reenvía → se toma la nueva versión → se aprueba', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const yo = (e: string) => actorDe(Rol.ESTUDIANTE, { id: e });
    const v1 = await caso(m, 'v1', { practicaId: 'p1', version: 1, ...DISCREPANTE }, t);
    await m.mesa.decidir(v1.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionCamara.RAZON_SOCIAL_NO_COINCIDE }, AHORA);
    const corregir = await m.estudiante.estado('p1', yo(v1.estudianteId));
    expect(corregir).toMatchObject({ estado: 'necesita_correccion', puedeReenviar: true, que: MENSAJES_DEVOLUCION_CAMARA[MotivoDevolucionCamara.RAZON_SOCIAL_NO_COINCIDE].que });
    const v2 = await caso(m, 'v2', { practicaId: 'p1', version: 2, recibidaHace: -1 });
    expect((await m.estudiante.estado('p1', yo(v1.estudianteId))).estado).toBe('en_revision');
    await m.mesa.tomar(v2.validacionId, tutor('t2'), AHORA);
    await m.mesa.decidir(v2.validacionId, tutor('t2'), { decision: 'aprobar' }, AHORA);
    expect(await m.estudiante.estado('p1', yo(v1.estudianteId))).toMatchObject({ estado: 'aprobado', puedeReenviar: false });
    expect(fila(m, v1.validacionId).estado).toBe(Estado.DEVUELTO);
  });

  it('una versión vieja que seguía abierta no se toma ni se decide: 409 «hay una más reciente»', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const v1 = await caso(m, 'v1', { practicaId: 'p1', version: 1 }, t);
    await caso(m, 'v2', { practicaId: 'p1', version: 2 });
    await expect(m.mesa.decidir(v1.validacionId, t, { decision: 'aprobar' }, AHORA)).rejects.toThrow(/versión más reciente/);
    await expect(m.mesa.tomar(v1.validacionId, tutor('t2'), AHORA)).rejects.toThrow(/versión más reciente/);
    expect(docDe(m, v1.documentoId).estado).toBe(EstadoDocumento.EN_REVISION);
  });
});

describe('Mesa de Cámara · recálculo y datos de SIPRA cambiados', () => {
  it('antes de decidir un caso abierto se recalcula con la lectura existente (sin releer el PDF) y la decisión usa lo recalculado', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    expect(comparacionDe(m, c.validacionId).veredicto).toBe('consistente');
    m.cambiarSipra(c.practicaId, { razonSocial: 'OTRA COMERCIALIZADORA S.A.S.' });
    await expect(m.mesa.decidir(c.validacionId, t, { decision: 'aprobar', justificacion: 'ok' }, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    expect(comparacionDe(m, c.validacionId).veredicto).toBe('discrepancia');
    expect(m.auditoria.acciones('camara_recalculada')).toHaveLength(1);
    expect(m.almacen.leer).not.toHaveBeenCalled();
  });

  it('el detalle de un caso abierto muestra el aviso de datos de SIPRA cuando se recalculó, y el representante cambiado se ve como «No coincide»', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    expect((await m.mesa.detalle(c.validacionId, t, AHORA)).avisoDatosSipra).toBeNull();
    m.cambiarSipra(c.practicaId, { representanteLegal: 'OTRA PERSONA DISTINTA' });
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.avisoDatosSipra).toBe('Los datos de SIPRA cambiaron después de esta validación.');
    expect(d.representante!.resultado).toBe('diferente');
  });

  it('SIPRA cambia DESPUÉS de una decisión: la decisión NO se altera; se avisa y se deja constancia UNA sola vez', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    await m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA);
    const decidida = { ...fila(m, c.validacionId) };
    m.cambiarSipra(c.practicaId, { razonSocial: 'OTRA COMERCIALIZADORA S.A.S.' });
    const despues = new Date(AHORA.getTime() + 60 * MIN);
    const d1 = await m.mesa.detalle(c.validacionId, t, despues);
    expect(d1.avisoDatosSipra).toBe('Los datos de SIPRA cambiaron después de esta validación.');
    expect(d1.decision).toMatchObject({ estado: Estado.APROBADO_MANUAL });
    expect(fila(m, c.validacionId)).toMatchObject({
      estado: Estado.APROBADO_MANUAL, decididoPor: decidida.decididoPor, decididoEn: decidida.decididoEn, comparacion: decidida.comparacion, datosSipraCambiaronEn: despues,
    });
    expect(docDe(m, c.documentoId).estado).toBe(EstadoDocumento.APROBADO);
    await m.mesa.detalle(c.validacionId, t, new Date(despues.getTime() + MIN));
    expect(m.validaciones.evidencias.filter((e) => e.tipo === TipoEvidenciaDocumentoEmpresarial.CAMBIO_DATOS_SIPRA)).toHaveLength(1);
    expect(m.auditoria.acciones('camara_datos_cambiaron_tras_decision')).toHaveLength(1);
    expect(m.auditoria.acciones('camara_recalculada')).toHaveLength(0);
  });

  it('un caso decidido que no cambió no genera constancia ni aviso', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    await m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA);
    expect((await m.mesa.detalle(c.validacionId, t, AHORA)).avisoDatosSipra).toBeNull();
    expect(m.validaciones.evidencias.filter((e) => e.tipo === TipoEvidenciaDocumentoEmpresarial.CAMBIO_DATOS_SIPRA)).toHaveLength(0);
  });
});

describe('Mesa de Cámara · visor, enmascaramiento y archivo', () => {
  it('el NIT se ve completo solo con el caso tomado o en supervisión; si no, enmascarado', async () => {
    const m = montarMesaCamara();
    const c = await caso(m, 'c1');
    const sinTomar = await m.mesa.detalle(c.validacionId, tutor(), AHORA);
    const nit = sinTomar.criticos.find((x) => x.campo === 'nit')!;
    expect(nit.sipra).toBe('••••3456');
    expect(nit.camara).toBe('••••3456');
    expect(JSON.stringify(sinTomar)).not.toContain(NIT_JURIDICA);
    await m.mesa.tomar(c.validacionId, tutor(), AHORA);
    expect((await m.mesa.detalle(c.validacionId, tutor(), AHORA)).criticos.find((x) => x.campo === 'nit')!.camara).toBe(NIT_JURIDICA);
    expect((await m.mesa.detalle(c.validacionId, coordCamara(), AHORA)).criticos.find((x) => x.campo === 'nit')!.camara).toBe(NIT_JURIDICA);
  });

  it('el archivo solo se sirve a quien tiene el caso tomado (o supervisa) y la apertura queda auditada', async () => {
    const m = montarMesaCamara();
    const c = await caso(m, 'c1');
    await expect(m.mesa.archivo(c.validacionId, tutor(), AHORA)).rejects.toBeInstanceOf(ConflictException);
    await m.mesa.tomar(c.validacionId, tutor(), AHORA);
    const archivo = await m.mesa.archivo(c.validacionId, tutor(), AHORA);
    expect(archivo).toMatchObject({ mime: 'application/pdf' });
    expect(m.auditoria.acciones('documento_visualizado')[0].metadatos).toMatchObject({ origen: 'mesa_camara' });
    await expect(m.mesa.archivo(c.validacionId, tutor('t2'), AHORA)).rejects.toBeInstanceOf(ConflictException);
    await expect(m.mesa.archivo(c.validacionId, coordCamara(), AHORA)).resolves.toBeDefined();
  });

  it('autenticidad: código, URL y firma solo se «detectan»; nunca «auténtico», y el caso no abre ninguna URL', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d.verificacion.autenticidad.etiqueta).toBe('No verificada');
    expect(JSON.stringify(d)).not.toContain('ejemplo.test');
    expect(textos(d).join(' ')).not.toMatch(/aut[eé]ntic[oa]\b/i);
  });
});

describe('Mesa de Cámara · permisos y alcance', () => {
  it.each([Rol.AUXILIAR, Rol.EMPRESA, Rol.EXTENSION, Rol.ESTUDIANTE])('%s NO opera la Mesa: ni bandeja, ni detalle, ni toma, ni decisión, ni archivo, ni supervisión', async (rol) => {
    const m = montarMesaCamara();
    const c = await caso(m, 'c1');
    const a = actorDe(rol);
    await expect(m.mesa.listar(a, {}, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.detalle(c.validacionId, a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.tomar(c.validacionId, a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.tomarSiguiente(a, {}, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.decidir(c.validacionId, a, { decision: 'aprobar' }, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.archivo(c.validacionId, a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.supervision(a, AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(() => m.mesa.motivosDevolucion(a)).toThrow(ForbiddenException);
    expect(fila(m, c.validacionId).asignadoA).toBeNull();
  });

  it('el auxiliar tampoco decide la Cámara por el camino general (política vigente: solo EPS y acta)', async () => {
    const m = montarMesaCamara();
    const c = await caso(m, 'c1');
    await expect(m.gestionar.decidir(c.documentoId, { decision: 'aprobar', justificacion: TEXTO_40_CAMARA }, actorDe(Rol.AUXILIAR))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('el docente no supervisa; coordinación y administración sí', async () => {
    const m = montarMesaCamara();
    await caso(m, 'c1');
    await expect(m.mesa.supervision(tutor(), AHORA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(m.mesa.supervision(coordCamara(), AHORA)).resolves.toMatchObject({ abiertas: 1, libres: 1 });
    await expect(m.mesa.supervision(adminCamara(), AHORA)).resolves.toMatchObject({ abiertas: 1 });
  });

  it('un docente de otra escuela, o sin escuelas, no ve la bandeja ni el caso («no existe»)', async () => {
    const m = montarMesaCamara();
    const c = await caso(m, 'c1');
    const ajeno = actorDe(Rol.TUTOR, { id: 'tutor-ajeno', escuelas: ['ESC-OTRA'] });
    const sinEscuelas = actorDe(Rol.TUTOR, { id: 'tutor-sin', escuelas: [] });
    expect((await m.mesa.listar(ajeno, {}, AHORA)).total).toBe(0);
    expect((await m.mesa.listar(sinEscuelas, {}, AHORA)).total).toBe(0);
    await expect(m.mesa.detalle(c.validacionId, ajeno, AHORA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(m.mesa.tomar(c.validacionId, ajeno, AHORA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(m.mesa.tomarSiguiente(ajeno, {}, AHORA)).resolves.toMatchObject({ estado: 'sin_casos' });
    expect((await m.mesa.listar(tutor(), {}, AHORA)).total).toBe(1);
  });

  it('solo supervisión pide otros estados en la bandeja; el docente siempre ve lo abierto', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    await m.mesa.decidir(c.validacionId, t, { decision: 'aprobar' }, AHORA);
    await caso(m, 'c2');
    expect((await m.mesa.listar(t, { estado: 'aprobado_manual' }, AHORA)).items.map((i) => i.estado)).toEqual(['revision']);
    expect((await m.mesa.listar(coordCamara(), { estado: 'aprobado_manual' }, AHORA)).items.map((i) => i.estado)).toEqual(['aprobado_manual']);
  });

  it('la Mesa de Cámara no lista RUT ni otros documentos de la práctica', async () => {
    const m = montarMesaCamara();
    await caso(m, 'c1');
    const ids = (await m.mesa.listar(coordCamara(), {}, AHORA)).items.map((i) => i.tipo);
    expect(ids).toEqual(['camara_comercio']);
  });
});

describe('Cámara · lo que ve el estudiante', () => {
  it('solo ve el estado de SU práctica: la de otro estudiante «no existe» (404) y otros roles no entran (403)', async () => {
    const m = montarMesaCamara();
    const c = await caso(m, 'c1');
    await expect(m.estudiante.estado(c.practicaId, actorDe(Rol.ESTUDIANTE, { id: 'est-otro' }))).rejects.toBeInstanceOf(NotFoundException);
    await expect(m.estudiante.estado('no-existe', actorDe(Rol.ESTUDIANTE, { id: c.estudianteId }))).rejects.toBeInstanceOf(NotFoundException);
    for (const rol of [Rol.TUTOR, Rol.COORDINADOR, Rol.EMPRESA, Rol.AUXILIAR]) {
      await expect(m.estudiante.estado(c.practicaId, actorDe(rol))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('los seis estados humanos, y NADA técnico: ni códigos, ni confianza, ni hashes, ni causas, ni texto del OCR', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const vistos: string[] = [];
    const ver = async (practicaId: string, estudianteId: string) => {
      const e = await m.estudiante.estado(practicaId, actorDe(Rol.ESTUDIANTE, { id: estudianteId }));
      vistos.push(JSON.stringify(e));
      return e;
    };
    const sin = actorDe(Rol.ESTUDIANTE, { id: 'est-pra-vacia' });
    m.usuarios.set('est-pra-vacia', usuarioDe(Rol.ESTUDIANTE, { id: 'est-pra-vacia' }));
    m.practicas.set('pra-vacia', practicaDe({ id: 'pra-vacia', estudianteId: 'est-pra-vacia' }));
    expect(await m.estudiante.estado('pra-vacia', sin)).toMatchObject({ estado: 'pendiente', etiqueta: 'Pendiente de cargar', puedeReenviar: true });

    const proc = await m.crear({ id: 'proc', sinProcesar: true });
    expect(await ver(proc.practicaId, proc.estudianteId)).toMatchObject({ estado: 'en_procesamiento', etiqueta: 'En procesamiento' });
    const rev = await caso(m, 'rev', { lectura: lecturaDudosaOcr() });
    expect(await ver(rev.practicaId, rev.estudianteId)).toMatchObject({ estado: 'en_revision', etiqueta: 'En revisión', puedeReenviar: false });
    const apr = await caso(m, 'apr', {}, t);
    await m.mesa.decidir(apr.validacionId, t, { decision: 'aprobar' }, AHORA);
    expect(await ver(apr.practicaId, apr.estudianteId)).toMatchObject({ estado: 'aprobado', etiqueta: 'Aprobado' });
    const dev = await caso(m, 'dev', DISCREPANTE, t);
    await m.mesa.decidir(dev.validacionId, t, { decision: 'devolver', motivo: MotivoDevolucionCamara.NIT_NO_COINCIDE }, AHORA);
    expect(await ver(dev.practicaId, dev.estudianteId)).toMatchObject({ estado: 'necesita_correccion', etiqueta: 'Necesita corrección', puedeReenviar: true, que: MENSAJES_DEVOLUCION_CAMARA[MotivoDevolucionCamara.NIT_NO_COINCIDE].que });
    const rec = await caso(m, 'rec', {}, t);
    await m.mesa.decidir(rec.validacionId, t, { decision: 'rechazar', justificacion: TEXTO_40_CAMARA, confirmar: true }, AHORA);
    expect(await ver(rec.practicaId, rec.estudianteId)).toMatchObject({ estado: 'rechazado', etiqueta: 'Rechazado' });

    for (const v of vistos) {
      expect(v).not.toContain(HASH_CAMARA);
      expect(v).not.toMatch(/confianza|lecturaDudosa|dudosa|hash|ocr|discrepancia|C[0-3]_|nit_no_coincide|no_determinable|razon_social/i);
      expect(Object.keys(JSON.parse(v) as object).sort()).toEqual(['estado', 'etiqueta', 'hacer', 'puedeReenviar', 'que']);
    }
  });
});

describe('Mesa de Cámara · contrato para la bandeja y para una futura Mesa Documental', () => {
  it('cada ítem trae lo esperado y lo detectado y el contrato común (practica, estudiante, documento, tipo, estado, reserva, problema, fecha)', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    await caso(m, 'ok');
    await caso(m, 'dis', DISCREPANTE);
    await caso(m, 'rep', REP_DIFERENTE);
    await caso(m, 'ocr', { lectura: lecturaDudosaOcr() });
    await caso(m, 'per', { lectura: lecturaPn() });
    await caso(m, 'inc', { lectura: lecturaCamara(C.DOCUMENTO_INCORRECTO, null) });
    await caso(m, 'can', { lectura: CANCELADA });
    const lista = await m.mesa.listar(t, {}, AHORA);
    expect(lista.total).toBe(7);
    expect(lista.kpis).toMatchObject({ abiertas: 7, libres: 7, mias: 0, tomadas: 0, conDiscrepancia: 3, documentoIncorrecto: 1, lecturaDudosa: 1, personaDistinta: 1 });
    const item = lista.items.find((i) => i.documentoId === 'doc-ocr')!;
    expect(item).toMatchObject({
      practicaId: 'pra-ocr', estudianteId: 'est-pra-ocr', documentoId: 'doc-ocr', tipo: 'camara_comercio', estado: 'revision', problemaPrincipal: 'La lectura es poco segura: revise contra el documento',
      tipoEsperado: 'camara_comercio', tipoDetectado: C.CAMARA_EXISTENCIA_REPRESENTACION, tipoCertificado: 'persona_juridica', lecturaOcr: true, lecturaDudosa: true,
      modalidad: 'pasantia', reserva: { estado: 'libre' }, estadoHumano: { etiqueta: 'Revisión necesaria', nivel: 'atencion' },
    });
    expect(item.fechaCarga).toBe(AHORA.toISOString());
    expect(lista.items.find((i) => i.documentoId === 'doc-can')).toMatchObject({ matriculaCancelada: true, estadoHumano: { nivel: 'alerta' } });
    expect(lista.items.find((i) => i.documentoId === 'doc-rep')).toMatchObject({ representanteDiferente: true, hayDiscrepancia: false });
    expect(lista.items.find((i) => i.documentoId === 'doc-per')).toMatchObject({ personaDistinta: true });
    // Filtros.
    expect((await m.mesa.listar(t, { lecturaDudosa: 'si' }, AHORA)).total).toBe(1);
    expect((await m.mesa.listar(t, { personaDistinta: 'si' }, AHORA)).total).toBe(1);
    expect((await m.mesa.listar(t, { documentoIncorrecto: 'si' }, AHORA)).total).toBe(1);
    expect((await m.mesa.listar(t, { conDiscrepancias: 'si' }, AHORA)).total).toBe(3);
  });

  it('los KPI de supervisión y de la bandeja cuentan tomados, por vencer y vencidos', async () => {
    const m = montarMesaCamara();
    const a = await caso(m, 'a');
    const b = await caso(m, 'b');
    await caso(m, 'c');
    await m.mesa.tomar(a.validacionId, tutor('t1'), AHORA);
    await m.mesa.tomar(b.validacionId, tutor('t2'), new Date(AHORA.getTime() - 13 * MIN));
    const sup = await m.mesa.supervision(coordCamara(), AHORA);
    expect(sup).toMatchObject({ abiertas: 3, libres: 1, tomadas: 2, porVencer: 1, vencidas: 0 });
    const despues = new Date(AHORA.getTime() + 20 * MIN);
    expect(await m.mesa.supervision(coordCamara(), despues)).toMatchObject({ tomadas: 0, vencidas: 2, libres: 3 });
    expect((await m.mesa.listar(tutor('t1'), {}, AHORA)).kpis).toMatchObject({ mias: 1, tomadas: 2, porVencer: 1 });
  });

  it('el detalle trae también el contrato común y la reserva', async () => {
    const m = montarMesaCamara();
    const t = tutor();
    const c = await caso(m, 'c1', {}, t);
    const d = await m.mesa.detalle(c.validacionId, t, AHORA);
    expect(d).toMatchObject({
      practicaId: c.practicaId, estudianteId: c.estudianteId, documentoId: c.documentoId, tipo: 'camara_comercio', estado: 'revision',
      estadoHumano: { etiqueta: 'Consistente', nivel: 'ok' }, reserva: { estado: 'mia' }, problemaPrincipal: null, puedeDecidir: true,
      aprobarExigeJustificacion: false, minimoJustificacionAprobar: 0,
    });
    expect(d.historial.map((h) => h.tipo)).toEqual(['lectura_documento', 'clasificacion', 'comparacion']);
  });
});
