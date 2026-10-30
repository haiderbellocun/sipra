import { BadRequestException, ForbiddenException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { ReportesSgpUseCase } from '../src/application/use-cases/reportes/reportes-sgp.use-case';
import { DatosEntradaBitacora, EntradaBitacora, PREGUNTAS_EVALUA_TU_PROCESO, TipoEntradaBitacora } from '../src/domain/entities/bitacora.entity';
import { CartaPresentacion, DatosCarta } from '../src/domain/entities/carta-presentacion.entity';
import { DatosDocumento, Documento, EstadoDocumento, TipoDocumento } from '../src/domain/entities/documento.entity';
import { ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import { CicloAcademico, DatosPractica, EstadoPractica, Practica } from '../src/domain/entities/practica.entity';
import { DatosUsuario, Usuario } from '../src/domain/entities/usuario.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { ExcelJsAdapter } from '../src/infrastructure/adapters/hojas/exceljs.adapter';

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const HOY = dia('2026-09-15');

const usuario = (s: Partial<DatosUsuario>): DatosUsuario => ({
  id: 'u', correo: 'x@cun.edu.co', nombre: 'X', documento: null, rol: Rol.TUTOR, permiso: 'escritura', escuelas: [],
  empresaId: null, programaId: null, activo: true, creadoEn: HOY, ultimoAccesoEn: null, ...s,
});
const usuarios: Record<string, DatosUsuario> = {
  'est-1': usuario({ id: 'est-1', correo: 'laura@estudiante.cun.edu.co', nombre: 'Laura Ramírez', documento: '1032456786', rol: Rol.ESTUDIANTE, programaId: 'ADM-PRO' }),
  'doc-1': usuario({ id: 'doc-1', correo: 'carlos@cun.edu.co', nombre: 'Carlos Pérez', documento: '79654321', rol: Rol.TUTOR, escuelas: ['ESC-NEG'] }),
};

const practica: DatosPractica = {
  id: 'p1', numeroFur: 12, estudianteId: 'est-1', programaId: 'ADM-PRO', escuelaId: 'ESC-NEG', regional: 'Bogotá',
  asignatura: 'Práctica Profesional I', ciclo: CicloAcademico.PROFESIONAL, periodoAcademico: '2026C',
  modalidad: ModalidadPractica.PASANTIA, estado: EstadoPractica.ACTIVA, tutorId: 'doc-1', empresaId: null,
  empresaRazonSocial: 'Andina S.A.S.', empresaNit: '901458772', area: 'Logística', cargo: 'Practicante',
  tipoRemuneracion: 'remunerada', salario: 1423500, horario: 'L-V 8-5', jefeInmediatoNombre: 'Ana Ruiz',
  jefeInmediatoCargo: 'Líder', jefeInmediatoCorreo: 'ana@andina.co', jefeInmediatoTelefono: '3001112233', ciudad: 'Bogotá',
  funcionesRelevantes: 'Apoyo a compras', fechaInicio: dia('2026-08-10'), fechaFin: dia('2026-11-27'), horasRegistradas: null,
  arlVerificada: true, responsableArlPractica: null, arlFechaAfiliacion: dia('2026-08-05'), terminosAceptadosEn: dia('2026-08-03'), registradaPor: 'estudiante',
  nota: 4.5, cerradaEn: null, ultimaActividad: HOY, creadaEn: dia('2026-08-03'), actualizadaEn: HOY,
};
const documento = (s: Partial<DatosDocumento>): DatosDocumento => ({
  id: 'd', practicaId: 'p1', tipo: TipoDocumento.CEDULA, version: 1, estado: EstadoDocumento.APROBADO, nombreOriginal: 'x.pdf',
  mimeReal: 'application/pdf', tamanoBytes: 1, hashSha256: 'h', hashPerceptual: null, rutaAlmacenamiento: 'r', calidadCaptura: null,
  banderas: [], puntaje: null, banda: null, extraccion: null, decididoPor: 'doc-1', justificacionDecision: 'ok', motivoDevolucion: null,
  cargadoEn: dia('2026-08-12'), actualizadoEn: dia('2026-08-14'), purgarDespuesDe: null, ...s,
});
const documentos = [
  documento({ id: 'd1', tipo: TipoDocumento.CERTIFICADO_EPS }),
  documento({ id: 'd2', tipo: TipoDocumento.CERTIFICADO_ARL, estado: EstadoDocumento.EN_REVISION, decididoPor: null, cargadoEn: dia('2026-09-01') }),
];
const entrada = (s: Partial<DatosEntradaBitacora>): DatosEntradaBitacora => ({
  id: 'b', practicaId: 'p1', tipo: TipoEntradaBitacora.MENSAJE_LIBRE, autor: 'docente', autorId: 'doc-1', mensaje: 'Hola',
  detalle: null, venceEl: null, creadaEn: dia('2026-09-02'), ...s,
});
const entradas = [
  entrada({ id: 'b1', mensaje: 'Recuerde el plan' }),
  entrada({ id: 'b2', autor: 'estudiante', autorId: 'est-1', mensaje: 'Listo', creadaEn: dia('2026-09-05') }),
  entrada({
    id: 'b3', tipo: TipoEntradaBitacora.EVALUA_TU_PROCESO, autor: 'estudiante', autorId: 'est-1', mensaje: 'Evaluación',
    detalle: { respuestas: PREGUNTAS_EVALUA_TU_PROCESO.map((pregunta) => ({ pregunta, valor: 5 })), comentario: 'Muy bien' },
  }),
  entrada({ id: 'b4', tipo: TipoEntradaBitacora.CALIFICACION_DOCENTE, mensaje: '', detalle: { nota: 4.5, aprobada: true } }),
];
const carta: DatosCarta = {
  id: 'c1', numeroFur: 12, practicaId: 'p1', estudianteId: 'est-1', periodoAcademico: '2026C', modalidadCarta: 'con_empresa',
  empresaRazonSocial: 'Andina S.A.S.', contenido: { titulo: 't', encabezado: [], fechaLugar: '', parrafos: [], firma: [], pie: [] },
  hashSha256: 'h', generadaPor: 'est-1', generadaEn: new Date('2026-08-03T14:30:00.000Z'),
};

const coordinacion = { id: 'coo-1', correo: 'coordinacion@cun.edu.co', rol: Rol.COORDINADOR, permiso: 'consulta' as const, escuelas: [], empresaId: null };
const docenteOtraEscuela = { id: 'doc-9', correo: 'otro@cun.edu.co', rol: Rol.TUTOR, permiso: 'escritura' as const, escuelas: ['ESC-ING'], empresaId: null };

function armar() {
  const auditoria: Record<string, unknown>[] = [];
  const consultas: unknown[] = [];
  const caso = new ReportesSgpUseCase(
    {
      listar: async (f: { periodoAcademico?: string; escuelaIds?: string[] }) => {
        consultas.push(f);
        if (f.escuelaIds && !f.escuelaIds.includes('ESC-NEG')) return [];
        return f.periodoAcademico === '2026C' ? [Practica.desde(practica)] : [];
      },
      buscarPorId: async () => Practica.desde(practica),
    } as never,
    { listarPorPractica: async () => documentos.map((d) => Documento.desde(d)) } as never,
    {
      listarPorPractica: async () => entradas.map((e) => EntradaBitacora.desde(e)),
      listar: async (f: { tipo?: TipoEntradaBitacora }) => entradas.filter((e) => !f.tipo || e.tipo === f.tipo).map((e) => EntradaBitacora.desde(e)),
    } as never,
    { listar: async () => [CartaPresentacion.desde(carta)] } as never,
    { buscarPorId: async (id: string) => (usuarios[id] ? Usuario.desde(usuarios[id]) : null) } as never,
    { registrar: async (r: Record<string, unknown>) => { auditoria.push(r); } } as never,
    {
      buscarPorDocumento: async () => ({
        documentoEstudiante: '1032456786', nombreEstudiante: 'Laura Ramírez', correoInstitucional: 'laura@estudiante.cun.edu.co',
        programaId: 'ADM-PRO', programaNombre: 'Administración de Empresas', escuelaId: 'ESC-NEG', ciclo: 'profesional',
        periodoAcademico: '2026C', asignaturaPractica: 'Práctica Profesional I', codigoAsignatura: 'ADM-PP1', telefono: '3001234567',
        semestre: 8, pensum: 'ADM-2019',
      }),
    } as never,
    new ExcelJsAdapter(),
  );
  return { caso, auditoria, consultas };
}

describe('Reportes del SGP', () => {
  it('el reporte de prácticas trae los siete bloques del manual en su orden', async () => {
    const { caso } = armar();
    const t = await caso.reportePracticas({ periodos: ['2026C', '2026A'] }, coordinacion);
    expect(t.columnas.map((c) => c.encabezado).slice(0, 4)).toEqual(['Documento', 'Nombre del estudiante', 'Email del estudiante', 'Teléfono del estudiante']);
    expect(t.columnas.at(-1)?.encabezado).toBe('Último movimiento del docente');
    expect(t.filas).toHaveLength(1);
    expect(t.filas[0]).toMatchObject({
      documento: '1032456786', telefono: '3001234567', programa: 'Administración de Empresas', semestre: 8, pensum: 'ADM-2019',
      estado: 'En práctica', modalidadPractica: 'Pasantía', docente: 'Carlos Pérez', docenteDocumento: '79654321',
      nit: '901458772', salario: 1423500, jefeNombre: 'Ana Ruiz',
      documentosSubidos: 2, documentosAprobados: 1, registrosBitacora: 4,
      ultimoMovimientoEstudiante: dia('2026-09-05'), ultimoMovimientoDocente: dia('2026-09-02'),
    });
    await expect(caso.reportePracticas({ periodos: [] }, coordinacion)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el alcance acota la consulta: un docente de otra escuela no ve la práctica', async () => {
    const { caso, consultas } = armar();
    const t = await caso.reportePracticas({ periodos: ['2026C'] }, docenteOtraEscuela);
    expect(t.filas).toHaveLength(0);
    expect(consultas[0]).toMatchObject({ escuelaIds: ['ESC-ING'] });
    await expect(caso.reportePracticas({ periodos: ['2026C'] }, { ...coordinacion, rol: Rol.EMPRESA })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('el reporte «Evalúa tu proceso» abre una fila por pregunta y respuesta', async () => {
    const { caso } = armar();
    const t = await caso.reporteBitacoras({ tipo: 'evalua_tu_proceso', periodo: '2026C' }, coordinacion);
    expect(t.filas).toHaveLength(5); // 4 preguntas + comentario
    expect(t.filas[0]).toMatchObject({ codigoPractica: 12, tipo: 'Evalúa tu proceso', pregunta: PREGUNTAS_EVALUA_TU_PROCESO[0], respuesta: 5, autor: 'Laura Ramírez', perfil: 'estudiante' });
    expect(t.filas[4]).toMatchObject({ pregunta: 'Comentario', respuesta: 'Muy bien' });
  });

  it('mensaje libre y calificación docente salen con su columna de respuesta', async () => {
    const { caso } = armar();
    const libre = await caso.reporteBitacoras({ tipo: 'mensaje_libre' }, coordinacion);
    expect(libre.filas.map((f) => f.respuesta)).toEqual(['Recuerde el plan', 'Listo']);
    const calificacion = await caso.reporteBitacoras({ tipo: 'calificacion_docente' }, coordinacion);
    expect(calificacion.columnas.find((c) => c.clave === 'respuesta')?.encabezado).toBe('Respuesta / Calificación');
    expect(calificacion.filas[0]).toMatchObject({ pregunta: 'Calificación final (0,0 a 5,0)', respuesta: 4.5 });
  });

  it('el reporte de cartas trae número de FUR, fecha, hora, modalidad, estudiante y empresa', async () => {
    const { caso } = armar();
    const t = await caso.reporteCartas({ periodo: '2026C' }, coordinacion);
    expect(t.columnas.map((c) => c.encabezado)).toEqual([
      'Número de FUR', 'Fecha', 'Hora', 'Modalidad de carta', 'Documento del estudiante', 'Nombre del estudiante', 'Nombre de la empresa',
    ]);
    expect(t.filas[0]).toMatchObject({ numeroFur: 12, modalidadCarta: 'Con empresa', documento: '1032456786', empresa: 'Andina S.A.S.' });
    expect(t.filas[0].hora).toMatch(/09:30/);
  });

  it('el libro Excel se abre, conserva encabezados y valores, y queda en auditoría', async () => {
    const { caso, auditoria } = armar();
    const tabla = await caso.reporteCartas({}, coordinacion);
    const archivo = await caso.excel('Reporte de cartas', tabla, coordinacion, { periodo: null });
    expect(archivo.nombreArchivo).toMatch(/^reporte-de-cartas-\d{8}\.xlsx$/);
    expect(archivo.contenido.subarray(0, 2).toString('latin1')).toBe('PK');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(archivo.contenido as unknown as ExcelJS.Buffer);
    const hoja = libro.worksheets[0];
    expect(hoja.getRow(1).getCell(1).value).toBe('Número de FUR');
    expect(hoja.getRow(2).getCell(6).value).toBe('Laura Ramírez');
    expect(auditoria[0]).toMatchObject({ accion: 'reporte_generado', entidadId: null, metadatos: { reporte: 'Reporte de cartas', filas: 1 } });
  });
});
