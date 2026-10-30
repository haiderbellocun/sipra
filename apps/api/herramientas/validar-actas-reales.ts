/**
 * Validación MANUAL de la lectura local contra actas de iniciación reales guardadas FUERA del repositorio.
 *
 *   SIPRA_ACTAS_DIR="C:\sipra_pruebas_acta" npx ts-node --transpile-only herramientas/validar-actas-reales.ts
 *
 * Reglas:
 *  · Los documentos no se copian, no se versionan y no se citan: la salida solo trae códigos, conteos y los
 *    NOMBRES de los campos hallados, nunca su contenido ni el texto del documento.
 *  · El resultado esperado se deduce del NOMBRE del archivo («NO REMUNERADAS», «CUN ASUME ARL»…).
 *  · Es una verificación de lectura. NO sustituye probar con un acta diligenciada real (anonimizada o autorizada).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { LecturaLocalActaService } from '../src/domain/services/lectura-local-acta.domain-service';

const dir = process.env.SIPRA_ACTAS_DIR;
if (!dir) {
  console.error('Defina SIPRA_ACTAS_DIR con la carpeta (fuera del repositorio) que contiene los PDF.');
  process.exit(2);
}

function esperadoDe(nombre: string): { remuneracion: string; responsableArl: string } {
  const n = nombre.toUpperCase();
  return {
    remuneracion: /\bNO\s+REMUNERADAS\b/.test(n) ? 'no_remunerada' : 'remunerada',
    responsableArl: n.includes('CUN ASUME') ? 'cun' : 'empresa',
  };
}

async function main(): Promise<void> {
  const lector = new LectorDocumentoLocalAdapter();
  const servicio = new LecturaLocalActaService(lector, lector);
  let fallos = 0;
  for (const archivo of readdirSync(dir as string).filter((f) => f.toLowerCase().endsWith('.pdf'))) {
    const r = await servicio.leer(readFileSync(join(dir as string, archivo)), 'application/pdf');
    const { clasificacion: c, campos, firmas } = r.analisis;
    const esperado = esperadoDe(archivo);
    const ok = c.tipoActaDetectada === 'iniciacion_practicas'
      && c.remuneracion === esperado.remuneracion && c.responsableArl === esperado.responsableArl
      && c.confianzaResponsableArl === 'alta';
    if (!ok) fallos += 1;
    console.log(`\n${ok ? 'OK ' : 'FALLA'}  ${archivo}`);
    console.log(`  tipo=${c.tipoActaDetectada} remuneración=${c.remuneracion} ARL=${c.responsableArl} (${c.confianzaResponsableArl})`);
    console.log(`  señales=${JSON.stringify(c.senales)} discrepancias=${c.discrepanciasDocumento.length}`);
    console.log(`  formato: código=${campos.codigo_formato.valor} versión=${campos.version_formato.valor} fecha=${campos.fecha_formato.valor}`);
    console.log(`  campos con valor: [${Object.entries(campos).filter(([, v]) => v.valor !== null).map(([k]) => k).join(', ')}]`);
    console.log(`  método=${r.resumen.metodoLectura} páginas=${r.resumen.paginas} OCR=${r.resumen.paginasOcr.length} suficiencia=${JSON.stringify(r.resumen.suficiencia)}`);
    console.log(`  firmas: ${JSON.stringify(r.resumen.firmas)} empresa=${firmas.firmaEmpresaPresente} practicante=${firmas.firmaPracticantePresente} motivos=[${firmas.motivos.join(',')}]`);
    console.log(`  límites=[${r.resumen.limitesAplicados.join(',')}] errores=[${r.resumen.errores.join(',')}] ${r.resumen.duracionMs} ms`);
  }
  await lector.onModuleDestroy();
  console.log(fallos === 0 ? '\nTodos los formatos se clasifican como se espera.' : `\n${fallos} formato(s) no coinciden con lo esperado.`);
  process.exit(fallos === 0 ? 0 : 1);
}

void main();
