import { ClasificacionDocumentoEmpresarial as C, EstadoAutenticidad } from '../src/domain/entities/documento-empresarial';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, EstadoProcesamientoEps,
} from '../src/domain/entities/validacion-eps.entity';
import { analizarCertificadoArl } from '../src/domain/services/clasificacion-documental-arl.domain-service';
import {
  DecisionAutomaticaDocumento, INTERRUPTORES_DECISION_POR_DEFECTO, InterruptoresDecisionAutomatica, consolidarDecision,
  motorDecisionAutorizado,
} from '../src/domain/services/decision-automatica-documental.domain-service';
import {
  HechosDocumentoEmpresarial, HechosEps, decidirArl, decidirCamara, decidirEps, decidirRut,
} from '../src/domain/services/politicas-decision-documental.domain-service';

/** Motor de decisión documental automática (1.6A) · políticas de dominio. Datos 100 % sintéticos. */

const TODO: InterruptoresDecisionAutomatica = {
  habilitado: true, aprobacionEps: true, aprobacionRut: true, aprobacionCamara: true, aprobacionArl: true,
  devolucionDocumentoIncorrecto: true, devolucionIncumplimiento: true,
};

function eps(cambios: Partial<HechosEps> = {}): HechosEps {
  return {
    clasificacion: 'certificado_eps_probable', subtipoIncorrecto: null, estadoProcesamiento: EstadoProcesamientoEps.PROCESADO,
    autenticidad: AutenticidadEps.NO_VERIFICABLE, coincidencia: CoincidenciaEps.COINCIDE, discrepancias: [],
    afiliacion: AfiliacionEps.ACTIVA, afiliacionFuente: 'adres_bdua', vigencia: 'vigente', hayBanderaCritica: false,
    procedencia: { numero_documento: 'texto_nativo', nombre: 'texto_nativo', fecha_expedicion: 'texto_nativo', eps: 'texto_nativo', estado_reportado: 'texto_nativo' },
    ...cambios,
  };
}

const final = (tipo: TipoDocumento, d: DecisionAutomaticaDocumento, i: Partial<InterruptoresDecisionAutomatica> = TODO) => consolidarDecision(tipo, d, i);
const EPS = TipoDocumento.CERTIFICADO_EPS;

describe('EPS', () => {
  it('1. correcto + QR oficial verificado + identidad + vigente → autoaprobable (sin exigir ADRES)', () => {
    const d = decidirEps(eps({ autenticidad: AutenticidadEps.VERIFICADA, afiliacionFuente: 'verificador_oficial' }));
    expect(d).toMatchObject({ resultado: 'auto_aprobar', verificacionOficial: true });
    expect(d.motivos).toContain('ruta_qr_oficial');
  });

  it('2. correcto sin QR + ADRES activo + coincidencia + vigente → autoaprobable', () => {
    const d = decidirEps(eps());
    expect(d).toMatchObject({ resultado: 'auto_aprobar', verificacionOficial: true });
    expect(d.motivos).toContain('ruta_adres');
  });

  it('3. correcto pero ADRES pendiente (afiliación no contrastada) → revisión', () => {
    const d = decidirEps(eps({ afiliacion: AfiliacionEps.NO_CONTRASTADA, afiliacionFuente: null }));
    expect(d).toMatchObject({ resultado: 'revision', motivos: ['afiliacion_no_confirmada'] });
  });

  it('4. vencido con fecha leída localmente (texto nativo) → autodevolver por incumplimiento', () => {
    const d = final(EPS, decidirEps(eps({ vigencia: 'vencido' })));
    expect(d).toMatchObject({ resultado: 'auto_devolver', tipoDevolucion: 'incumplimiento', motivos: ['certificado_vencido'] });
    expect((d as { mensajeUsuario: string }).mensajeUsuario).toMatch(/fuera de la vigencia/);
  });

  it('5. vencimiento con fecha SOLO de IA → revisión, nunca devolución', () => {
    const d = final(EPS, decidirEps(eps({ vigencia: 'vencido', procedencia: { ...eps().procedencia, fecha_expedicion: 'ia_rescate' } })));
    expect(d.resultado).toBe('revision');
    expect(d.motivos).toContain('fuente_ia_no_corroborada');
  });

  it('5b. vencimiento con fecha por OCR → revisión (un OCR puede leer mal un dígito)', () => {
    const d = decidirEps(eps({ vigencia: 'vencido', procedencia: { ...eps().procedencia, fecha_expedicion: 'ocr' } }));
    expect(d).toMatchObject({ resultado: 'revision', motivos: ['certificado_vencido', 'lectura_ocr_no_concluyente'] });
  });

  it('6. nombre diferente leído solo por IA (caso real observado) → revisión, nunca autodevolver', () => {
    const d = final(EPS, decidirEps(eps({
      coincidencia: CoincidenciaEps.DISCREPANCIA, discrepancias: [{ campo: 'nombre', comparacion: 'certificado_vs_interno' }],
      procedencia: { ...eps().procedencia, nombre: 'ia_rescate', eps: 'ia_rescate', fecha_expedicion: 'ia_rescate', estado_reportado: 'ia_rescate' },
    })));
    expect(d.resultado).toBe('revision');
    expect(d.motivos).toEqual(expect.arrayContaining(['discrepancia_nombre', 'fuente_ia_no_corroborada']));
  });

  it('7. documento de identidad diferente leído localmente (texto nativo) → autodevolver; oficial también', () => {
    const local = final(EPS, decidirEps(eps({ coincidencia: CoincidenciaEps.DISCREPANCIA, discrepancias: [{ campo: 'numero_documento', comparacion: 'certificado_vs_interno' }] })));
    expect(local).toMatchObject({ resultado: 'auto_devolver', motivos: ['documento_otra_persona'] });
    const oficial = decidirEps(eps({
      coincidencia: CoincidenciaEps.DISCREPANCIA, discrepancias: [{ campo: 'numero_documento', comparacion: 'oficial_vs_interno' }],
      procedencia: { ...eps().procedencia, numero_documento: 'ia_rescate' },
    }));
    expect(oficial).toMatchObject({ resultado: 'auto_devolver', fuentesCriticas: { numero_documento: 'oficial' } });
  });

  it('7b. documento diferente leído por IA u OCR → revisión', () => {
    for (const f of ['ia_rescate', 'ocr', 'lectura_base'] as const) {
      const d = final(EPS, decidirEps(eps({
        coincidencia: CoincidenciaEps.DISCREPANCIA, discrepancias: [{ campo: 'numero_documento', comparacion: 'certificado_vs_interno' }],
        procedencia: { ...eps().procedencia, numero_documento: f },
      })));
      expect(d.resultado).toBe('revision');
    }
  });

  it.each([
    ['8. desprendible de nómina', 'desprendible_nomina'], ['9. planilla PILA', 'planilla_aportes_pila'],
    ['10. certificado ARL', 'certificado_arl'], ['11. certificado laboral', 'certificacion_laboral'],
  ])('%s clasificado localmente como incorrecto → autodevolver documento incorrecto', (_n, subtipo) => {
    const d = final(EPS, decidirEps(eps({ clasificacion: 'documento_incorrecto', subtipoIncorrecto: subtipo })));
    expect(d).toMatchObject({ resultado: 'auto_devolver', tipoDevolucion: 'documento_incorrecto' });
    expect(d.motivos).toEqual(['tipo_documento_incorrecto', `subtipo_${subtipo}`]);
    expect((d as { mensajeUsuario: string }).mensajeUsuario)
      .toBe('Este archivo no corresponde al certificado de afiliación a EPS. Cargue el certificado de afiliación a EPS correcto.');
  });

  it('12. texto insuficiente (no determinable) → revisión, NO documento incorrecto', () => {
    expect(final(EPS, decidirEps(eps({ clasificacion: 'no_determinable' })))).toMatchObject({ resultado: 'revision', motivos: ['clasificacion_no_determinable'] });
  });

  it('afiliación INACTIVA confirmada por fuente oficial → autodevolver; bandera crítica → revisión', () => {
    expect(decidirEps(eps({ afiliacion: AfiliacionEps.INACTIVA }))).toMatchObject({ resultado: 'auto_devolver', motivos: ['afiliacion_inactiva'] });
    expect(decidirEps(eps({ hayBanderaCritica: true })).resultado).toBe('revision');
  });

  it('identidad leída por IA sin ninguna confirmación oficial → no se aprueba', () => {
    const d = decidirEps(eps({
      afiliacion: AfiliacionEps.NO_CONTRASTADA, afiliacionFuente: null, procedencia: { ...eps().procedencia, numero_documento: 'ia_rescate' },
    }));
    expect(d.resultado).toBe('revision');
  });

  it('la fecha de expedición leída por IA nunca hace «vigente» un certificado aprobable', () => {
    const d = decidirEps(eps({ procedencia: { ...eps().procedencia, fecha_expedicion: 'ia_rescate' } }));
    expect(d).toMatchObject({ resultado: 'revision', motivos: ['vigencia_no_determinada', 'fuente_ia_no_corroborada'] });
  });

  it('32. la IA nunca prueba autenticidad: sin QR/ADRES, aun con todo coincidente y leído por IA, no hay aprobación', () => {
    const ia = { numero_documento: 'ia_rescate', nombre: 'ia_rescate', fecha_expedicion: 'ia_rescate', eps: 'ia_rescate', estado_reportado: 'ia_rescate' } as const;
    const d = decidirEps(eps({ afiliacion: AfiliacionEps.NO_CONTRASTADA, afiliacionFuente: null, procedencia: ia }));
    expect(d.resultado).toBe('revision');
    expect(d.verificacionOficial).toBe(false);
  });
});

function emp(cambios: Partial<HechosDocumentoEmpresarial> = {}): HechosDocumentoEmpresarial {
  return {
    procesada: true, tipoDetectado: C.RUT_PERSONA_NATURAL, expectativa: 'coincide', lecturaDudosa: false, metodoLectura: 'texto',
    comparacion: { veredicto: 'consistente', hayDiscrepancia: false }, controlNit: 'confiable', autenticidad: EstadoAutenticidad.NO_VERIFICABLE,
    hayBanderaCritica: false, ...cambios,
  };
}
const RN = TipoDocumento.RUT_NATURAL;
const RJ = TipoDocumento.RUT_JURIDICO;

describe('RUT', () => {
  it('13. RUT natural correcto + NIT/DV + comparación → autoaprobar bajo flag', () => {
    expect(final(RN, decidirRut(RN, emp()))).toMatchObject({ resultado: 'auto_aprobar', motivos: ['consistente', 'nit_dv_valido', 'sin_verificacion_oficial'] });
  });

  it('14. RUT jurídico correcto → autoaprobar bajo flag', () => {
    expect(final(RJ, decidirRut(RJ, emp({ tipoDetectado: C.RUT_PERSONA_JURIDICA }))).resultado).toBe('auto_aprobar');
  });

  it('sin el flag de RUT, lo autoaprobable queda en revisión', () => {
    expect(final(RN, decidirRut(RN, emp()), { ...TODO, aprobacionRut: false })).toMatchObject({ resultado: 'revision' });
    expect(final(RN, decidirRut(RN, emp()), { ...TODO, aprobacionRut: false }).motivos).toContain('autoaprobacion_deshabilitada');
  });

  it('15. NIT/DV inválido leído en texto nativo → autodevolver; por OCR o lectura dudosa → revisión', () => {
    expect(final(RN, decidirRut(RN, emp({ controlNit: 'dv_no_coincide' })))).toMatchObject({ resultado: 'auto_devolver', motivos: ['nit_invalido'] });
    expect(final(RN, decidirRut(RN, emp({ controlNit: 'dv_no_coincide', metodoLectura: 'ocr' }))).resultado).toBe('revision');
    expect(final(RN, decidirRut(RN, emp({ controlNit: 'nit_invalido', lecturaDudosa: true }))).resultado).toBe('revision');
  });

  it('16. Cámara cargada como RUT → autodevolver documento incorrecto', () => {
    const d = final(RN, decidirRut(RN, emp({ tipoDetectado: C.CAMARA_EXISTENCIA_REPRESENTACION })));
    expect(d).toMatchObject({ resultado: 'auto_devolver', tipoDevolucion: 'documento_incorrecto' });
    expect(d.motivos).toContain('subtipo_camara_comercio');
  });

  it('17. factura (documento incorrecto) cargada como RUT → autodevolver', () => {
    expect(final(RN, decidirRut(RN, emp({ tipoDetectado: C.DOCUMENTO_INCORRECTO }))).resultado).toBe('auto_devolver');
  });

  it('variante natural/jurídica incompatible con lectura segura → autodevolver; dudosa → revisión', () => {
    expect(final(RJ, decidirRut(RJ, emp({ expectativa: 'persona_distinta' })))).toMatchObject({ resultado: 'auto_devolver', motivos: ['variante_persona_incompatible'] });
    expect(final(RJ, decidirRut(RJ, emp({ expectativa: 'persona_distinta', lecturaDudosa: true }))).resultado).toBe('revision');
  });

  it('18. clasificación no determinable → revisión', () => {
    expect(final(RN, decidirRut(RN, emp({ tipoDetectado: C.NO_DETERMINABLE }))).motivos).toEqual(['clasificacion_no_determinable']);
  });

  it('19. dato crítico discrepante → revisión (y una devolución apoyada en IA se convierte en revisión)', () => {
    expect(final(RN, decidirRut(RN, emp({ comparacion: { veredicto: 'discrepancia', hayDiscrepancia: true } }))).motivos).toEqual(['discrepancia_critica']);
    const apoyadaEnIa: DecisionAutomaticaDocumento = {
      resultado: 'auto_devolver', politica: 'rut', tipoDevolucion: 'incumplimiento', motivos: ['nit_invalido'], mensajeUsuario: 'x',
      verificacionOficial: false, fuentesCriticas: { nit: 'ia_rescate' },
    };
    expect(final(RN, apoyadaEnIa)).toMatchObject({ resultado: 'revision', motivos: ['nit_invalido', 'fuente_ia_no_corroborada'] });
  });

  it('el RUT no se declara vencido por año: no existe regla de «año en curso» en esta política', () => {
    expect(final(RN, decidirRut(RN, emp())).motivos).not.toContain('certificado_vencido');
  });
});

describe('Cámara de Comercio', () => {
  const cam = (c: Partial<HechosDocumentoEmpresarial> = {}) => emp({ tipoDetectado: C.CAMARA_EXISTENCIA_REPRESENTACION, ...c });
  const CC = TipoDocumento.CAMARA_COMERCIO;

  it('20. Cámara correcta + comparación consistente → autoaprobar bajo flag', () => {
    expect(final(CC, decidirCamara(cam()))).toMatchObject({ resultado: 'auto_aprobar', motivos: ['consistente', 'sin_verificacion_rues'] });
  });

  it('21. factura de Cámara (documento incorrecto) → autodevolver', () => {
    expect(final(CC, decidirCamara(cam({ tipoDetectado: C.DOCUMENTO_INCORRECTO }))).resultado).toBe('auto_devolver');
  });

  it('22. RUT cargado como Cámara → autodevolver', () => {
    expect(final(CC, decidirCamara(cam({ tipoDetectado: C.RUT_PERSONA_JURIDICA })))).toMatchObject({ resultado: 'auto_devolver', motivos: ['tipo_documento_incorrecto', 'subtipo_rut'] });
  });

  it('23. clasificación ambigua, lectura dudosa, representante distinto o matrícula cancelada → revisión', () => {
    for (const c of [
      cam({ tipoDetectado: C.NO_DETERMINABLE }), cam({ lecturaDudosa: true }),
      cam({ comparacion: { veredicto: 'consistente', hayDiscrepancia: false, discrepanciaImportante: true } }),
      cam({ comparacion: { veredicto: 'consistente', hayDiscrepancia: false, senales: ['estado_registral_cancelado'] } }),
    ]) {
      expect(final(CC, decidirCamara(c)).resultado).toBe('revision');
    }
  });

  it('24. nunca afirma RUES verificado: aprobación con verificacionOficial=false y motivo sin_verificacion_rues', () => {
    const d = decidirCamara(cam());
    expect(d.verificacionOficial).toBe(false);
    expect(d.motivos).toContain('sin_verificacion_rues');
  });
});

describe('ARL', () => {
  const SIPRA = { documentoEstudiante: '1000000001', nitEmpresa: '901458772' };
  const CERT_ARL = `
    ADMINISTRADORA DE RIESGOS LABORALES POSITIVA COMPAÑIA DE SEGUROS
    CERTIFICADO DE AFILIACION AL SISTEMA GENERAL DE RIESGOS LABORALES
    La ARL certifica que el trabajador identificado con C.C. 1.000.000.001 se encuentra afiliado.
    Empleador: EMPRESA SINTETICA S.A.S. NIT 901458772-2
    Clase de riesgo: I    Fecha de afiliacion: 01/02/2026   Estado de la afiliacion: ACTIVA`;
  const hechos = (texto: string, inicio = '2026-02-15') => ({
    analisis: analizarCertificadoArl(texto, SIPRA), fechaInicioPractica: inicio, empresaConocida: true, hayBanderaCritica: false,
  });
  const ARL = TipoDocumento.CERTIFICADO_ARL;

  it('25. certificado ARL probable y consistente (identidad, empresa, ARL y fecha corroboradas localmente) → autoaprobar bajo flag', () => {
    const d = final(ARL, decidirArl(hechos(CERT_ARL)));
    expect(d.resultado).toBe('auto_aprobar');
    expect(d.verificacionOficial).toBe(false);
    expect(d.motivos).toEqual(expect.arrayContaining(['identidad_coincide', 'empresa_coincide', 'arl_reconocida', 'fecha_afiliacion_compatible', 'sin_verificacion_oficial']));
  });

  it('afiliación posterior al inicio, documento ausente o empresa distinta → revisión', () => {
    expect(decidirArl(hechos(CERT_ARL, '2026-01-15')).motivos).toEqual(['fecha_afiliacion_incompatible']);
    expect(decidirArl(hechos(CERT_ARL.replace('1.000.000.001', '2.000.000.002'))).motivos).toEqual(['identidad_no_corroborada']);
    expect(decidirArl(hechos(CERT_ARL.replace('901458772-2', '800111222-3'))).motivos).toEqual(['empresa_no_corroborada']);
  });

  const EPS_TXT = `ENTIDAD PROMOTORA DE SALUD EPS SINTETICA. CERTIFICADO DE AFILIACION. Regimen: CONTRIBUTIVO. Tipo de afiliado: COTIZANTE.
    Plan de beneficios en salud. El afiliado identificado con C.C. 1000000001 se encuentra activo en la EPS. Fecha de afiliacion 2020-01-01.`;
  const NOMINA_TXT = `COMPROBANTE DE NOMINA - DESPRENDIBLE DE PAGO. Periodo de pago: quincena 1. Devengados: salario basico 1.500.000,
    auxilio de transporte. Deducciones: salud 4 por ciento, pension 4 por ciento. Neto a pagar: 1.300.000. Empleado identificado 1000000001.`;
  const PILA_TXT = `PLANILLA INTEGRADA DE LIQUIDACION DE APORTES PILA. Numero de planilla 123456789. Operador de informacion: APORTES EN LINEA.
    Ingreso base de cotizacion IBC. Subsistemas: salud, fondo de pensiones, riesgos laborales ARL, caja de compensacion familiar.`;
  const RUT_TXT = `FORMULARIO DEL REGISTRO UNICO TRIBUTARIO RUT. DIRECCION DE IMPUESTOS Y ADUANAS NACIONALES DIAN. Numero de identificacion
    tributaria NIT 901458772. Responsabilidades, calidades y atributos. Actividad economica principal 6201.`;

  it.each([
    ['26. certificado EPS', EPS_TXT, 'certificado_eps'], ['27. desprendible de nómina', NOMINA_TXT, 'desprendible_nomina'],
    ['28. planilla PILA', PILA_TXT, 'planilla_aportes_pila'], ['29. RUT', RUT_TXT, 'rut'],
  ])('%s cargado como ARL → autodevolver documento incorrecto', (_n, texto, subtipo) => {
    const d = final(ARL, decidirArl(hechos(texto)));
    expect(d).toMatchObject({ resultado: 'auto_devolver', tipoDevolucion: 'documento_incorrecto' });
    expect(d.motivos).toEqual(['tipo_documento_incorrecto', `subtipo_${subtipo}`]);
  });

  it('30. documento ambiguo o sin texto → revisión', () => {
    expect(final(ARL, decidirArl(hechos('Documento con muy poco texto legible.'))).resultado).toBe('revision');
    expect(final(ARL, decidirArl({ analisis: null, fechaInicioPractica: '2026-02-15', empresaConocida: true, hayBanderaCritica: false })).resultado).toBe('revision');
    const ambiguo = `Certificado. La empresa informa que el señor trabajo con nosotros. Riesgos laborales a cargo del empleador.
      Este documento se expide a solicitud del interesado para los fines que estime convenientes en la ciudad.`;
    expect(final(ARL, decidirArl(hechos(ambiguo))).resultado).toBe('revision');
  });
});

describe('Guardas generales', () => {
  it('31. OpenAI nunca produce por sí sola una autodevolución (cualquier fuente crítica IA → revisión)', () => {
    for (const fuente of ['ia_rescate', 'lectura_base'] as const) {
      const d: DecisionAutomaticaDocumento = {
        resultado: 'auto_devolver', politica: 'eps', tipoDevolucion: 'incumplimiento', motivos: ['certificado_vencido'], mensajeUsuario: 'x',
        verificacionOficial: false, fuentesCriticas: { fecha_expedicion: fuente },
      };
      expect(final(EPS, d).resultado).toBe('revision');
    }
  });

  it('33. el motor nunca genera RECHAZADO: solo auto_aprobar, auto_devolver o revision', () => {
    const resultados = new Set<string>();
    const casos = [
      decidirEps(eps()), decidirEps(eps({ vigencia: 'vencido' })), decidirEps(eps({ clasificacion: 'no_determinable' })),
      decidirRut(RN, emp()), decidirRut(RN, emp({ tipoDetectado: C.DOCUMENTO_INCORRECTO })), decidirCamara(emp({ tipoDetectado: C.NO_DETERMINABLE })),
    ];
    for (const c of casos) for (const i of [TODO, INTERRUPTORES_DECISION_POR_DEFECTO]) resultados.add(final(EPS, c, i).resultado);
    for (const r of resultados) expect(['auto_aprobar', 'auto_devolver', 'revision']).toContain(r);
  });

  it('38. con los interruptores de fábrica (apagados) toda propuesta queda en revisión', () => {
    expect(final(EPS, decidirEps(eps()), INTERRUPTORES_DECISION_POR_DEFECTO)).toMatchObject({ resultado: 'revision' });
    expect(final(EPS, decidirEps(eps({ clasificacion: 'documento_incorrecto' })), INTERRUPTORES_DECISION_POR_DEFECTO).resultado).toBe('revision');
  });

  it('el motor solo actúa con el general en `true` estricto y ambiente dev EXACTO', () => {
    expect(motorDecisionAutorizado(TODO, 'dev')).toBe(true);
    for (const a of ['qa', 'pre', 'prod', undefined, null, 'DEV']) expect(motorDecisionAutorizado(TODO, a)).toBe(false);
    expect(motorDecisionAutorizado({ ...TODO, habilitado: 'true' as unknown as boolean }, 'dev')).toBe(false);
  });

  it('35. motivos, fuentes y mensajes no contienen datos del documento', () => {
    const d = final(EPS, decidirEps(eps({ clasificacion: 'documento_incorrecto', subtipoIncorrecto: 'desprendible_nomina' })));
    const texto = JSON.stringify(d);
    expect(texto).not.toMatch(/\d{6,}/);
    for (const m of d.motivos) expect(m).toMatch(/^[a-z_]+$/);
  });
});
