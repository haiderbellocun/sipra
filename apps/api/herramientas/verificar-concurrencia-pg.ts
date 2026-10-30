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
import { Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import {
  EvidenciaEps, FuenteEvidenciaEps, TipoEvidenciaEps,
} from '../src/domain/entities/evidencia-validacion-eps.entity';
import { ValidacionEps } from '../src/domain/entities/validacion-eps.entity';
import { Practica } from '../src/domain/entities/practica.entity';
import { EvidenciaActa, TipoEvidenciaActa, ValidacionActa } from '../src/domain/entities/validacion-acta.entity';
import { ValidacionActaRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/validacion-acta.adapter';
import { PracticaRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/repositorios.adapter';
import { EvidenciaValidacionActaOrm, ValidacionActaOrm } from '../src/infrastructure/persistence/postgres/entities/validacion-acta.orm-entity';
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
  DocumentoOrm, ENTIDADES_ORM, PracticaOrm,
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

    // ═══ Acta de iniciación (Bloque 3): unicidad, idempotencia, restricciones, privilegios ═══════════════════════
    console.log('\n— Acta de iniciación: validación y evidencias —');
    const validacionesActa = new ValidacionActaRepositoryAdapter(
      ds.getRepository(ValidacionActaOrm), ds.getRepository(EvidenciaValidacionActaOrm),
    );
    let versionActa = 0;
    const nuevaActa = async (): Promise<string> => {
      const id = randomUUID();
      await ds.query(
        `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes,
           hash_sha256, ruta_almacenamiento) VALUES ($1, $2, 'acta_inicio', $4, 'en_revision', 'a.pdf', 'application/pdf', 10, $3, 'ruta/a')`,
        [id, practica, 'c'.repeat(64), (versionActa += 1)],
      );
      return id;
    };
    const pendienteActa = (documentoId: string) => ValidacionActa.pendiente({
      id: randomUUID(), documentoId, practicaId: practica, estudianteId: estudiante, recibidaEn: ahora, ahora,
    }).instantanea();

    // Una validación por documento: N creaciones simultáneas dejan UNA fila.
    const docA = await nuevaActa();
    const creaciones = await Promise.all(Array.from({ length: 20 }, () => validacionesActa.crearSiNoExiste(pendienteActa(docA))));
    comprobar('20 creaciones simultáneas de la validación del mismo documento: exactamente una se crea', creaciones.filter((c) => c.creada).length === 1);
    comprobar('todas devuelven la MISMA validación', new Set(creaciones.map((c) => c.validacion.id)).size === 1);
    const [{ n: filasA }] = await ds.query('SELECT count(*)::int AS n FROM validaciones_acta_iniciacion WHERE documento_id = $1', [docA]);
    comprobar('la base tiene una sola fila para el documento', filasA === 1);

    // Compare-and-set: solo uno gana con la misma versión.
    const vA = creaciones[0].validacion;
    const cas = await Promise.all(Array.from({ length: 20 }, (_, i) => {
      const copia = ValidacionActa.desde(vA.instantanea());
      copia.iniciarProcesamiento(new Date(ahora.getTime() + i));
      return validacionesActa.guardarSiVersion(copia.instantanea(), vA.version);
    }));
    comprobar('20 actualizaciones simultáneas con la misma versión: exactamente una gana', cas.filter(Boolean).length === 1);
    const tras = (await validacionesActa.buscarPorDocumento(docA))!;
    comprobar('la versión subió una sola vez y el estado es «procesando» con la ronda 1', tras.version === vA.version + 1 && tras.estado === 'procesando' && tras.intentos === 1);

    // Evidencias idempotentes por (validación, ronda, tipo).
    const evidenciaActa = (intento: number, tipo: TipoEvidenciaActa) => EvidenciaActa.crear({
      id: randomUUID(), validacionActaId: vA.id, intento, tipo, resultado: 'ok', metodo: 'verificacion', fecha: ahora, actorId: null,
      hashDocumento: 'c'.repeat(64), datos: { prueba: true }, errorCodigo: null, creadoEn: ahora,
    }).instantanea();
    const ins = await Promise.all(Array.from({ length: 20 }, () => validacionesActa.agregarEvidencia(evidenciaActa(1, TipoEvidenciaActa.LECTURA_DOCUMENTO))));
    comprobar('20 inserciones simultáneas de la misma evidencia (validación, ronda, tipo): exactamente una entra', ins.filter(Boolean).length === 1);
    comprobar('otra ronda del mismo tipo SÍ entra', await validacionesActa.agregarEvidencia(evidenciaActa(2, TipoEvidenciaActa.LECTURA_DOCUMENTO)));
    comprobar('otro tipo en la misma ronda SÍ entra', await validacionesActa.agregarEvidencia(evidenciaActa(1, TipoEvidenciaActa.COMPARACION)));
    comprobar('la validación tiene exactamente 3 evidencias', (await validacionesActa.listarEvidencias(vA.id)).length === 3);

    // Versiones: otra versión del acta = otro documento = otra validación, sin copiar nada.
    const docB = await nuevaActa();
    const { validacion: vB, creada: creadaB } = await validacionesActa.crearSiNoExiste(pendienteActa(docB));
    comprobar('una versión nueva del acta crea su propia validación, en blanco', creadaB && vB.id !== vA.id && vB.intentos === 0 && vB.estado === 'pendiente');
    comprobar('la validación de la versión nueva no hereda las evidencias de la anterior', (await validacionesActa.listarEvidencias(vB.id)).length === 0);
    comprobar('la práctica lista las dos validaciones', (await validacionesActa.listarPorPractica(practica)).length >= 2);

    // Inmutabilidad de las evidencias.
    await rechaza('UPDATE de una evidencia se rechaza (disparador)', () => ds.query(`UPDATE evidencias_validacion_acta SET resultado = 'otro' WHERE validacion_acta_id = $1`, [vA.id]), /inmutable|insufficient/i);
    await rechaza('DELETE de una evidencia se rechaza (disparador)', () => ds.query(`DELETE FROM evidencias_validacion_acta WHERE validacion_acta_id = $1`, [vA.id]), /inmutable|insufficient/i);

    // Restricciones de la validación.
    const docC = await nuevaActa();
    const insertar = (columnas: string, valores: unknown[]): Promise<unknown> =>
      ds.query(`INSERT INTO validaciones_acta_iniciacion (id, documento_id, practica_id, estudiante_id, ${columnas}) VALUES ($1,$2,$3,$4,${valores.map((_, i) => `$${i + 5}`).join(',')})`,
        [randomUUID(), docC, practica, estudiante, ...valores]);
    await rechaza('un segundo registro para el mismo documento se rechaza (unicidad)', () => ds.query(
      `INSERT INTO validaciones_acta_iniciacion (id, documento_id, practica_id, estudiante_id) VALUES ($1,$2,$3,$4)`, [randomUUID(), docA, practica, estudiante]), /ux_vacta_documento|duplicate|unique/i);
    await rechaza('un estado fuera del catálogo se rechaza', () => insertar('estado', ['aprobado_automatico']), /ck_vacta_estado/);
    await rechaza('el tipo de acta fuera del catálogo se rechaza', () => insertar('tipo_acta_detectada', ['acta_rara']), /ck_vacta_tipo/);
    await rechaza('una firma fuera de si/no/no_determinable se rechaza', () => insertar('firma_empresa', ['autentica']), /ck_vacta_firma_empresa/);
    await rechaza('una decisión humana sin quién ni cuándo se rechaza', () => insertar('estado', ['aprobado_manual']), /ck_vacta_decision_humana/);
    await rechaza('«error» sin código de error se rechaza', () => insertar('estado', ['error']), /ck_vacta_error/);
    await rechaza('un documento INCORRECTO con remuneración «válida» se rechaza', () => insertar('tipo_acta_detectada, remuneracion_detectada', ['documento_incorrecto', 'remunerada']), /ck_vacta_solo_acta/);
    await rechaza('un documento NO DETERMINABLE con responsable de ARL «válido» se rechaza', () => insertar('tipo_acta_detectada, responsable_arl_detectado', ['no_determinable', 'cun']), /ck_vacta_solo_acta/);
    await rechaza('un documento incorrecto con firma «si» se rechaza', () => insertar('tipo_acta_detectada, firma_practicante', ['documento_incorrecto', 'si']), /ck_vacta_solo_acta/);
    await rechaza('el texto del documento no cabe en los datos extraídos (clave prohibida)', () => insertar('datos_extraidos', [JSON.stringify({ texto_ocr: 'x' })]), /ck_vacta_datos/);
    await rechaza('una imagen de firma no cabe en la comparación (clave prohibida)', () => insertar('comparacion', [JSON.stringify({ imagen_firma: 'x' })]), /ck_vacta_comparacion/);
    await rechaza('una confianza fuera de 0–1 se rechaza', () => insertar('confianza', [1.5]), /ck_vacta_confianza|numeric field overflow/i);
    await insertar('tipo_acta_detectada, remuneracion_detectada, responsable_arl_detectado, firma_empresa, firma_practicante, metodo_lectura, confianza',
      ['iniciacion_practicas', 'no_remunerada', 'cun', 'si', 'no', 'ocr', 0.812]).then(
      () => comprobar('un acta válida con remuneración, ARL, firmas y método se acepta', true),
      (e: Error) => comprobar('un acta válida con remuneración, ARL, firmas y método se acepta', false, e.message.slice(0, 160)));

    // Restricciones de la evidencia.
    const evi = (tipo: string, datos: unknown): Promise<unknown> => ds.query(
      `INSERT INTO evidencias_validacion_acta (id, validacion_acta_id, intento, tipo, resultado, metodo, fecha, datos)
       VALUES ($1,$2,9,$3,'x','x',now(),$4)`, [randomUUID(), vB.id, tipo, JSON.stringify(datos)]);
    await rechaza('un tipo de evidencia fuera del catálogo se rechaza', () => evi('inventada', {}), /ck_eacta_tipo/);
    await rechaza('una decisión humana sin actor se rechaza', () => evi('decision_humana', {}), /ck_eacta_decision/);
    await rechaza('el texto del documento no cabe en una evidencia (clave prohibida)', () => evi('lectura_documento', { texto: 'hola' }), /ck_eacta_datos/);
    await rechaza('una imagen de firma no cabe en una evidencia', () => evi('medicion_firmas', { imagen_firma: 'AAAA' }), /ck_eacta_datos/);

    // Privilegios de la aplicación (rol sipra_app): inserta y actualiza validaciones, solo inserta evidencias, nada se borra.
    const comoApp = async (sql: string, params: unknown[] = []): Promise<void> => {
      const qr = ds.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        await qr.query('SET LOCAL ROLE sipra_app');
        await qr.query(sql, params);
      } finally {
        await qr.rollbackTransaction();
        await qr.release();
      }
    };
    await rechaza('sipra_app NO puede borrar validaciones del acta', () => comoApp('DELETE FROM validaciones_acta_iniciacion WHERE id = $1', [vB.id]), /permission denied|permiso denegado/i);
    await rechaza('sipra_app NO puede actualizar evidencias', () => comoApp('UPDATE evidencias_validacion_acta SET resultado = $1', ['x']), /permission denied|permiso denegado/i);
    await rechaza('sipra_app NO puede borrar evidencias', () => comoApp('DELETE FROM evidencias_validacion_acta'), /permission denied|permiso denegado/i);
    await comoApp('UPDATE validaciones_acta_iniciacion SET estado = $1 WHERE id = $2', ['procesando', vB.id]).then(
      () => comprobar('sipra_app SÍ puede actualizar validaciones del acta', true),
      (e: Error) => comprobar('sipra_app SÍ puede actualizar validaciones del acta', false, e.message.slice(0, 160)));

    // Responsable de la ARL en la práctica.
    console.log('\n— Responsable de la ARL de la práctica —');
    const practicas = new PracticaRepositoryAdapter(ds.getRepository(PracticaOrm));
    const original = (await practicas.buscarPorId(practica))!;
    comprobar('una práctica sin el dato (histórica) se lee con responsable de ARL null, sin derivarlo de la modalidad', original.responsableArlPractica === null);
    await rechaza('un responsable de la ARL fuera de empresa/cun se rechaza', () => ds.query(`UPDATE practicas SET responsable_arl = 'otro' WHERE id = $1`, [practica]), /ck_practicas_responsable_arl/);
    const editada = Practica.desde(original.instantanea());
    editada.definirResponsableArl('cun');
    const guardada = await practicas.guardar(editada.instantanea());
    comprobar('guardar la práctica con responsable «cun» lo persiste y lo devuelve', guardada.responsableArlPractica === 'cun' && (await practicas.buscarPorId(practica))!.responsableArlPractica === 'cun');
    comprobar('la remuneración no cambió al definir el responsable de la ARL', guardada.instantanea().tipoRemuneracion === original.instantanea().tipoRemuneracion);

    // ═══ Mesa de Actas (Bloque 4): reserva, decisión única, versión optimista, restricciones, vigencia ═════════════
    {
    console.log('\n— Mesa de Actas: reserva y decisión —');
    const estudianteMesa = randomUUID();
    const practicaMesa = randomUUID();
    await ds.query('INSERT INTO usuarios (id, correo, nombre, rol) VALUES ($1, $2, $3, $4)', [estudianteMesa, `${estudianteMesa}@verificacion.example`, 'Estudiante de la Mesa', 'estudiante']);
    await ds.query(
      `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado)
       VALUES ($1, $2, 'PRG', $3, 'profesional', '2026-2', 'pasantia', 'documentacion')`, [practicaMesa, estudianteMesa, esc]);
    let versionMesa = 0;
    const actaEnRevision = async (practicaId = practicaMesa, estudianteId = estudianteMesa): Promise<{ documentoId: string; validacionId: string }> => {
      const documentoId = randomUUID();
      await ds.query(
        `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento)
         VALUES ($1, $2, 'acta_inicio', $4, 'en_revision', 'a.pdf', 'application/pdf', 10, $3, 'ruta/m')`,
        [documentoId, practicaId, 'd'.repeat(64), (versionMesa += 1)]);
      const nueva = ValidacionActa.pendiente({ id: randomUUID(), documentoId, practicaId, estudianteId, recibidaEn: ahora, ahora });
      const { validacion } = await validacionesActa.crearSiNoExiste(nueva.instantanea());
      const v = ValidacionActa.desde(validacion.instantanea());
      v.iniciarProcesamiento(ahora);
      v.registrarResultado({
        tipoActaDetectada: 'iniciacion_practicas', remuneracionDetectada: 'no_remunerada', responsableArlDetectado: 'empresa', firmaEmpresa: 'si',
        firmaPracticante: 'si', metodoLectura: 'texto', confianza: 0.95, motivosClasificacion: ['sintetico'], datosExtraidos: { campos: {} },
        comparacion: { veredicto: 'revision_necesaria', comparadaEn: ahora.toISOString(), resumen: { coinciden: 1, diferentes: 1, insuficientes: 0, criticas: 1 }, campos: [], discrepancias: [] },
        hayDiscrepanciaCritica: true,
      }, ahora);
      await validacionesActa.guardarSiVersion(v.instantanea(), validacion.version);
      return { documentoId, validacionId: validacion.id };
    };
    const hasta = new Date(ahora.getTime() + 900_000);

    // Reserva atómica: N personas a la vez, una gana.
    const caso1 = await actaEnRevision();
    const personas = Array.from({ length: 25 }, () => randomUUID());
    for (const id of personas) {
      await ds.query('INSERT INTO usuarios (id, correo, nombre, rol) VALUES ($1, $2, $3, $4)', [id, `${id}@verificacion.example`, 'Auxiliar sintético', 'auxiliar']);
    }
    const reservas = await Promise.all(personas.map((p) => validacionesActa.reservar(caso1.validacionId, p, ahora, hasta)));
    comprobar('25 personas reservan el mismo caso a la vez: exactamente una gana', reservas.filter(Boolean).length === 1, String(reservas.filter(Boolean).length));
    const ganador = personas[reservas.findIndex(Boolean)];
    const tomada = (await validacionesActa.buscarPorId(caso1.validacionId))!.instantanea();
    comprobar('la reserva quedó a nombre de quien ganó, con su vencimiento', tomada.asignadoA === ganador && tomada.reservaHasta?.getTime() === hasta.getTime());
    comprobar('quien ya la tiene puede volver a reservarla (renovar); otra persona, no', await validacionesActa.reservar(caso1.validacionId, ganador, ahora, hasta)
      && !(await validacionesActa.reservar(caso1.validacionId, personas.find((p) => p !== ganador) as string, ahora, hasta)));

    // Versión optimista: reservar sube la versión; una escritura con la versión vieja pierde.
    const antes = (await validacionesActa.buscarPorId(caso1.validacionId))!;
    await validacionesActa.liberarReserva(caso1.validacionId, ganador, ahora, false);
    comprobar('con la versión vieja, guardar no aplica (otra persona ya cambió el caso)', !(await validacionesActa.guardarSiVersion(antes.instantanea(), antes.version)));

    // Liberar: la titular, un supervisor o cualquiera si ya venció; ninguna otra persona.
    const caso2 = await actaEnRevision();
    await validacionesActa.reservar(caso2.validacionId, funcionario, ahora, hasta);
    comprobar('otra persona NO libera una reserva vigente ajena', !(await validacionesActa.liberarReserva(caso2.validacionId, funcionario2, ahora, false)));
    comprobar('la titular SÍ libera la suya', await validacionesActa.liberarReserva(caso2.validacionId, funcionario, ahora, false));
    await validacionesActa.reservar(caso2.validacionId, funcionario, ahora, hasta);
    comprobar('un supervisor SÍ libera la de otra persona', await validacionesActa.liberarReserva(caso2.validacionId, funcionario2, ahora, true));
    comprobar('liberar un caso que nadie tiene reservado no hace nada', !(await validacionesActa.liberarReserva(caso2.validacionId, funcionario, ahora, true)));

    // Reserva vencida: otra persona la toma.
    await validacionesActa.reservar(caso2.validacionId, funcionario, ahora, hasta);
    await ds.query(`UPDATE validaciones_acta_iniciacion SET reservado_en = now() - interval '30 minutes', reserva_hasta = now() - interval '15 minutes' WHERE id = $1`, [caso2.validacionId]);
    comprobar('una reserva vencida vuelve a estar disponible para otra persona', await validacionesActa.reservar(caso2.validacionId, funcionario2, new Date(), new Date(Date.now() + 900_000)));

    // Solo un caso en revisión se reserva.
    const pendiente = ValidacionActa.pendiente({ id: randomUUID(), documentoId: await (async () => {
      const d = randomUUID();
      await ds.query(`INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento) VALUES ($1, $2, 'acta_inicio', $4, 'recibido', 'a.pdf', 'application/pdf', 10, $3, 'ruta/p')`, [d, practicaMesa, 'e'.repeat(64), (versionMesa += 1)]);
      return d;
    })(), practicaId: practicaMesa, estudianteId: estudianteMesa, recibidaEn: ahora, ahora });
    await validacionesActa.crearSiNoExiste(pendiente.instantanea());
    comprobar('un acta que todavía no está en revisión (pendiente) no se puede reservar', !(await validacionesActa.reservar(pendiente.instantanea().id, funcionario, ahora, hasta)));

    // Decisión única: el documento y la validación decididos por UNA persona entre muchas.
    console.log('\n— Mesa de Actas: decisión única —');
    const caso3 = await actaEnRevision();
    const original = (await documentos.buscarPorId(caso3.documentoId))!;
    const estadoLeido = original.estado;
    const aplicadas = await Promise.all(Array.from({ length: 10 }, (_, i) => {
      const copia = Documento.desde(original.instantanea());
      copia.aprobar(i % 2 === 0 ? funcionario : funcionario2, 'Decisión simultánea de prueba, justificación suficiente.');
      return documentos.guardarSiEstado(copia.instantanea(), estadoLeido);
    }));
    comprobar('10 decisiones simultáneas sobre el mismo documento: exactamente una se aplica (las demás reciben 409 en el caso de uso)', aplicadas.filter(Boolean).length === 1);
    const leida = (await validacionesActa.buscarPorId(caso3.validacionId))!;
    const decisiones = await Promise.all(Array.from({ length: 10 }, (_, i) => {
      const copia = ValidacionActa.desde(leida.instantanea());
      copia.registrarDecision('aprobar', i % 2 === 0 ? funcionario : funcionario2, ahora);
      return validacionesActa.guardarSiVersion(copia.instantanea(), leida.version);
    }));
    comprobar('10 decisiones simultáneas sobre la validación con la misma versión: exactamente una gana', decisiones.filter(Boolean).length === 1);
    const decidida = (await validacionesActa.buscarPorId(caso3.validacionId))!.instantanea();
    comprobar('la validación quedó decidida UNA vez, con quién y cuándo, y sin reserva', decidida.estado === 'aprobado_manual' && decidida.decididoPor !== null && decidida.decididoEn !== null && decidida.asignadoA === null);

    // Restricciones de la Mesa.
    console.log('\n— Mesa de Actas: restricciones —');
    const caso4 = await actaEnRevision();
    await rechaza('una reserva incompleta (sin vencimiento) se rechaza', () => ds.query(`UPDATE validaciones_acta_iniciacion SET asignado_a = $1 WHERE id = $2`, [funcionario, caso4.validacionId]), /ck_vacta_reserva/);
    await rechaza('una reserva que vence antes de empezar se rechaza', () => ds.query(`UPDATE validaciones_acta_iniciacion SET asignado_a = $1, reservado_en = now(), reserva_hasta = now() - interval '1 minute' WHERE id = $2`, [funcionario, caso4.validacionId]), /ck_vacta_reserva/);
    await rechaza('un caso decidido no puede quedar reservado', () => ds.query(`UPDATE validaciones_acta_iniciacion SET estado = 'devuelto', decidido_por = $1, decidido_en = now(), asignado_a = $1, reservado_en = now(), reserva_hasta = now() + interval '5 minutes' WHERE id = $2`, [funcionario, caso4.validacionId]), /ck_vacta_reserva_solo_revision/);
    await rechaza('un motivo de devolución fuera del catálogo se rechaza', () => ds.query(`UPDATE validaciones_acta_iniciacion SET estado = 'devuelto', decidido_por = $1, decidido_en = now(), motivo_decision = 'porque_si' WHERE id = $2`, [funcionario, caso4.validacionId]), /ck_vacta_motivo/);
    await rechaza('un motivo de devolución solo existe en una devolución', () => ds.query(`UPDATE validaciones_acta_iniciacion SET motivo_decision = 'arl_no_coincide' WHERE id = $1`, [caso4.validacionId]), /ck_vacta_motivo_solo_devuelto/);
    await ds.query(`UPDATE validaciones_acta_iniciacion SET estado = 'devuelto', decidido_por = $1, decidido_en = now(), motivo_decision = 'arl_no_coincide' WHERE id = $2`, [funcionario, caso4.validacionId]).then(
      () => comprobar('una devolución con motivo del catálogo, quién y cuándo se acepta', true),
      (e: Error) => comprobar('una devolución con motivo del catálogo, quién y cuándo se acepta', false, e.message.slice(0, 160)));
    await ds.query(`INSERT INTO evidencias_validacion_acta (id, validacion_acta_id, intento, tipo, resultado, metodo, fecha, actor_id) VALUES ($1,$2,7,'cambio_datos_practica','posterior_a_decision','correccion', now(), $3)`, [randomUUID(), caso4.validacionId, funcionario]).then(
      () => comprobar('la evidencia de cambio de datos de la práctica se acepta (con quién la hizo)', true),
      (e: Error) => comprobar('la evidencia de cambio de datos de la práctica se acepta (con quién la hizo)', false, e.message.slice(0, 160)));
    await rechaza('esa evidencia, como todas, no se puede modificar', () => ds.query(`UPDATE evidencias_validacion_acta SET resultado = 'otro' WHERE validacion_acta_id = $1 AND tipo = 'cambio_datos_practica'`, [caso4.validacionId]), /inmutable|insufficient/i);

    // Vigencia: la bandeja solo trae la última versión del acta de cada práctica, y respeta el alcance.
    console.log('\n— Mesa de Actas: bandeja y supervisión —');
    const estudianteB = randomUUID();
    const practicaB = randomUUID();
    await ds.query('INSERT INTO usuarios (id, correo, nombre, rol) VALUES ($1, $2, $3, $4)', [estudianteB, `${estudianteB}@verificacion.example`, 'Estudiante B', 'estudiante']);
    await ds.query(`INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado) VALUES ($1, $2, 'PRG', $3, 'profesional', '2026-2', 'pasantia', 'documentacion')`, [practicaB, estudianteB, esc]);
    const b1 = await actaEnRevision(practicaB, estudianteB);
    const b2 = await actaEnRevision(practicaB, estudianteB);
    const lista = await validacionesActa.listarMesa({ estados: ['revision' as never], escuelas: null });
    const deB = lista.filter((f) => f.practicaId === practicaB);
    comprobar('con dos versiones del acta, la bandeja trae SOLO la vigente (la última)', deB.length === 1 && deB[0].validacionId === b2.validacionId && deB[0].version > 0);
    comprobar('la versión anterior no aparece en la bandeja', !lista.some((f) => f.validacionId === b1.validacionId));
    comprobar('la fila trae lo necesario para la bandeja (estudiante, discrepancia, veredicto, reserva)', deB[0].estudianteNombre === 'Estudiante B' && deB[0].hayDiscrepanciaCritica && deB[0].veredicto === 'revision_necesaria' && deB[0].asignadoA === null);
    comprobar('con otra escuela en el alcance no se entrega nada de esa práctica', !(await validacionesActa.listarMesa({ estados: ['revision' as never], escuelas: ['no-existe'] })).some((f) => f.practicaId === practicaB));
    await validacionesActa.reservar(b2.validacionId, funcionario, new Date(), new Date(Date.now() + 120_000));
    const sup = await validacionesActa.supervisionMesa(new Date(), null);
    comprobar('la supervisión cuenta abiertas, tomadas, por vencer (reserva de 2 minutos) y por discrepancia crítica', sup.abiertas >= 1 && sup.tomadas >= 1 && sup.porVencer >= 1 && sup.conDiscrepanciaCritica >= 1);
    comprobar('la supervisión agrupa por estado y lista la carga por funcionario', typeof sup.porEstado.revision === 'number' && sup.funcionarios.some((f) => f.funcionarioId === funcionario && f.reservasVigentes >= 1));
    }

    void TipoDocumento;
  } finally {
    await ds.destroy();
  }
  console.log(`\n${fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : `${fallos} COMPROBACIONES FALLARON`}`);
  process.exitCode = fallos === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
