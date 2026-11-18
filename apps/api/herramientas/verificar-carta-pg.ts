/* eslint-disable no-console */
/**
 * Carta de presentación digital · verificación contra un PostgreSQL DESECHABLE (migración 1756000024000), con el
 * adaptador REAL: emisión transaccional con reemplazo, inmutabilidad (disparador), no borrado, referencia única,
 * coherencia de estados y emisiones simultáneas del mismo estudiante (una sola carta vigente equivalente).
 *
 * Se NIEGA a correr si la base no es local. Datos sintéticos (prefijo `verif-carta-`).
 *   DB_URL=postgres://usuario@127.0.0.1:PUERTO/base npm run test:pg:carta   (tras `npm run migration:run`)
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { DatosCarta } from '../src/domain/entities/carta-presentacion.entity';
import { ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import { SnapshotCarta } from '../src/domain/services/carta-presentacion.plantilla';
import { CartaRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/repositorios.adapter';
import { CartaOrm, ENTIDADES_ORM } from '../src/infrastructure/persistence/postgres/entities/todas.orm-entity';

const url = process.env.DB_URL?.trim();
if (!url) throw new Error('Defina DB_URL apuntando al PostgreSQL desechable.');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Se niega a correr: la base no es local. Use una base desechable.');
}

let fallos = 0;
const comprobar = (d: string, c: boolean, detalle = ''): void => { if (!c) fallos += 1; console.log(`${c ? 'OK   ' : 'FALLA'}  ${d}${c || !detalle ? '' : `  → ${detalle}`}`); };
async function rechaza(d: string, accion: () => Promise<unknown>, patron: RegExp): Promise<void> {
  try { await accion(); comprobar(d, false, 'la base lo aceptó'); } catch (e) { comprobar(d, patron.test((e as Error).message), (e as Error).message.slice(0, 160)); }
}

async function main(): Promise<void> {
  const ds = new DataSource({ type: 'postgres', url, entities: ENTIDADES_ORM, extra: { max: 20 }, ssl: false });
  await ds.initialize();
  try {
    const est = randomUUID();
    await ds.query('INSERT INTO usuarios (id, correo, nombre, rol) VALUES ($1, $2, $3, $4)', [est, `verif-carta-${est}@verificacion.example`, 'Estudiante sintético', 'estudiante']);
    const repo = new CartaRepositoryAdapter(ds.getRepository(CartaOrm));
    let n = 0;
    const carta = (o: Partial<DatosCarta> = {}): DatosCarta => {
      n += 1;
      const referencia = `VERIF-${String(n).padStart(4, '0')}${randomUUID().slice(0, 1).toUpperCase()}`.slice(0, 11);
      const snapshot = { referencia, documento: '1000000001', modalidad: ModalidadPractica.MONITORIA } as unknown as SnapshotCarta;
      return {
        id: randomUUID(), numeroFur: null, practicaId: null, estudianteId: est, periodoAcademico: 'VERIF', modalidadCarta: 'abierta',
        empresaRazonSocial: null, contenido: { parrafos: ['sintético'] }, hashSha256: 'h'.repeat(64), generadaPor: est, generadaEn: new Date(),
        referencia, estado: 'vigente', reemplazadaPor: null, rutaArchivo: `cartas-presentacion/${est}/${n}.pdf`, pdfSha256: 'a'.repeat(64), snapshot,
        modalidad: ModalidadPractica.MONITORIA, anuladaEn: null, motivoAnulacion: null, ...o,
      };
    };

    const a = carta();
    await repo.emitir(a);
    const b = carta();
    const r = await repo.emitir(b);
    const filaA = (await ds.query('SELECT estado, reemplazada_por FROM cartas_presentacion WHERE id = $1', [a.id]))[0];
    comprobar('emitir: la carta equivalente anterior queda REEMPLAZADA por la nueva (en la misma transacción)', r.reemplazadas.includes(a.id) && filaA.estado === 'reemplazada' && filaA.reemplazada_por === b.id);
    const otra = carta({ modalidadCarta: 'con_empresa', empresaRazonSocial: 'ORGANIZACIÓN SINTÉTICA' });
    await repo.emitir(otra);
    comprobar('otro destinatario (empresa) no reemplaza la genérica vigente', (await ds.query('SELECT estado FROM cartas_presentacion WHERE id = $1', [b.id]))[0].estado === 'vigente');

    await rechaza('inmutable: no cambia el snapshot', () => ds.query(`UPDATE cartas_presentacion SET snapshot = '{}'::jsonb WHERE id = $1`, [b.id]), /inmutable/);
    await rechaza('inmutable: no cambia el archivo ni su huella', () => ds.query(`UPDATE cartas_presentacion SET pdf_sha256 = $2 WHERE id = $1`, [b.id, 'b'.repeat(64)]), /inmutable/);
    await rechaza('inmutable: no cambia la referencia', () => ds.query(`UPDATE cartas_presentacion SET referencia = 'OTRA0-REF00' WHERE id = $1`, [b.id]), /inmutable/);
    await rechaza('no se borra una carta emitida', () => ds.query('DELETE FROM cartas_presentacion WHERE id = $1', [b.id]), /no se borra/);
    await rechaza('una reemplazada no vuelve a vigente', () => ds.query(`UPDATE cartas_presentacion SET estado = 'vigente', reemplazada_por = NULL WHERE id = $1`, [a.id]), /ya no está vigente|ck_cartas/);
    await rechaza('referencia única', () => repo.guardar(carta({ referencia: b.referencia })), /ux_cartas_referencia|duplicate|duplicad/i);
    await rechaza('estado desconocido rechazado', () => repo.guardar(carta({ estado: 'borrador' as never })), /ck_cartas_estado/);
    await rechaza('carta digital incompleta (sin huella del PDF) rechazada', () => repo.guardar(carta({ pdfSha256: null })), /ck_cartas_digital_completa/);
    await rechaza('anulada exige fecha y motivo', () => repo.guardar(carta({ estado: 'anulada' })), /ck_cartas_anulacion/);

    comprobar('anular: vigente → anulada con motivo', await repo.anular(b.id, 'Motivo sintético de verificación', new Date()));
    comprobar('anular dos veces: la segunda no aplica', !(await repo.anular(b.id, 'Otra vez', new Date())));

    // Emisiones simultáneas: exactamente UNA vigente equivalente al final.
    const simultaneas = Array.from({ length: 6 }, () => carta());
    await Promise.all(simultaneas.map((c) => repo.emitir(c)));
    const vigentes = (await ds.query(`SELECT count(*)::int AS n FROM cartas_presentacion WHERE estudiante_id = $1 AND modalidad_carta = 'abierta' AND estado = 'vigente'`, [est]))[0].n;
    comprobar(`6 emisiones simultáneas: una sola carta genérica vigente (${vigentes})`, vigentes === 1);
    const encadenadas = (await ds.query(`SELECT count(*)::int AS n FROM cartas_presentacion WHERE estudiante_id = $1 AND estado = 'reemplazada' AND reemplazada_por IS NOT NULL`, [est]))[0].n;
    comprobar(`las demás quedaron reemplazadas con su referencia a la nueva (${encadenadas})`, encadenadas >= 6);
    const historica = randomUUID();
    await ds.query(`INSERT INTO cartas_presentacion (id, estudiante_id, periodo_academico, modalidad_carta, contenido, hash_sha256, generada_por, generada_en)
                    VALUES ($1, $2, 'VERIF', 'abierta', '{}'::jsonb, $3, $2, now())`, [historica, est, 'c'.repeat(64)]);
    comprobar('las cartas históricas (sin referencia) siguen siendo válidas: vigentes y sin datos digitales', (await ds.query('SELECT estado, referencia FROM cartas_presentacion WHERE id = $1', [historica]))[0].estado === 'vigente');
  } finally {
    await ds.destroy();
  }
  console.log(fallos === 0 ? '\nTodas las comprobaciones pasaron.' : `\n${fallos} comprobación(es) fallaron.`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

void main();
