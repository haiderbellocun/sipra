/* eslint-disable no-console */
/**
 * Importación controlada del histórico del SGP (H2). Fuera de la API HTTP: no hay endpoint para subir el Excel.
 *
 *   SIMULACRO (por defecto, CERO escrituras):
 *     npm run historico:dry-run -- --file "<ruta.xlsx>"
 *     (con DB_URL, además LEE lo vigente para proyectar nuevas / sin cambios / versionadas; sin DB_URL, no conecta)
 *
 *   APLICAR (exige las DOS compuertas y una clave real):
 *     HISTORICO_IMPORT_APPLY=true HISTORICO_HMAC_KEY=… HISTORICO_HMAC_KEY_VERSION=v1 DB_URL=… \
 *       npm run historico:import -- --file "<ruta.xlsx>" --apply
 *
 *   Opciones: --source-system SGP|SGP_SINTETICO (por defecto SGP) · --sin-base (simulacro sin conectar) · --json
 *             --modo-carga batched|single (por defecto batched) · --perfil (memoria por etapa)
 *             --informe <archivo.json> (resumen agregado SIN datos personales) · --sin-solapamiento
 *             --sin-serving (no refresca el serving de Reportes tras un APPLY)
 *             --lector flujo|exceljs (por omisión `flujo`: sin temporales en disco ni cadenas personales en memoria)
 *   Configuración versionable: config/historico/programas-sgp.json y solapamiento.json (HISTORICO_OVERLAP_POLICY).
 *
 * La salida solo contiene agregados: ni documentos, ni nombres, ni correos, ni NIT, ni claves.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ImportarHistoricoUseCase, ResumenImportacion } from '../src/application/use-cases/historico/importar-historico.use-case';
import { SISTEMAS_ORIGEN, SistemaOrigen } from '../src/domain/historico/registro-historico';
import { HistoricoPostgresAdapter } from '../src/infrastructure/adapters/persistence/postgres/historico.adapter';
import { writeFile } from 'node:fs/promises';
import { cargarEquivalenciasProgramas, configuracionHistorico, configuracionSolapamiento } from '../src/infrastructure/historico/configuracion-historico';
import { LectorXlsxSgp } from '../src/infrastructure/historico/lector-xlsx-sgp';
import { LectorXlsxFlujoSgp } from '../src/infrastructure/historico/lector-xlsx-flujo';
import { publicarServing } from './historico-serving';

interface Argumentos {
  archivo: string; apply: boolean; sourceSystem: SistemaOrigen; sinBase: boolean; json: boolean;
  modoCarga: 'single' | 'batched'; perfil: boolean; informe: string | null; solapamiento: boolean; lector: 'flujo' | 'exceljs';
}

function argumentos(argv: string[]): Argumentos {
  const valor = (n: string): string | undefined => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const archivo = valor('--file');
  if (!archivo) throw new Error('Falta --file "<ruta del Excel del SGP>"');
  const sistema = (valor('--source-system') ?? 'SGP') as SistemaOrigen;
  if (!SISTEMAS_ORIGEN.includes(sistema)) throw new Error(`--source-system debe ser uno de: ${SISTEMAS_ORIGEN.join(', ')}`);
  if (argv.includes('--apply') && argv.includes('--dry-run')) throw new Error('--apply y --dry-run son excluyentes');
  const modoCarga = (valor('--modo-carga') ?? 'batched') as 'single' | 'batched';
  if (!['single', 'batched'].includes(modoCarga)) throw new Error('--modo-carga debe ser batched o single');
  return {
    archivo, apply: argv.includes('--apply'), sourceSystem: sistema, sinBase: argv.includes('--sin-base'), json: argv.includes('--json'),
    lector: (valor('--lector') ?? 'flujo') === 'exceljs' ? 'exceljs' : 'flujo',
    modoCarga, perfil: argv.includes('--perfil'), informe: valor('--informe') ?? null, solapamiento: !argv.includes('--sin-solapamiento'),
  };
}

/** Host de la base, sin credenciales, para que quien ejecuta sepa contra qué escribe. */
function destino(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
}

export async function ejecutarCli(argv: string[], entorno: NodeJS.ProcessEnv, salida: (l: string) => void = console.log): Promise<ResumenImportacion> {
  const a = argumentos(argv);
  const modo = a.apply ? 'apply' : 'dry-run';
  const config = configuracionHistorico(entorno, modo);
  const url = entorno.DB_URL?.trim();
  let ds: DataSource | null = null;
  if (url && !a.sinBase) {
    ds = await new DataSource({ type: 'postgres', url, ssl: false, extra: { max: 2, application_name: 'sipra-historico-import' } }).initialize();
    salida(`Base: ${destino(url)} (${modo === 'apply' ? 'ESCRITURA' : 'solo lectura'})`);
  } else {
    salida(`Base: ninguna (${modo === 'apply' ? 'APPLY requiere DB_URL' : 'simulacro sin comparar con lo vigente'})`);
  }
  if (config.seudonimizador.efimera) salida('Clave HMAC: efímera (simulacro): los conteos son válidos; las claves no son comparables con la base.');
  else salida(`Clave HMAC: versión ${config.seudonimizador.versionClave}`);
  salida(`Modo: ${modo.toUpperCase()}${modo === 'apply' ? ` · compuerta HISTORICO_IMPORT_APPLY=${config.compuertaApply}` : ''}`);
  try {
    const repo = ds ? new HistoricoPostgresAdapter(ds) : null;
    const caso = new ImportarHistoricoUseCase(a.lector === 'exceljs' ? new LectorXlsxSgp(a.archivo) : new LectorXlsxFlujoSgp(a.archivo), config.seudonimizador, repo);
    const programas = cargarEquivalenciasProgramas();
    const solapamiento = a.solapamiento ? configuracionSolapamiento(entorno) : undefined;
    salida(`Equivalencias de programas: versión ${programas.version} (${[...programas.programas.values()].filter((p) => p.estado === 'confirmado').length} confirmadas)`);
    if (solapamiento && repo) salida(`Solapamiento: política ${solapamiento.politica} (solo lectura de SIPRA)`);
    const resumen = await caso.ejecutar({
      modo, sourceSystem: a.sourceSystem, compuertaEntorno: config.compuertaApply, informar: salida,
      modoCarga: a.modoCarga, programas, solapamiento, perfilMemoria: a.perfil,
    });
    if (a.json) salida(JSON.stringify(resumen, null, 2));
    // H5: una importación publicada refresca el serving de Reportes (construir → validar → publicar).
    if (resumen.resultado === 'COMPLETED' && ds && !argv.includes('--sin-serving')) await publicarServing(ds, a.sourceSystem, salida);
    if (a.informe) await writeFile(a.informe, JSON.stringify(resumen, null, 2), 'utf8');
    return resumen;
  } finally {
    if (ds) await ds.destroy();
  }
}

if (require.main === module) {
  const memoria = { pico: 0 };
  const muestreo = setInterval(() => { memoria.pico = Math.max(memoria.pico, process.memoryUsage().rss); }, 250);
  const t0 = Date.now();
  ejecutarCli(process.argv.slice(2), process.env)
    .then((r) => {
      clearInterval(muestreo);
      memoria.pico = Math.max(memoria.pico, process.memoryUsage().rss);
      const s = (Date.now() - t0) / 1000;
      console.log(`Tiempo: ${s.toFixed(1)} s · ${Math.round(r.lectura.filasReales / s)} registros/s · memoria pico ≈ ${Math.round(memoria.pico / 1_048_576)} MB`);
      console.log(`Resultado: ${r.resultado}`);
    })
    .catch((e: Error) => {
      clearInterval(muestreo);
      // Solo el nombre y el mensaje propio: ningún error del importador incluye valores de origen.
      console.error(`ERROR ${e.name}: ${e.message}`);
      process.exit(1);
    });
}
