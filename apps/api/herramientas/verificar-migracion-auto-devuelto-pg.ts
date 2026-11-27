/* eslint-disable no-console */
/**
 * Subfase 1.6A · verificación de la migración `DocumentoAutoDevuelto` contra un PostgreSQL LOCAL EFÍMERO: aplica TODO el
 * historial desde cero en una base temporal, comprueba que `auto_devuelto` se acepta, que la reversión se niega si hay filas y
 * que, sin filas, revierte y vuelve a aplicar. Borra la base al terminar. Se niega a correr fuera de 127.0.0.1:54399.
 *
 *   DB_URL=postgres://verif@127.0.0.1:54399/postgres npx ts-node --transpile-only herramientas/verificar-migracion-auto-devuelto-pg.ts
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';

const base = process.env.DB_URL ?? '';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || new URL(base).port !== '54399') throw new Error('Solo el clúster efímero 54399');
const urlDe = (db: string) => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };
let fallos = 0;
const ok = (d: string, c: boolean, x = '') => { if (!c) fallos += 1; console.log(`${c ? 'OK   ' : 'FALLA'}  ${d}${c ? '' : '  → ' + x}`); };

(async () => {
  const nombre = `migauto_${randomUUID().slice(0, 8)}`;
  const admin = await new DataSource({ type: 'postgres', url: urlDe('postgres') }).initialize();
  await admin.query(`CREATE DATABASE "${nombre}"`);
  const ds = await new DataSource({ type: 'postgres', url: urlDe(nombre), migrations: MIGRACIONES }).initialize();
  try {
    const aplicadas = await ds.runMigrations({ transaction: 'each' });
    ok(`todas las migraciones aplican desde cero (${aplicadas.length}), la última es DocumentoAutoDevuelto`, aplicadas[aplicadas.length - 1]?.name === 'DocumentoAutoDevuelto1756000029000', aplicadas[aplicadas.length - 1]?.name);
    await ds.query(`INSERT INTO cat_escuela (codigo, nombre) VALUES ('m', 'm')`);
    const est = randomUUID(); const pr = randomUUID(); const doc = randomUUID();
    await ds.query(`INSERT INTO usuarios (id, correo, nombre, rol) VALUES ($1, $2, 'Sintetico', 'estudiante')`, [est, `${est}@x.example`]);
    await ds.query(`INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado) VALUES ($1, $2, 'PRG', 'm', 'profesional', '2026-2', 'pasantia', 'documentacion')`, [pr, est]);
    await ds.query(`INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento, motivo_devolucion)
      VALUES ($1, $2, 'certificado_eps', 1, 'auto_devuelto', 'x.pdf', 'application/pdf', 1, $3, 'r', 'Mensaje genérico')`, [doc, pr, 'a'.repeat(64)]);
    ok('el estado auto_devuelto se acepta', true);
    let rechazo = '';
    try { await ds.query(`UPDATE documentos SET estado = 'inventado' WHERE id = $1`, [doc]); } catch (e) { rechazo = (e as Error).message; }
    ok('un estado no previsto sigue rechazado por el CHECK', /ck_documentos_estado/.test(rechazo), rechazo);
    let revertir = '';
    try { await ds.undoLastMigration({ transaction: 'each' }); } catch (e) { revertir = (e as Error).message; }
    ok('la reversión se NIEGA si hay documentos auto_devuelto', /No se revierte/.test(revertir), revertir || 'revirtió');
    await ds.query(`UPDATE documentos SET estado = 'en_revision' WHERE id = $1`, [doc]);
    await ds.undoLastMigration({ transaction: 'each' });
    let tras = '';
    try { await ds.query(`UPDATE documentos SET estado = 'auto_devuelto' WHERE id = $1`, [doc]); } catch (e) { tras = (e as Error).message; }
    ok('sin filas, revierte y el esquema anterior vuelve a rechazar auto_devuelto', /ck_documentos_estado/.test(tras), tras);
    await ds.runMigrations({ transaction: 'each' });
    ok('y se puede volver a aplicar', true);
  } finally {
    await ds.destroy();
    await admin.query(`DROP DATABASE "${nombre}" WITH (FORCE)`);
    await admin.destroy();
  }
  console.log(fallos ? `${fallos} FALLA(S)` : 'TODO EN VERDE');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR', (e as Error).message); process.exit(1); });
