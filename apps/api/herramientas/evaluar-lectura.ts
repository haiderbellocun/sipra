/* eslint-disable no-console */
/**
 * Arnés de evaluación de la lectura documental asistida.
 *
 * Es la parte medible del «entrenamiento»: genera un corpus sintético de
 * documentos (buenos, de tipo equivocado e ilegibles) con los campos
 * conocidos de antemano, los pasa por el extractor configurado y mide
 * exactitud por campo, detección de tipo, detección de ilegibilidad, criterios
 * respondidos, tokens, costo y tiempo. Sirve para dos cosas:
 *  · comprobar que la base de conocimiento funciona antes de activarla; y
 *  · recalibrar los supuestos del estimador de costos con `usage` real.
 *
 * Uso:
 *   npm run ia:evaluar                              # driver simulado (sin llave)
 *   OPENAI_API_KEY=sk-… npm run ia:evaluar -- --driver=openai --modelo=gpt-6-luna
 *   npm run ia:evaluar -- --tipos=certificado_arl,certificado_eps --salida=informe.json
 *
 * Datos sintéticos únicamente: nombres, cédulas y NIT inventados.
 */
import { writeFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { ConfigService } from '@nestjs/config';
import { camposDe } from '../src/domain/entities/campos-extraccion';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { ExtraccionIaPort, ResultadoExtraccion } from '../src/domain/ports/out/servicios-externos.port';
import {
  ConocimientoDocumentalDomainService,
} from '../src/domain/services/conocimiento-documental.domain-service';
import { ExtraccionSimuladaAdapter } from '../src/infrastructure/adapters/ia/extraccion.adapter';
import { ExtraccionOpenAiAdapter } from '../src/infrastructure/adapters/ia/openai.adapter';
import { DecodificadorImagenAdapter } from '../src/infrastructure/adapters/imagen/decodificador.adapter';

interface Caso {
  id: string;
  tipoCargado: TipoDocumento;
  descripcion: string;
  archivo: () => Promise<Buffer>;
  mime: string;
  esperado: {
    tipoReal: TipoDocumento | null;
    ilegible: boolean;
    campos: Record<string, string>;
    /** Códigos de criterio que deberían salir en «no». */
    criteriosNo: string[];
  };
}

interface ResultadoCaso {
  id: string;
  tipoCargado: string;
  descripcion: string;
  ilegibleEsperado: boolean;
  ilegibleObtenido: boolean;
  tipoEsperado: string | null;
  tipoObtenido: string | null;
  camposEvaluados: number;
  camposCorrectos: number;
  camposIncorrectos: string[];
  criteriosNoEsperados: string[];
  criteriosNoObtenidos: string[];
  tokensEntrada: number;
  tokensSalida: number;
  costoUsd: number;
  duracionMs: number;
  error: string | null;
}

const argumentos = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [clave, ...valor] = a.replace(/^--/, '').split('=');
    return [clave, valor.join('=') || 'true'];
  }),
);

function pdf(lineas: string[], opciones: { enBlanco?: boolean } = {}): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 72, bottom: 72, left: 72, right: 72 } });
    const partes: Buffer[] = [];
    doc.on('data', (p: Buffer) => partes.push(p));
    doc.on('end', () => resolver(Buffer.concat(partes)));
    doc.on('error', rechazar);
    if (!opciones.enBlanco) {
      doc.font('Helvetica').fontSize(11);
      for (const linea of lineas) {
        if (linea === '') doc.moveDown(0.6);
        else doc.text(linea);
      }
    }
    doc.end();
  });
}

/** PNG gris uniforme: una «foto» sin contenido legible. */
function pngIlegible(): Buffer {
  const decodificador = new DecodificadorImagenAdapter();
  const ancho = 400; const alto = 300;
  const pixeles = new Uint8Array(ancho * alto);
  for (let i = 0; i < pixeles.length; i += 1) pixeles[i] = 90 + ((i * 7919) % 23);
  return decodificador.codificarPng({ ancho, alto, pixeles });
}

const HOY = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const hace = (dias: number) => iso(new Date(HOY.getTime() - dias * 86_400_000));

function corpus(): Caso[] {
  const casos: Caso[] = [];
  const arl = (fechaAfiliacion: string, extra: string[] = []) => [
    'ARL POSITIVA COMPAÑÍA DE SEGUROS S.A.',
    'CERTIFICADO DE AFILIACIÓN A RIESGOS LABORALES',
    '',
    `Fecha de expedición: ${hace(3)}`,
    'Empresa: Logísticas Andinas S.A.S.',
    'NIT: 901.234.567-8',
    'Afiliado: Laura Valentina Ramírez Ocampo',
    'Documento: C.C. 1.032.456.786',
    `Fecha de afiliación: ${fechaAfiliacion}`,
    'Tipo de cotizante: 23',
    'Estado: ACTIVO',
    ...extra,
  ];
  casos.push({
    id: 'arl-bueno', tipoCargado: TipoDocumento.CERTIFICADO_ARL,
    descripcion: 'Certificado de ARL correcto, con todos los campos', mime: 'application/pdf',
    archivo: () => pdf(arl(hace(10))),
    esperado: {
      tipoReal: TipoDocumento.CERTIFICADO_ARL, ilegible: false,
      campos: { nit_empresa: '901234567', razon_social: 'Logísticas Andinas', nombre_afiliado: 'Laura Valentina Ramírez Ocampo', documento_afiliado: '1032456786', fecha_afiliacion: hace(10), arl: 'Positiva', tipo_cotizante: '23' },
      criteriosNo: [],
    },
  });
  casos.push({
    id: 'arl-es-planilla', tipoCargado: TipoDocumento.CERTIFICADO_ARL,
    descripcion: 'Se cargó una planilla de pago PILA en lugar del certificado', mime: 'application/pdf',
    archivo: () => pdf([
      'PLANILLA INTEGRADA DE LIQUIDACIÓN DE APORTES — PILA',
      'Operador: Mi Planilla', `Periodo de cotización: ${hace(30).slice(0, 7)}`,
      'Aportante: Logísticas Andinas S.A.S. NIT 901.234.567-8',
      'Cotizante: Laura Valentina Ramírez Ocampo C.C. 1.032.456.786',
      'IBC: 1.423.500   Riesgos laborales: 7.432   Salud: 178.000   Pensión: 227.760',
      'Total pagado: 413.192',
    ]),
    esperado: { tipoReal: TipoDocumento.PLANILLA_APORTES, ilegible: false, campos: {}, criteriosNo: ['NOACEPTA_1'] },
  });
  casos.push({
    id: 'arl-en-blanco', tipoCargado: TipoDocumento.CERTIFICADO_ARL,
    descripcion: 'PDF de una página en blanco', mime: 'application/pdf',
    archivo: () => pdf([], { enBlanco: true }),
    esperado: { tipoReal: null, ilegible: true, campos: {}, criteriosNo: [] },
  });
  casos.push({
    id: 'arl-foto-ilegible', tipoCargado: TipoDocumento.CERTIFICADO_ARL,
    descripcion: 'Foto gris sin texto legible', mime: 'image/png',
    archivo: () => Promise.resolve(pngIlegible()),
    esperado: { tipoReal: null, ilegible: true, campos: {}, criteriosNo: [] },
  });
  casos.push({
    id: 'eps-bueno', tipoCargado: TipoDocumento.CERTIFICADO_EPS,
    descripcion: 'Certificado de EPS activo, expedido hace 5 días', mime: 'application/pdf',
    archivo: () => pdf([
      'EPS SANITAS S.A.S.', 'CERTIFICADO DE AFILIACIÓN',
      '', `Fecha de expedición: ${hace(5)}`,
      'Nombre del afiliado: Andrés Felipe Mora Cárdenas', 'Documento: C.C. 1.019.876.543',
      'Régimen: Contributivo', 'Tipo de afiliado: Beneficiario', 'Estado de afiliación: ACTIVO',
    ]),
    esperado: {
      tipoReal: TipoDocumento.CERTIFICADO_EPS, ilegible: false,
      campos: { entidad_emisora: 'Sanitas', nombre_afiliado: 'Andrés Felipe Mora Cárdenas', documento_afiliado: '1019876543', fecha_expedicion: hace(5), estado_afiliacion: 'ACTIVO', regimen: 'Contributivo' },
      criteriosNo: [],
    },
  });
  casos.push({
    id: 'eps-vencido', tipoCargado: TipoDocumento.CERTIFICADO_EPS,
    descripcion: 'Certificado de EPS expedido hace 75 días (más de 30)', mime: 'application/pdf',
    archivo: () => pdf([
      'NUEVA EPS S.A.', 'CERTIFICADO DE AFILIACIÓN', '', `Fecha de expedición: ${hace(75)}`,
      'Nombre del afiliado: Valentina Ochoa Pardo', 'Documento: C.C. 1.023.445.561',
      'Régimen: Contributivo', 'Estado de afiliación: ACTIVO',
    ]),
    esperado: {
      tipoReal: TipoDocumento.CERTIFICADO_EPS, ilegible: false,
      campos: { entidad_emisora: 'Nueva EPS', fecha_expedicion: hace(75), estado_afiliacion: 'ACTIVO' },
      criteriosNo: ['CRIT_3'],
    },
  });
  casos.push({
    id: 'eps-es-sisben', tipoCargado: TipoDocumento.CERTIFICADO_EPS,
    descripcion: 'Se cargó una consulta del Sisbén en lugar del certificado de EPS', mime: 'application/pdf',
    archivo: () => pdf([
      'DEPARTAMENTO NACIONAL DE PLANEACIÓN — SISBÉN IV', 'CONSULTA DE CLASIFICACIÓN',
      '', 'Documento: 1.023.445.561', 'Nombre: Valentina Ochoa Pardo', 'Grupo: B4', `Fecha de consulta: ${hace(1)}`,
    ]),
    esperado: { tipoReal: null, ilegible: false, campos: {}, criteriosNo: ['NOACEPTA_3'] },
  });
  casos.push({
    id: 'acta-bueno', tipoCargado: TipoDocumento.ACTA_INICIO,
    descripcion: 'Acta de inicio con fechas, funciones y firmas', mime: 'application/pdf',
    archivo: () => pdf([
      'CORPORACIÓN UNIFICADA NACIONAL DE EDUCACIÓN SUPERIOR — CUN', 'ACTA DE INICIO DE PRÁCTICA',
      '', 'Modalidad: Pasantía', 'Estudiante: Laura Valentina Ramírez Ocampo',
      'Escenario de práctica: Logísticas Andinas S.A.S.', `Fecha de inicio: ${hace(-5)}`, `Fecha de fin: ${hace(-125)}`,
      'Horario: lunes a viernes de 8:00 a 12:00', 'Funciones: Apoyo al área de operaciones logísticas y control de inventarios.',
      'Jefe inmediato: Camila Restrepo Gómez — Cargo: Coordinadora de operaciones',
      '', 'Firma del estudiante: ______ (firma manuscrita)', 'Firma del jefe inmediato: ______ (firma manuscrita)',
    ]),
    esperado: {
      tipoReal: TipoDocumento.ACTA_INICIO, ilegible: false,
      campos: { modalidad: 'Pasantía', fecha_inicio: hace(-5), fecha_fin: hace(-125), nombre_responsable: 'Camila Restrepo', cargo_responsable: 'Coordinadora de operaciones' },
      criteriosNo: [],
    },
  });
  casos.push({
    id: 'planilla-bueno', tipoCargado: TipoDocumento.PLANILLA_HORAS,
    descripcion: 'Planilla de horas firmada por el jefe inmediato', mime: 'application/pdf',
    archivo: () => pdf([
      'PLANILLA DE HORAS DE PRÁCTICA', 'Estudiante: Andrés Felipe Mora Cárdenas', 'Empresa: Soluciones Beta S.A.S.',
      `Periodo: ${hace(60)} a ${hace(1)}`, 'Total de horas: 320',
      'Firmado por: Diana Lucía Torres — Cargo: Jefe de talento humano',
    ]),
    esperado: {
      tipoReal: TipoDocumento.PLANILLA_HORAS, ilegible: false,
      campos: { nombre_estudiante: 'Andrés Felipe Mora', razon_social: 'Soluciones Beta', total_horas: '320', nombre_firmante: 'Diana Lucía Torres', cargo_firmante: 'Jefe de talento humano' },
      criteriosNo: [],
    },
  });
  casos.push({
    id: 'informe-monitoria', tipoCargado: TipoDocumento.INFORME_1,
    descripcion: 'Informe 1 de monitoría (tipo sin campos: solo criterios y resumen)', mime: 'application/pdf',
    archivo: () => pdf([
      'INFORME 1 DE MONITORÍA', 'Monitora: Valentina Ochoa Pardo', 'Periodo: 2026-2',
      'Sesiones realizadas: 12', 'Temas: Introducción a la programación; estructuras de control.',
      'Estudiantes atendidos: 38', 'Material preparado: guías de laboratorio 1 a 4.',
      'Apoyo a Permanencia: seguimiento a 6 estudiantes con riesgo académico.',
    ]),
    esperado: { tipoReal: TipoDocumento.INFORME_1, ilegible: false, campos: {}, criteriosNo: [] },
  });
  return casos;
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function coincide(esperado: string, obtenido: string | null): boolean {
  if (obtenido === null) return false;
  const e = normalizar(esperado); const o = normalizar(obtenido);
  return o.includes(e) || e.includes(o);
}

function construirExtractor(driver: string, modelo: string): ExtraccionIaPort {
  if (driver === 'openai') {
    const valores: Record<string, string> = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
      OPENAI_MODELO: modelo,
      OPENAI_ESFUERZO: process.env.OPENAI_ESFUERZO ?? 'low',
      OPENAI_URL_BASE: process.env.OPENAI_URL_BASE ?? 'https://api.openai.com/v1',
    };
    const config = { get: (clave: string) => valores[clave] } as unknown as ConfigService;
    if (!valores.OPENAI_API_KEY) {
      console.error('Falta OPENAI_API_KEY en el entorno para evaluar con el driver openai.');
      process.exit(2);
    }
    return new ExtraccionOpenAiAdapter(config, new DecodificadorImagenAdapter());
  }
  return new ExtraccionSimuladaAdapter();
}

async function evaluarCaso(extractor: ExtraccionIaPort, caso: Caso): Promise<ResultadoCaso> {
  const archivo = await caso.archivo();
  const inicio = Date.now();
  let resultado: ResultadoExtraccion | null = null; let error: string | null = null;
  try {
    resultado = await extractor.extraer(archivo, caso.mime, caso.tipoCargado);
  } catch (e) {
    error = (e as Error).message;
  }
  const esperados = Object.entries(caso.esperado.campos);
  const incorrectos: string[] = [];
  let correctos = 0;
  if (resultado && !resultado.ilegible) {
    for (const [campo, valor] of esperados) {
      if (coincide(valor, resultado.campos[campo]?.valor ?? null)) correctos += 1;
      else incorrectos.push(`${campo}: esperado «${valor}», obtenido «${resultado.campos[campo]?.valor ?? 'null'}»`);
    }
  } else {
    incorrectos.push(...esperados.map(([c, v]) => `${c}: esperado «${v}», sin lectura`));
  }
  return {
    id: caso.id,
    tipoCargado: caso.tipoCargado,
    descripcion: caso.descripcion,
    ilegibleEsperado: caso.esperado.ilegible,
    ilegibleObtenido: resultado?.ilegible ?? false,
    tipoEsperado: caso.esperado.tipoReal,
    tipoObtenido: resultado?.tipoDetectado ?? null,
    camposEvaluados: esperados.length,
    camposCorrectos: correctos,
    camposIncorrectos: incorrectos,
    criteriosNoEsperados: caso.esperado.criteriosNo,
    criteriosNoObtenidos: (resultado?.hallazgos ?? []).filter((h) => h.cumple === 'no').map((h) => h.codigo),
    tokensEntrada: resultado?.tokensEntrada ?? 0,
    tokensSalida: resultado?.tokensSalida ?? 0,
    costoUsd: resultado?.costoUsd ?? 0,
    duracionMs: Date.now() - inicio,
    error,
  };
}

async function principal(): Promise<void> {
  const driver = argumentos.driver ?? process.env.IA_DRIVER ?? 'simulado';
  const modelo = argumentos.modelo ?? process.env.OPENAI_MODELO ?? 'gpt-6-luna';
  const filtroTipos = argumentos.tipos ? new Set(argumentos.tipos.split(',')) : null;
  const casos = corpus().filter((c) => !filtroTipos || filtroTipos.has(c.tipoCargado));
  const extractor = construirExtractor(driver, modelo);
  const conocimiento = new ConocimientoDocumentalDomainService();

  console.log(`\nEvaluación de lectura asistida · driver ${driver}${driver === 'openai' ? ` · modelo ${modelo}` : ''}`);
  console.log(`${casos.length} caso(s) sintético(s)\n`);

  const resultados: ResultadoCaso[] = [];
  for (const caso of casos) {
    const r = await evaluarCaso(extractor, caso);
    resultados.push(r);
    const tipoOk = r.tipoEsperado === null ? r.tipoObtenido === null || r.ilegibleObtenido : r.tipoObtenido === r.tipoEsperado;
    const ilegibleOk = r.ilegibleEsperado === r.ilegibleObtenido;
    const criteriosOk = r.criteriosNoEsperados.every((c) => r.criteriosNoObtenidos.includes(c));
    const marca = (ok: boolean) => (ok ? '✓' : '✗');
    console.log(
      `${r.error ? '✗' : '·'} ${r.id.padEnd(20)} ${conocimiento.nombreDe(caso.tipoCargado).padEnd(38).slice(0, 38)} ` +
        `campos ${r.camposCorrectos}/${r.camposEvaluados}  tipo ${marca(tipoOk)}  ilegible ${marca(ilegibleOk)}  ` +
        `criterios ${marca(criteriosOk)}  ${r.tokensEntrada}+${r.tokensSalida} tok  ${r.costoUsd.toFixed(5)} USD  ${r.duracionMs} ms` +
        (r.error ? `\n    error: ${r.error}` : ''),
    );
    for (const detalle of r.camposIncorrectos) console.log(`    · ${detalle}`);
    if (!criteriosOk) console.log(`    · criterios «no» esperados ${JSON.stringify(r.criteriosNoEsperados)}, obtenidos ${JSON.stringify(r.criteriosNoObtenidos)}`);
  }

  const evaluados = resultados.reduce((s, r) => s + r.camposEvaluados, 0);
  const correctos = resultados.reduce((s, r) => s + r.camposCorrectos, 0);
  const costo = resultados.reduce((s, r) => s + r.costoUsd, 0);
  const tokensEntrada = resultados.reduce((s, r) => s + r.tokensEntrada, 0);
  const tokensSalida = resultados.reduce((s, r) => s + r.tokensSalida, 0);
  const ilegiblesOk = resultados.filter((r) => r.ilegibleEsperado === r.ilegibleObtenido).length;
  const tiposOk = resultados.filter((r) =>
    (r.tipoEsperado === null ? r.tipoObtenido === null || r.ilegibleObtenido : r.tipoObtenido === r.tipoEsperado)).length;
  const criteriosOk = resultados.filter((r) => r.criteriosNoEsperados.every((c) => r.criteriosNoObtenidos.includes(c))).length;

  console.log('\nResumen');
  console.log(`  Campos correctos:        ${correctos}/${evaluados} (${evaluados ? Math.round((100 * correctos) / evaluados) : 0} %)`);
  console.log(`  Tipo detectado:          ${tiposOk}/${resultados.length}`);
  console.log(`  Ilegibilidad acertada:   ${ilegiblesOk}/${resultados.length}`);
  console.log(`  Criterios «no» hallados: ${criteriosOk}/${resultados.length}`);
  console.log(`  Tokens:                  ${tokensEntrada} entrada / ${tokensSalida} salida`);
  console.log(`  Costo de la corrida:     ${costo.toFixed(5)} USD (${resultados.length ? (costo / resultados.length).toFixed(5) : '0'} USD por documento)`);
  if (driver === 'simulado') {
    console.log('\n  El driver simulado solo lee la capa de texto de los PDF: no detecta ilegibilidad en');
    console.log('  imágenes ni responde criterios. Sirve para comprobar el arnés; la medida real se toma con --driver=openai.');
  }

  if (argumentos.salida) {
    writeFileSync(argumentos.salida, JSON.stringify({ driver, modelo, fecha: new Date().toISOString(), resultados }, null, 2));
    console.log(`\n  Informe guardado en ${argumentos.salida}`);
  }
}

principal().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
