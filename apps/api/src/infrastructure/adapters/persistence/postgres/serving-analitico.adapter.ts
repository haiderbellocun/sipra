import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { EstadoOperativo } from '../../../../domain/entities/practica.entity';
import { CRUCES, CeldaCruce, CruceAnalitico, DIMENSIONES, DimensionAnalitica, NOMBRES_CRUCES } from '../../../../domain/analitica/serving-analitico';
import { MetricaHistorica } from '../../../../domain/historico/politica-calidad-historico';
import { SistemaOrigen } from '../../../../domain/historico/registro-historico';
import {
  AgregadosServing, FilaServing, FiltroServing, ServingHistoricoEscrituraPort, ServingHistoricoLecturaPort, ServingHistoricoNoDisponibleError,
} from '../../../../domain/ports/out/serving-analitico.port';

/** Columna `e_*` de cada métrica materializada. */
const COLUMNA_ELEGIBLE: Readonly<Partial<Record<MetricaHistorica, string>>> = {
  practicas: 'e_practicas', estudiantes_unicos: 'e_estudiantes', practicas_por_periodo: 'e_periodo', programa: 'e_programa', nivel: 'e_nivel',
  regional: 'e_regional', modalidad_estudio: 'e_mod_estudio', modalidad_practica: 'e_mod_practica', estado: 'e_estado', tasa_cierre: 'e_tasa',
  organizacion: 'e_organizacion', ciudad: 'e_ciudad', duracion: 'e_duracion', indicador_documental_sgp: 'e_doc_sgp',
};

/** Dimensión → (columna clave, columna etiqueta, columna de elegibilidad). */
const DIM_SQL: Readonly<Record<DimensionAnalitica, [string, string, string]>> = {
  periodo: ['periodo_clave', 'periodo_etiqueta', 'e_periodo'],
  programa: ['programa_clave', 'programa_etiqueta', 'e_programa'],
  nivel: ['nivel', 'nivel', 'e_nivel'],
  regional: ['regional_clave', 'regional_etiqueta', 'e_regional'],
  modalidadEstudio: ['modalidad_estudio_clave', 'modalidad_estudio_etiqueta', 'e_mod_estudio'],
  modalidadPractica: ['modalidad_practica_clave', 'modalidad_practica_etiqueta', 'e_mod_practica'],
  estado: ['estado', 'estado', 'e_estado'],
  organizacion: ['organizacion_clave', 'organizacion_etiqueta', 'e_organizacion'],
  ciudad: ['ciudad_clave', 'ciudad_etiqueta', 'e_ciudad'],
};

const COLUMNAS: readonly (readonly [string, string, (f: FilaServing) => unknown])[] = [
  ['analytics_id', 'varchar', (f) => f.analyticsId], ['source_record_id', 'varchar', (f) => f.sourceRecordId],
  ['student_key', 'char(64)', (f) => f.studentKey], ['hmac_key_version', 'varchar', (f) => f.hmacKeyVersion],
  ['escuela_id', 'varchar', (f) => f.escuelaId], ['periodo_clave', 'varchar', (f) => f.periodoClave],
  ['periodo_etiqueta', 'varchar', (f) => f.periodoEtiqueta], ['periodo_codigo', 'varchar', (f) => f.periodoCodigo],
  ['programa_clave', 'varchar', (f) => f.programaClave], ['programa_etiqueta', 'varchar', (f) => f.programaEtiqueta],
  ['programa_mapeado', 'boolean', (f) => f.programaMapeado], ['nivel', 'varchar', (f) => f.nivel],
  ['regional_clave', 'varchar', (f) => f.regionalClave], ['regional_etiqueta', 'varchar', (f) => f.regionalEtiqueta],
  ['modalidad_estudio_clave', 'varchar', (f) => f.modalidadEstudioClave], ['modalidad_estudio_etiqueta', 'varchar', (f) => f.modalidadEstudioEtiqueta],
  ['modalidad_practica_clave', 'varchar', (f) => f.modalidadPracticaClave], ['modalidad_practica_etiqueta', 'varchar', (f) => f.modalidadPracticaEtiqueta],
  ['modalidad_codigo', 'varchar', (f) => f.modalidadCodigo], ['estado', 'varchar', (f) => f.estado],
  ['es_estado_de_corte', 'boolean', (f) => f.esEstadoDeCorte], ['estado_al', 'timestamptz', (f) => f.estadoAl],
  ['organizacion_clave', 'varchar', (f) => f.organizacionClave], ['organizacion_etiqueta', 'varchar', (f) => f.organizacionEtiqueta],
  ['ciudad_clave', 'varchar', (f) => f.ciudadClave], ['ciudad_etiqueta', 'varchar', (f) => f.ciudadEtiqueta],
  ['fecha_inicio', 'date', (f) => f.fechaInicio], ['fecha_fin', 'date', (f) => f.fechaFin], ['fecha_creacion', 'date', (f) => f.fechaCreacion],
  ['duracion_dias', 'integer', (f) => f.duracionDias], ['documentos_subidos_ratio', 'numeric', (f) => f.documentosSubidosRatio],
  ['documentos_aprobados_ratio', 'numeric', (f) => f.documentosAprobadosRatio],
  ...Object.entries(COLUMNA_ELEGIBLE).map(([m, c]) => [c, 'boolean', (f: FilaServing) => f.elegible[m as MetricaHistorica] === true] as const),
];

const ESPACIO_BLOQUEO = 0x48495354;

/**
 * Serving analítico del histórico (H5). La API solo LEE (SELECT concedido por la migración 28); la publicación la hace
 * el rol de carga desde la CLI.
 *
 * Lectura: UNA sentencia sobre la versión del puntero publicado (la misma instantánea MVCC para todo el resultado),
 * con los filtros en SQL y todos los agregados en un único viaje. Si no hay publicación o no se puede leer, error
 * controlado: la fuente Actual no depende de esto.
 */
export class ServingAnaliticoPostgresAdapter implements ServingHistoricoLecturaPort, ServingHistoricoEscrituraPort {
  constructor(private readonly ds: DataSource) {}

  async agregados(f: FiltroServing): Promise<AgregadosServing> {
    const sinEscuela = `
        ($2::text[] IS NULL OR s.periodo_clave = ANY($2::text[]) OR s.periodo_codigo = ANY($2::text[]))
        AND ($4::text IS NULL OR s.programa_clave = $4) AND ($5::text IS NULL OR s.nivel = $5) AND ($6::text IS NULL OR s.regional_clave = $6)
        AND ($7::text IS NULL OR s.modalidad_estudio_clave = $7) AND ($8::text IS NULL OR s.modalidad_practica_clave = $8)
        AND ($9::text IS NULL OR s.estado = $9) AND ($10::text IS NULL OR s.organizacion_clave = $10) AND ($11::text IS NULL OR s.ciudad_clave = $11)
        AND NOT (s.source_record_id = ANY($12::text[]))`;
    // Una agregación estrecha por dimensión. La etiqueta es función de la clave (la fija la proyección al publicar), así
    // que se agrupa por ambas sin agregados de texto; si alguna vez no lo fuera, la equivalencia con H4 lo detecta.
    // Medido en §29.6 con 10.000: GROUPING SETS ~275 ms y despliegue LATERAL ~161 ms frente a esta forma.
    const dims = DIMENSIONES.map((d) => {
      const [c, e, el] = DIM_SQL[d];
      return `SELECT '${d}' AS d, ${c}::text AS c, ${e}::text AS e, count(*)::int AS n FROM base WHERE ${el} AND ${c} IS NOT NULL GROUP BY ${c}, ${e}`;
    }).join(' UNION ALL ');
    // Cruces comparables (§32): misma forma estrecha, con la elegibilidad de las dos dimensiones.
    const sqlCruces = NOMBRES_CRUCES.map((x) => {
      const [a, b] = CRUCES[x].map((d) => DIM_SQL[d]);
      return `SELECT '${x}' AS x, ${a[0]}::text AS fa, ${a[1]}::text AS fe, ${b[0]}::text AS ca, ${b[1]}::text AS ce, count(*)::int AS n
        FROM base WHERE ${a[2]} AND ${b[2]} AND ${a[0]} IS NOT NULL AND ${b[0]} IS NOT NULL GROUP BY ${a[0]}, ${a[1]}, ${b[0]}, ${b[1]}`;
    }).join(' UNION ALL ');
    const sqlElegibles = Object.entries(COLUMNA_ELEGIBLE).map(([m, c]) => `'${m}', count(*) FILTER (WHERE en_base AND ${c})`).join(', ');
    let filas: { r: Record<string, unknown> | null }[];
    try {
      // Sin CTE materializadas: las filas del serving son anchas y materializarlas derrama a disco (H5, §29.6). Cada
      // agregado es una pasada sobre la versión publicada; las cifras escalares van juntas en una sola pasada.
      // `en_base` nunca es NULL: el SGP no trae escuela y `NULL = ANY(...)` lo dejaría fuera de «excluidos por alcance».
      filas = await this.ds.query<{ r: Record<string, unknown> | null }[]>(`
        WITH pub AS (SELECT version, corte, desde, publicado_en FROM historico.serving_publicacion WHERE sistema = $1),
        alcance AS NOT MATERIALIZED (
          SELECT s.*, ($3::text[] IS NULL OR coalesce(s.escuela_id = ANY($3::text[]), false)) AS en_base
          FROM historico.serving_practicas s JOIN pub ON pub.version = s.version WHERE ${sinEscuela}),
        base AS NOT MATERIALIZED (SELECT * FROM alcance WHERE en_base)
        SELECT json_build_object(
          'publicacion', (SELECT json_build_object('version', version, 'corte', corte, 'desde', desde, 'publicadoEn', publicado_en) FROM pub),
          'esc', (SELECT json_build_object(
                    'filas', count(*) FILTER (WHERE en_base),
                    'practicas', count(*) FILTER (WHERE en_base AND e_practicas),
                    'tasas', json_build_array(count(*) FILTER (WHERE en_base AND e_tasa), count(*) FILTER (WHERE en_base AND e_tasa AND estado = 'cerrado'),
                      count(*) FILTER (WHERE en_base AND e_tasa AND estado = 'reprobado'), count(*) FILTER (WHERE en_base AND e_tasa AND estado = 'anulado')),
                    'documentos', json_build_array(count(*) FILTER (WHERE en_base AND e_doc_sgp), coalesce(sum(documentos_subidos_ratio) FILTER (WHERE en_base AND e_doc_sgp), 0),
                      coalesce(sum(documentos_aprobados_ratio) FILTER (WHERE en_base AND e_doc_sgp), 0)),
                    'elegibles', json_build_object(${sqlElegibles}),
                    'excluidosPorAlcance', count(*) FILTER (WHERE e_practicas AND NOT en_base),
                    'sinEquivalencia', count(*) FILTER (WHERE en_base AND e_practicas AND NOT programa_mapeado)) FROM alcance),
          'ids', (SELECT json_build_object(
                    'estudiantes', count(DISTINCT k) FILTER (WHERE e_estudiantes),
                    'compartidos', count(DISTINCT k) FILTER (WHERE e_estudiantes AND k = ANY($13::text[])),
                    'versiones', coalesce(json_agg(DISTINCT hmac_key_version), '[]'))
                  -- La identidad es hexadecimal con prefijo de versión: colación "C" (bytes) da el mismo DISTINCT, sin locale.
                  FROM (SELECT (hmac_key_version || ':' || student_key) COLLATE "C" AS k, e_estudiantes, hmac_key_version FROM base) x),
          'dims', (SELECT coalesce(json_agg(json_build_array(d, c, e, n)), '[]') FROM (${dims}) g),
          'cruces', (SELECT coalesce(json_agg(json_build_array(x, fa, fe, ca, ce, n)), '[]') FROM (${sqlCruces}) g),
          'duracion', (SELECT coalesce(json_agg(json_build_array(d, n)), '[]') FROM (SELECT duracion_dias AS d, count(*)::int AS n FROM base WHERE e_duracion GROUP BY 1) x),
          'solape', (SELECT coalesce(json_agg(json_build_array(analytics_id, hmac_key_version || ':' || student_key, periodo_codigo, nivel, modalidad_codigo,
                      fecha_inicio, fecha_fin, estado, fecha_creacion)), '[]')
                     FROM base WHERE cardinality($13::text[]) > 0 AND (hmac_key_version || ':' || student_key) = ANY($13::text[]))
        ) AS r`,
      [f.sistema, f.periodos?.length ? [...f.periodos] : null, f.escuelaIds ? [...f.escuelaIds] : null, f.programa ?? null, f.nivel ?? null,
        f.regional ?? null, f.modalidadEstudio ?? null, f.modalidadPractica ?? null, f.estado ?? null, f.organizacion ?? null, f.ciudad ?? null,
        [...f.excluirRegistros], [...f.clavesEstudiantesActuales]]);
    } catch (e) {
      throw new ServingHistoricoNoDisponibleError(`no se pudo leer (${(e as Error).message.slice(0, 120)})`);
    }
    const crudo = filas[0]?.r;
    if (!crudo?.publicacion) throw new ServingHistoricoNoDisponibleError('no hay una publicación del histórico para este sistema');
    const r: Record<string, unknown> = { ...crudo, ...(crudo.esc as Record<string, unknown>), ...(crudo.ids as Record<string, unknown>) };
    const pub = r.publicacion as { version: string; corte: string | null; desde: string | null; publicadoEn: string };
    const dimensiones = Object.fromEntries(DIMENSIONES.map((d) => [d, [] as { clave: string; etiqueta: string; valor: number }[]])) as AgregadosServing['dimensiones'];
    for (const [d, c, e, n] of r.dims as [DimensionAnalitica, string, string, number][]) dimensiones[d].push({ clave: c, etiqueta: e ?? c, valor: n });
    const cruces = Object.fromEntries(NOMBRES_CRUCES.map((x) => [x, [] as CeldaCruce[]])) as AgregadosServing['cruces'];
    for (const [x, fa, fe, ca, ce, n] of r.cruces as [CruceAnalitico, string, string, string, string, number][]) {
      cruces[x].push({ fila: fa, filaEtiqueta: fe ?? fa, columna: ca, columnaEtiqueta: ce ?? ca, valor: n });
    }
    const [den, cerrado, reprobado, anulado] = (r.tasas as number[]).map(Number);
    const [casos, sumaSubido, sumaAprobado] = (r.documentos as (number | string)[]).map(Number);
    const elegibles = Object.fromEntries(Object.entries(r.elegibles as Record<string, number>).map(([k, v]) => [k, Number(v)])) as Partial<Record<MetricaHistorica, number>>;
    return {
      publicacion: pub,
      filas: Number(r.filas), practicas: Number(r.practicas), estudiantes: Number(r.estudiantes), estudiantesCompartidos: Number(r.compartidos),
      versionesClave: r.versiones as string[], dimensiones, cruces,
      tasas: { denominador: den, cerrado, reprobado, anulado },
      duracion: (r.duracion as [number, number][]).map(([d, n]) => [Number(d), Number(n)]),
      documentos: { casos, sumaSubido, sumaAprobado }, elegibles,
      solape: (r.solape as unknown[][]).map((x) => ({
        analyticsId: x[0] as string, identidad: x[1] as string, periodoCodigo: x[2] as string | null, nivel: x[3] as string | null,
        modalidadCodigo: x[4] as string | null, fechaInicio: x[5] as string | null, fechaFin: x[6] as string | null,
        estado: x[7] as EstadoOperativo | null, fechaCreacion: x[8] as string | null,
      })),
      cobertura: { excluidosPorAlcance: Number(r.excluidosPorAlcance), sinEquivalenciaPrograma: Number(r.sinEquivalencia) },
    };
  }

  async publicar(sistema: SistemaOrigen, filas: readonly FilaServing[], meta: { corte: string | null; desde: string | null; practicasEsperadas: number }): Promise<{ version: string; filas: number }> {
    const version = randomUUID();
    const qr = this.ds.createQueryRunner();
    await qr.connect();
    const [{ ok }] = await qr.query('SELECT pg_try_advisory_lock($1, hashtext($2)) AS ok', [ESPACIO_BLOQUEO, `serving:${sistema}`]) as { ok: boolean }[];
    if (!ok) { await qr.release(); throw new Error(`Ya hay una publicación del serving en curso para ${sistema}`); }
    try {
      // 1. Construir: la versión nueva es invisible (el puntero sigue en la anterior).
      const definicion = ['version uuid', 'sistema varchar', ...COLUMNAS.map(([c, t]) => `${c} ${t}`)].join(', ');
      const columnas = ['version', 'sistema', ...COLUMNAS.map(([c]) => c)].join(', ');
      for (let i = 0; i < filas.length; i += 2000) {
        const datos = filas.slice(i, i + 2000).map((f) => {
          const o: Record<string, unknown> = { version, sistema };
          for (const [c, , g] of COLUMNAS) o[c] = g(f);
          return o;
        });
        await qr.query(`INSERT INTO historico.serving_practicas (${columnas}) SELECT ${columnas} FROM jsonb_to_recordset($1::jsonb) AS x(${definicion})`, [JSON.stringify(datos)]);
      }
      // 2. Validar contra lo que el dominio calculó.
      const [v] = await qr.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE e_practicas)::int AS p FROM historico.serving_practicas WHERE version = $1`, [version]) as { n: number; p: number }[];
      if (v.n !== filas.length || v.p !== meta.practicasEsperadas) throw new Error(`Validación del serving fallida: ${v.n}/${filas.length} filas, ${v.p}/${meta.practicasEsperadas} prácticas`);
      // 3. Publicar: puntero y limpieza de versiones anteriores en UNA transacción.
      await qr.startTransaction();
      await qr.query(`
        INSERT INTO historico.serving_publicacion (sistema, version, filas, corte, desde, publicado_en) VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (sistema) DO UPDATE SET version = EXCLUDED.version, filas = EXCLUDED.filas, corte = EXCLUDED.corte, desde = EXCLUDED.desde, publicado_en = now()`,
      [sistema, version, filas.length, meta.corte, meta.desde]);
      await qr.query(`DELETE FROM historico.serving_practicas WHERE sistema = $1 AND version <> $2`, [sistema, version]);
      await qr.commitTransaction();
      return { version, filas: filas.length };
    } catch (e) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      await qr.query('DELETE FROM historico.serving_practicas WHERE version = $1', [version]).catch(() => undefined);
      throw e;
    } finally {
      await qr.query('SELECT pg_advisory_unlock($1, hashtext($2))', [ESPACIO_BLOQUEO, `serving:${sistema}`]).catch(() => undefined);
      await qr.release();
    }
  }
}
