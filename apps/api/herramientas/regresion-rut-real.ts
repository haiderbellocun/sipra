/* eslint-disable no-console */
/**
 * Regresión del lector de RUT contra muestras REALES que viven FUERA del repositorio.
 *
 *   RUT_MUESTRAS=C:/sipra_pruebas_empresa RUT_VERDAD=ruta/verdad-rut.json npm run regresion:rut
 *
 * `RUT_VERDAD` es un JSON LOCAL { "carpeta/archivo.pdf": { persona, nit, dv, ... } }: nunca se versiona. La herramienta
 * no copia documentos, no escribe datos reales en ningún sitio y enmascara lo que imprime (longitud y últimas cifras,
 * nunca nombres ni números completos). Sin red: lectura local (pdf.js, Tesseract, ZXing).
 *
 * Mide, por grupo (RUT PN digital, RUT PJ digital, RUT escaneado) y por campo: aplica, correctos, incorrectos, no
 * encontrados y no determinables; los duplicados exactos (mismo SHA-256) se cuentan una sola vez. Un valor incorrecto
 * con lectura NO dudosa es un «falso valor silencioso» y se informa aparte.
 */
import 'reflect-metadata';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { LecturaLocalRutService } from '../src/domain/services/lectura-local-rut.domain-service';
import { DatosRutExtraidos } from '../src/domain/entities/documento-empresarial';
import { esDestinoOficialDian } from '../src/domain/services/autenticidad-documento-empresarial.domain-service';
import { tokensDeNombre } from '../src/domain/services/normalizacion-identidad';

const carpetaMuestras = process.env.RUT_MUESTRAS?.trim();
const archivoVerdad = process.env.RUT_VERDAD?.trim();
if (!carpetaMuestras || !archivoVerdad) throw new Error('Defina RUT_MUESTRAS (carpeta de muestras) y RUT_VERDAD (JSON local de verdad).');

interface Verdad {
  persona: 'natural' | 'juridica';
  nit: string; dv: string; fechaGeneracion: string | null; ciiu: string | null; divipola: string | null;
  tipoDocumento?: string; numeroDocumento?: string; nombres?: string; apellidos?: string; razonSocial?: string;
  qrDecodificado: boolean | null;
}
const verdad: Record<string, Verdad> = JSON.parse(readFileSync(archivoVerdad, 'utf8'));

const enmascarar = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  const t = String(v);
  if (/^\d+$/.test(t) && t.length > 4) return `${'*'.repeat(t.length - 2)}${t.slice(-2)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.slice(0, 4) + '-**-**';
  if (/^[A-ZÁÉÍÓÚÑ ]+$/.test(t) && t.length > 6) return `${t.length}c`;
  return t.length > 12 ? `${t.length}c` : t;
};

type Res = 'correcto' | 'incorrecto' | 'no_encontrado' | 'no_determinable';
interface Fila { campo: string; esperado: unknown; extraido: unknown; resultado: Res; confianza: number | null }
const CAMPOS_COMUNES = ['tipoPersona', 'nit', 'dv', 'fechaGeneracion', 'ciiuPrincipal', 'divipolaMunicipio'] as const;

async function main(): Promise<void> {
  const lector = new LectorDocumentoLocalAdapter();
  const servicio = new LecturaLocalRutService(lector, lector);
  const vistos = new Map<string, string>();
  const grupos: Record<string, Record<string, Record<Res | 'aplica', number>>> = {};
  const silenciosos: string[] = [];
  const acum = (g: string, campo: string, r: Res): void => {
    const e = ((grupos[g] ??= {})[campo] ??= { aplica: 0, correcto: 0, incorrecto: 0, no_encontrado: 0, no_determinable: 0 });
    e.aplica += 1; e[r] += 1;
  };
  let duplicados = 0;

  for (const carpeta of readdirSync(carpetaMuestras).filter((d) => !d.includes('.')).sort()) {
    if (!carpeta.startsWith('RUT')) continue;
    for (const archivo of readdirSync(join(carpetaMuestras, carpeta)).filter((f) => /\.pdf$/i.test(f)).sort()) {
      const clave = `${carpeta}/${archivo}`;
      const v = verdad[clave];
      if (!v) { console.log(`(sin verdad) ${clave.length} caracteres`); continue; }
      const t0 = Date.now();
      const l = await servicio.leer(readFileSync(join(carpetaMuestras, carpeta, archivo)), 'application/pdf');
      if (vistos.has(l.hashSha256)) { duplicados += 1; console.log(`DUPLICADO de ${vistos.get(l.hashSha256)}: no cuenta en las métricas`); continue; }
      const id = `R${vistos.size + 1}`;
      vistos.set(l.hashSha256, id);
      const i = l.interpretacion;
      const d = (i.datos ?? {}) as Partial<DatosRutExtraidos>;
      const escaneado = l.metodo !== 'texto';
      const g = escaneado ? 'RUT escaneado (OCR)' : v.persona === 'natural' ? 'RUT PN digital' : 'RUT PJ digital';
      const persona = i.clasificacion.tipoPersona;
      const motivos = i.motivos;
      const noDet = i.clasificacion.clasificacion === 'no_determinable';

      const filas: Fila[] = [];
      const cmp = (campo: string, esperado: unknown, extraido: unknown, confianza: number | null, motivoDescarte = false, igual = (a: unknown, b: unknown) => a === b): void => {
        if (esperado === null || esperado === undefined) return;
        let r: Res;
        if (extraido === null || extraido === undefined) r = noDet || motivoDescarte ? 'no_determinable' : 'no_encontrado';
        else r = igual(extraido, esperado) ? 'correcto' : 'incorrecto';
        filas.push({ campo, esperado, extraido: extraido ?? null, resultado: r, confianza });
        acum(g, campo, r);
        if (r === 'incorrecto' && !i.lecturaDudosa) silenciosos.push(`${id}:${campo}`);
      };
      const mismosTokens = (a: unknown, b: unknown): boolean => {
        const x = new Set(tokensDeNombre(String(a))); const y = new Set(tokensDeNombre(String(b)));
        return x.size === y.size && [...x].every((t) => y.has(t));
      };
      const cc = d.confianzaCampos ?? {};
      cmp('tipoPersona', v.persona, persona, cc.tipoPersona ?? null);
      cmp('nit', v.nit, d.nit, cc.nit ?? null, motivos.some((m) => m.startsWith('nit_descartado')));
      cmp('dv', v.dv, d.dv, cc.dv ?? null, motivos.some((m) => m.startsWith('nit_descartado')));
      if (v.persona === 'natural') {
        cmp('tipoDocumento', v.tipoDocumento, d.tipoDocumento, null);
        cmp('numeroDocumento', v.numeroDocumento, d.numeroDocumento, null, motivos.some((m) => m === 'documento_distinto_del_nit' || m === 'documento_ocr_sin_nit_validado'));
        cmp('nombres', v.nombres, d.nombres, cc.nombre ?? null, motivos.some((m) => m === 'nombre_ruido_ocr' || m === 'nombre_etiquetas_incompletas'), mismosTokens);
        cmp('apellidos', v.apellidos, d.apellidos, cc.nombre ?? null, motivos.some((m) => m === 'nombre_ruido_ocr' || m === 'nombre_etiquetas_incompletas'), mismosTokens);
      } else {
        cmp('razonSocial', v.razonSocial, d.razonSocial, cc.nombre ?? null, motivos.includes('razon_social_ruido_ocr'), mismosTokens);
      }
      cmp('ciiuPrincipal', v.ciiu, d.ciiuPrincipal, null);
      cmp('divipolaMunicipio', v.divipola, d.divipolaMunicipio, cc.divipola ?? null, motivos.includes('divipola_baja_confianza_ocr'));
      cmp('fechaGeneracion', v.fechaGeneracion, d.fechaGeneracion, cc.fechaGeneracion ?? null, motivos.includes('fecha_baja_confianza_ocr'));
      if (v.qrDecodificado !== null) cmp('qrDecodificado', v.qrDecodificado, l.autenticidad.qrDecodificado, null);
      if (v.qrDecodificado) cmp('qrDestinoOficial', true, l.autenticidad.qrDestinoOficial, null);

      console.log(`\n${id} · ${g} · método=${l.metodo} · clasificación=${i.clasificacion.clasificacion} · confianzaDoc=${i.confianzaDocumento ?? '—'} · dudosa=${i.lecturaDudosa} · etiquetas=${i.etiquetasLocalizadas} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      if (motivos.length) console.log(`   motivos: ${motivos.join(', ')}`);
      console.log(`   autenticidad=${l.autenticidad.estado} qrPresente=${l.autenticidad.qrPresente} qrDecodificado=${l.autenticidad.qrDecodificado} qrDestinoOficial=${l.autenticidad.qrDestinoOficial}`);
      console.log('   CAMPO | ESPERADO | EXTRAÍDO | RESULTADO | MÉTODO | CONFIANZA');
      for (const f of filas) {
        console.log(`   ${f.campo} | ${enmascarar(f.esperado)} | ${enmascarar(f.extraido)} | ${f.resultado} | ${l.metodo} | ${f.confianza === null ? '—' : f.confianza.toFixed(2)}`);
      }
      void esDestinoOficialDian;
    }
  }

  console.log('\n══ MÉTRICAS (sin duplicados) ══');
  for (const [g, campos] of Object.entries(grupos)) {
    console.log(`\n${g}`);
    console.log('  CAMPO | APLICA | CORRECTOS | INCORRECTOS | NO ENCONTRADOS | NO DETERMINABLE | % CORRECTO');
    for (const [campo, e] of Object.entries(campos)) {
      console.log(`  ${campo} | ${e.aplica} | ${e.correcto} | ${e.incorrecto} | ${e.no_encontrado} | ${e.no_determinable} | ${Math.round((100 * e.correcto) / e.aplica)}%`);
    }
  }
  console.log(`\nduplicados exactos omitidos: ${duplicados}`);
  console.log(`falsos valores silenciosos (incorrecto con lectura NO dudosa): ${silenciosos.length}${silenciosos.length ? ' → ' + silenciosos.join(', ') : ''}`);
  void CAMPOS_COMUNES;
  await lector.onModuleDestroy();
  process.exit(silenciosos.length === 0 ? 0 : 1);
}

void main();
