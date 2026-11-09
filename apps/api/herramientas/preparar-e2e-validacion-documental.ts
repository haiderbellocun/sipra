/**
 * Prepara los datos SINTÉTICOS del E2E de la Mesa de Validación Documental (apps/web/pruebas/e2e/mesa-validacion-documental.e2e.mjs):
 *   1. crea, en una base DESECHABLE ya migrada y sembrada, al estudiante «Estudiante Prueba CUNbre» con una práctica de CUNbre
 *      consolidado y su empresa sintética «EMPRESA PRUEBA CUNBRE S.A.S.» (NIT 900888111-5, con representante legal). No toca a
 *      Laura, Andrés ni Valentina;
 *   2. genera, en una carpeta, los PDF sintéticos que ese estudiante cargará por la API (EPS, RUT jurídico, Cámara coherente y con
 *      otra razón social, acta de iniciación y un documento sin motor especializado), para que cada motor los procese de verdad.
 *      Las demás obligaciones (ARL, mentorías, evaluación…) quedan «Pendiente de cargar».
 *
 * Uso: DB_URL=postgres://…@127.0.0.1:…/base_desechable ts-node herramientas/preparar-e2e-validacion-documental.ts <carpeta-salida>
 * Se niega a correr contra una base que no sea local. Nada de esto toca datos reales ni se versiona.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { ModalidadPractica, definicionModalidad } from '../src/domain/entities/modalidad.entity';
import { Nit } from '../src/domain/value-objects/nit.vo';
import { pdfActaDigital, pdfDeLineas } from '../test/soporte-acta-pdf';
import { paginasCamaraExistencia } from '../test/soporte-camara-sintetico';
import { REPRESENTANTE } from '../test/soporte-documento-empresarial';
import { pdfRutSintetico } from '../test/soporte-rut-pdf';

const url = process.env.DB_URL?.trim();
if (!url) { console.error('Falta DB_URL.'); process.exit(2); }
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) { console.error(`Se niega a correr contra un host no local («${host}»).`); process.exit(2); }
const salida = resolve(process.argv[2] ?? '.');

const ESTUDIANTE_ID = '00000000-0000-4000-8000-0000000000e1';
const EMPRESA_ID = '00000000-0000-4000-8000-0000000000e2';
const PRACTICA_ID = '00000000-0000-4000-8000-0000000000e3';
const TUTOR_ID = '00000000-0000-4000-8000-000000000002';
const CORREO = 'estudiante.prueba.cunbre@estudiante.cun.edu.co';
const NOMBRE = 'Estudiante Prueba CUNbre';
const DOCUMENTO = '1098765432';
const NIT = '900888111';
const RAZON = 'EMPRESA PRUEBA CUNBRE S.A.S.';

const documentoComoActa = (d: string): string => `C.C. ${d.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const fechaComoActa = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const nitComoActa = (nit: string): string => `${nit.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${nit.slice(-1)}`;
const hoy = new Date();
const fechaEps = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;

async function main(): Promise<void> {
  mkdirSync(salida, { recursive: true });
  const dv = Nit.calcularDigitoVerificacion(NIT);
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query(
      `INSERT INTO usuarios (id, correo, nombre, documento, rol, escuelas, empresa_id, programa_id, activo, permiso)
       VALUES ($1,$2,$3,$4,'estudiante',ARRAY['ESC-NEG'],NULL,'ADM-PRO',true,'escritura') ON CONFLICT (id) DO NOTHING`,
      [ESTUDIANTE_ID, CORREO, NOMBRE, DOCUMENTO],
    );
    await db.query(
      `INSERT INTO empresas (id, razon_social, nit_numero, nit_dv, solicitante_nombre, solicitante_correo, estado, representante_legal)
       VALUES ($1,$2,$3,$4,'Persona sintética','prueba.cunbre@verificacion.example','habilitada',$5) ON CONFLICT (id) DO NOTHING`,
      [EMPRESA_ID, RAZON, NIT, dv, REPRESENTANTE],
    );
    await db.query(
      `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado, tutor_id, empresa_id, cargo,
         jefe_inmediato_nombre, fecha_inicio, fecha_fin, arl_verificada, ultima_actividad, tipo_remuneracion, responsable_arl, funciones_relevantes)
       VALUES ($1,$2,'ADM-PRO','ESC-NEG','profesional','2026-2','cunbre_consolidado','documentacion',$3,$4,'Emprendedor','Camila Restrepo Duarte',
         '2026-11-02','2027-02-02',false,now(),'no_remunerada','empresa','Apoyo en gestion documental y atencion de solicitudes internas')
       ON CONFLICT (id) DO NOTHING`,
      [PRACTICA_ID, ESTUDIANTE_ID, TUTOR_ID, EMPRESA_ID],
    );

    const manifiesto: Record<string, string> = {};
    const guardar = async (clave: string, contenido: Buffer): Promise<void> => {
      const ruta = join(salida, `${clave}.pdf`);
      writeFileSync(ruta, contenido);
      manifiesto[clave] = ruta;
    };
    const nombreEps = NOMBRE.toUpperCase();
    await guardar('eps', await pdfDeLineas([
      'Entidad Promotora de Salud NUEVA EPS S.A.', 'CERTIFICADO DE AFILIACION', `Nombre: ${nombreEps}`, `Documento: CC ${DOCUMENTO}`,
      'Régimen: Contributivo - Beneficiario', 'Estado: ACTIVO', `Fecha de expedición: ${fechaEps}`,
    ]));
    await guardar('rut', await pdfRutSintetico({ persona: 'juridica', nit: NIT, dv: String(dv), razonSocial: RAZON }));
    const base = { nombre: RAZON, nit: NIT, dv: String(dv) };
    await guardar('camara-ok', await pdfDeLineas(paginasCamaraExistencia(base).join('\n').split('\n')));
    await guardar('camara-razon-distinta', await pdfDeLineas(paginasCamaraExistencia({ ...base, nombre: 'COMERCIALIZADORA ANDINA DEL SUR S.A.S.' }).join('\n').split('\n')));
    const valores = {
      nombre: NOMBRE.normalize('NFD').replace(/[̀-ͯ]/g, ''), documento: documentoComoActa(DOCUMENTO), empresa: RAZON, nit: nitComoActa(`${NIT}${dv}`),
      inicio: fechaComoActa('2026-11-02'), fin: fechaComoActa('2027-02-02'), jefe: 'Camila Restrepo Duarte',
      tipo: definicionModalidad(ModalidadPractica.CUNBRE_CONSOLIDADO).etiqueta, programa: 'Administración de Empresas',
    };
    await guardar('acta', await pdfActaDigital({
      valores, remuneracion: 'no_remunerada', encabezadoArl: 'empresa', obligacionArl: 'empresa', firmaEmpresa: 'trazo', firmaPracticante: 'trazo',
    }));
    // Documento sin motor especializado (flujo general).
    await guardar('general', await pdfDeLineas(['Soporte de aceptación CUNbre', 'Documento sintético de prueba sin motor especializado.']));

    writeFileSync(join(salida, 'manifiesto.json'), JSON.stringify({
      practica: PRACTICA_ID, estudiante: { correo: CORREO, nombre: NOMBRE }, empresa: RAZON, archivos: manifiesto,
    }, null, 2));
    console.log(`Preparado: ${Object.keys(manifiesto).length} PDF sintéticos en ${salida}`);
  } finally {
    await db.end();
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
