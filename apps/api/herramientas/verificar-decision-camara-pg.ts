/* eslint-disable no-console */
/**
 * Verificación de la decisión humana del certificado de Cámara de Comercio y de su reserva contra un PostgreSQL DESECHABLE.
 *
 * Las pruebas unitarias emulan el bloqueo y la transacción en memoria; aquí se comprueba con las MISMAS sentencias SQL de los
 * adaptadores reales que, con conexiones simultáneas: (a) una reserva tiene UN ganador, (b) una decisión aplica UNA vez, (c) la
 * decisión es transaccional (documento + validación + evidencia + auditoría, o nada) y (d) las restricciones de las migraciones 20 y
 * 21 rechazan los estados incoherentes y admiten los motivos de devolución de la Cámara. Verifica también que la bandeja del RUT
 * y la de la Cámara no se mezclan.
 *
 * Seguridad: se NIEGA a correr si la base no es local. Crea datos sintéticos (prefijo `verif-`) y los deja (las evidencias y la
 * auditoría son inmutables): base desechable. Sin red.
 *
 *   DB_URL=postgres://usuario@127.0.0.1:PUERTO/base npm run test:pg:decision-camara   (tras `npm run migration:run`)
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { ValidacionDocumentoEmpresarial } from '../src/domain/entities/validacion-documento-empresarial.entity';
import { AccionAuditada } from '../src/domain/entities/auditoria.entity';
import { ConflictoDecisionRutError, EntradaDecisionRut } from '../src/domain/services/decision-rut.domain-service';
import { datosCamara } from '../test/soporte-documento-empresarial';
import { DecisionRutPgAdapter, PuntoDecisionRut } from '../src/infrastructure/adapters/persistence/postgres/decision-rut.adapter';
import { ValidacionDocumentoEmpresarialRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/validacion-documento-empresarial.adapter';
import { DocumentoOrm, ENTIDADES_ORM } from '../src/infrastructure/persistence/postgres/entities/todas.orm-entity';
import {
  EvidenciaValidacionDocEmpresarialOrm, ValidacionDocumentoEmpresarialOrm,
} from '../src/infrastructure/persistence/postgres/entities/validacion-documento-empresarial.orm-entity';

const url = process.env.DB_URL?.trim();
if (!url) throw new Error('Defina DB_URL apuntando al PostgreSQL desechable.');
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Se niega a correr: la base no es local. Use una base desechable.');
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

const HASH = 'b'.repeat(64);
const MIN = 60_000;
const TIPOS_CAMARA = [TipoDocumento.CAMARA_COMERCIO];

async function main(): Promise<void> {
  const ds = new DataSource({ type: 'postgres', url, entities: ENTIDADES_ORM, extra: { max: 40 }, ssl: false });
  await ds.initialize();
  try {
    const sufijo = randomUUID().slice(0, 8);
    const esc = `verif-${sufijo}`;
    await ds.query('INSERT INTO cat_escuela (codigo, nombre) VALUES ($1, $2)', [esc, 'Escuela de verificación']);
    const usuario = async (rol: string): Promise<string> => {
      const id = randomUUID();
      await ds.query('INSERT INTO usuarios (id, correo, nombre, rol) VALUES ($1, $2, $3, $4)', [id, `${id}@verificacion.example`, 'Usuario sintético', rol]);
      return id;
    };
    const funcionarios = await Promise.all(Array.from({ length: 25 }, () => usuario('tutor')));
    const supervisor = await usuario('coordinador');
    const [titular, otro] = funcionarios;

    const repo = new ValidacionDocumentoEmpresarialRepositoryAdapter(
      ds.getRepository(ValidacionDocumentoEmpresarialOrm), ds.getRepository(EvidenciaValidacionDocEmpresarialOrm), ds.getRepository(DocumentoOrm),
    );
    const decision = new DecisionRutPgAdapter(ds);

    let version = 0;
    /** Una Cámara en revisión con su documento. Una práctica por caso, salvo que se pida `practicaId` (para probar versiones). */
    const caso = async (opciones: { practicaId?: string; version?: number } = {}): Promise<{ documentoId: string; validacionId: string; practicaId: string }> => {
      const practicaId = opciones.practicaId ?? randomUUID();
      // Un estudiante por práctica (solo se admite una práctica por estudiante y periodo).
      const estudiante = opciones.practicaId
        ? (await ds.query('SELECT estudiante_id FROM practicas WHERE id = $1', [practicaId]))[0].estudiante_id as string
        : await usuario('estudiante');
      if (!opciones.practicaId) {
        await ds.query(
          `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado)
           VALUES ($1, $2, 'PRG', $3, 'profesional', '2026-2', 'pasantia', 'documentacion')`, [practicaId, estudiante, esc],
        );
      }
      const documentoId = randomUUID();
      await ds.query(
        `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento)
         VALUES ($1, $2, 'camara_comercio', $3, 'en_revision', 'camara.pdf', 'application/pdf', 10, $4, 'ruta/x')`,
        [documentoId, practicaId, opciones.version ?? (version += 1), HASH],
      );
      const base = ValidacionDocumentoEmpresarial.pendiente({ id: randomUUID(), documentoId, practicaId, estudianteId: estudiante, tipoEsperado: TipoDocumento.CAMARA_COMERCIO, recibidaEn: new Date(), ahora: new Date() }).instantanea();
      const datos = {
        ...base, estado: 'revision' as never, tipoDetectado: 'camara_existencia_representacion' as never, familiaDocumento: 'camara' as never, tipoPersona: 'juridica' as never,
        expectativa: 'coincide' as never, metodoLectura: 'texto' as never, confianza: 1, hashDocumento: HASH, procesadaEn: new Date(),
        datosExtraidos: datosCamara() as never,
        comparacion: { version: 1, veredicto: 'consistente', campos: [], hayDiscrepancia: false, discrepanciaImportante: false, senales: [], huellaSipra: 'h', calculadaEn: new Date().toISOString() } as never,
      };
      const { validacion } = await repo.crearSiNoExiste(datos);
      return { documentoId, validacionId: validacion.id, practicaId };
    };
    const fila = async (id: string) => (await ds.query('SELECT * FROM validaciones_documento_empresarial WHERE id = $1', [id]))[0];
    const documento = async (id: string) => (await ds.query('SELECT estado, decidido_por FROM documentos WHERE id = $1', [id]))[0];
    const evidencias = async (validacionId: string, tipo: string) => (await ds.query('SELECT count(*)::int AS n FROM evidencias_validacion_doc_empresarial WHERE validacion_id = $1 AND tipo = $2', [validacionId, tipo]))[0].n as number;
    const auditorias = async (entidadId: string, accion: string) => (await ds.query('SELECT count(*)::int AS n FROM auditoria WHERE entidad_id = $1 AND accion = $2', [entidadId, accion]))[0].n as number;
    const entrada = (actorId: string, ahora: Date, sobre: Partial<EntradaDecisionRut> = {}): EntradaDecisionRut => ({
      decision: 'aprobar', justificacion: 'Certificado de Cámara revisado y aprobado', motivo: null, ahora, contextoAuditoria: { origen: 'verificacion' },
      nombreDocumento: 'certificado de Cámara', accionContexto: AccionAuditada.DECISION_CAMARA, tiposPermitidos: TIPOS_CAMARA,
      actor: { id: actorId, correo: `${actorId}@verificacion.example`, rol: 'tutor' }, ...sobre,
    });

    // ── 1. Reserva: UN ganador entre 25 conexiones simultáneas ────────────────
    console.log('— Reserva concurrente —');
    const ahora = new Date();
    const hasta = new Date(ahora.getTime() + 15 * MIN);
    const c1 = await caso();
    const r = await Promise.all(funcionarios.map((f) => repo.reservar(c1.validacionId, f, ahora, hasta)));
    comprobar('25 personas reservan el mismo caso a la vez: exactamente UNA gana', r.filter(Boolean).length === 1, String(r.filter(Boolean).length));
    const f1 = await fila(c1.validacionId);
    comprobar('la reserva queda a nombre del ganador, con 15 minutos, y el caso sigue en revisión', f1.estado === 'revision' && funcionarios.includes(f1.asignado_a) && f1.reserva_hasta.getTime() === hasta.getTime());
    const ganador = f1.asignado_a as string;
    const perdedor = funcionarios.find((f) => f !== ganador) as string;
    comprobar('quien ya la tiene la renueva (idempotente para el titular)', await repo.reservar(c1.validacionId, ganador, new Date(ahora.getTime() + MIN), new Date(hasta.getTime() + MIN)));
    comprobar('otra persona no la toma mientras esté vigente', !(await repo.reservar(c1.validacionId, perdedor, new Date(ahora.getTime() + 2 * MIN), hasta)));
    comprobar('otra persona sí la toma una vez vencida', await repo.reservar(c1.validacionId, perdedor, new Date(hasta.getTime() + 2 * MIN), new Date(hasta.getTime() + 20 * MIN)));

    console.log('\n— Liberar —');
    const c2 = await caso();
    await repo.reservar(c2.validacionId, titular, ahora, hasta);
    comprobar('otra persona NO libera una reserva vigente', !(await repo.liberarReserva(c2.validacionId, otro, ahora, false)));
    comprobar('el titular la libera', await repo.liberarReserva(c2.validacionId, titular, ahora, false));
    comprobar('liberar un caso sin reserva no hace nada', !(await repo.liberarReserva(c2.validacionId, titular, ahora, false)));
    await repo.reservar(c2.validacionId, titular, ahora, hasta);
    comprobar('un supervisor libera la reserva de otra persona', await repo.liberarReserva(c2.validacionId, supervisor, ahora, true));
    await repo.reservar(c2.validacionId, titular, ahora, hasta);
    comprobar('cualquiera libera una reserva ya vencida', await repo.liberarReserva(c2.validacionId, otro, new Date(hasta.getTime() + MIN), false));
    const noRevisable = await caso();
    await ds.query(`UPDATE validaciones_documento_empresarial SET estado = 'error', error_codigo = 'X' WHERE id = $1`, [noRevisable.validacionId]);
    comprobar('un caso que no está en revisión no se reserva', !(await repo.reservar(noRevisable.validacionId, titular, ahora, hasta)));

    // ── 2. Decisión: UNA entre 12 simultáneas ─────────────────────────────────
    console.log('\n— Decisión concurrente y transaccional —');
    const c3 = await caso();
    await repo.reservar(c3.validacionId, titular, ahora, hasta);
    const resultados = await Promise.allSettled(Array.from({ length: 12 }, () => decision.aplicar(c3.validacionId, entrada(titular, ahora))));
    const aplicadas = resultados.filter((x) => x.status === 'fulfilled').length;
    const rechazadas = resultados.filter((x) => x.status === 'rejected' && x.reason instanceof ConflictoDecisionRutError);
    comprobar('12 decisiones simultáneas sobre el mismo caso: exactamente UNA aplica', aplicadas === 1, String(aplicadas));
    comprobar('las otras 11 reciben un conflicto controlado (409), no un error', rechazadas.length === 11, `${rechazadas.length} ${JSON.stringify(resultados.filter((x) => x.status === 'rejected' && !(x.reason instanceof ConflictoDecisionRutError)).map((x) => (x as PromiseRejectedResult).reason?.message).slice(0, 2))}`);
    const f3 = await fila(c3.validacionId);
    comprobar('la validación quedó aprobada por quien decidió, con fecha, sin reserva', f3.estado === 'aprobado_manual' && f3.decidido_por === titular && f3.decidido_en !== null && f3.asignado_a === null && f3.reserva_hasta === null);
    comprobar('el documento quedó aprobado por la misma persona', (await documento(c3.documentoId)).estado === 'aprobado' && (await documento(c3.documentoId)).decidido_por === titular);
    comprobar('hay UNA evidencia de decisión humana y UNA auditoría de cada tipo (no se duplicó nada)',
      (await evidencias(c3.validacionId, 'decision_humana')) === 1 && (await auditorias(c3.validacionId, 'decision_camara')) === 1 && (await auditorias(c3.documentoId, 'decision_documento')) === 1);
    await rechaza('un reintento tras el commit no decide otra vez (ya decidida)', () => decision.aplicar(c3.validacionId, entrada(titular, ahora)), /ya fue decidido/);

    console.log('\n— Decisiones contradictorias simultáneas, y reserva ajena —');
    const c4 = await caso();
    await repo.reservar(c4.validacionId, titular, ahora, hasta);
    const mixtas = await Promise.allSettled([
      decision.aplicar(c4.validacionId, entrada(titular, ahora)),
      decision.aplicar(c4.validacionId, entrada(titular, ahora, { decision: 'devolver', motivo: 'documento_ilegible', justificacion: 'El documento cargado no se puede leer con claridad.' })),
      decision.aplicar(c4.validacionId, entrada(titular, ahora, { decision: 'rechazar', justificacion: 'No corresponde al estudiante de la práctica.' })),
    ]);
    comprobar('aprobar, devolver y rechazar a la vez: gana UNA', mixtas.filter((x) => x.status === 'fulfilled').length === 1);
    const f4 = await fila(c4.validacionId);
    comprobar('la decisión del ganador es coherente entre documento y validación', (f4.estado === 'aprobado_manual' && (await documento(c4.documentoId)).estado === 'aprobado')
      || (f4.estado === 'devuelto' && f4.motivo_decision === 'documento_ilegible' && (await documento(c4.documentoId)).estado === 'devuelto')
      || (f4.estado === 'rechazado' && (await documento(c4.documentoId)).estado === 'rechazado'));
    const c5 = await caso();
    await repo.reservar(c5.validacionId, titular, ahora, hasta);
    await rechaza('quien NO tiene la reserva no decide (409)', () => decision.aplicar(c5.validacionId, entrada(otro, ahora)), /reserva/i);
    await rechaza('con la reserva vencida no se decide', () => decision.aplicar(c5.validacionId, entrada(titular, new Date(hasta.getTime() + MIN))), /reserva/i);
    comprobar('nada cambió en el caso rechazado', (await fila(c5.validacionId)).estado === 'revision' && (await documento(c5.documentoId)).estado === 'en_revision');

    // ── 3. Rollback completo ──────────────────────────────────────────────────
    console.log('\n— Rollback completo si la operación se interrumpe —');
    for (const punto of ['tras_documento', 'tras_validacion', 'tras_evidencia', 'tras_auditoria_documento'] as PuntoDecisionRut[]) {
      const c = await caso();
      await repo.reservar(c.validacionId, titular, ahora, hasta);
      decision.alPunto = (p) => { if (p === punto) throw new Error('interrupción simulada'); };
      await rechaza(`la operación se interrumpe en «${punto}»`, () => decision.aplicar(c.validacionId, entrada(titular, ahora)), /interrupción simulada/);
      decision.alPunto = undefined;
      const f = await fila(c.validacionId);
      comprobar(`  · «${punto}»: el documento y la validación siguen como estaban, con su reserva`,
        (await documento(c.documentoId)).estado === 'en_revision' && (await documento(c.documentoId)).decidido_por === null && f.estado === 'revision' && f.decidido_por === null && f.asignado_a === titular);
      comprobar(`  · «${punto}»: no quedó ni evidencia ni auditoría`,
        (await evidencias(c.validacionId, 'decision_humana')) === 0 && (await auditorias(c.validacionId, 'decision_camara')) === 0 && (await auditorias(c.documentoId, 'decision_documento')) === 0);
      await decision.aplicar(c.validacionId, entrada(titular, ahora));
      comprobar(`  · «${punto}»: el reintento sin tocar nada a mano decide el caso`, (await fila(c.validacionId)).estado === 'aprobado_manual');
    }

    // ── 4. Versiones ──────────────────────────────────────────────────────────
    console.log('\n— Versiones: reenvío —');
    const pv = await caso({ version: (version += 1) });
    const v1 = pv;
    const v2 = await caso({ practicaId: pv.practicaId, version: (version += 1) });
    comprobar('la versión máxima de la práctica es la del reenvío', (await repo.versionMaximaDocumento(pv.practicaId, 'camara_comercio')) === await ds.query('SELECT version FROM documentos WHERE id = $1', [v2.documentoId]).then((x) => x[0].version));
    await repo.reservar(v1.validacionId, titular, ahora, hasta);
    await rechaza('una versión vieja NO se decide aunque siga en revisión', () => decision.aplicar(v1.validacionId, entrada(titular, ahora)), /versión más reciente/);
    const bandeja = (await repo.listarMesaRut({ tipos: TIPOS_CAMARA, estados: ['revision'], escuelas: [esc] })).filter((x) => x.practicaId === pv.practicaId);
    comprobar('la bandeja lista SOLO la versión vigente de la práctica', bandeja.length === 1 && bandeja[0].validacionId === v2.validacionId, JSON.stringify(bandeja.map((b) => b.version)));
    comprobar('la bandeja respeta el alcance por escuela (otra escuela: nada; lista vacía: nada)',
      (await repo.listarMesaRut({ tipos: TIPOS_CAMARA, estados: ['revision'], escuelas: ['otra-escuela'] })).length === 0 && (await repo.listarMesaRut({ tipos: TIPOS_CAMARA, estados: ['revision'], escuelas: [] })).length === 0);
    const sup = await repo.supervisionRut(new Date(), [esc], TIPOS_CAMARA);
    comprobar('la supervisión cuenta lo abierto, lo libre y lo tomado de la escuela', sup.abiertas >= 3 && sup.tomadas >= 1 && sup.abiertas === sup.libres + sup.tomadas + sup.vencidas - sup.vencidas, JSON.stringify(sup));

    // ── 4b. La bandeja del RUT y la de la Cámara no se mezclan ────────────────
    console.log('\n— Bandejas separadas —');
    const delRut = await repo.listarMesaRut({ estados: ['revision', 'aprobado_manual', 'devuelto', 'rechazado'], escuelas: [esc] });
    comprobar('la bandeja del RUT (tipos por defecto) no lista ninguna Cámara', delRut.length === 0, String(delRut.length));
    const supRut = await repo.supervisionRut(new Date(), [esc]);
    comprobar('la supervisión del RUT no cuenta ninguna Cámara', supRut.abiertas === 0 && Object.keys(supRut.porEstado).length === 0, JSON.stringify(supRut));
    const fm = (await repo.listarMesaRut({ tipos: TIPOS_CAMARA, estados: ['revision'], escuelas: [esc] }))[0];
    comprobar('la fila de la bandeja trae modalidad, método de lectura y las señales de la Cámara', fm.modalidad === 'pasantia' && fm.metodoLectura === 'texto' && fm.discrepanciaImportante === false && fm.estadoCancelado === false, JSON.stringify(fm).slice(0, 200));
    await ds.query(`UPDATE validaciones_documento_empresarial SET comparacion = comparacion || '{"discrepanciaImportante": true, "senales": ["estado_registral_cancelado"]}'::jsonb WHERE id = $1`, [fm.validacionId]);
    const fs2 = (await repo.listarMesaRut({ tipos: TIPOS_CAMARA, estados: ['revision'], escuelas: [esc] })).find((x) => x.validacionId === fm.validacionId)!;
    comprobar('la bandeja lee del JSON la discrepancia importante y la matrícula cancelada', fs2.discrepanciaImportante === true && fs2.estadoCancelado === true);
    await rechaza('el tipo documental de la bandeja solo admite minúsculas y guion bajo (sin inyección)', () => repo.listarMesaRut({ tipos: ["x'); DROP TABLE documentos; --"], estados: ['revision'], escuelas: null }), /no válido/);

    // ── 5. Restricciones de las migraciones 20 y 21 ───────────────────────────
    console.log('\n— Restricciones de la base —');
    const c6 = await caso();
    const set = (sql: string, params: unknown[] = []) => () => ds.query(`UPDATE validaciones_documento_empresarial SET ${sql} WHERE id = $1`, [c6.validacionId, ...params]);
    await rechaza('aprobado sin quién ni cuándo', set(`estado = 'aprobado_manual'`), /ck_vdemp_decision_humana/);
    await rechaza('quién y cuándo en un caso que no está decidido', set('decidido_por = $2, decidido_en = now()', [titular]), /ck_vdemp_decidido_solo_terminal/);
    await rechaza('reserva incompleta (titular sin vencimiento)', set('asignado_a = $2', [titular]), /ck_vdemp_reserva/);
    await rechaza('reserva que vence antes de empezar', set(`asignado_a = $2, reservado_en = now(), reserva_hasta = now() - interval '1 minute'`, [titular]), /ck_vdemp_reserva/);
    await rechaza('devuelto sin motivo', set(`estado = 'devuelto', decidido_por = $2, decidido_en = now()`, [titular]), /ck_vdemp_devuelto_con_motivo/);
    await rechaza('motivo fuera del catálogo', set(`motivo_decision = 'porque_si'`), /ck_vdemp_motivo/);
    for (const motivo of ['tipo_certificado_incorrecto', 'representante_no_coincide', 'matricula_cancelada']) {
      const cm = await caso();
      await repo.reservar(cm.validacionId, titular, ahora, hasta);
      await decision.aplicar(cm.validacionId, entrada(titular, ahora, { decision: 'devolver', motivo, justificacion: 'Debe cargar el certificado correcto de la Cámara.' }));
      comprobar(`el motivo de devolución de la Cámara «${motivo}» se acepta (migración 21)`, (await fila(cm.validacionId)).motivo_decision === motivo && (await documento(cm.documentoId)).estado === 'devuelto');
    }
    await rechaza('motivo en un caso que no está devuelto', set(`motivo_decision = 'otro'`), /ck_vdemp_motivo_solo_devuelto/);
    await rechaza('constancia de cambio de datos de SIPRA en un caso abierto', set('datos_sipra_cambiaron_en = now()'), /ck_vdemp_cambio_solo_decidida/);
    await rechaza('estado fuera del catálogo (autoaprobado no existe)', set(`estado = 'autoaprobado'`), /ck_vdemp_estado/);
    await rechaza('una decisión por un usuario que no existe', set(`estado = 'aprobado_manual', decidido_por = $2, decidido_en = now()`, [randomUUID()]), /foreign key|violates/i);
    const c7 = await caso();
    await repo.reservar(c7.validacionId, titular, ahora, hasta);
    await decision.aplicar(c7.validacionId, entrada(titular, ahora));
    await rechaza('un caso decidido no puede quedar reservado', () => ds.query(`UPDATE validaciones_documento_empresarial SET asignado_a = $2, reservado_en = now(), reserva_hasta = now() + interval '5 minutes' WHERE id = $1`, [c7.validacionId, titular]), /ck_vdemp_reserva_solo_revision/);
    comprobar('un caso decidido sí admite la constancia de cambio de datos de SIPRA',
      await ds.query('UPDATE validaciones_documento_empresarial SET datos_sipra_cambiaron_en = now() WHERE id = $1', [c7.validacionId]).then(() => true, () => false));
    comprobar('y el nuevo tipo de evidencia «cambio_datos_sipra» se acepta',
      await ds.query(`INSERT INTO evidencias_validacion_doc_empresarial (id, validacion_id, intento, tipo, resultado, metodo, fecha) VALUES ($1,$2,99,'cambio_datos_sipra','datos_sipra_cambiaron','m',now())`, [randomUUID(), c7.validacionId]).then(() => true, () => false));
    await rechaza('una evidencia de decisión no se actualiza (disparador)', () => ds.query(`UPDATE evidencias_validacion_doc_empresarial SET resultado = 'rechazar' WHERE validacion_id = $1 AND tipo = 'decision_humana'`, [c7.validacionId]), /inmutable|no se permite|append|actualiz/i);
    await rechaza('una evidencia de decisión no se borra (disparador)', () => ds.query(`DELETE FROM evidencias_validacion_doc_empresarial WHERE validacion_id = $1 AND tipo = 'decision_humana'`, [c7.validacionId]), /inmutable|no se permite|append|borr/i);
    await rechaza('la auditoría de la decisión no se actualiza', () => ds.query(`UPDATE auditoria SET accion = 'otra' WHERE entidad_id = $1`, [c7.validacionId]), /inmutable|no se permite|append|actualiz/i);
    await rechaza('la auditoría de la decisión no se borra', () => ds.query(`DELETE FROM auditoria WHERE entidad_id = $1`, [c7.validacionId]), /inmutable|no se permite|append|borr/i);
    const e = (await ds.query(`SELECT datos FROM evidencias_validacion_doc_empresarial WHERE validacion_id = $1 AND tipo = 'decision_humana'`, [c7.validacionId]))[0];
    comprobar('la evidencia de la decisión lleva rol, acción, motivo y justificación, sin datos del documento', JSON.stringify(Object.keys(e.datos).sort()) === JSON.stringify(['accion', 'justificacion', 'motivo', 'rol']) && !/1000000001/.test(JSON.stringify(e)));
  } finally {
    await ds.destroy();
  }
  console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}`);
  process.exit(fallos === 0 ? 0 : 1);
}

void main();
