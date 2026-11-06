/* eslint-disable no-console */
/**
 * Verificación de la persistencia de documentos empresariales (RUT y Cámara) contra un PostgreSQL DESECHABLE.
 *
 * Comprueba con el SQL real de la migración 1756000019000 y del adaptador:
 *  · cada CHECK rechaza lo que debe (incoherencia familia/persona, datos con claves prohibidas o «vigencia»,
 *    representante legal en una matrícula de persona natural, «verificada» sin fuente, hash inválido…);
 *  · una sola validación por documento y evidencias idempotentes, de solo inserción (disparador) y sin DELETE para la app;
 *  · compare-and-set por versión y detección de duplicados por SHA-256.
 *
 * Seguridad: se NIEGA a correr si la base no es local. Crea datos sintéticos (prefijo `verif-`) y los deja: las
 * evidencias son inmutables, así que la base se descarta al terminar.
 *
 * Uso (tras `npm run migration:run` contra esa misma base):
 *   DB_URL=postgres://usuario@127.0.0.1:PUERTO/base npm run test:pg:empresarial
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ValidacionCamaraUseCase } from '../src/application/use-cases/documentos/validacion-camara.use-case';
import { BandaPuntaje, DatosDocumento, Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { GeometriaDocumentoPort } from '../src/domain/ports/out/geometria-documento.port';
import { LectorDocumentoLocalPort } from '../src/domain/ports/out/lector-documento-local.port';
import { LecturaLocalCamaraService } from '../src/domain/services/lectura-local-camara.domain-service';
import { paginasCamaraExistencia } from '../test/soporte-camara-sintetico';
import { DataSource } from 'typeorm';
import {
  ClasificacionDocumentoEmpresarial as C, EstadoValidacionDocumentoEmpresarial as Estado, TipoPersona,
} from '../src/domain/entities/documento-empresarial';
import {
  EvidenciaDocumentoEmpresarial, TipoEvidenciaDocumentoEmpresarial, ValidacionDocumentoEmpresarial,
} from '../src/domain/entities/validacion-documento-empresarial.entity';
import { ValidacionDocumentoEmpresarialRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/validacion-documento-empresarial.adapter';
import { DocumentoOrm, ENTIDADES_ORM } from '../src/infrastructure/persistence/postgres/entities/todas.orm-entity';
import {
  EvidenciaValidacionDocEmpresarialOrm, ValidacionDocumentoEmpresarialOrm,
} from '../src/infrastructure/persistence/postgres/entities/validacion-documento-empresarial.orm-entity';

const url = process.env.DB_URL?.trim();
if (!url) throw new Error('Defina DB_URL apuntando al PostgreSQL desechable.');
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
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
    comprobar(descripcion, patron.test(mensaje), mensaje.slice(0, 200));
  }
}

const HASH = 'a'.repeat(64);

async function main(): Promise<void> {
  const ds = new DataSource({ type: 'postgres', url, entities: ENTIDADES_ORM, ssl: false });
  await ds.initialize();
  try {
    const sufijo = randomUUID().slice(0, 8);
    const estudiante = randomUUID();
    const practica = randomUUID();
    const esc = `verif-${sufijo}`;
    await ds.query('INSERT INTO cat_escuela (codigo, nombre) VALUES ($1, $2)', [esc, 'Escuela de verificación']);
    await ds.query('INSERT INTO usuarios (id, correo, nombre, rol) VALUES ($1, $2, $3, $4)', [estudiante, `${estudiante}@verificacion.example`, 'Usuario sintético', 'estudiante']);
    await ds.query(
      `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado)
       VALUES ($1, $2, 'PRG', $3, 'profesional', '2026-2', 'cunbre_naciente', 'documentacion')`,
      [practica, estudiante, esc],
    );
    let version = 0;
    const nuevoDocumento = async (tipo = 'rut_natural', hash = HASH): Promise<string> => {
      const id = randomUUID();
      await ds.query(
        `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento)
         VALUES ($1, $2, $3, $4, 'recibido', 'x.pdf', 'application/pdf', 10, $5, 'ruta/x')`,
        [id, practica, tipo, (version += 1), hash],
      );
      return id;
    };

    /** Inserta una fila cruda para probar los CHECK (cada intento en su propia transacción: no contamina). */
    const insertar = async (sobre: Record<string, unknown>): Promise<void> => {
      const documento = await nuevoDocumento(`rut_natural`, randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 32));
      const fila: Record<string, unknown> = {
        id: randomUUID(), documento_id: documento, practica_id: practica, estudiante_id: estudiante, estado: 'pendiente', ...sobre,
      };
      const columnas = Object.keys(fila);
      const valores = columnas.map((c) => (fila[c] !== null && typeof fila[c] === 'object' ? JSON.stringify(fila[c]) : fila[c]));
      await ds.query(`INSERT INTO validaciones_documento_empresarial (${columnas.join(',')}) VALUES (${columnas.map((_, i) => `$${i + 1}`).join(',')})`, valores);
    };
    const revision = (sobre: Record<string, unknown>) => ({
      estado: 'revision', tipo_detectado: 'rut_persona_natural', familia_documento: 'rut', tipo_persona: 'natural', hash_documento: HASH,
      procesada_en: new Date(), ...sobre,
    });

    console.log('— Restricciones de la validación —');
    await insertar({});
    comprobar('una validación pendiente, sin clasificación, se acepta (los documentos históricos no tienen fila)', true);
    await insertar(revision({ datos_extraidos: { tipoPersona: 'natural', nit: '1000000001', dv: '9' } }));
    comprobar('un RUT de persona natural leído y en revisión se acepta', true);
    await insertar(revision({ tipo_detectado: 'camara_matricula_persona_natural', familia_documento: 'camara', tipo_persona: 'natural', datos_extraidos: { tipoPersona: 'natural', representanteLegal: null } }));
    comprobar('una matrícula de persona natural sin representante se acepta', true);

    await rechaza('persona incoherente con la clasificación (RUT natural con persona jurídica)', () => insertar(revision({ tipo_persona: 'juridica' })), /ck_vdemp_persona_coherente/);
    await rechaza('familia incoherente con la clasificación (RUT con familia cámara)', () => insertar(revision({ familia_documento: 'camara' })), /ck_vdemp_familia_coherente/);
    await rechaza('un documento incorrecto con datos extraídos', () => insertar(revision({ tipo_detectado: 'documento_incorrecto', familia_documento: null, tipo_persona: null, datos_extraidos: { tipoPersona: 'natural' } })), /ck_vdemp_sin_contenido/);
    await rechaza('un documento no determinable con comparación', () => insertar(revision({ tipo_detectado: 'no_determinable', familia_documento: null, tipo_persona: null, comparacion: { campos: [] } })), /ck_vdemp_sin_contenido/);
    await rechaza('datos con dirección', () => insertar(revision({ datos_extraidos: { tipoPersona: 'natural', direccion: 'CALLE X' } })), /ck_vdemp_datos/);
    await rechaza('datos con correo', () => insertar(revision({ datos_extraidos: { tipoPersona: 'natural', correo: 'a@b.c' } })), /ck_vdemp_datos/);
    await rechaza('datos con teléfono', () => insertar(revision({ datos_extraidos: { tipoPersona: 'natural', telefono: '1' } })), /ck_vdemp_datos/);
    await rechaza('datos con responsabilidades', () => insertar(revision({ datos_extraidos: { tipoPersona: 'natural', responsabilidades: ['05'] } })), /ck_vdemp_datos/);
    await rechaza('datos con texto OCR', () => insertar(revision({ datos_extraidos: { tipoPersona: 'natural', texto_ocr: '…' } })), /ck_vdemp_datos/);
    await rechaza('una bandera de vigencia del RUT en los datos', () => insertar(revision({ datos_extraidos: { tipoPersona: 'natural', vigente: false } })), /ck_vdemp_datos/);
    await rechaza('«rutNoVigente» en los datos', () => insertar(revision({ datos_extraidos: { tipoPersona: 'natural', rutNoVigente: true } })), /ck_vdemp_datos/);
    await rechaza('datos de otra persona que la clasificación', () => insertar(revision({ datos_extraidos: { tipoPersona: 'juridica' } })), /ck_vdemp_datos_persona/);
    await rechaza('matrícula de persona natural CON representante legal', () => insertar(revision({ tipo_detectado: 'camara_matricula_persona_natural', familia_documento: 'camara', tipo_persona: 'natural', datos_extraidos: { tipoPersona: 'natural', representanteLegal: 'ALGUIEN' } })), /ck_vdemp_pn_sin_representante/);
    await rechaza('«verificada» sin fuente', () => insertar(revision({ autenticidad_estado: 'verificada', autenticidad: { estado: 'verificada', fuente: null } })), /ck_vdemp_verificada_con_fuente/);
    await rechaza('firma de PDF «válida» sin fuente', () => insertar(revision({ autenticidad: { estado: 'no_verificable', fuente: null, firmaPdfValida: true } })), /ck_vdemp_verificada_con_fuente/);
    await insertar(revision({ autenticidad_estado: 'verificada', autenticidad: { estado: 'verificada', fuente: 'consulta_oficial' } }));
    comprobar('«verificada» CON fuente se acepta (lo hará un bloque posterior)', true);
    await rechaza('autenticidad con estado distinto al de la columna', () => insertar(revision({ autenticidad_estado: 'no_verificable', autenticidad: { estado: 'invalida', fuente: null } })), /ck_vdemp_autenticidad_json/);
    await rechaza('estado de autenticidad fuera del catálogo', () => insertar(revision({ autenticidad_estado: 'valida', autenticidad: { estado: 'valida', fuente: null } })), /ck_vdemp_autenticidad_estado/);
    await rechaza('en revisión sin hash del documento', () => insertar(revision({ hash_documento: null })), /ck_vdemp_revision_completa/);
    await rechaza('hash que no es SHA-256', () => insertar(revision({ hash_documento: 'x'.repeat(64) })), /ck_vdemp_hash/);
    await rechaza('estado de error sin código de error', () => insertar({ estado: 'error' }), /ck_vdemp_error/);
    // Desde la migración 20 los estados de decisión existen, pero nunca sin quién y cuándo decidió.
    await rechaza('estado de decisión humana sin quién ni cuándo', () => insertar(revision({ estado: 'aprobado_manual' })), /ck_vdemp_decision_humana/);
    await rechaza('estado fuera del catálogo', () => insertar({ estado: 'autoaprobado' }), /ck_vdemp_estado/);
    await rechaza('clasificación fuera del catálogo', () => insertar(revision({ tipo_detectado: 'rut_vencido' })), /ck_vdemp_(tipo_detectado|persona_coherente)/);
    await rechaza('pendiente con clasificación', () => insertar({ estado: 'pendiente', tipo_detectado: 'rut_persona_natural', familia_documento: 'rut', tipo_persona: 'natural' }), /ck_vdemp_pendiente_sin_clasificar/);

    console.log('\n— Adaptador: una validación por documento, versión y evidencias —');
    const repo = new ValidacionDocumentoEmpresarialRepositoryAdapter(
      ds.getRepository(ValidacionDocumentoEmpresarialOrm), ds.getRepository(EvidenciaValidacionDocEmpresarialOrm), ds.getRepository(DocumentoOrm),
    );
    const ahora = new Date();
    const documento = await nuevoDocumento('rut_juridico', 'c'.repeat(64));
    const base = ValidacionDocumentoEmpresarial.pendiente({ id: randomUUID(), documentoId: documento, practicaId: practica, estudianteId: estudiante, tipoEsperado: 'rut_juridico', recibidaEn: ahora, ahora });
    const carrera = await Promise.all(Array.from({ length: 12 }, () => repo.crearSiNoExiste(base.instantanea())));
    comprobar('12 creaciones simultáneas: exactamente UNA crea', carrera.filter((r) => r.creada).length === 1, String(carrera.filter((r) => r.creada).length));
    const [{ n }] = await ds.query('SELECT count(*)::int AS n FROM validaciones_documento_empresarial WHERE documento_id = $1', [documento]);
    comprobar('queda una sola fila por documento', n === 1, String(n));

    const v = (await repo.buscarPorDocumento(documento))!;
    v.iniciarProcesamiento(ahora);
    comprobar('compare-and-set: la primera escritura con la versión esperada gana', await repo.guardarSiVersion(v.instantanea(), 1));
    comprobar('…y la segunda, con la versión vieja, pierde', !(await repo.guardarSiVersion(v.instantanea(), 1)));
    const v2 = (await repo.buscarPorDocumento(documento))!;
    comprobar('la versión de la fila subió', v2.version === 2 && v2.estado === Estado.PROCESANDO, `${v2.version}/${v2.estado}`);
    v2.registrarResultado({
      tipoDetectado: C.RUT_PERSONA_JURIDICA, expectativa: 'coincide', metodoLectura: 'texto', confianza: 0.987, lecturaDudosa: false, hashDocumento: 'c'.repeat(64),
      datosExtraidos: { tipoPersona: TipoPersona.JURIDICA, nit: '900123456', dv: '7', fechaGeneracion: '2024-03-15', razonSocial: 'ACME DEMOSTRACION' }, comparacion: { campos: [{ campo: 'nit', resultado: 'coincide' }], hayDiscrepancia: false },
    }, ahora);
    comprobar('el resultado se guarda y la autenticidad queda no_verificable', await repo.guardarSiVersion(v2.instantanea(), 2));
    const leida = (await repo.buscarPorDocumento(documento))!.instantanea();
    comprobar('lo leído de la base coincide con lo escrito', leida.tipoDetectado === C.RUT_PERSONA_JURIDICA && leida.familiaDocumento === 'rut' && leida.tipoPersona === 'juridica' && leida.confianza === 0.987
      && leida.estado === Estado.REVISION && leida.autenticidad.estado === 'no_verificable', JSON.stringify(leida.autenticidad));

    const evidencia = EvidenciaDocumentoEmpresarial.crear({
      id: randomUUID(), validacionId: leida.id, intento: leida.intentos, tipo: TipoEvidenciaDocumentoEmpresarial.CLASIFICACION, resultado: 'rut_persona_juridica',
      metodo: 'clasificacion_por_contenido', fecha: ahora, actorId: null, hashDocumento: 'c'.repeat(64), datos: { motivos: ['rut_titulo'] }, errorCodigo: null, creadoEn: ahora,
    }).instantanea();
    comprobar('una evidencia se inserta', await repo.agregarEvidencia(evidencia));
    comprobar('repetirla (misma validación, intento y tipo) NO la duplica', !(await repo.agregarEvidencia({ ...evidencia, id: randomUUID() })));
    comprobar('se lista una sola', (await repo.listarEvidencias(leida.id)).length === 1);

    await rechaza('una evidencia no se actualiza (disparador)', () => ds.query('UPDATE evidencias_validacion_doc_empresarial SET resultado = $1 WHERE validacion_id = $2', ['x', leida.id]), /inmutable|no se permite|append|actualiz/i);
    await rechaza('una evidencia no se borra (disparador)', () => ds.query('DELETE FROM evidencias_validacion_doc_empresarial WHERE validacion_id = $1', [leida.id]), /inmutable|no se permite|append|borr/i);
    await rechaza('una evidencia con texto OCR', () => ds.query(`INSERT INTO evidencias_validacion_doc_empresarial (id, validacion_id, intento, tipo, resultado, metodo, fecha, datos) VALUES ($1,$2,9,'lectura_documento','x','m',now(),'{"texto_ocr":"…"}')`, [randomUUID(), leida.id]), /ck_edemp_datos/);
    await rechaza('una evidencia con cookie', () => ds.query(`INSERT INTO evidencias_validacion_doc_empresarial (id, validacion_id, intento, tipo, resultado, metodo, fecha, datos) VALUES ($1,$2,9,'lectura_documento','x','m',now(),'{"cookie":"a=b"}')`, [randomUUID(), leida.id]), /ck_edemp_datos/);
    await rechaza('una decisión humana sin actor', () => ds.query(`INSERT INTO evidencias_validacion_doc_empresarial (id, validacion_id, intento, tipo, resultado, metodo, fecha) VALUES ($1,$2,9,'decision_humana','x','m',now())`, [randomUUID(), leida.id]), /ck_edemp_decision/);
    await rechaza('una evidencia con hash inválido', () => ds.query(`INSERT INTO evidencias_validacion_doc_empresarial (id, validacion_id, intento, tipo, resultado, metodo, fecha, hash_documento) VALUES ($1,$2,9,'comparacion','x','m',now(),'zz')`, [randomUUID(), leida.id]), /ck_edemp_hash/);

    console.log('\n— Mínimo privilegio (rol de la aplicación) —');
    await rechaza('la aplicación no borra validaciones', async () => {
      const q = ds.createQueryRunner();
      await q.connect();
      try { await q.query('SET ROLE sipra_app'); await q.query('DELETE FROM validaciones_documento_empresarial WHERE id = $1', [leida.id]); } finally { await q.query('RESET ROLE').catch(() => undefined); await q.release(); }
    }, /permiso denegado|permission denied/i);
    await rechaza('la aplicación no actualiza evidencias (ni por permisos)', async () => {
      const q = ds.createQueryRunner();
      await q.connect();
      try { await q.query('SET ROLE sipra_app'); await q.query('UPDATE evidencias_validacion_doc_empresarial SET resultado = $1 WHERE validacion_id = $2', ['x', leida.id]); } finally { await q.query('RESET ROLE').catch(() => undefined); await q.release(); }
    }, /permiso denegado|permission denied/i);

    console.log('\n— Duplicados por SHA-256 (misma práctica, mismo tipo) —');
    const hashDup = 'd'.repeat(64);
    const original = await nuevoDocumento('camara_comercio', hashDup);
    const copia = await nuevoDocumento('camara_comercio', hashDup);
    const otroTipo = await nuevoDocumento('rut_juridico', hashDup);
    const dup = await repo.buscarDuplicados(practica, 'camara_comercio', hashDup, copia);
    comprobar('la copia encuentra al original y a nadie más', dup.length === 1 && dup[0].documentoId === original, JSON.stringify(dup));
    comprobar('el mismo archivo con otro tipo documental no es duplicado', !dup.some((d) => d.documentoId === otroTipo));
    comprobar('otra práctica no se mezcla', (await repo.buscarDuplicados(randomUUID(), 'camara_comercio', hashDup, copia)).length === 0);
    const [{ n: conservados }] = await ds.query('SELECT count(*)::int AS n FROM documentos WHERE id = ANY($1)', [[original, copia, otroTipo]]);
    comprobar('detectar no borra nada: los tres documentos siguen', conservados === 3, String(conservados));

    console.log('\n— Cámara de Comercio: las tres variantes se guardan y se leen sin pérdida (sin migración nueva) —');
    const comunes = {
      nit: '900123456', dv: '7', matricula: '654321', camara: 'CIUDAD DEMO', fechaMatricula: '2018-01-17', ultimoAnioRenovado: 2026,
      fechaRenovacion: null, estadoRegistral: 'no_determinable', domicilioMunicipio: 'Ciudad Demo', ciiu: '6201', fechaExpedicion: '2026-09-10',
      codigoVerificacion: 'ZZ99YY88XX', urlVerificacion: 'https://verifica.ejemplo.test', diasVerificacionDocumento: 60, firmaPdfPresente: true,
    } as const;
    const variantes: [string, C, TipoPersona, Record<string, unknown>][] = [
      ['matrícula de persona natural', C.CAMARA_MATRICULA_PERSONA_NATURAL, TipoPersona.NATURAL,
        { ...comunes, tipoCertificado: 'matricula_mercantil', tipoPersona: 'natural', nombreORazonSocial: 'MARIA FERNANDA LOPEZ RIVERA', representanteLegal: null }],
      ['matrícula de sociedad', C.CAMARA_MATRICULA_SOCIEDAD, TipoPersona.JURIDICA,
        { ...comunes, tipoCertificado: 'matricula_mercantil', tipoPersona: 'juridica', nombreORazonSocial: 'ACME DEMOSTRACION S.A.S.', representanteLegal: null }],
      ['existencia y representación', C.CAMARA_EXISTENCIA_REPRESENTACION, TipoPersona.JURIDICA,
        { ...comunes, tipoCertificado: 'existencia_representacion', tipoPersona: 'juridica', nombreORazonSocial: 'ACME DEMOSTRACION S.A.S.', representanteLegal: 'CARLOS ANDRES PEREZ GOMEZ' }],
    ];
    const hashPrimera = 'e'.repeat(64);
    const primera = await nuevoDocumento('camara_comercio', hashPrimera);
    for (const [nombre, clasificacion, persona, datos] of variantes) {
      const hash = nombre === 'existencia y representación' ? hashPrimera : randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      const docId = nombre === 'existencia y representación' ? await nuevoDocumento('camara_comercio', hashPrimera) : await nuevoDocumento('camara_comercio', hash);
      const vc = ValidacionDocumentoEmpresarial.pendiente({ id: randomUUID(), documentoId: docId, practicaId: practica, estudianteId: estudiante, tipoEsperado: 'camara_comercio', recibidaEn: ahora, ahora });
      await repo.crearSiNoExiste(vc.instantanea());
      const w = (await repo.buscarPorDocumento(docId))!;
      w.iniciarProcesamiento(ahora);
      await repo.guardarSiVersion(w.instantanea(), 1);
      const w2 = (await repo.buscarPorDocumento(docId))!;
      w2.registrarResultado({
        tipoDetectado: clasificacion, expectativa: 'coincide', metodoLectura: 'texto', confianza: 1, lecturaDudosa: false, hashDocumento: hash,
        duplicadoDeDocumentoId: nombre === 'existencia y representación' ? primera : null,
        datosExtraidos: datos as never, comparacion: { campos: [{ campo: 'nit', resultado: 'coincide' }], hayDiscrepancia: false },
      }, ahora);
      comprobar(`${nombre}: se guarda`, await repo.guardarSiVersion(w2.instantanea(), 2));
      const l = (await repo.buscarPorDocumento(docId))!.instantanea();
      comprobar(`${nombre}: clasificación, familia y persona salen de la base intactas`, l.tipoDetectado === clasificacion && l.familiaDocumento === 'camara' && l.tipoPersona === persona);
      comprobar(`${nombre}: los datos vuelven idénticos (estado registral no_determinable, renovación sin fecha, firma presente)`,
        isDeepStrictEqual(l.datosExtraidos, datos) && l.autenticidad.estado === 'no_verificable', JSON.stringify(l.datosExtraidos));
      if (nombre === 'existencia y representación') {
        comprobar('el duplicado exacto se registra apuntando al primer documento (y no se borra ninguno)', l.duplicadoDeDocumentoId === primera);
      }
    }
    console.log('\n— Cámara · el caso de uso lee (puertos locales), clasifica y persiste: idempotente, sin comparación ni decisión —');
    const paginasSinteticas = paginasCamaraExistencia();
    const lectorFalso: LectorDocumentoLocalPort = {
      extraerTextoNativo: async () => ({ paginas: paginasSinteticas.length, porPagina: paginasSinteticas.map((texto, i) => ({ pagina: i + 1, texto })) }),
      renderizarPagina: async () => { throw new Error('sin OCR'); }, prepararImagen: async () => { throw new Error('sin OCR'); },
      detectarQr: async () => [], ejecutarOcr: async () => { throw new Error('sin OCR'); },
    };
    const geometriaFalsa: GeometriaDocumentoPort = {
      cajasTextoNativo: async () => [], cajasOcr: async () => [], medirZonaFirma: async () => ({ legible: false, densidadTinta: 0, alturaRelativaTrazo: 0 }),
    };
    const lecturaServicio = new LecturaLocalCamaraService(lectorFalso, geometriaFalsa);
    const documentoCamara = await nuevoDocumento('camara_comercio', 'b'.repeat(64));
    const datosDoc: DatosDocumento = {
      id: documentoCamara, practicaId: practica, tipo: TipoDocumento.CAMARA_COMERCIO, version: 1, estado: EstadoDocumento.EN_REVISION, nombreOriginal: 'camara.pdf', mimeReal: 'application/pdf',
      tamanoBytes: 10, hashSha256: 'b'.repeat(64), hashPerceptual: null, rutaAlmacenamiento: 'ruta/x', calidadCaptura: null, banderas: [], puntaje: 90, banda: BandaPuntaje.VERDE, extraccion: null,
      decididoPor: null, justificacionDecision: null, motivoDevolucion: null, cargadoEn: ahora, actualizadoEn: ahora, purgarDespuesDe: null,
    };
    const casoCamara = new ValidacionCamaraUseCase(
      repo, { buscarPorId: async () => Documento.desde(datosDoc) } as never, { buscarPorId: async () => ({ estudianteId: estudiante }) } as never,
      { leer: async () => Buffer.from('%PDF-1.7 /ByteRange [0 10 20 30]') } as never, { leer: (c: Buffer, m: string) => lecturaServicio.leer(c, m) },
    );
    const valCamara = (await casoCamara.procesar(documentoCamara, ahora))!.instantanea();
    const [fila] = await ds.query(
      `SELECT estado, familia_documento, tipo_detectado, tipo_persona, metodo_lectura, hash_documento, autenticidad_estado, procesada_en IS NOT NULL AS procesada,
              comparacion IS NULL AS sin_comparacion, decidido_por IS NULL AS sin_decision, asignado_a IS NULL AS sin_reserva, datos_extraidos
       FROM validaciones_documento_empresarial WHERE documento_id = $1`, [documentoCamara],
    );
    comprobar('Cámara: queda en revisión, clasificada por contenido (existencia y representación, persona jurídica, familia cámara)',
      valCamara.estado === Estado.REVISION && fila.estado === 'revision' && fila.familia_documento === 'camara' && fila.tipo_detectado === 'camara_existencia_representacion' && fila.tipo_persona === 'juridica', JSON.stringify(fila).slice(0, 200));
    comprobar('Cámara: método texto, hash, autenticidad no_verificable y procesada_en', fila.metodo_lectura === 'texto' && /^[0-9a-f]{64}$/.test(fila.hash_documento) && fila.autenticidad_estado === 'no_verificable' && fila.procesada === true);
    comprobar('Cámara: SIN comparación, SIN decisión y SIN reserva', fila.sin_comparacion === true && fila.sin_decision === true && fila.sin_reserva === true);
    comprobar('Cámara: los datos minimizados incluyen la firma PDF presente, la ventana de verificación y el representante, y no más',
      fila.datos_extraidos.firmaPdfPresente === true && fila.datos_extraidos.verificacionDisponibleHasta === '2026-11-09' && typeof fila.datos_extraidos.representanteLegal === 'string'
      && !('direccion' in fila.datos_extraidos) && !('texto' in fila.datos_extraidos), JSON.stringify(Object.keys(fila.datos_extraidos)));
    const evidenciasCamara = ((await ds.query('SELECT tipo FROM evidencias_validacion_doc_empresarial WHERE validacion_id = $1', [valCamara.id])) as { tipo: string }[]).map((e) => e.tipo).sort();
    comprobar('Cámara: dos evidencias (lectura_documento y clasificacion)', JSON.stringify(evidenciasCamara) === JSON.stringify(['clasificacion', 'lectura_documento']), JSON.stringify(evidenciasCamara));
    await casoCamara.procesar(documentoCamara, ahora);
    await casoCamara.registrarProcesamiento(Documento.desde(datosDoc), ahora);
    const [{ n: filasCamara }] = await ds.query('SELECT count(*)::int AS n FROM validaciones_documento_empresarial WHERE documento_id = $1', [documentoCamara]);
    comprobar('Cámara: repetir el procesamiento no duplica la validación ni las evidencias', filasCamara === 1 && (await repo.listarEvidencias(valCamara.id)).length === 2);

    await rechaza('Cámara: una bandera de «vigente» no entra en los datos', () => insertar(revision({
      tipo_detectado: 'camara_matricula_sociedad', familia_documento: 'camara', tipo_persona: 'juridica', datos_extraidos: { tipoPersona: 'juridica', vigente: true },
    })), /ck_vdemp_datos/);
  } finally {
    await ds.destroy();
  }
  console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}`);
  process.exit(fallos === 0 ? 0 : 1);
}

void main();
