import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { VERSION_NORMALIZACION_ALIAS } from '../../../../domain/historico/normalizacion-sgp';
import {
  RegistroHistorico, SistemaOrigen, VersionVigente, planificarImportacion, PlanImportacion,
} from '../../../../domain/historico/registro-historico';
import {
  HistoricoRepositorio, ImportacionEnCursoError, ImportacionFallidaError, PracticaActualCruda, ResultadoAplicacion,
  ResultadoPropuestas, ResultadoReversion, ReversionNoPermitidaError, SolicitudAplicacion, VersionClaveIncompatibleError,
} from '../../../../domain/ports/out/historico-repositorio.port';
import { Nit } from '../../../../domain/value-objects/nit.vo';

/** Espacio de nombres del bloqueo consultivo del histórico ('HIST'); el segundo entero es el sistema de origen. */
const ESPACIO_BLOQUEO = 0x48495354;

/** Columnas de `historico.practicas` que escribe el importador, con su tipo SQL para `jsonb_to_recordset`. */
const COLUMNAS: readonly (readonly [string, string, (r: RegistroHistorico) => unknown])[] = [
  ['source_system', 'varchar', (r) => r.sourceSystem],
  ['source_record_id', 'varchar', (r) => r.sourceRecordId],
  ['source_row', 'integer', (r) => r.sourceRow],
  ['content_hash', 'char(64)', (r) => r.contentHash],
  ['hmac_key_version', 'varchar', (r) => r.hmacKeyVersion],
  ['student_key', 'char(64)', (r) => r.studentKey],
  ['teacher_key', 'char(64)', (r) => r.teacherKey],
  ['programa_original', 'varchar', (r) => r.programaOriginal],
  ['programa_normalizado', 'varchar', (r) => r.programaNormalizado],
  ['codigo_sinu', 'varchar', (r) => r.codigoSinu],
  ['programa_mapping_status', 'varchar', (r) => r.programaMappingStatus],
  ['regional_original', 'varchar', (r) => r.regionalOriginal],
  ['regional', 'varchar', (r) => r.regional],
  ['nivel_original', 'varchar', (r) => r.nivelOriginal],
  ['nivel_inferido', 'varchar', (r) => r.nivelInferido],
  ['nivel_fuente', 'varchar', (r) => r.nivelFuente],
  ['asignatura_original', 'varchar', (r) => r.asignaturaOriginal],
  ['codigo_asignatura', 'varchar', (r) => r.codigoAsignatura],
  ['semestre_creditos', 'smallint', (r) => r.semestreCreditos],
  ['modalidad_estudio_original', 'varchar', (r) => r.modalidadEstudioOriginal],
  ['modalidad_estudio_normalizada', 'varchar', (r) => r.modalidadEstudioNormalizada],
  ['pensum', 'varchar', (r) => r.pensum],
  ['periodo_original', 'varchar', (r) => r.periodoOriginal],
  ['periodo_normalizado', 'varchar', (r) => r.periodoNormalizado],
  ['periodo_formato', 'varchar', (r) => r.periodoFormato],
  ['periodo_anio', 'smallint', (r) => r.periodoAnio],
  ['periodo_ordinal', 'varchar', (r) => r.periodoOrdinal],
  ['periodo_mapping_status', 'varchar', (r) => r.periodoMappingStatus],
  ['modalidad_practica_original', 'varchar', (r) => r.modalidadPracticaOriginal],
  ['modalidad_practica_normalizada', 'varchar', (r) => r.modalidadPracticaNormalizada],
  ['modalidad_mapping_status', 'varchar', (r) => r.modalidadMappingStatus],
  ['estado_original', 'varchar', (r) => r.estadoOriginal],
  ['estado_analitico', 'varchar', (r) => r.estadoAnalitico],
  ['estado_mapping_status', 'varchar', (r) => r.estadoMappingStatus],
  ['es_estado_de_corte', 'boolean', (r) => r.esEstadoDeCorte],
  ['estado_fecha_corte', 'timestamptz', (r) => r.estadoFechaCorte],
  ['organization_key', 'char(64)', (r) => r.organizationKey],
  ['organization_identifier_kind', 'varchar', (r) => r.organizationIdentifierKind],
  ['organization_type_hint', 'varchar', (r) => r.organizationTypeHint],
  ['nit_dv_valid', 'boolean', (r) => r.nitDvValid],
  ['nit_juridica', 'varchar', (r) => r.nitJuridica],
  ['empresa_alias_hash', 'char(64)', (r) => r.empresaAliasHash],
  ['area', 'varchar', (r) => r.area],
  ['cargo_estudiante', 'varchar', (r) => r.cargoEstudiante],
  ['horario', 'varchar', (r) => r.horario],
  ['ciudad_original', 'varchar', (r) => r.ciudadOriginal],
  ['ciudad_normalizada', 'varchar', (r) => r.ciudadNormalizada],
  ['fecha_inicio_original', 'varchar', (r) => r.fechaInicioOriginal],
  ['fecha_inicio', 'date', (r) => r.fechaInicio],
  ['fecha_fin_original', 'varchar', (r) => r.fechaFinOriginal],
  ['fecha_fin', 'date', (r) => r.fechaFin],
  ['duracion_dias', 'integer', (r) => r.duracionDias],
  ['fecha_creacion', 'date', (r) => r.fechaCreacion],
  ['ultimo_movimiento_estudiante', 'timestamptz', (r) => r.ultimoMovimientoEstudiante],
  ['ultimo_movimiento_docente', 'timestamptz', (r) => r.ultimoMovimientoDocente],
  ['salario_original', 'varchar', (r) => r.salarioOriginal],
  ['salario_normalizado', 'bigint', (r) => r.salarioNormalizado],
  ['salario_calidad', 'varchar', (r) => r.salarioCalidad],
  ['documentos_subidos_ratio', 'numeric', (r) => r.documentosSubidosRatio],
  ['documentos_aprobados_ratio', 'numeric', (r) => r.documentosAprobadosRatio],
  ['bitacora_count', 'integer', (r) => r.bitacoraCount],
  ['quality_status', 'varchar', (r) => r.qualityStatus],
  ['duplicado_de', 'varchar', (r) => r.duplicadoDe],
];

export interface OpcionesAdaptadorHistorico {
  /** Filas por sentencia de inserción (sin SELECT ni INSERT por fila). */
  tamanoLote?: number;
  /** SOLO pruebas de atomicidad: lanza tras escribir este número de lotes. */
  fallarTrasLotes?: number;
  /** SOLO pruebas: no purga las versiones de una importación fallida (simula un proceso caído antes de purgar). */
  omitirPurgaAlFallar?: boolean;
}

/** Tiempos por fase de la escritura (para el benchmark); ningún dato de origen. */
export interface TiemposEscritura { planMs: number; insercionMs: number; finalizacionMs: number; lotes: number }

type FilaPlan = { r: RegistroHistorico; version: number };

/**
 * Adaptador PostgreSQL del histórico. Escribe EXCLUSIVAMENTE en el esquema `historico` (lee `public` solo para el
 * cruce de solapamiento y la propuesta de correspondencias).
 *
 * Dos modos de carga (§27.7):
 *  - `single`: UNA transacción con bloqueo consultivo transaccional. Simple; adecuada para archivos pequeños.
 *  - `batched` (por omisión): bloqueo consultivo de SESIÓN durante toda la carga; una transacción corta crea la
 *    importación `processing` y planifica; cada lote se confirma como versiones con `is_current = false` (invisibles
 *    para cualquier consulta de vigentes); una transacción FINAL cambia la vigencia, refresca organizaciones y marca
 *    `completed`. Si algo falla: `failed` y purga de sus versiones (compensación). Si el proceso muere antes de
 *    purgar, el siguiente APPLY (que ya tiene el bloqueo) cierra la huérfana y purga lo que quedó.
 */
export class HistoricoPostgresAdapter implements HistoricoRepositorio {
  private readonly tamanoLote: number;
  ultimosTiempos: TiemposEscritura | null = null;

  constructor(private readonly ds: DataSource, private readonly opciones: OpcionesAdaptadorHistorico = {}) {
    this.tamanoLote = Math.max(1, opciones.tamanoLote ?? 2000);
  }

  async importacionCompletada(sourceSystem: SistemaOrigen, sha256: string): Promise<string | null> {
    const filas: { id: string }[] = await this.ds.query(
      `SELECT id FROM historico.importaciones WHERE source_system = $1 AND file_sha256 = $2 AND status = 'completed' LIMIT 1`,
      [sourceSystem, sha256]);
    return filas[0]?.id ?? null;
  }

  async vigentes(sourceSystem: SistemaOrigen, qr?: QueryRunner): Promise<Map<string, VersionVigente>> {
    const filas = (await (qr ?? this.ds).query(
      `SELECT id, source_record_id, version, content_hash, hmac_key_version, student_key, teacher_key, organization_key, empresa_alias_hash
         FROM historico.practicas WHERE source_system = $1 AND is_current`, [sourceSystem])) as {
      id: string; source_record_id: string; version: number; content_hash: string; hmac_key_version: string;
      student_key: string | null; teacher_key: string | null; organization_key: string | null; empresa_alias_hash: string | null;
    }[];
    return new Map(filas.map((f) => [f.source_record_id, {
      id: f.id, version: f.version, contentHash: f.content_hash, hmacKeyVersion: f.hmac_key_version,
      studentKey: f.student_key, teacherKey: f.teacher_key, organizationKey: f.organization_key, empresaAliasHash: f.empresa_alias_hash,
    }]));
  }

  async aplicar(s: SolicitudAplicacion): Promise<ResultadoAplicacion> {
    return (s.modoCarga ?? 'batched') === 'single' ? this.aplicarUnica(s) : this.aplicarPorLotes(s);
  }

  // ── Modo `single` ─────────────────────────────────────────────────────────

  private async aplicarUnica(s: SolicitudAplicacion): Promise<ResultadoAplicacion> {
    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    const t0 = Date.now();
    try {
      await this.bloquearTransaccion(qr, s.sourceSystem);
      const previa = await this.previaCompletada(qr, s);
      if (previa) { await qr.rollbackTransaction(); return { resultado: 'ALREADY_IMPORTED', importacionId: previa }; }
      await this.cerrarHuerfanas(qr, s.sourceSystem);
      const plan = await this.planificar(qr, s);
      const importacionId = await this.crearImportacion(qr, s, 'single');
      const t1 = Date.now();
      const anteriores = plan.versionados.map((v) => v.anterior.id);
      await this.quitarVigencia(qr, anteriores);
      const lotes = await this.insertarFilas(qr, importacionId, this.filasDe(plan), true);
      const t2 = Date.now();
      await this.refrescarOrganizaciones(qr, s.sourceSystem);
      const r = await this.completar(qr, importacionId, plan, s);
      await qr.commitTransaction();
      this.ultimosTiempos = { planMs: t1 - t0, insercionMs: t2 - t1, finalizacionMs: Date.now() - t2, lotes };
      return r;
    } catch (e) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      throw e;
    } finally {
      await qr.release();
    }
  }

  // ── Modo `batched` ────────────────────────────────────────────────────────

  private async aplicarPorLotes(s: SolicitudAplicacion): Promise<ResultadoAplicacion> {
    const bloqueo = this.ds.createQueryRunner();
    await bloqueo.connect();
    let bloqueado = false;
    let importacionId: string | null = null;
    const t0 = Date.now();
    try {
      const [{ ok }] = (await bloqueo.query('SELECT pg_try_advisory_lock($1, hashtext($2)) AS ok', [ESPACIO_BLOQUEO, s.sourceSystem])) as { ok: boolean }[];
      if (!ok) throw new ImportacionEnCursoError(s.sourceSystem);
      bloqueado = true;

      // 1. Preparación (transacción corta): idempotencia, huérfanas, versión de clave, plan e importación `processing`.
      let plan: PlanImportacion | null = null;
      const prep = await this.enTransaccion(async (qr) => {
        const previa = await this.previaCompletada(qr, s);
        if (previa) return previa;
        await this.cerrarHuerfanas(qr, s.sourceSystem);
        plan = await this.planificar(qr, s);
        importacionId = await this.crearImportacion(qr, s, 'batched');
        return null;
      });
      if (prep) return { resultado: 'ALREADY_IMPORTED', importacionId: prep };
      const id = importacionId!;
      const p = plan as unknown as PlanImportacion;
      const t1 = Date.now();

      // 2. Lotes: versiones NO vigentes, cada lote en su transacción.
      const filas = this.filasDe(p);
      let lotes = 0;
      for (let i = 0; i < filas.length; i += this.tamanoLote) {
        await this.enTransaccion((qr) => this.insertarLote(qr, id, filas.slice(i, i + this.tamanoLote), false));
        lotes += 1;
        if (this.opciones.fallarTrasLotes !== undefined && lotes >= this.opciones.fallarTrasLotes) {
          throw new Error(`Fallo simulado de prueba en el lote ${lotes + 1}`);
        }
      }
      const t2 = Date.now();

      // 3. Finalización atómica: vigencia, organizaciones y `completed`, todo junto.
      const r = await this.enTransaccion(async (qr) => {
        await this.quitarVigencia(qr, p.versionados.map((v) => v.anterior.id));
        await qr.query('UPDATE historico.practicas SET is_current = true WHERE importacion_id = $1', [id]);
        await this.refrescarOrganizaciones(qr, s.sourceSystem);
        return this.completar(qr, id, p, s);
      });
      this.ultimosTiempos = { planMs: t1 - t0, insercionMs: t2 - t1, finalizacionMs: Date.now() - t2, lotes };
      return r;
    } catch (e) {
      if (importacionId) {
        await this.fallarYPurgar(importacionId, e as Error).catch(() => undefined);
        throw new ImportacionFallidaError(importacionId, e as Error);
      }
      throw e;
    } finally {
      if (bloqueado) await bloqueo.query('SELECT pg_advisory_unlock($1, hashtext($2))', [ESPACIO_BLOQUEO, s.sourceSystem]).catch(() => undefined);
      await bloqueo.release();
    }
  }

  /** Compensación: la importación queda `failed` y sus versiones (nunca vigentes) se retiran. */
  private async fallarYPurgar(importacionId: string, error: Error): Promise<void> {
    await this.ds.query(
      `UPDATE historico.importaciones SET status = 'failed', finished_at = now(), metadata = metadata || $2::jsonb
        WHERE id = $1 AND status = 'processing'`,
      [importacionId, JSON.stringify({ error: `${error.name}: ${error.message}`.slice(0, 500) })]);
    if (this.opciones.omitirPurgaAlFallar) return;
    await this.enTransaccion(async (qr) => {
      await qr.query(`SELECT set_config('historico.reversion', 'on', true)`);
      await qr.query('DELETE FROM historico.practicas WHERE importacion_id = $1 AND NOT is_current', [importacionId]);
    });
  }

  // ── Piezas comunes ────────────────────────────────────────────────────────

  private async enTransaccion<T>(cuerpo: (qr: QueryRunner) => Promise<T>): Promise<T> {
    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const r = await cuerpo(qr);
      await qr.commitTransaction();
      return r;
    } catch (e) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      throw e;
    } finally {
      await qr.release();
    }
  }

  private async previaCompletada(qr: QueryRunner, s: SolicitudAplicacion): Promise<string | null> {
    const previa = (await qr.query(
      `SELECT id FROM historico.importaciones WHERE source_system = $1 AND file_sha256 = $2 AND status = 'completed' LIMIT 1`,
      [s.sourceSystem, s.archivo.sha256])) as { id: string }[];
    return previa[0]?.id ?? null;
  }

  /**
   * Una importación `processing` sin terminar (proceso caído) no puede estar viva: quien llama tiene el bloqueo. Se
   * cierra como `failed` y se purgan las versiones no vigentes de TODA importación fallida (si una purga anterior no
   * llegó a correr, sus versiones bloquearían el número de versión de la siguiente carga).
   */
  private async cerrarHuerfanas(qr: QueryRunner, sourceSystem: SistemaOrigen): Promise<void> {
    await qr.query(
      `UPDATE historico.importaciones SET status = 'failed', finished_at = now(),
              metadata = metadata || '{"motivo":"abandonada: el proceso terminó sin completar"}'::jsonb
        WHERE source_system = $1 AND status = 'processing'`, [sourceSystem]);
    await qr.query(`SELECT set_config('historico.reversion', 'on', true)`);
    await qr.query(
      `DELETE FROM historico.practicas p USING historico.importaciones i
        WHERE p.importacion_id = i.id AND i.source_system = $1 AND i.status = 'failed' AND NOT p.is_current`, [sourceSystem]);
    await qr.query(`SELECT set_config('historico.reversion', 'off', true)`);
  }

  private async planificar(qr: QueryRunner, s: SolicitudAplicacion): Promise<PlanImportacion> {
    const vigentes = await this.vigentes(s.sourceSystem, qr);
    for (const v of vigentes.values()) {
      if (v.hmacKeyVersion !== s.hmacKeyVersion) throw new VersionClaveIncompatibleError(v.hmacKeyVersion, s.hmacKeyVersion);
    }
    return planificarImportacion(s.registros, vigentes);
  }

  private async crearImportacion(qr: QueryRunner, s: SolicitudAplicacion, modo: 'single' | 'batched'): Promise<string> {
    const id = randomUUID();
    await qr.query(
      `INSERT INTO historico.importaciones (id, source_system, file_name, file_sha256, file_size_bytes, source_cutoff_date,
          hmac_key_version, importer_version, status, row_count_file, row_count_real, load_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing', $9, $10, $11)`,
      [id, s.sourceSystem, s.archivo.nombre.slice(0, 255), s.archivo.sha256, s.archivo.tamanoBytes, s.fechaCorte,
        s.hmacKeyVersion, s.importerVersion, s.estadisticas.filasFisicas, s.estadisticas.filasReales, modo]);
    return id;
  }

  private filasDe(plan: PlanImportacion): FilaPlan[] {
    return [
      ...plan.nuevos.map((r) => ({ r, version: 1 })),
      ...plan.versionados.map((v) => ({ r: v.registro, version: v.anterior.version + 1 })),
    ];
  }

  private async quitarVigencia(qr: QueryRunner, ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 5000) {
      await qr.query('UPDATE historico.practicas SET is_current = false WHERE id = ANY($1::uuid[])', [ids.slice(i, i + 5000)]);
    }
  }

  private async insertarFilas(qr: QueryRunner, importacionId: string, filas: FilaPlan[], vigente: boolean): Promise<number> {
    let lotes = 0;
    for (let i = 0; i < filas.length; i += this.tamanoLote) {
      await this.insertarLote(qr, importacionId, filas.slice(i, i + this.tamanoLote), vigente);
      lotes += 1;
      if (this.opciones.fallarTrasLotes !== undefined && lotes >= this.opciones.fallarTrasLotes) {
        throw new Error('Fallo simulado de prueba a mitad de la importación');
      }
    }
    return lotes;
  }

  private async completar(qr: QueryRunner, importacionId: string, plan: PlanImportacion, s: SolicitudAplicacion): Promise<ResultadoAplicacion> {
    const filas = this.filasDe(plan);
    const observados = filas.filter((f) => f.r.qualityStatus === 'observed').length;
    await qr.query(
      `UPDATE historico.importaciones SET status = 'completed', finished_at = now(), row_count_imported = $2,
          row_count_unchanged = $3, row_count_versioned = $4, row_count_observed = $5, row_count_missing = $6, metadata = $7::jsonb
        WHERE id = $1`,
      [importacionId, plan.nuevos.length, plan.sinCambios, plan.versionados.length, observados, plan.ausentes, JSON.stringify(s.metadata)]);
    return {
      resultado: 'COMPLETED', importacionId, nuevos: plan.nuevos.length, versionados: plan.versionados.length,
      sinCambios: plan.sinCambios, observados, ausentes: plan.ausentes,
    };
  }

  async registrarFallo(s: Omit<SolicitudAplicacion, 'registros'>, motivo: string): Promise<string> {
    const id = randomUUID();
    await this.ds.query(
      `INSERT INTO historico.importaciones (id, source_system, file_name, file_sha256, file_size_bytes, source_cutoff_date,
          hmac_key_version, importer_version, status, finished_at, row_count_file, row_count_real, metadata, load_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'failed', now(), $9, $10, $11::jsonb, $12)`,
      [id, s.sourceSystem, s.archivo.nombre.slice(0, 255), s.archivo.sha256, s.archivo.tamanoBytes, s.fechaCorte, s.hmacKeyVersion,
        s.importerVersion, s.estadisticas.filasFisicas, s.estadisticas.filasReales, JSON.stringify({ error: motivo }), s.modoCarga ?? 'batched']);
    return id;
  }

  async revertir(importacionId: string): Promise<ResultadoReversion> {
    const qr = this.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const imp = (await qr.query(
        `SELECT source_system, status, started_at FROM historico.importaciones WHERE id = $1`, [importacionId])) as { source_system: SistemaOrigen; status: string; started_at: Date }[];
      if (!imp[0]) throw new ReversionNoPermitidaError('la importación no existe');
      await this.bloquearTransaccion(qr, imp[0].source_system);
      const [actual] = (await qr.query(`SELECT status FROM historico.importaciones WHERE id = $1 FOR UPDATE`, [importacionId])) as { status: string }[];
      if (actual.status !== 'completed') throw new ReversionNoPermitidaError(`la importación está «${actual.status}»; solo se revierte una «completed»`);
      // LIFO: revertir una importación con otra posterior completada dejaría a esa otra sin la base que dio por
      // «sin cambios». Se exige revertir primero las posteriores.
      const [posteriores] = (await qr.query(
        `SELECT count(*)::int AS n FROM historico.importaciones
          WHERE source_system = $1 AND status = 'completed' AND id <> $2 AND started_at > $3`,
        [imp[0].source_system, importacionId, imp[0].started_at])) as { n: number }[];
      if (posteriores.n > 0) throw new ReversionNoPermitidaError('hay importaciones posteriores completadas; revierta primero la más reciente');

      await qr.query(`SELECT set_config('historico.reversion', 'on', true)`);
      const borradas: unknown = await qr.query(
        `DELETE FROM historico.practicas WHERE importacion_id = $1 RETURNING source_record_id, is_current`, [importacionId]);
      const filasBorradas = (Array.isArray(borradas) && Array.isArray(borradas[0]) ? borradas[0] : borradas) as { source_record_id: string; is_current: boolean }[];
      const sinVigente = filasBorradas.filter((f) => f.is_current).map((f) => f.source_record_id);
      let restituidas = 0;
      for (let i = 0; i < sinVigente.length; i += 5000) {
        const r: unknown = await qr.query(
          `UPDATE historico.practicas p SET is_current = true
             FROM (SELECT DISTINCT ON (source_record_id) id FROM historico.practicas
                    WHERE source_system = $1 AND source_record_id = ANY($2::varchar[])
                    ORDER BY source_record_id, version DESC) ultima
            WHERE p.id = ultima.id
           RETURNING p.id`, [imp[0].source_system, sinVigente.slice(i, i + 5000)]);
        restituidas += Array.isArray(r) && Array.isArray(r[0]) ? (r[0] as unknown[]).length : (r as unknown[]).length;
      }
      await qr.query(`SELECT set_config('historico.reversion', 'off', true)`);
      await this.refrescarOrganizaciones(qr, imp[0].source_system);
      await qr.query(`UPDATE historico.importaciones SET status = 'reverted', reverted_at = now() WHERE id = $1`, [importacionId]);
      await qr.commitTransaction();
      return { importacionId, versionesRetiradas: filasBorradas.length, vigentesRestituidas: restituidas };
    } catch (e) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      throw e;
    } finally {
      await qr.release();
    }
  }

  async practicasActuales(): Promise<PracticaActualCruda[]> {
    const filas: {
      id: string; documento: string | null; periodo: string; ciclo: string; modalidad: string; estado: string;
      fecha_inicio: string | null; fecha_fin: string | null; creada_en: string;
    }[] = await this.ds.query(
      `SELECT p.id, u.documento, p.periodo_academico AS periodo, p.ciclo, p.modalidad, p.estado,
              to_char(p.fecha_inicio AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS fecha_inicio,
              to_char(p.fecha_fin AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS fecha_fin,
              to_char(p.creada_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS creada_en
         FROM practicas p JOIN usuarios u ON u.id = p.estudiante_id`);
    // P-42: `practicas` no conserva el `#` del SGP; si algún día existe, se leería aquí.
    return filas.map((f) => ({
      id: f.id, documento: f.documento, periodo: f.periodo, ciclo: f.ciclo, modalidad: f.modalidad, estado: f.estado,
      fechaInicio: f.fecha_inicio, fechaFin: f.fecha_fin, creadaEn: f.creada_en, sgpId: null,
    }));
  }

  async proponerCorrespondencias(sourceSystem: SistemaOrigen, aplicar: boolean): Promise<ResultadoPropuestas> {
    const orgs: { id: string; nit_juridica: string }[] = await this.ds.query(
      `SELECT o.id, o.nit_juridica FROM historico.organizaciones o
        WHERE o.source_system = $1 AND o.nit_juridica IS NOT NULL AND o.nit_dv_valid
          AND NOT EXISTS (SELECT 1 FROM historico.organizacion_mapping m WHERE m.organizacion_id = o.id)`, [sourceSystem]);
    if (!orgs.length) return { evaluadas: 0, conCandidatoUnico: 0, propuestasCreadas: 0 };
    const empresas: { id: string; nit_numero: string; nit_dv: number }[] = await this.ds.query(
      'SELECT id, nit_numero, nit_dv FROM empresas WHERE nit_numero = ANY($1::varchar[])', [orgs.map((o) => o.nit_juridica)]);
    const porNit = new Map<string, { id: string; nit_dv: number }[]>();
    for (const e of empresas) {
      const base = e.nit_numero.replace(/\D/g, '');
      if (!porNit.has(base)) porNit.set(base, []);
      porNit.get(base)!.push(e);
    }
    const propuestas: { org: string; empresa: string }[] = [];
    for (const o of orgs) {
      const cands = (porNit.get(o.nit_juridica) ?? []).filter((e) => Nit.esValido(o.nit_juridica, Number(e.nit_dv)));
      if (cands.length === 1) propuestas.push({ org: o.id, empresa: cands[0].id });
    }
    if (aplicar && propuestas.length) {
      await this.enTransaccion(async (qr) => {
        for (let i = 0; i < propuestas.length; i += 1000) {
          const lote = propuestas.slice(i, i + 1000);
          await qr.query(
            `INSERT INTO historico.organizacion_mapping (id, organizacion_id, empresa_id, method, status, confidence)
             SELECT x.id, x.org, x.empresa, 'nit_exacto', 'propuesta', 1.00 FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, org uuid, empresa uuid)`,
            [JSON.stringify(lote.map((p) => ({ id: randomUUID(), org: p.org, empresa: p.empresa })))]);
        }
        await qr.query(`UPDATE historico.organizaciones SET mapping_status = 'propuesta', updated_at = now() WHERE id = ANY($1::uuid[])`, [propuestas.map((p) => p.org)]);
      });
    }
    return { evaluadas: orgs.length, conCandidatoUnico: propuestas.length, propuestasCreadas: aplicar ? propuestas.length : 0 };
  }

  private async bloquearTransaccion(qr: QueryRunner, sourceSystem: SistemaOrigen): Promise<void> {
    const [{ ok }] = (await qr.query('SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS ok', [ESPACIO_BLOQUEO, sourceSystem])) as { ok: boolean }[];
    if (!ok) throw new ImportacionEnCursoError(sourceSystem);
  }

  private async insertarLote(qr: QueryRunner, importacionId: string, filas: FilaPlan[], vigente: boolean): Promise<void> {
    const datos = filas.map(({ r, version }) => {
      const o: Record<string, unknown> = {
        id: randomUUID(), version, quality_flags: r.qualityFlags.join(','), organization_flags: r.organizationFlags.join(','),
      };
      for (const [col, , f] of COLUMNAS) o[col] = f(r);
      return o;
    });
    const definicion = ['id uuid', 'version integer', 'quality_flags text', 'organization_flags text', ...COLUMNAS.map(([c, t]) => `${c} ${t}`)].join(', ');
    const columnas = COLUMNAS.map(([c]) => c).join(', ');
    await qr.query(
      `INSERT INTO historico.practicas (id, importacion_id, version, is_current, quality_flags, organization_flags, ${columnas})
       SELECT x.id, $1::uuid, x.version, $3::boolean,
              COALESCE(string_to_array(NULLIF(x.quality_flags, ''), ','), '{}'::text[]),
              COALESCE(string_to_array(NULLIF(x.organization_flags, ''), ','), '{}'::text[]),
              ${COLUMNAS.map(([c]) => `x.${c}`).join(', ')}
         FROM jsonb_to_recordset($2::jsonb) AS x(${definicion})`,
      [importacionId, JSON.stringify(datos), vigente]);
  }

  /**
   * Catálogo de organizaciones y alias DERIVADOS de las versiones vigentes (una reversión los deja coherentes sin
   * lógica aparte). Marcas de CATÁLOGO: `MULTIPLE_ALIASES`, `ALIAS_SHARED_ACROSS_IDENTIFIERS`, `NIT_DV_INVALID`,
   * `IDENTIFIER_NONSTANDARD`, `IDENTIFIER_PERSON_NATURAL` y `MAPPING_PENDING` (sin correspondencia confirmada o
   * rechazada). Una organización sin vigentes se borra salvo que tenga correspondencia (revisión humana).
   */
  private async refrescarOrganizaciones(qr: QueryRunner, sourceSystem: SistemaOrigen): Promise<void> {
    await qr.query('DELETE FROM historico.organizacion_alias WHERE source_system = $1', [sourceSystem]);
    await qr.query(`
      WITH vig AS (
        SELECT source_system, organization_key, hmac_key_version, organization_identifier_kind, organization_type_hint,
               nit_juridica, nit_dv_valid, empresa_alias_hash, organization_flags
          FROM historico.practicas WHERE source_system = $1 AND is_current AND organization_key IS NOT NULL),
      compartidos AS (
        SELECT empresa_alias_hash FROM vig WHERE empresa_alias_hash IS NOT NULL
         GROUP BY empresa_alias_hash HAVING count(DISTINCT organization_key) > 1),
      agg AS (
        SELECT v.source_system, v.organization_key, v.hmac_key_version,
               mode() WITHIN GROUP (ORDER BY v.organization_identifier_kind) AS kind,
               mode() WITHIN GROUP (ORDER BY coalesce(v.organization_type_hint, 'UNKNOWN')) AS hint,
               max(v.nit_juridica) AS nit, bool_or(v.nit_dv_valid) AS dv, bool_or(v.nit_dv_valid = false) AS dv_malo,
               count(*)::int AS n, count(DISTINCT v.empresa_alias_hash)::int AS a,
               bool_or(v.empresa_alias_hash IN (SELECT empresa_alias_hash FROM compartidos)) AS compartido,
               bool_or('IDENTIFIER_NONSTANDARD' = ANY (v.organization_flags)) AS no_estandar
          FROM vig v GROUP BY v.source_system, v.organization_key, v.hmac_key_version)
      INSERT INTO historico.organizaciones AS o (source_system, organization_key, hmac_key_version, identifier_kind, organization_type_hint,
          nit_juridica, nit_dv_valid, record_count, alias_count, quality_flags)
      SELECT source_system, organization_key, hmac_key_version, kind, hint, nit, dv, n, a,
             array_remove(ARRAY[
               CASE WHEN a > 1 THEN 'MULTIPLE_ALIASES' END,
               CASE WHEN compartido THEN 'ALIAS_SHARED_ACROSS_IDENTIFIERS' END,
               CASE WHEN dv_malo THEN 'NIT_DV_INVALID' END,
               CASE WHEN no_estandar THEN 'IDENTIFIER_NONSTANDARD' END,
               CASE WHEN hint = 'NATURAL_PERSON' THEN 'IDENTIFIER_PERSON_NATURAL' END], NULL)
        FROM agg
      ON CONFLICT (source_system, organization_key, hmac_key_version) DO UPDATE SET
        identifier_kind = EXCLUDED.identifier_kind, organization_type_hint = EXCLUDED.organization_type_hint,
        nit_juridica = EXCLUDED.nit_juridica, nit_dv_valid = EXCLUDED.nit_dv_valid, record_count = EXCLUDED.record_count,
        alias_count = EXCLUDED.alias_count, quality_flags = EXCLUDED.quality_flags, updated_at = now()`, [sourceSystem]);
    await qr.query(`
      UPDATE historico.organizaciones o SET record_count = 0, alias_count = 0, updated_at = now()
       WHERE o.source_system = $1 AND o.record_count > 0 AND NOT EXISTS (
         SELECT 1 FROM historico.practicas p WHERE p.source_system = o.source_system AND p.is_current
            AND p.organization_key = o.organization_key AND p.hmac_key_version = o.hmac_key_version)`, [sourceSystem]);
    await qr.query(`
      DELETE FROM historico.organizaciones o
       WHERE o.source_system = $1 AND o.record_count = 0
         AND NOT EXISTS (SELECT 1 FROM historico.organizacion_mapping m WHERE m.organizacion_id = o.id)`, [sourceSystem]);
    // Estado de correspondencia derivado de `organizacion_mapping` y su marca de catálogo.
    await qr.query(`
      UPDATE historico.organizaciones o SET
        mapping_status = CASE
          WHEN EXISTS (SELECT 1 FROM historico.organizacion_mapping m WHERE m.organizacion_id = o.id AND m.status = 'confirmada') THEN 'confirmada'
          WHEN EXISTS (SELECT 1 FROM historico.organizacion_mapping m WHERE m.organizacion_id = o.id AND m.status = 'propuesta') THEN 'propuesta'
          WHEN EXISTS (SELECT 1 FROM historico.organizacion_mapping m WHERE m.organizacion_id = o.id) THEN 'rechazada'
          ELSE 'sin_correspondencia' END
       WHERE o.source_system = $1`, [sourceSystem]);
    await qr.query(`
      UPDATE historico.organizaciones SET quality_flags = array_append(array_remove(quality_flags, 'MAPPING_PENDING'), 'MAPPING_PENDING')
       WHERE source_system = $1 AND mapping_status IN ('sin_correspondencia', 'propuesta')`, [sourceSystem]);
    await qr.query(`
      INSERT INTO historico.organizacion_alias (source_system, organization_key, hmac_key_version, alias_hash, normalization_version, frecuencia)
      SELECT source_system, organization_key, hmac_key_version, empresa_alias_hash, $2, count(*)::int
        FROM historico.practicas
       WHERE source_system = $1 AND is_current AND organization_key IS NOT NULL AND empresa_alias_hash IS NOT NULL
       GROUP BY source_system, organization_key, hmac_key_version, empresa_alias_hash`, [sourceSystem, VERSION_NORMALIZACION_ALIAS]);
  }
}
