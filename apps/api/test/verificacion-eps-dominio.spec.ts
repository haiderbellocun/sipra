import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DecisionEps, EstadoProcesamientoEps, RutaValidacionEps, ValidacionEps,
  DatosExtraidosEps, DatosVerificadosEps,
} from '../src/domain/entities/validacion-eps.entity';
import { ResultadoVerificacionEps } from '../src/domain/ports/out/verificador-certificado-eps.port';
import { claveEps, mismaEps } from '../src/domain/services/normalizacion-identidad';
import {
  RegistroVerificadoresEps, VERIFICADORES_EPS_OFICIALES, VerificadorEpsDefinicion, VerificadorEpsInvalidoError,
} from '../src/domain/services/registro-verificadores-eps';
import {
  afiliacionDeFuente, aliasesAprobados, compararConFuenteOficial, concluirVerificacion,
} from '../src/domain/services/verificacion-eps.domain-service';
import { definicionPrueba } from './soporte-verificacion-eps';

/**
 * Registro de verificadores (allowlist), conclusiones de una verificación y
 * reglas de los ejes. Dominio puro: sin red.
 */

const HOST = 'verificador.eps-prueba.test';
const def = (extra: Partial<VerificadorEpsDefinicion> = {}) => definicionPrueba(443, { puertosPermitidos: undefined, ...extra });
const registro = (extra: Partial<VerificadorEpsDefinicion> = {}) => new RegistroVerificadoresEps([def(extra)]);

describe('Registro de verificadores · inventario real', () => {
  it('NO hay verificadores habilitados: ningún mecanismo oficial pudo confirmarse, y no se inventan', () => {
    expect(VERIFICADORES_EPS_OFICIALES).toEqual([]);
    const r = new RegistroVerificadoresEps(VERIFICADORES_EPS_OFICIALES);
    expect(r.vacio).toBe(true);
    // Con el inventario real, NINGÚN destino pasa.
    for (const u of ['https://www.adres.gov.co/x', 'https://nuevaeps.com.co/verificar/1', `https://${HOST}/verificar/1`]) {
      expect(r.resolver(u)).toEqual({ permitido: false, motivo: 'host_no_permitido' });
    }
  });
});

describe('Registro de verificadores · allowlist de destinos', () => {
  it('un host registrado, por https y en su ruta, se permite', () => {
    const r = registro().resolver(`https://${HOST}/verificar/ABC?token=1`);
    expect(r.permitido).toBe(true);
    if (r.permitido) expect(r.verificador.codigo).toBe('verificador_prueba');
  });

  it.each([
    ['host parecido (sufijo del atacante)', `https://${HOST}.atacante.test/verificar/1`, 'host_no_permitido'],
    ['host parecido (verificacion.eps-oficial.com.atacante.test)', 'https://verificacion.eps-oficial.com.atacante.test/verificar/1', 'host_no_permitido'],
    ['subdominio del registrado', `https://sub.${HOST}/verificar/1`, 'host_no_permitido'],
    ['host registrado como subdominio de otro', 'https://eps-prueba.test/verificar/1', 'host_no_permitido'],
    ['http', `http://${HOST}/verificar/1`, 'esquema_no_permitido'],
    ['ftp', `ftp://${HOST}/verificar/1`, 'esquema_no_permitido'],
    ['javascript:', 'javascript:alert(1)', 'esquema_no_permitido'],
    ['data:', 'data:text/html;base64,PGgxPg==', 'esquema_no_permitido'],
    ['file:', 'file:///etc/passwd', 'esquema_no_permitido'],
    ['usuario:clave', `https://usuario:clave@${HOST}/verificar/1`, 'credenciales_en_url'],
    ['solo usuario', `https://usuario@${HOST}/verificar/1`, 'credenciales_en_url'],
    ['truco de @ (el host real es el otro)', `https://${HOST}@atacante.test/verificar/1`, 'credenciales_en_url'],
    ['puerto no declarado', `https://${HOST}:8443/verificar/1`, 'puerto_no_permitido'],
    ['ruta fuera del prefijo', `https://${HOST}/admin`, 'ruta_no_permitida'],
    ['URL malformada', 'https://', 'url_invalida'],
    ['texto', 'AFILIADO-1032456786', 'url_invalida'],
    ['IP literal', 'https://127.0.0.1/verificar/1', 'host_no_permitido'],
    ['localhost', 'https://localhost/verificar/1', 'host_no_permitido'],
    ['metadata de la nube', 'https://metadata.google.internal/verificar/1', 'host_no_permitido'],
    ['169.254.169.254', 'https://169.254.169.254/verificar/1', 'host_no_permitido'],
  ])('%s → rechazado (%s)', (_c, url, motivo) => {
    expect(registro().resolver(url)).toEqual({ permitido: false, motivo });
  });

  it('mayúsculas en el host del QR no engañan: se compara el host normalizado', () => {
    expect(registro().resolver(`https://${HOST.toUpperCase()}/verificar/1`).permitido).toBe(true);
  });

  it('el puerto 443 explícito es el mismo que el implícito', () => {
    expect(registro().resolver(`https://${HOST}:443/verificar/1`).permitido).toBe(true);
  });

  it('un verificador que requiere interacción humana o credenciales NO se consulta automáticamente', () => {
    expect(RegistroVerificadoresEps.puedeConsultarse(def({ requiereInteraccionHumana: true }))).toBe(false);
    expect(RegistroVerificadoresEps.puedeConsultarse(def({ requiereCredenciales: true }))).toBe(false);
    expect(RegistroVerificadoresEps.puedeConsultarse(def())).toBe(true);
  });
});

describe('Registro de verificadores · validación de las altas', () => {
  it.each([
    ['sin hosts', { hostsPermitidos: [] }],
    ['host con mayúsculas', { hostsPermitidos: ['Verificador.eps.test'] }],
    ['comodín', { hostsPermitidos: ['*.eps.test'] }],
    ['IP', { hostsPermitidos: ['10.0.0.1'] }],
    ['localhost', { hostsPermitidos: ['localhost'] }],
    ['.internal', { hostsPermitidos: ['servicio.internal'] }],
    ['sin punto', { hostsPermitidos: ['servicio'] }],
    ['con ruta o esquema', { hostsPermitidos: ['https://a.eps.test'] }],
    ['puerto inválido', { puertosPermitidos: [0] }],
    ['demasiadas redirecciones', { maxRedirecciones: 5, hostsRedireccionPermitidos: ['otro.eps.test'] }],
    ['redirecciones sin destinos declarados', { maxRedirecciones: 1 }],
    ['sin Content-Type', { contentTypes: [] }],
    ['sin fuente oficial', { fuenteOficial: ' ' }],
    ['sin aprobación documentada', { aprobadoPor: '' }],
    ['no establece nada', { autenticaCertificado: false, confirmaAfiliacion: false }],
    ['código inválido', { codigo: 'Mal Código' }],
  ])('rechaza el alta: %s', (_c, extra) => {
    expect(() => registro(extra as Partial<VerificadorEpsDefinicion>)).toThrow(VerificadorEpsInvalidoError);
  });

  it('un host no puede pertenecer a dos verificadores, ni repetirse un código', () => {
    expect(() => new RegistroVerificadoresEps([def(), def({ codigo: 'otro_verificador' })])).toThrow(/dos verificadores/);
    expect(() => new RegistroVerificadoresEps([def(), def({ hostsPermitidos: ['otro.eps-prueba.test'] })])).toThrow(/repetido/);
  });
});

// ── Conclusiones ────────────────────────────────────────────────────────────

const INTERNO = { numeroDocumento: '1032456786', nombre: 'Laura Sofía Ramírez Ortiz' };
const CERTIFICADO: DatosExtraidosEps = {
  tipoDocumento: 'CC', numeroDocumento: '1032456786', nombre: 'LAURA SOFIA RAMIREZ ORTIZ', eps: 'EPS Sintetica S.A.S.',
  epsClave: 'SINTETICA', regimen: 'contributivo', tipoAfiliado: 'beneficiario', estadoReportadoCertificado: 'ACTIVO', fechaExpedicion: '2026-10-20',
};
const FUENTE: DatosVerificadosEps = {
  fuente: 'verificador_prueba', verificadoEn: '2026-10-26T15:00:00.000Z', eps: 'EPS Sintetica', regimen: 'Contributivo',
  estadoAfiliacion: 'ACTIVO', numeroDocumento: '1032456786', nombre: 'LAURA SOFIA RAMIREZ ORTIZ', fechaExpedicion: '2026-10-20',
};
const verificado = (datos: Partial<DatosVerificadosEps> = {}): ResultadoVerificacionEps => ({
  estado: 'verificado', verificador: 'verificador_prueba', verificadoEn: new Date(), origen: 'https://x', hashRespuesta: 'a'.repeat(64),
  httpStatus: 200, bytes: 10, datosVerificados: { ...FUENTE, ...datos },
});
const concluir = (r: ResultadoVerificacionEps, v = def(), cert: DatosExtraidosEps | null = CERTIFICADO, alias = {}) =>
  concluirVerificacion(r, v, cert, INTERNO, alias);

describe('Conclusión de una verificación oficial', () => {
  it('fuente que autentica y confirma afiliación activa: verificada + activa, sin discrepancias', () => {
    const c = concluir(verificado());
    expect(c).toMatchObject({ definitiva: true, autenticidad: AutenticidadEps.VERIFICADA, afiliacion: AfiliacionEps.ACTIVA, ruta: RutaValidacionEps.QR, errorCodigo: null });
    expect(c.discrepancias).toEqual([]);
  });

  it('autenticidad verificada NO implica afiliación: si el verificador no la confirma queda sin contrastar aunque el certificado diga ACTIVO', () => {
    const c = concluir(verificado({ estadoAfiliacion: 'ACTIVO' }), def({ confirmaAfiliacion: false }));
    expect(c.autenticidad).toBe(AutenticidadEps.VERIFICADA);
    expect(c.afiliacion).toBeUndefined();
  });

  it('verificador que autentica pero cuya respuesta no trae estado: la afiliación no se establece', () => {
    expect(concluir(verificado({ estadoAfiliacion: null })).afiliacion).toBeUndefined();
  });

  it.each([
    ['ACTIVO', AfiliacionEps.ACTIVA], ['activo', AfiliacionEps.ACTIVA], ['INACTIVO', AfiliacionEps.INACTIVA],
    ['SUSPENDIDO', AfiliacionEps.INACTIVA], ['RETIRADO', AfiliacionEps.INACTIVA], ['en trámite', AfiliacionEps.NO_DETERMINABLE], ['', AfiliacionEps.NO_DETERMINABLE],
  ])('estado de la fuente «%s» → afiliación %s', (estado, esperado) => {
    expect(afiliacionDeFuente(estado)).toBe(esperado);
  });

  it('un verificador que SOLO confirma afiliación (no autentica) no declara autenticidad del PDF', () => {
    const c = concluir(verificado(), def({ autenticaCertificado: false, confirmaAfiliacion: true }));
    expect(c.autenticidad).toBe(AutenticidadEps.NO_VERIFICABLE);
    expect(c.afiliacion).toBe(AfiliacionEps.ACTIVA);
  });

  it('la fuente rechaza el certificado de forma explícita: autenticidad inválida', () => {
    for (const errorCodigo of ['certificado_no_encontrado', 'certificado_invalido'] as const) {
      const c = concluir({ estado: 'rechazado', errorCodigo, verificador: 'verificador_prueba', verificadoEn: new Date(), origen: '', hashRespuesta: null, httpStatus: 200, bytes: 1 });
      expect(c).toMatchObject({ definitiva: true, autenticidad: AutenticidadEps.INVALIDA, errorCodigo });
    }
  });

  it('un rechazo de un verificador que no autentica no vuelve inválido a nadie', () => {
    const c = concluir({ estado: 'rechazado', errorCodigo: 'certificado_invalido', verificador: 'x', verificadoEn: new Date(), origen: '', hashRespuesta: null, httpStatus: 200, bytes: 1 },
      def({ autenticaCertificado: false, confirmaAfiliacion: true }));
    expect(c.definitiva).toBe(false);
    expect(c.autenticidad).toBe(AutenticidadEps.NO_VERIFICABLE);
  });

  it.each(['timeout', 'verificador_no_disponible', 'respuesta_invalida', 'respuesta_demasiado_grande', 'contenido_no_esperado', 'host_no_permitido'] as const)(
    'un fallo de la consulta (%s) NO es «certificado falso»: no verificable, no definitivo', (errorCodigo) => {
      const c = concluir({ estado: 'no_verificable', errorCodigo, verificador: 'v', verificadoEn: new Date(), origen: '', hashRespuesta: null, httpStatus: null, bytes: 0 });
      expect(c).toMatchObject({ definitiva: false, autenticidad: AutenticidadEps.NO_VERIFICABLE, ruta: RutaValidacionEps.REVISION_MANUAL, errorCodigo });
      expect(c.autenticidad).not.toBe(AutenticidadEps.INVALIDA);
    });

  it.each([
    ['documento distinto al del certificado', { numeroDocumento: '1032456787' }],
    ['nombre distinto al del certificado', { nombre: 'CARLOS PEREZ GOMEZ' }],
    ['EPS distinta a la del certificado', { eps: 'Otra Entidad' }],
    ['fecha de expedición distinta', { fechaExpedicion: '2026-09-01' }],
  ])('%s: el contenido no corresponde al registro oficial → autenticidad inválida (datos_inconsistentes)', (_c, cambio) => {
    const c = concluir(verificado(cambio));
    expect(c).toMatchObject({ definitiva: true, autenticidad: AutenticidadEps.INVALIDA, errorCodigo: 'datos_inconsistentes' });
    expect(c.discrepancias.some((d) => d.comparacion === 'oficial_vs_certificado')).toBe(true);
  });

  it('certificado auténtico pero de OTRA persona que la esperada por SIPRA: sigue auténtico, pero la coincidencia es discrepancia', () => {
    const otro: DatosExtraidosEps = { ...CERTIFICADO, numeroDocumento: '555000111', nombre: 'MARTA GOMEZ LOPEZ' };
    const c = concluir(verificado({ numeroDocumento: '555000111', nombre: 'MARTA GOMEZ LOPEZ' }), def(), otro);
    expect(c.autenticidad).toBe(AutenticidadEps.VERIFICADA);
    expect(c.coincidencia).toBe(CoincidenciaEps.DISCREPANCIA);
    expect(c.discrepancias.map((d) => d.comparacion)).toEqual(expect.arrayContaining(['oficial_vs_interno']));
    expect(c.discrepancias.filter((d) => d.comparacion === 'oficial_vs_certificado')).toEqual([]);
  });

  it('régimen y estado distintos se señalan pero no invalidan solos', () => {
    const c = concluir(verificado({ regimen: 'Subsidiado', estadoAfiliacion: 'INACTIVO' }));
    expect(c.autenticidad).toBe(AutenticidadEps.VERIFICADA);
    expect(c.afiliacion).toBe(AfiliacionEps.INACTIVA);
    expect(c.discrepancias.map((d) => d.campo)).toEqual(expect.arrayContaining(['regimen', 'estado_reportado']));
  });
});

describe('Comparaciones separadas y aliases de EPS', () => {
  it('cada discrepancia dice quién se compara con quién y cuál era cada valor', () => {
    const c = compararConFuenteOficial({ ...FUENTE, numeroDocumento: '999888777', nombre: 'OTRO NOMBRE DISTINTO' }, CERTIFICADO, INTERNO);
    const d = c.discrepancias.find((x) => x.campo === 'numero_documento' && x.comparacion === 'oficial_vs_certificado');
    expect(d).toMatchObject({ certificado: '1032456786', oficial: '999888777', resultado: 'diferente' });
    const i = c.discrepancias.find((x) => x.campo === 'numero_documento' && x.comparacion === 'oficial_vs_interno');
    expect(i).toMatchObject({ interno: '1032456786', oficial: '999888777' });
    expect(c.certificadoContradichoPorFuente).toBe(true);
    expect(c.internoContradichoPorFuente).toBe(true);
  });

  it('lo que la fuente no trae no es discrepancia', () => {
    const c = compararConFuenteOficial({ fuente: 'v', verificadoEn: '2026-10-26T00:00:00Z', eps: null, regimen: null, estadoAfiliacion: null }, CERTIFICADO, INTERNO);
    expect(c.discrepancias).toEqual([]);
  });

  it('«COMPENSAR» y «EPS COMPENSAR» son la misma entidad (sin alias: el texto «EPS» no identifica)', () => {
    expect(mismaEps('COMPENSAR', 'EPS COMPENSAR')).toBe(true);
    expect(mismaEps('Compensar E.P.S.', 'COMPENSAR EPS S.A.')).toBe(true);
  });

  it('la semejanza textual NO convierte a dos EPS en la misma', () => {
    for (const [a, b] of [['SANITAS', 'SANITAZ'], ['NUEVA EPS', 'NUEVA SALUD'], ['SURA', 'SURAMERICANA'], ['COMPENSAR', 'COMFENALCO'], ['SALUD TOTAL', 'SALUD TOTAL PLUS']]) {
      expect(mismaEps(a, b)).toBe(false);
    }
  });

  it('un alias solo vale si está APROBADO en el verificador del emisor', () => {
    const v = def({ emisor: 'EPS Sintetica', aliasesEmisor: ['Sintetica Salud'] });
    const alias = aliasesAprobados([v]);
    expect(alias).toEqual({ 'SINTETICA SALUD': 'SINTETICA' });
    expect(mismaEps('Sintetica Salud', 'EPS Sintetica', alias)).toBe(true);
    expect(mismaEps('Sintetica Salud', 'EPS Sintetica')).toBe(false); // sin alias aprobado no hay equivalencia
    expect(mismaEps('Sintetica Plus', 'EPS Sintetica', alias)).toBe(false);
    expect(claveEps('Sintetica Salud', alias)).toBe('SINTETICA');
  });

  it('con alias aprobado, una EPS distinta a la del certificado sí se detecta; con el alias, no es discrepancia', () => {
    const alias = aliasesAprobados([def({ emisor: 'EPS Sintetica', aliasesEmisor: ['Sintetica Salud'] })]);
    const sin = compararConFuenteOficial({ ...FUENTE, eps: 'Sintetica Salud' }, CERTIFICADO, INTERNO);
    expect(sin.discrepancias.some((d) => d.campo === 'eps')).toBe(true);
    const con = compararConFuenteOficial({ ...FUENTE, eps: 'Sintetica Salud' }, CERTIFICADO, INTERNO, alias);
    expect(con.discrepancias.some((d) => d.campo === 'eps')).toBe(false);
  });
});

// ── Ejes de la validación ───────────────────────────────────────────────────

const AHORA = new Date('2026-10-26T15:00:00Z');

function procesada(): ValidacionEps {
  const v = ValidacionEps.pendiente({ id: 'v-1', documentoId: 'd-1', practicaId: 'p-1', estudianteId: 'e-1', ahora: AHORA });
  v.registrarProcesamiento({
    datosExtraidos: CERTIFICADO, coincidencia: CoincidenciaEps.COINCIDE, discrepancias: [], vigencia: 'vigente', hayBanderaCritica: false,
  }, AHORA);
  return v;
}
const oficial = (v: ValidacionEps, c: ReturnType<typeof concluir>, verificador = 'verificador_prueba') =>
  v.registrarVerificacionOficial({
    verificador, autenticidad: c.autenticidad, afiliacion: c.afiliacion, ruta: c.ruta, datosVerificados: c.datosVerificados,
    discrepancias: c.discrepancias, coincidencia: c.coincidencia,
  }, AHORA);

describe('Ejes tras la verificación: candidato a autoaprobación', () => {
  it('autenticidad verificada + afiliación activa + coincidencia + vigencia → candidato (solo etiqueta)', () => {
    const v = procesada();
    oficial(v, concluir(verificado()));
    expect(v).toMatchObject({ autenticidad: AutenticidadEps.VERIFICADA, afiliacion: AfiliacionEps.ACTIVA, decision: DecisionEps.CANDIDATO_AUTOAPROBACION });
    expect(v.tieneVerificacionDefinitiva).toBe(true);
    expect(v.verificadorCodigo).toBe('verificador_prueba');
  });

  it('autenticidad verificada SIN afiliación confirmada → NO candidato (queda listo para ADRES asistido)', () => {
    const v = procesada();
    oficial(v, concluir(verificado(), def({ confirmaAfiliacion: false })));
    expect(v.autenticidad).toBe(AutenticidadEps.VERIFICADA);
    expect(v.afiliacion).toBe(AfiliacionEps.NO_CONTRASTADA);
    expect(v.decision).toBe(DecisionEps.PENDIENTE);
  });

  it('afiliación inactiva confirmada → no candidato', () => {
    const v = procesada();
    oficial(v, concluir(verificado({ estadoAfiliacion: 'INACTIVO' })));
    expect(v.afiliacion).toBe(AfiliacionEps.INACTIVA);
    expect(v.decision).toBe(DecisionEps.PENDIENTE);
  });

  it('otra persona (coincidencia → discrepancia): no candidato aunque la fuente la autentique', () => {
    const v = procesada();
    const otro: DatosExtraidosEps = { ...CERTIFICADO, numeroDocumento: '555000111', nombre: 'MARTA GOMEZ LOPEZ' };
    oficial(v, concluir(verificado({ numeroDocumento: '555000111', nombre: 'MARTA GOMEZ LOPEZ' }), def(), otro));
    expect(v.coincidencia).toBe(CoincidenciaEps.DISCREPANCIA);
    expect(v.decision).toBe(DecisionEps.PENDIENTE);
  });

  it('certificado inválido: no candidato y la autenticidad queda inválida', () => {
    const v = procesada();
    oficial(v, concluir({ estado: 'rechazado', errorCodigo: 'certificado_invalido', verificador: 'v', verificadoEn: AHORA, origen: '', hashRespuesta: null, httpStatus: 200, bytes: 1 }));
    expect(v).toMatchObject({ autenticidad: AutenticidadEps.INVALIDA, decision: DecisionEps.PENDIENTE });
  });

  it('un intento sin conclusión no toca la afiliación ni verifica nada: portal caído = no verificable', () => {
    const v = procesada();
    v.registrarVerificacionNoConcluyente('timeout', AHORA, AutenticidadEps.NO_VERIFICABLE);
    expect(v).toMatchObject({ autenticidad: AutenticidadEps.NO_VERIFICABLE, afiliacion: AfiliacionEps.NO_CONTRASTADA, decision: DecisionEps.PENDIENTE });
    expect(v.verificacionError).toBe('timeout');
    expect(v.tieneVerificacionDefinitiva).toBe(false);
  });

  it('el certificado que dice ACTIVO NO activa la afiliación sin una fuente oficial', () => {
    const v = procesada();
    expect(v.instantanea().datosExtraidos?.estadoReportadoCertificado).toBe('ACTIVO');
    expect(v.afiliacion).toBe(AfiliacionEps.NO_CONTRASTADA);
    expect(v.decision).toBe(DecisionEps.PENDIENTE);
  });

  it('una verificación no cambia el estado del documento: el modelo solo etiqueta, jamás aprueba', () => {
    const v = procesada();
    oficial(v, concluir(verificado()));
    expect(v.decision).not.toBe(DecisionEps.APROBADO_AUTOMATICO);
    expect(v.estadoProcesamiento).toBe(EstadoProcesamientoEps.PROCESADO);
  });

  it('el reclamo de verificación: vigente bloquea a otro; vence solo; se libera al concluir', () => {
    const v = procesada();
    expect(v.verificacionEnCurso(AHORA, 120_000)).toBe(false);
    v.iniciarVerificacion(AHORA);
    expect(v.verificacionEnCurso(new Date(AHORA.getTime() + 60_000), 120_000)).toBe(true);
    expect(v.verificacionEnCurso(new Date(AHORA.getTime() + 121_000), 120_000)).toBe(false);
    v.registrarVerificacionNoConcluyente('timeout', AHORA);
    expect(v.verificacionEnCurso(AHORA, 120_000)).toBe(false);
  });
});
