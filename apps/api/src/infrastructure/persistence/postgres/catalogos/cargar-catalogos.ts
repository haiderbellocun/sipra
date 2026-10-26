import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import AppDataSource from '../data-source';

/**
 * Ingestor de catálogos oficiales.
 *
 * Lee el manifiesto, valida cada archivo contra su estructura y lo carga.
 * Dos garantías que justifican que esto sea un programa y no un script:
 *
 *  1. Si un catálogo se declara `completo` y el conteo real no coincide con
 *     `filas_esperadas`, la carga FALLA. No se puede declarar completitud por
 *     descuido.
 *  2. El estado resultante queda en `cat_estado`, y el módulo de reportes lo
 *     consulta antes de emitir un archivo para la Unidad del SPE.
 */

/**
 * En un catálogo plano, `filas_esperadas` es un número. En uno jerárquico es
 * un objeto con el conteo esperado por nivel, y `columna_jerarquia` indica qué
 * columna del CSV lo lleva. Comparar un archivo con secciones y clases contra
 * un solo total produce coberturas sin sentido.
 */
interface EntradaManifiesto {
  nombre: string;
  archivo: string;
  tabla: string;
  estado: 'completo' | 'parcial';
  filas_esperadas: number | Record<string, number>;
  columna_jerarquia?: string;
  fuente: string;
  url_oficial: string;
  justificacion_estado: string;
}

interface Cobertura {
  cargadas: number;
  esperadas: number;
  completo: boolean;
  detalle: Record<string, { cargadas: number; esperadas: number }> | null;
  resumen: string;
}

function medirCobertura(
  entrada: EntradaManifiesto,
  filas: Record<string, string>[],
): Cobertura {
  if (typeof entrada.filas_esperadas === 'number') {
    const esperadas = entrada.filas_esperadas;
    return {
      cargadas: filas.length,
      esperadas,
      completo: filas.length === esperadas,
      detalle: null,
      resumen: `${filas.length} de ${esperadas}`,
    };
  }

  const columna = entrada.columna_jerarquia ?? 'jerarquia';
  const detalle: Record<string, { cargadas: number; esperadas: number }> = {};
  let cargadas = 0;
  let esperadas = 0;
  let completo = true;

  for (const [nivel, esperado] of Object.entries(entrada.filas_esperadas)) {
    const reales = filas.filter((f) => f[columna] === nivel).length;
    detalle[nivel] = { cargadas: reales, esperadas: esperado };
    cargadas += reales;
    esperadas += esperado;
    if (reales !== esperado) completo = false;
  }

  const resumen = Object.entries(detalle)
    .map(([nivel, c]) => `${nivel} ${c.cargadas}/${c.esperadas}`)
    .join(', ');
  return { cargadas, esperadas, completo, detalle, resumen };
}

interface Manifiesto {
  catalogos: EntradaManifiesto[];
}

export class CatalogoInvalidoError extends Error {
  constructor(catalogo: string, motivo: string) {
    super(`Catálogo "${catalogo}": ${motivo}`);
    this.name = 'CatalogoInvalidoError';
  }
}

/** Analizador de CSV con soporte de campos entrecomillados y comas internas. */
export function leerCsv(contenido: string): Record<string, string>[] {
  const filas: string[][] = [];
  let campo = '';
  let fila: string[] = [];
  let entreComillas = false;

  for (let i = 0; i < contenido.length; i += 1) {
    const c = contenido[i];
    if (entreComillas) {
      if (c === '"') {
        if (contenido[i + 1] === '"') { campo += '"'; i += 1; }
        else entreComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { entreComillas = true; continue; }
    if (c === ',') { fila.push(campo); campo = ''; continue; }
    if (c === '\n') {
      fila.push(campo.replace(/\r$/, ''));
      if (fila.some((v) => v.trim() !== '')) filas.push(fila);
      fila = []; campo = '';
      continue;
    }
    campo += c;
  }
  fila.push(campo.replace(/\r$/, ''));
  if (fila.some((v) => v.trim() !== '')) filas.push(fila);

  if (filas.length === 0) return [];
  const cabeceras = filas[0].map((h) => h.trim());
  return filas.slice(1).map((valores) =>
    Object.fromEntries(cabeceras.map((h, i) => [h, (valores[i] ?? '').trim()])),
  );
}

/** Validaciones estructurales por catálogo. Se ejecutan antes de tocar la base. */
const VALIDADORES: Record<string, (filas: Record<string, string>[]) => string[]> = {
  divipola_departamento(filas) {
    const errores: string[] = [];
    for (const f of filas) {
      if (!/^\d{2}$/.test(f.codigo)) errores.push(`código "${f.codigo}" no es de dos dígitos`);
      if (!f.nombre) errores.push(`el departamento ${f.codigo} no tiene nombre`);
    }
    return errores;
  },
  divipola_municipio(filas) {
    const errores: string[] = [];
    for (const f of filas) {
      if (!/^\d{5}$/.test(f.codigo)) {
        errores.push(`código "${f.codigo}" no es de cinco dígitos`);
      } else if (!f.codigo.startsWith(f.codigo_departamento)) {
        errores.push(`el municipio ${f.codigo} no pertenece al departamento ${f.codigo_departamento}`);
      }
    }
    return errores;
  },
  ciiu(filas) {
    const errores: string[] = [];
    const secciones = new Set(filas.filter((f) => f.jerarquia === 'seccion').map((f) => f.codigo));
    if (secciones.size !== 21) {
      errores.push(`se esperaban 21 secciones y hay ${secciones.size}`);
    }
    for (const f of filas.filter((x) => x.jerarquia === 'clase')) {
      if (!/^\d{4}$/.test(f.codigo)) errores.push(`clase "${f.codigo}" no es de cuatro dígitos`);
      if (!secciones.has(f.seccion)) errores.push(`la clase ${f.codigo} apunta a la sección inexistente ${f.seccion}`);
    }
    return errores;
  },
  cno(filas) {
    const errores: string[] = [];
    const grupos = new Set(filas.filter((f) => f.jerarquia === 'gran_grupo').map((f) => f.codigo));
    if (grupos.size !== 10) errores.push(`se esperaban 10 grandes grupos y hay ${grupos.size}`);
    for (const f of filas.filter((x) => x.jerarquia === 'ocupacion')) {
      if (!/^\d{4}$/.test(f.codigo)) errores.push(`ocupación "${f.codigo}" no es de cuatro dígitos`);
      if (f.codigo[0] !== f.gran_grupo) {
        errores.push(`la ocupación ${f.codigo} no corresponde al gran grupo ${f.gran_grupo}`);
      }
    }
    return errores;
  },
  nivel_educativo(filas) {
    return filas.filter((f) => !f.codigo || !f.nombre).map((f) => `nivel sin código o nombre: ${JSON.stringify(f)}`);
  },
};

/** Cargadores: traducen las filas del CSV a la tabla de destino. */
const CARGADORES: Record<
  string,
  (ds: DataSource, filas: Record<string, string>[]) => Promise<void>
> = {
  async divipola_departamento(ds, filas) {
    for (const f of filas) {
      await ds.query(
        `INSERT INTO cat_departamento (codigo, nombre, region) VALUES ($1,$2,$3)
         ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, region = EXCLUDED.region`,
        [f.codigo, f.nombre, f.region || null],
      );
    }
  },
  async divipola_municipio(ds, filas) {
    for (const f of filas) {
      await ds.query(
        `INSERT INTO cat_divipola (codigo, municipio, departamento, codigo_departamento)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (codigo) DO UPDATE SET municipio = EXCLUDED.municipio,
           departamento = EXCLUDED.departamento`,
        [
          f.codigo,
          f.nombre,
          // El nombre del departamento se resuelve contra su propio catálogo.
          (await ds.query('SELECT nombre FROM cat_departamento WHERE codigo = $1', [
            f.codigo_departamento,
          ]))[0]?.nombre ?? f.codigo_departamento,
          f.codigo_departamento,
        ],
      );
    }
  },
  async ciiu(ds, filas) {
    for (const f of filas) {
      await ds.query(
        `INSERT INTO cat_ciiu (codigo, descripcion, seccion, jerarquia) VALUES ($1,$2,$3,$4)
         ON CONFLICT (codigo) DO UPDATE SET descripcion = EXCLUDED.descripcion,
           seccion = EXCLUDED.seccion, jerarquia = EXCLUDED.jerarquia`,
        [f.codigo, f.descripcion, f.seccion, f.jerarquia],
      );
    }
  },
  async cno(ds, filas) {
    for (const f of filas) {
      await ds.query(
        `INSERT INTO cat_cno (codigo, denominacion, jerarquia, gran_grupo) VALUES ($1,$2,$3,$4)
         ON CONFLICT (codigo) DO UPDATE SET denominacion = EXCLUDED.denominacion,
           jerarquia = EXCLUDED.jerarquia, gran_grupo = EXCLUDED.gran_grupo`,
        [f.codigo, f.denominacion, f.jerarquia, f.gran_grupo],
      );
    }
  },
  async nivel_educativo(ds, filas) {
    for (const f of filas) {
      await ds.query(
        `INSERT INTO cat_nivel_educativo (codigo, nombre, orden) VALUES ($1,$2,$3)
         ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, orden = EXCLUDED.orden`,
        [f.codigo, f.nombre, Number(f.orden || 0)],
      );
    }
  },
};

export async function cargarCatalogos(ds: DataSource, carpeta = __dirname): Promise<void> {
  const manifiesto = JSON.parse(
    readFileSync(join(carpeta, 'manifiesto.json'), 'utf8'),
  ) as Manifiesto;

  console.log('\nSIPRA PRÁCTICAS — carga de catálogos oficiales\n');

  for (const entrada of manifiesto.catalogos) {
    const contenido = readFileSync(join(carpeta, entrada.archivo), 'utf8');
    const filas = leerCsv(contenido);
    const hash = createHash('sha256').update(contenido).digest('hex');

    const errores = VALIDADORES[entrada.nombre]?.(filas) ?? [];
    if (errores.length > 0) {
      throw new CatalogoInvalidoError(
        entrada.nombre,
        `${errores.length} problema(s) de estructura:\n    · ${errores.slice(0, 10).join('\n    · ')}`,
      );
    }

    const cobertura = medirCobertura(entrada, filas);

    // Declarar completitud exige demostrarla.
    if (entrada.estado === 'completo' && !cobertura.completo) {
      throw new CatalogoInvalidoError(
        entrada.nombre,
        `se declara "completo" pero la cobertura real es ${cobertura.resumen}. ` +
          'Corrija el archivo o el manifiesto.',
      );
    }

    await CARGADORES[entrada.nombre](ds, filas);

    await ds.query(
      `INSERT INTO cat_estado (nombre, tabla, estado, filas_cargadas, filas_esperadas,
                               fuente, url_oficial, justificacion, hash_archivo,
                               detalle, cargado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (nombre) DO UPDATE SET
         estado = EXCLUDED.estado, filas_cargadas = EXCLUDED.filas_cargadas,
         filas_esperadas = EXCLUDED.filas_esperadas, fuente = EXCLUDED.fuente,
         url_oficial = EXCLUDED.url_oficial, justificacion = EXCLUDED.justificacion,
         hash_archivo = EXCLUDED.hash_archivo, detalle = EXCLUDED.detalle,
         cargado_en = now()`,
      [
        entrada.nombre, entrada.tabla, entrada.estado, cobertura.cargadas,
        cobertura.esperadas, entrada.fuente, entrada.url_oficial,
        entrada.justificacion_estado, hash,
        cobertura.detalle ? JSON.stringify(cobertura.detalle) : null,
      ],
    );

    const marca = entrada.estado === 'completo' ? '✓' : '◐';
    const porcentaje = Math.round((cobertura.cargadas / cobertura.esperadas) * 100);
    console.log(
      `  ${marca} ${entrada.nombre.padEnd(24)} ${entrada.estado.padEnd(9)} ` +
        `${String(porcentaje).padStart(3)} %   ${cobertura.resumen}`,
    );
  }

  const parciales = manifiesto.catalogos.filter((c) => c.estado === 'parcial');
  if (parciales.length > 0) {
    console.log(
      `\n  ${parciales.length} catálogo(s) incompletos: ${parciales.map((c) => c.nombre).join(', ')}.` +
        '\n  Los reportes regulatorios quedan bloqueados en preproducción y producción' +
        '\n  hasta reemplazarlos por el archivo oficial. Ver catalogos/manifiesto.json.\n',
    );
  } else {
    console.log('\n  Todos los catálogos están completos.\n');
  }
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(async (ds) => {
      try {
        await cargarCatalogos(ds);
      } finally {
        await ds.destroy();
      }
    })
    .catch((error: Error) => {
      console.error(`\n  ${error.message}\n`);
      process.exit(1);
    });
}
