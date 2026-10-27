/* eslint-disable no-console */
/**
 * Carga de la Mesa de EPS (Fase 6): ¿se sostiene la bandeja con 100, 1.000 y 10.000 casos abiertos?
 *
 * Genera casos SINTÉTICOS directamente en la base (no procesa OCR: solo volumen de datos de Mesa) en una
 * base temporal de un PostgreSQL LOCAL desechable, y mide por tamaño: lista (SQL + caso de uso con
 * filtros/orden/paginación/KPIs), tomar siguiente (1 y 6 simultáneos), supervisión y los planes
 * EXPLAIN (ANALYZE, BUFFERS) de las consultas principales (para buscar N+1, barridos y orden en memoria).
 *
 * Uso: DB_URL=postgres://usuario:clave@127.0.0.1:PUERTO/postgres npm run carga:mesa
 * Se NIEGA a correr si el host no es local. Crea y elimina su propia base.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource, Logger as TypeOrmLogger } from 'typeorm';
import { MesaEpsUseCase } from '../src/application/use-cases/documentos/mesa-eps.use-case';
import { EvidenciaEps, FuenteEvidenciaEps, TipoEvidenciaEps } from '../src/domain/entities/evidencia-validacion-eps.entity';
import { DecisionEps } from '../src/domain/entities/validacion-eps.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { ValidacionEpsRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/validacion-eps.adapter';
import { cargarCatalogos } from '../src/infrastructure/persistence/postgres/catalogos/cargar-catalogos';
import { ENTIDADES_ORM } from '../src/infrastructure/persistence/postgres/entities/todas.orm-entity';
import { EvidenciaValidacionEpsOrm, ValidacionEpsOrm } from '../src/infrastructure/persistence/postgres/entities/validacion-eps.orm-entity';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import { sembrar } from '../src/infrastructure/persistence/postgres/seeds/ejecutar-semillas';

const base = process.env.DB_URL?.trim();
if (!base) throw new Error('Defina DB_URL apuntando al PostgreSQL desechable.');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Se niega a correr: la base no es local.');
const urlDe = (db: string): string => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };
const TAMANOS = (process.env.TAMANOS ?? '100,1000,10000').split(',').map(Number);

class Capturador implements TypeOrmLogger {
  consultas: Array<{ sql: string; params: unknown[] }> = [];
  activo = false;
  logQuery(q: string, p?: unknown[]): void { if (this.activo) this.consultas.push({ sql: q, params: p ?? [] }); }
  logQueryError(): void { /* sin ruido */ }
  logQuerySlow(): void { /* sin ruido */ }
  logSchemaBuild(): void { /* sin ruido */ }
  logMigration(): void { /* sin ruido */ }
  log(): void { /* sin ruido */ }
}

const ms = (t: bigint): number => Math.round((Number(process.hrtime.bigint() - t) / 1e6) * 10) / 10;
async function cronometrar<T>(f: () => Promise<T>): Promise<{ ms: number; valor: T }> {
  const t = process.hrtime.bigint();
  const valor = await f();
  return { ms: ms(t), valor };
}
const PIDE = (nombre: string, valores: Array<number | string>): void => console.log(`  ${nombre.padEnd(52)} ${valores.join('  ')}`);

async function generar(ds: DataSource, desde: number, hasta: number, funcionario: string): Promise<void> {
  const [plantilla] = await ds.query(`SELECT programa_id, escuelas FROM usuarios WHERE id='00000000-0000-4000-8000-000000000011'`);
  const [p] = await ds.query(`SELECT programa_id, escuela_id, ciclo, modalidad, tutor_id, empresa_id, cargo, jefe_inmediato_nombre, fecha_fin, arl_fecha_afiliacion FROM practicas WHERE id='00000000-0000-4000-8000-000000000041'`);
  const uuid = (prefijo: string, g: string): string => `('00000000-0000-4000-${prefijo}-'||lpad(${g}::text,12,'0'))::uuid`;
  await ds.query(
    `INSERT INTO usuarios (id, correo, nombre, documento, rol, escuelas, programa_id, activo, permiso)
     SELECT ${uuid('9000', 'g')}, 'carga'||g||'@estudiante.test', 'Estudiante Carga '||g, (2000000000+g)::text, 'estudiante', $3, $4, true, 'escritura'
     FROM generate_series($1::int,$2::int) g`, [desde, hasta, plantilla.escuelas, plantilla.programa_id]);
  await ds.query(
    `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado, tutor_id, empresa_id, cargo, jefe_inmediato_nombre, fecha_inicio, fecha_fin, arl_verificada, arl_fecha_afiliacion, ultima_actividad)
     SELECT ${uuid('9100', 'g')}, ${uuid('9000', 'g')}, $3, $4, $5, (ARRAY['2026-1','2026-2','2026-2','2026-2'])[1 + g % 4], $6, 'activa', $7, $8, $9, $10,
            now() + ((g % 40) - 10) * interval '1 day', $11, true, $12, now()
     FROM generate_series($1::int,$2::int) g`,
    [desde, hasta, p.programa_id, p.escuela_id, p.ciclo, p.modalidad, p.tutor_id, p.empresa_id, p.cargo, p.jefe_inmediato_nombre, p.fecha_fin, p.arl_fecha_afiliacion]);
  await ds.query(
    `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento, cargado_en)
     SELECT ${uuid('9200', 'g')}, ${uuid('9100', 'g')}, 'certificado_eps', 1 + (g % 10 = 0)::int, 'en_revision', 'c'||g||'.pdf', 'application/pdf', 1000, md5(g::text)||md5((g+1)::text), 'carga/'||g,
            now() - (g % 30) * interval '1 day' - (g % 1440) * interval '1 minute'
     FROM generate_series($1::int,$2::int) g`, [desde, hasta]);
  // Los reenvíos (versión 2) necesitan su versión 1 para ser coherentes.
  await ds.query(
    `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento, cargado_en, justificacion_decision, motivo_devolucion)
     SELECT ${uuid('9300', 'g')}, ${uuid('9100', 'g')}, 'certificado_eps', 1, 'devuelto', 'c'||g||'-v1.pdf', 'application/pdf', 1000, md5('v1'||g::text)||md5('x'||g::text), 'carga/v1/'||g,
            now() - interval '40 days', NULL, 'ilegible'
     FROM generate_series($1::int,$2::int) g WHERE g % 10 = 0`, [desde, hasta]);
  await ds.query(
    `INSERT INTO validaciones_eps (id, documento_id, practica_id, estudiante_id, estado_procesamiento, coincidencia, vigencia_certificado, hay_bandera_critica, adres_estado,
        recibida_en, asignado_a, reservado_en, reserva_hasta, primera_revision_en)
     SELECT ${uuid('9400', 'g')}, ${uuid('9200', 'g')}, ${uuid('9100', 'g')}, ${uuid('9000', 'g')}, 'procesado', 'coincide', 'vigente', (g % 10 = 3),
            CASE WHEN g % 5 < 3 THEN 'pendiente' ELSE 'no_requerido' END,
            now() - (g % 30) * interval '1 day' - (g % 1440) * interval '1 minute',
            CASE WHEN g % 33 = 0 THEN $3::uuid END, CASE WHEN g % 33 = 0 THEN now() - interval '1 minute' END, CASE WHEN g % 33 = 0 THEN now() + interval '10 minutes' END,
            CASE WHEN g % 33 = 0 THEN now() - interval '1 minute' END
     FROM generate_series($1::int,$2::int) g`, [desde, hasta, funcionario]);
  await ds.query('ANALYZE usuarios; ANALYZE practicas; ANALYZE documentos; ANALYZE validaciones_eps;');
}

/** Histórico decidido: el caso REAL de una Mesa en operación (pocos abiertos, muchísimos cerrados). */
async function generarHistorico(ds: DataSource, desde: number, hasta: number, funcionario: string): Promise<void> {
  const [p] = await ds.query(`SELECT programa_id, escuela_id, ciclo, modalidad, tutor_id, empresa_id, cargo, jefe_inmediato_nombre, fecha_fin, arl_fecha_afiliacion FROM practicas WHERE id='00000000-0000-4000-8000-000000000041'`);
  const [plantilla] = await ds.query(`SELECT programa_id, escuelas FROM usuarios WHERE id='00000000-0000-4000-8000-000000000011'`);
  const uuid = (prefijo: string, g: string): string => `('00000000-0000-4000-${prefijo}-'||lpad(${g}::text,12,'0'))::uuid`;
  await ds.query(
    `INSERT INTO usuarios (id, correo, nombre, documento, rol, escuelas, programa_id, activo, permiso)
     SELECT ${uuid('9000', 'g')}, 'carga'||g||'@estudiante.test', 'Estudiante Carga '||g, (2000000000+g)::text, 'estudiante', $3, $4, true, 'escritura'
     FROM generate_series($1::int,$2::int) g`, [desde, hasta, plantilla.escuelas, plantilla.programa_id]);
  await ds.query(
    `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado, tutor_id, empresa_id, cargo, jefe_inmediato_nombre, fecha_inicio, fecha_fin, arl_verificada, arl_fecha_afiliacion, ultima_actividad)
     SELECT ${uuid('9100', 'g')}, ${uuid('9000', 'g')}, $3, $4, $5, '2026-1', $6, 'activa', $7, $8, $9, $10, now() - interval '20 days', $11, true, $12, now()
     FROM generate_series($1::int,$2::int) g`,
    [desde, hasta, p.programa_id, p.escuela_id, p.ciclo, p.modalidad, p.tutor_id, p.empresa_id, p.cargo, p.jefe_inmediato_nombre, p.fecha_fin, p.arl_fecha_afiliacion]);
  await ds.query(
    `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento, cargado_en, decidido_por, justificacion_decision)
     SELECT ${uuid('9200', 'g')}, ${uuid('9100', 'g')}, 'certificado_eps', 1, 'aprobado', 'c'||g||'.pdf', 'application/pdf', 1000, md5(g::text)||md5((g+1)::text), 'carga/'||g, now() - interval '50 days', $3, 'histórico sintético'
     FROM generate_series($1::int,$2::int) g`, [desde, hasta, funcionario]);
  await ds.query(
    `INSERT INTO validaciones_eps (id, documento_id, practica_id, estudiante_id, estado_procesamiento, coincidencia, vigencia_certificado, adres_estado, recibida_en, decision, decidido_por, decidido_en)
     SELECT ${uuid('9400', 'g')}, ${uuid('9200', 'g')}, ${uuid('9100', 'g')}, ${uuid('9000', 'g')}, 'procesado', 'coincide', 'vigente', 'no_requerido', now() - interval '50 days', 'aprobado_manual', $3, now() - interval '49 days'
     FROM generate_series($1::int,$2::int) g`, [desde, hasta, funcionario]);
  await ds.query('ANALYZE usuarios; ANALYZE practicas; ANALYZE documentos; ANALYZE validaciones_eps;');
}

/**
 * Estrés OPERATIVO: 6 funcionarios actúan a la vez sobre muchos casos (tomar siguiente, renovar, liberar, decidir,
 * adjuntar evidencia). Invariantes: ningún caso en manos de dos personas a la vez, ninguna decisión pisada, ninguna
 * evidencia perdida, cero deadlocks (40P01) ni errores de serialización (40001).
 */
async function estres(ds: DataSource, repo: ValidacionEpsRepositoryAdapter, funcionarios: string[], iteraciones: number): Promise<void> {
  console.log(`\n══ ESTRÉS OPERATIVO: ${funcionarios.length} funcionarios × ${iteraciones} acciones aleatorias ══`);
  await ds.query(`UPDATE validaciones_eps SET asignado_a=NULL, reservado_en=NULL, reserva_hasta=NULL WHERE asignado_a IS NOT NULL`);
  const dueno = new Map<string, string>(); // id → funcionario actual (modelo en memoria de lo que la base debería decir)
  const violaciones: string[] = [];
  const errores: Record<string, number> = {};
  const decididas = new Map<string, string>();
  const evidenciasPorCaso = new Map<string, number>();
  const contadores = { tomar: 0, tomarVacio: 0, renovar: 0, renovarFallo: 0, liberar: 0, liberarFallo: 0, decidir: 0, decidirRechazada: 0, evidencia: 0 };
  const contar = (e: unknown): void => { const c = (e as { code?: string }).code ?? (e as Error).name; errores[c] = (errores[c] ?? 0) + 1; };

  const trabajador = async (f: string, semilla: number): Promise<void> => {
    let azar = semilla;
    const rnd = (): number => { azar = (azar * 1664525 + 1013904223) % 4294967296; return azar / 4294967296; };
    const mios = (): string[] => [...dueno].filter(([, d]) => d === f).map(([id]) => id);
    for (let i = 0; i < iteraciones; i += 1) {
      const ahora = new Date();
      const hasta = new Date(ahora.getTime() + 15 * 60_000);
      const r = rnd();
      try {
        if (r < 0.40 || mios().length === 0) {
          const id = await repo.tomarSiguiente(f, ahora, hasta, null);
          if (!id) { contadores.tomarVacio += 1; continue; }
          contadores.tomar += 1;
          if (dueno.has(id)) violaciones.push(`${id} entregado a ${f} estando en manos de ${dueno.get(id)}`);
          dueno.set(id, f);
        } else if (r < 0.58) {
          const id = mios()[Math.floor(rnd() * mios().length)];
          const ok = await repo.reservar(id, f, ahora, hasta);
          contadores.renovar += 1;
          if (!ok) { contadores.renovarFallo += 1; violaciones.push(`${f} no pudo renovar su propio caso ${id}`); }
        } else if (r < 0.72) {
          const id = mios()[Math.floor(rnd() * mios().length)];
          dueno.delete(id); // se libera primero en el modelo: otro puede tomarlo apenas la base lo suelte
          const ok = await repo.liberarReserva(id, f, ahora, false);
          contadores.liberar += 1;
          if (!ok) { contadores.liberarFallo += 1; violaciones.push(`${f} no pudo liberar su propio caso ${id}`); }
        } else if (r < 0.90) {
          const id = mios()[Math.floor(rnd() * mios().length)];
          const v = await repo.buscarPorId(id);
          if (!v) continue;
          const version = v.instantanea().version;
          try {
            v.registrarDecisionHumana(DecisionEps.APROBADO_MANUAL, f, ahora);
            const ok = await repo.guardarSiVersion(v.instantanea(), version);
            if (ok) {
              contadores.decidir += 1;
              if (decididas.has(id)) violaciones.push(`decisión doble sobre ${id}`);
              decididas.set(id, f);
              dueno.delete(id);
            } else { contadores.decidirRechazada += 1; }
          } catch { contadores.decidirRechazada += 1; }
        } else {
          const id = mios()[Math.floor(rnd() * mios().length)];
          await repo.agregarEvidencia(EvidenciaEps.crear({
            id: randomUUID(), validacionEpsId: id, tipo: TipoEvidenciaEps.REVISION_HUMANA, fuente: FuenteEvidenciaEps.REVISION_HUMANA, metodo: 'estres_operativo',
            resultado: 'nota', fechaVerificacion: ahora, hashEvidencia: null, origen: null, datosObtenidos: { i }, errorCodigo: null, verificadoPor: f, creadoEn: ahora,
          }).instantanea());
          evidenciasPorCaso.set(id, (evidenciasPorCaso.get(id) ?? 0) + 1);
          contadores.evidencia += 1;
        }
      } catch (e) { contar(e); }
    }
  };

  const t0 = process.hrtime.bigint();
  await Promise.all(funcionarios.map((f, i) => trabajador(f, 12345 + i * 7919)));
  PIDE('duración total (ms)', [ms(t0)]);
  PIDE('operaciones', [JSON.stringify(contadores)]);
  PIDE('errores de base', [JSON.stringify(errores) === '{}' ? 'ninguno' : JSON.stringify(errores)]);
  const [{ duplicados }] = await ds.query(`SELECT count(*)::int AS duplicados FROM (SELECT documento_id FROM validaciones_eps GROUP BY documento_id HAVING count(*) > 1) x`);
  const decididasBd = await ds.query(`SELECT id::text, decidido_por::text FROM validaciones_eps WHERE decidido_por = ANY($1::uuid[]) AND decision = 'aprobado_manual'`, [funcionarios]);
  const evBd = await ds.query(`SELECT validacion_eps_id::text AS id, count(*)::int AS n FROM evidencias_validacion_eps WHERE metodo = 'estres_operativo' GROUP BY 1`);
  const mapa = new Map<string, number>(evBd.map((r: { id: string; n: number }) => [r.id, r.n]));
  const evidenciasPerdidas = [...evidenciasPorCaso].filter(([id, n]) => mapa.get(id) !== n).length;
  const asignadasHoy = await ds.query(`SELECT id::text, asignado_a::text FROM validaciones_eps WHERE asignado_a = ANY($1::uuid[])`, [funcionarios]);
  const desacuerdo = asignadasHoy.filter((r: { id: string; asignado_a: string }) => dueno.get(r.id) !== r.asignado_a).length;
  const fallos = [
    ...violaciones.slice(0, 5),
    ...(errores['40P01'] ? [`${errores['40P01']} deadlocks`] : []), ...(errores['40001'] ? [`${errores['40001']} errores de serialización`] : []),
    ...(duplicados > 0 ? [`${duplicados} documentos con más de una validación`] : []),
    ...(decididasBd.length !== decididas.size ? [`decisiones en base ${decididasBd.length} ≠ aplicadas ${decididas.size}`] : []),
    ...(evidenciasPerdidas > 0 ? [`${evidenciasPerdidas} casos con evidencias perdidas`] : []),
    ...(desacuerdo > 0 ? [`${desacuerdo} reservas en la base que el modelo no reconoce`] : []),
  ];
  PIDE('decisiones aplicadas = decisiones en base', [`${decididas.size} = ${decididasBd.length}`]);
  PIDE('evidencias adjuntadas / perdidas', [`${contadores.evidencia} / ${evidenciasPerdidas}`]);
  if (fallos.length > 0) throw new Error(`ESTRÉS OPERATIVO FALLÓ: ${fallos.join(' · ')}`);
  console.log('  ✔ sin duplicados, sin decisiones pisadas, sin evidencias perdidas, sin deadlocks');
}

async function planes(ds: DataSource, cap: Capturador, ejecutar: () => Promise<unknown>, titulo: string, solo?: RegExp): Promise<void> {
  cap.consultas = []; cap.activo = true;
  await ejecutar();
  cap.activo = false;
  const q = cap.consultas.find((c) => (solo ? solo.test(c.sql) : true) && !/^\s*(BEGIN|COMMIT|START)/i.test(c.sql));
  if (!q) { console.log(`  (sin consulta capturada para ${titulo})`); return; }
  // EXPLAIN ANALYZE de un UPDATE se ejecuta de verdad: se envuelve en una transacción que se revierte.
  const runner = ds.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const filas = (await runner.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) ${q.sql}`, q.params as unknown[])) as Array<Record<string, string>>;
    const texto = filas.map((f) => f['QUERY PLAN']).join('\n');
    const resumen = texto.split('\n').filter((l) => /Execution Time|Planning Time|Seq Scan|Index Scan|Index Only|Bitmap|Sort Method|Hash Join|Nested Loop|Merge Join|Rows Removed|Buffers: shared/.test(l)).slice(0, 14);
    console.log(`  · ${titulo}\n${resumen.map((l) => `      ${l.trim()}`).join('\n')}`);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function main(): Promise<void> {
  const nombre = `carga_mesa_${randomUUID().slice(0, 6)}`;
  const adm = await new DataSource({ type: 'postgres', url: urlDe('postgres'), ssl: false }).initialize();
  await adm.query(`CREATE DATABASE "${nombre}"`);
  await adm.destroy();
  const cap = new Capturador();
  const ds = await new DataSource({ type: 'postgres', url: urlDe(nombre), ssl: false, entities: ENTIDADES_ORM, migrations: MIGRACIONES, logger: cap, logging: ['query'], extra: { max: 12 } }).initialize();
  try {
    await ds.runMigrations({ transaction: 'each' });
    await cargarCatalogos(ds);
    cap.activo = false;
    const consolaLog = console.log; console.log = () => undefined; await sembrar(ds); console.log = consolaLog;
    const [{ id: funcionario }] = await ds.query(`SELECT id FROM usuarios WHERE rol='auxiliar' LIMIT 1`);
    const funcionarios = Array.from({ length: 6 }, () => randomUUID());
    for (const f of funcionarios) {
      await ds.query(`INSERT INTO usuarios (id, correo, nombre, documento, rol, escuelas, programa_id, activo, permiso) VALUES ($1,$2,'Funcionario Carga',$3,'auxiliar','{}',NULL,true,'escritura')`, [f, `f${f.slice(0, 6)}@cun.test`, f.slice(0, 10)]);
    }
    const repo = new ValidacionEpsRepositoryAdapter(ds.getRepository(ValidacionEpsOrm), ds.getRepository(EvidenciaValidacionEpsOrm));
    const mesa = new MesaEpsUseCase(repo, {} as never, {} as never, { buscarPorId: () => Promise.resolve(null) } as never, { registrar: () => Promise.resolve(), listar: () => Promise.resolve([]) } as never, {} as never, {} as never);
    const actor = { id: funcionario, rol: Rol.AUXILIAR, correo: 'aux@cun.test', escuelas: [], empresaId: null, nombre: 'Aux' } as never;

    console.log(`\nCarga de la Mesa · PostgreSQL local desechable · tamaños: ${TAMANOS.join(', ')} (el listado del caso de uso tiene un tope de 2.000 filas)`);
    let generado = 0;
    for (const n of TAMANOS) {
      await generar(ds, generado + 1, n, funcionario);
      generado = n;
      const [{ abiertas }] = await ds.query(`SELECT count(*)::int AS abiertas FROM validaciones_eps v JOIN documentos d ON d.id=v.documento_id WHERE v.decision='pendiente' AND d.estado='en_revision'`);
      console.log(`\n══ ${n} casos (${abiertas} abiertos en la base) ══`);
      const ahora = new Date();
      const frio = await cronometrar(() => repo.listarAbiertasMesa(ahora, null));
      const rep = [];
      for (let i = 0; i < 5; i += 1) rep.push((await cronometrar(() => repo.listarAbiertasMesa(ahora, null))).ms);
      PIDE('SQL listarAbiertasMesa (filas devueltas / ms)', [(frio.valor as unknown[]).length, `${Math.min(...rep)}–${Math.max(...rep)} ms`]);
      const listado = await cronometrar(() => mesa.listar(actor, {}, ahora));
      PIDE('Caso de uso listar sin filtros (ms)', [listado.ms, `total=${listado.valor.total}`, `kpis.abiertas=${listado.valor.kpis.abiertas}`]);
      const filtrado = await cronometrar(() => mesa.listar(actor, { estadoAdres: 'pendiente', conDiscrepancias: 'si', pagina: '2' } as never, ahora));
      PIDE('Caso de uso listar con 3 filtros + página 2 (ms)', [filtrado.ms, `total=${filtrado.valor.total}`]);
      const buscar = await cronometrar(() => mesa.listar(actor, { buscar: 'Carga 77' } as never, ahora));
      PIDE('Caso de uso listar con búsqueda por nombre (ms)', [buscar.ms, `total=${buscar.valor.total}`]);
      const sup = await cronometrar(() => repo.supervisionMesa(ahora, null));
      PIDE('Supervisión (ms)', [sup.ms, `abiertas=${sup.valor.abiertas}`]);
      const un = [];
      for (let i = 0; i < 10; i += 1) un.push((await cronometrar(() => repo.tomarSiguiente(funcionario, new Date(), new Date(Date.now() + 900_000), null))).ms);
      PIDE('tomarSiguiente secuencial ×10 (ms mín–máx)', [`${Math.min(...un)}–${Math.max(...un)}`]);
      const seis = await cronometrar(() => Promise.all(funcionarios.map((f) => repo.tomarSiguiente(f, new Date(), new Date(Date.now() + 900_000), null))));
      const ids = (seis.valor as Array<string | null>).filter(Boolean);
      PIDE('tomarSiguiente 6 simultáneos (ms / distintos)', [seis.ms, `${new Set(ids).size}/${ids.length} distintos`]);
      if (new Set(ids).size !== ids.length) throw new Error('DUPLICADO: tomar siguiente entregó el mismo caso a dos personas');
      // Libera lo reservado para no degradar el siguiente tamaño.
      await ds.query(`UPDATE validaciones_eps SET asignado_a=NULL, reservado_en=NULL, reserva_hasta=NULL WHERE asignado_a = ANY($1::uuid[])`, [[funcionario, ...funcionarios]]);
      if (n === 1000 || (n === TAMANOS[TAMANOS.length - 1] && !TAMANOS.includes(1000))) await estres(ds, repo, funcionarios, 150);
      if (n === TAMANOS[TAMANOS.length - 1]) {
        console.log('\n— Planes de ejecución al mayor tamaño —');
        await planes(ds, cap, () => repo.listarAbiertasMesa(new Date(), null), 'listarAbiertasMesa', /FROM validaciones_eps v\s+JOIN documentos/i);
        await planes(ds, cap, () => repo.tomarSiguiente(funcionario, new Date(), new Date(Date.now() + 900_000), null), 'tomarSiguiente', /UPDATE validaciones_eps/i);
        await planes(ds, cap, () => repo.supervisionMesa(new Date(), null), 'supervisionMesa (resumen)', /count\(\*\)::int AS abiertas/i);
        await ds.query(`UPDATE validaciones_eps SET asignado_a=NULL, reservado_en=NULL, reserva_hasta=NULL WHERE asignado_a = $1`, [funcionario]);
      }
    }
    if (process.env.HISTORICO !== '0') {
      const hist = Number(process.env.HISTORICO ?? 30000);
      await generarHistorico(ds, generado + 1, generado + hist, funcionario);
      const [{ abiertas, todas }] = await ds.query(`SELECT count(*) FILTER (WHERE decision='pendiente')::int AS abiertas, count(*)::int AS todas FROM validaciones_eps`);
      console.log(`\n══ HISTÓRICO REAL: ${abiertas} abiertos + ${todas - abiertas} decididos ══`);
      const ahora = new Date();
      const rep: number[] = [];
      for (let i = 0; i < 5; i += 1) rep.push((await cronometrar(() => repo.listarAbiertasMesa(ahora, null))).ms);
      PIDE('SQL listarAbiertasMesa (ms mín–máx)', [`${Math.min(...rep)}–${Math.max(...rep)}`]);
      const un: number[] = [];
      for (let i = 0; i < 10; i += 1) un.push((await cronometrar(() => repo.tomarSiguiente(funcionario, new Date(), new Date(Date.now() + 900_000), null))).ms);
      PIDE('tomarSiguiente secuencial ×10 (ms mín–máx)', [`${Math.min(...un)}–${Math.max(...un)}`]);
      PIDE('Supervisión (ms)', [(await cronometrar(() => repo.supervisionMesa(ahora, null))).ms]);
      await planes(ds, cap, () => repo.listarAbiertasMesa(new Date(), null), 'listarAbiertasMesa con histórico', /FROM validaciones_eps v\s+JOIN documentos/i);
      await planes(ds, cap, () => repo.tomarSiguiente(funcionario, new Date(), new Date(Date.now() + 900_000), null), 'tomarSiguiente con histórico', /UPDATE validaciones_eps/i);
    }
  } finally {
    await ds.destroy();
    const a2 = await new DataSource({ type: 'postgres', url: urlDe('postgres'), ssl: false }).initialize();
    await a2.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
    await a2.destroy();
  }
}

main().catch((e: Error) => { console.error(e); process.exit(1); });
