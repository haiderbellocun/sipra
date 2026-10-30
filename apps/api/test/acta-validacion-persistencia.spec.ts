import { ValidacionActaUseCase } from '../src/application/use-cases/documentos/validacion-acta.use-case';
import { DatosDocumento, Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import { CicloAcademico, DatosPractica, EstadoPractica, Practica } from '../src/domain/entities/practica.entity';
import { Usuario } from '../src/domain/entities/usuario.entity';
import {
  EstadoValidacionActa, EvidenciaActa, EvidenciaActaInvalidaError, TipoEvidenciaActa,
  ValidacionActa,
} from '../src/domain/entities/validacion-acta.entity';
import { DocumentosMemoria, ValidacionesActaMemoria } from './soporte-mesa-actas';
import { Rol } from '../src/domain/value-objects/rol.vo';
import {
  TEXTO_ARCHIVO_CUALQUIERA, TEXTO_CEDULA, VALORES_BASE, actaSintetica, lecturaPersistibleSintetica, OpcionesActa,
  OpcionesLecturaSintetica,
} from './soporte-acta';

const AHORA = new Date('2026-08-10T15:00:00.000Z');
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Repositorio en memoria con la misma semántica que la base (compartido con las pruebas de la Mesa). */
class RepoValidaciones extends ValidacionesActaMemoria {
  constructor() { super({ documentos: new DocumentosMemoria(), practicas: new Map(), usuarios: new Map() }); }
}

const estudiante = Usuario.desde({
  id: 'est-1', correo: 'ana@estudiante.cun.edu.co', nombre: VALORES_BASE.nombre, documento: '1000000001',
  rol: Rol.ESTUDIANTE, permiso: 'escritura', escuelas: ['ESC-NEG'], empresaId: null, programaId: 'ADM-PRO',
  activo: true, creadoEn: AHORA, ultimoAccesoEn: null,
});

function practicaSintetica(cambios: Partial<DatosPractica> = {}): Practica {
  return Practica.desde({
    id: 'prac-1', numeroFur: 1, estudianteId: 'est-1', programaId: 'ADM-PRO', escuelaId: 'ESC-NEG', regional: null, asignatura: null,
    ciclo: CicloAcademico.PROFESIONAL, periodoAcademico: '2026C', modalidad: ModalidadPractica.CONTRATO_APRENDIZAJE,
    estado: EstadoPractica.INSCRITA, tutorId: null, empresaId: null, empresaRazonSocial: 'Empresa Sintética SAS',
    empresaNit: '900123456-8', area: 'x', cargo: 'x', tipoRemuneracion: 'no_remunerada', salario: null, horario: null,
    jefeInmediatoNombre: 'Laura Jefe Ficticia', jefeInmediatoCargo: null, jefeInmediatoCorreo: null, jefeInmediatoTelefono: null,
    ciudad: null, funcionesRelevantes: 'Apoyo en gestión documental y atención de solicitudes internas', fechaInicio: dia('2026-03-17'),
    fechaFin: dia('2026-09-17'), horasRegistradas: null, arlVerificada: false, arlFechaAfiliacion: null, responsableArlPractica: 'empresa',
    terminosAceptadosEn: AHORA, registradaPor: 'estudiante', nota: null, cerradaEn: null, ultimaActividad: AHORA, creadaEn: AHORA,
    actualizadaEn: AHORA, ...cambios,
  });
}

function documentoActa(id: string, version: number, lectura: ReturnType<typeof lecturaPersistibleSintetica> | null, estado = EstadoDocumento.EN_REVISION): Documento {
  const datos: DatosDocumento = {
    id, practicaId: 'prac-1', tipo: TipoDocumento.ACTA_INICIO, version, estado, nombreOriginal: 'acta.pdf', mimeReal: 'application/pdf',
    tamanoBytes: 1000, hashSha256: 'a'.repeat(64), hashPerceptual: null, rutaAlmacenamiento: `r/${id}.pdf`, calidadCaptura: null,
    banderas: [], puntaje: 90, banda: null, extraccion: lectura ? ({ lecturaActa: lectura }) : null,
    decididoPor: null, justificacionDecision: null, motivoDevolucion: null, cargadoEn: AHORA, actualizadoEn: AHORA, purgarDespuesDe: null,
  };
  return Documento.desde(datos);
}

function armar(practica: Practica = practicaSintetica()) {
  const repo = new RepoValidaciones();
  const auditorias: { accion: string; metadatos: Record<string, unknown> | null }[] = [];
  const documentos = new Map<string, Documento>();
  const practicas = { buscarPorId: async (id: string) => (id === practica.id ? practica : null) };
  const caso = new ValidacionActaUseCase(
    repo,
    { buscarPorId: async (id: string) => documentos.get(id) ?? null } as never,
    practicas as never,
    { buscarPorId: async (id: string) => (id === 'est-1' ? estudiante : null) } as never,
    { buscarPorId: async () => null } as never,
    { registrar: async (r: { accion: string; metadatos: Record<string, unknown> | null }) => { auditorias.push(r); } } as never,
    { buscarPorDocumento: async () => ({ programaNombre: 'Administración de Empresas' }) } as never,
  );
  return { caso, repo, auditorias, documentos, practica };
}

const lectura = (o: OpcionesActa = {}, l: OpcionesLecturaSintetica = {}) => lecturaPersistibleSintetica(actaSintetica(o), l);
const FIRMAS = { firmaEmpresaPresente: 'si', firmaPracticantePresente: 'si' } as const;
const campo = (v: ValidacionActa, nombre: string) => v.instantanea().comparacion!.campos.find((c) => c.campo === nombre)!;

describe('Acta de iniciación · validación persistida', () => {
  describe('comparación contra las fuentes canónicas de SIPRA', () => {
    it('7 · el acta coincide → queda en revisión (nunca aprobada), con su comparación consistente', async () => {
      const { caso, documentos } = armar();
      const doc = documentoActa('doc-1', 1, lectura({ encabezadoArl: 'empresa', obligacionArl: 'empresa' }, { firmas: FIRMAS }));
      documentos.set('doc-1', doc);
      const v = (await caso.registrarProcesamiento(doc, AHORA))!.instantanea();
      expect(v.estado).toBe(EstadoValidacionActa.REVISION);
      expect(v.tipoActaDetectada).toBe('iniciacion_practicas');
      expect(v.remuneracionDetectada).toBe('no_remunerada');
      expect(v.responsableArlDetectado).toBe('empresa');
      expect([v.firmaEmpresa, v.firmaPracticante]).toEqual(['si', 'si']);
      expect(v.comparacion?.veredicto).toBe('consistente');
      expect(v.hayDiscrepanciaCritica).toBe(false);
      expect(v.decididoPor).toBeNull();
    });

    it('8 · responsable de la ARL distinto (SIPRA: CUN, acta: empresa) → diferente y crítico; la remuneración coincide', async () => {
      const { caso, practica } = armar(practicaSintetica({ responsableArlPractica: 'cun' }));
      const doc = documentoActa('doc-1', 1, lectura({ encabezadoArl: 'empresa', obligacionArl: 'empresa' }));
      const v = (await caso.registrarProcesamiento(doc, AHORA))!;
      expect(campo(v, 'remuneracion')).toMatchObject({ resultado: 'coincide' });
      expect(campo(v, 'responsable_arl')).toMatchObject({ resultado: 'diferente', criticidad: 'critica' });
      expect(v.instantanea().hayDiscrepanciaCritica).toBe(true);
      expect(v.instantanea().comparacion?.veredicto).toBe('revision_necesaria');
      // El acta no modifica a SIPRA.
      expect(practica.responsableArlPractica).toBe('cun');
    });

    it('9 · remuneración distinta → diferente y crítica', async () => {
      const { caso } = armar(practicaSintetica({ tipoRemuneracion: 'remunerada' }));
      const v = (await caso.registrarProcesamiento(documentoActa('doc-1', 1, lectura({ remuneracion: 'no_remunerada' })), AHORA))!;
      expect(campo(v, 'remuneracion')).toMatchObject({ resultado: 'diferente', criticidad: 'critica' });
      expect(campo(v, 'responsable_arl').resultado).toBe('coincide');
    });

    it('10 · remuneración y responsable de la ARL distintos a la vez → las dos discrepancias críticas', async () => {
      const { caso } = armar(practicaSintetica({ tipoRemuneracion: 'remunerada', responsableArlPractica: 'cun' }));
      const v = (await caso.registrarProcesamiento(documentoActa('doc-1', 1, lectura({ remuneracion: 'no_remunerada', encabezadoArl: 'empresa', obligacionArl: 'empresa' })), AHORA))!;
      const criticas = v.instantanea().comparacion!.discrepancias.filter((d) => d.severidad === 'critica').map((d) => d.codigo);
      expect(criticas).toEqual(expect.arrayContaining(['REMUNERACION_DIFERENTE', 'RESPONSABLE_ARL_DIFERENTE']));
    });

    it('4 · práctica histórica con responsable ARL null → información insuficiente; NO se infiere de la modalidad', async () => {
      // La pasantía sugiere «empresa» por catálogo, y el acta dice «empresa»: aun así no hay con qué comparar.
      const { caso } = armar(practicaSintetica({ responsableArlPractica: null, modalidad: ModalidadPractica.PASANTIA }));
      const v = (await caso.registrarProcesamiento(documentoActa('doc-1', 1, lectura({ encabezadoArl: 'empresa', obligacionArl: 'empresa' })), AHORA))!;
      expect(campo(v, 'responsable_arl').resultado).toBe('informacion_insuficiente');
      expect(v.instantanea().comparacion?.veredicto).toBe('revision_necesaria');
    });

    it('una práctica sin remuneración registrada no «coincide» con el acta', async () => {
      const { caso } = armar(practicaSintetica({ tipoRemuneracion: null }));
      const v = (await caso.registrarProcesamiento(documentoActa('doc-1', 1, lectura()), AHORA))!;
      expect(campo(v, 'remuneracion').resultado).toBe('informacion_insuficiente');
    });
  });

  describe('lo que no es un acta o no se pudo leer', () => {
    it('11 · documento incorrecto: se persiste como tal y NO se llenan remuneración, ARL, firmas ni datos', async () => {
      const { caso } = armar();
      const v = (await caso.registrarProcesamiento(documentoActa('doc-1', 1, lecturaPersistibleSintetica(TEXTO_CEDULA)), AHORA))!.instantanea();
      expect(v.estado).toBe(EstadoValidacionActa.REVISION);
      expect(v.tipoActaDetectada).toBe('documento_incorrecto');
      expect([v.remuneracionDetectada, v.responsableArlDetectado, v.firmaEmpresa, v.firmaPracticante])
        .toEqual(['no_determinable', 'no_determinable', 'no_determinable', 'no_determinable']);
      expect(v.comparacion).toBeNull();
      // Lo «extraído» de otro documento (una cédula) no se conserva.
      expect(v.datosExtraidos).toBeNull();
      expect(JSON.stringify(v)).not.toContain('1.000.000.001');
      expect(v.motivosClasificacion).toContain('cedula');
    });

    it('12 · lectura no determinable (OCR insuficiente) → se persiste como no_determinable, sin rechazo', async () => {
      const { caso } = armar();
      const v = (await caso.registrarProcesamiento(documentoActa('doc-1', 1, lecturaPersistibleSintetica('xx ## 12', { metodo: 'ocr', confianzaOcr: 20 })), AHORA))!.instantanea();
      expect(v.tipoActaDetectada).toBe('no_determinable');
      expect(v.estado).toBe(EstadoValidacionActa.REVISION);
      expect([EstadoValidacionActa.RECHAZADO, EstadoValidacionActa.DEVUELTO]).not.toContain(v.estado);
      expect(v.metodoLectura).toBe('ocr');
      expect(v.confianza).toBeCloseTo(0.2, 3);
      expect(v.comparacion).toBeNull();
    });

    it('un archivo cualquiera con texto legible también es «documento incorrecto»', async () => {
      const { caso } = armar();
      const v = (await caso.registrarProcesamiento(documentoActa('doc-1', 1, lecturaPersistibleSintetica(TEXTO_ARCHIVO_CUALQUIERA)), AHORA))!.instantanea();
      expect(v.tipoActaDetectada).toBe('documento_incorrecto');
    });

    it('sin lectura automática (límite, interruptor, fallo) → no_determinable, no incorrecto', async () => {
      const { caso } = armar();
      const v = (await caso.registrarProcesamiento(documentoActa('doc-1', 1, null), AHORA))!.instantanea();
      expect(v.tipoActaDetectada).toBe('no_determinable');
      expect(v.motivosClasificacion).toEqual(['sin_lectura_automatica']);
      expect(v.metodoLectura).toBeNull();
    });
  });

  describe('idempotencia y versionado', () => {
    it('14 y 15 · repetir el procesamiento no crea otra validación, ni otras evidencias, ni otra auditoría', async () => {
      const { caso, repo, auditorias } = armar();
      const doc = documentoActa('doc-1', 1, lectura());
      const a = await caso.registrarProcesamiento(doc, AHORA);
      const b = await caso.registrarProcesamiento(doc, new Date(AHORA.getTime() + 60_000));
      const c = await caso.registrarProcesamiento(doc, new Date(AHORA.getTime() + 120_000));
      expect(repo.filas.size).toBe(1);
      expect([b!.id, c!.id]).toEqual([a!.id, a!.id]);
      expect(repo.evid).toHaveLength(5);
      expect(auditorias.filter((x) => x.accion === 'acta_procesada')).toHaveLength(1);
      expect(b!.instantanea().procesadaEn).toEqual(AHORA);
    });

    it('15b · si se interrumpe tras guardar las evidencias y antes del estado, el reintento completa sin duplicarlas', async () => {
      const { caso, repo, auditorias } = armar();
      const doc = documentoActa('doc-1', 1, lectura());
      repo.fallarCasDeResultado = 1;
      await expect(caso.registrarProcesamiento(doc, AHORA)).rejects.toThrow('interrupción simulada');
      expect(repo.evid).toHaveLength(5);
      expect([...repo.filas.values()][0].estado).toBe(EstadoValidacionActa.PROCESANDO);
      expect(auditorias).toHaveLength(0);
      const v = (await caso.registrarProcesamiento(doc, AHORA))!.instantanea();
      expect(v.estado).toBe(EstadoValidacionActa.REVISION);
      expect(repo.filas.size).toBe(1);
      expect(repo.evid).toHaveLength(5); // misma ronda: nada duplicado
      expect(v.intentos).toBe(1);
      expect(auditorias.filter((x) => x.accion === 'acta_procesada')).toHaveLength(1);
    });

    it('un error de procesamiento se reanuda en una ronda NUEVA (las evidencias de la anterior no se tocan)', async () => {
      const { caso, repo, documentos } = armar();
      const doc = documentoActa('doc-1', 1, lectura());
      documentos.set('doc-1', doc);
      await caso.marcarProcesando('doc-1', AHORA);
      await caso.marcarErrorProcesamiento('doc-1', 'PROCESAMIENTO_FALLIDO', AHORA);
      expect([...repo.filas.values()][0]).toMatchObject({ estado: EstadoValidacionActa.ERROR, errorCodigo: 'PROCESAMIENTO_FALLIDO', intentos: 1 });
      await caso.marcarProcesando('doc-1', AHORA);
      const v = (await caso.registrarProcesamiento(doc, AHORA))!.instantanea();
      expect(v).toMatchObject({ estado: EstadoValidacionActa.REVISION, intentos: 2, errorCodigo: null });
      expect(repo.filas.size).toBe(1);
    });

    it('13 y 6 · una versión nueva del acta tiene su propia validación, evidencias y resultado; la anterior queda histórica', async () => {
      const { caso, repo, practica, documentos } = armar();
      const v1doc = documentoActa('doc-v1', 1, lectura({ encabezadoArl: 'empresa', obligacionArl: 'empresa' }, { firmas: FIRMAS }));
      const v2doc = documentoActa('doc-v2', 2, lectura({ encabezadoArl: 'cun', obligacionArl: 'institucion' }));
      documentos.set('doc-v1', v1doc); documentos.set('doc-v2', v2doc);
      const v1 = (await caso.registrarProcesamiento(v1doc, AHORA))!;
      const v1Antes = JSON.stringify(v1.instantanea());
      const v2 = (await caso.registrarProcesamiento(v2doc, new Date(AHORA.getTime() + 3_600_000)))!;

      expect(repo.filas.size).toBe(2);
      expect(v2.id).not.toBe(v1.id);
      expect(v1.instantanea().documentoId).toBe('doc-v1');
      expect(v2.instantanea().documentoId).toBe('doc-v2');
      // Resultados propios: la v1 coincide con SIPRA (empresa) y la v2 dice otra cosa (CUN). Nada se copia de una a otra.
      expect(v1.instantanea().responsableArlDetectado).toBe('empresa');
      expect(v2.instantanea().responsableArlDetectado).toBe('cun');
      expect(campo(v1, 'responsable_arl').resultado).toBe('coincide');
      expect(campo(v2, 'responsable_arl').resultado).toBe('diferente');
      expect([v1.instantanea().firmaEmpresa, v2.instantanea().firmaEmpresa]).toEqual(['si', 'no_determinable']);
      expect((await repo.listarEvidencias(v1.id))).toHaveLength(5);
      expect((await repo.listarEvidencias(v2.id))).toHaveLength(5);
      // La v1 sigue exactamente como estaba.
      expect(JSON.stringify((await repo.buscarPorDocumento('doc-v1'))!.instantanea())).toBe(v1Antes);
      // 6 · reenviar el acta no cambia los valores canónicos de SIPRA.
      expect(practica.instantanea()).toMatchObject({ tipoRemuneracion: 'no_remunerada', responsableArlPractica: 'empresa' });
    });
  });

  describe('minimización', () => {
    it('16 · el texto del documento (OCR o nativo) no se persiste: ni en la validación ni en las evidencias', async () => {
      const { caso, repo } = armar();
      const doc = documentoActa('doc-1', 1, lectura({}, { metodo: 'ocr', confianzaOcr: 88 }));
      const v = (await caso.registrarProcesamiento(doc, AHORA))!;
      const todo = JSON.stringify([v.instantanea(), repo.evid]);
      for (const frase of ['Afiliar el estudiante', 'OBLIGACIONES DE LA EMPRESA', 'CAUSAS DE TERMINACI', 'exige como requisito', 'sufragar los gastos']) {
        expect(todo).not.toContain(frase);
      }
      expect(todo).not.toMatch(/"texto(_ocr|_nativo)?"/);
    });

    it('solo se conservan los campos útiles a la comparación y la revisión (nada de dirección, teléfonos ni documentos de terceros)', async () => {
      const { caso } = armar();
      const v = (await caso.registrarProcesamiento(documentoActa('doc-1', 1, lectura()), AHORA))!.instantanea();
      const guardados = Object.keys(v.datosExtraidos!.campos).sort();
      expect(guardados).toEqual(expect.arrayContaining(['nombre_estudiante', 'documento_estudiante', 'empresa', 'nit', 'fecha_inicio', 'fecha_fin']));
      for (const excluido of ['direccion_estudiante', 'barrio', 'telefono_estudiante', 'telefono_empresa', 'direccion_practica', 'documento_representante', 'documento_jefe', 'lugar_expedicion', 'semestre', 'ciudad', 'departamento']) {
        expect(guardados).not.toContain(excluido);
      }
      const texto = JSON.stringify(v);
      for (const dato of [VALORES_BASE.direccion, VALORES_BASE.telefono, VALORES_BASE.telefonoEmpresa, VALORES_BASE.documentoRepresentante, VALORES_BASE.documentoJefe]) {
        expect(texto).not.toContain(dato);
      }
    });

    it('la comparación persistida no copia los valores de SIPRA (son canónicos en Usuario/Práctica/Empresa)', async () => {
      const { caso } = armar(practicaSintetica({ empresaRazonSocial: 'Razón Social Única Canónica SAS' }));
      const v = (await caso.registrarProcesamiento(documentoActa('doc-1', 1, lectura()), AHORA))!.instantanea();
      expect(JSON.stringify(v.comparacion)).not.toContain('Razón Social Única Canónica');
      expect(Object.keys(v.comparacion!.campos[0]).sort()).toEqual(['campo', 'criticidad', 'nota', 'resultado']);
    });

    it('17 · las firmas se guardan solo como si / no / no_determinable: sin imagen ni autenticidad', async () => {
      const { caso, repo } = armar();
      const v = (await caso.registrarProcesamiento(documentoActa('doc-1', 1, lectura({}, { firmas: { firmaEmpresaPresente: 'si', firmaPracticantePresente: 'no' } })), AHORA))!.instantanea();
      expect([v.firmaEmpresa, v.firmaPracticante]).toEqual(['si', 'no']);
      const medicion = repo.evid.find((e) => e.tipo === TipoEvidenciaActa.MEDICION_FIRMAS)!;
      expect(Object.keys(medicion.datos).sort()).toEqual(['empresaLocalizada', 'firmaEmpresa', 'firmaPracticante', 'motivos', 'pagina', 'practicanteLocalizada']);
      expect(JSON.stringify(medicion)).not.toMatch(/imagen|base64|autentic/i);
    });

    it('una evidencia con texto del documento o imagen de firma se rechaza en el dominio', () => {
      const base = {
        id: 'e', validacionActaId: 'v', intento: 1, tipo: TipoEvidenciaActa.LECTURA_DOCUMENTO, resultado: 'leido', metodo: 'x', fecha: AHORA,
        actorId: null, hashDocumento: null, errorCodigo: null, creadoEn: AHORA,
      };
      expect(() => EvidenciaActa.crear({ ...base, datos: { texto_ocr: 'hola' } })).toThrow(EvidenciaActaInvalidaError);
      expect(() => EvidenciaActa.crear({ ...base, datos: { imagen_firma: 'AAAA' } })).toThrow(EvidenciaActaInvalidaError);
      expect(() => EvidenciaActa.crear({ ...base, tipo: TipoEvidenciaActa.DECISION_HUMANA, datos: {} })).toThrow(EvidenciaActaInvalidaError);
      expect(() => EvidenciaActa.crear({ ...base, hashDocumento: 'no-es-un-hash', datos: {} })).toThrow(EvidenciaActaInvalidaError);
    });
  });

  describe('auditoría y decisiones', () => {
    it('audita UNA entrada «acta_procesada» por procesamiento, con códigos y conteos (sin datos del documento)', async () => {
      const { caso, auditorias } = armar();
      await caso.registrarProcesamiento(documentoActa('doc-1', 1, lectura({}, { firmas: FIRMAS })), AHORA);
      expect(auditorias).toHaveLength(1);
      expect(auditorias[0].accion).toBe('acta_procesada');
      expect(auditorias[0].metadatos).toMatchObject({ tipoActa: 'iniciacion_practicas', remuneracion: 'no_remunerada', responsableArl: 'empresa', veredicto: 'consistente', discrepanciasCriticas: 0 });
      expect(JSON.stringify(auditorias[0])).not.toContain(VALORES_BASE.nombre);
    });

    it('no procesa documentos de otro tipo ni mientras el pipeline no terminó', async () => {
      const { caso, repo } = armar();
      const otro = Documento.desde({ ...documentoActa('doc-x', 1, null).instantanea(), tipo: TipoDocumento.CERTIFICADO_EPS });
      expect(await caso.registrarProcesamiento(otro, AHORA)).toBeNull();
      expect(await caso.registrarProcesamiento(documentoActa('doc-y', 1, lectura(), EstadoDocumento.ANALIZANDO), AHORA)).toBeNull();
      expect(repo.filas.size).toBe(0);
    });
  });
});
