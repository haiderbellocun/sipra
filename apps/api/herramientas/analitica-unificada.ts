/* eslint-disable no-console */
/**
 * Validación INTERNA de la capa analítica unificada (H4). Sin endpoint: solo lectura, contra la base de `DB_URL`.
 *
 * Ejecuta CURRENT, HISTORICAL y ALL, compara CURRENT con el conteo operativo (`practicas`) y con el adaptador de
 * Reportes actual, mide tiempos y, con `--explain`, muestra el plan de las dos consultas de lectura.
 *
 *   DB_URL=… npm run analitica:validar -- [--sistema SGP|SGP_SINTETICO] [--explain] [--periodo 26V04]
 *
 * La salida solo contiene agregados (sin claves, documentos ni nombres de personas).
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AnaliticaUnificadaUseCase } from '../src/application/use-cases/analitica/analitica-unificada.use-case';
import { FuenteAnalitica, ResultadoAnaliticoUnificado } from '../src/domain/analitica/modelo-analitico';
import { SISTEMAS_ORIGEN, SistemaOrigen } from '../src/domain/historico/registro-historico';
import { AnaliticaUnificadaPostgresAdapter } from '../src/infrastructure/adapters/persistence/postgres/analitica-unificada.adapter';
import { ReportesAnaliticaAdapter } from '../src/infrastructure/adapters/persistence/postgres/reportes-analitica.adapter';
import { configuracionSolapamiento } from '../src/infrastructure/historico/configuracion-historico';
import { IdentidadAnaliticaHmac } from '../src/infrastructure/historico/identidad-analitica.adapter';

export function resumir(r: ResultadoAnaliticoUnificado): string {
  const top = (k: keyof ResultadoAnaliticoUnificado['dimensiones']): number => r.dimensiones[k].length;
  return [
    `prácticas ${r.totales.practicas} · estudiantes únicos ${r.totales.estudiantesUnicos} (${r.totales.precisionEstudiantes})`,
    `dimensiones: periodos ${top('periodo')} · programas ${top('programa')} · niveles ${top('nivel')} · regionales ${top('regional')} · modalidad estudio ${top('modalidadEstudio')} · modalidad práctica ${top('modalidadPractica')} · estados ${top('estado')} · organizaciones ${top('organizacion')} · ciudades ${top('ciudad')}`,
    `tasas: cierre ${r.tasas.cierre.numerador}/${r.tasas.cierre.denominador} · reprobación ${r.tasas.reprobacion.numerador}/${r.tasas.reprobacion.denominador} · anulación ${r.tasas.anulacion.numerador}/${r.tasas.anulacion.denominador}`,
    `duración: ${r.duracion.casos} casos, mediana ${r.duracion.mediana ?? '—'} días · indicador documental SGP: ${r.indicadorDocumentalSgp ? `${r.indicadorDocumentalSgp.casos} casos` : 'no aplica'}`,
    r.solapamiento ? `solapamiento: ${JSON.stringify(r.solapamiento.categorias)} · fuera de ALL ${JSON.stringify(r.solapamiento.excluidosDeAll)}` : '',
    r.advertencias.length ? `advertencias: ${r.advertencias.join(' | ')}` : '',
  ].filter(Boolean).map((l) => `    ${l}`).join('\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const valor = (n: string): string | undefined => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const sistema = (valor('--sistema') ?? 'SGP') as SistemaOrigen;
  if (!SISTEMAS_ORIGEN.includes(sistema)) throw new Error(`--sistema debe ser uno de: ${SISTEMAS_ORIGEN.join(', ')}`);
  const periodo = valor('--periodo');
  const url = process.env.DB_URL?.trim();
  if (!url) throw new Error('Defina DB_URL');
  const ds = await new DataSource({ type: 'postgres', url, ssl: false, extra: { max: 2, application_name: 'sipra-analitica-validacion' } }).initialize();
  try {
    const identidad = IdentidadAnaliticaHmac.desdeEntorno(process.env);
    const caso = new AnaliticaUnificadaUseCase(new AnaliticaUnificadaPostgresAdapter(ds), identidad, {
      sistema, fronteras: configuracionSolapamiento(process.env).fronteras,
    });
    console.log(`Base: ${new URL(url).hostname}${new URL(url).pathname} (solo lectura) · sistema ${sistema} · identidad ${identidad.versiones().length ? `versiones ${identidad.versiones().join(',')}` : 'sin clave (ALL = cota superior)'}`);
    const filtro = periodo ? { periodos: [periodo] } : {};
    for (const fuente of ['current', 'historical', 'all'] as FuenteAnalitica[]) {
      const t0 = Date.now();
      const r = await caso.consultar({ fuente, ...filtro });
      console.log(`  ${fuente.toUpperCase()} (${Date.now() - t0} ms)\n${resumir(r)}`);
    }
    // CURRENT debe coincidir con la operación y con el Reportes actual.
    const [{ n }] = (await ds.query(`SELECT count(*)::int AS n FROM practicas WHERE ($1::text IS NULL OR periodo_academico = $1)`, [periodo ?? null])) as { n: number }[];
    const reportes = new ReportesAnaliticaAdapter(ds, new ConfigService({}));
    const filasReportes = await reportes.practicas(periodo ? { periodos: [periodo] } : {});
    const actual = await caso.consultar({ fuente: 'current', ...filtro });
    console.log(`  CURRENT vs operación: analítica ${actual.totales.practicas} · practicas ${n} · Reportes V3 ${filasReportes.length} → ${actual.totales.practicas === n && n === filasReportes.length ? 'COINCIDEN' : 'DIFIEREN'}`);
    if (argv.includes('--explain')) {
      for (const [nombre, sql, p] of [
        ['histórico', `SELECT p.source_record_id FROM historico.practicas p JOIN historico.importaciones i ON i.id = p.importacion_id AND i.status = 'completed'
           LEFT JOIN historico.organizaciones o ON o.source_system = p.source_system AND o.organization_key = p.organization_key AND o.hmac_key_version = p.hmac_key_version
           LEFT JOIN historico.organizacion_mapping m ON m.organizacion_id = o.id AND m.status = 'confirmada'
           WHERE p.is_current AND p.source_system = $1 AND ($2::text[] IS NULL OR coalesce(p.periodo_normalizado, p.periodo_original) = ANY($2::text[]))`, [sistema, periodo ? [periodo] : null]],
        ['actual', `SELECT p.id FROM practicas p LEFT JOIN empresas e ON e.id = p.empresa_id LEFT JOIN cat_divipola dv ON dv.codigo = e.divipola_municipio
           WHERE ($1::text[] IS NULL OR p.periodo_academico = ANY($1::text[]))`, [periodo ? [periodo] : null]],
      ] as const) {
        const plan = (await ds.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`, [...p])) as { 'QUERY PLAN': string }[];
        console.log(`  EXPLAIN ${nombre}:\n${plan.map((l) => `      ${l['QUERY PLAN']}`).join('\n')}`);
      }
    }
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) main().catch((e: Error) => { console.error(`ERROR ${e.name}: ${e.message}`); process.exit(1); });
