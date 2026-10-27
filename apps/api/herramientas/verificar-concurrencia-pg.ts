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
  ESTADOS_ADRES_ABIERTOS, calcularPrioridad, tieneDiscrepanciaCriticaPersistida,
} from '../src/domain/services/mesa-eps.domain-service';
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

    // ── 1b. Reinicio: el proceso murió en «analizando» y varias instancias nuevas intentan retomar a la vez ──
    console.log('\n— Reinicio: proceso muerto durante «analizando» —');
    const docMuerto = await nuevoDocumento('recibido');
    comprobar('la instancia que va a morir reclama el documento', await documentos.reclamarProcesamiento(docMuerto, ahora, 900_000));
    const [{ estado: estadoMuerto }] = await ds.query('SELECT estado FROM documentos WHERE id = $1', [docMuerto]);
    comprobar('queda en «analizando» (el proceso muere sin soltarlo)', estadoMuerto === 'analizando', estadoMuerto);
    const antesDelVencimiento = await Promise.all(Array.from({ length: 10 }, () => documentos.reclamarProcesamiento(docMuerto, new Date(ahora.getTime() + 60_000), 900_000)));
    comprobar('antes de caducar el reclamo, NINGUNA instancia nueva lo retoma (no hay doble procesamiento)', antesDelVencimiento.every((x) => !x));
    const alReiniciar = await Promise.all(Array.from({ length: 10 }, () => documentos.reclamarProcesamiento(docMuerto, new Date(ahora.getTime() + 905_000), 900_000)));
    comprobar('tras caducar, 10 instancias que reinician a la vez: exactamente UNA lo retoma', alReiniciar.filter(Boolean).length === 1, String(alReiniciar.filter(Boolean).length));

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
    // ── Consulta ADRES asistida ──
    await rechaza('estado ADRES fuera del catálogo', () =>
      ds.query("UPDATE validaciones_eps SET adres_estado = 'automatico' WHERE id = $1", [idV]), /ck_veps_adres_estado/);
    await rechaza('consulta en curso sin identificador ni quién la preparó', () =>
      ds.query("UPDATE validaciones_eps SET adres_estado = 'en_consulta' WHERE id = $1", [idV]), /ck_veps_adres_consulta/);
    await rechaza('evidencia ADRES recibida sin hash ni quién la cargó', () =>
      ds.query("UPDATE validaciones_eps SET adres_estado = 'evidencia_recibida' WHERE id = $1", [idV]), /ck_veps_adres_evidencia/);
    await rechaza('tipo de documento fuera del catálogo', () =>
      ds.query("UPDATE validaciones_eps SET tipo_documento = 'XX' WHERE id = $1", [idV]), /ck_veps_tipo_documento/);
    await rechaza('tipo de documento «confirmado» sin persona', () =>
      ds.query("UPDATE validaciones_eps SET tipo_documento = 'CC', tipo_documento_origen = 'confirmacion_humana' WHERE id = $1", [idV]), /ck_veps_tipo_confirmacion/);
    await rechaza('recomendación fuera del catálogo', () =>
      ds.query("UPDATE validaciones_eps SET adres_recomendacion = 'aprobar' WHERE id = $1", [idV]), /ck_veps_adres_recomendacion/);
    await rechaza('afiliación activa sin fuente', () =>
      ds.query("UPDATE validaciones_eps SET afiliacion = 'activa' WHERE id = $1", [idV]), /ck_veps_requiere_verificador/);
    await rechaza('fuente ADRES sin consulta procesada', () =>
      ds.query("UPDATE validaciones_eps SET afiliacion = 'activa', afiliacion_fuente = 'adres_bdua' WHERE id = $1", [idV]), /ck_veps_requiere_verificador/);
    await rechaza('fuente «verificador oficial» sin verificador', () =>
      ds.query("UPDATE validaciones_eps SET afiliacion = 'activa', afiliacion_fuente = 'verificador_oficial' WHERE id = $1", [idV]), /ck_veps_requiere_verificador/);
    await rechaza('ADRES no puede establecer la AUTENTICIDAD del certificado', () =>
      ds.query("UPDATE validaciones_eps SET autenticidad = 'verificada', adres_estado = 'procesado', adres_evidencia_hash = $2, adres_cargada_por = $3, adres_cargada_en = now() WHERE id = $1",
        [idV, 'd'.repeat(64), funcionario]), /ck_veps_requiere_verificador/);
    await ds.query(
      `UPDATE validaciones_eps SET adres_estado = 'procesado', adres_evidencia_hash = $2, adres_cargada_por = $3, adres_cargada_en = now(),
         tipo_documento = 'CC', tipo_documento_origen = 'confirmacion_humana', tipo_documento_confirmado_por = $3,
         afiliacion = 'activa', afiliacion_fuente = 'adres_bdua' WHERE id = $1`,
      [idV, 'd'.repeat(64), funcionario]);
    comprobar('afiliación activa por ADRES con consulta procesada, hash y persona: se acepta', true);
    await ds.query(
      `UPDATE validaciones_eps SET adres_estado = 'pendiente', adres_evidencia_hash = NULL, adres_cargada_por = NULL, adres_cargada_en = NULL,
         tipo_documento = NULL, tipo_documento_origen = NULL, tipo_documento_confirmado_por = NULL,
         afiliacion = 'no_contrastada', afiliacion_fuente = NULL WHERE id = $1`, [idV]);
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
    // ── Mesa operativa: «tomar siguiente» atómico y su prioridad ──
    console.log('\n— Mesa de EPS —');
    // Se aparta lo anterior: estos casos son de la Mesa y empiezan sin reserva.
    await ds.query("UPDATE validaciones_eps SET asignado_a = NULL, reservado_en = NULL, reserva_hasta = NULL WHERE reserva_hasta IS NOT NULL");
    await ds.query("UPDATE validaciones_eps SET decision = 'rechazado', decidido_por = $1, decidido_en = now() WHERE decision IN ('pendiente','candidato_autoaprobacion')", [funcionario]);
    const funcionarios: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const id = randomUUID();
      funcionarios.push(id);
      await ds.query('INSERT INTO usuarios (id, correo, nombre, rol) VALUES ($1, $2, $3, $4)', [id, `${id}@mesa.example`, `Funcionario ${i + 1}`, 'coordinador']);
    }
    const hoy = new Date();
    const crearCaso = async (o: { hace: number; inicioEnDias?: number | null; version?: number; critica?: boolean; adres?: string }): Promise<string> => {
      const est = randomUUID();
      const pra = randomUUID();
      await ds.query('INSERT INTO usuarios (id, correo, nombre, rol, documento) VALUES ($1, $2, $3, $4, $5)',
        [est, `${est}@estudiante.example`, 'Estudiante sintético', 'estudiante', String(Math.floor(1e9 + Math.random() * 8e9))]);
      const inicio = o.inicioEnDias === undefined || o.inicioEnDias === null ? null : new Date(hoy.getTime() + o.inicioEnDias * 86_400_000);
      await ds.query(
        `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado, fecha_inicio)
         VALUES ($1, $2, 'PRG', $3, 'profesional', '2026-2', 'pasantia', 'documentacion', $4)`, [pra, est, esc, inicio]);
      const recibida = new Date(hoy.getTime() - o.hace * 86_400_000);
      const documento = randomUUID();
      for (let ver = 1; ver <= (o.version ?? 1); ver += 1) {
        const doc = ver === (o.version ?? 1) ? documento : randomUUID();
        await ds.query(
          `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento, cargado_en)
           VALUES ($1, $2, 'certificado_eps', $3, 'en_revision', 'x.pdf', 'application/pdf', 10, $4, 'ruta/x', $5)`,
          [doc, pra, ver, String(ver).padStart(64, 'e'), recibida]);
      }
      const v = ValidacionEps.pendiente({ id: randomUUID(), documentoId: documento, practicaId: pra, estudianteId: est, ahora: recibida, recibidaEn: recibida });
      v.registrarProcesamiento({
        datosExtraidos: null as never, coincidencia: 'coincide' as never, discrepancias: [], vigencia: 'vigente', hayBanderaCritica: o.critica ?? false,
      }, recibida);
      const { validacion } = await validaciones.crearSiNoExiste(v.instantanea());
      if (o.adres) await ds.query('UPDATE validaciones_eps SET adres_estado = $2 WHERE id = $1', [validacion.id, o.adres]);
      return validacion.id;
    };

    const casos = {
      antiguo: await crearCaso({ hace: 25 }),
      practicaProxima: await crearCaso({ hace: 3, inicioEnDias: 5 }),
      reenvio: await crearCaso({ hace: 2, version: 2 }),
      critica: await crearCaso({ hace: 1, critica: true }),
      adresPendiente: await crearCaso({ hace: 1, adres: 'pendiente' }),
      reciente: await crearCaso({ hace: 0 }),
    };
    const todas = await validaciones.listarAbiertasMesa(hoy, null);
    comprobar('la bandeja trae SOLO la versión vigente de cada certificado (el reenvío cuenta una vez)', todas.length === 6, String(todas.length));
    comprobar('la bandeja trae el estudiante, la práctica y el documento unidos', todas.every((f) => f.estudiante.nombre && f.practica.periodoAcademico === '2026-2' && f.documento.version >= 1));
    const reenvioFila = todas.find((f) => f.validacion.id === casos.reenvio);
    comprobar('el reenvío reporta 2 versiones y la vigente es la 2', reenvioFila?.documento.version === 2 && reenvioFila.documento.totalVersiones === 2);

    // La prioridad de SQL (la de «tomar siguiente») debe dar EXACTAMENTE el orden de la regla del dominio.
    const ordenDominio = [...todas].sort((a, b) => {
      const pa = (f: typeof a): number => calcularPrioridad({
        recibidaEn: f.validacion.instantanea().recibidaEn ?? hoy, fechaInicioPractica: f.practica.fechaInicio, version: f.documento.version,
        discrepanciaCritica: tieneDiscrepanciaCriticaPersistida(f.validacion.instantanea()),
        adresPendiente: ESTADOS_ADRES_ABIERTOS.includes(f.validacion.instantanea().adres.estado),
      }, hoy).puntaje;
      return pa(b) - pa(a) || (a.validacion.instantanea().recibidaEn as Date).getTime() - (b.validacion.instantanea().recibidaEn as Date).getTime();
    }).map((f) => f.validacion.id);
    const ordenSql: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const id = await validaciones.tomarSiguiente(funcionarios[0], hoy, new Date(hoy.getTime() + 900_000), null);
      if (id) ordenSql.push(id);
    }
    comprobar('«tomar siguiente» sigue el orden de prioridad del dominio', JSON.stringify(ordenSql) === JSON.stringify(ordenDominio), JSON.stringify({ ordenSql: ordenSql.length, ordenDominio: ordenDominio.length }));
    comprobar('un caso con reserva vigente no se entrega otra vez', (await validaciones.tomarSiguiente(funcionarios[1], hoy, new Date(hoy.getTime() + 900_000), null)) === null);
    const primera = (await ds.query('SELECT primera_revision_en, version FROM validaciones_eps WHERE id = $1', [ordenSql[0]]))[0];
    comprobar('al tomarlo queda la fecha de la primera revisión y sube la versión', primera.primera_revision_en !== null && primera.version >= 2);

    // SEIS funcionarios a la vez, seis casos: seis casos distintos.
    await ds.query("UPDATE validaciones_eps SET asignado_a = NULL, reservado_en = NULL, reserva_hasta = NULL WHERE reserva_hasta IS NOT NULL");
    const seis: string[] = [];
    for (let i = 0; i < 6; i += 1) seis.push(await crearCaso({ hace: i }));
    await ds.query("UPDATE validaciones_eps SET decision = 'rechazado', decidido_por = $1, decidido_en = now() WHERE id = ANY($2)", [funcionario, ordenSql]);
    const hastaMesa = new Date(hoy.getTime() + 900_000);
    const simultaneos = await Promise.all(funcionarios.map((f) => validaciones.tomarSiguiente(f, hoy, hastaMesa, null)));
    comprobar('seis funcionarios a la vez con seis casos: seis casos DISTINTOS', simultaneos.every((x) => x !== null) && new Set(simultaneos).size === 6, JSON.stringify(simultaneos.map((x) => x?.slice(0, 4))));
    const duenos = await ds.query('SELECT asignado_a FROM validaciones_eps WHERE id = ANY($1)', [seis]);
    comprobar('cada caso quedó con exactamente un responsable y todos son distintos', new Set(duenos.map((d: { asignado_a: string }) => d.asignado_a)).size === 6);

    // Solo 3 casos para 6 funcionarios.
    await ds.query("UPDATE validaciones_eps SET decision = 'rechazado', decidido_por = $1, decidido_en = now() WHERE id = ANY($2)", [funcionario, seis]);
    const tres: string[] = [];
    for (let i = 0; i < 3; i += 1) tres.push(await crearCaso({ hace: i + 1 }));
    const reparto = await Promise.all(funcionarios.map((f) => validaciones.tomarSiguiente(f, hoy, hastaMesa, null)));
    const con = reparto.filter((x) => x !== null);
    comprobar('solo 3 casos para 6 funcionarios: 3 reciben caso y 3 reciben «sin casos»', con.length === 3 && reparto.filter((x) => x === null).length === 3 && new Set(con).size === 3);
    comprobar('los 3 casos entregados son los 3 que existían', new Set(con).size === 3 && con.every((c) => tres.includes(c as string)));

    // Una reserva vencida se puede volver a tomar.
    await ds.query("UPDATE validaciones_eps SET reservado_en = now() - interval '20 minutes', reserva_hasta = now() - interval '1 minute' WHERE id = $1", [tres[0]]);
    const retomado = await validaciones.tomarSiguiente(funcionarios[0], new Date(), new Date(Date.now() + 900_000), null);
    comprobar('una reserva vencida vuelve a estar disponible', retomado === tres[0]);

    // Alcance por escuela y criterios.
    comprobar('con otra escuela en el alcance no se entrega nada', (await validaciones.tomarSiguiente(funcionarios[2], new Date(), new Date(Date.now() + 900_000), ['no-existe'])) === null);

    const supervision = await validaciones.supervisionMesa(new Date(), null);
    comprobar('la supervisión cuenta abiertas y la carga por funcionario', supervision.abiertas >= 3 && supervision.funcionarios.some((f) => f.reservasVigentes >= 1));

    void TipoDocumento;
  } finally {
    await ds.destroy();
  }
  console.log(`\n${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : `${fallos} COMPROBACIONES FALLARON`}`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
