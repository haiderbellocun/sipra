/* eslint-disable no-console */
/**
 * Regresión del lector de Cámara de Comercio contra muestras REALES que viven FUERA del repositorio.
 *
 *   CAMARA_MUESTRAS=C:/sipra_pruebas_empresa CAMARA_VERDAD=ruta/camara-verdad.json npm run regresion:camara
 *   (opcional) CAMARA_MODO=ocr  → fuerza el OCR sobre los documentos digitales para medir el camino OCR.
 *
 * `CAMARA_VERDAD` es un JSON LOCAL { "Cámara de Comercio/archivo.pdf": { … valores de referencia … } } y el manifiesto
 * `manifest-documentos.csv` de la carpeta de muestras aporta el tipo y la persona esperados: nunca se versionan. La herramienta no copia
 * documentos, no escribe datos reales en ningún sitio y enmascara lo que imprime (longitud y últimas cifras, nunca nombres ni números
 * completos). Sin red: lectura local (pdf.js y Tesseract). No abre URLs de verificación ni consulta el RUES.
 *
 * La carpeta NO es la verdad: el tipo esperado sale del manifiesto y el detectado, del contenido. Mide, por grupo y por campo:
 * aplica, correctos, incorrectos, no encontrados y no determinables; los duplicados exactos (mismo SHA-256) se cuentan UNA vez.
 * Un valor incorrecto con lectura NO dudosa es un «falso valor silencioso» y se informa aparte.
 */
import 'reflect-metadata';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { LecturaLocalCamaraService } from '../src/domain/services/lectura-local-camara.domain-service';
import { ClasificacionDocumentoEmpresarial as C } from '../src/domain/entities/documento-empresarial';
import { evaluarCamara } from '../src/domain/services/vigencia-documento-empresarial.domain-service';

const carpetaMuestras = process.env.CAMARA_MUESTRAS?.trim();
const archivoVerdad = process.env.CAMARA_VERDAD?.trim();
if (!carpetaMuestras || !archivoVerdad) throw new Error('Defina CAMARA_MUESTRAS (carpeta de muestras) y CAMARA_VERDAD (JSON local de referencia).');
const forzarOcr = process.env.CAMARA_MODO === 'ocr';
const CARPETA = 'Cámara de Comercio';

type Ref = Record<string, unknown>;
const verdad: Record<string, Ref> = JSON.parse(readFileSync(archivoVerdad, 'utf8'));
const SALTO = String.fromCharCode(10);

interface Manifiesto { id: string; tipo: string; persona: string; observaciones: string }
function leerManifiesto(): Record<string, Manifiesto> {
  const filas = readFileSync(join(carpetaMuestras!, 'manifest-documentos.csv'), 'utf8').split(SALTO).slice(1);
  const salida: Record<string, Manifiesto> = {};
  for (const l of filas) {
    const c = [...l.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    if (c.length < 11 || c[1] !== CARPETA) continue;
    salida[`${c[1]}/${c[0]}`] = { id: (c[10].match(/id=([A-Z]+-[A-Z]*-?\d+)/) ?? [])[1] ?? c[0].slice(0, 10), tipo: c[5], persona: c[6], observaciones: c[10] };
  }
  return salida;
}

const enmascarar = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  const t = String(v);
  if (/^\d+$/.test(t) && t.length > 4) return `${'*'.repeat(t.length - 2)}${t.slice(-2)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t.slice(0, 4)}-**-**`;
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  return t.length > 12 ? `${t.length}c` : t;
};
const norm = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const digitos = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

type Res = 'correcto' | 'incorrecto' | 'no_encontrado' | 'no_determinable' | 'no_aplica';
const CAMPOS = [
  'tipo', 'persona', 'nombre', 'nit', 'dv', 'matricula', 'camara', 'fechaMatricula', 'ultimoAnioRenovado', 'fechaRenovacion', 'domicilio', 'ciiu',
  'representante', 'fechaExpedicion', 'codigo', 'url', 'firmaPdf', 'estadoRegistral', 'ventana',
] as const;
type Campo = (typeof CAMPOS)[number];
const CLAVE_MOTIVO: Partial<Record<Campo, string[]>> = {
  nombre: ['nombre_'], nit: ['nit_'], dv: ['nit_'], matricula: ['matricula_'], camara: ['camara_'], fechaMatricula: ['fechaMatricula_'],
  ultimoAnioRenovado: ['ultimoAnioRenovado_'], fechaRenovacion: ['fechaRenovacion_'], domicilio: ['domicilio_'], ciiu: ['ciiu_'],
  representante: ['representante_'], fechaExpedicion: ['fechaExpedicion_'], codigo: ['codigoVerificacion_'], url: ['urlVerificacion_'], ventana: ['diasVerificacion_'],
};

interface Fila { campo: Campo; esperado: unknown; extraido: unknown; resultado: Res; confianza: number | null }

function esperadoNuevo(m: Manifiesto): string {
  return m.tipo === 'DOCUMENTO_INCORRECTO' ? C.DOCUMENTO_INCORRECTO
    : m.tipo === 'CAMARA_EXISTENCIA_REPRESENTACION' ? C.CAMARA_EXISTENCIA_REPRESENTACION
      : m.persona === 'NATURAL' ? C.CAMARA_MATRICULA_PERSONA_NATURAL : C.CAMARA_MATRICULA_SOCIEDAD;
}

async function main(): Promise<void> {
  const manifiesto = leerManifiesto();
  const lector = new LectorDocumentoLocalAdapter();
  const servicio = new LecturaLocalCamaraService(lector, lector);
  const vistos = new Map<string, string>();
  const grupos: Record<string, Record<string, Record<Res | 'aplica', number>>> = {};
  const silenciosos: string[] = [];
  let duplicados = 0;
  let clasificacionOk = 0;
  let clasificados = 0;
  const acum = (g: string, campo: string, r: Res): void => {
    if (r === 'no_aplica') return;
    const e = ((grupos[g] ??= {})[campo] ??= { aplica: 0, correcto: 0, incorrecto: 0, no_encontrado: 0, no_determinable: 0, no_aplica: 0 });
    e.aplica += 1; e[r] += 1;
  };

  for (const archivo of readdirSync(join(carpetaMuestras!, CARPETA)).filter((f) => /\.pdf$/i.test(f)).sort()) {
    const clave = `${CARPETA}/${archivo}`;
    const man = manifiesto[clave];
    const v = verdad[clave];
    if (!man || !v) { console.log(`(sin manifiesto o referencia) ${archivo.length} caracteres`); continue; }
    const t0 = Date.now();
    const l = await servicio.leer(readFileSync(join(carpetaMuestras!, CARPETA, archivo)), 'application/pdf', undefined, { forzarOcr });
    if (vistos.has(l.hashSha256)) { duplicados += 1; console.log(`${man.id}  DUPLICADO exacto de ${vistos.get(l.hashSha256)}: no cuenta en las métricas`); continue; }
    vistos.set(l.hashSha256, man.id);
    const i = l.interpretacion;
    const d = i.datos;
    const tipoRef = esperadoNuevo(man);
    clasificados += 1;
    if (i.clasificacion.clasificacion === tipoRef) clasificacionOk += 1;
    const grupo = tipoRef === C.DOCUMENTO_INCORRECTO ? 'documento incorrecto'
      : `${tipoRef === C.CAMARA_MATRICULA_PERSONA_NATURAL ? 'Cámara PN' : tipoRef === C.CAMARA_MATRICULA_SOCIEDAD ? 'Cámara PJ matrícula' : 'Cámara PJ existencia/representación'} · ${forzarOcr ? 'OCR forzado' : l.metodo === 'texto' ? 'digital' : 'OCR/híbrido'}`;

    const filas: Fila[] = [];
    const conf = (c: keyof typeof i.confianzas): number | null => (i.confianzas[c] ?? null) as number | null;
    const motivoDescarta = (campo: Campo): boolean => (CLAVE_MOTIVO[campo] ?? []).some((p) => i.motivos.some((m) => m.startsWith(p) && /descartado|no_legible/.test(m)));
    const agregar = (campo: Campo, esperado: unknown, extraido: unknown, igual: (a: unknown, b: unknown) => boolean, aplica = esperado !== null && esperado !== undefined): void => {
      let r: Res;
      if (!aplica) r = extraido === null || extraido === undefined ? 'no_aplica' : 'incorrecto';
      else if (extraido === null || extraido === undefined) r = motivoDescarta(campo) ? 'no_determinable' : 'no_encontrado';
      else r = igual(extraido, esperado) ? 'correcto' : 'incorrecto';
      filas.push({ campo, esperado: aplica ? esperado : null, extraido, resultado: r, confianza: campo === 'dv' ? conf('dv') : conf(campo as never) });
    };
    const eq = (a: unknown, b: unknown): boolean => String(a) === String(b);
    const eqNom = (a: unknown, b: unknown): boolean => norm(a) === norm(b);
    const eqDig = (a: unknown, b: unknown): boolean => digitos(a) === digitos(b);
    const inc = tipoRef === C.DOCUMENTO_INCORRECTO;
    const pj = tipoRef !== C.CAMARA_MATRICULA_PERSONA_NATURAL;

    agregar('tipo', tipoRef, i.clasificacion.clasificacion, eq);
    agregar('persona', inc ? null : pj ? 'juridica' : 'natural', d?.tipoPersona ?? null, eq, !inc);
    if (!inc) {
      agregar('nombre', v['razon_social'] ?? v['nombre'], d?.nombreORazonSocial, eqNom);
      agregar('nit', v['nit'] ?? v['identificacion'], d?.nit, eqDig);
      agregar('dv', v['dv'], d?.dv, eq);
      agregar('matricula', v['matricula'], d?.matricula, (a, b) => String(a).replace(/\./g, '').toUpperCase() === String(b).replace(/\./g, '').toUpperCase());
      agregar('camara', v['camara'], d?.camara, (a, b) => norm(a).startsWith(norm(b)) || norm(b).startsWith(norm(a)));
      agregar('fechaMatricula', v['fecha_matricula'], d?.fechaMatricula, eq);
      agregar('ultimoAnioRenovado', v['ultimo_anio_renovado'], d?.ultimoAnioRenovado, eq);
      agregar('fechaRenovacion', v['fecha_renovacion'], d?.fechaRenovacion, eq);
      agregar('domicilio', v['domicilio'], d?.domicilioMunicipio, eqNom);
      agregar('ciiu', v['ciiu'], d?.ciiu, eq);
      // Representante: la referencia solo sabe si el certificado nombra uno (no su valor); se verifica que sea un nombre del texto.
      agregar('representante', pj && v['representante'] === true ? 'presente' : null, d?.representanteLegal, (a) => typeof a === 'string' && a.split(' ').length >= 2, pj && v['representante'] === true);
      agregar('fechaExpedicion', v['fecha_expedicion'], d?.fechaExpedicion, eq);
      agregar('codigo', v['cod_verificacion'] === true ? 'presente' : null, d?.codigoVerificacion, () => true, v['cod_verificacion'] === true);
      const hosts = typeof v['url_host'] === 'string' ? (v['url_host'] as string).split(',') : [];
      agregar('url', hosts.length ? hosts.join('|') : null, d?.urlVerificacion, (a) => { try { return hosts.includes(new URL(String(a)).hostname.toLowerCase().replace(/^www\./, '')); } catch { return false; } }, hosts.length > 0);
      agregar('firmaPdf', v['firma_pdf'] === true, d?.firmaPdfPresente, eq, true);
      // Estado registral: ninguna muestra lo declara; lo único correcto es «no determinable».
      agregar('estadoRegistral', v['estado_matricula'] ? String(v['estado_matricula']).toLowerCase() : 'no_determinable', d?.estadoRegistral, eq, true);
      const dias = v['dias_verificacion'] ? Number(v['dias_verificacion']) : null;
      const esperadoHasta = dias && v['fecha_expedicion'] ? evaluarCamara({ estadoRegistral: 'no_determinable' as never, ultimoAnioRenovado: null, fechaRenovacion: null, fechaExpedicion: String(v['fecha_expedicion']), diasVerificacionDocumento: dias }, new Date()).verificacionDisponibleHasta : null;
      agregar('ventana', esperadoHasta, d?.verificacionDisponibleHasta, eq);
    }
    for (const f of filas) {
      acum(grupo, f.campo, f.resultado);
      if (f.resultado === 'incorrecto' && !i.lecturaDudosa) silenciosos.push(`${man.id}.${f.campo}`);
    }
    const malas = filas.filter((f) => ['incorrecto', 'no_encontrado', 'no_determinable'].includes(f.resultado));
    console.log(`${SALTO}${man.id}  ${grupo}  método=${l.metodo} páginas=${l.resumen.paginas} ocr=${l.resumen.paginasOcr} dudosa=${i.lecturaDudosa ? 'sí' : 'no'} confianza=${i.confianzaDocumento ?? '—'} firma=${l.firmaPdfPresente ?? '—'} aut=${l.autenticidad.estado}  (${Date.now() - t0} ms)`);
    console.log(`   clasificación: esperado=${tipoRef} detectado=${i.clasificacion.clasificacion} ${i.clasificacion.clasificacion === tipoRef ? 'OK' : 'DIFIERE'}  motivos=${i.clasificacion.motivos.join(',')}`);
    if (process.env.CAMARA_DETALLE === 'todo') {
      for (const f of filas) console.log(`   ${f.campo.padEnd(18)} | esp ${enmascarar(f.esperado).padEnd(14)} | ext ${enmascarar(f.extraido).padEnd(14)} | ${f.resultado.padEnd(15)} | ${l.metodo.padEnd(7)} | ${f.confianza ?? '—'}`);
    } else {
      for (const f of malas) console.log(`   ${f.campo.padEnd(18)} | esp ${enmascarar(f.esperado).padEnd(14)} | ext ${enmascarar(f.extraido).padEnd(14)} | ${f.resultado.padEnd(15)} | ${l.metodo.padEnd(7)} | ${f.confianza ?? '—'}`);
      if (malas.length === 0) console.log('   todos los campos que aplican: correctos');
    }
    if (i.motivos.length) console.log(`   motivos de lectura: ${i.motivos.join(', ')}`);
  }

  console.log(`${SALTO}══ MÉTRICAS por grupo y por campo (duplicados exactos excluidos: ${duplicados}) ══`);
  for (const [g, campos] of Object.entries(grupos).sort()) {
    console.log(`${SALTO}${g}`);
    console.log('  campo               aplica  correctos  incorrectos  no_encontrados  no_determinable  % correcto');
    for (const campo of CAMPOS) {
      const e = campos[campo];
      if (!e) continue;
      const pct = e.aplica ? `${Math.round((e.correcto / e.aplica) * 100)}%` : '—';
      console.log(`  ${campo.padEnd(18)} ${String(e.aplica).padStart(6)} ${String(e.correcto).padStart(10)} ${String(e.incorrecto).padStart(12)} ${String(e.no_encontrado).padStart(15)} ${String(e.no_determinable).padStart(16)}   ${pct}`);
    }
  }
  console.log(`${SALTO}clasificación correcta: ${clasificacionOk}/${clasificados}`);
  console.log(`falsos valores silenciosos (incorrecto con lectura NO dudosa): ${silenciosos.length}${silenciosos.length ? `  → ${silenciosos.join(', ')}` : ''}`);
}

void main();
