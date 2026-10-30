import { DatosSipraActa } from '../src/domain/entities/acta-iniciacion';

/**
 * Textos SINTÉTICOS de actas de iniciación para las pruebas. Reproducen la ESTRUCTURA de los
 * formatos institucionales (rótulos, secciones y el orden en que pdf.js entrega los fragmentos:
 * un fragmento por línea) con contenido inventado. Ningún documento ni dato personal real.
 */

export interface OpcionesActa {
  remuneracion?: 'remunerada' | 'no_remunerada' | 'sin_titulo';
  /** Lo que dice el encabezado: quién asume la ARL. */
  encabezadoArl?: 'empresa' | 'cun' | 'ambas' | 'ninguna';
  /** Bajo qué sección figura la obligación de afiliar a la ARL. */
  obligacionArl?: 'empresa' | 'institucion' | 'ambas' | 'ninguna';
  etiquetaTipo?: 'Tipo de Practica' | 'Modalidad de Practica';
  rotuloFunciones?: 'funciones' | 'actividades';
  codigo?: string;
  valores?: Partial<Record<keyof typeof VALORES_BASE, string>>;
  /** Omite los rótulos de firma. */
  sinRotulosFirma?: boolean;
}

export const VALORES_BASE = {
  nombre: 'Ana Maria Prueba Sintetica',
  documento: 'C.C. 1.000.000.001',
  lugar: 'Bogota',
  direccion: 'Calle 1 # 2-3',
  barrio: 'Barrio Ficticio',
  telefono: '3000000000',
  semestre: '7',
  programa: 'Administracion de Empresas',
  tipo: 'Contrato de aprendizaje',
  empresa: 'Empresa Sintetica S.A.S.',
  nit: '900.123.456-8',
  representante: 'Carlos Representante Ficticio',
  documentoRepresentante: '1.000.000.002',
  direccionPractica: 'Carrera 4 # 5-6',
  ciudad: 'Bogota',
  departamento: 'Cundinamarca',
  telefonoEmpresa: '6010000000',
  jefe: 'Laura Jefe Ficticia',
  documentoJefe: '1.000.000.003',
  inicio: '17/03/2026',
  fin: '17/09/2026',
  monitor: 'Pedro Monitor Ficticio',
  funciones: 'Apoyo en gestion documental y atencion de solicitudes internas',
};

const TITULO: Record<NonNullable<OpcionesActa['remuneracion']>, string> = {
  remunerada: 'INICIACIÓN PRÁCTICAS REMUNERADAS',
  no_remunerada: 'INICIACIÓN PRÁCTICAS NO REMUNERADAS',
  sin_titulo: 'INICIACIÓN DE PRÁCTICAS',
};

const SUBTITULO: Record<NonNullable<OpcionesActa['encabezadoArl']>, string> = {
  empresa: 'INSTITUCIÓN - EMPRESA ASUME ARL',
  cun: 'INSTITUCIÓN - CUN ASUME ARL',
  ambas: 'INSTITUCIÓN - CUN ASUME ARL / EMPRESA ASUME ARL',
  ninguna: 'INSTITUCIÓN',
};

const OBLIGACION_ARL =
  'Afiliar el estudiante al Sistema de Seguridad Social en Riesgos Laborales (ARL) y sufragar los gastos\n' +
  'necesarios para mantener vigente esta afiliación durante la vigencia de la práctica.';

export function actaSintetica(opciones: OpcionesActa = {}): string {
  const o = {
    remuneracion: 'no_remunerada', encabezadoArl: 'empresa', obligacionArl: 'empresa',
    etiquetaTipo: 'Modalidad de Practica', rotuloFunciones: 'actividades', codigo: 'DPE-FO03', ...opciones,
  } as Required<Omit<OpcionesActa, 'valores' | 'sinRotulosFirma'>>;
  const v = { ...VALORES_BASE, ...(opciones.valores ?? {}) };
  const cabecera = (): string =>
    `${TITULO[o.remuneracion]}\n${SUBTITULO[o.encabezadoArl]}|\nCÓDIGO:\n \n${o.codigo}\nVERSIÓN:\n \n00\nFecha:\n \n17/07/2019`;
  const arl = (donde: 'empresa' | 'institucion'): string =>
    o.obligacionArl === donde || o.obligacionArl === 'ambas' ? `\n7.\n${OBLIGACION_ARL}` : '';

  return [
    cabecera(),
    `Nombre del Estudiante:\n${v.nombre}`,
    `Documento de Identidad:\n${v.documento}\nLugar Expedición:\n${v.lugar}`,
    `Dirección:\n${v.direccion}\nBarrio:\n${v.barrio}`,
    `Teléfono:\n${v.telefono}\nSemestre:\n${v.semestre}`,
    `Programa:\n${v.programa}\n${o.etiquetaTipo}:\n${v.tipo}`,
    `Empresa:\n${v.empresa}\nNIT:\n${v.nit}`,
    `Nombre del representante legal:\n${v.representante}`,
    `Documento de Identidad:\n${v.documentoRepresentante}`,
    `Dirección donde realizará las prácticas:\n${v.direccionPractica}`,
    `Ciudad:\n${v.ciudad}\nDepartamento:\n${v.departamento}\nTeléfono:\n${v.telefonoEmpresa}`,
    `Nombre jefe inmediato, tutor:\n${v.jefe}`,
    `Documento de Identidad:\n${v.documentoJefe}`,
    `Fecha de Inicio de la práctica:\n${v.inicio}\nFecha Terminación:\n${v.fin}`,
    `Docente monitor asignado:\n${v.monitor}`,
    'El estudiante manifiesta (1) Conocer que LA INSTITUCIÓN exige como requisito académico la realización de una PRÁCTICA;',
    `(4) acepta las siguientes ${o.rotuloFunciones} las cuales desarrollará durante sus prácticas:\n${v.funciones}`,
    'OBLIGACIONES DEL ESTUDIANTE\n1.\nDesarrollar su práctica como proceso complementario de formación académica.\n' +
      '7.\nEl estudiante debe estar afiliado como cotizante o beneficiario a una EPS o entidad análoga.',
    'CAUSAS DE TERMINACIÓN\n1.\nLa práctica puede terminar si EL ESTUDIANTE presenta bajo rendimiento.',
    cabecera(),
    `OBLIGACIONES DE LA EMPRESA\n1.\nPermitir el ingreso a sus instalaciones del estudiante seleccionado.${arl('empresa')}`,
    `OBLIGACIONES DE LA INSTITUCIÓN\n1.\nEl estudiante sigue siendo parte de la comunidad estudiantil.${arl('institucion')}`,
    'En constancia de lo anterior se firma a los ( ) días del mes de del año ( ).',
    opciones.sinRotulosFirma ? '' : 'FIRMA DE LA EMPRESA\nFIRMA DEL PRÁCTICANTE\nNombres y apellidos\nCARGO:',
  ].join('\n\n');
}

/** Un acta con la plantilla en blanco: sin ningún dato escrito en los campos. */
export function actaEnBlanco(opciones: OpcionesActa = {}): string {
  const vacios = Object.fromEntries(Object.keys(VALORES_BASE).map((k) => [k, ''])) as OpcionesActa['valores'];
  return actaSintetica({ ...opciones, valores: vacios });
}

export function sipraSintetico(cambios: Partial<DatosSipraActa> = {}): DatosSipraActa {
  return {
    estudianteNombre: 'Ana Maria Prueba Sintetica',
    estudianteDocumento: '1000000001',
    programa: 'Administración de Empresas',
    empresaRazonSocial: 'Empresa Sintética SAS',
    empresaNit: '900123456-8',
    modalidad: 'contrato_aprendizaje',
    remuneracionEsperada: 'no_remunerada',
    responsableArlEsperado: 'empresa',
    fechaInicio: new Date('2026-03-17T00:00:00Z'),
    fechaFin: new Date('2026-09-17T00:00:00Z'),
    jefeInmediatoNombre: 'Laura Jefe Ficticia',
    funciones: 'Apoyo en gestión documental y atención de solicitudes internas',
    ...cambios,
  };
}

// ── Documentos que NO son un acta (texto sintético) ─────────────────────────
export const TEXTO_CERTIFICADO_EPS =
  'CERTIFICADO DE AFILIACION\nLa entidad promotora de salud certifica que la persona identificada con el documento ' +
  'indicado se encuentra activa afiliada al plan de beneficios.\nESTADO DE AFILIACION: ACTIVO\n' +
  'REGIMEN: CONTRIBUTIVO\nTIPO DE AFILIADO: COTIZANTE\nPLAN DE BENEFICIOS EN SALUD\nFecha de expedicion sintetica.';

export const TEXTO_CEDULA =
  'REPUBLICA DE COLOMBIA\nREGISTRADURIA NACIONAL DEL ESTADO CIVIL\nCEDULA DE CIUDADANIA\nNUMERO 1.000.000.001\n' +
  'APELLIDOS PRUEBA SINTETICA\nFECHA DE NACIMIENTO 01-ENE-1999\nLUGAR DE NACIMIENTO BOGOTA\nESTATURA 1.65 G.S. RH O+';

export const TEXTO_CARTA_LABORAL =
  'CERTIFICACION LABORAL\nHACE CONSTAR QUE la persona indicada labora en la empresa con contrato a termino indefinido, ' +
  'desempenando el cargo de analista, con un salario mensual establecido. Se expide a solicitud del interesado.';

export const TEXTO_CERTIFICADO_ARL =
  'ADMINISTRADORA DE RIESGOS LABORALES\nCERTIFICADO DE AFILIACION ARL\nCLASE DE RIESGO: I\nTIPO DE COTIZANTE: ESTUDIANTE\n' +
  'Se certifica la afiliacion del trabajador con la cobertura vigente al sistema general de riesgos.';

export const TEXTO_CONTRATO =
  'CONTRATO DE PRESTACION DE SERVICIOS\nENTRE LAS PARTES EL CONTRATANTE Y EL CONTRATISTA ACUERDAN.\n' +
  'CLAUSULA PRIMERA OBJETO DEL CONTRATO: prestar servicios profesionales.\nCLAUSULA SEGUNDA DURACION.';

export const TEXTO_ARCHIVO_CUALQUIERA =
  'La reunion del comite de compras se realizo en la oficina principal para revisar las propuestas de los ' +
  'proveedores y definir el calendario de entregas de la proxima semana. Se acordo que los pagos se haran por ' +
  'transferencia y que el responsable enviara el resumen de la sesion a todos los participantes antes del viernes.';

// ── Lecturas ya hechas (sin archivo): para probar la persistencia y el pipeline ─────────────────────────────

import { FirmasActa } from '../src/domain/entities/acta-iniciacion';
import { analizarActa } from '../src/domain/services/analisis-acta.domain-service';
import { LecturaActaLocal } from '../src/domain/services/lectura-local-acta.domain-service';
import { evaluarSuficienciaActa } from '../src/domain/services/suficiencia-acta.domain-service';
import { minimizarLecturaActa } from '../src/domain/services/validacion-acta.domain-service';

export interface OpcionesLecturaSintetica {
  metodo?: 'texto' | 'ocr';
  confianzaOcr?: number;
  firmas?: Partial<Pick<FirmasActa, 'firmaEmpresaPresente' | 'firmaPracticantePresente'>>;
}

/** Lo que devolvería el lector local para este texto, sin pasar por un archivo. */
export function lecturaLocalSintetica(texto: string, o: OpcionesLecturaSintetica = {}): LecturaActaLocal {
  const metodo = o.metodo ?? 'texto';
  const analisis = analizarActa(texto, metodo === 'ocr' ? 'ocr' : 'texto_nativo', null, null, o.confianzaOcr === undefined ? undefined : o.confianzaOcr / 100);
  analisis.firmas = { ...analisis.firmas, ...(o.firmas ?? {}) };
  return {
    analisis, ilegible: false, motivoIlegible: null,
    resumen: {
      metodoLectura: metodo, paginas: 3, paginasLeidas: 3, paginasOcr: metodo === 'ocr' ? [1, 2, 3] : [],
      intentosOcr: metodo === 'ocr' ? 3 : 0, confianzaOcrMedia: metodo === 'ocr' ? (o.confianzaOcr ?? 80) : null,
      textoNativo: null, suficiencia: evaluarSuficienciaActa(analisis.clasificacion, analisis.campos),
      firmas: { pagina: 2, empresaLocalizada: true, practicanteLocalizada: true },
      limitesAplicados: [], errores: [], duracionMs: 5,
    },
  };
}

export const lecturaPersistibleSintetica = (texto: string, o: OpcionesLecturaSintetica = {}) =>
  minimizarLecturaActa(lecturaLocalSintetica(texto, o));
