import { ConfigService } from '@nestjs/config';
import { DecisionAutomaticaDocumentalUseCase } from '../src/application/use-cases/documentos/decision-automatica-documental.use-case';
import { AccionAuditada, RegistroAuditoria } from '../src/domain/entities/auditoria.entity';
import {
  ClasificacionDocumentoEmpresarial as C, EstadoAutenticidad, EstadoValidacionDocumentoEmpresarial,
} from '../src/domain/entities/documento-empresarial';
import {
  DatosDocumento, Documento, ESTADOS_DECIDIDOS, EstadoDocumento, TipoDocumento,
} from '../src/domain/entities/documento.entity';
import { AfiliacionEps, AutenticidadEps, CoincidenciaEps, EstadoProcesamientoEps } from '../src/domain/entities/validacion-eps.entity';
import { subsanacionesVigentes } from '../src/domain/services/cargue-estudiante.domain-service';
import { estadoRutParaEstudiante } from '../src/domain/services/mesa-rut.domain-service';
import { faseEmpresarial, faseEps } from '../src/domain/services/senales-motores-documentales.domain-service';
import { operacionesAtomicasEnMemoria } from './soporte-concurrencia';

/**
 * Motor de decisión documental automática (1.6A) · caso de uso. Todo en memoria, con fakes; datos 100 % sintéticos; cero red.
 */

const DOC_ESTUDIANTE = '1000000001';
const NOMBRE = 'Valentina Sintética';

const ENCENDIDO: Record<string, unknown> = {
  SIPRA_AMBIENTE: 'dev', AUTO_DECISION_DOCUMENTAL_HABILITADA: 'true', AUTO_APROBACION_EPS: 'true', AUTO_APROBACION_RUT: 'true',
  AUTO_APROBACION_CAMARA: 'true', AUTO_APROBACION_ARL: 'true', AUTO_DEVOLUCION_DOCUMENTO_INCORRECTO: 'true', AUTO_DEVOLUCION_INCUMPLIMIENTO: 'true',
};

function datosDoc(tipo: TipoDocumento, cambios: Partial<DatosDocumento> = {}): DatosDocumento {
  const ahora = new Date('2026-11-27T15:00:00Z');
  return {
    id: 'doc-1', practicaId: 'practica-1', tipo, version: 1, estado: EstadoDocumento.EN_REVISION, nombreOriginal: 'x.pdf',
    mimeReal: 'application/pdf', tamanoBytes: 10, hashSha256: 'a'.repeat(64), hashPerceptual: null, rutaAlmacenamiento: 'ruta/x',
    calidadCaptura: null, banderas: [], puntaje: 80, banda: null,
    extraccion: {
      campos: Object.fromEntries(['documento_afiliado', 'nombre_afiliado', 'fecha_expedicion', 'entidad_emisora', 'estado_afiliacion']
        .map((c) => [c, { valor: c === 'documento_afiliado' ? DOC_ESTUDIANTE : `valor-${c}`, confianza: 0.95, evidencia: null, fuente: 'texto_nativo' }])),
    },
    decididoPor: null, justificacionDecision: null, motivoDevolucion: null, cargadoEn: ahora, actualizadoEn: ahora, purgarDespuesDe: null,
    ...cambios,
  };
}

const validacionEps = (cambios: Record<string, unknown> = {}) => ({
  instantanea: () => ({
    estadoProcesamiento: EstadoProcesamientoEps.PROCESADO, autenticidad: AutenticidadEps.NO_VERIFICABLE, coincidencia: CoincidenciaEps.COINCIDE,
    discrepancias: [], afiliacion: AfiliacionEps.ACTIVA, afiliacionFuente: 'adres_bdua', vigenciaCertificado: 'vigente', hayBanderaCritica: false,
    decision: 'pendiente', asignadoA: null, reservaHasta: null,
    datosExtraidos: { tipoDocumentoDetectado: 'certificado_eps_probable', fuentes: {} }, ...cambios,
  }),
});

const validacionEmp = (cambios: Record<string, unknown> = {}) => ({
  instantanea: () => ({
    estado: EstadoValidacionDocumentoEmpresarial.REVISION, tipoDetectado: C.RUT_PERSONA_NATURAL, expectativa: 'coincide', lecturaDudosa: false,
    metodoLectura: 'texto', comparacion: { veredicto: 'consistente', hayDiscrepancia: false }, datosExtraidos: { controlNit: 'confiable' },
    autenticidad: { estado: EstadoAutenticidad.NO_VERIFICABLE }, asignadoA: null, reservaHasta: null, ...cambios,
  }),
});

interface Opciones {
  tipo?: TipoDocumento;
  doc?: Partial<DatosDocumento>;
  config?: Record<string, unknown>;
  eps?: Record<string, unknown> | null;
  emp?: Record<string, unknown> | null;
  textoArl?: string | null;
  guardarFalla?: boolean;
  repoFalla?: boolean;
}

function montar(o: Opciones = {}) {
  let almacenado = datosDoc(o.tipo ?? TipoDocumento.CERTIFICADO_EPS, o.doc);
  const auditoria: RegistroAuditoria[] = [];
  const avisos: unknown[] = [];
  const atomicas = operacionesAtomicasEnMemoria(() => almacenado, (d) => { almacenado = d; });
  const documentos = {
    buscarPorId: () => (o.repoFalla ? Promise.reject(new Error('BD caída')) : Promise.resolve(Documento.desde(almacenado))),
    ...atomicas,
    guardarSiEstado: o.guardarFalla ? () => Promise.resolve(false) : atomicas.guardarSiEstado,
  };
  const valores = { ...ENCENDIDO, ...(o.config ?? {}) };
  const caso = new DecisionAutomaticaDocumentalUseCase(
    documentos as never,
    { buscarPorId: () => Promise.resolve({ estudianteId: 'est-1', empresaId: 'emp-1', fechaInicio: new Date('2026-02-15T00:00:00Z') }) } as never,
    { buscarPorId: () => Promise.resolve({ id: 'est-1', correo: 'estudiante@sintetico.example', nombre: NOMBRE, instantanea: () => ({ documento: DOC_ESTUDIANTE }) }) } as never,
    { get: (k: string) => valores[k] } as unknown as ConfigService,
    { registrar: (r: RegistroAuditoria) => { auditoria.push(r); return Promise.resolve(); } } as never,
    { buscarPorDocumento: () => Promise.resolve(o.eps === null ? null : validacionEps(o.eps ?? {})) } as never,
    { buscarPorDocumento: () => Promise.resolve(o.emp === null ? null : validacionEmp(o.emp ?? {})) } as never,
    { buscarPorId: () => Promise.resolve({ nit: { numero: '901458772' } }) } as never,
    { leer: () => Promise.resolve(Buffer.from('%PDF')) } as never,
    { extraerTextoNativo: () => (o.textoArl ? Promise.resolve({ paginas: 1, porPagina: [{ pagina: 1, texto: o.textoArl }] }) : Promise.reject(new Error('sin texto'))) } as never,
    { notificar: (...a: unknown[]) => { avisos.push(a); return Promise.resolve(); } } as never,
  );
  return { caso, actual: () => almacenado, auditoria, avisos };
}

const CERT_ARL = `ADMINISTRADORA DE RIESGOS LABORALES POSITIVA. CERTIFICADO DE AFILIACION AL SISTEMA GENERAL DE RIESGOS LABORALES.
  El trabajador identificado con C.C. 1.000.000.001 se encuentra afiliado. Empleador NIT 901458772-2. Clase de riesgo I.
  Fecha de afiliacion: 01/02/2026. Estado de la afiliacion: ACTIVA.`;

describe('Decisión automática · interruptores y ambiente', () => {
  it('38. con los interruptores apagados el documento queda como estaba (comportamiento anterior), sin auditoría', async () => {
    const { caso, actual, auditoria } = montar({ config: { AUTO_DECISION_DOCUMENTAL_HABILITADA: 'false' } });
    expect(await caso.evaluar('doc-1')).toBeNull();
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    expect(auditoria).toHaveLength(0);
  });

  it('40. fuera de dev no actúa aunque la configuración llegara encendida', async () => {
    for (const ambiente of ['qa', 'pre', 'prod', undefined]) {
      const { caso, actual } = montar({ config: { SIPRA_AMBIENTE: ambiente } });
      expect(await caso.evaluar('doc-1')).toBeNull();
      expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    }
  });

  it('general encendido pero aprobación de EPS apagada → queda en revisión y se audita la propuesta', async () => {
    const { caso, actual, auditoria } = montar({ config: { AUTO_APROBACION_EPS: 'false' } });
    expect(await caso.evaluar('doc-1')).toMatchObject({ resultado: 'revision' });
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
    expect(auditoria[0].metadatos).toMatchObject({ resultado: 'revision', resultadoPropuesto: 'auto_aprobar' });
  });
});

describe('Decisión automática · aplicación', () => {
  it('EPS por ruta ADRES → AUTO_APROBADO, auditado una vez', async () => {
    const { caso, actual, auditoria, avisos } = montar();
    expect(await caso.evaluar('doc-1')).toMatchObject({ resultado: 'auto_aprobar' });
    expect(actual().estado).toBe(EstadoDocumento.AUTO_APROBADO);
    expect(actual().decididoPor).toBeNull();
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ accion: AccionAuditada.DECISION_AUTOMATICA_DOCUMENTO, actorRol: 'sistema', entidadId: 'doc-1' });
    expect(auditoria[0].metadatos).toMatchObject({ resultado: 'auto_aprobado', politica: 'eps', verificacionOficial: true, rescateIa: false });
    expect(avisos).toHaveLength(0);
  });

  it('EPS documento incorrecto → AUTO_DEVUELTO con mensaje genérico; aviso al estudiante una vez', async () => {
    const { caso, actual, auditoria, avisos } = montar({ eps: { datosExtraidos: { tipoDocumentoDetectado: 'documento_incorrecto', motivosClasificacion: ['subtipo_desprendible_nomina'] } } });
    expect(await caso.evaluar('doc-1')).toMatchObject({ resultado: 'auto_devolver', tipoDevolucion: 'documento_incorrecto' });
    expect(actual().estado).toBe(EstadoDocumento.AUTO_DEVUELTO);
    expect(actual().motivoDevolucion).toBe('Este archivo no corresponde al certificado de afiliación a EPS. Cargue el certificado de afiliación a EPS correcto.');
    expect(auditoria[0].metadatos).toMatchObject({ resultado: 'auto_devuelto', tipoDevolucion: 'documento_incorrecto' });
    expect((auditoria[0].metadatos as { motivos: string[] }).motivos).toEqual(['tipo_documento_incorrecto', 'subtipo_desprendible_nomina']);
    expect(avisos).toHaveLength(1);
  });

  it('6. nombre leído solo por IA y distinto de SIPRA → revisión (caso real observado)', async () => {
    const { caso, actual } = montar({
      eps: { coincidencia: CoincidenciaEps.DISCREPANCIA, discrepancias: [{ campo: 'nombre', comparacion: 'certificado_vs_interno' }] },
      doc: { extraccion: { campos: {}, rescateIa: { invocado: true, fuentesFinales: { nombre_afiliado: 'ia_rescate', documento_afiliado: 'texto_nativo' } } } },
    });
    expect(await caso.evaluar('doc-1')).toMatchObject({ resultado: 'revision' });
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
  });

  it('RUT y Cámara consistentes → AUTO_APROBADO; ARL corroborado localmente → AUTO_APROBADO', async () => {
    const rut = montar({ tipo: TipoDocumento.RUT_NATURAL });
    await rut.caso.evaluar('doc-1');
    expect(rut.actual().estado).toBe(EstadoDocumento.AUTO_APROBADO);
    const camara = montar({ tipo: TipoDocumento.CAMARA_COMERCIO, emp: { tipoDetectado: C.CAMARA_EXISTENCIA_REPRESENTACION } });
    await camara.caso.evaluar('doc-1');
    expect(camara.actual().estado).toBe(EstadoDocumento.AUTO_APROBADO);
    expect(camara.auditoria[0].metadatos).toMatchObject({ verificacionOficial: false });
    expect((camara.auditoria[0].metadatos as { motivos: string[] }).motivos).toContain('sin_verificacion_rues');
    const arl = montar({ tipo: TipoDocumento.CERTIFICADO_ARL, textoArl: CERT_ARL });
    await arl.caso.evaluar('doc-1');
    expect(arl.actual().estado).toBe(EstadoDocumento.AUTO_APROBADO);
  });

  it('ARL sin texto nativo (escaneado) → revisión', async () => {
    const { caso, actual } = montar({ tipo: TipoDocumento.CERTIFICADO_ARL, textoArl: null });
    expect(await caso.evaluar('doc-1')).toMatchObject({ resultado: 'revision', motivos: ['clasificacion_no_determinable'] });
    expect(actual().estado).toBe(EstadoDocumento.EN_REVISION);
  });

  it('un tipo sin motor (p. ej. carta de aceptación) no se toca', async () => {
    const { caso, auditoria } = montar({ tipo: TipoDocumento.CARTA_ACEPTACION });
    expect(await caso.evaluar('doc-1')).toBeNull();
    expect(auditoria).toHaveLength(0);
  });
});

describe('Decisión automática · idempotencia y respeto a las personas', () => {
  it('36/37. decisión idempotente: un documento ya decidido por el motor no se vuelve a decidir ni a auditar', async () => {
    const { caso, auditoria, avisos } = montar({ eps: { datosExtraidos: { tipoDocumentoDetectado: 'documento_incorrecto' } } });
    await caso.evaluar('doc-1');
    expect(await caso.evaluar('doc-1')).toBeNull();
    expect(await caso.evaluar('doc-1')).toBeNull();
    expect(auditoria).toHaveLength(1);
    expect(avisos).toHaveLength(1);
  });

  it('37. un documento decidido por una persona, ilegible o ya aprobado no se decide', async () => {
    for (const estado of [EstadoDocumento.APROBADO, EstadoDocumento.DEVUELTO, EstadoDocumento.RECHAZADO, EstadoDocumento.ILEGIBLE, EstadoDocumento.AUTO_APROBADO]) {
      const { caso, actual } = montar({ doc: { estado } });
      expect(await caso.evaluar('doc-1')).toBeNull();
      expect(actual().estado).toBe(estado);
    }
  });

  it('una validación decidida o reservada por una persona no se pisa', async () => {
    const decidida = montar({ eps: { decision: 'aprobado_manual' } });
    expect(await decidida.caso.evaluar('doc-1')).toBeNull();
    const reservada = montar({ eps: { asignadoA: 'funcionario-1', reservaHasta: new Date(Date.now() + 600_000) } });
    expect(await reservada.caso.evaluar('doc-1')).toBeNull();
    expect(reservada.actual().estado).toBe(EstadoDocumento.EN_REVISION);
    const empReservada = montar({ tipo: TipoDocumento.RUT_NATURAL, emp: { asignadoA: 'funcionario-1', reservaHasta: new Date(Date.now() + 600_000) } });
    expect(await empReservada.caso.evaluar('doc-1')).toBeNull();
  });

  it('si otra decisión llegó en medio (guardado condicional falla) no se audita lo que no se aplicó', async () => {
    const { caso, auditoria } = montar({ guardarFalla: true });
    expect(await caso.evaluar('doc-1')).toBeNull();
    expect(auditoria).toHaveLength(0);
  });

  it('nunca lanza: un fallo del repositorio deja el documento en revisión', async () => {
    const { caso } = montar({ repoFalla: true });
    await expect(caso.evaluar('doc-1')).resolves.toBeNull();
  });
});

describe('Decisión automática · estado y privacidad', () => {
  it('33. el motor nunca produce RECHAZADO', async () => {
    const escenarios: Opciones[] = [
      {}, { eps: { vigenciaCertificado: 'vencido' } }, { eps: { datosExtraidos: { tipoDocumentoDetectado: 'documento_incorrecto' } } },
      { eps: { afiliacion: AfiliacionEps.INACTIVA } }, { tipo: TipoDocumento.RUT_NATURAL, emp: { tipoDetectado: C.DOCUMENTO_INCORRECTO } },
    ];
    for (const e of escenarios) {
      const { caso, actual } = montar(e);
      await caso.evaluar('doc-1');
      expect([EstadoDocumento.AUTO_APROBADO, EstadoDocumento.AUTO_DEVUELTO, EstadoDocumento.EN_REVISION]).toContain(actual().estado);
      expect(actual().estado).not.toBe(EstadoDocumento.RECHAZADO);
    }
  });

  it('34. auto-devuelto permite cargar una nueva versión: no es una decisión humana y abre subsanación', async () => {
    const { caso, actual } = montar({ tipo: TipoDocumento.RUT_NATURAL, emp: { tipoDetectado: C.DOCUMENTO_INCORRECTO } });
    await caso.evaluar('doc-1');
    const d = actual();
    expect(d.estado).toBe(EstadoDocumento.AUTO_DEVUELTO);
    expect(ESTADOS_DECIDIDOS).not.toContain(EstadoDocumento.AUTO_DEVUELTO);
    expect(Documento.desde(d).estaDecidido).toBe(false);
    const subs = subsanacionesVigentes([{ tipo: d.tipo, version: 1, estado: d.estado, actualizadoEn: new Date() }], [], 10, new Date());
    expect(subs.map((s) => s.tipo)).toEqual([TipoDocumento.RUT_NATURAL]);
    expect(estadoRutParaEstudiante({ documento: { estado: d.estado, motivoDevolucion: d.motivoDevolucion }, validacion: { estado: EstadoValidacionDocumentoEmpresarial.REVISION, motivoDecision: null } }))
      .toMatchObject({ estado: 'necesita_correccion', puedeReenviar: true });
    expect(faseEmpresarial(EstadoDocumento.AUTO_DEVUELTO, null)).toBe('devuelto');
  });

  it('auto-aprobado se ve como aprobado en la fase común aunque la validación del motor siga abierta', () => {
    expect(faseEmpresarial(EstadoDocumento.AUTO_APROBADO, { estado: EstadoValidacionDocumentoEmpresarial.REVISION } as never)).toBe('aprobado');
    expect(faseEps(EstadoDocumento.AUTO_APROBADO, { decision: 'pendiente', estadoProcesamiento: EstadoProcesamientoEps.PROCESADO } as never)).toBe('aprobado');
  });

  it('35. la auditoría no contiene datos personales ni valores del documento', async () => {
    const { caso, auditoria } = montar({ tipo: TipoDocumento.CERTIFICADO_ARL, textoArl: CERT_ARL });
    await caso.evaluar('doc-1');
    const texto = JSON.stringify(auditoria);
    for (const prohibido of [DOC_ESTUDIANTE, '1.000.000.001', NOMBRE, '901458772', 'POSITIVA', '2026-02-01', '01/02/2026']) expect(texto).not.toContain(prohibido);
    expect(Object.keys(auditoria[0].metadatos ?? {}).sort()).toEqual([
      'documentoId', 'fuentesCriticas', 'motivos', 'politica', 'rescateIa', 'resultado', 'resultadoPropuesto', 'tipo', 'verificacionOficial',
    ]);
  });
});
