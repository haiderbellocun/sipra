/* eslint-disable no-console */
/**
 * Verificación de atomicidad y restricciones contra un PostgreSQL DESECHABLE.
 *
 * Las pruebas unitarias emulan el compare-and-set en memoria; aquí se comprueba
 * con las MISMAS sentencias SQL de los adaptadores reales que, con conexiones
 * simultáneas, solo una gana. También se prueban los CHECK y disparadores de la
 * migración de validación de EPS.
 *
 * Seguridad: se NIEGA a correr si la base no es local. Crea sus propios datos
 * sintéticos (con prefijo `verif-`) y los deja: está pensado para un contenedor
 * `--rm` que se descarta al terminar.
 *
 * Uso (tras `npm run migration:run` contra ese mismo contenedor):
 *   DB_URL=postgres://usuario:clave@127.0.0.1:PUERTO/base npm run test:pg
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  EvidenciaEps, FuenteEvidenciaEps, TipoEvidenciaEps,
} from '../src/domain/entities/evidencia-validacion-eps.entity';
import { ValidacionEps } from '../src/domain/entities/validacion-eps.entity';
import {
  DocumentoRepositoryAdapter,
} from '../src/infrastructure/adapters/persistence/postgres/repositorios.adapter';
import {
  ValidacionEpsRepositoryAdapter,
} from '../src/infrastructure/adapters/persistence/postgres/validacion-eps.adapter';
import {
  DocumentoOrm, ENTIDADES_ORM,
} from '../src/infrastructure/persistence/postgres/entities/todas.orm-entity';
import {
  EvidenciaValidacionEpsOrm, ValidacionEpsOrm,
} from '../src/infrastructure/persistence/postgres/entities/validacion-eps.orm-entity';

const url = process.env.DB_URL?.trim();
if (!url) throw new Error('Defina DB_URL apuntando al PostgreSQL desechable.');
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
  throw new Error('Se niega a correr: la base no es local. Use un contenedor desechable.');
}

let fallos = 0;
function comprobar(descripcion: string, condicion: boolean, detalle = ''): void {
  if (!condicion) fallos += 1;
  console.log(`${condicion ? 'OK   ' : 'FALLA'}  ${descripcion}${condicion || !detalle ? '' : `  → ${detalle}`}`);
}

async function rechaza(descripcion: string, accion: () => Promise<unknown>, patron: RegExp): Promise<void> {
  try {
    await accion();
    comprobar(descripcion, false, 'la base lo aceptó');
  } catch (e) {
    const mensaje = (e as Error).message;
    comprobar(descripcion, patron.test(mensaje), mensaje.slice(0, 160));
  }
}

async function main(): Promise<void> {
  const ds = new DataSource({
    type: 'postgres', url, entities: ENTIDADES_ORM, extra: { max: 30 }, ssl: false,
  });
  await ds.initialize();
  try {
    const sufijo = randomUUID().slice(0, 8);
    const estudiante = randomUUID();
    const funcionario = randomUUID();
    const funcionario2 = randomUUID();
    const practica = randomUUID();
    const esc = `verif-${sufijo}`;
    await ds.query('INSERT INTO cat_escuela (codigo, nombre) VALUES ($1, $2)', [esc, 'Escuela de verificación']);
    for (const [id, rol] of [[estudiante, 'estudiante'], [funcionario, 'coordinador'], [funcionario2, 'coordinador']]) {
      await ds.query(
        'INSERT INTO usuarios (id, correo, nombre, rol) VALUES ($1, $2, $3, $4)',
        [id, `${id}@verificacion.example`, 'Usuario sintético', rol],
      );
    }
    await ds.query(
      `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado)
       VALUES ($1, $2, 'PRG', $3, 'profesional', '2026-2', 'pasantia', 'documentacion')`,
      [practica, estudiante, esc],
    );
    let versionSiguiente = 0;
    const nuevoDocumento = async (estado: string): Promise<string> => {
      const id = randomUUID();
      await ds.query(
        `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes,
           hash_sha256, ruta_almacenamiento) VALUES ($1, $2, 'certificado_eps', $5, $3, 'x.pdf', 'application/pdf', 10, $4, 'ruta/x')`,
        [id, practica, estado, 'b'.repeat(64), (versionSiguiente += 1)],
      );
      return id;
    };

    const documentos = new DocumentoRepositoryAdapter(ds.getRepository(DocumentoOrm));
    const validaciones = new ValidacionEpsRepositoryAdapter(
      ds.getRepository(ValidacionEpsOrm), ds.getRepository(EvidenciaValidacionEpsOrm),
    );
    const ahora = new Date();

    // ── 1. Reclamo del pipeline: N simultáneos, uno gana ───────────────────
    console.log('\n— Reclamo de procesamiento —');
    const docReclamo = await nuevoDocumento('recibido');
    const reclamos = await Promise.all(Array.from({ length: 25 }, () => documentos.reclamarProcesamiento(docReclamo, ahora, 900_000)));
    comprobar('25 reclamos simultáneos: exactamente uno gana', reclamos.filter(Boolean).length === 1, String(reclamos.filter(Boolean).length));
    comprobar('un reclamo vigente no se vuelve a ganar', !(await documentos.reclamarProcesamiento(docReclamo, new Date(ahora.getTime() + 1000), 900_000)));
    comprobar('un reclamo caducado sí se retoma', await documentos.reclamarProcesamiento(docReclamo, new Date(ahora.getTime() + 901_000), 900_000));

    // ── 2. Guardado condicionado al estado ─────────────────────────────────
    console.log('\n— Guardado condicionado (decisión humana vs. resultado automático) —');
    const docCas = await nuevoDocumento('en_revision');
    const actual = (await documentos.buscarPorId(docCas))!;
    const aprobado = (await documentos.buscarPorId(docCas))!;
    aprobado.aprobar(funcionario, 'Verificado');
    const rechazado = (await documentos.buscarPorId(docCas))!;
    rechazado.rechazar(funcionario2, 'No corresponde');
    const guardados = await Promise.all([
      documentos.guardarSiEstado(aprobado.instantanea(), actual.estado),
      documentos.guardarSiEstado(rechazado.instantanea(), actual.estado),
    ]);
    comprobar('dos decisiones simultáneas: solo una se aplica', guardados.filter(Boolean).length === 1, JSON.stringify(guardados));
    const final = (await documentos.buscarPorId(docCas))!;
    comprobar('el documento quedó decidido por exactamente una persona', [EstadoDocumento.APROBADO, EstadoDocumento.RECHAZADO].includes(final.estado));
    const tardio = (await documentos.buscarPorId(docCas))!;
    comprobar('un resultado automático tardío NO pisa la decisión', !(await documentos.guardarSiEstado(tardio.instantanea(), EstadoDocumento.ANALIZANDO)));

    // ── 3. Validación EPS: una fila por documento ──────────────────────────
    console.log('\n— Validación de EPS —');
    const docVal = await nuevoDocumento('en_revision');
    const creadas = await Promise.all(Array.from({ length: 20 }, () => validaciones.crearSiNoExiste(
      ValidacionEps.pendiente({ id: randomUUID(), documentoId: docVal, practicaId: practica, estudianteId: estudiante, ahora }).instantanea(),
    )));
    comprobar('20 creaciones simultáneas: una sola fila', creadas.filter((c) => c.creada).length === 1);
    const filas = await ds.query('SELECT count(*)::int AS n FROM validaciones_eps WHERE documento_id = $1', [docVal]);
    comprobar('la base tiene exactamente una fila para el documento', filas[0].n === 1);
    const v = creadas[0].validacion;
    const idV = (await validaciones.buscarPorDocumento(docVal))!.id;

    // ── 4. CAS por versión ─────────────────────────────────────────────────
    const lecturas = await Promise.all([validaciones.buscarPorId(idV), validaciones.buscarPorId(idV)]);
    const versiones = await Promise.all(lecturas.map((l) => validaciones.guardarSiVersion(l!.instantanea(), l!.version)));
    comprobar('dos escrituras con la misma versión: solo una gana', versiones.filter(Boolean).length === 1, JSON.stringify(versiones));
    comprobar('la versión avanzó en uno', (await validaciones.buscarPorId(idV))!.version === v.version + 1);

    // ── 5. Reserva atómica ─────────────────────────────────────────────────
    const hasta = new Date(ahora.getTime() + 900_000);
    const reservas = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      validaciones.reservar(idV, i % 2 ? funcionario : funcionario2, ahora, hasta)));
    comprobar('20 reservas de dos funcionarios: el caso queda con uno solo', new Set(
      (await ds.query('SELECT asignado_a FROM validaciones_eps WHERE id = $1', [idV])).map((r: { asignado_a: string }) => r.asignado_a),
    ).size === 1);
    const dueno = (await ds.query('SELECT asignado_a FROM validaciones_eps WHERE id = $1', [idV]))[0].asignado_a as string;
    const otro = dueno === funcionario ? funcionario2 : funcionario;
    comprobar('el otro funcionario no puede tomarlo con reserva vigente', !(await validaciones.reservar(idV, otro, ahora, hasta)));
    comprobar('el dueño sí puede renovarla', await validaciones.reservar(idV, dueno, ahora, hasta));
    comprobar('una reserva vencida la toma otro', await validaciones.reservar(idV, otro, new Date(hasta.getTime() + 1), new Date(hasta.getTime() + 900_000)));
    comprobar('liberar: un tercero sin ser supervisor no puede', !(await validaciones.liberarReserva(idV, dueno, new Date(hasta.getTime() + 2), false)));
    comprobar('liberar: un supervisor sí', await validaciones.liberarReserva(idV, dueno, new Date(hasta.getTime() + 2), true));
    void reservas;

    // ── 6. CHECK de la migración ───────────────────────────────────────────
    console.log('\n— Restricciones de la base —');
    await rechaza('candidatura sin autenticidad verificada ni afiliación activa', () =>
      ds.query("UPDATE validaciones_eps SET decision = 'candidato_autoaprobacion' WHERE id = $1", [idV]), /ck_veps_candidatura/);
    await rechaza('aprobado_automatico sin criterios', () =>
      ds.query("UPDATE validaciones_eps SET decision = 'aprobado_automatico' WHERE id = $1", [idV]), /ck_veps_candidatura/);
    await rechaza('decisión humana sin funcionario', () =>
      ds.query("UPDATE validaciones_eps SET decision = 'rechazado' WHERE id = $1", [idV]), /ck_veps_decision_humana/);
    await rechaza('reserva incoherente (funcionario sin plazo)', () =>
      ds.query('UPDATE validaciones_eps SET asignado_a = $2, reservado_en = NULL WHERE id = $1', [idV, funcionario]), /ck_veps_reserva/);
    await rechaza('autenticidad verificada sin verificador ni fecha', () =>
      ds.query("UPDATE validaciones_eps SET autenticidad = 'verificada' WHERE id = $1", [idV]), /ck_veps_requiere_verificador/);
    await rechaza('afiliación activa sin verificador ni fecha', () =>
      ds.query("UPDATE validaciones_eps SET afiliacion = 'activa' WHERE id = $1", [idV]), /ck_veps_requiere_verificador/);
    await rechaza('verificador sin fecha de verificación', () =>
      ds.query("UPDATE validaciones_eps SET verificador_codigo = 'v' WHERE id = $1", [idV]), /ck_veps_verificacion_coherente/);
    await ds.query("UPDATE validaciones_eps SET autenticidad = 'verificada', verificador_codigo = 'v', verificado_en = now() WHERE id = $1", [idV]);
    comprobar('autenticidad verificada CON verificador y fecha se acepta', true);
    await ds.query("UPDATE validaciones_eps SET autenticidad = 'no_evaluada', verificador_codigo = NULL, verificado_en = NULL WHERE id = $1", [idV]);
    await rechaza('eje con valor fuera del catálogo', () =>
      ds.query("UPDATE validaciones_eps SET afiliacion = 'vigente' WHERE id = $1", [idV]), /ck_veps_afiliacion/);
    await rechaza('segunda validación para el mismo documento', () =>
      ds.query('INSERT INTO validaciones_eps (id, documento_id, practica_id, estudiante_id) VALUES ($1, $2, $3, $4)',
        [randomUUID(), docVal, practica, estudiante]), /ux_validaciones_eps_documento/);

    // ── 7. Evidencia: inserción válida, restricciones, solo inserción ──────
    const evidencia = (extra: Record<string, unknown> = {}) => EvidenciaEps.crear({
      id: randomUUID(), validacionEpsId: idV, tipo: TipoEvidenciaEps.TEXTO_PDF, fuente: FuenteEvidenciaEps.CERTIFICADO,
      metodo: 'extraccion_local_texto_pdf', resultado: 'leido', fechaVerificacion: ahora, hashEvidencia: 'c'.repeat(64),
      origen: null, datosObtenidos: { camposLeidos: ['nombre_afiliado'] }, errorCodigo: null, verificadoPor: null,
      creadoEn: ahora, ...extra,
    } as never).instantanea();
    await validaciones.agregarEvidencia(evidencia());
    comprobar('una evidencia válida se inserta', (await validaciones.listarEvidencias(idV)).length === 1);
    const insertarCrudo = (origen: string | null, datos: string, tipo = 'texto_pdf', fuente = 'certificado', verificadoPor: string | null = null) =>
      ds.query(
        `INSERT INTO evidencias_validacion_eps (id, validacion_eps_id, tipo, fuente, metodo, resultado, fecha_verificacion, origen, datos_obtenidos, verificado_por)
         VALUES ($1, $2, $3, $4, 'm', 'r', now(), $5, $6::jsonb, $7)`,
        [randomUUID(), idV, tipo, fuente, origen, datos, verificadoPor],
      );
    await ds.query("INSERT INTO evidencias_validacion_eps (id, validacion_eps_id, tipo, fuente, metodo, resultado, fecha_verificacion, datos_obtenidos) VALUES ($1, $2, 'ocr', 'certificado', 'ocr_local_tesseract_spa', 'leido', now(), '{}'::jsonb)", [randomUUID(), idV]);
    comprobar('una evidencia de tipo ocr (fuente certificado) se inserta', true);
    await rechaza('ocr con fuente ADRES', () => insertarCrudo(null, '{}', 'ocr', 'adres'), /ck_evidencias_eps_tipo_fuente/);
    await rechaza('origen con parámetros (URL firmada)', () => insertarCrudo('https://eps.example/v?token=abc', '{}'), /ck_evidencias_eps_origen/);
    await rechaza('origen con credenciales', () => insertarCrudo('https://u:p@eps.example/v', '{}'), /ck_evidencias_eps_origen/);
    await rechaza('datos con la respuesta a un CAPTCHA', () => insertarCrudo(null, '{"captcha":"1234"}'), /ck_evidencias_eps_datos/);
    await rechaza('datos con un token', () => insertarCrudo(null, '{"token":"x"}'), /ck_evidencias_eps_datos/);
    await rechaza('texto_pdf con fuente ADRES', () => insertarCrudo(null, '{}', 'texto_pdf', 'adres'), /ck_evidencias_eps_tipo_fuente/);
    await rechaza('revisión humana sin funcionario', () => insertarCrudo(null, '{}', 'revision_humana', 'revision_humana'), /ck_evidencias_eps_revision/);
    await rechaza('UPDATE de una evidencia (inmutable)', () =>
      ds.query("UPDATE evidencias_validacion_eps SET resultado = 'otro' WHERE validacion_eps_id = $1", [idV]), /inmutable|no admite|prohib/i);
    await rechaza('DELETE de una evidencia (inmutable)', () =>
      ds.query('DELETE FROM evidencias_validacion_eps WHERE validacion_eps_id = $1', [idV]), /inmutable|no admite|prohib/i);

    // ── 8. Privilegios de la aplicación ────────────────────────────────────
    const privilegios = await ds.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'sipra_app' AND table_name IN ('validaciones_eps','evidencias_validacion_eps') ORDER BY 1, 2`,
    );
    const lista = privilegios.map((p: { table_name: string; privilege_type: string }) => `${p.table_name}:${p.privilege_type}`);
    comprobar('sipra_app: sin DELETE ni TRUNCATE en las tablas de EPS',
      !lista.some((p: string) => /DELETE|TRUNCATE/.test(p)), lista.join(', '));
    comprobar('sipra_app: evidencias solo SELECT e INSERT',
      lista.filter((p: string) => p.startsWith('evidencias')).sort().join(',') === 'evidencias_validacion_eps:INSERT,evidencias_validacion_eps:SELECT', lista.join(', '));
    void TipoDocumento;
  } finally {
    await ds.destroy();
  }
  console.log(`\n${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : `${fallos} COMPROBACIONES FALLARON`}`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
