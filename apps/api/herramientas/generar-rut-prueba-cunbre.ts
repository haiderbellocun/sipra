/**
 * Genera dos RUT SINTÉTICOS de persona jurídica para la empresa de pruebas CUNbre (NIT 900888111-5), para probar a mano la carga y la
 * Mesa de RUT: uno que coincide con SIPRA y otro con otra razón social (discrepancia crítica, para probar devolución y reenvío).
 *
 * Uso: ts-node --transpile-only herramientas/generar-rut-prueba-cunbre.ts <carpeta-salida>
 * No toca ninguna base de datos ni usa datos reales; la carpeta de salida debe estar fuera del repositorio.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Nit } from '../src/domain/value-objects/nit.vo';
import { pdfRutSintetico } from '../test/soporte-rut-pdf';

const salida = resolve(process.argv[2] ?? '.');
const NIT = '900888111';

async function main(): Promise<void> {
  mkdirSync(salida, { recursive: true });
  const dv = String(Nit.calcularDigitoVerificacion(NIT));
  const ok = join(salida, 'rut-juridico-prueba-cunbre-OK.pdf');
  const otra = join(salida, 'rut-juridico-prueba-cunbre-OTRA-RAZON-SOCIAL.pdf');
  writeFileSync(ok, await pdfRutSintetico({ persona: 'juridica', nit: NIT, dv, razonSocial: 'EMPRESA PRUEBA CUNBRE S.A.S.' }));
  writeFileSync(otra, await pdfRutSintetico({ persona: 'juridica', nit: NIT, dv, razonSocial: 'COMERCIALIZADORA DEL SUR S.A.S.' }));
  console.log(`NIT ${NIT}-${dv}\n${ok}\n${otra}`);
}

void main();
