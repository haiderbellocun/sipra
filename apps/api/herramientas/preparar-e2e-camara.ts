/**
 * Prepara los datos SINTÉTICOS del E2E de la Mesa de Cámara (apps/web/pruebas/e2e/mesa-camara.e2e.mjs):
 *   1. lee de la base desechable los datos de SIPRA de las tres prácticas sembradas (empresa: razón social, NIT y DV) y deja a la
 *      empresa con un representante legal sintético;
 *   2. genera, en una carpeta, los PDF sintéticos de cada caso: existencia y representación consistente, con razón social
 *      distinta (discrepancia crítica), con representante distinto, de persona natural (persona distinta), con el DV que no cuadra
 *      (lectura dudosa), con la matrícula cancelada, y un archivo que no es un certificado.
 *
 * Uso: DB_URL=postgres://…@127.0.0.1:…/base_desechable ts-node herramientas/preparar-e2e-camara.ts <carpeta-salida>
 * Se niega a correr contra una base que no sea local. Nada de esto toca datos reales ni se versiona (los PDF van a una carpeta
 * temporal). Los valores salen de los datos SINTÉTICOS de las semillas de desarrollo.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { Nit } from '../src/domain/value-objects/nit.vo';
import { TEXTO_CEDULA } from '../test/soporte-acta';
import { pdfDeLineas } from '../test/soporte-acta-pdf';
import { REPRESENTANTE } from '../test/soporte-documento-empresarial';
import { paginasCamaraExistencia, paginasCamaraPn } from '../test/soporte-camara-sintetico';

const url = process.env.DB_URL?.trim();
if (!url) { console.error('Falta DB_URL.'); process.exit(2); }
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) { console.error(`Se niega a correr contra un host no local («${host}»).`); process.exit(2); }
const salida = resolve(process.argv[2] ?? '.');

const PRACTICAS = [
  '00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000043',
];
const REPRESENTANTE_OTRO = 'LUIS MIGUEL TORRES DIAZ';

const sinTildes = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const lineas = (paginas: string[]): string[] => paginas.join('\n').split('\n');

async function main(): Promise<void> {
  mkdirSync(salida, { recursive: true });
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    // La Cámara se exige a todos: la empresa de la práctica es lo que SIPRA compara. Representante sintético para el contraste.
    const empresa = (await db.query<{ id: string; razon_social: string; nit_numero: string; nit_dv: string }>(
      `SELECT e.id, e.razon_social, e.nit_numero, e.nit_dv FROM practicas p JOIN empresas e ON e.id = p.empresa_id WHERE p.id = $1`, [PRACTICAS[0]])).rows[0]
      ?? (await db.query<{ id: string; razon_social: string; nit_numero: string; nit_dv: string }>(
        `SELECT id, razon_social, nit_numero, nit_dv FROM empresas WHERE id = '00000000-0000-4000-8000-000000000031'`)).rows[0];
    await db.query('UPDATE empresas SET representante_legal = $2 WHERE id = $1', [empresa.id, REPRESENTANTE]);
    // La Cámara solo se exige en CUNbre consolidado (empresa propia constituida como persona jurídica): las tres prácticas pasan a esa
    // modalidad y todas apuntan a la misma empresa sintética (la tercera no tenía).
    await db.query(`UPDATE practicas SET modalidad = 'cunbre_consolidado', empresa_id = $2 WHERE id = ANY($1::uuid[])`, [PRACTICAS, empresa.id]);

    const razon = sinTildes(empresa.razon_social);
    const dv = String(empresa.nit_dv);
    const dvMalo = String((Number(dv) + 1) % 10);
    const manifiesto: Record<string, string> = {};
    const guardar = async (clave: string, texto: string[]): Promise<void> => {
      const ruta = join(salida, `camara-${clave}.pdf`);
      writeFileSync(ruta, await pdfDeLineas(texto));
      manifiesto[clave] = ruta;
    };

    const base = { nombre: razon, nit: empresa.nit_numero, dv };
    await guardar('pj-consistente', lineas(paginasCamaraExistencia(base)));
    await guardar('pj-razon-distinta', lineas(paginasCamaraExistencia({ ...base, nombre: 'COMERCIALIZADORA ANDINA DEL SUR S.A.S.' })));
    await guardar('pj-representante-distinto', lineas(paginasCamaraExistencia(base)).map((l) => l.replace(REPRESENTANTE, REPRESENTANTE_OTRO)));
    await guardar('pj-dudosa', lineas(paginasCamaraExistencia({ ...base, dv: dvMalo })));
    await guardar('pj-cancelada', lineas(paginasCamaraExistencia({ ...base, estado: 'CANCELADA' })));
    // Persona natural (cédula sintética) cuando SIPRA espera una persona jurídica.
    const cedula = '1000000001';
    await guardar('pn-persona-distinta', lineas(paginasCamaraPn({ nit: cedula, dv: String(Nit.calcularDigitoVerificacion(cedula)) })));
    // Archivo que no es un certificado.
    await guardar('documento-incorrecto', TEXTO_CEDULA.split('\n'));

    writeFileSync(join(salida, 'manifiesto.json'), JSON.stringify({ practicas: PRACTICAS, archivos: manifiesto }, null, 2));
    console.log(`Preparado: ${Object.keys(manifiesto).length} PDF sintéticos en ${salida}`);
  } finally {
    await db.end();
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
