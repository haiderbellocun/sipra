/* eslint-disable no-console */
/**
 * G6 · Verificación de la distribución de docentes contra un PostgreSQL DESECHABLE, con el adaptador REAL.
 *
 * Comprueba: (a) las lecturas agregadas (pendientes del periodo, sin terminales; cargas por docente y escuela); (b) la
 * aplicación es atómica (asignaciones + auditoría + bitácora, o nada); (c) un lote obsoleto no escribe NADA; (d) dos
 * aplicaciones simultáneas sobre prácticas comunes: exactamente una gana, sin doble asignación ni interbloqueo; (e) el caso
 * de uso completo: dos coordinadores con la misma vista previa → uno aplica y el otro recibe 409; (f) volumen.
 *
 * Seguridad: se NIEGA a correr si la base no es local. Datos sintéticos (prefijo `verif-g6-`); base desechable.
 *
 *   DB_URL=postgres://usuario@127.0.0.1:PUERTO/base npm run test:pg:distribucion   (tras `npm run migration:run`)
 */
import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { DistribucionDocentesUseCase } from '../src/application/use-cases/practicas/distribucion-docentes.use-case';
import { AccionAuditada } from '../src/domain/entities/auditoria.entity';
import { TipoEntradaBitacora } from '../src/domain/entities/bitacora.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { DistribucionDocentesPgAdapter } from '../src/infrastructure/adapters/persistence/postgres/distribucion-docentes.adapter';
import { UsuarioRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/repositorios.adapter';
import { ENTIDADES_ORM, UsuarioOrm } from '../src/infrastructure/persistence/postgres/entities/todas.orm-entity';

const url = process.env.DB_URL?.trim();
if (!url) throw new Error('Defina DB_URL apuntando al PostgreSQL desechable.');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Se niega a correr: la base no es local. Use una base desechable.');
}

let fallos = 0;
function comprobar(descripcion: string, condicion: boolean, detalle = ''): void {
  if (!condicion) fallos += 1;
  console.log(`${condicion ? 'OK   ' : 'FALLA'}  ${descripcion}${condicion || !detalle ? '' : `  → ${detalle}`}`);
}

async function main(): Promise<void> {
  const ds = new DataSource({ type: 'postgres', url, entities: ENTIDADES_ORM, extra: { max: 30 }, ssl: false });
  await ds.initialize();
  try {
    const sufijo = randomUUID().slice(0, 6);
    const ING = `verif-g6-ing-${sufijo}`;
    const NEG = `verif-g6-neg-${sufijo}`;
    for (const e of [ING, NEG]) await ds.query('INSERT INTO cat_escuela (codigo, nombre) VALUES ($1, $2)', [e, `Escuela sintética ${e}`]);
    const usuario = async (rol: string, nombre: string, escuelas: string[] = [], extra: { activo?: boolean; permiso?: string } = {}): Promise<string> => {
      const id = randomUUID();
      await ds.query('INSERT INTO usuarios (id, correo, nombre, rol, escuelas, activo, permiso) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, `${id}@verificacion.example`, nombre, rol, escuelas, extra.activo ?? true, extra.permiso ?? 'escritura']);
      return id;
    };
    const practica = async (periodo: string, escuela: string, extra: { tutor?: string | null; estado?: string } = {}): Promise<string> => {
      const id = randomUUID();
      const est = await usuario('estudiante', 'Estudiante sintético');
      await ds.query(
        `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado, tutor_id, ultima_actividad)
         VALUES ($1, $2, 'PRG', $3, 'profesional', $4, 'pasantia', $5, $6, now())`,
        [id, est, escuela, periodo, extra.estado ?? 'documentacion', extra.tutor ?? null],
      );
      return id;
    };
    const tutorDe = async (id: string): Promise<string | null> => (await ds.query('SELECT tutor_id FROM practicas WHERE id = $1', [id]))[0].tutor_id;
    const contarAuditoria = async (accion: string, ids: string[]): Promise<number> =>
      (await ds.query('SELECT count(*)::int AS n FROM auditoria WHERE accion = $1 AND entidad_id = ANY($2::uuid[])', [accion, ids]))[0].n;
    const contarBitacora = async (ids: string[]): Promise<number> =>
      (await ds.query('SELECT count(*)::int AS n FROM bitacora_entradas WHERE practica_id = ANY($1::uuid[])', [ids]))[0].n;

    const adaptador = new DistribucionDocentesPgAdapter(ds);
    const P1 = `9${sufijo.slice(0, 3)}A`.toUpperCase().replace(/[^A-Z0-9]/g, '0');

    // ── (a) Lecturas ──
    const ana = await usuario('tutor', 'Ana Sintética', [ING]);
    const beto = await usuario('tutor', 'Beto Sintético', [ING, NEG]);
    const pend = [await practica(P1, ING), await practica(P1, ING), await practica(P1, NEG)];
    await practica(P1, ING, { estado: 'anulada' });
    await practica(P1, ING, { estado: 'certificada' });
    await practica('2000A', ING);
    const asignada = await practica(P1, ING, { tutor: ana });
    await practica(P1, NEG, { tutor: beto, estado: 'reprobada' });
    const leidas = await adaptador.practicasSinDocente(P1, null);
    comprobar('pendientes: solo del periodo, sin docente y no terminales', leidas.length === 3 && leidas.every((p) => pend.includes(p.id)), JSON.stringify(leidas.length));
    comprobar('pendientes filtradas por escuela', (await adaptador.practicasSinDocente(P1, [NEG])).length === 1);
    const cargas = await adaptador.cargas(P1);
    comprobar('cargas agregadas por docente y escuela, sin terminales', cargas.length === 1 && cargas[0].tutorId === ana && cargas[0].cantidad === 1, JSON.stringify(cargas));

    // ── (b) Aplicación atómica con auditoría y bitácora ──
    const ahora = new Date();
    const audit = (id: string) => ({
      actorId: null, actorCorreo: 'verif@verificacion.example', actorRol: 'coordinador', accion: AccionAuditada.TUTOR_ASIGNADO,
      entidad: 'practica', entidadId: id, justificacion: null, metadatos: { metodo: 'automatico' }, ip: null, agenteUsuario: null, ocurridoEn: ahora,
    });
    const nota = (id: string) => ({
      id: randomUUID(), practicaId: id, tipo: TipoEntradaBitacora.SISTEMA, autor: 'sistema' as const, autorId: null,
      mensaje: 'Docente facilitador asignado (verificación).', detalle: null, venceEl: null, creadaEn: ahora,
    });
    const lote = [{ practicaId: pend[0], tutorId: beto }, { practicaId: pend[2], tutorId: beto }];
    const ok = await adaptador.aplicar({ asignaciones: lote, ahora, auditoria: lote.map((a) => audit(a.practicaId)), bitacora: lote.map((a) => nota(a.practicaId)) });
    comprobar('aplicar: true y las prácticas quedan asignadas', ok && (await tutorDe(pend[0])) === beto && (await tutorDe(pend[2])) === beto);
    comprobar('aplicar: una auditoría y una nota por práctica', (await contarAuditoria('tutor_asignado', [pend[0], pend[2]])) === 2 && (await contarBitacora([pend[0], pend[2]])) === 2);

    // ── (c) Lote obsoleto: no escribe NADA ──
    const libre = await practica(P1, ING);
    const obsoleto = [{ practicaId: libre, tutorId: ana }, { practicaId: asignada, tutorId: beto }];
    const r = await adaptador.aplicar({ asignaciones: obsoleto, ahora, auditoria: obsoleto.map((a) => audit(a.practicaId)), bitacora: obsoleto.map((a) => nota(a.practicaId)) });
    comprobar('lote con una práctica ya asignada → false', r === false);
    comprobar('… y no se escribió nada (ni la libre, ni auditoría, ni bitácora; la existente conserva su docente)',
      (await tutorDe(libre)) === null && (await tutorDe(asignada)) === ana
      && (await contarAuditoria('tutor_asignado', [libre, asignada])) === 0 && (await contarBitacora([libre, asignada])) === 0);
    const terminal = await practica(P1, ING);
    await ds.query(`UPDATE practicas SET estado = 'anulada' WHERE id = $1`, [terminal]);
    comprobar('lote con una práctica que pasó a terminal → false', !(await adaptador.aplicar({ asignaciones: [{ practicaId: terminal, tutorId: ana }], ahora, auditoria: [], bitacora: [] })));

    // ── (d) Concurrencia: lotes solapados en orden inverso, muchas veces ──
    let rondasOk = 0; let errores = 0;
    for (let ronda = 0; ronda < 8; ronda++) {
      const ps = await Promise.all(Array.from({ length: 6 }, () => practica(P1, ING)));
      const a = ps.map((p) => ({ practicaId: p, tutorId: ana }));
      const b = [...ps].reverse().map((p) => ({ practicaId: p, tutorId: beto }));
      const resultados = await Promise.allSettled([
        adaptador.aplicar({ asignaciones: a, ahora, auditoria: a.map((x) => audit(x.practicaId)), bitacora: [] }),
        adaptador.aplicar({ asignaciones: b, ahora, auditoria: b.map((x) => audit(x.practicaId)), bitacora: [] }),
      ]);
      errores += resultados.filter((x) => x.status === 'rejected').length;
      const ganadores = resultados.filter((x) => x.status === 'fulfilled' && x.value === true).length;
      const tutores = new Set(await Promise.all(ps.map(tutorDe)));
      const auditorias = await contarAuditoria('tutor_asignado', ps);
      if (ganadores === 1 && tutores.size === 1 && !tutores.has(null) && auditorias === ps.length) rondasOk += 1;
    }
    comprobar(`concurrencia: 8/8 rondas con UN ganador, un solo docente por práctica y auditoría única (${rondasOk}/8)`, rondasOk === 8);
    comprobar('concurrencia: sin errores ni interbloqueos', errores === 0, `${errores} error(es)`);

    // ── (e) Caso de uso completo: dos coordinadores con la misma vista previa ──
    const P2 = `8${sufijo.slice(0, 3)}B`.toUpperCase().replace(/[^A-Z0-9]/g, '0');
    const casoPs = await Promise.all(Array.from({ length: 10 }, (_, i) => practica(P2, i < 7 ? ING : NEG)));
    const caso = new DistribucionDocentesUseCase(
      adaptador, new UsuarioRepositoryAdapter(ds.getRepository(UsuarioOrm)),
      { buscarPorCodigo: (c: string) => Promise.resolve(c === P2 ? { instantanea: () => ({ activo: true }) } : null) } as never,
    );
    const actor = (correo: string) => ({ id: randomUUID(), correo, rol: Rol.COORDINADOR, permiso: 'escritura' as const, escuelas: [ING, NEG], empresaId: null });
    const c1 = actor('coord1@verificacion.example');
    const c2 = actor('coord2@verificacion.example');
    const vista = await caso.previsualizar(P2, undefined, c1);
    const vistaDeNuevo = await caso.previsualizar(P2, undefined, c2);
    comprobar('vista previa: no escribe (las 10 siguen sin docente) y es idéntica para dos actores', vista.huella === vistaDeNuevo.huella
      && (await Promise.all(casoPs.map(tutorDe))).every((t) => t === null));
    comprobar('vista previa: 10 pendientes, 10 asignables', vista.pendientes === 10 && vista.asignables === 10, JSON.stringify(vista.docentes));
    const [x1, x2] = await Promise.allSettled([
      caso.aplicar({ periodoAcademico: P2, huella: vista.huella }, c1),
      caso.aplicar({ periodoAcademico: P2, huella: vista.huella }, c2),
    ]);
    const exitos = [x1, x2].filter((x) => x.status === 'fulfilled').length;
    const conflictos = [x1, x2].filter((x) => x.status === 'rejected' && (x as PromiseRejectedResult).reason instanceof ConflictException).length;
    comprobar('dos aplicaciones simultáneas: una aplica y la otra recibe 409', exitos === 1 && conflictos === 1);
    const lotes: { n: number }[] = await ds.query(`SELECT count(*)::int AS n FROM auditoria WHERE accion = 'distribucion_docentes_aplicada' AND metadatos->>'periodoAcademico' = $1`, [P2]);
    comprobar('un solo evento de lote para el periodo', lotes[0].n === 1);
    const finales: { tutor_id: string; n: number }[] = await ds.query(
      'SELECT tutor_id, count(*)::int AS n FROM practicas WHERE periodo_academico = $1 GROUP BY tutor_id ORDER BY tutor_id', [P2]);
    comprobar('las 10 quedaron asignadas y respetando el alcance (NEG solo a Beto)', finales.reduce((s, f) => s + f.n, 0) === 10
      && (await ds.query(`SELECT count(*)::int AS n FROM practicas WHERE periodo_academico = $1 AND escuela_id = $2 AND tutor_id <> $3`, [P2, NEG, beto]))[0].n === 0);
    const cargasP2 = Object.fromEntries(finales.map((f) => [f.tutor_id, f.n]));
    comprobar(`balance: Ana ${cargasP2[ana]} y Beto ${cargasP2[beto]} (diferencia ≤ 1)`, Math.abs((cargasP2[ana] ?? 0) - (cargasP2[beto] ?? 0)) <= 1);
    const hist: { mensaje: string }[] = await ds.query('SELECT mensaje FROM bitacora_entradas WHERE practica_id = $1', [casoPs[0]]);
    comprobar('historial: «Docente facilitador asignado: … Distribución automática del periodo …»', /^Docente facilitador asignado: .+\. Distribución automática del periodo /.test(hist[0]?.mensaje ?? ''), hist[0]?.mensaje);
    const otraVista = await caso.previsualizar(P2, undefined, c1);
    comprobar('después de aplicar ya no hay pendientes (no se reasigna nada)', otraVista.pendientes === 0 && !otraVista.puedeAplicar);

    // ── (f) Volumen: 3.000 prácticas en un periodo ──
    const P3 = `7${sufijo.slice(0, 3)}C`.toUpperCase().replace(/[^A-Z0-9]/g, '0');
    const docentesVol = await Promise.all(Array.from({ length: 12 }, (_, i) => usuario('tutor', `Docente Volumen ${String(i).padStart(2, '0')}`, i % 3 === 0 ? [ING, NEG] : [i % 2 ? ING : NEG])));
    await ds.query(
      `WITH e AS (
         INSERT INTO usuarios (id, correo, nombre, rol)
         SELECT gen_random_uuid(), 'vol-' || g || '-' || $1 || '@verificacion.example', 'Estudiante volumen', 'estudiante' FROM generate_series(1, 3000) g
         RETURNING id)
       INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado, ultima_actividad)
       SELECT gen_random_uuid(), e.id, 'PRG', CASE WHEN random() < 0.5 THEN $2 ELSE $3 END, 'profesional', $4, 'pasantia', 'documentacion', now() FROM e`,
      [sufijo, ING, NEG, P3],
    );
    const casoVol = new DistribucionDocentesUseCase(adaptador, new UsuarioRepositoryAdapter(ds.getRepository(UsuarioOrm)),
      { buscarPorCodigo: () => Promise.resolve({ instantanea: () => ({ activo: true }) }) } as never);
    const t0 = Date.now();
    const vVol = await casoVol.previsualizar(P3, undefined, c1);
    const tPrevia = Date.now() - t0;
    const t1 = Date.now();
    const rVol = await casoVol.aplicar({ periodoAcademico: P3, huella: vVol.huella }, c1);
    const tAplicar = Date.now() - t1;
    const vol: { n: number }[] = await ds.query('SELECT count(*)::int AS n FROM practicas WHERE periodo_academico = $1 AND tutor_id IS NOT NULL', [P3]);
    const nuevos = vVol.docentes.map((d) => d.final);
    comprobar(`volumen: 3.000 asignadas (vista previa ${tPrevia} ms, aplicación ${tAplicar} ms)`, rVol.asignados === 3000 && vol[0].n === 3000);
    comprobar(`volumen: diferencia ≤ 1 entre docentes (${Math.min(...nuevos)}–${Math.max(...nuevos)})`, Math.max(...nuevos) - Math.min(...nuevos) <= 1);
  } finally {
    await ds.destroy();
  }
  console.log(fallos === 0 ? '\nTodas las comprobaciones pasaron.' : `\n${fallos} comprobación(es) fallaron.`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

void main();
