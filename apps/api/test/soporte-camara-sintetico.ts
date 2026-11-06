import { CEDULA_NATURAL, DV_JURIDICA, DV_NATURAL, NIT_JURIDICA, NOMBRE_PERSONA, RAZON_SOCIAL, REPRESENTANTE } from './soporte-documento-empresarial';

/**
 * Páginas SINTÉTICAS de certificados de Cámara con la ESTRUCTURA de los formatos reales (etiquetas, encabezados repetidos, cargos
 * partidos alrededor del nombre…), pero con texto y datos inventados. Nada de aquí viene de un documento real.
 */

const RELLENO_PAGINA = 'Texto sintético de relleno que ocupa espacio como lo haría el resto del certificado. '.repeat(4);

export interface OpcionesCamara {
  /** Número de página total simulado (se rellena con páginas de relleno antes de la tabla de representantes). */
  paginasDeRelleno?: number;
  codigo?: string | null;
  dias?: number | null;
  url?: string;
  dv?: string;
  nit?: string;
  matricula?: string;
  estado?: string | null;
  sinRepresentante?: boolean;
  fechaExpedicion?: string;
  nombre?: string;
}

const encabezado = (titulo: string, o: OpcionesCamara): string => [
  'CÁMARA DE COMERCIO DE CIUDAD DEMO', titulo, `Fecha expedición: ${o.fechaExpedicion ?? '10/09/2026'} - 10:00:00`, 'Recibo No. S000000001, Valor 6500',
  o.codigo === null ? '' : `CÓDIGO DE VERIFICACIÓN ${o.codigo ?? 'xY7kQ2mP9z'}`,
  `Verifique el contenido y confiabilidad de este certificado, ingresando a ${o.url ?? 'https://verifica.ejemplo.test/cv/12'} y digite el respectivo código, para que visualice la imagen generada al momento de su expedición.`,
  o.dias === null ? 'La verificación se puede realizar sin costo.' : `La verificación se puede realizar de manera ilimitada, durante ${o.dias ?? 60} días calendario contados a partir de la fecha de su expedición.`,
  'CON FUNDAMENTO EN LA MATRÍCULA E INSCRIPCIONES EFECTUADAS EN EL REGISTRO MERCANTIL, LA CÁMARA DE COMERCIO CERTIFICA:',
].filter(Boolean).join('\n');

const estado = (o: OpcionesCamara): string => (o.estado ? `Estado de la matrícula: ${o.estado}\n` : '');

/** A · Matrícula de persona natural (formato Confecámaras). */
export function paginasCamaraPn(o: OpcionesCamara = {}): string[] {
  const nit = o.nit ?? CEDULA_NATURAL;
  return [
    [encabezado('CERTIFICADO DE MATRÍCULA MERCANTIL DE PERSONA NATURAL', o), 'NOMBRE, IDENTIFICACIÓN Y DOMICILIO',
      `Nombres y apellidos : ${o.nombre ?? NOMBRE_PERSONA}`, `Identificación : CC. - ${nit}`, `Nit : ${nit}-${o.dv ?? DV_NATURAL}`, 'Domicilio: Ciudad Demo, Departamento Demo',
      'MATRÍCULA', `Matrícula No: ${o.matricula ?? '123456'}`, 'Fecha de matrícula: 17 de enero de 2018', 'Ultimo año renovado: 2026', 'Fecha de renovación: 31 de marzo de 2026',
      estado(o), 'UBICACIÓN', 'Dirección del domicilio principal : CALLE FICTICIA 1 # 2-3', 'Correo electrónico : persona@ejemplo.test', 'Teléfono comercial 1 : 3000000000',
      'ACTIVIDAD ECONÓMICA', 'Actividad principal Código CIIU: G4711'].join('\n'),
    RELLENO_PAGINA, RELLENO_PAGINA,
  ];
}

/** B · Matrícula de sociedad (formato Confecámaras): el título no dice la persona; el representante figura como fila de nombramientos. */
export function paginasCamaraSociedad(o: OpcionesCamara = {}): string[] {
  return [
    [encabezado('CERTIFICADO DE MATRÍCULA MERCANTIL', o), 'NOMBRE, IDENTIFICACIÓN Y DOMICILIO', `Razón Social : ${o.nombre ?? RAZON_SOCIAL}`,
      `Nit : ${o.nit ?? NIT_JURIDICA}-${o.dv ?? DV_JURIDICA}`, 'Domicilio: Ciudad Demo', 'MATRÍCULA', `Matrícula No: ${o.matricula ?? '654321'}`,
      'Fecha de matrícula: 17 de enero de 2018', 'Ultimo año renovado: 2026', 'Fecha de renovación: 31 de marzo de 2026', estado(o), 'UBICACIÓN',
      'Dirección del domicilio principal : CRA 1 N 2-3', 'Municipio : Ciudad Demo'].join('\n'),
    o.sinRepresentante ? RELLENO_PAGINA
      : ['NOMBRAMIENTOS REPRESENTANTES LEGALES', 'Por Acta No. 1 de la Asamblea se designó a:', 'CARGO NOMBRE IDENTIFICACION', `REPRESENTANTE LEGAL ${REPRESENTANTE} C.C. No. 79.123.456`,
        'CLASIFICACIÓN DE ACTIVIDADES ECONÓMICAS - CIIU', 'Actividad principal Código CIIU: F4321'].join('\n'),
  ];
}

/**
 * C · Existencia y representación (formato Bogotá): el cargo «Representante Legal» queda partido alrededor del nombre
 * («Representante NOMBRE C.C. No. … Legal»). Con `paginasDeRelleno` la tabla queda en una página lejana.
 */
export function paginasCamaraExistencia(o: OpcionesCamara = {}): string[] {
  const relleno = Array.from({ length: o.paginasDeRelleno ?? 0 }, () => RELLENO_PAGINA);
  const tabla = o.sinRepresentante ? RELLENO_PAGINA
    : ['REPRESENTANTES LEGALES', 'Por Acta no. 1 se designó a: CARGO NOMBRE IDENTIFICACIÓN', `Representante ${REPRESENTANTE} C.C. No. 79123456 Legal`, 'SITUACIÓN DE CONTROL Y/O GRUPO EMPRESARIAL'].join('\n');
  return [
    [encabezado('CERTIFICADO DE EXISTENCIA Y REPRESENTACIÓN LEGAL', o), 'NOMBRE, IDENTIFICACIÓN Y DOMICILIO', `Razón social: ${o.nombre ?? RAZON_SOCIAL}`, 'Sigla: ACME',
      `Nit: ${o.nit ?? NIT_JURIDICA} ${o.dv ?? DV_JURIDICA}`, 'Administración : Direccion Seccional De Impuestos', 'Domicilio principal: Ciudad Demo', 'MATRÍCULA',
      `Matrícula No. ${o.matricula ?? '00654321'}`, 'Fecha de matrícula: 17 de enero de 2018', 'Último año renovado: 2026', 'Fecha de renovación: 15 de junio de 2026', estado(o), 'UBICACIÓN',
      'Dirección del domicilio principal: Cl 1 # 2-3', 'Municipio: Ciudad Demo'].join('\n'),
    ...relleno, tabla,
  ];
}

/** Formato antiguo (todo en mayúsculas): fecha de expedición sin etiqueta, «N.I.T.», «MATRICULA NO : n DEL fecha». */
export function paginasCamaraFormatoAntiguo(): string[] {
  return [[
    'CAMARA DE COMERCIO DE CIUDAD DEMO SEDE VIRTUAL', `CÓDIGO VERIFICACIÓN: B123456789CB12 19 DE AGOSTO DE 2026 HORA 10:20:30 AB123456789 PÁGINA: 1 DE 3`,
    'ESTE CERTIFICADO FUE GENERADO ELECTRÓNICAMENTE Y CUENTA CON UN CÓDIGO DE VERIFICACIÓN QUE LE PERMITE SER VALIDADO ILIMITADAMENTE DURANTE 60 DÍAS, INGRESANDO A WWW.EJEMPLO.TEST',
    'CERTIFICADO DE MATRICULA DE PERSONA NATURAL', 'LA CAMARA DE COMERCIO DE CIUDAD DEMO, CON FUNDAMENTO EN LAS MATRICULAS E INSCRIPCIONES DEL REGISTRO MERCANTIL CERTIFICA:',
    `NOMBRE : ${NOMBRE_PERSONA} C.C. : 1.000.000.001 N.I.T. : ${CEDULA_NATURAL} ${DV_NATURAL} ADMINISTRACION : , REGIMEN SIMPLIFICADO`,
    'CERTIFICA: MATRICULA NO : 12345678 DEL 4 DE JULIO DE 2019', 'CERTIFICA: ULTIMO AÑO RENOVADO: 2026', 'ACTIVIDAD ECONOMICA : 1690 FABRICACIÓN DE OTROS PRODUCTOS',
  ].join('\n'), RELLENO_PAGINA];
}
