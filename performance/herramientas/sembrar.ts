/* eslint-disable no-console */
/**
 * Sembrador IDEMPOTENTE de `sipra_performance` (P3). Solo datos sintéticos: ni PII real ni histórico SGP.
 *
 * Se NIEGA a correr si `DB_NAME` o la base conectada no son `sipra_performance` (y si hay `DB_URL`, que mandaría
 * sobre `DB_NAME`). Siembra:
 *   - los catálogos y la semilla sintética base del proyecto (mismas funciones que `npm run seed`);
 *   - la escuela `ESC-PERF`, el periodo `PERF-2026` (virtual, activo, cargue del estudiante habilitado y con su
 *     ventana abierta durante toda la prueba), 5 coordinadores, 50 tutores y PERF_ESTUDIANTES estudiantes (2.500 por
 *     defecto; P11 sembró 10.000 con `PERF_ESTUDIANTES=10000` y luego 13.000 con `PERF_ESTUDIANTES=13000` para
 *     external-6000-001 (6453–12452) y la reserva 12453–13000: ampliar es idempotente y no toca los existentes);
 *   - una práctica ACTIVA por estudiante (ARL verificada antes del inicio: cumple la compuerta del dominio y el CHECK
 *     de la base) con sus cuatro obligaciones, igual que la semilla del proyecto.
 * Al final comprueba con el DOMINIO real (`evaluarCargueEstudiante` sobre el periodo leído por el repositorio de la
 * aplicación) que el cargue del estudiante está abierto hoy.
 *
 *   . performance/herramientas/entorno.sh && cd apps/api && \
 *   TS_NODE_PROJECT=tsconfig.json node -r ts-node/register/transpile-only ../../performance/herramientas/sembrar.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { EstadoObligacion, TipoObligacion } from '../../apps/api/src/domain/entities/obligacion.entity';
import { CicloAcademico, EstadoPractica, ModalidadPractica } from '../../apps/api/src/domain/entities/practica.entity';
import { PeriodoAcademico, TipoVentana } from '../../apps/api/src/domain/entities/periodo.entity';
import { evaluarCargueEstudiante } from '../../apps/api/src/domain/services/cargue-estudiante.domain-service';
import { Rol } from '../../apps/api/src/domain/value-objects/rol.vo';
import { cargarCatalogos } from '../../apps/api/src/infrastructure/persistence/postgres/catalogos/cargar-catalogos';
import { opcionesDataSource } from '../../apps/api/src/infrastructure/persistence/postgres/opciones-datasource';
import { sembrar } from '../../apps/api/src/infrastructure/persistence/postgres/seeds/ejecutar-semillas';

const BASE = 'sipra_performance';
export const N_ESTUDIANTES = Number(process.env.PERF_ESTUDIANTES ?? 2500);
const N_TUTORES = 50;
const N_COORDINADORES = 5;
const ESCUELA = 'ESC-PERF';
const PERIODO = 'PERF-2026';
/** Empresa habilitada de la semilla sintética del proyecto. */
const EMPRESA = '00000000-0000-4000-8000-000000000031';

const pad = (n: number, w: number) => String(n).padStart(w, '0');
/** UUID determinista (idempotencia) con formato v4 válido. */
export const uuidDe = (prefijo: string, n: number) => `${prefijo}-0000-4000-8000-${pad(n, 12)}`;
export const correoEstudiante = (i: number) => `perf-est-${pad(i, 4)}@performance.invalid`;

async function main(): Promise<void> {
  if (process.env.DB_NAME !== BASE || process.env.DB_URL?.trim()) {
    throw new Error(`Se niega a sembrar: DB_NAME debe ser ${BASE} y DB_URL no debe estar definido`);
  }
  const ds = await new DataSource({ ...opcionesDataSource(), logging: ['error'] }).initialize();
  try {
    const [{ db }] = (await ds.query('SELECT current_database() AS db')) as { db: string }[];
    if (db !== BASE) throw new Error(`Se niega a sembrar: la conexión apunta a ${db}`);
    const t0 = Date.now();
    await cargarCatalogos(ds);
    await sembrar(ds);

    await ds.query(`INSERT INTO cat_escuela (codigo, nombre) VALUES ($1, 'Escuela sintética de performance') ON CONFLICT (codigo) DO NOTHING`, [ESCUELA]);

    // Periodo: ventanas habituales del dominio; la del cargue del estudiante cubre toda la prueba.
    const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const inicio = dia('2026-10-01');
    const fin = dia('2027-03-31');
    const ventanas = Object.fromEntries(Object.entries(PeriodoAcademico.ventanasHabituales(inicio, fin, PeriodoAcademico.limiteRegistroHabitual(inicio), PeriodoAcademico.cargueHabitual(fin)))
      .map(([tipo, v]) => [tipo, { desde: iso(v.desde), hasta: iso(v.hasta) }]));
    ventanas[TipoVentana.CARGUE_ESTUDIANTE] = { desde: '2026-10-01', hasta: '2027-03-31' };
    await ds.query(
      `INSERT INTO periodos_academicos (codigo, nombre, calendario, fecha_inicio, fecha_fin, ventanas, jornadas_induccion, fecha_cargue_documentos, activo, cargue_estudiante_habilitado)
       VALUES ($1, 'Periodo sintético de performance', 'virtual', $2, $3, $4, $5, $6, true, true)
       ON CONFLICT (codigo) DO UPDATE SET ventanas = EXCLUDED.ventanas, activo = true, cargue_estudiante_habilitado = true`,
      [PERIODO, iso(inicio), iso(fin), JSON.stringify(ventanas), PeriodoAcademico.jornadasHabituales(inicio).map(iso), '2027-03-31'],
    );

    // Usuarios sintéticos (dominio reservado .invalid; documentos fuera del rango de cédulas reales).
    const usuarios: unknown[][] = [];
    for (let i = 1; i <= N_COORDINADORES; i += 1) usuarios.push([uuidDe('cccccccc', i), `perf-coord-${pad(i, 2)}@performance.invalid`, `Coordinación sintética ${i}`, `990000${pad(i, 4)}`, Rol.COORDINADOR]);
    for (let i = 1; i <= N_TUTORES; i += 1) usuarios.push([uuidDe('dddddddd', i), `perf-tut-${pad(i, 2)}@performance.invalid`, `Tutor sintético ${i}`, `991000${pad(i, 4)}`, Rol.TUTOR]);
    for (let i = 1; i <= N_ESTUDIANTES; i += 1) usuarios.push([uuidDe('eeeeeeee', i), correoEstudiante(i), `Estudiante sintético ${i}`, `992${pad(i, 7)}`, Rol.ESTUDIANTE]);
    for (let k = 0; k < usuarios.length; k += 500) {
      const lote = usuarios.slice(k, k + 500);
      await ds.query(
        `INSERT INTO usuarios (id, correo, nombre, documento, rol, escuelas, empresa_id, programa_id, activo, permiso)
         SELECT x.id::uuid, x.correo, x.nombre, x.documento, x.rol, ARRAY[$2::text], NULL, CASE WHEN x.rol = 'estudiante' THEN 'ADM-PRO' END, true, 'escritura'
         FROM jsonb_to_recordset($1::jsonb) AS x(id text, correo text, nombre text, documento text, rol text)
         ON CONFLICT (id) DO NOTHING`,
        [JSON.stringify(lote.map(([id, correo, nombre, documento, rol]) => ({ id, correo, nombre, documento, rol }))), ESCUELA],
      );
    }

    // Una práctica ACTIVA por estudiante: ARL verificada el día anterior al inicio (compuerta ARL).
    const practicas = Array.from({ length: N_ESTUDIANTES }, (_, j) => ({
      id: uuidDe('aaaaaaaa', j + 1), estudiante: uuidDe('eeeeeeee', j + 1), tutor: uuidDe('dddddddd', (j % N_TUTORES) + 1),
    }));
    for (let k = 0; k < practicas.length; k += 500) {
      await ds.query(
        `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado, tutor_id, empresa_id,
           cargo, jefe_inmediato_nombre, fecha_inicio, fecha_fin, arl_verificada, arl_fecha_afiliacion, ultima_actividad)
         SELECT x.id::uuid, x.estudiante::uuid, 'ADM-PRO', $2, $3, $4, $5, $6, x.tutor::uuid, $7::uuid,
           'Practicante sintético', 'Jefe sintético', '2026-10-15', '2027-03-15', true, '2026-10-14', now()
         FROM jsonb_to_recordset($1::jsonb) AS x(id text, estudiante text, tutor text)
         ON CONFLICT (id) DO NOTHING`,
        [JSON.stringify(practicas.slice(k, k + 500)), ESCUELA, CicloAcademico.PROFESIONAL, PERIODO, ModalidadPractica.PASANTIA, EstadoPractica.ACTIVA, EMPRESA],
      );
      await ds.query(
        `INSERT INTO obligaciones (id, practica_id, tipo, estado, fecha_limite, cumplida_en)
         SELECT gen_random_uuid(), x.id::uuid, o.tipo, o.estado, o.limite::date, CASE WHEN o.estado = $3 THEN now() END
         FROM jsonb_to_recordset($1::jsonb) AS x(id text)
         CROSS JOIN jsonb_to_recordset($2::jsonb) AS o(tipo text, estado text, limite text)
         ON CONFLICT (practica_id, tipo) DO NOTHING`,
        [JSON.stringify(practicas.slice(k, k + 500).map((p) => ({ id: p.id }))), JSON.stringify([
          { tipo: TipoObligacion.AUTORIZACION_TRATAMIENTO, estado: EstadoObligacion.CUMPLIDA, limite: '2026-10-15' },
          { tipo: TipoObligacion.AFILIACION_ARL, estado: EstadoObligacion.CUMPLIDA, limite: '2026-10-14' },
          { tipo: TipoObligacion.REPORTE_PLAZA_PRACTICA, estado: EstadoObligacion.PENDIENTE, limite: '2026-10-15' },
          { tipo: TipoObligacion.CERTIFICACION_PRACTICA, estado: EstadoObligacion.PENDIENTE, limite: '2027-04-14' },
        ]), EstadoObligacion.CUMPLIDA],
      );
    }

    // Verificación con el dominio real: el periodo leído de la base tiene el cargue del estudiante ABIERTO hoy.
    const [p] = (await ds.query(`SELECT codigo, nombre, calendario, fecha_inicio, fecha_fin, ventanas, jornadas_induccion, fecha_cargue_documentos,
        activo, cargue_estudiante_habilitado FROM periodos_academicos WHERE codigo = $1`, [PERIODO])) as Record<string, unknown>[];
    const periodo = PeriodoAcademico.desde({
      codigo: p.codigo as string, nombre: p.nombre as string, calendario: p.calendario as never,
      fechaInicio: new Date(p.fecha_inicio as string), fechaFin: new Date(p.fecha_fin as string),
      ventanas: Object.fromEntries(Object.entries(p.ventanas as Record<string, { desde: string; hasta: string }>).map(([k, v]) => [k, { desde: dia(v.desde), hasta: dia(v.hasta) }])) as never,
      jornadasInduccion: (p.jornadas_induccion as string[] ?? []).map((x) => new Date(x)), fechaCargueDocumentos: p.fecha_cargue_documentos ? new Date(p.fecha_cargue_documentos as string) : null,
      activo: p.activo as boolean, cargueEstudianteHabilitado: p.cargue_estudiante_habilitado as boolean,
      sincronizacionDocentes: false, modalidadesHabilitadas: [], creadoEn: new Date(), actualizadoEn: new Date(),
    } as never);
    const evaluacion = evaluarCargueEstudiante(periodo, new Date());
    const [conteo] = (await ds.query(`SELECT
        (SELECT count(*)::int FROM usuarios WHERE correo LIKE 'perf-est-%@performance.invalid') AS estudiantes,
        (SELECT count(*)::int FROM usuarios WHERE correo LIKE 'perf-tut-%@performance.invalid') AS tutores,
        (SELECT count(*)::int FROM usuarios WHERE correo LIKE 'perf-coord-%@performance.invalid') AS coordinadores,
        (SELECT count(*)::int FROM practicas WHERE periodo_academico = $1 AND estado = 'activa') AS practicas,
        (SELECT count(*)::int FROM obligaciones o JOIN practicas p ON p.id = o.practica_id WHERE p.periodo_academico = $1) AS obligaciones`, [PERIODO])) as Record<string, number>[];
    console.log(JSON.stringify({ base: db, ...conteo, cargueEstudiante: evaluacion.estado, permitido: evaluacion.permitido, segundos: (Date.now() - t0) / 1000 }));
    if (!evaluacion.permitido || conteo.estudiantes !== N_ESTUDIANTES || conteo.practicas !== N_ESTUDIANTES) process.exitCode = 1;
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) main().catch((e: Error) => { console.error(`ERROR ${e.message}`); process.exit(1); });
