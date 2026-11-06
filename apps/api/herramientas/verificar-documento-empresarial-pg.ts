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
import { LecturaCamaraPersistible, LecturaLocalCamaraService } from '../src/domain/services/lectura-local-camara.domain-service';
import {
  DV_JURIDICA, NIT_JURIDICA, RAZON_SOCIAL, REPRESENTANTE, datosCamara, datosCamaraPn,
} from '../test/soporte-documento-empresarial';
import { paginasCamaraExistencia } from '../test/soporte-camara-sintetico';
import { DataSource } from 'typeorm';
import {
  ClasificacionDocumentoEmpresarial as C, DatosCamaraExtraidos, EstadoValidacionDocumentoEmpresarial as Estado, TipoPersona,
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
    console.log('\n— Cámara · el caso de uso lee (puertos locales), clasifica, persiste y COMPARA con SIPRA: idempotente, sin decisión —');
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
    // Lo que SIPRA sabe de la empresa de la práctica: mutable, para probar recálculo y huella.
    const sipraEmpresa: Record<string, unknown> = { nitNumero: NIT_JURIDICA, nitDv: Number(DV_JURIDICA), razonSocial: RAZON_SOCIAL, representanteLegal: REPRESENTANTE };
    const documentosCamara = new Map<string, Documento>([[documentoCamara, Documento.desde(datosDoc)]]);
    const casoCamara = new ValidacionCamaraUseCase(
      repo, { buscarPorId: async (id: string) => documentosCamara.get(id) ?? null } as never,
      { buscarPorId: async () => ({ estudianteId: estudiante, instantanea: () => ({ empresaId: 'e-1', empresaRazonSocial: null, empresaNit: null }) }) } as never,
      { leer: async () => Buffer.from('%PDF-1.7 /ByteRange [0 10 20 30]') } as never, { leer: (c: Buffer, m: string) => lecturaServicio.leer(c, m) },
      { buscarPorId: async () => ({ instantanea: () => ({ ...sipraEmpresa }) }) } as never,
    );
    const valCamara = (await casoCamara.procesar(documentoCamara, ahora))!.instantanea();
    const [fila] = await ds.query(
      `SELECT estado, familia_documento, tipo_detectado, tipo_persona, metodo_lectura, hash_documento, autenticidad_estado, procesada_en IS NOT NULL AS procesada,
              comparacion, decidido_por IS NULL AS sin_decision, asignado_a IS NULL AS sin_reserva, datos_extraidos, expectativa
       FROM validaciones_documento_empresarial WHERE documento_id = $1`, [documentoCamara],
    );
    comprobar('Cámara: queda en revisión, clasificada por contenido (existencia y representación, persona jurídica, familia cámara)',
      valCamara.estado === Estado.REVISION && fila.estado === 'revision' && fila.familia_documento === 'camara' && fila.tipo_detectado === 'camara_existencia_representacion' && fila.tipo_persona === 'juridica', JSON.stringify(fila).slice(0, 200));
    comprobar('Cámara: método texto, hash, autenticidad no_verificable y procesada_en', fila.metodo_lectura === 'texto' && /^[0-9a-f]{64}$/.test(fila.hash_documento) && fila.autenticidad_estado === 'no_verificable' && fila.procesada === true);
    comprobar('Cámara: comparación guardada y consistente (campo, resultado y criticidad; sin valores), SIN decisión y SIN reserva',
      fila.comparacion?.veredicto === 'consistente' && fila.comparacion.hayDiscrepancia === false && fila.expectativa === 'coincide' && !JSON.stringify(fila.comparacion).includes(NIT_JURIDICA)
      && fila.sin_decision === true && fila.sin_reserva === true, JSON.stringify(fila.comparacion).slice(0, 200));
    comprobar('Cámara: los datos minimizados incluyen la firma PDF presente, la ventana de verificación y el representante, y no más',
      fila.datos_extraidos.firmaPdfPresente === true && fila.datos_extraidos.verificacionDisponibleHasta === '2026-11-09' && typeof fila.datos_extraidos.representanteLegal === 'string'
      && !('direccion' in fila.datos_extraidos) && !('texto' in fila.datos_extraidos), JSON.stringify(Object.keys(fila.datos_extraidos)));
    const evidenciasCamara = ((await ds.query('SELECT tipo FROM evidencias_validacion_doc_empresarial WHERE validacion_id = $1', [valCamara.id])) as { tipo: string }[]).map((e) => e.tipo).sort();
    comprobar('Cámara: tres evidencias (lectura_documento, clasificacion y comparacion)', JSON.stringify(evidenciasCamara) === JSON.stringify(['clasificacion', 'comparacion', 'lectura_documento']), JSON.stringify(evidenciasCamara));
    await casoCamara.procesar(documentoCamara, ahora);
    await casoCamara.registrarProcesamiento(Documento.desde(datosDoc), ahora);
    const [{ n: filasCamara }] = await ds.query('SELECT count(*)::int AS n FROM validaciones_documento_empresarial WHERE documento_id = $1', [documentoCamara]);
    comprobar('Cámara: repetir el procesamiento no duplica la validación ni las evidencias', filasCamara === 1 && (await repo.listarEvidencias(valCamara.id)).length === 3);

    console.log('\n— Cámara · comparación con SIPRA: escenarios, recálculo, huella y concurrencia (PostgreSQL real) —');
    const hashes = ['c', 'd', 'e', 'f', '1', '2', '3', '4', '5'];
    let usados = 0;
    const lecturaPersistible = (tipo: C, datos: DatosCamaraExtraidos | null, hash: string, dudosa: boolean): LecturaCamaraPersistible => ({
      hashSha256: hash, tipoDetectado: tipo, motivosClasificacion: [], metodo: 'texto', confianzaDocumento: dudosa ? 0.6 : 1, lecturaDudosa: dudosa, datos,
      autenticidad: {
        estado: 'no_verificable', fuente: null, qrPresente: null, qrDecodificado: null, qrDestinoOficial: null,
        firmaPdfPresente: true, firmaPdfValida: null, codigoVerificacionPresente: true, urlVerificacionPresente: true,
      } as never,
      resumen: { metodo: 'texto', paginas: 1, paginasOcr: 0, confianzaOcrMedia: null, lecturaDudosa: dudosa, limitesAplicados: [] }, motivos: [],
    });
    const consulta = async (id: string) => {
      const [f] = await ds.query('SELECT id, estado, expectativa, comparacion, decidido_por, intentos FROM validaciones_documento_empresarial WHERE documento_id = $1', [id]);
      const evs = (await ds.query(
        'SELECT tipo, intento, resultado, metodo FROM evidencias_validacion_doc_empresarial WHERE validacion_id = $1 ORDER BY intento, tipo', [f.id],
      )) as { tipo: string; intento: number; resultado: string; metodo: string }[];
      return { f, evs, comparaciones: evs.filter((e) => e.tipo === 'comparacion') };
    };
    const registrarLectura = async (tipo: C, datos: DatosCamaraExtraidos | null, dudosa = false) => {
      const hash = hashes[usados++].repeat(64);
      const id = await nuevoDocumento('camara_comercio', hash);
      documentosCamara.set(id, Documento.desde({ ...datosDoc, id, hashSha256: hash, extraccion: { lecturaCamara: lecturaPersistible(tipo, datos, hash, dudosa) } }));
      await casoCamara.registrarProcesamiento(documentosCamara.get(id)!, ahora);
      return { id, ...(await consulta(id)) };
    };
    const camaraInicial = { ...sipraEmpresa };

    sipraEmpresa['razonSocial'] = 'OTRA COMERCIALIZADORA S.A.S.';
    const discrepancia = await registrarLectura(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamara());
    sipraEmpresa['razonSocial'] = camaraInicial['razonSocial'];
    const camposDif = (discrepancia.f.comparacion.campos as { campo: string; resultado: string }[]).filter((c) => c.resultado === 'diferente').map((c) => c.campo);
    comprobar('discrepancia crítica: veredicto discrepancia, diferencia SOLO en razon_social, sigue en revisión (nunca decidida)',
      discrepancia.f.estado === 'revision' && discrepancia.f.comparacion.veredicto === 'discrepancia' && JSON.stringify(camposDif) === '["razon_social"]' && discrepancia.f.decidido_por === null);
    comprobar('discrepancia: la evidencia de comparación usa el método de Cámara y su resultado',
      discrepancia.comparaciones.length === 1 && discrepancia.comparaciones[0].metodo === 'comparacion_camara_sipra' && discrepancia.comparaciones[0].resultado === 'discrepancia');

    const dudosa = await registrarLectura(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamara(), true);
    comprobar('lectura dudosa: información insuficiente / revisión necesaria, sin ninguna diferencia',
      dudosa.f.comparacion.veredicto === 'revision_necesaria' && dudosa.f.comparacion.hayDiscrepancia === false);

    const distinta = await registrarLectura(C.CAMARA_MATRICULA_PERSONA_NATURAL, datosCamaraPn());
    comprobar('persona distinta: expectativa persona_distinta, críticos no_aplica, veredicto no_aplica y sin diferencias',
      distinta.f.expectativa === 'persona_distinta' && distinta.f.comparacion.veredicto === 'no_aplica' && distinta.f.comparacion.hayDiscrepancia === false && distinta.f.estado === 'revision');

    for (const tipo of [C.DOCUMENTO_INCORRECTO, C.NO_DETERMINABLE]) {
      const sinDatos = await registrarLectura(tipo, null);
      comprobar(`${tipo}: SIN comparación y SIN evidencia de comparación (revisión humana)`,
        sinDatos.f.estado === 'revision' && sinDatos.f.comparacion === null && sinDatos.comparaciones.length === 0 && sinDatos.evs.length === 2);
    }

    // Recálculo y huella sobre la Cámara consistente del inicio (sin releer el PDF).
    const antes = await consulta(documentoCamara);
    const datosAntes = (await repo.buscarPorDocumento(documentoCamara))!.instantanea().datosExtraidos;
    comprobar('huella: SIPRA no ha cambiado', (await casoCamara.datosSipraCambiaronCamara(documentoCamara)) === false);
    await casoCamara.recalcularComparacionCamara(documentoCamara, ahora);
    const igual = await consulta(documentoCamara);
    comprobar('recálculo sin cambios en SIPRA: no abre ronda ni agrega evidencia', igual.f.intentos === antes.f.intentos && igual.comparaciones.length === 1);
    sipraEmpresa['representanteLegal'] = 'LUIS MIGUEL TORRES DIAZ';
    comprobar('huella: SIPRA cambió después de la lectura', (await casoCamara.datosSipraCambiaronCamara(documentoCamara)) === true);
    await casoCamara.recalcularComparacionCamara(documentoCamara, ahora);
    const recalculada = await consulta(documentoCamara);
    comprobar('recálculo: ronda nueva, comparación actualizada (representante diferente) y evidencia nueva; la anterior se conserva',
      recalculada.f.intentos === antes.f.intentos + 1 && recalculada.f.comparacion.veredicto === 'revision_necesaria' && recalculada.f.comparacion.discrepanciaImportante === true && recalculada.f.estado === 'revision'
      && recalculada.comparaciones.length === 2 && recalculada.comparaciones[0].resultado === 'consistente' && recalculada.comparaciones[1].resultado === 'revision_necesaria'
      && recalculada.comparaciones[0].intento !== recalculada.comparaciones[1].intento, JSON.stringify(recalculada.comparaciones));
    comprobar('huella: tras recalcular vuelve a coincidir', (await casoCamara.datosSipraCambiaronCamara(documentoCamara)) === false);
    comprobar('los datos extraídos NO cambiaron con el recálculo (no se releyó el PDF)',
      isDeepStrictEqual((await repo.buscarPorDocumento(documentoCamara))!.instantanea().datosExtraidos, datosAntes));
    sipraEmpresa['representanteLegal'] = camaraInicial['representanteLegal'];

    // Concurrencia: varios recálculos simultáneos tras un cambio de SIPRA producen UNA sola ronda y UNA sola evidencia nueva.
    const concurrente = await registrarLectura(C.CAMARA_EXISTENCIA_REPRESENTACION, datosCamara({ matricula: '999999' }));
    sipraEmpresa['razonSocial'] = 'EMPRESA CONCURRENTE S.A.S.';
    await Promise.all(Array.from({ length: 8 }, () => casoCamara.recalcularComparacionCamara(concurrente.id, ahora)));
    const trasConcurrencia = await consulta(concurrente.id);
    comprobar('concurrencia (8 recálculos simultáneos): UNA ronda nueva y UNA evidencia de comparación nueva',
      trasConcurrencia.f.intentos === concurrente.f.intentos + 1 && trasConcurrencia.comparaciones.length === 2, JSON.stringify(trasConcurrencia.comparaciones));

    // Un caso ya decidido NO se recalcula: la decisión es historia; solo se informa que SIPRA cambió.
    await ds.query("UPDATE validaciones_documento_empresarial SET estado = 'aprobado_manual', decidido_por = $2, decidido_en = now() WHERE id = $1", [trasConcurrencia.f.id, estudiante]);
    sipraEmpresa['razonSocial'] = 'TERCERA RAZON SOCIAL S.A.S.';
    await casoCamara.recalcularComparacionCamara(concurrente.id, ahora);
    const decidida = await consulta(concurrente.id);
    comprobar('caso decidido: no se recalcula (misma comparación, sin evidencia nueva) y la huella avisa que SIPRA cambió',
      decidida.f.estado === 'aprobado_manual' && decidida.comparaciones.length === 2 && decidida.f.intentos === trasConcurrencia.f.intentos
      && isDeepStrictEqual(decidida.f.comparacion, trasConcurrencia.f.comparacion) && (await casoCamara.datosSipraCambiaronCamara(concurrente.id)) === true);
    sipraEmpresa['razonSocial'] = camaraInicial['razonSocial'];

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
