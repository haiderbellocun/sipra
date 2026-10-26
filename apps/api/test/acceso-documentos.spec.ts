import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GestionarDocumentoUseCase } from '../src/application/use-cases/documentos/gestionar-documento.use-case';
import { AccionAuditada } from '../src/domain/entities/auditoria.entity';
import { Documento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { Practica } from '../src/domain/entities/practica.entity';
import {
  TIPOS_DEL_AUXILIAR, puedeCargarDocumentos, puedeConsultarDocumentos, puedeVerDocumento,
} from '../src/domain/value-objects/acceso-documental.vo';
import { Rol } from '../src/domain/value-objects/rol.vo';
import {
  ESC_A, ESC_B, actorDe, documentoDe, practicaDe, usuarioDe,
} from './soporte-autorizacion';

/**
 * Acceso a documentos por función Y por objeto: el rol decide si puede tocar
 * documentos; la práctica decide a cuáles; el tipo limita al auxiliar.
 */

const TODOS_LOS_TIPOS = Object.values(TipoDocumento);
const NO_OPERATIVOS = TODOS_LOS_TIPOS.filter((t) => !TIPOS_DEL_AUXILIAR.includes(t));

describe('Política de acceso documental (dominio)', () => {
  it('el auxiliar alcanza exactamente los documentos de su proceso', () => {
    expect([...TIPOS_DEL_AUXILIAR].sort()).toEqual([
      TipoDocumento.ACTA_INICIO, TipoDocumento.CAMARA_COMERCIO, TipoDocumento.CEDULA,
      TipoDocumento.CERTIFICADO_ARL, TipoDocumento.CERTIFICADO_EPS,
      TipoDocumento.RUT_JURIDICO, TipoDocumento.RUT_NATURAL,
    ].sort());
  });

  it.each(TIPOS_DEL_AUXILIAR)('auxiliar puede ver %s', (tipo) => {
    expect(puedeVerDocumento(Rol.AUXILIAR, tipo)).toBe(true);
  });

  it.each(NO_OPERATIVOS)('auxiliar NO puede ver %s', (tipo) => {
    expect(puedeVerDocumento(Rol.AUXILIAR, tipo)).toBe(false);
  });

  it.each([Rol.EMPRESA, Rol.EXTENSION])('%s no ve ningún tipo de documento', (rol) => {
    expect(puedeConsultarDocumentos(rol)).toBe(false);
    for (const tipo of TODOS_LOS_TIPOS) expect(puedeVerDocumento(rol, tipo)).toBe(false);
  });

  it.each([Rol.ESTUDIANTE, Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR])('%s ve todos los tipos', (rol) => {
    for (const tipo of TODOS_LOS_TIPOS) expect(puedeVerDocumento(rol, tipo)).toBe(true);
  });

  it('cargan documentos: estudiante, docente, coordinación y administración; nadie más', () => {
    const cargan = Object.values(Rol).filter(puedeCargarDocumentos).sort();
    expect(cargan).toEqual([Rol.ADMINISTRADOR, Rol.COORDINADOR, Rol.ESTUDIANTE, Rol.TUTOR].sort());
  });
});

// ── Caso de uso ────────────────────────────────────────────────────────────

interface Montaje {
  casoDeUso: GestionarDocumentoUseCase;
  consentimientos: { exigirParaCargar: jest.Mock };
  auditoria: { registrar: jest.Mock };
  almacen: { leer: jest.Mock; enlaceFirmado: jest.Mock; guardar: jest.Mock };
  documentos: { buscarPorId: jest.Mock; listarPorPractica: jest.Mock; guardar: jest.Mock };
}

function montar(practica: Practica = practicaDe(), usuarios: ReturnType<typeof usuarioDe>[] = []): Montaje {
  const todos: Documento[] = TODOS_LOS_TIPOS.map((t) => documentoDe(t));
  const documentos = {
    buscarPorId: jest.fn((id: string) => Promise.resolve(todos.find((d) => d.id === id) ?? null)),
    listarPorPractica: jest.fn().mockResolvedValue(todos),
    guardar: jest.fn(),
  };
  const practicas = { buscarPorId: jest.fn().mockResolvedValue(practica) };
  const usuariosRepo = {
    buscarPorId: jest.fn((id: string) => Promise.resolve(usuarios.find((u) => u.id === id) ?? null)),
  };
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const almacen = {
    leer: jest.fn().mockResolvedValue(Buffer.from('contenido')),
    enlaceFirmado: jest.fn().mockResolvedValue('/api/v1/documentos/descarga?x=1'),
    guardar: jest.fn(),
  };
  const consentimientos = { exigirParaCargar: jest.fn().mockResolvedValue(undefined) };
  const casoDeUso = new GestionarDocumentoUseCase(
    documentos as never, practicas as never, usuariosRepo as never, auditoria as never,
    almacen as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, consentimientos as never,
  );
  return { casoDeUso, consentimientos, auditoria, almacen, documentos };
}

const dueno = (rol: Rol, extra = {}) => actorDe(rol, extra);

describe('Documentos · listar', () => {
  it('estudiante: los documentos de su propia práctica', async () => {
    const { casoDeUso } = montar();
    const lista = await casoDeUso.listarPorPractica('practica-1', dueno(Rol.ESTUDIANTE, { id: 'estudiante-1' }));
    expect(lista).toHaveLength(TODOS_LOS_TIPOS.length);
  });

  it('estudiante: la práctica de otro estudiante → 404 genérico', async () => {
    const { casoDeUso } = montar();
    await expect(casoDeUso.listarPorPractica('practica-1', dueno(Rol.ESTUDIANTE, { id: 'otro-estudiante' })))
      .rejects.toThrow(NotFoundException);
  });

  it('tutor dentro de su alcance (escuela o asignado) → permitido', async () => {
    const { casoDeUso } = montar();
    await expect(casoDeUso.listarPorPractica('practica-1', dueno(Rol.TUTOR, { id: 't', escuelas: [ESC_A] })))
      .resolves.toHaveLength(TODOS_LOS_TIPOS.length);
    await expect(casoDeUso.listarPorPractica('practica-1', dueno(Rol.TUTOR, { id: 'tutor-asignado', escuelas: [] })))
      .resolves.toHaveLength(TODOS_LOS_TIPOS.length);
  });

  it('tutor fuera de su alcance → 404 genérico', async () => {
    const { casoDeUso } = montar();
    await expect(casoDeUso.listarPorPractica('practica-1', dueno(Rol.TUTOR, { id: 'otro', escuelas: [ESC_B] })))
      .rejects.toThrow(NotFoundException);
  });

  it('auxiliar: recibe solo los documentos de su proceso', async () => {
    const { casoDeUso } = montar();
    const lista = await casoDeUso.listarPorPractica('practica-1', dueno(Rol.AUXILIAR));
    expect(lista.map((d) => d.tipo).sort()).toEqual([...TIPOS_DEL_AUXILIAR].sort());
  });

  it.each([Rol.EMPRESA, Rol.EXTENSION])('%s → denegado aunque la práctica sea visible para su rol', async (rol) => {
    const { casoDeUso } = montar();
    await expect(casoDeUso.listarPorPractica('practica-1', dueno(rol, { empresaId: 'empresa-a' })))
      .rejects.toThrow(ForbiddenException);
  });
});

describe('Documentos · enlace', () => {
  it('estudiante: documento propio → enlace firmado para ese documento y ese usuario', async () => {
    const { casoDeUso, almacen } = montar();
    await casoDeUso.enlace('doc-cedula', 10, dueno(Rol.ESTUDIANTE, { id: 'estudiante-1' }));
    expect(almacen.enlaceFirmado).toHaveBeenCalledWith(
      { documentoId: 'doc-cedula', solicitanteId: 'estudiante-1' }, 10,
    );
  });

  it('estudiante: documento de otro → 404 y sin enlace', async () => {
    const { casoDeUso, almacen } = montar();
    await expect(casoDeUso.enlace('doc-cedula', 10, dueno(Rol.ESTUDIANTE, { id: 'otro-estudiante' })))
      .rejects.toThrow(NotFoundException);
    expect(almacen.enlaceFirmado).not.toHaveBeenCalled();
  });

  it('tutor dentro de su alcance → permitido; fuera → 404', async () => {
    const { casoDeUso } = montar();
    await expect(casoDeUso.enlace('doc-cedula', 10, dueno(Rol.TUTOR, { id: 't', escuelas: [ESC_A] }))).resolves.toBeDefined();
    await expect(casoDeUso.enlace('doc-cedula', 10, dueno(Rol.TUTOR, { id: 't', escuelas: [ESC_B] })))
      .rejects.toThrow(NotFoundException);
  });

  it.each([
    ['certificado de EPS', TipoDocumento.CERTIFICADO_EPS],
    ['documento de identificación', TipoDocumento.CEDULA],
    ['acta de inicio', TipoDocumento.ACTA_INICIO],
    ['RUT de persona natural', TipoDocumento.RUT_NATURAL],
    ['RUT de persona jurídica', TipoDocumento.RUT_JURIDICO],
    ['Cámara de Comercio', TipoDocumento.CAMARA_COMERCIO],
    ['certificado de ARL', TipoDocumento.CERTIFICADO_ARL],
  ])('auxiliar: %s → permitido', async (_nombre, tipo) => {
    const { casoDeUso } = montar();
    await expect(casoDeUso.enlace(`doc-${tipo}`, 10, dueno(Rol.AUXILIAR))).resolves.toHaveProperty('url');
  });

  it.each([
    TipoDocumento.PLAN_MEJORAMIENTO, TipoDocumento.CONTRATO_LABORAL, TipoDocumento.PLANILLA_APORTES,
    TipoDocumento.CONTRATO_APRENDIZAJE, TipoDocumento.CERTIFICADO_PRACTICA,
  ])('auxiliar: %s (no operativo) → 404 genérico, sin enlace y con auditoría de intento', async (tipo) => {
    const { casoDeUso, almacen, auditoria } = montar();
    await expect(casoDeUso.enlace(`doc-${tipo}`, 10, dueno(Rol.AUXILIAR))).rejects.toThrow(NotFoundException);
    expect(almacen.enlaceFirmado).not.toHaveBeenCalled();
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: AccionAuditada.ACCESO_FUERA_DE_ALCANCE }),
    );
  });

  it.each([Rol.EMPRESA, Rol.EXTENSION])('%s → denegado: sin documentos personales del estudiante', async (rol) => {
    const { casoDeUso, almacen } = montar();
    await expect(casoDeUso.enlace('doc-cedula', 10, dueno(rol, { empresaId: 'empresa-a' })))
      .rejects.toThrow(ForbiddenException);
    expect(almacen.enlaceFirmado).not.toHaveBeenCalled();
  });

  it('emitir el enlace NO registra una descarga', async () => {
    const { casoDeUso, auditoria } = montar();
    await casoDeUso.enlace('doc-cedula', 10, dueno(Rol.ESTUDIANTE, { id: 'estudiante-1' }));
    const acciones = auditoria.registrar.mock.calls.map(([r]: [{ accion: AccionAuditada }]) => r.accion);
    expect(acciones).toContain(AccionAuditada.DOCUMENTO_VISUALIZADO);
    expect(acciones).not.toContain(AccionAuditada.DOCUMENTO_DESCARGADO);
  });
});

describe('Documentos · cargar', () => {
  const archivo = { nombreOriginal: 'x.pdf', mimeDeclarado: 'application/pdf', contenido: Buffer.from('%PDF-1.4') };

  it.each([Rol.EMPRESA, Rol.EXTENSION, Rol.AUXILIAR])('%s no carga documentos', async (rol) => {
    const { casoDeUso, documentos, almacen } = montar();
    await expect(
      casoDeUso.cargar('practica-1', TipoDocumento.CEDULA, archivo, null, 10_000, dueno(rol, { empresaId: 'empresa-a' })),
    ).rejects.toThrow(ForbiddenException);
    expect(almacen.guardar).not.toHaveBeenCalled();
    expect(documentos.guardar).not.toHaveBeenCalled();
  });

  it('la compuerta de consentimiento se consulta con el estudiante dueño de la práctica', async () => {
    const { casoDeUso, consentimientos } = montar();
    await casoDeUso.cargar('practica-1', TipoDocumento.CEDULA, archivo, null, 10_000, dueno(Rol.TUTOR, { id: 't', escuelas: [ESC_A] }))
      .catch(() => undefined);
    expect(consentimientos.exigirParaCargar).toHaveBeenCalledWith('estudiante-1', 'practica-1');
  });

  it('si la compuerta rechaza (consentimiento exigido y ausente), no se guarda nada', async () => {
    const { casoDeUso, consentimientos, almacen, documentos } = montar();
    consentimientos.exigirParaCargar.mockRejectedValue(new ForbiddenException('Debe aceptar la política'));
    await expect(
      casoDeUso.cargar('practica-1', TipoDocumento.CEDULA, archivo, null, 10_000, dueno(Rol.ESTUDIANTE, { id: 'estudiante-1' })),
    ).rejects.toThrow(/Debe aceptar la política/);
    expect(almacen.guardar).not.toHaveBeenCalled();
    expect(documentos.guardar).not.toHaveBeenCalled();
  });

  it('estudiante ajeno a la práctica → 404 (no llega a cargar ni a la compuerta)', async () => {
    const { casoDeUso, almacen } = montar();
    await expect(
      casoDeUso.cargar('practica-1', TipoDocumento.CEDULA, archivo, null, 10_000, dueno(Rol.ESTUDIANTE, { id: 'otro' })),
    ).rejects.toThrow(NotFoundException);
    expect(almacen.guardar).not.toHaveBeenCalled();
  });
});

describe('Documentos · descarga real', () => {
  const origen = { ip: '10.0.0.7', agenteUsuario: 'navegador' };

  it('entrega el archivo y audita DOCUMENTO_DESCARGADO con el usuario del enlace', async () => {
    const { casoDeUso, auditoria, almacen } = montar(practicaDe(), [usuarioDe(Rol.ESTUDIANTE, { id: 'estudiante-1' })]);
    const contenido = await casoDeUso.descargar('doc-cedula', 'estudiante-1', origen);
    expect(contenido.toString()).toBe('contenido');
    expect(almacen.leer).toHaveBeenCalledWith('practicas/practica-1/cedula-v1.pdf');
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({
      accion: AccionAuditada.DOCUMENTO_DESCARGADO, entidad: 'documento', entidadId: 'doc-cedula',
      actorId: 'estudiante-1', actorRol: Rol.ESTUDIANTE, ip: '10.0.0.7', agenteUsuario: 'navegador',
    }));
  });

  it('el enlace no es un salvoconducto: usuario inactivo o inexistente → 404, sin archivo ni auditoría de descarga', async () => {
    const inactivo = montar(practicaDe(), [usuarioDe(Rol.ESTUDIANTE, { id: 'estudiante-1', activo: false })]);
    await expect(inactivo.casoDeUso.descargar('doc-cedula', 'estudiante-1', origen)).rejects.toThrow(NotFoundException);
    const inexistente = montar(practicaDe(), []);
    await expect(inexistente.casoDeUso.descargar('doc-cedula', 'fantasma', origen)).rejects.toThrow(NotFoundException);
    for (const m of [inactivo, inexistente]) {
      expect(m.almacen.leer).not.toHaveBeenCalled();
      expect(m.auditoria.registrar).not.toHaveBeenCalledWith(
        expect.objectContaining({ accion: AccionAuditada.DOCUMENTO_DESCARGADO }),
      );
    }
  });

  it('un rol sin acceso (empresa) con un enlace válido no descarga nada', async () => {
    const m = montar(practicaDe(), [usuarioDe(Rol.EMPRESA, { id: 'empresa-1', empresaId: 'empresa-a' })]);
    await expect(m.casoDeUso.descargar('doc-cedula', 'empresa-1', origen)).rejects.toThrow(NotFoundException);
    expect(m.almacen.leer).not.toHaveBeenCalled();
  });

  it('se reevalúa el alcance: el estudiante del enlace ya no es el dueño → 404', async () => {
    const m = montar(practicaDe({ estudianteId: 'otro-dueno' }), [usuarioDe(Rol.ESTUDIANTE, { id: 'estudiante-1' })]);
    await expect(m.casoDeUso.descargar('doc-cedula', 'estudiante-1', origen)).rejects.toThrow(NotFoundException);
    expect(m.almacen.leer).not.toHaveBeenCalled();
  });

  it('el auxiliar no descarga un tipo no operativo aunque tenga un enlace firmado', async () => {
    const m = montar(practicaDe(), [usuarioDe(Rol.AUXILIAR, { id: 'aux-1' })]);
    await expect(m.casoDeUso.descargar(`doc-${TipoDocumento.PLAN_MEJORAMIENTO}`, 'aux-1', origen))
      .rejects.toThrow(NotFoundException);
    expect(m.almacen.leer).not.toHaveBeenCalled();
  });

  it('si el almacenamiento falla no queda registrada ninguna descarga', async () => {
    const m = montar(practicaDe(), [usuarioDe(Rol.ESTUDIANTE, { id: 'estudiante-1' })]);
    m.almacen.leer.mockRejectedValue(new Error('bucket no disponible'));
    await expect(m.casoDeUso.descargar('doc-cedula', 'estudiante-1', origen)).rejects.toThrow('bucket no disponible');
    expect(m.auditoria.registrar).not.toHaveBeenCalledWith(
      expect.objectContaining({ accion: AccionAuditada.DOCUMENTO_DESCARGADO }),
    );
  });
});
