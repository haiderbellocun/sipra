import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { opcionesDataSource } from './opciones-datasource';

/**
 * Única exportación del archivo: la CLI de TypeORM lo exige.
 * Las opciones viven en `opciones-datasource.ts` para poder reutilizarlas
 * desde el módulo de Nest sin confundir a la CLI.
 */
export default new DataSource(opcionesDataSource());
