/* eslint-disable no-console */
/**
 * IA de rescate (§7.35, subfase 1.5) · verificación de `contarLecturasIaRealesDesde` contra un PostgreSQL LOCAL
 * DESECHABLE, con el adaptador REAL y el JSONB real de `documentos.extraccion`.
 *
 * Las pruebas unitarias solo comprueban el texto del SQL contra un `query` simulado; aquí se comprueba que el
 * predicado cuenta lo que debe: proveedor externo o rescate invocado SÍ; lectura local, rescate no invocado, otra
 * práctica y lecturas anteriores a `desde` NO.
 *
 *   DB_URL=postgres://usuario:clave@127.0.0.1:PUERTO/postgres npx ts-node --transpile-only herramientas/verificar-lecturas-ia-pg.ts
 *
 * Seguridad: se NIEGA a correr si el host no es local. Crea una base temporal de nombre único (`lectia_pg_*`),
 * aplica todas las migraciones SOLO allí, comprueba que la base activa es esa antes de escribir y la borra al
 * terminar. Datos 100 % sintéticos.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import { DocumentoRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/repositorios.adapter';
import { DocumentoOrm, ENTIDADES_ORM } from '../src/infrastructure/persistence/postgres/entities/todas.orm-entity';
import { borrarBaseTemporal } from './soporte-base-temporal';

const base = process.env.DB_URL?.trim();
if (!base) throw new Error('Defina DB_URL apuntando al PostgreSQL desechable (cualquier base, p. ej. /postgres).');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(base).hostname)) {
  throw new Error('Se niega a correr: la base no es local. Use un PostgreSQL desechable.');
}
const urlDe = (db: string): string => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };

let fallos = 0;
const comprobar = (d: string, ok: boolean, detalle = ''): void => {
  if (!ok) fallos += 1;
  console.log(`${ok ? 'OK   ' : 'FALLA'}  ${d}${ok || !detalle ? '' : `  → ${detalle}`}`);
};

async function main(): Promise<void> {
  const nombre = `lectia_pg_${randomUUID().slice(0, 8)}`;
  const admin = await new DataSource({ type: 'postgres', url: urlDe('postgres'), ssl: false }).initialize();
  await admin.query(`CREATE DATABASE "${nombre}"`);
  let ds: DataSource | null = null;
  try {
    ds = await new DataSource({
      type: 'postgres', url: urlDe(nombre), ssl: false, migrations: MIGRACIONES, entities: ENTIDADES_ORM, extra: { max: 5 },
    }).initialize();
    const [{ actual }] = (await ds.query('SELECT current_database() AS actual')) as { actual: string }[];
    if (actual !== nombre || !actual.startsWith('lectia_pg_')) throw new Error(`Base activa inesperada (${actual}): se aborta sin escribir`);
    console.log(`Base temporal: ${actual}`);
    await ds.runMigrations({ transaction: 'each' });

    // ── Datos sintéticos: dos prácticas (FK: escuela y usuario) ──────────────
    const sufijo = randomUUID().slice(0, 8);
    const esc = `lectia-${sufijo}`;
    await ds.query('INSERT INTO cat_escuela (codigo, nombre) VALUES ($1, $2)', [esc, 'Escuela de verificación']);
    const practica = async (): Promise<string> => {
      const estudiante = randomUUID();
      const id = randomUUID();
      await ds!.query('INSERT INTO usuarios (id, correo, nombre, rol) VALUES ($1, $2, $3, $4)', [estudiante, `${estudiante}@verificacion.example`, 'Usuario sintético', 'estudiante']);
      await ds!.query(
        `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado)
         VALUES ($1, $2, 'PRG', $3, 'profesional', '2026-2', 'pasantia', 'documentacion')`,
        [id, estudiante, esc],
      );
      return id;
    };
    const p1 = await practica();
    const p2 = await practica();

    const desde = new Date('2026-11-27T05:00:00.000Z');
    const antes = '2026-11-26T20:00:00.000Z';
    const despues = '2026-11-27T15:00:00.000Z';
    const version = new Map<string, number>();
    const documento = async (practicaId: string, extraccion: Record<string, unknown> | null): Promise<void> => {
      const v = (version.get(practicaId) ?? 0) + 1;
      version.set(practicaId, v);
      await ds!.query(
        `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes,
           hash_sha256, ruta_almacenamiento, extraccion) VALUES ($1, $2, 'certificado_eps', $3, 'en_revision', 'x.pdf',
           'application/pdf', 10, $4, 'ruta/x', $5::jsonb)`,
        [randomUUID(), practicaId, v, 'c'.repeat(64), extraccion === null ? null : JSON.stringify(extraccion)],
      );
    };

    const repo = new DocumentoRepositoryAdapter(ds.getRepository(DocumentoOrm));

    // ── Casos que NO cuentan ────────────────────────────────────────────────
    await documento(p1, { proveedor: 'local', modelo: 'local-determinista', leidoEn: despues });                       // D
    await documento(p1, { proveedor: 'local', leidoEn: despues, rescateIa: { invocado: false, resultado: 'presupuesto' } }); // E
    await documento(p1, { proveedor: 'pdf417', leidoEn: despues });
    await documento(p1, { proveedor: 'simulado', leidoEn: despues });
    await documento(p1, { modelo: 'sin-proveedor', leidoEn: despues });                                                // sin proveedor
    await documento(p1, { proveedor: 'openai', leidoEn: antes });                                                       // G
    await documento(p1, { proveedor: 'local', leidoEn: antes, rescateIa: { invocado: true } });                         // G
    await documento(p1, null);                                                                                          // sin lectura
    await documento(p2, { proveedor: 'openai', leidoEn: despues });                                                    // F (otra práctica)
    await documento(p2, { proveedor: 'local', leidoEn: despues, rescateIa: { invocado: true } });                       // F

    console.log('\n— Solo lecturas que NO son IA real (o están fuera de práctica / de fecha) —');
    comprobar('D/E/F/G: ninguna cuenta (0 en la práctica 1)', (await repo.contarLecturasIaRealesDesde(p1, desde)) === 0, String(await repo.contarLecturasIaRealesDesde(p1, desde)));
    comprobar('F: la práctica 2 cuenta solo lo suyo (2: openai y rescate invocado)', (await repo.contarLecturasIaRealesDesde(p2, desde)) === 2);

    // ── Casos que SÍ cuentan ────────────────────────────────────────────────
    console.log('\n— Lecturas de IA real —');
    await documento(p1, { proveedor: 'openai', leidoEn: despues });                                                     // A
    comprobar('A: proveedor openai → cuenta (1)', (await repo.contarLecturasIaRealesDesde(p1, desde)) === 1);
    await documento(p1, { proveedor: 'anthropic', leidoEn: despues });                                                  // B
    comprobar('B: proveedor anthropic → cuenta (2)', (await repo.contarLecturasIaRealesDesde(p1, desde)) === 2);
    await documento(p1, { proveedor: 'local', leidoEn: despues, rescateIa: { invocado: true, resultado: 'recuperado' } }); // C
    comprobar('C: rescateIa.invocado = true (proveedor local) → cuenta (3)', (await repo.contarLecturasIaRealesDesde(p1, desde)) === 3);
    await documento(p1, { proveedor: 'openai', leidoEn: desde.toISOString() });
    comprobar('G: la fecha límite es inclusiva (leidoEn = desde cuenta) (4)', (await repo.contarLecturasIaRealesDesde(p1, desde)) === 4);

    await documento(p1, { proveedor: 'openai', leidoEn: despues });                                                     // H
    await documento(p1, { proveedor: 'openai', leidoEn: despues, fallida: true });                                      // billed but unusable: IA real
    await documento(p1, { proveedor: 'local', leidoEn: despues, rescateIa: { invocado: true, resultado: 'error' } });
    comprobar('H: varias lecturas reales (openai, fallida facturada, rescate con error) → cantidad correcta (7)', (await repo.contarLecturasIaRealesDesde(p1, desde)) === 7, String(await repo.contarLecturasIaRealesDesde(p1, desde)));

    console.log('\n— Otros —');
    comprobar('una fecha futura no cuenta nada', (await repo.contarLecturasIaRealesDesde(p1, new Date('2027-01-01T00:00:00Z'))) === 0);
    comprobar('un desde muy anterior suma también las lecturas viejas de IA real (9: +openai antes, +rescate antes)', (await repo.contarLecturasIaRealesDesde(p1, new Date('2026-01-01T00:00:00Z'))) === 9);
    comprobar('una práctica inexistente → 0', (await repo.contarLecturasIaRealesDesde(randomUUID(), desde)) === 0);
    const general = await repo.contarLecturasDesde(p1, desde);
    const ia = await repo.contarLecturasIaRealesDesde(p1, desde);
    comprobar(`el conteo general (${general}) sigue contando TODAS las lecturas, incluidas las locales; el de IA real (${ia}) no`, general > ia && general === 12, `general=${general} ia=${ia}`);
  } finally {
    if (ds) await ds.destroy();
    await borrarBaseTemporal(admin, nombre);
    const quedan = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombre])) as unknown[];
    console.log(`\nBase temporal ${nombre} ${quedan.length === 0 ? 'borrada' : 'NO borrada'}`);
    await admin.destroy();
  }
  console.log(`\n${fallos === 0 ? 'TODO EN VERDE' : `${fallos} FALLA(S)`}`);
  if (fallos) process.exit(1);
}

main().catch((e: Error) => { console.error(`ERROR ${e.name}: ${e.message}`); process.exit(1); });
