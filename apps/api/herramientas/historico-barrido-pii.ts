/* eslint-disable no-console */
/**
 * Barrido de datos personales PERSISTIBLES del histórico del SGP (§31), ANTES de un APPLY.
 *
 * Lee el Excel con el mismo lector y la misma transformación que el importador y revisa CADA campo textual del
 * registro que iría a la base. Imprime solo conteos por campo y patrón: nunca un valor. Sale con código 1 si encuentra
 * cualquier coincidencia. No conecta a la base ni escribe nada.
 *
 *   HISTORICO_HMAC_KEY=… HISTORICO_HMAC_KEY_VERSION=v1 npm run historico:barrido-pii -- --file "<ruta.xlsx>"
 *
 * Exclusiones explícitas (no son texto del Excel): claves HMAC y huellas SHA-256 (se exige formato hexadecimal de 64),
 * `nitJuridica` (solo NIT de persona jurídica, se exige `^[89]\d{8}$`), `sourceRecordId` (el `#` numérico del SGP) y,
 * en `salarioOriginal`, la regla de dígitos continuos (un monto legítimo tiene 7+ dígitos; correo y celular sí aplican).
 */
import 'reflect-metadata';
import { cargarEquivalenciasProgramas, configuracionHistorico } from '../src/infrastructure/historico/configuracion-historico';
import { LectorXlsxFlujoSgp } from '../src/infrastructure/historico/lector-xlsx-flujo';
import { RegistroHistorico, transformarFilaSgp } from '../src/domain/historico/registro-historico';
import { patronesPii } from '../src/domain/historico/saneamiento-pii-historico';

const HEX64 = /^[0-9a-f]{64}$/;
const CLAVES_HEX: readonly (keyof RegistroHistorico)[] = ['contentHash', 'huellaSinId', 'studentKey', 'teacherKey', 'organizationKey', 'empresaAliasHash'];

export async function barrerPii(archivo: string, entorno: NodeJS.ProcessEnv): Promise<{ registros: number; hallazgos: Record<string, number>; marcas: Record<string, number> }> {
  const { seudonimizador } = configuracionHistorico(entorno, 'dry-run');
  const programas = cargarEquivalenciasProgramas();
  const lector = new LectorXlsxFlujoSgp(archivo);
  const hallazgos: Record<string, number> = {};
  const marcas: Record<string, number> = {};
  const sumar = (k: string): void => { hallazgos[k] = (hallazgos[k] ?? 0) + 1; };
  let registros = 0;
  for await (const fila of lector.filasReales()) {
    const r = transformarFilaSgp(fila, 'SGP', seudonimizador, { programas });
    registros++;
    for (const m of r.qualityFlags) if (m.startsWith('PII_')) marcas[m] = (marcas[m] ?? 0) + 1;
    for (const [campo, valor] of Object.entries(r) as [keyof RegistroHistorico, unknown][]) {
      if (CLAVES_HEX.includes(campo)) { if (valor !== null && !HEX64.test(String(valor))) sumar(`${campo}:NO_HEX64`); continue; }
      if (campo === 'nitJuridica') { if (valor !== null && !/^[89]\d{8}$/.test(String(valor))) sumar(`${campo}:FORMATO`); continue; }
      if (campo === 'sourceRecordId') { if (!/^\d+$/.test(String(valor))) sumar(`${campo}:FORMATO`); continue; }
      const textos = typeof valor === 'string' ? [valor] : Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string') : [];
      for (const t of textos) for (const p of patronesPii(t, { digitosContinuos: campo !== 'salarioOriginal' })) sumar(`${campo}:${p}`);
    }
  }
  return { registros, hallazgos, marcas };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--file');
  if (i < 0 || !argv[i + 1]) throw new Error('Falta --file "<ruta del Excel del SGP>"');
  barrerPii(argv[i + 1], process.env).then(({ registros, hallazgos, marcas }) => {
    console.log(`Registros transformados: ${registros}`);
    console.log(`Campos saneados (marcas): ${JSON.stringify(marcas)}`);
    const total = Object.values(hallazgos).reduce((a, b) => a + b, 0);
    console.log(`PII DIRECTA PERSISTIBLE: ${total}${total ? ` ${JSON.stringify(hallazgos)}` : ''}`);
    process.exit(total ? 1 : 0);
  }).catch((e: Error) => { console.error(`ERROR: ${e.message}`); process.exit(2); });
}
