/* eslint-disable no-console */
/**
 * Regresión de la COMPARACIÓN Cámara ↔ SIPRA contra muestras REALES que viven FUERA del repositorio.
 *
 *   CAMARA_MUESTRAS=C:/sipra_pruebas_empresa npm run regresion:camara-comparacion
 *   (opcional) CAMARA_MODO=ocr  → fuerza el OCR sobre los documentos digitales (camino de lectura dudosa).
 *
 * Para cada muestra confiable construye un SIPRA SINTÉTICO equivalente a su lectura y comprueba:
 *   1. SIPRA = Cámara → ningún campo «diferente» (falsos positivos esperados: 0) y los críticos coinciden;
 *   2. mutando UN campo a la vez (NIT, DV, razón social/nombre, representante) → «diferente» SOLO en ese campo;
 *   3. con lectura dudosa → la mutación NO provoca ninguna diferencia automática;
 *   4. persona esperada distinta → críticos no_aplica y ninguna diferencia.
 * No copia documentos, no usa red y NO imprime datos: solo identificadores de muestra, campos y resultados. Los duplicados exactos
 * (mismo SHA-256) se cuentan una vez.
 */
import 'reflect-metadata';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ClasificacionDocumentoEmpresarial as C, TipoPersona } from '../src/domain/entities/documento-empresarial';
import { ComparacionCamara, SipraParaCamara, compararCamaraConSipra } from '../src/domain/services/comparacion-camara.domain-service';
import { LecturaLocalCamaraService, minimizarLecturaCamara } from '../src/domain/services/lectura-local-camara.domain-service';
import { Nit } from '../src/domain/value-objects/nit.vo';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';

const carpetaMuestras = process.env.CAMARA_MUESTRAS?.trim();
if (!carpetaMuestras) throw new Error('Defina CAMARA_MUESTRAS (carpeta de muestras).');
const forzarOcr = process.env.CAMARA_MODO === 'ocr';
const CARPETA = 'Cámara de Comercio';
const SALTO = String.fromCharCode(10);
const AHORA = new Date();

function identificadores(): Record<string, string> {
  const filas = readFileSync(join(carpetaMuestras!, 'manifest-documentos.csv'), 'utf8').split(SALTO).slice(1);
  const salida: Record<string, string> = {};
  for (const l of filas) {
    const c = [...l.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    if (c.length < 11 || c[1] !== CARPETA) continue;
    salida[c[0]] = (c[10].match(/id=([A-Z]+-[A-Z]*-?\d+)/) ?? [])[1] ?? c[0].slice(0, 10);
  }
  return salida;
}

const diferentes = (c: ComparacionCamara): string[] => c.campos.filter((x) => x.resultado === 'diferente').map((x) => x.campo);
const resumenCriticos = (c: ComparacionCamara): string => c.campos.filter((x) => x.criticidad !== 'informativo').map((x) => `${x.campo}=${x.resultado}`).join(' ');

async function main(): Promise<void> {
  const ids = identificadores();
  const lector = new LectorDocumentoLocalAdapter();
  const servicio = new LecturaLocalCamaraService(lector, lector);
  const vistos = new Set<string>();
  const tot = { muestras: 0, sinComparacion: 0, base: 0, baseConsistente: 0, falsosPositivos: 0, mutaciones: 0, mutacionesOk: 0, mutacionesDudosas: 0, dudosasSinDiferencia: 0, personaOk: 0, personaTotal: 0 };

  for (const archivo of readdirSync(join(carpetaMuestras!, CARPETA)).filter((f) => /\.pdf$/i.test(f)).sort()) {
    const id = ids[archivo] ?? archivo.slice(0, 10);
    const l = await servicio.leer(readFileSync(join(carpetaMuestras!, CARPETA, archivo)), 'application/pdf', undefined, { forzarOcr });
    if (vistos.has(l.hashSha256)) { console.log(`${id}  DUPLICADO exacto: no cuenta`); continue; }
    vistos.add(l.hashSha256);
    const p = minimizarLecturaCamara(l);
    tot.muestras += 1;
    const lectura = { tipoDetectado: p.tipoDetectado, datos: p.datos, lecturaDudosa: p.lecturaDudosa };
    const persona = p.tipoDetectado === C.CAMARA_MATRICULA_PERSONA_NATURAL ? TipoPersona.NATURAL : TipoPersona.JURIDICA;
    const d = p.datos;
    if (!d) {
      const sinSipra: SipraParaCamara = { personaEsperada: null, empresa: { nitNumero: '900123456', nitDv: 5, razonSocial: 'EMPRESA PRUEBA SAS', representanteLegal: null } };
      const c = compararCamaraConSipra(lectura, sinSipra, AHORA);
      tot.sinComparacion += c === null ? 1 : 0;
      console.log(`${id}  ${p.tipoDetectado}  comparación=${c === null ? 'null (correcto: revisión necesaria)' : 'PRESENTE (error)'}`);
      continue;
    }
    // SIPRA sintético equivalente a la lectura (el DV de SIPRA se calcula del NIT, como lo guarda la empresa).
    const nit = (d.nit ?? '').replace(/\D/g, '');
    let dvSipra: number | null = null;
    try { dvSipra = nit ? Nit.calcularDigitoVerificacion(nit) : null; } catch { dvSipra = null; }
    const base: SipraParaCamara = {
      personaEsperada: persona,
      empresa: { nitNumero: nit || null, nitDv: dvSipra, razonSocial: d.nombreORazonSocial, representanteLegal: persona === TipoPersona.JURIDICA ? d.representanteLegal : null },
    };
    const conBase = (sobre: Partial<NonNullable<SipraParaCamara['empresa']>>): SipraParaCamara => ({ ...base, empresa: { ...base.empresa!, ...sobre } });

    const c0 = compararCamaraConSipra(lectura, base, AHORA)!;
    tot.base += 1;
    const falsos = diferentes(c0);
    tot.falsosPositivos += falsos.length;
    const consistente = c0.veredicto === 'consistente' || (p.lecturaDudosa && c0.veredicto === 'revision_necesaria');
    tot.baseConsistente += consistente ? 1 : 0;
    console.log(`${SALTO}${id}  ${p.tipoDetectado}  método=${l.metodo} dudosa=${p.lecturaDudosa ? 'sí' : 'no'}  SIPRA=Cámara → ${c0.veredicto}  [${resumenCriticos(c0)}]${falsos.length ? `  FALSOS POSITIVOS: ${falsos.join(',')}` : ''}`);

    const mutaciones: [string, SipraParaCamara | null][] = [
      ['nit', nit ? conBase({ nitNumero: `${nit.slice(0, -1)}${(Number(nit.slice(-1)) + 1) % 10}` }) : null],
      ['dv', dvSipra !== null ? conBase({ nitDv: (dvSipra + 1) % 10 }) : null],
      [persona === TipoPersona.NATURAL ? 'nombre' : 'razon_social',
        d.nombreORazonSocial ? conBase({ razonSocial: persona === TipoPersona.NATURAL ? 'ZZZ YYY' : `${d.nombreORazonSocial} DEL NORTE` }) : null],
      ['representante_legal', persona === TipoPersona.JURIDICA && d.representanteLegal ? conBase({ representanteLegal: 'LUIS MIGUEL TORRES DIAZ' }) : null],
    ];
    for (const [campo, sipra] of mutaciones) {
      if (!sipra) continue;
      const c = compararCamaraConSipra(lectura, sipra, AHORA)!;
      const dif = diferentes(c);
      if (p.lecturaDudosa) {
        tot.mutacionesDudosas += 1;
        const ok = dif.length === 0;
        tot.dudosasSinDiferencia += ok ? 1 : 0;
        console.log(`   mutación ${campo.padEnd(20)} → lectura dudosa: diferencias=${dif.length} ${ok ? 'OK (insuficiente)' : 'ERROR'}`);
      } else {
        tot.mutaciones += 1;
        // El DV de un NIT cuyo DV no valida (lectura no confiable) tampoco debe dar «diferente».
        const nitNoConfiable = c.campos.find((x) => x.campo === 'nit')?.nota?.startsWith('nit_no_confiable') ?? false;
        const esperado = nitNoConfiable && (campo === 'nit' || campo === 'dv') ? [] : [campo];
        const ok = dif.length === esperado.length && dif.every((x, i) => x === esperado[i]);
        tot.mutacionesOk += ok ? 1 : 0;
        console.log(`   mutación ${campo.padEnd(20)} → diferente en [${dif.join(',') || '—'}] ${ok ? 'OK' : `ERROR (esperado [${esperado.join(',') || '—'}])`}`);
      }
    }
    // Persona esperada distinta: no se compara como si fuera la otra.
    tot.personaTotal += 1;
    const distinta = compararCamaraConSipra(lectura, { ...base, personaEsperada: persona === TipoPersona.NATURAL ? TipoPersona.JURIDICA : TipoPersona.NATURAL }, AHORA)!;
    const personaOk = diferentes(distinta).length === 0 && distinta.veredicto === 'no_aplica';
    tot.personaOk += personaOk ? 1 : 0;
    console.log(`   persona esperada distinta → ${distinta.veredicto} ${personaOk ? 'OK' : 'ERROR'}`);
  }

  console.log(`${SALTO}══ RESUMEN (duplicados exactos excluidos; modo ${forzarOcr ? 'OCR forzado' : 'normal'}) ══`);
  console.log(`muestras comparables: ${tot.muestras}  (sin comparación por documento incorrecto/no determinable: ${tot.sinComparacion})`);
  console.log(`SIPRA = Cámara: ${tot.baseConsistente}/${tot.base} sin discrepancia; falsos positivos: ${tot.falsosPositivos}`);
  console.log(`mutaciones con lectura confiable: ${tot.mutacionesOk}/${tot.mutaciones} dieron diferencia SOLO en el campo mutado`);
  console.log(`mutaciones con lectura dudosa: ${tot.dudosasSinDiferencia}/${tot.mutacionesDudosas} sin diferencia automática`);
  console.log(`persona esperada distinta: ${tot.personaOk}/${tot.personaTotal} → no_aplica sin diferencias`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
