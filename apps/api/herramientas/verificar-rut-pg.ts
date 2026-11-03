/* eslint-disable no-console */
/**
 * Verificación de extremo a extremo del procesamiento del RUT contra un PostgreSQL DESECHABLE: PDF sintético →
 * lectura local real (pdf.js, ZXing, Tesseract) → caso de uso → validaciones_documento_empresarial y evidencias.
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
import { LecturaLocalRutService } from '../src/domain/services/lectura-local-rut.domain-service';
import { calcularSha256 } from '../src/domain/services/duplicados-documento-empresarial.domain-service';
import { ValidacionRutUseCase } from '../src/application/use-cases/documentos/validacion-rut.use-case';
import { DocumentoRepositoryAdapter, PracticaRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/repositorios.adapter';
import { ValidacionDocumentoEmpresarialRepositoryAdapter } from '../src/infrastructure/adapters/persistence/postgres/validacion-documento-empresarial.adapter';
import { LectorDocumentoLocalAdapter } from '../src/infrastructure/adapters/lectura-local/lector-documento-local.adapter';
import { DocumentoOrm, ENTIDADES_ORM, PracticaOrm } from '../src/infrastructure/persistence/postgres/entities/todas.orm-entity';
import {
  EvidenciaValidacionDocEmpresarialOrm, ValidacionDocumentoEmpresarialOrm,
} from '../src/infrastructure/persistence/postgres/entities/validacion-documento-empresarial.orm-entity';
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

async function main(): Promise<void> {
  const ds = new DataSource({ type: 'postgres', url, entities: ENTIDADES_ORM, ssl: false });
  await ds.initialize();
  const lector = new LectorDocumentoLocalAdapter();
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

    // Almacén en memoria: ruta → bytes del PDF sintético.
    const archivos = new Map<string, Buffer>();
    let version = 0;
    const cargar = async (tipo: TipoDocumento, pdf: Buffer): Promise<string> => {
      const id = randomUUID();
      const ruta = `verif/${id}.pdf`;
      archivos.set(ruta, pdf);
      await ds.query(
        `INSERT INTO documentos (id, practica_id, tipo, version, estado, nombre_original, mime_real, tamano_bytes, hash_sha256, ruta_almacenamiento)
         VALUES ($1, $2, $3, $4, 'en_revision', 'rut.pdf', 'application/pdf', $5, $6, $7)`,
        [id, practica, tipo, (version += 1), pdf.length, calcularSha256(pdf), ruta],
      );
      return id;
    };

    const repo = new ValidacionDocumentoEmpresarialRepositoryAdapter(
      ds.getRepository(ValidacionDocumentoEmpresarialOrm), ds.getRepository(EvidenciaValidacionDocEmpresarialOrm), ds.getRepository(DocumentoOrm),
    );
    const servicio = new LecturaLocalRutService(lector, lector);
    const caso = new ValidacionRutUseCase(
      repo, new DocumentoRepositoryAdapter(ds.getRepository(DocumentoOrm)), new PracticaRepositoryAdapter(ds.getRepository(PracticaOrm)),
      { leer: async (r: string) => archivos.get(r)!, guardar: async () => '', eliminar: async () => undefined, enlaceFirmado: async () => '' },
      { leer: (c: Buffer, m: string) => servicio.leer(c, m) },
    );
    const URL_DIAN = 'https://muisca.dian.gov.co/WebRutMuisca/DefConsultaEstadoRUT.faces?codigo=SECRETO';

    console.log('— RUT natural digital —');
    const pn = await pdfRutSintetico({ persona: 'natural', qr: URL_DIAN, conContacto: true });
    const idPn = await cargar(TipoDocumento.RUT_NATURAL, pn);
    const vPn = (await caso.procesar(idPn))!.instantanea();
    comprobar('queda en revisión, clasificado como RUT de persona natural, familia rut', vPn.estado === 'revision' && vPn.tipoDetectado === 'rut_persona_natural' && vPn.familiaDocumento === 'rut' && vPn.tipoPersona === 'natural', JSON.stringify([vPn.estado, vPn.tipoDetectado]));
    comprobar('método texto, confianza 1, lectura no dudosa, hash del archivo', vPn.metodoLectura === 'texto' && vPn.confianza === 1 && !vPn.lecturaDudosa && vPn.hashDocumento === calcularSha256(pn));
    comprobar('expectativa coincide', vPn.expectativa === 'coincide');
    const filaPn = (await ds.query('SELECT datos_extraidos, autenticidad, autenticidad_estado, procesada_en FROM validaciones_documento_empresarial WHERE documento_id = $1', [idPn]))[0];
    comprobar('datos minimizados guardados (NIT, nombres, DIVIPOLA, fecha)', filaPn.datos_extraidos.nit === '1000000001' && filaPn.datos_extraidos.nombres === 'MARIA FERNANDA' && filaPn.datos_extraidos.divipolaMunicipio === '25290' && filaPn.datos_extraidos.fechaGeneracion === '2024-03-15');
    const textoBd = JSON.stringify(filaPn);
    comprobar('NO se guardó dirección, correo, teléfono ni el código del QR', !/CALLE FALSA|persona\.demo|3000000000|SECRETO/.test(textoBd));
    comprobar('autenticidad no_verificable con QR hacia la DIAN registrado', filaPn.autenticidad_estado === 'no_verificable' && filaPn.autenticidad.qrDecodificado === true && filaPn.autenticidad.qrDestinoOficial === true && filaPn.autenticidad.firmaPdfValida === null);
    comprobar('procesada_en quedó registrada', filaPn.procesada_en !== null);
    const evs = await ds.query('SELECT tipo, intento, hash_documento, actor_id, datos FROM evidencias_validacion_doc_empresarial WHERE validacion_id = $1 ORDER BY tipo', [vPn.id]);
    comprobar('dos evidencias: clasificacion y lectura_documento, con hash y sin actor', evs.length === 2 && evs[0].tipo === 'clasificacion' && evs[1].tipo === 'lectura_documento' && evs.every((e: { hash_documento: string; actor_id: string | null }) => e.hash_documento === vPn.hashDocumento && e.actor_id === null), JSON.stringify(evs.map((e: { tipo: string }) => e.tipo)));
    comprobar('las evidencias no llevan texto, imágenes ni datos personales', !/CALLE FALSA|persona\.demo|MARIA|1000000001/.test(JSON.stringify(evs)));

    console.log('\n— Idempotencia —');
    const otra = (await caso.procesar(idPn))!.instantanea();
    const [{ n: nVal }] = await ds.query('SELECT count(*)::int AS n FROM validaciones_documento_empresarial WHERE documento_id = $1', [idPn]);
    const [{ n: nEv }] = await ds.query('SELECT count(*)::int AS n FROM evidencias_validacion_doc_empresarial WHERE validacion_id = $1', [vPn.id]);
    comprobar('repetir el procesamiento no duplica la validación ni las evidencias y no pisa el resultado', nVal === 1 && nEv === 2 && otra.version === vPn.version, `${nVal}/${nEv}/${otra.version}`);
    const concurrentes = await Promise.all(Array.from({ length: 6 }, async () => {
      const id = await cargar(TipoDocumento.RUT_JURIDICO, await pdfRutSintetico({ persona: 'juridica', razonSocial: `EMPRESA ${randomUUID().slice(0, 4).toUpperCase()}` }));
      return [id, await Promise.all(Array.from({ length: 4 }, () => caso.procesar(id)))] as const;
    }));
    let bien = true;
    for (const [id] of concurrentes) {
      const [{ n }] = await ds.query('SELECT count(*)::int AS n FROM validaciones_documento_empresarial WHERE documento_id = $1', [id]);
      const [{ ne }] = await ds.query('SELECT count(*)::int AS ne FROM evidencias_validacion_doc_empresarial e JOIN validaciones_documento_empresarial v ON v.id = e.validacion_id WHERE v.documento_id = $1', [id]);
      if (n !== 1 || ne !== 2) bien = false;
    }
    comprobar('procesar el mismo RUT 4 veces a la vez (×6 documentos): una fila y dos evidencias por documento', bien);

    console.log('\n— Persona distinta a la esperada —');
    const pj = await pdfRutSintetico({ persona: 'juridica', razonSocial: 'DEMO PERSONA DISTINTA SAS' });
    const idPj = await cargar(TipoDocumento.RUT_NATURAL, pj);
    const vPj = (await caso.procesar(idPj))!.instantanea();
    comprobar('un RUT jurídico cargado como natural: detectado jurídico, expectativa persona_distinta, sin reclasificar', vPj.tipoEsperado === 'rut_natural' && vPj.tipoDetectado === 'rut_persona_juridica' && vPj.expectativa === 'persona_distinta' && vPj.tipoPersona === 'juridica');

    console.log('\n— Duplicado exacto (misma práctica y tipo) —');
    const idDup = await cargar(TipoDocumento.RUT_NATURAL, pn);
    const vDup = (await caso.procesar(idDup))!.instantanea();
    comprobar('se reporta duplicado_de_documento_id y el documento se lee igual', vDup.duplicadoDeDocumentoId === idPn && vDup.estado === 'revision' && vDup.tipoDetectado === 'rut_persona_natural', String(vDup.duplicadoDeDocumentoId));
    const [{ n: nDocs }] = await ds.query('SELECT count(*)::int AS n FROM documentos WHERE id = ANY($1)', [[idPn, idDup]]);
    comprobar('nada se borra', nDocs === 2);

    console.log('\n— Documento que no es un RUT, y lectura fallida —');
    const idMalo = await cargar(TipoDocumento.RUT_NATURAL, Buffer.from('esto no es un pdf'));
    const vMalo = (await caso.procesar(idMalo))!.instantanea();
    comprobar('un archivo ilegible queda en error con un código (no con el mensaje)', vMalo.estado === 'error' && !!vMalo.errorCodigo && vMalo.tipoDetectado === null, `${vMalo.estado}/${vMalo.errorCodigo}`);
  } finally {
    await lector.onModuleDestroy();
    await ds.destroy();
  }
  console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}`);
  process.exit(fallos === 0 ? 0 : 1);
}

void main();
