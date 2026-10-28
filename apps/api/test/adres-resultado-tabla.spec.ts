import PDFDocument from 'pdfkit';
import { EstadoAdres } from '../src/domain/entities/adres';
import { AfiliacionEps, AutenticidadEps, CoincidenciaEps } from '../src/domain/entities/validacion-eps.entity';
import {
  esFechaDeContinuidadAdres, evaluarResultadoAdres, extraerDatosAdres,
} from '../src/domain/services/adres-resultado.domain-service';
import { LecturaLocalAdresService } from '../src/domain/services/lectura-local-adres.domain-service';
import { claveEps, mismaEps } from '../src/domain/services/normalizacion-identidad';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';

/**
 * El resultado de ADRES/BDUA es una TABLA (columna izquierda = etiqueta, derecha = valor) y pdf.js entrega cada celda como
 * fragmentos sueltos, con las etiquetas partidas en varias líneas. Fixtures SINTÉTICOS (ninguna persona real) que reproducen
 * ese layout: la tabla de datos básicos es VERTICAL y la de afiliación es HORIZONTAL (encabezados y, después, la fila de datos).
 */

interface Opciones {
  tipo?: string; numero?: string | null; nombres?: string | null; apellidos?: string | null; estado?: string | null;
  entidad?: string[]; regimen?: string | null; afiliacion?: string | null; finalizacion?: string | null; tipoAfiliado?: string | null;
  tildes?: boolean; impresion?: string | null;
}

/** Líneas tal como las deja el lector (cada fragmento en su línea). */
function lineasAdres(o: Opciones = {}): string[] {
  const t = o.tildes ?? true;
  const ident = t ? 'IDENTIFICACIÓN' : 'IDENTIFICACION';
  const num = o.numero === undefined ? '123456789' : o.numero;
  const nombres = o.nombres === undefined ? 'PERSONA' : o.nombres;
  const apellidos = o.apellidos === undefined ? 'PRUEBA EJEMPLO' : o.apellidos;
  const estado = o.estado === undefined ? 'ACTIVO' : o.estado;
  const regimen = o.regimen === undefined ? 'CONTRIBUTIVO' : o.regimen;
  const aflia = o.afiliacion === undefined ? '01/01/2024' : o.afiliacion;
  const fin = o.finalizacion === undefined ? '31/12/2999' : o.finalizacion;
  const tipoAf = o.tipoAfiliado === undefined ? 'COTIZANTE' : o.tipoAfiliado;
  const entidad = o.entidad ?? ['EPS PRUEBA'];
  const nul = <T>(v: T | null): T[] => (v === null ? [] : [v]);
  return [
    'Administradora de los Recursos del Sistema General de Seguridad Social en Salud - ADRES',
    'Información de afiliación en la Base de Datos Única de Afiliados – BDUA en el Sistema General de',
    'Resultados de la consulta', 'Información Básica del Afiliado :', 'COLUMNAS', 'DATOS',
    'TIPO DE', ident, o.tipo ?? 'CC',
    'NÚMERO DE', ident, ...nul(num),
    'NOMBRES', ...nul(nombres),
    'APELLIDOS', ...nul(apellidos),
    'FECHA DE NACIMIENTO', '01/01/1990', 'DEPARTAMENTO', 'BOGOTA D.C.', 'MUNICIPIO', 'BOGOTA D.C.',
    'Datos de afiliación :',
    'ESTADO', 'ENTIDAD', 'REGIMEN', 'FECHA DE', t ? 'AFILIACIÓN' : 'AFILIACION', 'EFECTIVA',
    'FECHA DE', t ? 'FINALIZACIÓN' : 'FINALIZACION', t ? 'DE AFILIACIÓN' : 'DE AFILIACION', 'TIPO DE', 'AFILIADO',
    ...nul(estado), ...entidad, ...nul(regimen), ...nul(aflia), ...nul(fin), ...nul(tipoAf),
    'Fecha de', ...(o.impresion === null ? [] : ['Impresión:', o.impresion ?? '10/28/2026', '10:11:43']),
    'Estación', 'de', 'origen:', '192.168.70.220',
    'La información registrada en esta página es reflejo de lo reportado por las entidades del Régimen',
  ];
}
const texto = (o?: Opciones): string => lineasAdres(o).join('\n');
const leer = (o?: Opciones) => extraerDatosAdres(texto(o));

describe('ADRES · tabla con etiquetas partidas', () => {
  it('lee todos los campos de la tabla real: vertical (datos básicos) y horizontal (afiliación)', () => {
    const { datos, pareceResultadoAdres } = leer();
    expect(pareceResultadoAdres).toBe(true);
    expect(datos).toMatchObject({
      tipoDocumento: 'CC', numeroDocumento: '123456789', nombres: 'PERSONA', apellidos: 'PRUEBA EJEMPLO', nombre: 'PERSONA PRUEBA EJEMPLO',
      estadoAfiliacion: 'ACTIVO', eps: 'EPS PRUEBA', regimen: 'CONTRIBUTIVO', tipoAfiliado: 'COTIZANTE',
      fechaAfiliacion: '2024-01-01', fechaFinalizacion: '2999-12-31', afiliacionContinua: true, fechaConsulta: '2026-10-28',
    });
  });

  it.each([[true], [false]])('con y sin tildes (tildes=%s): etiquetas «IDENTIFICACIÓN», «AFILIACIÓN» y «FINALIZACIÓN»', (tildes) => {
    const { datos } = leer({ tildes });
    expect(datos).toMatchObject({ tipoDocumento: 'CC', numeroDocumento: '123456789', fechaAfiliacion: '2024-01-01', fechaFinalizacion: '2999-12-31' });
  });

  it('«IDENTIFICACIÓN» partida NO hace que el tipo («CC») se lea como el número de documento', () => {
    expect(leer().datos.numeroDocumento).toBe('123456789');
    expect(leer().datos.tipoDocumento).toBe('CC');
  });

  it('entidad en varias líneas: se reconstruye antes de comparar', () => {
    const { datos } = leer({ entidad: ['CAJA DE', 'COMPENSACIÓN', 'FAMILIAR', 'COMPENSAR'] });
    expect(datos.eps).toBe('CAJA DE COMPENSACIÓN FAMILIAR COMPENSAR');
    expect(datos.regimen).toBe('CONTRIBUTIVO'); // la entidad no se traga el régimen que sigue
    expect(datos.estadoAfiliacion).toBe('ACTIVO');
  });

  it('la figura jurídica de la caja no impide reconocer la EPS («CAJA DE COMPENSACIÓN FAMILIAR COMPENSAR» = «EPS Compensar»)', () => {
    const adres = 'CAJA DE COMPENSACIÓN FAMILIAR COMPENSAR';
    expect(claveEps(adres)).toBe('COMPENSAR');
    expect(mismaEps(adres, 'EPS Compensar')).toBe(true);
    expect(mismaEps(adres, 'Entidad Promotora de Salud NUEVA EPS S.A')).toBe(false);
  });

  it('nombres y apellidos separados; el nombre completo es su unión', () => {
    const { datos } = leer({ nombres: 'MARIA JOSE', apellidos: 'GOMEZ PEREZ' });
    expect(datos).toMatchObject({ nombres: 'MARIA JOSE', apellidos: 'GOMEZ PEREZ', nombre: 'MARIA JOSE GOMEZ PEREZ' });
  });

  it.each([['CC'], ['TI'], ['CE'], ['RC'], ['PA']])('tipo de documento %s', (tipo) => {
    expect(leer({ tipo, numero: '987654321' }).datos).toMatchObject({ tipoDocumento: tipo, numeroDocumento: '987654321' });
  });

  it('el número conserva los ceros iniciales', () => {
    expect(leer({ tipo: 'TI', numero: '0012345678' }).datos.numeroDocumento).toBe('0012345678');
  });

  it.each([['SUBSIDIADO'], ['CONTRIBUTIVO']])('régimen %s', (regimen) => {
    expect(leer({ regimen }).datos.regimen).toBe(regimen);
  });

  it.each([['ACTIVO'], ['INACTIVO'], ['RETIRADO'], ['SUSPENDIDO']])('estado %s', (estado) => {
    expect(leer({ estado }).datos.estadoAfiliacion).toBe(estado);
  });

  it('fecha de finalización 31/12/2999: continuidad de la afiliación, no una terminación real; la fecha original se conserva', () => {
    const { datos } = leer({ finalizacion: '31/12/2999' });
    expect(datos.fechaFinalizacion).toBe('2999-12-31');
    expect(datos.afiliacionContinua).toBe(true);
    expect(esFechaDeContinuidadAdres('2999-12-31')).toBe(true);
    expect(esFechaDeContinuidadAdres('2024-12-31')).toBe(false);
    expect(leer({ finalizacion: '15/06/2025' }).datos).toMatchObject({ fechaFinalizacion: '2025-06-15', afiliacionContinua: false });
  });

  it('la fecha de impresión (MM/DD/AAAA) se lee aunque el «día» no quepa como mes', () => {
    expect(leer({ impresion: '10/28/2026' }).datos.fechaConsulta).toBe('2026-10-28');
    expect(leer({ impresion: '28/10/2026' }).datos.fechaConsulta).toBe('2026-10-28');
  });

  describe('campo faltante: queda ausente, no se inventa ni se corre al valor del siguiente', () => {
    it('sin número de documento', () => {
      const { datos } = leer({ numero: null });
      expect(datos.numeroDocumento).toBeNull();
      expect(datos.nombres).toBe('PERSONA'); // el vacío no arrastra el valor de la etiqueta que sigue
    });
    it('sin estado (la fila horizontal no se desplaza)', () => {
      const { datos } = leer({ estado: null });
      expect(datos.estadoAfiliacion).toBeNull();
      expect(datos).toMatchObject({ eps: 'EPS PRUEBA', regimen: 'CONTRIBUTIVO', tipoAfiliado: 'COTIZANTE', fechaAfiliacion: '2024-01-01' });
    });
    it('sin tipo de afiliado ni finalización', () => {
      const { datos } = leer({ tipoAfiliado: null, finalizacion: null });
      expect(datos.tipoAfiliado).toBeNull();
      expect(datos.fechaFinalizacion).toBeNull();
      expect(datos).toMatchObject({ estadoAfiliacion: 'ACTIVO', regimen: 'CONTRIBUTIVO' });
    });
  });

  it('un texto cualquiera no es un resultado de ADRES y no produce datos', () => {
    const r = extraerDatosAdres('Hola mundo\nesto no es una tabla\nESTADO de cosas');
    expect(r.pareceResultadoAdres).toBe(false);
    expect(Object.entries(r.datos).filter(([k, v]) => v !== null && v !== false && k !== 'afiliacionContinua')).toEqual([]);
  });

  it('el formato «ETIQUETA: valor» en una línea (no tabla) sigue funcionando', () => {
    const r = extraerDatosAdres('ADRES BDUA\nTIPO DE DOCUMENTO: CC\nNUMERO DE DOCUMENTO: 123456789\nNOMBRES: PERSONA\nAPELLIDOS: PRUEBA\nESTADO: ACTIVO\nREGIMEN: SUBSIDIADO');
    expect(r.datos).toMatchObject({ tipoDocumento: 'CC', numeroDocumento: '123456789', nombre: 'PERSONA PRUEBA', estadoAfiliacion: 'ACTIVO', regimen: 'SUBSIDIADO' });
  });
});

describe('ADRES · vinculación al estudiante y contraste', () => {
  const entrada = (o: Opciones, sipra = { tipoDocumento: 'CC', numeroDocumento: '123456789', nombre: 'Persona Prueba Ejemplo' }) => evaluarResultadoAdres({
    datos: leer(o).datos, sipra, certificado: null, autenticidad: AutenticidadEps.NO_EVALUADA,
    coincidenciaCertificado: CoincidenciaEps.INSUFICIENTE, vigencia: 'vigente', hayBanderaCritica: false,
  });

  it('documento, tipo y nombre coinciden: queda ATADO (procesado) y la afiliación ACTIVA, con 31/12/2999 incluido', () => {
    const r = entrada({});
    expect(r).toMatchObject({ estado: EstadoAdres.PROCESADO, error: null, afiliacion: AfiliacionEps.ACTIVA });
    expect(r.comparacion.find((c) => c.campo === 'nombre')).toMatchObject({ resultado: 'coincide' });
  });

  it('el nombre se compara normalizado (orden, tildes y mayúsculas no importan)', () => {
    const r = entrada({ nombres: 'JOSÉ', apellidos: 'MUÑOZ PÉREZ' }, { tipoDocumento: 'CC', numeroDocumento: '123456789', nombre: 'Muñoz Pérez José' });
    expect(r.estado).toBe(EstadoAdres.PROCESADO);
  });

  it('documento DIFERENTE al del estudiante: no se ata y la discrepancia es crítica', () => {
    const r = entrada({ numero: '555555555' });
    expect(r).toMatchObject({ estado: EstadoAdres.NO_DETERMINABLE, error: 'documento_no_corresponde', afiliacion: null });
    expect(r.comparacion.find((c) => c.campo === 'numero_documento')).toMatchObject({ resultado: 'diferente', critico: true });
  });

  it('sin documento en el resultado: «sin_documento_en_resultado» (solo cuando de verdad no está)', () => {
    expect(entrada({ numero: null })).toMatchObject({ estado: EstadoAdres.NO_DETERMINABLE, error: 'sin_documento_en_resultado' });
  });

  it('nombre diferente con el mismo documento: no se ata', () => {
    expect(entrada({ nombres: 'OTRA', apellidos: 'PERSONA DISTINTA' }).error).toBe('nombre_no_corresponde');
  });

  it('estado INACTIVO atado: afiliación inactiva', () => {
    expect(entrada({ estado: 'INACTIVO' })).toMatchObject({ estado: EstadoAdres.PROCESADO, afiliacion: AfiliacionEps.INACTIVA });
  });
});

describe('ADRES · PDF de extremo a extremo (pdf.js real, sin capa de texto adicional)', () => {
  const lector = new LectorDocumentoLocalAdapter();
  const servicio = new LecturaLocalAdresService(lector);
  afterAll(async () => { await lector.onModuleDestroy(); });

  /** Dibuja la tabla como lo hace el navegador al imprimir: cada celda es un texto aparte, con las etiquetas partidas. */
  function pdfDeTabla(o: Opciones = {}): Promise<Buffer> {
    return new Promise((ok) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const partes: Buffer[] = [];
      doc.on('data', (c: Buffer) => partes.push(c));
      doc.on('end', () => ok(Buffer.concat(partes)));
      for (const l of lineasAdres(o)) { doc.fontSize(11).text(l); doc.moveDown(0.2); }
      doc.end();
    });
  }

  it('lee la tabla desde un PDF y devuelve todos los campos', async () => {
    const r = await servicio.leer(await pdfDeTabla());
    expect(r.error).toBeNull();
    expect(r.lectura?.datos).toMatchObject({
      tipoDocumento: 'CC', numeroDocumento: '123456789', nombre: 'PERSONA PRUEBA EJEMPLO', eps: 'EPS PRUEBA', regimen: 'CONTRIBUTIVO',
      estadoAfiliacion: 'ACTIVO', tipoAfiliado: 'COTIZANTE', fechaAfiliacion: '2024-01-01', fechaFinalizacion: '2999-12-31', afiliacionContinua: true,
    });
  });

  it('entidad en varias líneas desde un PDF', async () => {
    const r = await servicio.leer(await pdfDeTabla({ entidad: ['CAJA DE', 'COMPENSACIÓN', 'FAMILIAR', 'COMPENSAR'] }));
    expect(r.lectura?.datos.eps).toBe('CAJA DE COMPENSACIÓN FAMILIAR COMPENSAR');
  });

  it('PDF corrupto: «pdf_ilegible» y ningún dato', async () => {
    const pdf = await pdfDeTabla();
    const r = await servicio.leer(pdf.subarray(0, 120));
    expect(r.error).toBe('pdf_ilegible');
    expect(r.lectura).toBeNull();
  });
});
