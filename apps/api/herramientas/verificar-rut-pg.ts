/* eslint-disable no-console */
/**
 * Verificación de extremo a extremo del procesamiento del RUT contra un PostgreSQL DESECHABLE: PDF sintético →
 * lectura local real (pdf.js, ZXing, Tesseract) → caso de uso → validaciones_documento_empresarial, evidencias y
 * comparación con SIPRA (usuario y empresa reales de la base), incluido el recálculo sin releer el archivo.
 *
 * Seguridad: se NIEGA a correr si la base no es local. Crea datos sintéticos (prefijo `verif-`) y los deja (las
 * evidencias son inmutables): base desechable. Sin red.
 *
 *   DB_URL=postgres://usuario@127.0.0.1:PUERTO/base npm run test:pg:rut   (tras `npm run migration:run`)
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { LecturaLocalRutService, minimizarLecturaRut } from '../src/domain/services/lectura-local-rut.domain-service';
import { calcularSha256 } from '../src/domain/services/duplicados-documento-empresarial.domain-service';
import { ValidacionRutUseCase } from '../src/application/use-cases/documentos/validacion-rut.use-case';
import {
  DocumentoRepositoryAdapter, EmpresaRepositoryAdapter, PracticaRepositoryAdapter, UsuarioRepositoryAdapter,
} from '../src/infrastructure/adapters/persistence/postgres/repositorios.adapter';
import { ValidacionDocumentoEmpresarialRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/validacion-documento-empresarial.adapter';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import {
  DocumentoOrm, EmpresaOrm, ENTIDADES_ORM, PracticaOrm, UsuarioOrm,
} from '../src/infrastructure/persistence/postgres/entities/todas.orm-entity';
import {
  EvidenciaValidacionDocEmpresarialOrm, ValidacionDocumentoEmpresarialOrm,
} from '../src/infrastructure/persistence/postgres/entities/validacion-documento-empresarial.orm-entity';
import { Nit } from '../src/domain/value-objects/nit.vo';
import { pdfRutSintetico } from '../test/soporte-rut-pdf';

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

interface CampoPersistido { campo: string; resultado: string; criticidad: string }

async function main(): Promise<void> {
  const ds = new DataSource({ type: 'postgres', url, entities: ENTIDADES_ORM, ssl: false });
  await ds.initialize();
  const lector = new LectorDocumentoLocalAdapter();
  try {
    const sufijo = randomUUID().slice(0, 8);
    const estudiante = randomUUID();
    const practica = randomUUID();
    const empresa = randomUUID();
    const esc = `verif-${sufijo}`;
    await ds.query('INSERT INTO cat_escuela (codigo, nombre) VALUES ($1, $2)', [esc, 'Escuela de verificación']);
    // SIPRA sintético: el estudiante (persona natural) y la empresa (persona jurídica) de la práctica.
    await ds.query('INSERT INTO usuarios (id, correo, nombre, rol, documento) VALUES ($1, $2, $3, $4, $5)', [estudiante, `${estudiante}@verificacion.example`, 'MARÍA FERNANDA PÉREZ GÓMEZ', 'estudiante', '1000000001']);
    await ds.query(
      `INSERT INTO empresas (id, razon_social, nit_numero, nit_dv, solicitante_nombre, solicitante_correo, estado)
       VALUES ($1, 'ACME DEMOSTRACIÓN S.A.S.', '900123456', $2, 'Persona sintética', 'demo@verificacion.example', 'habilitada')`,
      [empresa, Nit.calcularDigitoVerificacion('900123456')],
    );
    await ds.query(
      `INSERT INTO practicas (id, estudiante_id, programa_id, escuela_id, ciclo, periodo_academico, modalidad, estado, empresa_id)
       VALUES ($1, $2, 'PRG', $3, 'profesional', '2026-2', 'cunbre_consolidado', 'documentacion', $4)`,
      [practica, estudiante, esc, empresa],
    );

    const archivos = new Map<string, Buffer>();
    let version = 0;
    const cargar = async (tipo: TipoDocumento, pdf: Buffer, extraccion: unknown = null): Promise<string> => {
      const id = randomUUID();
      const ruta = `verif/${id}.pdf`;
      archivos.set(ruta, pdf);
      await ds.query(
        `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento, extraccion)
         VALUES ($1, $2, $3, $4, 'en_revision', 'rut.pdf', 'application/pdf', $5, $6, $7, $8)`,
        [id, practica, tipo, (version += 1), pdf.length, calcularSha256(pdf), ruta, extraccion ? JSON.stringify(extraccion) : null],
      );
      return id;
    };

    const repo = new ValidacionDocumentoEmpresarialRepositoryAdapter(
      ds.getRepository(ValidacionDocumentoEmpresarialOrm), ds.getRepository(EvidenciaValidacionDocEmpresarialOrm), ds.getRepository(DocumentoOrm),
    );
    const documentosRepo = new DocumentoRepositoryAdapter(ds.getRepository(DocumentoOrm));
    const servicio = new LecturaLocalRutService(lector, lector);
    let lecturasDelArchivo = 0;
    const caso = new ValidacionRutUseCase(
      repo, documentosRepo, new PracticaRepositoryAdapter(ds.getRepository(PracticaOrm)),
      { leer: async (r: string) => archivos.get(r)!, guardar: async () => '', eliminar: async () => undefined, enlaceFirmado: async () => '' },
      { leer: (c: Buffer, m: string) => { lecturasDelArchivo += 1; return servicio.leer(c, m); } },
      new UsuarioRepositoryAdapter(ds.getRepository(UsuarioOrm)), new EmpresaRepositoryAdapter(ds.getRepository(EmpresaOrm)),
    );
    const URL_DIAN = 'https://muisca.dian.gov.co/WebRutMuisca/DefConsultaEstadoRUT.faces?codigo=SECRETO';
    const evidenciasDe = async (validacionId: string): Promise<{ tipo: string; intento: number }[]> =>
      ds.query('SELECT tipo, intento FROM evidencias_validacion_doc_empresarial WHERE validacion_id = $1 ORDER BY creado_en, tipo', [validacionId]);

    console.log('— RUT natural digital: lectura, persistencia y comparación con el estudiante —');
    const pn = await pdfRutSintetico({ persona: 'natural', qr: URL_DIAN, conContacto: true });
    const idPn = await cargar(TipoDocumento.RUT_NATURAL, pn);
    const vPn = (await caso.procesar(idPn))!.instantanea();
    comprobar('queda en revisión, clasificado como RUT de persona natural', vPn.estado === 'revision' && vPn.tipoDetectado === 'rut_persona_natural' && vPn.familiaDocumento === 'rut' && vPn.tipoPersona === 'natural', JSON.stringify([vPn.estado, vPn.tipoDetectado]));
    comprobar('método texto, confianza 1, no dudosa, hash del archivo, expectativa coincide', vPn.metodoLectura === 'texto' && vPn.confianza === 1 && !vPn.lecturaDudosa && vPn.hashDocumento === calcularSha256(pn) && vPn.expectativa === 'coincide');
    const filaPn = (await ds.query('SELECT datos_extraidos, comparacion, autenticidad, autenticidad_estado, procesada_en FROM validaciones_documento_empresarial WHERE documento_id = $1', [idPn]))[0];
    comprobar('la comparación con el estudiante quedó guardada: consistente, críticos documento y nombre', filaPn.comparacion.veredicto === 'consistente' && filaPn.comparacion.hayDiscrepancia === false
      && (filaPn.comparacion.campos as CampoPersistido[]).filter((c) => c.criticidad === 'critico').map((c) => `${c.campo}:${c.resultado}`).join() === 'documento:coincide,nombre:coincide', JSON.stringify(filaPn.comparacion.campos));
    comprobar('la comparación guarda campo, resultado y criticidad: ni valores ni datos personales', !/1000000001|MARIA|PEREZ|CALLE FALSA|persona\.demo|SECRETO/.test(JSON.stringify(filaPn.comparacion)));
    comprobar('NO se guardó dirección, correo, teléfono ni el código del QR', !/CALLE FALSA|persona\.demo|3000000000|SECRETO/.test(JSON.stringify(filaPn)));
    comprobar('autenticidad no_verificable con el QR de la DIAN registrado', filaPn.autenticidad_estado === 'no_verificable' && filaPn.autenticidad.qrDestinoOficial === true && filaPn.autenticidad.firmaPdfValida === null);
    const evs = await evidenciasDe(vPn.id);
    comprobar('tres evidencias: lectura_documento, clasificacion y comparacion', evs.map((e) => e.tipo).sort().join() === 'clasificacion,comparacion,lectura_documento', JSON.stringify(evs));
    const evTexto = JSON.stringify(await ds.query('SELECT datos FROM evidencias_validacion_doc_empresarial WHERE validacion_id = $1', [vPn.id]));
    comprobar('las evidencias no llevan texto, imágenes ni valores personales', !/CALLE FALSA|persona\.demo|MARIA|1000000001|PEREZ/.test(evTexto));

    console.log('\n— Idempotencia —');
    const otra = (await caso.procesar(idPn))!.instantanea();
    const [{ n: nVal }] = await ds.query('SELECT count(*)::int AS n FROM validaciones_documento_empresarial WHERE documento_id = $1', [idPn]);
    comprobar('repetir el procesamiento no duplica validación ni evidencias y no pisa el resultado', nVal === 1 && (await evidenciasDe(vPn.id)).length === 3 && otra.version === vPn.version);
    const concurrentes = await Promise.all(Array.from({ length: 5 }, async () => {
      const id = await cargar(TipoDocumento.RUT_JURIDICO, await pdfRutSintetico({ persona: 'juridica', razonSocial: `EMPRESA ${randomUUID().slice(0, 4).toUpperCase()}` }));
      await Promise.all(Array.from({ length: 4 }, () => caso.procesar(id)));
      return id;
    }));
    let bien = true;
    for (const id of concurrentes) {
      const [{ n }] = await ds.query('SELECT count(*)::int AS n FROM validaciones_documento_empresarial WHERE documento_id = $1', [id]);
      const [{ ne }] = await ds.query('SELECT count(*)::int AS ne FROM evidencias_validacion_doc_empresarial e JOIN validaciones_documento_empresarial v ON v.id = e.validacion_id WHERE v.documento_id = $1', [id]);
      if (n !== 1 || ne !== 3) bien = false;
    }
    comprobar('procesar el mismo RUT 4 veces a la vez (×5 documentos): una fila y tres evidencias por documento', bien);

    console.log('\n— RUT jurídico contra la empresa de la práctica, y recálculo al cambiar SIPRA —');
    const pj = await pdfRutSintetico({ persona: 'juridica', razonSocial: 'ACME DEMOSTRACION SAS' });
    // El NIT sintético del PDF es 900123456 con su DV calculado; la empresa de SIPRA se creó con el mismo DV.
    const idPj = await cargar(TipoDocumento.RUT_JURIDICO, pj);
    const vPj = (await caso.procesar(idPj))!.instantanea();
    const cmpPj = vPj.comparacion as unknown as { veredicto: string; campos: CampoPersistido[] };
    comprobar('razón social normalizada (S.A.S./SAS, tildes) coincide con la empresa de SIPRA', cmpPj.campos.find((c) => c.campo === 'razon_social')?.resultado === 'coincide', JSON.stringify(cmpPj.campos));
    const evsAntes = JSON.stringify(await ds.query('SELECT id, tipo, intento, datos FROM evidencias_validacion_doc_empresarial WHERE validacion_id = $1 ORDER BY id', [vPj.id]));
    comprobar('antes de cambiar SIPRA, los datos de SIPRA no han cambiado', !(await caso.datosSipraCambiaron(idPj)));
    const lecturasAntes = lecturasDelArchivo;
    await ds.query(`UPDATE empresas SET razon_social = 'COMERCIALIZADORA ANDINA LTDA' WHERE id = $1`, [empresa]);
    comprobar('al cambiar la razón social en SIPRA, se detecta que los datos cambiaron después de la lectura', await caso.datosSipraCambiaron(idPj));
    const re = (await caso.recalcularComparacion(idPj))!.instantanea();
    const cmpRe = re.comparacion as unknown as { veredicto: string; campos: CampoPersistido[] };
    comprobar('el recálculo marca discrepancia SOLO en razón social (NIT y DV siguen coincidiendo)', cmpRe.veredicto === 'discrepancia'
      && cmpRe.campos.filter((c) => c.resultado === 'diferente').map((c) => c.campo).join() === 'razon_social', JSON.stringify(cmpRe.campos.map((c) => `${c.campo}:${c.resultado}`)));
    comprobar('el recálculo NO releyó el archivo y abrió una ronda nueva', lecturasDelArchivo === lecturasAntes && re.intentos === vPj.intentos + 1, `${lecturasDelArchivo}/${lecturasAntes} ${re.intentos}/${vPj.intentos}`);
    const evsDespues = await ds.query('SELECT id, tipo, intento, datos FROM evidencias_validacion_doc_empresarial WHERE validacion_id = $1 ORDER BY id', [vPj.id]);
    comprobar('las evidencias anteriores quedan intactas y se agrega UNA de comparación', evsDespues.length === 4 && JSON.parse(evsAntes).every((e: { id: string }) => JSON.stringify(evsDespues.find((x: { id: string }) => x.id === e.id)) === JSON.stringify(JSON.parse(evsAntes).find((y: { id: string }) => y.id === e.id))));
    await caso.recalcularComparacion(idPj);
    comprobar('un segundo recálculo, ya al día, no hace nada', (await evidenciasDe(vPj.id)).length === 4 && !(await caso.datosSipraCambiaron(idPj)));
    await ds.query(`UPDATE empresas SET razon_social = 'ACME DEMOSTRACIÓN S.A.S.' WHERE id = $1`, [empresa]);

    console.log('\n— Lectura que dejó el pipeline: se registra SIN releer el archivo —');
    const pn2 = await pdfRutSintetico({ persona: 'natural', ciiu: '4711' });
    const lecturaDePipeline = minimizarLecturaRut(await servicio.leer(pn2, 'application/pdf'));
    const idP = await cargar(TipoDocumento.RUT_NATURAL, pn2, { lecturaRut: lecturaDePipeline, modelo: 'local-pdfjs-tesseract-rut' });
    const lecturasPrevias = lecturasDelArchivo;
    const doc = (await documentosRepo.buscarPorId(idP))!;
    const vP = (await caso.registrarProcesamiento(doc))!.instantanea();
    comprobar('registrarProcesamiento usa la lectura del pipeline: revisión, comparación y cero lecturas del archivo', vP.estado === 'revision' && (vP.comparacion as unknown as { veredicto: string }).veredicto === 'consistente' && lecturasDelArchivo === lecturasPrevias);

    console.log('\n— Persona distinta a la esperada —');
    const idPd = await cargar(TipoDocumento.RUT_NATURAL, await pdfRutSintetico({ persona: 'juridica', razonSocial: 'OTRA DEMO SAS' }));
    const vPd = (await caso.procesar(idPd))!.instantanea();
    comprobar('un RUT jurídico cargado como natural: persona_distinta y NO se compara como persona natural', vPd.tipoDetectado === 'rut_persona_juridica' && vPd.expectativa === 'persona_distinta'
      && (vPd.comparacion as unknown as { veredicto: string }).veredicto === 'no_aplica' && !(vPd.comparacion as unknown as { hayDiscrepancia: boolean }).hayDiscrepancia);

    console.log('\n— Duplicado exacto, y archivo ilegible —');
    const idDup = await cargar(TipoDocumento.RUT_NATURAL, pn);
    const vDup = (await caso.procesar(idDup))!.instantanea();
    comprobar('se reporta duplicado_de_documento_id y el documento se lee igual', vDup.duplicadoDeDocumentoId === idPn && vDup.estado === 'revision');
    const idMalo = await cargar(TipoDocumento.RUT_NATURAL, Buffer.from('esto no es un pdf'));
    const vMalo = (await caso.procesar(idMalo))!.instantanea();
    comprobar('un archivo ilegible queda en error con un código (no con el mensaje) y sin comparación', vMalo.estado === 'error' && !!vMalo.errorCodigo && vMalo.comparacion === null, `${vMalo.estado}/${vMalo.errorCodigo}`);
    const [{ n: nDocs }] = await ds.query('SELECT count(*)::int AS n FROM documentos WHERE id = ANY($1)', [[idPn, idDup]]);
    comprobar('nada se borra', nDocs === 2);
  } finally {
    await lector.onModuleDestroy();
    await ds.destroy();
  }
  console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}`);
  process.exit(fallos === 0 ? 0 : 1);
}

void main();
