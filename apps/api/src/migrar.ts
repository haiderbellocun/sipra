import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { opcionesDataSource } from './infrastructure/persistence/postgres/opciones-datasource';
import {
  cargarCatalogos,
} from './infrastructure/persistence/postgres/catalogos/cargar-catalogos';
import { sembrar } from './infrastructure/persistence/postgres/seeds/ejecutar-semillas';

/**
 * Preparación del esquema, para ejecutarse como paso propio antes de publicar
 * una revisión.
 *
 * Existe compilado y no como script de la CLI de TypeORM porque la imagen de
 * producción solo lleva `dist` y las dependencias de ejecución: `ts-node` no
 * está ahí, y un paso de migración que solo funciona en la máquina del
 * desarrollador no es un paso de despliegue.
 *
 * Las semillas solo entran donde los datos son sintéticos y únicamente si la
 * base está vacía: sembrar sobre datos reales sería añadir personas que no
 * existen a un expediente que sí.
 */
async function principal(): Promise<void> {
  const ambiente = process.env.SIPRA_AMBIENTE ?? 'dev';
  const ds = new DataSource(opcionesDataSource());
  await ds.initialize();

  try {
    const pendientes = await ds.showMigrations();
    console.log(pendientes ? '▸ Aplicando migraciones…' : '▸ No hay migraciones pendientes.');
    const aplicadas = await ds.runMigrations({ transaction: 'each' });
    aplicadas.forEach((m) => console.log(`  ✓ ${m.name}`));

    console.log('▸ Cargando catálogos oficiales…');
    await cargarCatalogos(ds);

    if (['dev', 'qa'].includes(ambiente)) {
      const [{ n }] = await ds.query<[{ n: number }]>('SELECT count(*)::int AS n FROM usuarios');
      if (n === 0) {
        console.log('▸ Base vacía en un ambiente de datos sintéticos: se siembra.');
        await sembrar(ds);
      } else {
        console.log(`▸ La base ya tiene ${n} usuario(s): no se siembra.`);
      }
    }
    console.log('\nEsquema listo.');
  } finally {
    await ds.destroy();
  }
}

principal().catch((error: Error) => {
  // Un fallo aquí debe detener el despliegue: publicar una revisión contra un
  // esquema a medias es peor que no publicarla.
  console.error(`\nLa preparación del esquema falló: ${error.message}`);
  process.exit(1);
});
