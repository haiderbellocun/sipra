/**
 * Prepara los datos SINTÉTICOS del E2E de la Mesa de Actas (apps/web/pruebas/e2e/mesa-actas.e2e.mjs):
 *   1. deja las tres prácticas sembradas con los datos que gobiernan la comparación (empresa, fechas, remuneración y
 *      responsable de la ARL), para que el Acta sintética coincida con SIPRA;
 *   2. genera, en una carpeta, los PDF sintéticos de cada caso (acta completa, sin firma de la empresa, con la ARL contraria y
 *      un documento que no es un acta).
 *
 * Uso: DB_URL=postgres://…@127.0.0.1:…/base_desechable ts-node herramientas/preparar-e2e-actas.ts <carpeta-salida>
 * Se niega a correr contra una base que no sea local. Nada de esto toca datos reales ni se versiona (los PDF van a una carpeta
 * temporal).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { ModalidadPractica, definicionModalidad } from '../src/domain/entities/modalidad.entity';
import { TEXTO_CEDULA } from '../test/soporte-acta';
import { pdfActaDigital, pdfDeLineas } from '../test/soporte-acta-pdf';

const url = process.env.DB_URL?.trim();
if (!url) { console.error('Falta DB_URL.'); process.exit(2); }
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) { console.error(`Se niega a correr contra un host no local («${host}»).`); process.exit(2); }
const salida = resolve(process.argv[2] ?? '.');

const PRACTICAS = [
  '00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000043',
];

/** Los nombres que devuelve el SINU simulado de desarrollo (externos.adapter.ts), por programa. */
const PROGRAMAS: Record<string, string> = {
  'ADM-PRO': 'Administración de Empresas', 'SIS-TGO': 'Tecnología en Desarrollo de Software', 'COM-TEC': 'Técnico Profesional en Procesos Comerciales',
};

/** «1032456786» → «C.C. 1.032.456.786», como lo escribe el formato. */
const documentoComoActa = (d: string): string => `C.C. ${d.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const fechaComoActa = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const nitComoActa = (nit: string): string => `${nit.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${nit.slice(-1)}`;

async function main(): Promise<void> {
  mkdirSync(salida, { recursive: true });
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const empresa = (await db.query<{ id: string; razon_social: string; nit: string }>(
      `SELECT id, razon_social, nit_numero || nit_dv AS nit FROM empresas WHERE id = '00000000-0000-4000-8000-000000000031'`)).rows[0];
    // Las tres con la misma empresa, fechas futuras fijas, no remunerada y la empresa asume la ARL.
    await db.query(
      `UPDATE practicas SET empresa_id = $1, fecha_inicio = '2026-11-02', fecha_fin = '2027-02-02', tipo_remuneracion = 'no_remunerada',
              responsable_arl = 'empresa', jefe_inmediato_nombre = 'Camila Restrepo Duarte',
              funciones_relevantes = 'Apoyo en gestion documental y atencion de solicitudes internas' WHERE id = ANY($2::uuid[])`,
      [empresa.id, PRACTICAS]);
    const filas = (await db.query<{ id: string; nombre: string; documento: string; modalidad: ModalidadPractica; programa_id: string }>(
      `SELECT p.id, u.nombre, u.documento, p.modalidad, p.programa_id FROM practicas p JOIN usuarios u ON u.id = p.estudiante_id WHERE p.id = ANY($1::uuid[]) ORDER BY p.id`, [PRACTICAS])).rows;
    const manifiesto: Record<string, string> = {};

    for (const [i, f] of filas.entries()) {
      const valores = {
        nombre: f.nombre.normalize('NFD').replace(/[̀-ͯ]/g, ''), documento: documentoComoActa(f.documento),
        empresa: empresa.razon_social, nit: nitComoActa(empresa.nit), inicio: fechaComoActa('2026-11-02'), fin: fechaComoActa('2027-02-02'),
        jefe: 'Camila Restrepo Duarte', tipo: definicionModalidad(f.modalidad).etiqueta, programa: PROGRAMAS[f.programa_id] ?? '',
      };
      const base = { valores, remuneracion: 'no_remunerada' as const, encabezadoArl: 'empresa' as const, obligacionArl: 'empresa' as const };
      const variantes: Record<string, Buffer> = {
        completa: await pdfActaDigital({ ...base, firmaEmpresa: 'trazo', firmaPracticante: 'trazo' }),
        // Sin ninguna firma: las dos zonas claramente vacías (una zona vacía junto a una firma presente NO se afirma como «no»).
        'sin-firmas': await pdfActaDigital({ ...base, firmaEmpresa: 'ninguna', firmaPracticante: 'ninguna' }),
        // Dice que la CUN asume la ARL, y SIPRA tiene «Empresa»: discrepancia crítica.
        'arl-cun': await pdfActaDigital({ ...base, encabezadoArl: 'cun', obligacionArl: 'institucion', firmaEmpresa: 'trazo', firmaPracticante: 'trazo' }),
      };
      for (const [nombre, contenido] of Object.entries(variantes)) {
        const ruta = join(salida, `acta-${i + 1}-${nombre}.pdf`);
        writeFileSync(ruta, contenido);
        manifiesto[`${i + 1}-${nombre}`] = ruta;
      }
    }
    const otro = join(salida, 'otro-documento.pdf');
    writeFileSync(otro, await pdfDeLineas(TEXTO_CEDULA.split('\n')));
    manifiesto['otro-documento'] = otro;
    writeFileSync(join(salida, 'manifiesto.json'), JSON.stringify({ practicas: PRACTICAS, archivos: manifiesto }, null, 2));
    console.log(`Preparado: ${Object.keys(manifiesto).length} PDF sintéticos en ${salida}`);
  } finally {
    await db.end();
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
