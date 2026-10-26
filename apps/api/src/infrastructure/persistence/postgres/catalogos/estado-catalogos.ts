import 'reflect-metadata';
import AppDataSource from '../data-source';

/** Informe del estado de los catálogos oficiales y de lo que bloquean. */
async function principal(): Promise<void> {
  const ds = await AppDataSource.initialize();
  try {
    interface FilaEstado {
      nombre: string;
      estado: string;
      filas_cargadas: number;
      filas_esperadas: number | null;
      fuente: string | null;
      cargado_en: Date;
    }

    const filas: FilaEstado[] = await ds.query(
      `SELECT nombre, estado, filas_cargadas, filas_esperadas, fuente, cargado_en
       FROM cat_estado ORDER BY estado DESC, nombre`,
    );

    console.log('\nEstado de los catálogos oficiales\n');
    for (const f of filas) {
      const marca = { completo: '✓', parcial: '◐', ausente: '✗' }[f.estado] ?? '?';
      const cobertura = f.filas_esperadas
        ? `${f.filas_cargadas}/${f.filas_esperadas}`
        : String(f.filas_cargadas);
      console.log(
        `  ${marca} ${f.nombre.padEnd(24)} ${f.estado.padEnd(9)} ${cobertura.padStart(10)}   ${f.fuente ?? ''}`,
      );
    }

    const bloqueantes = filas.filter((f) => f.estado !== 'completo');
    if (bloqueantes.length > 0) {
      console.log(
        `\n  Reportes regulatorios BLOQUEADOS en preproducción y producción por: ` +
          `${bloqueantes.map((f) => f.nombre).join(', ')}.\n`,
      );
      process.exitCode = 1;
    } else {
      console.log('\n  Todos los catálogos completos: los reportes regulatorios pueden emitirse.\n');
    }
  } finally {
    await ds.destroy();
  }
}

principal().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
