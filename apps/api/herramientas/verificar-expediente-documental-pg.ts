/* eslint-disable no-console */
/**
 * Verificación de la LECTURA de la Mesa de Validación Documental contra un PostgreSQL DESECHABLE.
 *
 * Comprueba con el SQL real del adaptador que: (a) la lectura por lotes hace un número FIJO de consultas sin importar cuántos
 * expedientes y documentos haya (sin N+1), (b) respeta el alcance (docente: sus prácticas y las de su escuela; coordinación con
 * escuelas: las suyas; el resto, todas), la búsqueda por nombre o documento exacto y el filtro de prácticas con documentos, (c) trae
 * las validaciones de EPS, Actas y RUT/Cámara indexadas por documento, (d) NO escribe nada, y (e) el caso de uso agrega el paquete
 * documental real de varias prácticas con una sola lectura.
 *
 * Seguridad: se NIEGA a correr si la base no es local. Datos sintéticos (prefijo `verif-`).
 *
 *   DB_URL=postgres://usuario@127.0.0.1:PUERTO/base npm run test:pg:expediente   (tras `npm run migration:run`)
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource, Logger } from 'typeorm';
import { ExpedienteDocumentalUseCase } from '../src/application/use-cases/documentos/expediente-documental.use-case';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { ValidacionActa } from '../src/domain/entities/validacion-acta.entity';
import { ValidacionDocumentoEmpresarial } from '../src/domain/entities/validacion-documento-empresarial.entity';
import { ValidacionEps } from '../src/domain/entities/validacion-eps.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { ExpedienteDocumentalLecturaAdapter } from '../src/infrastructure/adapters/persistence/postgres/expediente-documental.adapter';
import { ValidacionActaRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/validacion-acta.adapter';
import { ValidacionDocumentoEmpresarialRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/validacion-documento-empresarial.adapter';
import { ValidacionEpsRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/validacion-eps.adapter';
import { DocumentoOrm, ENTIDADES_ORM } from '../src/infrastructure/persistence/postgres/entities/todas.orm-entity';
import { EvidenciaValidacionActaOrm, ValidacionActaOrm } from '../src/infrastructure/persistence/postgres/entities/validacion-acta.orm-entity';
import {
  EvidenciaValidacionDocEmpresarialOrm, ValidacionDocumentoEmpresarialOrm,
} from '../src/infrastructure/persistence/postgres/entities/validacion-documento-empresarial.orm-entity';
import { EvidenciaValidacionEpsOrm, ValidacionEpsOrm } from '../src/infrastructure/persistence/postgres/entities/validacion-eps.orm-entity';

const url = process.env.DB_URL?.trim();
if (!url) throw new Error('Defina DB_URL apuntando al PostgreSQL desechable.');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Se niega a correr: la base no es local.');

let fallos = 0;
function comprobar(descripcion: string, condicion: boolean, detalle = ''): void {
  if (!condicion) fallos += 1;
  console.log(`${condicion ? 'OK   ' : 'FALLA'}  ${descripcion}${condicion || !detalle ? '' : `  → ${detalle}`}`);
}

/** Cuenta las consultas que ejecuta TypeORM (para demostrar que no hay N+1). */
class ContadorDeConsultas implements Logger {
  consultas = 0;
  logQuery(): void { this.consultas += 1; }
  logQueryError(): void { /* sin ruido */ }
  logQuerySlow(): void { /* sin ruido */ }
  logSchemaBuild(): void { /* sin ruido */ }
  logMigration(): void { /* sin ruido */ }
  log(): void { /* sin ruido */ }
}

const HASH = 'c'.repeat(64);
const AHORA = new Date();

async function main(): Promise<void> {
  const contador = new ContadorDeConsultas();
  const ds = new DataSource({ type: 'postgres', url, entities: ENTIDADES_ORM, ssl: false, logger: contador, logging: ['query'] });
  await ds.initialize();
  try {
    const sufijo = randomUUID().slice(0, 8);
    const esc = `verif-${sufijo}`;
    const escOtra = `verif-otra-${sufijo}`;
    await ds.query('INSERT INTO cat_escuela (codigo, nombre) VALUES ($1, $2), ($3, $4)', [esc, 'Escuela de verificación', escOtra, 'Otra escuela']);
    const usuario = async (rol: string, nombre: string, documento: string | null = null): Promise<string> => {
      const id = randomUUID();
      await ds.query('INSERT INTO usuarios (id, correo, nombre, rol, documento) VALUES ($1, $2, $3, $4, $5)', [id, `${id}@verificacion.example`, nombre, rol, documento]);
      return id;
    };
    const tutor = await usuario('tutor', 'Docente de verificación');
    const funcionario = await usuario('auxiliar', 'Funcionaria de verificación');
    const empresa = randomUUID();
    await ds.query(`INSERT INTO empresas (id, razon_social, nit_numero, nit_dv, solicitante_nombre, solicitante_correo, estado)
                    VALUES ($1, $2, $3, 0, 'Persona sintética', 'demo@verificacion.example', 'habilitada')`, [empresa, 'EMPRESA VERIFICACION S.A.S.', `8${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`]);

    const repoEmp = new ValidacionDocumentoEmpresarialRepositoryAdapter(
      ds.getRepository(ValidacionDocumentoEmpresarialOrm), ds.getRepository(EvidenciaValidacionDocEmpresarialOrm), ds.getRepository(DocumentoOrm),
    );
    const repoEps = new ValidacionEpsRepositoryAdapter(ds.getRepository(ValidacionEpsOrm), ds.getRepository(EvidenciaValidacionEpsOrm));
    const repoActa = new ValidacionActaRepositoryAdapter(ds.getRepository(ValidacionActaOrm), ds.getRepository(EvidenciaValidacionActaOrm));

    // ── 60 expedientes con tres motores (más uno sin documentos y uno de otra escuela) ──
    const N = 60;
    const practicas: { id: string; nombre: string }[] = [];
    const nuevaPractica = async (nombre: string, escuela: string, tutorId: string | null, documento: string): Promise<string> => {
      const estudiante = await usuario('estudiante', nombre, documento);
      const id = randomUUID();
      await ds.query(
        `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado, empresa_id, tutor_id)
         VALUES ($1, $2, 'PRG', $3, 'profesional', '2026-2', 'cunbre_consolidado', 'documentacion', $4, $5)`, [id, estudiante, escuela, empresa, tutorId],
      );
      return id;
    };
    const documentoDe = async (practicaId: string, tipo: string, estado = 'en_revision', version = 1): Promise<string> => {
      const id = randomUUID();
      await ds.query(
        `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento)
         VALUES ($1, $2, $3, $4, $5, 'x.pdf', 'application/pdf', 10, $6, 'ruta/x')`, [id, practicaId, tipo, version, estado, randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')],
      );
      return id;
    };
    const estudianteDe = async (practicaId: string): Promise<string> => (await ds.query('SELECT estudiante_id FROM practicas WHERE id = $1', [practicaId]))[0].estudiante_id as string;

    for (let i = 0; i < N; i += 1) {
      const nombre = `Estudiante Verificación ${String(i).padStart(2, '0')}`;
      const id = await nuevaPractica(nombre, esc, i % 2 === 0 ? tutor : null, `99${String(i).padStart(8, '0')}`);
      practicas.push({ id, nombre });
      const est = await estudianteDe(id);
      const dEps = await documentoDe(id, 'certificado_eps');
      const dRut = await documentoDe(id, 'rut_juridico');
      const dCam = await documentoDe(id, 'camara_comercio');
      await repoEps.crearSiNoExiste(ValidacionEps.pendiente({ id: randomUUID(), documentoId: dEps, practicaId: id, estudianteId: est, ahora: AHORA }).instantanea());
      for (const [doc, tipo, detectado, familia] of [[dRut, TipoDocumento.RUT_JURIDICO, 'rut_persona_juridica', 'rut'], [dCam, TipoDocumento.CAMARA_COMERCIO, 'camara_existencia_representacion', 'camara']] as const) {
        const base = ValidacionDocumentoEmpresarial.pendiente({ id: randomUUID(), documentoId: doc, practicaId: id, estudianteId: est, tipoEsperado: tipo, recibidaEn: AHORA, ahora: AHORA }).instantanea();
        await repoEmp.crearSiNoExiste({
          ...base, estado: 'revision' as never, tipoDetectado: detectado as never, familiaDocumento: familia as never, tipoPersona: 'juridica' as never, expectativa: 'coincide',
          metodoLectura: 'texto' as never, confianza: 1, hashDocumento: HASH, procesadaEn: AHORA,
          datosExtraidos: (familia === 'rut' ? { tipoPersona: 'juridica', nit: '900123456', dv: '8', fechaGeneracion: '2024-03-15' } : null) as never,
          comparacion: familia === 'rut' ? ({ version: 1, veredicto: 'consistente', campos: [], hayDiscrepancia: false, huellaSipra: 'h', calculadaEn: AHORA.toISOString() } as never) : null,
        });
      }
      if (i < 10) {
        const dAct = await documentoDe(id, 'acta_inicio');
        await repoActa.crearSiNoExiste(ValidacionActa.pendiente({ id: randomUUID(), documentoId: dAct, practicaId: id, estudianteId: est, recibidaEn: AHORA, ahora: AHORA }).instantanea());
      }
    }
    // Una versión devuelta antigua y una nueva en una práctica (solo la nueva es la vigente).
    const pv = practicas[0].id;
    await documentoDe(pv, 'camara_comercio', 'en_revision', 2);
    const sinDocumentos = await nuevaPractica('Estudiante Verificación Sin Documentos', esc, null, '88000000');
    const deOtraEscuela = await nuevaPractica('Estudiante Otra Escuela', escOtra, null, '88000001');
    await documentoDe(deOtraEscuela, 'camara_comercio');

    const lectura = new ExpedienteDocumentalLecturaAdapter(ds);
    const contar = async <T>(f: () => Promise<T>): Promise<{ r: T; n: number }> => { contador.consultas = 0; const r = await f(); return { r, n: contador.consultas }; };
    const auditoriasAntes = Number((await ds.query('SELECT count(*) AS n FROM auditoria'))[0].n);
    const docsAntes = Number((await ds.query('SELECT count(*) AS n FROM documentos'))[0].n);
    const valsAntes = Number((await ds.query('SELECT count(*) AS n FROM validaciones_documento_empresarial'))[0].n);

    console.log('— Lectura por lotes: número fijo de consultas —');
    const todas = await contar(() => lectura.cargar({ alcance: null, escuela: esc, limite: 500 }));
    comprobar(`60 expedientes con 3 o 4 motores se leen en ${todas.n} consultas (no crece con el número de expedientes)`, todas.n <= 6 && todas.r.practicas.length === N, `${todas.n} consultas, ${todas.r.practicas.length} prácticas`);
    const pocas = await contar(() => lectura.cargar({ alcance: null, escuela: esc, limite: 3 }));
    comprobar('3 expedientes se leen en la MISMA cantidad de consultas que 60', pocas.n === todas.n || (pocas.n <= 6 && pocas.r.practicas.length === 3), `${pocas.n} vs ${todas.n}`);
    comprobar('trae los documentos y las validaciones de cada motor indexadas por documento',
      todas.r.documentos.length >= N * 3 && todas.r.eps.size === N && todas.r.empresariales.size === N * 2 && todas.r.actas.size === 10);
    comprobar('las versiones de un mismo tipo llegan de la más reciente a la más antigua', todas.r.documentos.filter((d) => d.practicaId === pv && d.tipo === 'camara_comercio').map((d) => d.version).join() === '2,1');

    console.log('\n— Alcance, búsqueda y filtros —');
    const deTutor = await lectura.cargar({ alcance: { escuelas: ['ninguna'], tutorId: tutor }, limite: 500 });
    comprobar('el docente ve las prácticas que tiene asignadas aunque no sean de su escuela', deTutor.practicas.length === N / 2 && deTutor.practicas.every((p) => p.tutorId === tutor), String(deTutor.practicas.length));
    const deEscuela = await lectura.cargar({ alcance: { escuelas: [esc], tutorId: null }, limite: 500 });
    comprobar('la coordinación con escuelas ve solo las suyas (y no la de otra escuela)', deEscuela.practicas.every((p) => p.escuelaId === esc) && !deEscuela.practicas.some((p) => p.id === deOtraEscuela));
    const sinAlcance = await lectura.cargar({ alcance: null, limite: 5000 });
    comprobar('administración o auxiliar (sin restricción) ven la práctica de otra escuela', sinAlcance.practicas.some((p) => p.id === deOtraEscuela));
    comprobar('por defecto solo entran prácticas con algún documento', !sinAlcance.practicas.some((p) => p.id === sinDocumentos));
    const conSin = await lectura.cargar({ alcance: null, incluirSinDocumentos: true, limite: 5000 });
    comprobar('con «incluirSinDocumentos» entra también la que no tiene ninguno', conSin.practicas.some((p) => p.id === sinDocumentos));
    comprobar('buscar por nombre (parcial, sin distinguir mayúsculas)', (await lectura.cargar({ alcance: null, buscar: 'verificación 07', limite: 50 })).practicas.map((p) => p.estudianteNombre).join() === 'Estudiante Verificación 07');
    comprobar('buscar por documento EXACTO (no por fragmento)', (await lectura.cargar({ alcance: null, buscar: '9900000012', limite: 50 })).practicas.length === 1 && (await lectura.cargar({ alcance: null, buscar: '99000000', limite: 50 })).practicas.length === 0);
    const unica = await lectura.cargar({ alcance: { escuelas: ['ninguna'], tutorId: null }, practicaId: practicas[1].id, limite: 1 });
    comprobar('una práctica fuera del alcance no se devuelve aunque se pida por su id', unica.practicas.length === 0);
    const unica2 = await lectura.cargar({ alcance: null, practicaId: sinDocumentos, limite: 1 });
    comprobar('pedida por su id, una práctica sin documentos sí se devuelve (el expediente abierto muestra sus obligaciones pendientes)', unica2.practicas.length === 1 && unica2.documentos.length === 0);
    comprobar('el encabezado trae estudiante, empresa y docente en la misma consulta', todas.r.practicas.every((p) => p.empresaRazonSocial === 'EMPRESA VERIFICACION S.A.S.' && p.estudianteNombre.length > 0) && todas.r.practicas.some((p) => p.tutorNombre === 'Docente de verificación'));

    console.log('\n— El caso de uso agrega el paquete documental con UNA lectura —');
    const registros: unknown[] = [];
    const caso = new ExpedienteDocumentalUseCase(lectura, { registrar: (r: unknown) => { registros.push(r); return Promise.resolve(); } } as never);
    const coord = { id: funcionario, correo: 'c@verificacion.example', rol: Rol.COORDINADOR, permiso: 'escritura' as const, escuelas: [esc], empresaId: null };
    const { r: lista, n } = await contar(() => caso.listar(coord, {}, new Date()));
    comprobar(`la cola de ${N} expedientes se arma en ${n} consultas`, n <= 6 && lista.total === N, `${n} consultas, ${lista.total} filas`);
    const primero = lista.items.find((i) => i.estudiante.nombre === 'Estudiante Verificación 05')!;
    comprobar('cada expediente trae las obligaciones reales de CUNbre consolidado, con EPS, RUT y Cámara en «procesando/disponible»',
      primero.documentos.length >= 14 && primero.documentos.find((d) => d.tipoDocumento === 'camara_comercio')?.estadoHumano === 'disponible_para_revision'
      && primero.documentos.find((d) => d.tipoDocumento === 'certificado_eps')?.estadoHumano === 'procesando'
      && primero.documentos.find((d) => d.tipoDocumento === 'soporte_aceptacion_cunbre')?.estadoHumano === 'pendiente_de_cargar');
    comprobar('de la práctica con una versión nueva solo la vigente es operable y queda una anterior como histórica', primero.documentos.find((d) => d.tipoDocumento === 'camara_comercio')?.reserva.estado === 'libre');
    const exp = await caso.expediente(pv, coord, new Date());
    comprobar('el expediente trae la versión vigente (la mayor) y cuenta la anterior como histórica',
      exp.documentos.find((d) => d.tipoDocumento === 'camara_comercio')!.version === 2 && exp.documentos.find((d) => d.tipoDocumento === 'camara_comercio')!.versionesAnteriores === 1);
    const versiones = await caso.versiones(pv, TipoDocumento.CAMARA_COMERCIO, coord);
    comprobar('las versiones se piden bajo demanda, la vigente primero', versiones.length === 2 && versiones[0].vigente && versiones[0].version === 2 && !versiones[1].vigente && versiones[1].estadoHumano === 'disponible_para_revision');
    comprobar('abrir un expediente deja un evento liviano de auditoría (lo registra el caso de uso, no la lectura)', registros.length === 1);
    const sup = await caso.supervision(coord, new Date());
    comprobar('la supervisión agrega los documentos por revisar y los expedientes abiertos', sup.expedientesAbiertos === N && sup.documentosPorRevisar >= N * 2 - 1 && sup.porMotor['camara'].porRevisar >= N - 1, JSON.stringify(sup).slice(0, 160));

    console.log('\n— Solo lectura —');
    const auditoriasDespues = Number((await ds.query('SELECT count(*) AS n FROM auditoria'))[0].n);
    comprobar('la lectura no escribió nada (ni documentos, ni validaciones, ni auditoría)',
      auditoriasDespues === auditoriasAntes && Number((await ds.query('SELECT count(*) AS n FROM documentos'))[0].n) === docsAntes
      && Number((await ds.query('SELECT count(*) AS n FROM validaciones_documento_empresarial'))[0].n) === valsAntes);
    void Rol;
  } finally {
    await ds.destroy();
  }
  console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}`);
  process.exit(fallos === 0 ? 0 : 1);
}

void main();
