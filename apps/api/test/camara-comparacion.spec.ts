import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ValidacionCamaraUseCase } from '../src/application/use-cases/documentos/validacion-camara.use-case';
import { BandaPuntaje, DatosDocumento, Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  ClasificacionDocumentoEmpresarial as C, DatosCamaraExtraidos, EstadoAutenticidad, EstadoRegistral, EstadoValidacionDocumentoEmpresarial as Estado, TipoPersona,
} from '../src/domain/entities/documento-empresarial';
import {
  CampoCamara, ComparacionCamara, LecturaCamaraParaComparar, SipraParaCamara, compararCamaraConSipra, datosSipraParaCamara, huellaSipraCamara,
  personaEsperadaPorNit, sipraCambioDespuesCamara, veredictoSinComparacionCamara,
} from '../src/domain/services/comparacion-camara.domain-service';
import { LecturaCamaraPersistible } from '../src/domain/services/lectura-local-camara.domain-service';
import {
  CEDULA_NATURAL, DV_JURIDICA, DV_NATURAL, NIT_JURIDICA, NOMBRE_PERSONA, RAZON_SOCIAL, REPRESENTANTE, datosCamara, datosCamaraMatriculaSociedad, datosCamaraPn,
} from './soporte-documento-empresarial';
import { RepoMemoria } from './soporte-repo-documento-empresarial';

const AHORA = new Date('2026-11-05T15:00:00Z');
const dvOtro = (dv: string): string => String((Number(dv) + 1) % 10);

const SIPRA_PJ: SipraParaCamara = {
  personaEsperada: TipoPersona.JURIDICA,
  empresa: { nitNumero: NIT_JURIDICA, nitDv: Number(DV_JURIDICA), razonSocial: RAZON_SOCIAL, representanteLegal: REPRESENTANTE },
};
const SIPRA_PN: SipraParaCamara = {
  personaEsperada: TipoPersona.NATURAL,
  empresa: { nitNumero: CEDULA_NATURAL, nitDv: Number(DV_NATURAL), razonSocial: NOMBRE_PERSONA, representanteLegal: null },
};
const conEmpresa = (base: SipraParaCamara, sobre: Partial<NonNullable<SipraParaCamara['empresa']>>): SipraParaCamara => ({ ...base, empresa: { ...base.empresa!, ...sobre } });

const lectura = (tipo: C | null, datos: DatosCamaraExtraidos | null, lecturaDudosa = false): LecturaCamaraParaComparar => ({ tipoDetectado: tipo, datos, lecturaDudosa });
const existencia = (sobre: Partial<DatosCamaraExtraidos> = {}, dudosa = false) => lectura(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamara(sobre), dudosa);
const sociedad = (sobre: Partial<DatosCamaraExtraidos> = {}, dudosa = false) => lectura(C.CAMARA_MATRICULA_SOCIEDAD, datosCamaraMatriculaSociedad(sobre), dudosa);
const natural = (sobre: Partial<DatosCamaraExtraidos> = {}, dudosa = false) => lectura(C.CAMARA_MATRICULA_PERSONA_NATURAL, datosCamaraPn(sobre), dudosa);

const comparar = (l: LecturaCamaraParaComparar, sipra: SipraParaCamara): ComparacionCamara => compararCamaraConSipra(l, sipra, AHORA)!;
const resultadoDe = (c: ComparacionCamara, campo: CampoCamara): string | undefined => c.campos.find((x) => x.campo === campo)?.resultado;
const notaDe = (c: ComparacionCamara, campo: CampoCamara): string | undefined => c.campos.find((x) => x.campo === campo)?.nota;
const diferentes = (c: ComparacionCamara): string[] => c.campos.filter((x) => x.resultado === 'diferente').map((x) => x.campo);
const criticos = (c: ComparacionCamara) => c.campos.filter((x) => x.criticidad === 'critico');

// ── Persona natural ───────────────────────────────────────────────────────────────────────

describe('Comparación Cámara · matrícula de persona natural', () => {
  it('PN consistente: identificación, DV y nombre coinciden; sin representante; veredicto consistente (no es aprobación)', () => {
    const c = comparar(natural(), SIPRA_PN);
    expect(['nit', 'dv', 'nombre'].map((k) => resultadoDe(c, k as CampoCamara))).toEqual(['coincide', 'coincide', 'coincide']);
    expect(resultadoDe(c, 'representante_legal')).toBe('no_aplica');
    expect(c).toMatchObject({ veredicto: 'consistente', hayDiscrepancia: false, senales: [] });
  });

  it('PN con documento diferente: diferencia SOLO en la identificación', () => {
    const c = comparar(natural(), conEmpresa(SIPRA_PN, { nitNumero: '1000000099' }));
    expect(diferentes(c)).toEqual(['nit']);
    expect(c).toMatchObject({ veredicto: 'discrepancia', hayDiscrepancia: true });
  });

  it('PN con nombre diferente: diferencia SOLO en el nombre', () => {
    const c = comparar(natural(), conEmpresa(SIPRA_PN, { razonSocial: 'JUAN PEREZ RUIZ' }));
    expect(diferentes(c)).toEqual(['nombre']);
  });

  it('el nombre se compara sin tildes, mayúsculas ni puntuación y con orden flexible; un apellido faltante es coincidencia parcial', () => {
    expect(resultadoDe(comparar(natural(), conEmpresa(SIPRA_PN, { razonSocial: 'lópez rivera, maría fernanda' })), 'nombre')).toBe('coincide');
    const parcial = comparar(natural(), conEmpresa(SIPRA_PN, { razonSocial: 'MARIA LOPEZ RIVERA' }));
    expect(resultadoDe(parcial, 'nombre')).toBe('coincide');
    expect(notaDe(parcial, 'nombre')).toBe('nombre_parcial');
    // Sin fuzzy: un nombre con una letra distinta NO coincide.
    expect(resultadoDe(comparar(natural(), conEmpresa(SIPRA_PN, { razonSocial: 'MARIA FERNANDA LOPEZ RIVERO' })), 'nombre')).toBe('diferente');
  });

  it('PN sin DV en el certificado: el número y el nombre se comparan y el DV queda sin determinar, sin bloquear el veredicto', () => {
    const c = comparar(natural({ dv: null }), SIPRA_PN);
    expect(resultadoDe(c, 'nit')).toBe('coincide');
    expect(resultadoDe(c, 'nombre')).toBe('coincide');
    expect(resultadoDe(c, 'dv')).toBe('informacion_insuficiente');
    expect(notaDe(c, 'dv')).toBe('dv_ausente_en_certificado');
    expect(c.veredicto).toBe('consistente');
  });

  it('PN sin DV y con otra identificación: la diferencia de identificación se reporta igual', () => {
    expect(diferentes(comparar(natural({ dv: null }), conEmpresa(SIPRA_PN, { nitNumero: '1000000099' })))).toEqual(['nit']);
  });

  it('PN con DV que no corresponde a la identificación: NIT y DV insuficientes (lectura no confiable), jamás «diferente»', () => {
    const c = comparar(natural({ dv: dvOtro(DV_NATURAL) }), conEmpresa(SIPRA_PN, { nitNumero: '1000000099' }));
    expect(diferentes(c)).toEqual([]);
    expect(resultadoDe(c, 'nit')).toBe('informacion_insuficiente');
    expect(notaDe(c, 'nit')).toBe('nit_no_confiable_dv_no_coincide');
    expect(c.veredicto).toBe('revision_necesaria');
  });
});

// ── Persona jurídica ──────────────────────────────────────────────────────────────────────

describe('Comparación Cámara · matrícula de sociedad y existencia/representación', () => {
  it('PJ consistente (existencia): NIT, DV, razón social y representante coinciden', () => {
    const c = comparar(existencia(), SIPRA_PJ);
    expect(['nit', 'dv', 'razon_social', 'representante_legal'].map((k) => resultadoDe(c, k as CampoCamara))).toEqual(['coincide', 'coincide', 'coincide', 'coincide']);
    expect(c).toMatchObject({ veredicto: 'consistente', hayDiscrepancia: false });
    expect(c.campos.find((x) => x.campo === 'representante_legal')?.criticidad).toBe('importante');
  });

  it('PJ consistente (matrícula de sociedad): el representante es informativo y no se exige', () => {
    const c = comparar(sociedad(), SIPRA_PJ);
    expect(c.veredicto).toBe('consistente');
    expect(c.campos.find((x) => x.campo === 'representante_legal')).toMatchObject({ resultado: 'no_aplica', criticidad: 'informativo', nota: 'opcional_en_matricula' });
  });

  it('PJ con NIT diferente: diferencia SOLO en el NIT', () => {
    for (const l of [existencia(), sociedad()]) {
      const c = comparar(l, conEmpresa(SIPRA_PJ, { nitNumero: '900999999' }));
      expect(diferentes(c)).toEqual(['nit']);
      expect(c.veredicto).toBe('discrepancia');
    }
  });

  it('PJ con DV diferente: diferencia SOLO en el DV', () => {
    const c = comparar(existencia(), conEmpresa(SIPRA_PJ, { nitDv: Number(dvOtro(DV_JURIDICA)) }));
    expect(diferentes(c)).toEqual(['dv']);
  });

  it('PJ con razón social diferente: diferencia SOLO en la razón social', () => {
    const c = comparar(existencia(), conEmpresa(SIPRA_PJ, { razonSocial: 'OTRA COMERCIALIZADORA S.A.S.' }));
    expect(diferentes(c)).toEqual(['razon_social']);
  });

  it('razón social: S.A.S./SAS, tildes, mayúsculas y puntuación coinciden; un nombre más largo o más corto NO', () => {
    const doc = (razon: string) => existencia({ nombreORazonSocial: razon });
    const sipra = (razon: string) => conEmpresa(SIPRA_PJ, { razonSocial: razon });
    expect(resultadoDe(comparar(doc('EMPRESA PRUEBA CUNBRE SAS'), sipra('EMPRESA PRUEBA CUNBRE S.A.S.')), 'razon_social')).toBe('coincide');
    expect(resultadoDe(comparar(doc('Empresa Prueba Cunbre S.A.S.'), sipra('EMPRESA PRUEBA CUNBRE SAS')), 'razon_social')).toBe('coincide');
    expect(resultadoDe(comparar(doc('INVERSIONES LÓPEZ LTDA'), sipra('Inversiones Lopez L.T.D.A.')), 'razon_social')).toBe('coincide');
    expect(resultadoDe(comparar(doc('EMPRESA PRUEBA DEL NORTE SAS'), sipra('EMPRESA PRUEBA SAS')), 'razon_social')).toBe('diferente');
    expect(resultadoDe(comparar(doc('EMPRESA PRUEBA SAS'), sipra('EMPRESA PRUEBA DEL NORTE SAS')), 'razon_social')).toBe('diferente');
  });

  it('representante diferente (existencia): diferencia SOLO en el representante, con criticidad importante', () => {
    const c = comparar(existencia(), conEmpresa(SIPRA_PJ, { representanteLegal: 'LUIS MIGUEL TORRES DIAZ' }));
    expect(diferentes(c)).toEqual(['representante_legal']);
    expect(c).toMatchObject({ veredicto: 'discrepancia', hayDiscrepancia: true });
  });

  it('representante: orden flexible por tokens; un nombre parcial es insuficiente antes que una coincidencia dudosa', () => {
    expect(resultadoDe(comparar(existencia(), conEmpresa(SIPRA_PJ, { representanteLegal: 'Pérez Gómez, Carlos Andrés' })), 'representante_legal')).toBe('coincide');
    const parcial = comparar(existencia(), conEmpresa(SIPRA_PJ, { representanteLegal: 'CARLOS PEREZ' }));
    expect(resultadoDe(parcial, 'representante_legal')).toBe('informacion_insuficiente');
    expect(notaDe(parcial, 'representante_legal')).toBe('nombre_parcial');
    expect(diferentes(parcial)).toEqual([]);
  });

  it('representante ausente (en el certificado, en SIPRA o en ambos): informacion_insuficiente, nunca una diferencia', () => {
    const sinLeer = comparar(existencia({ representanteLegal: null }), SIPRA_PJ);
    const sinSipra = comparar(existencia(), conEmpresa(SIPRA_PJ, { representanteLegal: null }));
    const ninguno = comparar(existencia({ representanteLegal: null }), conEmpresa(SIPRA_PJ, { representanteLegal: null }));
    for (const c of [sinLeer, sinSipra, ninguno]) {
      expect(resultadoDe(c, 'representante_legal')).toBe('informacion_insuficiente');
      expect(diferentes(c)).toEqual([]);
      expect(c.veredicto).toBe('revision_necesaria');
    }
    expect(notaDe(sinLeer, 'representante_legal')).toBe('representante_no_leido_en_certificado');
    expect(notaDe(sinSipra, 'representante_legal')).toBe('sipra_sin_representante');
  });

  it('matrícula de sociedad: un representante que aparece solo informa; aunque difiera NO es discrepancia', () => {
    const c = comparar(sociedad({ representanteLegal: REPRESENTANTE }), conEmpresa(SIPRA_PJ, { representanteLegal: 'LUIS MIGUEL TORRES DIAZ' }));
    expect(c.campos.find((x) => x.campo === 'representante_legal')).toMatchObject({ resultado: 'diferente', criticidad: 'informativo' });
    expect(c).toMatchObject({ hayDiscrepancia: false, veredicto: 'consistente' });
    expect(resultadoDe(comparar(sociedad({ representanteLegal: REPRESENTANTE }), conEmpresa(SIPRA_PJ, { representanteLegal: null })), 'representante_legal')).toBe('informacion_insuficiente');
  });

  it('PJ sin DV en el certificado: el NIT se compara y el DV (crítico en PJ) queda insuficiente → revisión necesaria', () => {
    const c = comparar(existencia({ dv: null }), SIPRA_PJ);
    expect(resultadoDe(c, 'nit')).toBe('coincide');
    expect(resultadoDe(c, 'dv')).toBe('informacion_insuficiente');
    expect(c.veredicto).toBe('revision_necesaria');
  });
});

// ── NIT + DV ──────────────────────────────────────────────────────────────────────────────

describe('Comparación Cámara · control determinístico del NIT', () => {
  it('DV leído distinto del calculado: NIT y DV quedan insuficientes aunque SIPRA tenga otro NIT; nunca «NIT diferente»', () => {
    const c = comparar(existencia({ dv: dvOtro(DV_JURIDICA) }), conEmpresa(SIPRA_PJ, { nitNumero: '900999999' }));
    expect(resultadoDe(c, 'nit')).toBe('informacion_insuficiente');
    expect(resultadoDe(c, 'dv')).toBe('informacion_insuficiente');
    expect(notaDe(c, 'nit')).toBe('nit_no_confiable_dv_no_coincide');
    expect(diferentes(c)).toEqual([]);
    expect(c.veredicto).toBe('revision_necesaria');
  });

  it('nunca se modifica el NIT leído para hacerlo coincidir (la comparación no devuelve valores)', () => {
    const l = existencia({ dv: dvOtro(DV_JURIDICA) });
    const antes = JSON.stringify(l);
    comparar(l, SIPRA_PJ);
    expect(JSON.stringify(l)).toBe(antes);
  });

  it('SIPRA sin NIT o sin DV: insuficiente con su causa', () => {
    expect(notaDe(comparar(existencia(), conEmpresa(SIPRA_PJ, { nitNumero: null })), 'nit')).toBe('sipra_sin_nit');
    expect(notaDe(comparar(existencia(), conEmpresa(SIPRA_PJ, { nitDv: null })), 'dv')).toBe('sipra_sin_dv');
  });
});

// ── Lectura dudosa ────────────────────────────────────────────────────────────────────────

describe('Comparación Cámara · lectura dudosa', () => {
  it('con lecturaDudosa los críticos quedan insuficientes y NINGUNA mutación produce una diferencia automática', () => {
    const mutaciones: [string, SipraParaCamara, LecturaCamaraParaComparar][] = [
      ['nit', conEmpresa(SIPRA_PJ, { nitNumero: '900999999' }), existencia({}, true)],
      ['dv', conEmpresa(SIPRA_PJ, { nitDv: Number(dvOtro(DV_JURIDICA)) }), existencia({}, true)],
      ['razón social', conEmpresa(SIPRA_PJ, { razonSocial: 'OTRA EMPRESA SAS' }), existencia({}, true)],
      ['representante', conEmpresa(SIPRA_PJ, { representanteLegal: 'LUIS TORRES DIAZ' }), existencia({}, true)],
      ['identificación PN', conEmpresa(SIPRA_PN, { nitNumero: '1000000099' }), natural({}, true)],
      ['nombre PN', conEmpresa(SIPRA_PN, { razonSocial: 'JUAN PEREZ RUIZ' }), natural({}, true)],
    ];
    for (const [, sipra, l] of mutaciones) {
      const c = comparar(l, sipra);
      expect(diferentes(c)).toEqual([]);
      expect(c.hayDiscrepancia).toBe(false);
      expect(c.veredicto).toBe('revision_necesaria');
      expect(criticos(c).every((x) => x.resultado === 'informacion_insuficiente' && x.nota === 'lectura_dudosa')).toBe(true);
    }
  });

  it('con lecturaDudosa tampoco hay «coincide» (ni siquiera si todo cuadra)', () => {
    const c = comparar(existencia({}, true), SIPRA_PJ);
    expect(criticos(c).some((x) => x.resultado === 'coincide')).toBe(false);
  });

  it('un estado «cancelado» leído con duda no produce la señal crítica', () => {
    const c = comparar(existencia({ estadoRegistral: EstadoRegistral.CANCELADO }, true), SIPRA_PJ);
    expect(c.senales).toEqual([]);
    expect(resultadoDe(c, 'estado_registral')).toBe('informacion_insuficiente');
  });
});

// ── Persona distinta, documento incorrecto, no determinable ───────────────────────────────

describe('Comparación Cámara · persona distinta, documento incorrecto y no determinable', () => {
  it('se esperaba persona jurídica y el certificado es de persona natural: NO se compara como PJ (críticos no_aplica), sin diferencias', () => {
    const c = comparar(natural(), SIPRA_PJ);
    expect(criticos(c).every((x) => x.resultado === 'no_aplica' && x.nota === 'persona_distinta')).toBe(true);
    expect(diferentes(c)).toEqual([]);
    expect(c).toMatchObject({ veredicto: 'no_aplica', hayDiscrepancia: false });
  });

  it('se esperaba persona natural y el certificado es de una sociedad: tampoco se compara como PN', () => {
    for (const l of [existencia(), sociedad()]) {
      const c = comparar(l, SIPRA_PN);
      expect(diferentes(c)).toEqual([]);
      expect(c.veredicto).toBe('no_aplica');
    }
  });

  it('sin una persona esperada afirmable (NIT de forma ambigua) se compara según lo que el certificado ES', () => {
    const c = comparar(natural(), { ...SIPRA_PN, personaEsperada: null });
    expect(c.veredicto).toBe('consistente');
  });

  it('documento incorrecto o no determinable: NO hay comparación (null) y el veredicto visible es revisión necesaria', () => {
    for (const tipo of [C.DOCUMENTO_INCORRECTO, C.NO_DETERMINABLE]) {
      expect(compararCamaraConSipra(lectura(tipo, null), SIPRA_PJ, AHORA)).toBeNull();
      expect(veredictoSinComparacionCamara(tipo)).toBe('revision_necesaria');
    }
    expect(compararCamaraConSipra(lectura(C.RUT_PERSONA_JURIDICA, null), SIPRA_PJ, AHORA)).toBeNull();
    expect(compararCamaraConSipra(lectura(null, null), SIPRA_PJ, AHORA)).toBeNull();
    expect(veredictoSinComparacionCamara(C.CAMARA_EXISTENCIA_REPRESENTACION)).toBeNull();
  });

  it('SIPRA sin empresa ni formulario: críticos insuficientes con su causa', () => {
    const c = comparar(existencia(), { personaEsperada: null, empresa: null });
    expect(criticos(c).every((x) => x.resultado === 'informacion_insuficiente' && x.nota === 'sipra_sin_empresa')).toBe(true);
    expect(c.veredicto).toBe('revision_necesaria');
  });
});

// ── Informativos, estado, renovación, antigüedad ──────────────────────────────────────────

describe('Comparación Cámara · campos informativos', () => {
  it('estado registral no_determinable no es un error: queda informativo y no frena el veredicto', () => {
    const c = comparar(existencia(), SIPRA_PJ);
    expect(c.campos.find((x) => x.campo === 'estado_registral')).toMatchObject({ resultado: 'informacion_insuficiente', criticidad: 'informativo', nota: 'estado_no_determinable' });
    expect(c.veredicto).toBe('consistente');
  });

  it('estado «activo» solo informa: no aprueba el documento', () => {
    const c = comparar(existencia({ estadoRegistral: EstadoRegistral.ACTIVO }), SIPRA_PJ);
    expect(c.campos.find((x) => x.campo === 'estado_registral')).toMatchObject({ resultado: 'informativo', nota: 'activo_no_aprueba_el_documento' });
    expect(c.veredicto).toBe('consistente');
  });

  it('estado «cancelado» declarado: señal crítica separada estado_registral_cancelado, sin decisión automática', () => {
    const c = comparar(existencia({ estadoRegistral: EstadoRegistral.CANCELADO }), SIPRA_PJ);
    expect(c.senales).toEqual(['estado_registral_cancelado']);
    expect(c.campos.find((x) => x.campo === 'estado_registral')).toMatchObject({ resultado: 'diferente', criticidad: 'critico', nota: 'estado_registral_cancelado' });
    expect(c.veredicto).toBe('discrepancia');
    // Los datos de identidad no se tocan por eso.
    expect(resultadoDe(c, 'nit')).toBe('coincide');
  });

  it('renovación y antigüedad (política null): son informativas; un certificado viejo y un último año renovado antiguo NO generan nada', () => {
    const c = comparar(existencia({ fechaExpedicion: '2015-01-01', ultimoAnioRenovado: 2019, fechaRenovacion: '2019-03-31' }), SIPRA_PJ);
    for (const k of ['ultimo_anio_renovado', 'fecha_renovacion', 'fecha_expedicion'] as CampoCamara[]) {
      expect(c.campos.find((x) => x.campo === k)).toMatchObject({ resultado: 'informativo', criticidad: 'informativo' });
    }
    expect(notaDe(c, 'fecha_expedicion')).toBe('sin_politica_de_antiguedad');
    expect(notaDe(c, 'ultimo_anio_renovado')).toBe('no_deduce_vigencia');
    expect(c).toMatchObject({ veredicto: 'consistente', hayDiscrepancia: false });
    expect(JSON.stringify(c)).not.toMatch(/vigente|vencid|invalid|ano_en_curso|a[nñ]o en curso|camara_no_vigente/i);
  });

  it('matrícula, Cámara, fechas, domicilio, CIIU, código, firma y ventana: informativos, nunca coincide/diferente, sin contraparte inventada', () => {
    const c = comparar(existencia({ verificacionDisponibleHasta: '2026-11-09' }), SIPRA_PJ);
    const info = c.campos.filter((x) => x.criticidad === 'informativo' && !['representante_legal', 'estado_registral'].includes(x.campo));
    expect(info.map((x) => x.campo).sort()).toEqual([
      'camara', 'ciiu', 'codigo_verificacion', 'domicilio', 'fecha_expedicion', 'fecha_matricula', 'fecha_renovacion', 'firma_pdf', 'matricula', 'ultimo_anio_renovado', 'ventana_verificacion',
    ]);
    expect(info.every((x) => x.resultado === 'informativo')).toBe(true);
    expect(notaDe(c, 'matricula')).toBe('sin_contraparte_en_sipra');
    expect(notaDe(c, 'firma_pdf')).toBe('presente_no_es_criterio');
    expect(notaDe(c, 'codigo_verificacion')).toBe('no_es_criterio_de_coincidencia');
  });

  it('un informativo ausente queda insuficiente o no_aplica y no frena el veredicto', () => {
    const c = comparar(existencia({ matricula: null, ciiu: null, codigoVerificacion: null, verificacionDisponibleHasta: null, firmaPdfPresente: null }), SIPRA_PJ);
    expect(resultadoDe(c, 'matricula')).toBe('informacion_insuficiente');
    expect(resultadoDe(c, 'ventana_verificacion')).toBe('informacion_insuficiente');
    expect(resultadoDe(c, 'firma_pdf')).toBe('no_aplica');
    expect(c.veredicto).toBe('consistente');
  });

  it('la firma, el código y la URL NO son criterio de coincidencia: quitarlos no cambia el veredicto de identidad', () => {
    const con = comparar(existencia(), SIPRA_PJ);
    const sin = comparar(existencia({ firmaPdfPresente: false, codigoVerificacion: null, urlVerificacion: null }), SIPRA_PJ);
    expect(sin.veredicto).toBe(con.veredicto);
    expect(criticos(sin)).toEqual(criticos(con));
  });

  it('la comparación no guarda valores: ni NIT, ni nombres, ni matrícula, ni código, ni URL', () => {
    const texto = JSON.stringify(comparar(existencia(), SIPRA_PJ));
    for (const valor of [NIT_JURIDICA, RAZON_SOCIAL, REPRESENTANTE, '654321', 'ZZ99YY88XX', 'verifica.ejemplo.test', 'CIUDAD DEMO']) expect(texto).not.toContain(valor);
  });
});

// ── Huella de SIPRA ───────────────────────────────────────────────────────────────────────

describe('Comparación Cámara · huella de los datos de SIPRA', () => {
  it('es estable ante diferencias de formato y cambia cuando cambia un dato relevante', () => {
    const base = huellaSipraCamara(SIPRA_PJ);
    expect(huellaSipraCamara(conEmpresa(SIPRA_PJ, { razonSocial: 'acme demostración s.a.s' }))).toBe(base);
    expect(huellaSipraCamara(conEmpresa(SIPRA_PJ, { representanteLegal: 'PÉREZ GÓMEZ, CARLOS ANDRÉS' }))).toBe(base);
    for (const sobre of [{ nitNumero: '900999999' }, { nitDv: 9 }, { razonSocial: 'OTRA EMPRESA' }, { representanteLegal: 'LUIS TORRES' }, { representanteLegal: null }]) {
      expect(huellaSipraCamara(conEmpresa(SIPRA_PJ, sobre))).not.toBe(base);
    }
    expect(huellaSipraCamara({ ...SIPRA_PJ, personaEsperada: null })).not.toBe(base);
    expect(huellaSipraCamara({ personaEsperada: null, empresa: null })).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it('la comparación incluye la huella y permite saber si SIPRA cambió después, sin contener los valores', () => {
    const c = comparar(existencia(), SIPRA_PJ);
    expect(c.huellaSipra).toBe(huellaSipraCamara(SIPRA_PJ));
    expect(sipraCambioDespuesCamara(c, SIPRA_PJ)).toBe(false);
    expect(sipraCambioDespuesCamara(c, conEmpresa(SIPRA_PJ, { razonSocial: 'OTRA EMPRESA SAS' }))).toBe(true);
  });

  it('la persona esperada sale del NIT solo cuando su forma es inequívoca', () => {
    expect(personaEsperadaPorNit('900123456')).toBe(TipoPersona.JURIDICA);
    expect(personaEsperadaPorNit('860.000.001')).toBe(TipoPersona.JURIDICA);
    expect(personaEsperadaPorNit('1000000001')).toBe(TipoPersona.NATURAL);
    expect(personaEsperadaPorNit('52123456')).toBe(TipoPersona.NATURAL);
    for (const ambiguo of ['', null, undefined, '123', '123456789', '2000000001', '12345678901']) expect(personaEsperadaPorNit(ambiguo as never)).toBeNull();
  });

  it('datos de SIPRA a partir de la empresa registrada o, sin ella, del formulario FUR', () => {
    const registrada = datosSipraParaCamara({ empresa: { nitNumero: NIT_JURIDICA, nitDv: 5, razonSocial: RAZON_SOCIAL, representanteLegal: REPRESENTANTE }, formulario: null });
    expect(registrada).toEqual({ personaEsperada: TipoPersona.JURIDICA, empresa: { nitNumero: NIT_JURIDICA, nitDv: 5, razonSocial: RAZON_SOCIAL, representanteLegal: REPRESENTANTE } });
    const fur = datosSipraParaCamara({ empresa: null, formulario: { razonSocial: RAZON_SOCIAL, nit: '901458772-2' } });
    expect(fur.empresa).toEqual({ nitNumero: '901458772', nitDv: 2, razonSocial: RAZON_SOCIAL, representanteLegal: null });
    expect(datosSipraParaCamara({ empresa: null, formulario: null })).toEqual({ personaEsperada: null, empresa: null });
  });
});

// ── Aislamiento de la regla legada «año en curso» ─────────────────────────────────────────

describe('Comparación Cámara · no hereda la regla legada «año en curso»', () => {
  it('ni la comparación ni su caso de uso mencionan ANO_EN_CURSO, CAMARA_NO_VIGENTE ni el criterio del año en curso', () => {
    const raiz = join(__dirname, '..', 'src');
    for (const archivo of ['domain/services/comparacion-camara.domain-service.ts', 'application/use-cases/documentos/validacion-camara.use-case.ts', 'domain/services/interpretacion-camara.domain-service.ts']) {
      expect(readFileSync(join(raiz, archivo), 'utf8')).not.toMatch(/ANO_EN_CURSO|CAMARA_NO_VIGENTE|delAnoEnCurso|a[nñ]o en curso/i);
    }
  });
});

// ── Persistencia, recálculo y huella (caso de uso) ────────────────────────────────────────

const HASH = 'a'.repeat(64);
const PRACTICA = '00000000-0000-4000-8000-0000000000a1';
const ESTUDIANTE = '00000000-0000-4000-8000-0000000000b1';
const AUTENTICIDAD = {
  estado: EstadoAutenticidad.NO_VERIFICABLE, fuente: null, qrPresente: null, qrDecodificado: null, qrDestinoOficial: null,
  firmaPdfPresente: true, firmaPdfValida: null, codigoVerificacionPresente: true, urlVerificacionPresente: true,
};

function lecturaPersistible(tipoDetectado: C, datos: DatosCamaraExtraidos | null, lecturaDudosa = false): LecturaCamaraPersistible {
  return {
    hashSha256: HASH, tipoDetectado, motivosClasificacion: [], metodo: 'texto', confianzaDocumento: lecturaDudosa ? 0.6 : 1, lecturaDudosa, datos,
    autenticidad: AUTENTICIDAD, resumen: { metodo: 'texto', paginas: 1, paginasOcr: 0, confianzaOcrMedia: null, lecturaDudosa, limitesAplicados: [] }, motivos: [],
  };
}

function entorno() {
  const repo = new RepoMemoria();
  const sipra = { empresa: { ...SIPRA_PJ.empresa! } as Record<string, unknown> | null };
  const docs = new Map<string, Documento>();
  const lector = { leer: jest.fn() };
  const caso = new ValidacionCamaraUseCase(
    repo, { buscarPorId: async (id: string) => docs.get(id) ?? null } as never,
    { buscarPorId: async () => ({ estudianteId: ESTUDIANTE, instantanea: () => ({ empresaId: sipra.empresa ? 'e-1' : null, empresaRazonSocial: null, empresaNit: null }) }) } as never,
    { leer: async () => Buffer.from('pdf') } as never, lector,
    { buscarPorId: async () => (sipra.empresa ? { instantanea: () => sipra.empresa } : null) } as never,
  );
  const agregar = (lecturaCamara: LecturaCamaraPersistible): string => {
    const id = randomUUID();
    const d: DatosDocumento = {
      id, practicaId: PRACTICA, tipo: TipoDocumento.CAMARA_COMERCIO, version: 1, estado: EstadoDocumento.EN_REVISION, nombreOriginal: 'camara.pdf', mimeReal: 'application/pdf',
      tamanoBytes: 10, hashSha256: HASH, hashPerceptual: null, rutaAlmacenamiento: `ruta/${id}.pdf`, calidadCaptura: null, banderas: [], puntaje: 90, banda: BandaPuntaje.VERDE,
      extraccion: { lecturaCamara }, decididoPor: null, justificacionDecision: null, motivoDevolucion: null, cargadoEn: AHORA, actualizadoEn: AHORA, purgarDespuesDe: null,
    };
    docs.set(id, Documento.desde(d));
    repo.documentos.push({ documentoId: id, practicaId: PRACTICA, tipo: TipoDocumento.CAMARA_COMERCIO, hash: HASH });
    return id;
  }
  const registrar = async (lecturaCamara: LecturaCamaraPersistible) => {
    const id = agregar(lecturaCamara);
    return { id, v: (await caso.registrarProcesamiento(docs.get(id)!, AHORA))!.instantanea() };
  };
  const evidenciasDe = (tipo: string) => repo.evidencias.filter((e) => String(e.tipo) === tipo);
  return { caso, repo, sipra, docs, lector, registrar, evidenciasDe };
}

describe('ValidacionCamaraUseCase · comparación y persistencia', () => {
  it('consistente: guarda la comparación en la validación y su evidencia; el estado sigue en revisión (nunca aprobado)', async () => {
    const { registrar, evidenciasDe, lector } = entorno();
    const { v } = await registrar(lecturaPersistible(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamara()));
    const c = v.comparacion as ComparacionCamara;
    expect(c).toMatchObject({ version: 1, veredicto: 'consistente', hayDiscrepancia: false, senales: [], huellaSipra: huellaSipraCamara(SIPRA_PJ) });
    expect(v).toMatchObject({ estado: Estado.REVISION, expectativa: 'coincide', decididoPor: null, decididoEn: null, motivoDecision: null, asignadoA: null });
    expect(v.autenticidad).toMatchObject({ estado: 'no_verificable', firmaPdfValida: null });
    const evidencia = evidenciasDe('comparacion');
    expect(evidencia).toHaveLength(1);
    expect(evidencia[0]).toMatchObject({ resultado: 'consistente', metodo: 'comparacion_camara_sipra', intento: v.intentos });
    expect(JSON.stringify(evidencia[0].datos)).not.toContain(NIT_JURIDICA);
    expect(lector.leer).not.toHaveBeenCalled();
  });

  it('discrepancia crítica: se guarda el campo diferente; el estado sigue en revisión (la decisión es humana)', async () => {
    const { registrar, sipra, evidenciasDe } = entorno();
    sipra.empresa = { ...sipra.empresa, razonSocial: 'OTRA COMERCIALIZADORA S.A.S.' };
    const { v } = await registrar(lecturaPersistible(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamara()));
    expect(v.estado).toBe(Estado.REVISION);
    expect(v.comparacion).toMatchObject({ veredicto: 'discrepancia', hayDiscrepancia: true });
    expect(diferentes(v.comparacion as ComparacionCamara)).toEqual(['razon_social']);
    expect(evidenciasDe('comparacion')[0].resultado).toBe('discrepancia');
  });

  it('lectura dudosa: informacion_insuficiente y revisión necesaria, sin diferencias', async () => {
    const { registrar, sipra } = entorno();
    sipra.empresa = { ...sipra.empresa, razonSocial: 'OTRA COMERCIALIZADORA S.A.S.' };
    const { v } = await registrar(lecturaPersistible(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamara(), true));
    expect(v.comparacion).toMatchObject({ veredicto: 'revision_necesaria', hayDiscrepancia: false });
    expect(v.lecturaDudosa).toBe(true);
  });

  it('persona distinta: la expectativa lo dice, los críticos son no_aplica y el documento no se invalida', async () => {
    const { registrar, evidenciasDe } = entorno();
    const { v } = await registrar(lecturaPersistible(C.CAMARA_MATRICULA_PERSONA_NATURAL, datosCamaraPn()));
    expect(v).toMatchObject({ estado: Estado.REVISION, expectativa: 'persona_distinta', tipoDetectado: C.CAMARA_MATRICULA_PERSONA_NATURAL });
    expect(v.comparacion).toMatchObject({ veredicto: 'no_aplica', hayDiscrepancia: false });
    expect(evidenciasDe('comparacion')[0].resultado).toBe('no_aplica');
  });

  it('documento incorrecto y no determinable: comparación null y SIN evidencia de comparación', async () => {
    for (const tipo of [C.DOCUMENTO_INCORRECTO, C.NO_DETERMINABLE]) {
      const { registrar, evidenciasDe } = entorno();
      const { v } = await registrar(lecturaPersistible(tipo, null));
      expect(v).toMatchObject({ estado: Estado.REVISION, comparacion: null, datosExtraidos: null });
      expect(evidenciasDe('comparacion')).toHaveLength(0);
      expect(evidenciasDe('clasificacion')).toHaveLength(1);
    }
  });

  it('PN consistente con la empresa de SIPRA como titular', async () => {
    const { registrar, sipra } = entorno();
    sipra.empresa = { ...SIPRA_PN.empresa! };
    const { v } = await registrar(lecturaPersistible(C.CAMARA_MATRICULA_PERSONA_NATURAL, datosCamaraPn()));
    expect(v).toMatchObject({ expectativa: 'coincide' });
    expect(v.comparacion).toMatchObject({ veredicto: 'consistente' });
  });

  it('procesar dos veces el mismo intento no duplica la validación ni ninguna evidencia (idempotente)', async () => {
    const { caso, repo, docs, registrar, evidenciasDe } = entorno();
    const { id, v } = await registrar(lecturaPersistible(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamara()));
    await caso.registrarProcesamiento(docs.get(id)!, new Date('2026-11-06T00:00:00Z'));
    await caso.registrarProcesamiento(docs.get(id)!, new Date('2026-11-07T00:00:00Z'));
    expect(repo.filas.size).toBe(1);
    expect(evidenciasDe('comparacion')).toHaveLength(1);
    expect(repo.evidencias).toHaveLength(3);
    expect(repo.filas.get(v.id)!.intentos).toBe(v.intentos);
  });
});

describe('ValidacionCamaraUseCase · recálculo de la comparación sin releer el PDF', () => {
  it('si SIPRA no cambió, no hace nada; si cambió, abre una ronda nueva, guarda otra evidencia y conserva las anteriores', async () => {
    const { caso, repo, sipra, registrar, evidenciasDe, lector } = entorno();
    const { id, v } = await registrar(lecturaPersistible(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamara()));
    expect(await caso.datosSipraCambiaronCamara(id)).toBe(false);

    const igual = (await caso.recalcularComparacionCamara(id, AHORA))!.instantanea();
    expect(igual.intentos).toBe(v.intentos);
    expect(evidenciasDe('comparacion')).toHaveLength(1);

    sipra.empresa = { ...sipra.empresa, razonSocial: 'OTRA COMERCIALIZADORA S.A.S.' };
    expect(await caso.datosSipraCambiaronCamara(id)).toBe(true);
    const nuevo = (await caso.recalcularComparacionCamara(id, AHORA))!.instantanea();
    expect(nuevo.intentos).toBe(v.intentos + 1);
    expect(nuevo.estado).toBe(Estado.REVISION);
    expect(nuevo.comparacion).toMatchObject({ veredicto: 'discrepancia' });
    expect(nuevo.datosExtraidos).toEqual(v.datosExtraidos);
    expect(evidenciasDe('comparacion').map((e) => e.resultado).sort()).toEqual(['consistente', 'discrepancia']);
    expect(repo.evidencias).toHaveLength(4);
    expect(await caso.datosSipraCambiaronCamara(id)).toBe(false);
    expect(lector.leer).not.toHaveBeenCalled();

    // Repetirlo con lo mismo no abre otra ronda.
    await caso.recalcularComparacionCamara(id, AHORA);
    expect(repo.evidencias).toHaveLength(4);
  });

  it('un cambio de persona esperada en SIPRA actualiza también la expectativa', async () => {
    const { caso, sipra, registrar } = entorno();
    const { id } = await registrar(lecturaPersistible(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamara()));
    sipra.empresa = { ...SIPRA_PN.empresa! };
    const nuevo = (await caso.recalcularComparacionCamara(id, AHORA))!.instantanea();
    expect(nuevo.expectativa).toBe('persona_distinta');
    expect(nuevo.comparacion).toMatchObject({ veredicto: 'no_aplica' });
  });

  it('un caso terminal (decisión humana) NO se recalcula: solo se informa que SIPRA cambió', async () => {
    const { caso, repo, sipra, registrar } = entorno();
    const { id, v } = await registrar(lecturaPersistible(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamara()));
    repo.filas.set(v.id, { ...repo.filas.get(v.id)!, estado: Estado.APROBADO_MANUAL, decididoPor: 'u-1', decididoEn: AHORA });
    sipra.empresa = { ...sipra.empresa, razonSocial: 'OTRA COMERCIALIZADORA S.A.S.' };
    const despues = (await caso.recalcularComparacionCamara(id, AHORA))!.instantanea();
    expect(despues.estado).toBe(Estado.APROBADO_MANUAL);
    expect(despues.comparacion).toMatchObject({ veredicto: 'consistente' });
    expect(repo.evidencias.filter((e) => String(e.tipo) === 'comparacion')).toHaveLength(1);
    expect(await caso.datosSipraCambiaronCamara(id)).toBe(true);
  });

  it('documentos incorrectos o sin lectura no tienen comparación que recalcular', async () => {
    const { caso, registrar, evidenciasDe } = entorno();
    const { id } = await registrar(lecturaPersistible(C.NO_DETERMINABLE, null));
    expect((await caso.recalcularComparacionCamara(id, AHORA))!.instantanea().comparacion).toBeNull();
    expect(await caso.datosSipraCambiaronCamara(id)).toBe(false);
    expect(evidenciasDe('comparacion')).toHaveLength(0);
    expect(await caso.recalcularComparacionCamara('no-existe', AHORA)).toBeNull();
  });

  it('dos recálculos simultáneos producen UNA sola ronda y UNA sola evidencia nueva', async () => {
    const { caso, repo, sipra, registrar, evidenciasDe } = entorno();
    const { id, v } = await registrar(lecturaPersistible(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamara()));
    sipra.empresa = { ...sipra.empresa, razonSocial: 'OTRA COMERCIALIZADORA S.A.S.' };
    await Promise.all([caso.recalcularComparacionCamara(id, AHORA), caso.recalcularComparacionCamara(id, AHORA)]);
    expect(repo.filas.get(v.id)!.intentos).toBe(v.intentos + 1);
    expect(evidenciasDe('comparacion')).toHaveLength(2);
  });
});
