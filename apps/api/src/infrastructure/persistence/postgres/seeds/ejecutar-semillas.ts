import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { EstadoEmpresa } from '../../../../domain/entities/empresa.entity';
import { EstadoObligacion, TipoObligacion } from '../../../../domain/entities/obligacion.entity';
import {
  CicloAcademico, EstadoPractica, ModalidadPractica,
} from '../../../../domain/entities/practica.entity';
import { EstadoVacante, MarcoVacante } from '../../../../domain/entities/vacante.entity';
import { Nit } from '../../../../domain/value-objects/nit.vo';
import { PeriodoAcademico } from '../../../../domain/entities/periodo.entity';
import { Rol } from '../../../../domain/value-objects/rol.vo';
import AppDataSource from '../data-source';
import { CIIU, CNO, DIVIPOLA, ESCUELAS, NIVELES_EDUCATIVOS } from './catalogos';

/**
 * Datos sintéticos para el ambiente de pruebas.
 *
 * Ningún dato aquí proviene de una fuente real ni contiene información personal
 * de personas existentes. Los nombres, documentos, NIT y correos son ficticios.
 * Ningún dato personal real entra en desarrollo (sección 5.6).
 *
 * Los números de documento son ficticios PERO internamente consistentes: llevan
 * un dígito de verificación NUIP correcto. Un dato sintético que no supera las
 * propias validaciones del sistema genera una falsa alarma en cada ejecución y
 * enseña al equipo a ignorar las banderas.
 */

const IDS = {
  admin: '00000000-0000-4000-8000-000000000001',
  tutor: '00000000-0000-4000-8000-000000000002',
  coordinador: '00000000-0000-4000-8000-000000000003',
  extension: '00000000-0000-4000-8000-000000000004',
  auxiliar: '00000000-0000-4000-8000-000000000005',
  coordinacionArea: '00000000-0000-4000-8000-000000000006',
  coordinacionPracticas: '00000000-0000-4000-8000-000000000007',
  estudiante1: '00000000-0000-4000-8000-000000000011',
  estudiante2: '00000000-0000-4000-8000-000000000012',
  estudiante3: '00000000-0000-4000-8000-000000000013',
  empresaUsuario: '00000000-0000-4000-8000-000000000021',
  empresaHabilitada: '00000000-0000-4000-8000-000000000031',
  empresaPendiente: '00000000-0000-4000-8000-000000000032',
  empresaSospechosa: '00000000-0000-4000-8000-000000000033',
  practica1: '00000000-0000-4000-8000-000000000041',
  practica2: '00000000-0000-4000-8000-000000000042',
  practica3: '00000000-0000-4000-8000-000000000043',
  vacante1: '00000000-0000-4000-8000-000000000051',
} as const;

function fecha(diasDesdeHoy: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + diasDesdeHoy);
  return d;
}

async function sembrarCatalogos(ds: DataSource): Promise<void> {
  for (const c of CNO) {
    await ds.query(
      'INSERT INTO cat_cno (codigo, denominacion, nivel) VALUES ($1,$2,$3) ON CONFLICT (codigo) DO NOTHING',
      [c.codigo, c.denominacion, c.nivel],
    );
  }
  for (const c of CIIU) {
    await ds.query(
      'INSERT INTO cat_ciiu (codigo, descripcion, seccion) VALUES ($1,$2,$3) ON CONFLICT (codigo) DO NOTHING',
      [c.codigo, c.descripcion, c.seccion],
    );
  }
  for (const d of DIVIPOLA) {
    await ds.query(
      'INSERT INTO cat_divipola (codigo, municipio, departamento, codigo_departamento) ' +
        'VALUES ($1,$2,$3,$4) ON CONFLICT (codigo) DO NOTHING',
      [d.codigo, d.municipio, d.departamento, d.codigoDepartamento],
    );
  }
  for (const n of NIVELES_EDUCATIVOS) {
    await ds.query(
      'INSERT INTO cat_nivel_educativo (codigo, nombre, orden) VALUES ($1,$2,$3) ON CONFLICT (codigo) DO NOTHING',
      [n.codigo, n.nombre, n.orden],
    );
  }
  for (const e of ESCUELAS) {
    await ds.query(
      'INSERT INTO cat_escuela (codigo, nombre) VALUES ($1,$2) ON CONFLICT (codigo) DO NOTHING',
      [e.codigo, e.nombre],
    );
  }
  console.log('  · Catálogos oficiales (CNO, CIIU, DIVIPOLA, niveles, escuelas)');
}

async function sembrarEmpresas(ds: DataSource): Promise<void> {
  const empresas = [
    {
      id: IDS.empresaHabilitada,
      razonSocial: 'Soluciones Logísticas Andinas S.A.S.',
      nit: '901458772',
      ciiu: '5210',
      divipola: '11001',
      solicitante: 'Camila Restrepo Duarte',
      correo: 'camila.restrepo@logisticasandinas.com.co',
      representante: 'Camila Restrepo Duarte',
      estado: EstadoEmpresa.HABILITADA,
      senales: [
        { codigo: 'NIT_DV', resultado: 'ok', detalle: 'Dígito de verificación 2 para el NIT 901458772' },
        { codigo: 'DOMINIO_CORPORATIVO', resultado: 'ok', detalle: 'Dominio corporativo: logisticasandinas.com.co' },
        { codigo: 'RUES', resultado: 'ok', detalle: 'RUES: SOLUCIONES LOGÍSTICAS ANDINAS S.A.S. · matrícula activa' },
      ],
    },
    {
      id: IDS.empresaPendiente,
      razonSocial: 'Tecnología y Servicios del Caribe Ltda',
      nit: '830045123',
      ciiu: '6201',
      divipola: '08001',
      solicitante: 'Jorge Enrique Pardo Silva',
      correo: 'jorge.pardo@tecnocaribe.com.co',
      representante: 'Jorge Enrique Pardo Silva',
      estado: EstadoEmpresa.EN_VERIFICACION,
      senales: [
        { codigo: 'NIT_DV', resultado: 'ok', detalle: 'Dígito de verificación válido' },
        { codigo: 'DOMINIO_CORPORATIVO', resultado: 'ok', detalle: 'Dominio corporativo: tecnocaribe.com.co' },
        { codigo: 'RUES', resultado: 'ok', detalle: 'RUES: matrícula activa' },
      ],
    },
    {
      id: IDS.empresaSospechosa,
      razonSocial: 'Inversiones Meridiano S.A.S.',
      nit: '900777001',
      ciiu: '8299',
      divipola: '76001',
      solicitante: 'Ana María Gutiérrez Peña',
      correo: 'anamaria.gutierrez.contacto@gmail.com',
      representante: 'Pedro Nel Ospina',
      estado: EstadoEmpresa.EN_VERIFICACION,
      senales: [
        { codigo: 'NIT_DV', resultado: 'ok', detalle: 'Dígito de verificación válido' },
        { codigo: 'DOMINIO_CORPORATIVO', resultado: 'advertencia', detalle: 'El solicitante usa un dominio genérico (gmail.com)' },
        { codigo: 'RUES', resultado: 'advertencia', detalle: 'RUES: matrícula cancelada' },
        { codigo: 'REPRESENTANTE_DISCREPANTE', resultado: 'advertencia', detalle: 'El representante legal declarado no coincide con el RUES' },
      ],
    },
  ];

  for (const e of empresas) {
    const nit = Nit.crear(e.nit);
    await ds.query(
      `INSERT INTO empresas (id, razon_social, nit_numero, nit_dv, ciiu, divipola_municipio,
        solicitante_nombre, solicitante_correo, representante_legal, estado, senales,
        justificacion_decision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING`,
      [
        e.id, e.razonSocial, nit.numero, nit.digitoVerificacion, e.ciiu, e.divipola,
        e.solicitante, e.correo, e.representante, e.estado, JSON.stringify(e.senales),
        e.estado === EstadoEmpresa.HABILITADA
          ? 'Documentación verificada contra RUES; representante legal coincide. Habilitada para recibir practicantes.'
          : null,
      ],
    );
  }
  console.log(`  · ${empresas.length} empresas (1 habilitada, 2 en verificación)`);
}

async function sembrarUsuarios(ds: DataSource): Promise<void> {
  const usuarios = [
    {
      id: IDS.admin, correo: 'admin.practicas@cun.edu.co', nombre: 'Marcela Ovalle Pineda',
      documento: '52334455', rol: Rol.ADMINISTRADOR, escuelas: [], empresaId: null, programaId: null,
    },
    {
      id: IDS.tutor, correo: 'tutor.negocios@cun.edu.co', nombre: 'Hernán Darío Salcedo Rojas',
      documento: '79554433', rol: Rol.TUTOR, escuelas: ['ESC-NEG', 'ESC-COM'], empresaId: null, programaId: null,
    },
    {
      id: IDS.coordinador, correo: 'coordinacion.ingenierias@cun.edu.co', nombre: 'Patricia Elena Cárdenas Nieto',
      documento: '41223344', rol: Rol.COORDINADOR, escuelas: ['ESC-ING'], empresaId: null, programaId: null,
    },
    {
      id: IDS.extension, correo: 'extension.bolsa@cun.edu.co', nombre: 'Ricardo Alberto Peláez Mora',
      documento: '80112233', rol: Rol.EXTENSION, escuelas: [], empresaId: null, programaId: null,
    },
    {
      id: IDS.auxiliar, correo: 'auxiliar.practicas@cun.edu.co', nombre: 'Julián Andrés Torres Vega',
      documento: '1014223344', rol: Rol.AUXILIAR, escuelas: [], empresaId: null, programaId: null,
      permiso: 'escritura',
    },
    {
      // Coordinador del Área de Prácticas: alcance institucional y escritura.
      // Es el usuario de coordinación del SGP: registro FUR administrativo,
      // gestión de usuarios y de periodos, sincronización de docentes.
      id: IDS.coordinacionPracticas, correo: 'coordinacion.practicas@cun.edu.co', nombre: 'Adriana Lucía Rojas Beltrán',
      documento: '52667788', rol: Rol.COORDINADOR, escuelas: [], empresaId: null, programaId: null,
      permiso: 'escritura',
    },
    {
      // Analista del Área de Prácticas: sin escuelas, alcance institucional
      // y permiso de solo consulta, como el usuario de la analista en el SGP.
      id: IDS.coordinacionArea, correo: 'analista.practicas@cun.edu.co', nombre: 'Sandra Milena Quintero Páez',
      documento: '53112233', rol: Rol.COORDINADOR, escuelas: [], empresaId: null, programaId: null,
      permiso: 'consulta',
    },
    {
      id: IDS.estudiante1, correo: 'laura.ramirez@estudiante.cun.edu.co', nombre: 'Laura Sofía Ramírez Ortiz',
      documento: '1032456786', rol: Rol.ESTUDIANTE, escuelas: ['ESC-NEG'], empresaId: null, programaId: 'ADM-PRO',
    },
    {
      id: IDS.estudiante2, correo: 'andres.mora@estudiante.cun.edu.co', nombre: 'Andrés Felipe Mora Castaño',
      documento: '1019887659', rol: Rol.ESTUDIANTE, escuelas: ['ESC-ING'], empresaId: null, programaId: 'SIS-TGO',
    },
    {
      id: IDS.estudiante3, correo: 'valentina.ochoa@estudiante.cun.edu.co', nombre: 'Valentina Ochoa Ruiz',
      documento: '1023445561', rol: Rol.ESTUDIANTE, escuelas: ['ESC-COM'], empresaId: null, programaId: 'COM-TEC',
    },
    {
      id: IDS.empresaUsuario, correo: 'camila.restrepo@logisticasandinas.com.co',
      nombre: 'Camila Restrepo Duarte', documento: '52998877', rol: Rol.EMPRESA,
      escuelas: [], empresaId: IDS.empresaHabilitada, programaId: null,
    },
  ];

  for (const u of usuarios) {
    await ds.query(
      `INSERT INTO usuarios (id, correo, nombre, documento, rol, escuelas, empresa_id, programa_id, activo, permiso)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9) ON CONFLICT (id) DO NOTHING`,
      [u.id, u.correo, u.nombre, u.documento, u.rol, u.escuelas, u.empresaId, u.programaId,
        (u as { permiso?: string }).permiso ?? 'escritura'],
    );
  }
  console.log(`  · ${usuarios.length} usuarios, uno por cada perfil del selector`);
}

/**
 * Periodos de prácticas del año en los tres calendarios del documento
 * «Periodos académicos y cronograma del proceso de prácticas»: presencial
 * (2026A…2026D), virtual (26V01…26V06) y 335 (26P01…26P06). Las fechas son
 * sintéticas salvo las del ejemplo del documento (26V05: inicio 28 de
 * septiembre, límite de registro y ARL 28 de noviembre, inducciones 9 y 13 de
 * octubre, cargue de documentos 31 de diciembre). Las ventanas siguen la
 * regla del cronograma; la coordinación las ajusta desde gestión de periodos.
 */
async function sembrarPeriodos(ds: DataSource): Promise<void> {
  const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const periodos: { codigo: string; nombre: string; calendario: string; inicio: string; fin: string; cargue?: string; induccion?: string[]; cierreFur?: string }[] = [
    { codigo: '2026A', nombre: '2026 · primer periodo presencial', calendario: 'presencial', inicio: '2026-01-26', fin: '2026-06-05' },
    { codigo: '2026B', nombre: '2026 · segundo periodo presencial', calendario: 'presencial', inicio: '2026-04-20', fin: '2026-08-28' },
    { codigo: '2026C', nombre: '2026 · tercer periodo presencial', calendario: 'presencial', inicio: '2026-07-20', fin: '2026-12-04' },
    { codigo: '2026D', nombre: '2026 · cuarto periodo presencial', calendario: 'presencial', inicio: '2026-10-19', fin: '2027-02-26' },
    { codigo: '26V04', nombre: '2026 · cuarto bloque virtual', calendario: 'virtual', inicio: '2026-07-06', fin: '2026-10-02' },
    { codigo: '26V05', nombre: '2026 · quinto bloque virtual', calendario: 'virtual', inicio: '2026-09-28', fin: '2027-01-15', cierreFur: '2026-11-28', cargue: '2026-12-31', induccion: ['2026-10-09', '2026-10-13'] },
    { codigo: '26V06', nombre: '2026 · sexto bloque virtual', calendario: 'virtual', inicio: '2026-11-16', fin: '2027-03-05' },
    { codigo: '26P05', nombre: '2026 · quinto periodo 335', calendario: '335', inicio: '2026-09-21', fin: '2027-01-08' },
    { codigo: '26P06', nombre: '2026 · sexto periodo 335', calendario: '335', inicio: '2026-11-09', fin: '2027-02-26' },
  ];
  for (const p of periodos) {
    const inicio = dia(p.inicio);
    const fin = dia(p.fin);
    const cierreFur = p.cierreFur ? dia(p.cierreFur) : PeriodoAcademico.limiteRegistroHabitual(inicio);
    const cargue = p.cargue ? dia(p.cargue) : PeriodoAcademico.cargueHabitual(fin);
    const ventanas = Object.fromEntries(
      Object.entries(PeriodoAcademico.ventanasHabituales(inicio, fin, cierreFur, cargue))
        .map(([tipo, v]) => [tipo, { desde: iso(v.desde), hasta: iso(v.hasta) }]),
    );
    const induccion = p.induccion ?? PeriodoAcademico.jornadasHabituales(inicio).map(iso);
    await ds.query(
      `INSERT INTO periodos_academicos
         (codigo, nombre, calendario, fecha_inicio, fecha_fin, ventanas, jornadas_induccion, fecha_cargue_documentos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (codigo) DO NOTHING`,
      [p.codigo, p.nombre, p.calendario, p.inicio, p.fin, JSON.stringify(ventanas), induccion, iso(cargue)],
    );
  }
  console.log(`  · ${periodos.length} periodos académicos en tres calendarios, con su cronograma`);
}

async function sembrarPracticas(ds: DataSource): Promise<void> {
  const practicas = [
    {
      // Caso 1: activa con ARL correcta, afiliación anterior al inicio.
      id: IDS.practica1, estudianteId: IDS.estudiante1, programaId: 'ADM-PRO', escuelaId: 'ESC-NEG',
      ciclo: CicloAcademico.PROFESIONAL, modalidad: ModalidadPractica.PASANTIA,
      estado: EstadoPractica.ACTIVA, tutorId: IDS.tutor, empresaId: IDS.empresaHabilitada,
      cargo: 'Auxiliar de operaciones logísticas', jefe: 'Camila Restrepo Duarte',
      inicio: fecha(-40), fin: fecha(50), arlVerificada: true, arlFecha: fecha(-45),
    },
    {
      // Caso 2: detenida en validación por la compuerta ARL — sin afiliación.
      id: IDS.practica2, estudianteId: IDS.estudiante2, programaId: 'SIS-TGO', escuelaId: 'ESC-ING',
      ciclo: CicloAcademico.TECNOLOGO, modalidad: ModalidadPractica.PASANTIA,
      estado: EstadoPractica.EN_VALIDACION, tutorId: null, empresaId: IDS.empresaHabilitada,
      cargo: 'Practicante de desarrollo', jefe: 'Camila Restrepo Duarte',
      inicio: fecha(6), fin: fecha(96), arlVerificada: false, arlFecha: null,
    },
    {
      // Caso 3: recién inscrita, sin empresa asignada.
      id: IDS.practica3, estudianteId: IDS.estudiante3, programaId: 'COM-TEC', escuelaId: 'ESC-COM',
      ciclo: CicloAcademico.TECNICO, modalidad: ModalidadPractica.SOCIAL,
      estado: EstadoPractica.INSCRITA, tutorId: IDS.tutor, empresaId: null,
      cargo: null, jefe: null, inicio: fecha(20), fin: fecha(110),
      arlVerificada: false, arlFecha: null,
    },
  ];

  for (const p of practicas) {
    await ds.query(
      `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico,
        modalidad, estado, tutor_id, empresa_id, cargo, jefe_inmediato_nombre, fecha_inicio,
        fecha_fin, arl_verificada, arl_fecha_afiliacion, ultima_actividad)
       VALUES ($1,$2,$3,$4,$5,'2026-2',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
       ON CONFLICT (id) DO NOTHING`,
      [
        p.id, p.estudianteId, p.programaId, p.escuelaId, p.ciclo, p.modalidad, p.estado,
        p.tutorId, p.empresaId, p.cargo, p.jefe, p.inicio, p.fin, p.arlVerificada, p.arlFecha,
      ],
    );

    // Obligaciones que nacen con la práctica (motor de M5).
    const obligaciones: { tipo: TipoObligacion; limite: Date; estado: EstadoObligacion }[] = [
      {
        tipo: TipoObligacion.AUTORIZACION_TRATAMIENTO,
        limite: p.inicio,
        estado: EstadoObligacion.CUMPLIDA,
      },
      {
        tipo: TipoObligacion.AFILIACION_ARL,
        limite: new Date(p.inicio.getTime() - 86_400_000),
        estado: p.arlVerificada ? EstadoObligacion.CUMPLIDA : EstadoObligacion.PENDIENTE,
      },
      {
        tipo: TipoObligacion.REPORTE_PLAZA_PRACTICA,
        limite: p.inicio,
        estado: EstadoObligacion.PENDIENTE,
      },
      {
        tipo: TipoObligacion.CERTIFICACION_PRACTICA,
        limite: new Date(p.fin.getTime() + 30 * 86_400_000),
        estado: EstadoObligacion.PENDIENTE,
      },
    ];

    for (const o of obligaciones) {
      await ds.query(
        `INSERT INTO obligaciones (id, practica_id, tipo, estado, fecha_limite, cumplida_en)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (practica_id, tipo) DO NOTHING`,
        [
          randomUUID(), p.id, o.tipo, o.estado, o.limite,
          o.estado === EstadoObligacion.CUMPLIDA ? new Date() : null,
        ],
      );
    }
  }
  console.log('  · 3 prácticas: una activa, una detenida por la compuerta ARL, una inscrita');
  console.log('  · 12 obligaciones normativas derivadas');
}

async function sembrarVacantes(ds: DataSource): Promise<void> {
  await ds.query(
    `INSERT INTO vacantes (id, empresa_id, marco, titulo, descripcion, funciones, requisitos,
      codigo_cno, codigo_ciiu, divipola_municipio, nivel_educativo, vacantes_disponibles,
      salario_minimo, estado, publicada_en, vigente_hasta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(), now() + interval '6 months')
     ON CONFLICT (id) DO NOTHING`,
    [
      IDS.vacante1,
      IDS.empresaHabilitada,
      MarcoVacante.PRACTICA,
      'Practicante de operaciones logísticas',
      'Apoyo a la coordinación de despachos y control de inventario en el centro de distribución ' +
        'de Bogotá, con acompañamiento de un jefe de área asignado.',
      'Registro y verificación de guías; conciliación de inventario; apoyo en la programación de rutas.',
      'Estudiante activo de programas administrativos o logísticos con matrícula vigente en la ' +
        'asignatura de práctica. Manejo de hojas de cálculo.',
      '4321', '5210', '11001', 'universitaria', 2, 1_423_500,
      EstadoVacante.PUBLICADA,
    ],
  );
  console.log('  · 1 vacante publicada en marco "practica" (no entra en el reporte al SPE)');
}

/**
 * Siembra los datos sintéticos sobre una conexión ya abierta.
 *
 * Se exporta —y no solo se ejecuta como script— porque el ambiente puente
 * necesita dejar la base lista sin poder invocar una terminal.
 */
export async function sembrar(ds: DataSource): Promise<void> {
  console.log('\nSIPRA PRÁCTICAS — semillas de datos sintéticos\n');
  await sembrarCatalogos(ds);
  await sembrarEmpresas(ds);
  await sembrarUsuarios(ds);
  await sembrarPeriodos(ds);
  await sembrarPracticas(ds);
  await sembrarVacantes(ds);
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(async (ds) => {
      try {
        await sembrar(ds);
        console.log('\nListo. Ingrese en http://localhost:4200 y elija un perfil.\n');
      } finally {
        await ds.destroy();
      }
    })
    .catch((error: Error) => {
      console.error(`\nError al sembrar: ${error.message}\n`);
      process.exit(1);
    });
}
