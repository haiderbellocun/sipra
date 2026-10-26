import {
  EvidenciaEps, EvidenciaEpsInvalidaError, FuenteEvidenciaEps, TipoEvidenciaEps, origenSinCredenciales,
} from '../src/domain/entities/evidencia-validacion-eps.entity';
import {
  AfiliacionEps, AutenticidadEps, CoincidenciaEps, DecisionEps, DecisionEpsInvalidaError, EstadoProcesamientoEps,
  ReservaAjenaError, RutaValidacionEps, ValidacionEps, ValidacionEpsYaDecididaError,
  evaluarCandidatoAutoaprobacion,
} from '../src/domain/entities/validacion-eps.entity';
import {
  compararCertificadoEps, construirDatosExtraidosEps, evaluarVigenciaCertificado,
} from '../src/domain/services/comparacion-eps.domain-service';
import {
  claveEps, compararDocumentos, compararNombres, fechaIsoDe, mismaEps, normalizarDocumento,
  normalizarEstadoReportado, normalizarRegimen, tokensDeNombre,
} from '../src/domain/services/normalizacion-identidad';

/**
 * Normalización, comparación interna y modelo de validación de EPS. Todo es
 * dominio puro y determinístico: sin base, sin red, sin IA.
 */

const AHORA = new Date('2026-10-26T15:00:00Z');
const dia = (iso: string): Date => new Date(`${iso}T12:00:00Z`);

// ── Normalización ───────────────────────────────────────────────────────────

describe('Normalización · documento', () => {
  it.each([
    ['1032456786', { tipo: null, numero: '1032456786' }],
    ['1.032.456.786', { tipo: null, numero: '1032456786' }],
    ['1 032 456 786', { tipo: null, numero: '1032456786' }],
    ['1,032,456,786', { tipo: null, numero: '1032456786' }],
    ['C.C. 1.032.456.786', { tipo: 'CC', numero: '1032456786' }],
    ['CC 1032456786', { tipo: 'CC', numero: '1032456786' }],
    ['cédula de ciudadanía N° 1032456786', { tipo: 'CC', numero: '1032456786' }],
    ['T.I. 1099887766', { tipo: 'TI', numero: '1099887766' }],
    ['C.E. 987654', { tipo: 'CE', numero: '987654' }],
    ['PA AB123456', { tipo: 'PA', numero: 'AB123456' }],
  ])('«%s» → %j', (entrada, esperado) => {
    expect(normalizarDocumento(entrada)).toEqual(esperado);
  });

  it('conserva los ceros a la izquierda: no convierte a número', () => {
    expect(normalizarDocumento('0012345678').numero).toBe('0012345678');
    expect(compararDocumentos('0012345678', '12345678')).toBe('diferente');
  });

  it.each([
    ['letras mezcladas con dígitos en una cédula', 'CC 1032A56786'],
    ['guion intermedio', '1032-456786'],
    ['demasiado corto', '123'],
    ['vacío', ''],
    ['solo texto', 'sin documento'],
  ])('no comparable (%s) → número nulo, nunca inventado', (_c, entrada) => {
    expect(normalizarDocumento(entrada).numero).toBeNull();
  });

  it('la comparación es igualdad exacta del número normalizado', () => {
    expect(compararDocumentos('1.032.456.786', 'CC 1032456786')).toBe('igual');
    expect(compararDocumentos('1032456786', '1032456787')).toBe('diferente');
    expect(compararDocumentos('1032456786', null)).toBe('insuficiente');
    expect(compararDocumentos('CC 1032456786', 'TI 1032456786')).toBe('diferente');
  });
});

describe('Normalización · nombre', () => {
  it('ignora mayúsculas, tildes, espacios repetidos, signos, partículas y orden', () => {
    expect(tokensDeNombre('  María  José  DE LA  Torre-Núñez ').sort()).toEqual(['JOSE', 'MARIA', 'NUNEZ', 'TORRE']);
    expect(compararNombres('Laura Sofía Ramírez Ortiz', 'RAMIREZ ORTIZ LAURA SOFIA')).toBe('igual');
  });

  it('compatible: el más corto está incluido y tiene al menos dos tokens', () => {
    expect(compararNombres('Laura Sofía Ramírez Ortiz', 'Laura Ramírez')).toBe('compatible');
  });

  it.each([
    ['Laura Sofía Ramírez Ortiz', 'Carlos Pérez Gómez'],
    ['Laura Ramírez', 'Laura Gómez'],
    ['Laura', 'Laura Ramírez Ortiz'], // un solo token no alcanza para afirmar nada
  ])('claramente diferente o insuficiente: «%s» vs «%s» → no es igual ni compatible', (a, b) => {
    expect(['diferente']).toContain(compararNombres(a, b));
  });

  it('vacío → insuficiente', () => {
    expect(compararNombres('', 'Laura Ramírez')).toBe('insuficiente');
    expect(compararNombres('Laura Ramírez', null)).toBe('insuficiente');
  });
});

describe('Normalización · EPS', () => {
  it('«NUEVA EPS», «Nueva EPS S.A.» y «nueva eps s.a.s.» dan la misma clave', () => {
    const claves = ['NUEVA EPS', 'Nueva EPS S.A.', 'nueva eps s.a.s.', 'NUEVA E.P.S.'].map((n) => claveEps(n));
    expect(new Set(claves).size).toBe(1);
    expect(claves[0]).toBe('NUEVA');
  });

  it('quita la expresión «entidad promotora de salud» y las formas jurídicas', () => {
    expect(claveEps('SANITAS ENTIDAD PROMOTORA DE SALUD S.A.S.')).toBe('SANITAS');
    expect(claveEps('Salud Total EPS S.A.')).toBe('SALUD TOTAL');
  });

  it('admite alias futuros sin lista escrita en el código', () => {
    expect(claveEps('Coomeva EPS')).toBe('COOMEVA');
    expect(claveEps('Coomeva EPS', { COOMEVA: 'NUEVA' })).toBe('NUEVA');
    expect(mismaEps('Coomeva EPS', 'Nueva EPS S.A.', { COOMEVA: 'NUEVA' })).toBe(true);
    expect(mismaEps('Sanitas', 'Nueva EPS')).toBe(false);
  });

  it('vacío → sin clave', () => {
    expect(claveEps('')).toBeNull();
    expect(claveEps('EPS S.A.S.')).toBeNull();
    expect(mismaEps(null, 'Nueva EPS')).toBeNull();
  });
});

describe('Normalización · régimen, estado reportado y fecha', () => {
  it.each([
    ['Contributivo - Cotizante', { regimen: 'contributivo', tipoAfiliado: 'cotizante' }],
    ['CONTRIBUTIVO BENEFICIARIO', { regimen: 'contributivo', tipoAfiliado: 'beneficiario' }],
    ['Subsidiado', { regimen: 'subsidiado', tipoAfiliado: null }],
    ['Régimen de excepción', { regimen: 'especial', tipoAfiliado: null }],
    ['FOMAG', { regimen: 'especial', tipoAfiliado: null }],
    ['Contributivo y subsidiado', { regimen: null, tipoAfiliado: null }], // ambiguo: no se elige
    ['', { regimen: null, tipoAfiliado: null }],
  ])('régimen «%s» → %j', (entrada, esperado) => {
    expect(normalizarRegimen(entrada)).toEqual(esperado);
  });

  it('el estado que DICE el certificado se normaliza; no es la afiliación real', () => {
    expect(normalizarEstadoReportado('Activo')).toBe('ACTIVO');
    expect(normalizarEstadoReportado('INACTIVO')).toBe('INACTIVO');
    expect(normalizarEstadoReportado('Suspendido')).toBe('SUSPENDIDO');
    expect(normalizarEstadoReportado('Retirado')).toBe('RETIRADO');
    expect(normalizarEstadoReportado('en trámite')).toBeNull();
  });

  it.each([
    ['2026-03-05', '2026-03-05'], ['05/03/2026', '2026-03-05'], ['5-3-26', '2026-03-05'],
    ['5 de marzo de 2026', '2026-03-05'], ['31/02/2026', null], ['mañana', null], ['', null],
  ])('fecha «%s» → %s', (entrada, esperado) => {
    expect(fechaIsoDe(entrada)).toBe(esperado);
  });
});

// ── Comparación interna ─────────────────────────────────────────────────────

const ESTUDIANTE = { numeroDocumento: '1032456786', nombre: 'Laura Sofía Ramírez Ortiz' };
const campo = (valor: string | null, confianza = 0.95) => ({ valor, confianza });

function certificado(sobrescribe: Record<string, { valor: string | null; confianza: number }> = {}) {
  return construirDatosExtraidosEps({
    documento_afiliado: campo('CC 1.032.456.786'),
    nombre_afiliado: campo('LAURA SOFIA RAMIREZ ORTIZ'),
    entidad_emisora: campo('Nueva EPS S.A.'),
    regimen: campo('Contributivo - Beneficiario'),
    estado_afiliacion: campo('ACTIVO'),
    fecha_expedicion: campo('2026-10-20'),
    ...sobrescribe,
  });
}

const comparar = (extraidos = certificado(), esperado = ESTUDIANTE) =>
  compararCertificadoEps(extraidos, esperado, { ahora: AHORA, diasVigencia: 30 });

describe('Comparación EPS · lectura normalizada', () => {
  it('la instantánea trae lo que el certificado DICE, ya normalizado', () => {
    expect(certificado()).toEqual({
      tipoDocumento: 'CC', numeroDocumento: '1032456786', nombre: 'LAURA SOFIA RAMIREZ ORTIZ',
      eps: 'Nueva EPS S.A.', epsClave: 'NUEVA', regimen: 'contributivo', tipoAfiliado: 'beneficiario',
      estadoReportadoCertificado: 'ACTIVO', fechaExpedicion: '2026-10-20',
    });
  });

  it('una lectura poco confiable cuenta como no leída (no se decide identidad con un dato dudoso)', () => {
    const dudoso = certificado({ documento_afiliado: campo('CC 1.032.456.786', 0.4) });
    expect(dudoso.numeroDocumento).toBeNull();
    expect(comparar(dudoso).coincidencia).toBe(CoincidenciaEps.INSUFICIENTE);
  });
});

describe('Comparación EPS · identidad', () => {
  it('documento igual y nombre igual → coincide, sin discrepancias de identidad', () => {
    const r = comparar();
    expect(r.coincidencia).toBe(CoincidenciaEps.COINCIDE);
    expect(r.discrepancias.filter((d) => ['numero_documento', 'nombre'].includes(d.campo))).toEqual([]);
  });

  it('documento igual y nombre normalizado (tildes, mayúsculas, orden) → coincide', () => {
    const r = comparar(certificado({ nombre_afiliado: campo('ramírez ortiz, laura sofía') }));
    expect(r.coincidencia).toBe(CoincidenciaEps.COINCIDE);
  });

  it('documento igual y nombre compatible (falta un apellido) → coincide', () => {
    const r = comparar(certificado({ nombre_afiliado: campo('Laura Ramírez') }));
    expect(r.coincidencia).toBe(CoincidenciaEps.COINCIDE);
  });

  it('documento DIFERENTE → discrepancia, con esperado y observado estructurados', () => {
    const r = comparar(certificado({ documento_afiliado: campo('CC 1032456787') }));
    expect(r.coincidencia).toBe(CoincidenciaEps.DISCREPANCIA);
    expect(r.discrepancias).toContainEqual({
      campo: 'numero_documento', esperado: '1032456786', observado: '1032456787', resultado: 'diferente',
    });
  });

  it('documento igual pero nombre claramente diferente → discrepancia (sospechoso)', () => {
    const r = comparar(certificado({ nombre_afiliado: campo('CARLOS PEREZ GOMEZ') }));
    expect(r.coincidencia).toBe(CoincidenciaEps.DISCREPANCIA);
    expect(r.discrepancias.find((d) => d.campo === 'nombre')?.resultado).toBe('diferente');
  });

  it('el nombre SOLO no basta: sin documento comparable no hay coincidencia', () => {
    const r = comparar(certificado({ documento_afiliado: campo(null, 0) }));
    expect(r.coincidencia).toBe(CoincidenciaEps.INSUFICIENTE);
    expect(r.discrepancias).toContainEqual(expect.objectContaining({ campo: 'numero_documento', resultado: 'insuficiente' }));
  });

  it('sin documento del estudiante en SIPRA → insuficiente', () => {
    expect(comparar(certificado(), { numeroDocumento: null, nombre: ESTUDIANTE.nombre } as never).coincidencia)
      .toBe(CoincidenciaEps.INSUFICIENTE);
  });
});

describe('Comparación EPS · vigencia, EPS y régimen', () => {
  it('expedido dentro de la vigencia institucional → vigente', () => {
    expect(comparar().vigencia).toBe('vigente');
    expect(evaluarVigenciaCertificado('2026-09-26', AHORA, 30)).toBe('vigente'); // exactamente 30 días
  });

  it('certificado vencido → discrepancia «vencido» (no cambia la identidad)', () => {
    const r = comparar(certificado({ fecha_expedicion: campo('2026-08-01') }));
    expect(r.vigencia).toBe('vencido');
    expect(r.discrepancias).toContainEqual(expect.objectContaining({ campo: 'fecha_expedicion', resultado: 'vencido' }));
    expect(r.coincidencia).toBe(CoincidenciaEps.COINCIDE);
  });

  it('31 días ya es vencido; una fecha futura o ausente es «no determinada», nunca vigente', () => {
    expect(evaluarVigenciaCertificado('2026-09-25', AHORA, 30)).toBe('vencido');
    expect(evaluarVigenciaCertificado('2027-01-01', AHORA, 30)).toBe('no_determinada');
    expect(evaluarVigenciaCertificado(null, AHORA, 30)).toBe('no_determinada');
  });

  it('EPS y régimen solo se normalizan y se señala lo que falta', () => {
    const r = comparar(certificado({ entidad_emisora: campo(null, 0), regimen: campo(null, 0) }));
    expect(r.discrepancias).toContainEqual({ campo: 'eps', esperado: null, observado: null, resultado: 'ausente' });
    expect(r.discrepancias).toContainEqual({ campo: 'regimen', esperado: null, observado: null, resultado: 'ausente' });
    expect(r.coincidencia).toBe(CoincidenciaEps.COINCIDE);
  });

  it('EPS con distinto formato produce la misma clave (consistencia interna)', () => {
    expect(certificado({ entidad_emisora: campo('NUEVA EPS') }).epsClave).toBe(certificado().epsClave);
  });
});

// ── Ejes independientes ─────────────────────────────────────────────────────

function pendiente(): ValidacionEps {
  return ValidacionEps.pendiente({ id: 'v-1', documentoId: 'd-1', practicaId: 'p-1', estudianteId: 'e-1', ahora: AHORA });
}

function procesada(extra: { coincidencia?: CoincidenciaEps; vigencia?: 'vigente' | 'vencido' | 'no_determinada'; critica?: boolean } = {}): ValidacionEps {
  const v = pendiente();
  v.registrarProcesamiento({
    datosExtraidos: certificado(),
    coincidencia: extra.coincidencia ?? CoincidenciaEps.COINCIDE,
    discrepancias: [],
    vigencia: extra.vigencia ?? 'vigente',
    hayBanderaCritica: extra.critica ?? false,
  }, AHORA);
  return v;
}

describe('ValidacionEps · ejes independientes', () => {
  it('nace con todos los ejes sin evaluar y nada decidido', () => {
    const v = pendiente().instantanea();
    expect(v).toMatchObject({
      estadoProcesamiento: EstadoProcesamientoEps.PENDIENTE, autenticidad: AutenticidadEps.NO_EVALUADA,
      coincidencia: CoincidenciaEps.NO_EVALUADA, afiliacion: AfiliacionEps.NO_CONTRASTADA,
      ruta: RutaValidacionEps.SIN_DETERMINAR, decision: DecisionEps.PENDIENTE,
      datosExtraidos: null, datosVerificados: null, retencionHasta: null, version: 1,
    });
  });

  it('procesar localmente NO toca autenticidad ni afiliación; la ruta pasa a revisión manual', () => {
    const v = procesada();
    expect(v.estadoProcesamiento).toBe(EstadoProcesamientoEps.PROCESADO);
    expect(v.coincidencia).toBe(CoincidenciaEps.COINCIDE);
    expect(v.autenticidad).toBe(AutenticidadEps.NO_EVALUADA);
    expect(v.afiliacion).toBe(AfiliacionEps.NO_CONTRASTADA);
    expect(v.ruta).toBe(RutaValidacionEps.REVISION_MANUAL);
    expect(v.instantanea().datosVerificados).toBeNull();
  });

  it('el estado que reporta el certificado NO es la afiliación: «ACTIVO» en el PDF no vuelve activa la afiliación', () => {
    const v = procesada();
    expect(v.instantanea().datosExtraidos?.estadoReportadoCertificado).toBe('ACTIVO');
    expect(v.afiliacion).toBe(AfiliacionEps.NO_CONTRASTADA);
  });

  it('autenticidad verificada NO implica afiliación activa', () => {
    const v = procesada();
    v.registrarVerificacion({ autenticidad: AutenticidadEps.VERIFICADA, ruta: RutaValidacionEps.QR }, AHORA);
    expect(v.autenticidad).toBe(AutenticidadEps.VERIFICADA);
    expect(v.afiliacion).toBe(AfiliacionEps.NO_CONTRASTADA);
    expect(v.decision).toBe(DecisionEps.PENDIENTE);
  });

  it('afiliación activa NO implica autenticidad', () => {
    const v = procesada();
    v.registrarVerificacion({ afiliacion: AfiliacionEps.ACTIVA, ruta: RutaValidacionEps.ADRES_ASISTIDO }, AHORA);
    expect(v.afiliacion).toBe(AfiliacionEps.ACTIVA);
    expect(v.autenticidad).toBe(AutenticidadEps.NO_EVALUADA);
    expect(v.decision).toBe(DecisionEps.PENDIENTE);
  });

  it('que los datos coincidan NO implica autenticidad', () => {
    const v = procesada({ coincidencia: CoincidenciaEps.COINCIDE });
    expect(v.coincidencia).toBe(CoincidenciaEps.COINCIDE);
    expect(v.autenticidad).not.toBe(AutenticidadEps.VERIFICADA);
  });

  it('un QR «encontrado» no es autenticidad: la ruta puede ser qr con autenticidad no verificable', () => {
    const v = procesada();
    v.registrarVerificacion({ autenticidad: AutenticidadEps.NO_VERIFICABLE, ruta: RutaValidacionEps.QR }, AHORA);
    expect(v.ruta).toBe(RutaValidacionEps.QR);
    expect(v.autenticidad).toBe(AutenticidadEps.NO_VERIFICABLE);
    expect(v.decision).toBe(DecisionEps.PENDIENTE);
  });

  it('lo extraído y lo verificado externamente son datos distintos', () => {
    const v = procesada();
    v.registrarVerificacion({
      afiliacion: AfiliacionEps.ACTIVA,
      datosVerificados: { fuente: 'adres', verificadoEn: AHORA.toISOString(), eps: 'NUEVA', regimen: 'contributivo', estadoAfiliacion: 'activo' },
    }, AHORA);
    const d = v.instantanea();
    expect(d.datosExtraidos?.nombre).toBe('LAURA SOFIA RAMIREZ ORTIZ');
    expect(d.datosVerificados?.fuente).toBe('adres');
    expect(d.datosVerificados).not.toEqual(d.datosExtraidos);
  });

  it('un error de procesamiento queda en su eje y no decide nada', () => {
    const v = pendiente();
    v.marcarError('LECTURA_FALLIDA', AHORA);
    expect(v.estadoProcesamiento).toBe(EstadoProcesamientoEps.ERROR);
    expect(v.instantanea().errorCodigo).toBe('LECTURA_FALLIDA');
    expect(v.decision).toBe(DecisionEps.PENDIENTE);
  });
});

// ── Candidatura a autoaprobación ────────────────────────────────────────────

const COMPLETA = {
  estadoProcesamiento: EstadoProcesamientoEps.PROCESADO, autenticidad: AutenticidadEps.VERIFICADA,
  coincidencia: CoincidenciaEps.COINCIDE, afiliacion: AfiliacionEps.ACTIVA, vigencia: 'vigente' as const,
  hayBanderaCritica: false,
};

describe('evaluarCandidatoAutoaprobacion', () => {
  it('es candidata solo si se cumplen TODOS los criterios a la vez', () => {
    expect(evaluarCandidatoAutoaprobacion(COMPLETA)).toEqual({ candidato: true, faltantes: [] });
  });

  it.each([
    ['autenticidad no verificada', { autenticidad: AutenticidadEps.NO_EVALUADA }, 'autenticidad'],
    ['autenticidad no verificable', { autenticidad: AutenticidadEps.NO_VERIFICABLE }, 'autenticidad'],
    ['autenticidad inválida', { autenticidad: AutenticidadEps.INVALIDA }, 'autenticidad'],
    ['datos que no coinciden', { coincidencia: CoincidenciaEps.DISCREPANCIA }, 'coincidencia'],
    ['coincidencia insuficiente', { coincidencia: CoincidenciaEps.INSUFICIENTE }, 'coincidencia'],
    ['afiliación no contrastada', { afiliacion: AfiliacionEps.NO_CONTRASTADA }, 'afiliacion'],
    ['afiliación inactiva', { afiliacion: AfiliacionEps.INACTIVA }, 'afiliacion'],
    ['afiliación no determinable', { afiliacion: AfiliacionEps.NO_DETERMINABLE }, 'afiliacion'],
    ['certificado vencido', { vigencia: 'vencido' as const }, 'vigencia'],
    ['vigencia no determinada', { vigencia: 'no_determinada' as const }, 'vigencia'],
    ['bandera crítica', { hayBanderaCritica: true }, 'banderas_criticas'],
    ['sin procesar', { estadoProcesamiento: EstadoProcesamientoEps.PENDIENTE }, 'procesamiento'],
  ])('%s → no es candidata y lo dice (%s)', (_caso, cambio, faltante) => {
    const r = evaluarCandidatoAutoaprobacion({ ...COMPLETA, ...cambio });
    expect(r.candidato).toBe(false);
    expect(r.faltantes).toContain(faltante);
  });

  it('afiliación activa SIN autenticidad verificada NO es candidata', () => {
    const r = evaluarCandidatoAutoaprobacion({ ...COMPLETA, autenticidad: AutenticidadEps.NO_EVALUADA });
    expect(r.candidato).toBe(false);
  });

  it('en la entidad: solo la combinación completa da candidato_autoaprobacion, y se retira si deja de cumplirse', () => {
    const v = procesada();
    expect(v.decision).toBe(DecisionEps.PENDIENTE);
    v.registrarVerificacion({ afiliacion: AfiliacionEps.ACTIVA }, AHORA);
    expect(v.decision).toBe(DecisionEps.PENDIENTE); // falta autenticidad
    v.registrarVerificacion({ autenticidad: AutenticidadEps.VERIFICADA, ruta: RutaValidacionEps.QR }, AHORA);
    expect(v.decision).toBe(DecisionEps.CANDIDATO_AUTOAPROBACION);
    v.registrarVerificacion({ afiliacion: AfiliacionEps.INACTIVA }, AHORA);
    expect(v.decision).toBe(DecisionEps.PENDIENTE);
  });

  it('un certificado vencido o con bandera crítica nunca queda candidato aunque lo demás cumpla', () => {
    for (const mala of [{ vigencia: 'vencido' as const }, { critica: true }]) {
      const v = procesada(mala);
      v.registrarVerificacion({ autenticidad: AutenticidadEps.VERIFICADA, afiliacion: AfiliacionEps.ACTIVA }, AHORA);
      expect(v.decision).toBe(DecisionEps.PENDIENTE);
    }
  });

  it('NO hay ninguna operación del modelo que asigne aprobado_automatico', () => {
    const v = procesada();
    v.registrarVerificacion({ autenticidad: AutenticidadEps.VERIFICADA, afiliacion: AfiliacionEps.ACTIVA }, AHORA);
    expect(v.decision).toBe(DecisionEps.CANDIDATO_AUTOAPROBACION);
    expect(() => v.registrarDecisionHumana(DecisionEps.APROBADO_AUTOMATICO, 'u', AHORA)).toThrow(DecisionEpsInvalidaError);
    expect(v.decision).toBe(DecisionEps.CANDIDATO_AUTOAPROBACION);
  });
});

// ── Decisión y reserva ──────────────────────────────────────────────────────

describe('ValidacionEps · decisión humana', () => {
  it.each([DecisionEps.APROBADO_MANUAL, DecisionEps.DEVUELTO, DecisionEps.RECHAZADO])('registra %s y no se repite', (decision) => {
    const v = procesada();
    v.registrarDecisionHumana(decision, 'aux-1', AHORA);
    expect(v.decision).toBe(decision);
    expect(v.instantanea()).toMatchObject({ decididoPor: 'aux-1', decididoEn: AHORA });
    expect(() => v.registrarDecisionHumana(DecisionEps.RECHAZADO, 'otro', AHORA)).toThrow(ValidacionEpsYaDecididaError);
    expect(() => v.registrarProcesamiento({
      datosExtraidos: certificado(), coincidencia: CoincidenciaEps.COINCIDE, discrepancias: [], vigencia: 'vigente', hayBanderaCritica: false,
    }, AHORA)).toThrow(ValidacionEpsYaDecididaError);
    expect(v.decision).toBe(decision);
  });

  it('decidir libera la reserva', () => {
    const v = procesada();
    v.reservar('aux-1', AHORA, 600_000);
    v.registrarDecisionHumana(DecisionEps.APROBADO_MANUAL, 'aux-1', AHORA);
    expect(v.asignadoA).toBeNull();
  });
});

describe('ValidacionEps · reserva', () => {
  const MIN = 60_000;

  it('una reserva por caso: otro funcionario no puede tomarlo mientras esté vigente', () => {
    const v = procesada();
    v.reservar('aux-1', AHORA, 15 * MIN);
    expect(() => v.reservar('aux-2', new Date(AHORA.getTime() + MIN), 15 * MIN)).toThrow(ReservaAjenaError);
    expect(v.asignadoA).toBe('aux-1');
  });

  it('quien la tiene puede renovarla', () => {
    const v = procesada();
    v.reservar('aux-1', AHORA, 15 * MIN);
    v.reservar('aux-1', new Date(AHORA.getTime() + 5 * MIN), 15 * MIN);
    expect(v.instantanea().reservaHasta).toEqual(new Date(AHORA.getTime() + 20 * MIN));
  });

  it('la reserva expira sola: pasado el plazo otro funcionario puede tomarlo', () => {
    const v = procesada();
    v.reservar('aux-1', AHORA, 15 * MIN);
    const despues = new Date(AHORA.getTime() + 15 * MIN);
    expect(v.reservaVigente(despues)).toBe(false);
    v.reservar('aux-2', despues, 15 * MIN);
    expect(v.asignadoA).toBe('aux-2');
  });

  it('liberar: el dueño sí, otro funcionario no, un supervisor sí', () => {
    const v = procesada();
    v.reservar('aux-1', AHORA, 15 * MIN);
    expect(() => v.liberar('aux-2', AHORA, false)).toThrow(ReservaAjenaError);
    v.liberar('coord-1', AHORA, true);
    expect(v.asignadoA).toBeNull();
    v.reservar('aux-1', AHORA, 15 * MIN);
    v.liberar('aux-1', AHORA, false);
    expect(v.asignadoA).toBeNull();
  });

  it('un caso decidido no se reserva', () => {
    const v = procesada();
    v.registrarDecisionHumana(DecisionEps.RECHAZADO, 'aux-1', AHORA);
    expect(() => v.reservar('aux-2', AHORA, 15 * MIN)).toThrow(ValidacionEpsYaDecididaError);
  });
});

// ── Evidencia ───────────────────────────────────────────────────────────────

const evidencia = (extra: Record<string, unknown> = {}) => ({
  id: 'ev-1', validacionEpsId: 'v-1', tipo: TipoEvidenciaEps.TEXTO_PDF, fuente: FuenteEvidenciaEps.CERTIFICADO,
  metodo: 'extraccion_local_texto_pdf', resultado: 'leido', fechaVerificacion: AHORA, hashEvidencia: 'a'.repeat(64),
  origen: null, datosObtenidos: { camposLeidos: ['nombre_afiliado'] }, errorCodigo: null, verificadoPor: null, creadoEn: AHORA,
  ...extra,
});

describe('EvidenciaEps', () => {
  it('registra una evidencia válida', () => {
    expect(EvidenciaEps.crear(evidencia()).tipo).toBe(TipoEvidenciaEps.TEXTO_PDF);
  });

  it.each([
    ['texto de PDF con fuente ADRES', { fuente: FuenteEvidenciaEps.ADRES }],
    ['ADRES con fuente certificado', { tipo: TipoEvidenciaEps.ADRES }],
    ['revisión humana sin funcionario', { tipo: TipoEvidenciaEps.REVISION_HUMANA, fuente: FuenteEvidenciaEps.REVISION_HUMANA }],
    ['hash que no es SHA-256', { hashEvidencia: 'no-es-un-hash' }],
    ['origen con parámetros (URL firmada)', { origen: 'https://eps.example/validar?token=abc' }],
    ['origen con fragmento', { origen: 'https://eps.example/validar#x' }],
    ['origen con credenciales', { origen: 'https://usuario:clave@eps.example/validar' }],
    ['datos con un token', { datosObtenidos: { token: 'x' } }],
    ['datos con la respuesta a un CAPTCHA', { datosObtenidos: { captcha: '1234' } }],
    ['datos con una cookie', { datosObtenidos: { Cookie: 'sesion=1' } }],
  ])('rechaza %s', (_caso, cambio) => {
    expect(() => EvidenciaEps.crear(evidencia(cambio) as never)).toThrow(EvidenciaEpsInvalidaError);
  });

  it('acepta un origen sin parámetros y una revisión humana con funcionario', () => {
    expect(origenSinCredenciales('https://eps.example/validar')).toBe(true);
    expect(() => EvidenciaEps.crear(evidencia({ origen: 'https://eps.example/validar' }) as never)).not.toThrow();
    expect(() => EvidenciaEps.crear(evidencia({
      tipo: TipoEvidenciaEps.REVISION_HUMANA, fuente: FuenteEvidenciaEps.REVISION_HUMANA, verificadoPor: 'aux-1',
    }) as never)).not.toThrow();
  });

  it('no hay puntaje de confianza: la evidencia se clasifica por fuente y tipo', () => {
    const d = EvidenciaEps.crear(evidencia()).instantanea();
    expect(Object.keys(d)).not.toEqual(expect.arrayContaining(['confianza']));
    expect(Object.keys(d)).not.toEqual(expect.arrayContaining(['puntaje']));
  });
});

// Usa las fechas para dejar claro el día de la prueba.
void dia;
