/**
 * Prepara los datos SINTÉTICOS del E2E de la Mesa de RUT (apps/web/pruebas/e2e/mesa-rut.e2e.mjs):
 *   1. lee de la base desechable los datos de SIPRA de las tres prácticas sembradas (estudiante y empresa);
 *   2. genera, en una carpeta, los PDF sintéticos de cada caso: un RUT natural que coincide con SIPRA, uno con otro documento
 *      de identidad (discrepancia crítica), un RUT jurídico que coincide con la empresa, un RUT natural escaneado (OCR dudoso),
 *      un RUT digital con DV que no cuadra (lectura dudosa digital) y un archivo que no es un RUT.
 *
 * Uso: DB_URL=postgres://…@127.0.0.1:…/base_desechable ts-node herramientas/preparar-e2e-rut.ts <carpeta-salida>
 * Se niega a correr contra una base que no sea local. Nada de esto toca datos reales ni se versiona (los PDF van a una carpeta
 * temporal). Los valores de los RUT salen de los datos SINTÉTICOS de las semillas de desarrollo.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { Nit } from '../src/domain/value-objects/nit.vo';
import { TEXTO_CEDULA } from '../test/soporte-acta';
import { pdfDeLineas } from '../test/soporte-acta-pdf';
import { pdfRutSintetico } from '../test/soporte-rut-pdf';

const url = process.env.DB_URL?.trim();
if (!url) { console.error('Falta DB_URL.'); process.exit(2); }
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) { console.error(`Se niega a correr contra un host no local («${host}»).`); process.exit(2); }
const salida = resolve(process.argv[2] ?? '.');

const PRACTICAS = [
  '00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000043',
];

const sinTildes = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
/** «Laura Sofía Ramírez Ortiz» → nombres LAURA SOFIA, apellidos RAMIREZ ORTIZ (los nombres de las semillas son de cuatro palabras). */
function partes(nombre: string): { nombres: [string, string]; apellidos: [string, string] } {
  const p = sinTildes(nombre).split(/\s+/);
  if (p.length >= 4) return { nombres: [p[0], p[1]], apellidos: [p[2], p[3]] };
  return { nombres: [p[0], p[1] ?? p[0]], apellidos: [p[p.length - 1], p[p.length - 1]] };
}

async function main(): Promise<void> {
  mkdirSync(salida, { recursive: true });
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    // El RUT solo se exige en CUNbre: naciente (natural) para las estudiantes 1 y 3, consolidado (jurídica) para el estudiante 2.
    await db.query(`UPDATE practicas SET modalidad = 'cunbre_naciente' WHERE id = ANY($1::uuid[])`, [[PRACTICAS[0], PRACTICAS[2]]]);
    await db.query(`UPDATE practicas SET modalidad = 'cunbre_consolidado' WHERE id = $1`, [PRACTICAS[1]]);
    const filas = (await db.query<{ id: string; nombre: string; documento: string; empresa_id: string | null }>(
      `SELECT p.id, u.nombre, u.documento, p.empresa_id FROM practicas p JOIN usuarios u ON u.id = p.estudiante_id WHERE p.id = ANY($1::uuid[]) ORDER BY p.id`, [PRACTICAS])).rows;
    const empresa = (await db.query<{ razon_social: string; nit_numero: string; nit_dv: string }>(
      `SELECT razon_social, nit_numero, nit_dv FROM empresas WHERE id = '00000000-0000-4000-8000-000000000031'`)).rows[0];
    const manifiesto: Record<string, string> = {};
    const guardar = (clave: string, nombre: string, contenido: Buffer): void => {
      const ruta = join(salida, nombre);
      writeFileSync(ruta, contenido);
      manifiesto[clave] = ruta;
    };

    // Cada estudiante: un RUT natural que coincide con SIPRA, y uno con otro documento de identidad.
    for (const [i, f] of filas.entries()) {
      const { nombres, apellidos } = partes(f.nombre);
      guardar(`${i + 1}-natural-ok`, `rut-${i + 1}-natural-ok.pdf`, await pdfRutSintetico({ persona: 'natural', nit: f.documento, numeroDocumento: f.documento, nombres, apellidos }));
      guardar(`${i + 1}-natural-otro-documento`, `rut-${i + 1}-natural-otro-documento.pdf`, await pdfRutSintetico({ persona: 'natural', nit: '1000000099', numeroDocumento: '1000000099', nombres, apellidos }));
    }

    // Persona jurídica: coincide con la empresa de la práctica (con su dígito de verificación registrado).
    const razon = sinTildes(empresa.razon_social);
    const pj = await pdfRutSintetico({ persona: 'juridica', nit: empresa.nit_numero, dv: String(empresa.nit_dv), razonSocial: razon });
    guardar('juridica-ok', 'rut-juridica-ok.pdf', pj);

    // Persona jurídica con otra razón social: discrepancia crítica contra la empresa de la práctica.
    guardar('juridica-otra-razon', 'rut-juridica-otra-razon.pdf', await pdfRutSintetico({ persona: 'juridica', nit: empresa.nit_numero, dv: String(empresa.nit_dv), razonSocial: 'COMERCIALIZADORA ANDINA DEL SUR S.A.S.' }));

    // Archivo que no es un RUT.
    guardar('otro-documento', 'otro-documento.pdf', await pdfDeLineas(TEXTO_CEDULA.split('\n')));

    // Digital de persona natural con el DV del documento que no cuadra: lectura dudosa SIN OCR (el E2E marca su método como OCR por SQL).
    const tercera = filas[2];
    const t = partes(tercera.nombre);
    const dvMalo = String((Nit.calcularDigitoVerificacion(tercera.documento) + 1) % 10);
    guardar('natural-dv-malo', 'rut-3-natural-dv-malo.pdf', await pdfRutSintetico({ persona: 'natural', nit: tercera.documento, dv: dvMalo, numeroDocumento: tercera.documento, nombres: t.nombres, apellidos: t.apellidos }));

    writeFileSync(join(salida, 'manifiesto.json'), JSON.stringify({ practicas: PRACTICAS, archivos: manifiesto }, null, 2));
    console.log(`Preparado: ${Object.keys(manifiesto).length} PDF sintéticos en ${salida}`);
  } finally {
    await db.end();
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
