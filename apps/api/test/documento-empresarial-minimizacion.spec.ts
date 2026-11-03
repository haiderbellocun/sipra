import { TipoPersona } from '../src/domain/entities/documento-empresarial';
import {
  EvidenciaDocumentoEmpresarial, EvidenciaDocumentoEmpresarialInvalidaError, TipoEvidenciaDocumentoEmpresarial,
  evidenciaDeClasificacion, evidenciaDeLectura,
} from '../src/domain/entities/validacion-documento-empresarial.entity';
import {
  clavesProhibidasEn, minimizarDatosCamara, minimizarDatosRut, sanearUrlVerificacion,
} from '../src/domain/services/minimizacion-documento-empresarial.domain-service';
import { AHORA, HASH_A, validacionPendiente } from './soporte-documento-empresarial';

const BRUTO_RUT = {
  nit: '900123456', dv: '7', fechaGeneracion: '2024-03-15', tipoDocumento: 'CC', numeroDocumento: '1.000.000.001',
  nombres: 'MARIA  FERNANDA', apellidos: 'LOPEZ RIVERA', razonSocial: 'ACME DEMOSTRACION S.A.S.', ciiuPrincipal: '4711', divipolaMunicipio: '11001',
  // Lo que un lector puede ver y NO debe conservarse:
  direccion: 'CALLE FALSA 123', correo: 'demo@ejemplo.test', telefono: '3000000000', responsabilidades: ['05', '42'],
  texto: 'texto completo', imagen: 'base64…',
};

describe('Minimización de datos extraídos', () => {
  it('RUT persona natural: conserva identificación y nombre; descarta dirección, correo, teléfono, responsabilidades y texto', () => {
    const d = minimizarDatosRut(BRUTO_RUT, TipoPersona.NATURAL);
    expect(d).toMatchObject({ tipoPersona: 'natural', nit: '900123456', dv: '7', numeroDocumento: '1000000001', nombres: 'MARIA FERNANDA', apellidos: 'LOPEZ RIVERA', divipolaMunicipio: '11001', ciiuPrincipal: '4711' });
    expect(d.razonSocial).toBeUndefined();
    for (const k of ['direccion', 'correo', 'telefono', 'responsabilidades', 'texto', 'imagen']) expect(d).not.toHaveProperty(k);
    expect(clavesProhibidasEn(d)).toEqual([]);
  });

  it('RUT persona jurídica: conserva la razón social y no los datos de persona natural', () => {
    const d = minimizarDatosRut(BRUTO_RUT, TipoPersona.JURIDICA);
    expect(d.razonSocial).toBe('ACME DEMOSTRACION S.A.S.');
    for (const k of ['nombres', 'apellidos', 'numeroDocumento', 'tipoDocumento', 'direccion', 'correo', 'telefono']) expect(d).not.toHaveProperty(k);
  });

  it('los formatos se validan: un CIIU o un DIVIPOLA mal formados, o una fecha no ISO, se descartan', () => {
    const d = minimizarDatosRut({ ...BRUTO_RUT, ciiuPrincipal: '47', divipolaMunicipio: '110', fechaGeneracion: '15/03/2024', dv: '12' }, TipoPersona.JURIDICA);
    expect(d).toMatchObject({ ciiuPrincipal: null, divipolaMunicipio: null, fechaGeneracion: null, dv: null });
  });

  it('Cámara de persona natural: nunca conserva un representante legal', () => {
    const d = minimizarDatosCamara({ nombreORazonSocial: 'MARIA FERNANDA LOPEZ RIVERA', representanteLegal: 'ALGUIEN' }, 'matricula_mercantil', TipoPersona.NATURAL);
    expect(d.representanteLegal).toBeNull();
    const pj = minimizarDatosCamara({ nombreORazonSocial: 'ACME', representanteLegal: 'ALGUIEN' }, 'existencia_representacion', TipoPersona.JURIDICA);
    expect(pj.representanteLegal).toBe('ALGUIEN');
  });

  it('el estado registral sin valor explícito (o inválido) queda no_determinable', () => {
    expect(minimizarDatosCamara({}, 'matricula_mercantil', TipoPersona.NATURAL).estadoRegistral).toBe('no_determinable');
    expect(minimizarDatosCamara({ estadoRegistral: 'vigente' }, 'matricula_mercantil', TipoPersona.NATURAL).estadoRegistral).toBe('no_determinable');
    expect(minimizarDatosCamara({ estadoRegistral: 'cancelado' }, 'matricula_mercantil', TipoPersona.NATURAL).estadoRegistral).toBe('cancelado');
  });

  it('la URL de verificación se sanea: sin parámetros, fragmento ni credenciales; lo que no es URL se descarta', () => {
    expect(sanearUrlVerificacion('https://verifica.ejemplo.test/cv/39?codigo=SECRETO#x')).toBe('https://verifica.ejemplo.test/cv/39');
    expect(sanearUrlVerificacion('www.camara.ejemplo.test/')).toContain('camara.ejemplo.test');
    expect(sanearUrlVerificacion('https://usuario:clave@verifica.ejemplo.test/')).toBeNull();
    for (const x of ['javascript:alert(1)', 'texto cualquiera', '', null, 5]) expect(sanearUrlVerificacion(x)).toBeNull();
  });

  it('clavesProhibidasEn encuentra las claves en cualquier nivel', () => {
    expect(clavesProhibidasEn({ a: { correo: 'x' }, b: [{ telefono: '1' }], c: 1 }).sort()).toEqual(['a.correo', 'b[0].telefono']);
    expect(clavesProhibidasEn(null)).toEqual([]);
  });
});

describe('Evidencias: sin texto, imágenes, credenciales ni cookies', () => {
  const base = { id: '00000000-0000-4000-8000-0000000000f1', validacionId: '00000000-0000-4000-8000-0000000000e1', intento: 1, tipo: TipoEvidenciaDocumentoEmpresarial.LECTURA_DOCUMENTO, resultado: 'legible', metodo: 'lectura_local_texto', fecha: AHORA, actorId: null, hashDocumento: HASH_A, errorCodigo: null, creadoEn: AHORA };

  it.each(['texto', 'texto_ocr', 'ocr', 'imagen', 'direccion', 'correo', 'telefono', 'token', 'cookie', 'authorization', 'url_con_credenciales'])('rechaza la clave «%s»', (k) => {
    expect(() => EvidenciaDocumentoEmpresarial.crear({ ...base, datos: { [k]: 'x' } })).toThrow(EvidenciaDocumentoEmpresarialInvalidaError);
  });

  it('rechaza una clave prohibida anidada, un hash que no es SHA-256 y una decisión humana sin actor', () => {
    expect(() => EvidenciaDocumentoEmpresarial.crear({ ...base, datos: { detalle: { correo: 'x' } } })).toThrow(/correo/);
    expect(() => EvidenciaDocumentoEmpresarial.crear({ ...base, hashDocumento: 'abc', datos: {} })).toThrow(/SHA-256/);
    expect(() => EvidenciaDocumentoEmpresarial.crear({ ...base, tipo: TipoEvidenciaDocumentoEmpresarial.DECISION_HUMANA, datos: {} })).toThrow(/quién/);
  });

  it('las evidencias de lectura y de clasificación solo llevan métricas y códigos', () => {
    const v = validacionPendiente();
    v.iniciarProcesamiento(AHORA);
    const lectura = evidenciaDeLectura({ ...v.instantanea(), hashDocumento: HASH_A }, { metodo: 'ocr', paginas: 1, paginasOcr: 1, confianzaOcrMedia: 0.74, lecturaDudosa: true }, AHORA).instantanea();
    expect(lectura.datos).toEqual({ metodo: 'ocr', paginas: 1, paginasOcr: 1, confianzaOcrMedia: 0.74, lecturaDudosa: true, limitesAplicados: [] });
    expect(lectura.resultado).toBe('dudosa');
    const clasif = evidenciaDeClasificacion({ ...v.instantanea(), hashDocumento: HASH_A, tipoDetectado: 'rut_persona_juridica' as never, expectativa: 'persona_distinta' }, ['rut_titulo'], AHORA).instantanea();
    expect(clasif.datos).toEqual({ tipoEsperado: 'rut_natural', tipoDetectado: 'rut_persona_juridica', expectativa: 'persona_distinta', motivos: ['rut_titulo'] });
    expect(() => evidenciaDeClasificacion({ ...v.instantanea(), hashDocumento: HASH_A }, [], AHORA)).toThrow(/clasificación/);
  });
});
