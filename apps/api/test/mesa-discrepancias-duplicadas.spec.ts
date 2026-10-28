import { ComparacionTripleCampo, DatosAdres } from '../src/domain/entities/adres';
import {
  AfiliacionEps, AutenticidadEps, DatosExtraidosEps, DatosValidacionEps, EstadoProcesamientoEps,
} from '../src/domain/entities/validacion-eps.entity';
import { compararTriple } from '../src/domain/services/adres-resultado.domain-service';
import {
  DiscrepanciaLegible, claveDiscrepancia, construirDiscrepancias, deduplicarDiscrepancias,
} from '../src/domain/services/mesa-eps.domain-service';

/**
 * Cada discrepancia LÓGICA aparece una sola vez. Clave: campo + causa + fuentes implicadas (sin importar el orden del par) + severidad;
 * nunca el texto visible. Dos pares de fuentes distintos en el mismo campo SON dos discrepancias (SIPRA≠ADRES y certificado≠ADRES).
 */

const SIPRA = { tipoDocumento: 'CC', numeroDocumento: '123456789', nombre: 'Persona Prueba Ejemplo' };
const CERT_OK: DatosExtraidosEps = {
  tipoDocumento: 'CC', numeroDocumento: '123456789', nombre: 'PERSONA PRUEBA EJEMPLO', eps: 'EPS PRUEBA', epsClave: 'PRUEBA',
  regimen: 'contributivo', tipoAfiliado: 'cotizante', estadoReportadoCertificado: 'ACTIVO', fechaExpedicion: '2026-10-20',
};
const ADRES_OK: DatosAdres = {
  tipoDocumento: 'CC', numeroDocumento: '123456789', nombre: 'PERSONA PRUEBA EJEMPLO', eps: 'EPS PRUEBA', regimen: 'CONTRIBUTIVO',
  estadoAfiliacion: 'ACTIVO', fechaAfiliacion: '2024-01-01', fechaFinalizacion: null, fechaConsulta: null, fuenteActualizadaEn: null,
};

function validacion(cert: DatosExtraidosEps | null, extra: Partial<DatosValidacionEps> = {}): DatosValidacionEps {
  return {
    estadoProcesamiento: EstadoProcesamientoEps.PROCESADO, afiliacion: AfiliacionEps.NO_CONTRASTADA, autenticidad: AutenticidadEps.NO_EVALUADA,
    hayBanderaCritica: false, datosExtraidos: cert, vigenciaCertificado: 'vigente', discrepancias: [], ...extra,
  } as unknown as DatosValidacionEps;
}
const construir = (o: { cert?: DatosExtraidosEps | null; adres?: DatosAdres | null; extra?: Partial<DatosValidacionEps> }) => {
  const cert = o.cert === undefined ? CERT_OK : o.cert;
  const triple = compararTriple(o.adres ?? { ...ADRES_OK, tipoDocumento: null, numeroDocumento: null, nombre: null, eps: null, regimen: null, estadoAfiliacion: null }, SIPRA, cert);
  return { lista: construirDiscrepancias(validacion(cert, o.extra), triple), triple };
};
const delCampo = (l: DiscrepanciaLegible[], campo: string) => l.filter((x) => x.campo === campo && x.codigo === 'diferencia');
const pares = (l: DiscrepanciaLegible[], campo: string) => delCampo(l, campo).map((x) => x.fuentes.join('+')).sort();
const sinRepetidos = (l: DiscrepanciaLegible[]) => new Set(l.map(claveDiscrepancia)).size === l.length;

describe('Mesa EPS · una discrepancia lógica, una sola vez', () => {
  it('1) SIPRA ≠ certificado, sin ADRES: una discrepancia de nombre (y la de documento si también difiere)', () => {
    const { lista } = construir({ cert: { ...CERT_OK, nombre: 'OTRA PERSONA DISTINTA' } });
    expect(pares(lista, 'nombre')).toEqual(['certificado+sipra']);
    expect(delCampo(lista, 'nombre')[0]).toMatchObject({ severidad: 'critica', titulo: 'Diferencia en el nombre' });
    expect(sinRepetidos(lista)).toBe(true);
  });

  it('2) SIPRA ≠ ADRES, certificado coincide con SIPRA: solo el par SIPRA–ADRES y el certificado–ADRES (el certificado también difiere de ADRES)', () => {
    const { lista } = construir({ adres: { ...ADRES_OK, nombre: 'NOMBRE DISTINTO DE ADRES' } });
    expect(pares(lista, 'nombre')).toEqual(['adres+certificado', 'adres+sipra']);
    expect(sinRepetidos(lista)).toBe(true);
  });

  it('3) certificado ≠ ADRES, SIPRA coincide con el certificado: SIPRA y el certificado NO chocan; chocan ADRES con ambos', () => {
    const { lista } = construir({ adres: { ...ADRES_OK, numeroDocumento: '555555555' } });
    expect(pares(lista, 'numero_documento')).toEqual(['adres+certificado', 'adres+sipra']);
    expect(pares(lista, 'numero_documento')).not.toContain('certificado+sipra');
  });

  it('4) los tres nombres distintos: TRES discrepancias (cada par es distinta), ninguna repetida', () => {
    const { lista } = construir({
      cert: { ...CERT_OK, nombre: 'NOMBRE DEL CERTIFICADO' }, adres: { ...ADRES_OK, nombre: 'NOMBRE DE ADRES' },
    });
    expect(pares(lista, 'nombre')).toEqual(['adres+certificado', 'adres+sipra', 'certificado+sipra']);
    expect(new Set(delCampo(lista, 'nombre').map((x) => x.explicacion)).size).toBe(3);
    expect(sinRepetidos(lista)).toBe(true);
  });

  it('5) la misma discrepancia por dos caminos internos (mismo par, o el par escrito al revés) se cuenta una vez', () => {
    const { triple } = construir({ adres: { ...ADRES_OK, nombre: 'NOMBRE DE ADRES' } });
    const nombre = triple.find((c) => c.campo === 'nombre') as ComparacionTripleCampo;
    const duplicada: ComparacionTripleCampo[] = triple.map((c) => (c.campo === 'nombre'
      ? { ...nombre, conflictos: [...nombre.conflictos, nombre.conflictos[0], 'adres_vs_sipra' as never] } : c));
    const lista = construirDiscrepancias(validacion(CERT_OK), duplicada);
    expect(pares(lista, 'nombre')).toEqual(['adres+certificado', 'adres+sipra']);
    expect(sinRepetidos(lista)).toBe(true);
  });

  it('6) documento y nombre distintos a la vez: dos campos, cada uno con sus pares, sin cruzarse', () => {
    const { lista } = construir({ cert: { ...CERT_OK, numeroDocumento: '999999999', nombre: 'OTRA PERSONA DISTINTA' } });
    expect(pares(lista, 'numero_documento')).toEqual(['certificado+sipra']);
    expect(pares(lista, 'nombre')).toEqual(['certificado+sipra']);
    expect(lista.filter((x) => x.severidad === 'critica').map((x) => x.campo).sort()).toEqual(['nombre', 'numero_documento']);
  });

  it('7) información insuficiente: una por campo faltante, sin repetir, y sin conflictos inventados', () => {
    const { lista } = construir({ cert: { ...CERT_OK, numeroDocumento: null, nombre: null, fechaExpedicion: null } });
    expect(lista.filter((x) => x.severidad === 'insuficiente').map((x) => x.campo).sort()).toEqual(['fecha_expedicion', 'nombre', 'numero_documento']);
    expect(delCampo(lista, 'nombre')).toEqual([]);
    expect(sinRepetidos(lista)).toBe(true);
  });

  it('8) persistida + calculada equivalentes: la misma discrepancia del verificador oficial listada dos veces se muestra una vez', () => {
    const persistida = { campo: 'nombre', esperado: 'a', observado: 'b', comparacion: 'oficial_vs_certificado', resultado: 'diferente' } as never;
    const { lista } = construir({ extra: { discrepancias: [persistida, persistida] } });
    expect(lista.filter((x) => x.codigo === 'oficial_vs_certificado' && x.campo === 'nombre')).toHaveLength(1);
    // Y una lectura distinta (texto vs OCR) en el mismo campo tampoco se duplica.
    const fuentes = { campo: 'nombre', esperado: null, observado: null, resultado: 'fuentes_distintas' } as never;
    expect(construir({ extra: { discrepancias: [fuentes, fuentes] } }).lista.filter((x) => x.codigo === 'lecturas_distintas')).toHaveLength(1);
  });

  it('el mismo texto con OTRAS fuentes NO es un duplicado; la misma causa con otra redacción SÍ lo es', () => {
    const base: DiscrepanciaLegible = { severidad: 'critica', campo: 'nombre', titulo: 'Diferencia en el nombre', explicacion: 'x', codigo: 'diferencia', fuentes: ['adres', 'sipra'] };
    expect(deduplicarDiscrepancias([base, { ...base, fuentes: ['adres', 'certificado'] }])).toHaveLength(2);
    expect(deduplicarDiscrepancias([base, { ...base, explicacion: 'redactado distinto', fuentes: ['sipra', 'adres'] }])).toHaveLength(1);
    expect(deduplicarDiscrepancias([base, { ...base, severidad: 'informativa' }])).toHaveLength(2);
  });

  it('el orden y el contenido de lo que no se repite no cambian (primera aparición)', () => {
    const { lista } = construir({ cert: { ...CERT_OK, nombre: 'OTRA PERSONA DISTINTA' }, adres: { ...ADRES_OK, nombre: 'NOMBRE DE ADRES' }, extra: { hayBanderaCritica: true } });
    expect(lista.map((x) => `${x.campo}:${x.codigo}`)).toEqual([
      'nombre:diferencia', 'nombre:diferencia', 'nombre:diferencia', 'documento:alerta_documento',
    ]);
  });
});
