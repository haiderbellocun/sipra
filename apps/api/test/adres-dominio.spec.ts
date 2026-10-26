import { EstadoAdres, RecomendacionEps, adresInicial } from '../src/domain/entities/adres';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, ConsultaAdresInvalidaError, DatosExtraidosEps, DecisionEps, EstadoProcesamientoEps,
  ValidacionEps, ValidacionEpsYaDecididaError,
} from '../src/domain/entities/validacion-eps.entity';
import {
  afiliacionDeEstadoAdres, compararTriple, evaluarResultadoAdres, extraerDatosAdres, recomendarEps,
} from '../src/domain/services/adres-resultado.domain-service';

/**
 * Lectura del resultado de ADRES, contraste triple, recomendación y estado de la
 * consulta en la validación. Dominio puro. Todos los textos son sintéticos.
 */

const TEXTO_CAMPOS = [
  'ADRES - Administradora de los Recursos del Sistema General de Seguridad Social en Salud',
  'Consulta de afiliados a la BDUA',
  'Tipo de documento: CC',
  'Número de documento: 1032456786',
  'Nombres: LAURA SOFIA',
  'Apellidos: RAMIREZ ORTIZ',
  'Entidad: EPS SINTETICA',
  'Régimen: CONTRIBUTIVO',
  'Estado de afiliación: ACTIVO',
  'Fecha de afiliación: 05/02/2024',
  'Fecha de consulta: 26/10/2026',
  'Fecha de corte: 30/09/2026',
].join('\n');

/** Como salen los PDF de tablas: la etiqueta y el valor en líneas distintas. */
const TEXTO_TABLA = [
  'ADRES', 'BDUA', 'TIPO DE IDENTIFICACION', 'CC', 'NUMERO DE IDENTIFICACION', '1032456786', 'NOMBRES', 'LAURA SOFIA',
  'APELLIDOS', 'RAMIREZ ORTIZ', 'ENTIDAD', 'EPS SINTETICA', 'REGIMEN', 'SUBSIDIADO', 'ESTADO DE AFILIACION', 'ACTIVO',
  'FECHA DE AFILIACION EFECTIVA', '2024-02-05',
].join('\n');

describe('Lectura del resultado de ADRES', () => {
  it('lee los campos de un resultado «etiqueta: valor» y no confunde fecha de consulta con fecha de corte', () => {
    const l = extraerDatosAdres(TEXTO_CAMPOS);
    expect(l.pareceResultadoAdres).toBe(true);
    expect(l.datos).toEqual({
      tipoDocumento: 'CC', numeroDocumento: '1032456786', nombre: 'LAURA SOFIA RAMIREZ ORTIZ', eps: 'EPS SINTETICA',
      regimen: 'CONTRIBUTIVO', estadoAfiliacion: 'ACTIVO', fechaAfiliacion: '2024-02-05', fechaFinalizacion: null,
      fechaConsulta: '2026-10-26', fuenteActualizadaEn: '2026-09-30',
    });
    expect(l.datos.fechaConsulta).not.toBe(l.datos.fuenteActualizadaEn);
  });

  it('lee también la forma de tabla (etiqueta sola y valor en la línea siguiente)', () => {
    const d = extraerDatosAdres(TEXTO_TABLA).datos;
    expect(d).toMatchObject({ tipoDocumento: 'CC', numeroDocumento: '1032456786', nombre: 'LAURA SOFIA RAMIREZ ORTIZ', eps: 'EPS SINTETICA', regimen: 'SUBSIDIADO', estadoAfiliacion: 'ACTIVO', fechaAfiliacion: '2024-02-05' });
  });

  it('una etiqueta no se toma como valor de otra', () => {
    const d = extraerDatosAdres('ADRES\nENTIDAD\nREGIMEN\nCONTRIBUTIVO\nESTADO\nACTIVO').datos;
    expect(d.eps).toBeNull();
    expect(d.regimen).toBe('CONTRIBUTIVO');
  });

  it('lo que no está es null: no se inventa (ni estado, ni documento, ni fechas)', () => {
    const l = extraerDatosAdres('ADRES\nResultado de la consulta\nSin información adicional.');
    expect(l.pareceResultadoAdres).toBe(true);
    expect(Object.values(l.datos).every((v) => v === null)).toBe(true);
    expect(l.camposLeidos).toEqual([]);
  });

  it('un texto que no se presenta como ADRES/BDUA no es un resultado de ADRES', () => {
    const l = extraerDatosAdres('Certificado de afiliación\nNombre: ANA PEREZ\nEstado: ACTIVO');
    expect(l.pareceResultadoAdres).toBe(false);
  });

  it('los nombres con tildes y el documento con separadores se leen y normalizan', () => {
    const d = extraerDatosAdres('ADRES\nNombres: MARÍA JOSÉ\nApellidos: NÚÑEZ PEÑA\nNúmero de identificación: 52.123.456').datos;
    expect(d.nombre).toBe('MARÍA JOSÉ NÚÑEZ PEÑA');
    expect(d.numeroDocumento).toBe('52123456');
  });
});

describe('Estado de afiliación según ADRES', () => {
  it.each([
    ['ACTIVO', AfiliacionEps.ACTIVA], ['VIGENTE', AfiliacionEps.ACTIVA], ['Afiliado activo', AfiliacionEps.ACTIVA],
    ['NO VIGENTE', AfiliacionEps.INACTIVA], ['RETIRADO', AfiliacionEps.INACTIVA], ['SUSPENDIDO', AfiliacionEps.INACTIVA],
    ['INACTIVO', AfiliacionEps.INACTIVA], ['AFILIADO FALLECIDO', AfiliacionEps.INACTIVA], ['CANCELADA', AfiliacionEps.INACTIVA],
    ['', AfiliacionEps.NO_DETERMINABLE], ['EN PROCESO', AfiliacionEps.NO_DETERMINABLE], ['ACTIVO RETIRADO', AfiliacionEps.NO_DETERMINABLE],
  ])('«%s» → %s', (estado, esperado) => {
    expect(afiliacionDeEstadoAdres(estado)).toBe(esperado);
  });

  it('la ausencia de estado nunca se interpreta (ni como activa ni como inactiva)', () => {
    expect(afiliacionDeEstadoAdres(null)).toBe(AfiliacionEps.NO_DETERMINABLE);
    expect(afiliacionDeEstadoAdres(undefined)).toBe(AfiliacionEps.NO_DETERMINABLE);
  });
});

// ── Contraste triple y recomendación ────────────────────────────────────────

const SIPRA = { tipoDocumento: 'CC', numeroDocumento: '1032456786', nombre: 'Laura Sofía Ramírez Ortiz' };
const CERTIFICADO: DatosExtraidosEps = {
  tipoDocumento: 'CC', numeroDocumento: '1032456786', nombre: 'LAURA SOFIA RAMIREZ ORTIZ', eps: 'EPS Sintetica S.A.', epsClave: 'SINTETICA',
  regimen: 'contributivo', tipoAfiliado: 'beneficiario', estadoReportadoCertificado: 'ACTIVO', fechaExpedicion: '2026-10-20',
};
const datos = (cambio: Partial<ReturnType<typeof extraerDatosAdres>['datos']> = {}) => ({ ...extraerDatosAdres(TEXTO_CAMPOS).datos, ...cambio });
const evaluar = (d = datos(), extra: Record<string, unknown> = {}) => evaluarResultadoAdres({
  datos: d, sipra: SIPRA, certificado: CERTIFICADO, autenticidad: AutenticidadEps.NO_EVALUADA, coincidenciaCertificado: CoincidenciaEps.COINCIDE,
  vigencia: 'vigente', hayBanderaCritica: false, ...extra,
});

describe('Comparación triple SIPRA / certificado / ADRES', () => {
  it('todo coincide: cada campo dice quién coincide con quién', () => {
    const c = compararTriple(datos(), SIPRA, CERTIFICADO);
    const por = Object.fromEntries(c.map((x) => [x.campo, x]));
    expect(por.numero_documento).toMatchObject({ sipra: '1032456786', certificado: '1032456786', adres: '1032456786', resultado: 'coincide', critico: false });
    expect(por.eps).toMatchObject({ certificado: 'EPS Sintetica S.A.', adres: 'EPS SINTETICA', resultado: 'coincide' });
    expect(c.every((x) => x.resultado !== 'diferente')).toBe(true);
  });

  it('EPS distinta: diferente y CRÍTICA', () => {
    const c = compararTriple(datos({ eps: 'OTRA ENTIDAD' }), SIPRA, CERTIFICADO).find((x) => x.campo === 'eps')!;
    expect(c).toMatchObject({ resultado: 'diferente', critico: true, conflictos: ['certificado_vs_adres'] });
  });

  it('régimen distinto: se señala pero no es crítico', () => {
    const c = compararTriple(datos({ regimen: 'SUBSIDIADO' }), SIPRA, CERTIFICADO).find((x) => x.campo === 'regimen')!;
    expect(c).toMatchObject({ resultado: 'diferente', critico: false });
  });

  it('documento y nombre distintos respecto de SIPRA: críticos', () => {
    const c = compararTriple(datos({ numeroDocumento: '999888777', nombre: 'CARLOS PEREZ GOMEZ' }), SIPRA, CERTIFICADO);
    expect(c.find((x) => x.campo === 'numero_documento')).toMatchObject({ resultado: 'diferente', critico: true });
    expect(c.find((x) => x.campo === 'nombre')).toMatchObject({ resultado: 'diferente', critico: true });
  });

  it('la EPS solo es la misma por clave canónica o alias aprobado, no por parecido', () => {
    const sin = compararTriple(datos({ eps: 'Sintetica Salud' }), SIPRA, CERTIFICADO).find((x) => x.campo === 'eps')!;
    expect(sin.resultado).toBe('diferente');
    const con = compararTriple(datos({ eps: 'Sintetica Salud' }), SIPRA, CERTIFICADO, { 'SINTETICA SALUD': 'SINTETICA' }).find((x) => x.campo === 'eps')!;
    expect(con.resultado).toBe('coincide');
  });

  it('lo que ADRES no trae es «no_disponible», no discrepancia', () => {
    const c = compararTriple(datos({ eps: null }), SIPRA, CERTIFICADO).find((x) => x.campo === 'eps')!;
    expect(c).toMatchObject({ resultado: 'no_disponible', critico: false });
  });
});

describe('Evaluación del resultado ADRES', () => {
  it('vigente: procesado, afiliación activa', () => {
    expect(evaluar()).toMatchObject({ estado: EstadoAdres.PROCESADO, error: null, afiliacion: AfiliacionEps.ACTIVA });
  });

  it('no vigente: procesado, afiliación inactiva', () => {
    expect(evaluar(datos({ estadoAfiliacion: 'NO VIGENTE' }))).toMatchObject({ estado: EstadoAdres.PROCESADO, afiliacion: AfiliacionEps.INACTIVA });
  });

  it('resultado sin estado: no determinable (la afiliación NO se infiere por ausencia)', () => {
    expect(evaluar(datos({ estadoAfiliacion: null }))).toMatchObject({
      estado: EstadoAdres.NO_DETERMINABLE, afiliacion: AfiliacionEps.NO_DETERMINABLE, recomendacion: RecomendacionEps.INFORMACION_INSUFICIENTE,
    });
  });

  it.each([
    ['documento distinto', { numeroDocumento: '999888777' }, 'documento_no_corresponde'],
    ['sin documento en el resultado', { numeroDocumento: null }, 'sin_documento_en_resultado'],
    ['tipo de documento distinto', { tipoDocumento: 'TI' }, 'tipo_documento_no_corresponde'],
    ['nombre distinto', { nombre: 'CARLOS PEREZ GOMEZ' }, 'nombre_no_corresponde'],
  ])('%s: NO queda atado al estudiante, no actualiza la afiliación', (_c, cambio, error) => {
    const r = evaluar(datos(cambio));
    expect(r).toMatchObject({ estado: EstadoAdres.NO_DETERMINABLE, error, afiliacion: null });
  });

  it('documento distinto: recomendación = discrepancia crítica', () => {
    expect(evaluar(datos({ numeroDocumento: '999888777' })).recomendacion).toBe(RecomendacionEps.DISCREPANCIA_CRITICA);
  });
});

describe('Recomendación determinística (nunca aprueba)', () => {
  const base = {
    afiliacion: AfiliacionEps.ACTIVA, autenticidad: AutenticidadEps.VERIFICADA, coincidenciaCertificado: CoincidenciaEps.COINCIDE,
    vigencia: 'vigente' as const, hayBanderaCritica: false, hayDiscrepanciaCritica: false,
  };

  it('CASO A: autenticidad verificada + datos coinciden + ADRES activa + vigencia → candidato', () => {
    expect(recomendarEps(base)).toBe(RecomendacionEps.CANDIDATO_AUTOAPROBACION);
  });

  it('CASO B: autenticidad no verificable + ADRES activa + certificado coincide → revisión documental', () => {
    for (const autenticidad of [AutenticidadEps.NO_VERIFICABLE, AutenticidadEps.NO_EVALUADA]) {
      expect(recomendarEps({ ...base, autenticidad })).toBe(RecomendacionEps.REVISION_DOCUMENTAL);
    }
  });

  it('CASO C: ADRES inactiva → revisión/rechazo; certificado inválido también', () => {
    expect(recomendarEps({ ...base, afiliacion: AfiliacionEps.INACTIVA })).toBe(RecomendacionEps.REVISION_RECHAZO);
    expect(recomendarEps({ ...base, autenticidad: AutenticidadEps.INVALIDA })).toBe(RecomendacionEps.REVISION_RECHAZO);
  });

  it('CASO D: una discrepancia crítica manda sobre todo lo demás', () => {
    expect(recomendarEps({ ...base, hayDiscrepanciaCritica: true })).toBe(RecomendacionEps.DISCREPANCIA_CRITICA);
    expect(recomendarEps({ ...base, afiliacion: AfiliacionEps.INACTIVA, hayDiscrepanciaCritica: true })).toBe(RecomendacionEps.DISCREPANCIA_CRITICA);
  });

  it('certificado vencido, con bandera crítica o que no coincide: no es candidato aunque ADRES esté activa', () => {
    expect(recomendarEps({ ...base, vigencia: 'vencido' })).toBe(RecomendacionEps.REVISION_DOCUMENTAL);
    expect(recomendarEps({ ...base, hayBanderaCritica: true })).toBe(RecomendacionEps.REVISION_DOCUMENTAL);
    expect(recomendarEps({ ...base, coincidenciaCertificado: CoincidenciaEps.INSUFICIENTE })).toBe(RecomendacionEps.REVISION_DOCUMENTAL);
  });

  it('sin afiliación interpretable: información insuficiente', () => {
    expect(recomendarEps({ ...base, afiliacion: AfiliacionEps.NO_DETERMINABLE })).toBe(RecomendacionEps.INFORMACION_INSUFICIENTE);
  });

  it('ADRES NO cambia la autenticidad: «ADRES activa + autenticidad no verificable» sigue siendo revisión documental', () => {
    const r = evaluar(datos(), { autenticidad: AutenticidadEps.NO_VERIFICABLE });
    expect(r.recomendacion).toBe(RecomendacionEps.REVISION_DOCUMENTAL);
  });
});

// ── Estado de la consulta en la validación ──────────────────────────────────

const AHORA = new Date('2026-10-26T15:00:00Z');
const MIN = 60_000;

function procesada(): ValidacionEps {
  const v = ValidacionEps.pendiente({ id: 'v-1', documentoId: 'd-1', practicaId: 'p-1', estudianteId: 'e-1', ahora: AHORA });
  v.registrarProcesamiento({ datosExtraidos: CERTIFICADO, coincidencia: CoincidenciaEps.COINCIDE, discrepancias: [], vigencia: 'vigente', hayBanderaCritica: false }, AHORA);
  return v;
}
const preparar = (v: ValidacionEps, actor = 'aux-1', consultaId = 'c-1') => v.prepararConsultaAdres({
  consultaId, actorId: actor, ahora: AHORA, venceEn: new Date(AHORA.getTime() + 30 * MIN), tipoDocumento: 'CC',
  origenTipoDocumento: 'confirmacion_humana', confirmadoPor: actor,
});
const evidencia = (v: ValidacionEps) => v.recibirEvidenciaAdres({ hash: 'a'.repeat(64), referenciaArchivo: 'evidencias/adres/v-1/x.pdf', actorId: 'aux-1', ahora: AHORA, consultadoEn: null });
const resultado = (v: ValidacionEps, e = evaluar()) => v.registrarResultadoAdres({
  estado: e.estado, error: e.error, datos: datos(), comparacion: e.comparacion, afiliacion: e.afiliacion, recomendacion: e.recomendacion,
  consultadoEn: new Date('2026-10-26T12:00:00Z'), fuenteActualizadaEn: new Date('2026-09-30T12:00:00Z'),
}, AHORA);

describe('Estado ADRES de la validación', () => {
  it('nace «no_requerido»; al procesarse con la afiliación sin contrastar pasa a «pendiente»', () => {
    const v = ValidacionEps.pendiente({ id: 'v', documentoId: 'd', practicaId: 'p', estudianteId: 'e', ahora: AHORA });
    expect(v.adresEstado).toBe(EstadoAdres.NO_REQUERIDO);
    expect(v.adresInstantanea()).toEqual(adresInicial());
    const p = procesada();
    expect(p.estadoProcesamiento).toBe(EstadoProcesamientoEps.PROCESADO);
    expect(p.afiliacion).toBe(AfiliacionEps.NO_CONTRASTADA);
    expect(p.adresEstado).toBe(EstadoAdres.PENDIENTE);
  });

  it('flujo completo: pendiente → en_consulta → evidencia_recibida → procesado', () => {
    const v = procesada();
    preparar(v);
    expect(v.adresEstado).toBe(EstadoAdres.EN_CONSULTA);
    evidencia(v);
    expect(v.adresEstado).toBe(EstadoAdres.EVIDENCIA_RECIBIDA);
    resultado(v);
    expect(v.adresEstado).toBe(EstadoAdres.PROCESADO);
  });

  it('el estado ADRES NO se mezcla con autenticidad, coincidencia, afiliación ni decisión', () => {
    const v = procesada();
    preparar(v);
    evidencia(v);
    expect(v).toMatchObject({ autenticidad: AutenticidadEps.NO_EVALUADA, coincidencia: CoincidenciaEps.COINCIDE, afiliacion: AfiliacionEps.NO_CONTRASTADA, decision: DecisionEps.PENDIENTE });
  });

  it('ADRES activa actualiza SOLO la afiliación (fuente adres_bdua) y NO la autenticidad', () => {
    const v = procesada();
    preparar(v); evidencia(v); resultado(v);
    expect(v.afiliacion).toBe(AfiliacionEps.ACTIVA);
    expect(v.instantanea().afiliacionFuente).toBe('adres_bdua');
    expect(v.autenticidad).toBe(AutenticidadEps.NO_EVALUADA);
    expect(v.decision).toBe(DecisionEps.PENDIENTE); // sin autenticidad verificada no hay candidatura
    expect(v.adresInstantanea().recomendacion).toBe(RecomendacionEps.REVISION_DOCUMENTAL);
  });

  it('con autenticidad verificada por una fuente oficial + ADRES activa → candidato (solo etiqueta)', () => {
    const v = procesada();
    v.registrarVerificacionOficial({
      verificador: 'v', autenticidad: AutenticidadEps.VERIFICADA, ruta: v.ruta, datosVerificados: null, discrepancias: [],
    }, AHORA);
    preparar(v); evidencia(v);
    resultado(v, evaluar(datos(), { autenticidad: AutenticidadEps.VERIFICADA }));
    expect(v.decision).toBe(DecisionEps.CANDIDATO_AUTOAPROBACION);
    expect(v.adresInstantanea().recomendacion).toBe(RecomendacionEps.CANDIDATO_AUTOAPROBACION);
  });

  it('ADRES inactiva: afiliación inactiva, no candidato', () => {
    const v = procesada();
    preparar(v); evidencia(v); resultado(v, evaluar(datos({ estadoAfiliacion: 'RETIRADO' })));
    expect(v.afiliacion).toBe(AfiliacionEps.INACTIVA);
    expect(v.decision).toBe(DecisionEps.PENDIENTE);
  });

  it('un resultado que no se puede atar al estudiante no toca la afiliación', () => {
    const v = procesada();
    preparar(v); evidencia(v); resultado(v, evaluar(datos({ numeroDocumento: '999888777' })));
    expect(v.afiliacion).toBe(AfiliacionEps.NO_CONTRASTADA);
    expect(v.adresEstado).toBe(EstadoAdres.NO_DETERMINABLE);
  });

  it('guarda por separado cuándo se consultó y hasta cuándo estaba actualizada la fuente', () => {
    const v = procesada();
    preparar(v); evidencia(v); resultado(v);
    const a = v.adresInstantanea();
    expect(a.consultadoEn?.toISOString()).toBe('2026-10-26T12:00:00.000Z');
    expect(a.fuenteActualizadaEn?.toISOString()).toBe('2026-09-30T12:00:00.000Z');
    expect(a.cargadaEn).toEqual(AHORA);
    expect(a.consultadoEn).not.toEqual(a.fuenteActualizadaEn);
  });

  it('el identificador de la consulta es de UN SOLO USO, de quien la preparó y vence', () => {
    const v = procesada();
    preparar(v);
    expect(v.consultaAdresVigente('c-1', 'aux-1', AHORA)).toBe(true);
    expect(v.consultaAdresVigente('c-1', 'aux-2', AHORA)).toBe(false); // otra persona
    expect(v.consultaAdresVigente('otro', 'aux-1', AHORA)).toBe(false); // otro identificador
    expect(v.consultaAdresVigente('c-1', 'aux-1', new Date(AHORA.getTime() + 31 * MIN))).toBe(false); // vencida
    evidencia(v);
    expect(v.consultaAdresVigente('c-1', 'aux-1', AHORA)).toBe(false); // consumida
    expect(v.adresInstantanea().consultaId).toBeNull();
  });

  it('una nueva preparación reemplaza al identificador anterior', () => {
    const v = procesada();
    preparar(v, 'aux-1', 'c-1');
    preparar(v, 'aux-1', 'c-2');
    expect(v.consultaAdresVigente('c-1', 'aux-1', AHORA)).toBe(false);
    expect(v.consultaAdresVigente('c-2', 'aux-1', AHORA)).toBe(true);
  });

  it('error al procesar: se puede preparar otra consulta y cargar otro resultado', () => {
    const v = procesada();
    preparar(v); evidencia(v);
    v.marcarErrorAdres('pdf_ilegible', AHORA);
    expect(v.adresEstado).toBe(EstadoAdres.ERROR);
    preparar(v, 'aux-1', 'c-2');
    expect(v.adresEstado).toBe(EstadoAdres.EN_CONSULTA);
  });

  it('transiciones inválidas se rechazan', () => {
    const v = procesada();
    expect(() => evidencia(v)).toThrow(ConsultaAdresInvalidaError); // sin consulta preparada
    expect(() => resultado(v)).toThrow(ConsultaAdresInvalidaError); // sin evidencia
    const sin = ValidacionEps.pendiente({ id: 'v', documentoId: 'd', practicaId: 'p', estudianteId: 'e', ahora: AHORA });
    expect(() => preparar(sin)).toThrow(ConsultaAdresInvalidaError); // no requerida
  });

  it('un caso decidido por una persona no admite más movimientos ADRES', () => {
    const v = procesada();
    v.registrarDecisionHumana(DecisionEps.APROBADO_MANUAL, 'aux-1', AHORA);
    expect(() => preparar(v)).toThrow(ValidacionEpsYaDecididaError);
  });

  it('una afiliación establecida por una fuente oficial no requiere ADRES', () => {
    const v = procesada();
    v.registrarVerificacionOficial({
      verificador: 'v', autenticidad: AutenticidadEps.VERIFICADA, afiliacion: AfiliacionEps.ACTIVA, ruta: v.ruta, datosVerificados: null, discrepancias: [],
    }, AHORA);
    expect(v.instantanea().afiliacionFuente).toBe('verificador_oficial');
    expect(v.adresEstado).toBe(EstadoAdres.NO_REQUERIDO);
    expect(() => preparar(v)).toThrow(ConsultaAdresInvalidaError);
  });

  it('la instantánea es una copia: modificarla no altera la validación', () => {
    const v = procesada();
    preparar(v); evidencia(v); resultado(v);
    const copia = v.instantanea();
    copia.adres.comparacion.length = 0;
    if (copia.adres.datos) copia.adres.datos.eps = 'X';
    expect(v.adresInstantanea().comparacion.length).toBeGreaterThan(0);
    expect(v.adresInstantanea().datos?.eps).toBe('EPS SINTETICA');
  });
});
