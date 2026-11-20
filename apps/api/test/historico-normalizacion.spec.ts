import { CicloAcademico } from '../src/domain/entities/practica.entity';
import { ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import {
  analizarIdentificadorOrganizacion, inferirNivelSgp, mapearEstadoSgp, mapearModalidadPracticaSgp, nombreEmpresaCanonico,
  normalizarDocumentoSgp, normalizarModalidadEstudio, parsearSalarioSgp, proporcion,
} from '../src/domain/historico/normalizacion-sgp';
import { Nit } from '../src/domain/value-objects/nit.vo';

const conDv = (base: string): string => `${base}${Nit.calcularDigitoVerificacion(base)}`;

describe('Histórico SGP · documento (texto, nunca float)', () => {
  it('número entero → texto sin .0 ni notación científica', () => {
    expect(normalizarDocumentoSgp(1012345678)).toEqual({ normalizado: '1012345678', observacion: null });
    expect(normalizarDocumentoSgp(930916214051985).normalizado).toBe('930916214051985');
  });
  it('número no entero no es un documento confiable', () => {
    expect(normalizarDocumentoSgp(1012345678.5)).toEqual({ normalizado: null, observacion: 'atipico' });
  });
  it('texto «1234567.0» NO se recorta (no está probado que sea artefacto)', () => {
    expect(normalizarDocumentoSgp('1234567.0')).toEqual({ normalizado: null, observacion: 'atipico' });
  });
  it('separadores de miles y espacios se quitan; ceros a la izquierda también', () => {
    expect(normalizarDocumentoSgp('1.012.345.678').normalizado).toBe('1012345678');
    expect(normalizarDocumentoSgp('0079123456').normalizado).toBe('79123456');
  });
  it('ausente y atípicos (15 dígitos, muy corto)', () => {
    expect(normalizarDocumentoSgp(null).observacion).toBe('ausente');
    expect(normalizarDocumentoSgp(930916214051985).observacion).toBe('atipico');
    expect(normalizarDocumentoSgp(1234).observacion).toBe('atipico');
  });
  it('alfanumérico (pasaporte) → mayúsculas, solo letras y dígitos', () => {
    expect(normalizarDocumentoSgp('ab-123 456').normalizado).toBe('AB123456');
  });
});

describe('Histórico SGP · identificador de organización', () => {
  it('NIT jurídico con DV pegado (10 dígitos) → base de 9, DV válido, NIT en claro permitido', () => {
    const r = analizarIdentificadorOrganizacion(Number(conDv('900123456')));
    expect(r).toEqual({ tipo: 'juridica', normalizado: '900123456', dvValido: true, nitJuridica: '900123456' });
  });
  it('mismo NIT en sus formatos (con guion, puntos, tabulador, sin DV) → misma forma canónica', () => {
    const dv = Nit.calcularDigitoVerificacion('900123456');
    for (const v of [`900123456-${dv}`, `900.123.456-${dv}`, `\t.900.123.456-${dv}`, '900123456', `NIT: 900123456-${dv}`]) {
      expect(analizarIdentificadorOrganizacion(v).normalizado).toBe('900123456');
    }
  });
  it('persona natural (cédula + DV, 11 dígitos) → nunca en claro', () => {
    const r = analizarIdentificadorOrganizacion(Number(conDv('1099000001')));
    expect(r.tipo).toBe('persona_natural');
    expect(r.nitJuridica).toBeNull();
  });
  it('NIT con DV incorrecto: no es confiable ni se guarda en claro', () => {
    const base = '900123456';
    const malo = `${base}${(Nit.calcularDigitoVerificacion(base) + 1) % 10}`;
    const r = analizarIdentificadorOrganizacion(Number(malo));
    expect(r.dvValido).toBe(false);
    expect(r.nitJuridica).toBeNull();
  });
  it('triviales, cortos y vacíos → inválido/ausente sin clave', () => {
    expect(analizarIdentificadorOrganizacion('123').tipo).toBe('invalido');
    expect(analizarIdentificadorOrganizacion(123456789).tipo).toBe('invalido');
    expect(analizarIdentificadorOrganizacion(0).tipo).toBe('ausente');
    expect(analizarIdentificadorOrganizacion(null)).toMatchObject({ tipo: 'ausente', normalizado: null });
  });
  it('identificador extranjero o con letras → no estándar (con clave propia)', () => {
    expect(analizarIdentificadorOrganizacion('B17005794')).toMatchObject({ tipo: 'no_estandar', normalizado: 'XB17005794' });
  });
  it('nombre de empresa canónico ignora tildes, signos y razón social', () => {
    expect(nombreEmpresaCanonico('Organización Sintética S.A.S.')).toBe(nombreEmpresaCanonico('ORGANIZACION SINTETICA SAS'));
    expect(nombreEmpresaCanonico('  ')).toBeNull();
  });
});

describe('Histórico SGP · salario (sin convertir lo dudoso)', () => {
  it.each([
    [1423500, 'exacto', 1423500], ['1.300.000', 'exacto', 1300000], [0, 'no_remunerado', 0], ['NO REMUNERADO', 'no_remunerado', 0],
    ['SMLV', 'referencia_smmlv', null], [-658000, 'atipico', -658000], [9_000_000_000, 'atipico', 9_000_000_000],
    ['.908.526', 'no_interpretable', null], ['1´.300.000', 'no_interpretable', null], [null, 'ausente', null],
  ])('%p → %s', (v, calidad, normalizado) => {
    const r = parsearSalarioSgp(v);
    expect(r.calidad).toBe(calidad);
    expect(r.normalizado).toBe(normalizado);
  });
  it('un texto con arroba no se conserva como original', () => {
    expect(parsearSalarioSgp('alguien@correo.example').original).toBeNull();
  });
});

describe('Histórico SGP · nivel, modalidades y estado', () => {
  it('ciclo desde la asignatura cuando el nivel falta; el original no se toca', () => {
    expect(inferirNivelSgp(null, 'PRÁCTICA NIVEL TÉCNICO ')).toEqual({ inferido: CicloAcademico.TECNICO, fuente: 'nombre_asignatura', faltante: true, conflicto: false });
    expect(inferirNivelSgp('Tecnologo', 'PRACTICA NIVEL TECNOLÓGICO')).toMatchObject({ inferido: CicloAcademico.TECNOLOGO, fuente: 'nivel_formacion' });
    expect(inferirNivelSgp('Profesional', 'PRÁCTICA NIVEL TÉCNICO ')).toMatchObject({ inferido: CicloAcademico.TECNICO, conflicto: true });
    expect(inferirNivelSgp(null, null)).toMatchObject({ inferido: null, fuente: 'unknown' });
  });
  it('modalidad de estudio NO es modalidad de práctica', () => {
    expect(normalizarModalidadEstudio('A DISTANCIA')).toBe('a_distancia');
    expect(mapearModalidadPracticaSgp('VIRTUAL').estadoMapeo).toBe('UNMAPPED');
  });
  it('15 → 14: todas mapean salvo EMPRESA PROPIA, que queda pendiente institucional', () => {
    expect(mapearModalidadPracticaSgp('VALIDACIÓN DE LA EXPERIENCIA LABORAL').normalizada).toBe(ModalidadPractica.VALIDACION_EXPERIENCIA);
    expect(mapearModalidadPracticaSgp('PRÁCTICA INVESTIGATIVA').normalizada).toBe(ModalidadPractica.INVESTIGACION);
    expect(mapearModalidadPracticaSgp('EMPRENDIMIENTO CUNBRE - NACIENTE').normalizada).toBe(ModalidadPractica.CUNBRE_NACIENTE);
    expect(mapearModalidadPracticaSgp('EMPRESA PROPIA')).toEqual({ normalizada: null, estadoMapeo: 'PENDING_INSTITUTIONAL_MAPPING' });
  });
  it('estado: inversa de EQUIVALENCIA_SGP; abiertos = estado AL CORTE', () => {
    expect(mapearEstadoSgp('Cerrado')).toEqual({ analitico: 'cerrado', estadoMapeo: 'MAPPED', esEstadoDeCorte: false });
    expect(mapearEstadoSgp('Reprueba').analitico).toBe('reprobado');
    expect(mapearEstadoSgp('Anulado').analitico).toBe('anulado');
    expect(mapearEstadoSgp('En Práctica')).toEqual({ analitico: 'en_practica', estadoMapeo: 'MAPPED', esEstadoDeCorte: true });
    expect(mapearEstadoSgp('Inscrito').esEstadoDeCorte).toBe(true);
    expect(mapearEstadoSgp('Otro').estadoMapeo).toBe('UNMAPPED');
  });
  it('proporciones 0–1 (no conteos)', () => {
    expect(proporcion(0.67)).toEqual({ valor: 0.67, invalida: false });
    expect(proporcion(3)).toEqual({ valor: null, invalida: true });
  });
});
