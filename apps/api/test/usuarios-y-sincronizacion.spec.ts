import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { GestionarUsuariosUseCase } from '../src/application/use-cases/administracion/gestionar-usuarios.use-case';
import { VistasSinuUseCase } from '../src/application/use-cases/administracion/vistas-sinu.use-case';
import { ModalidadPractica } from '../src/domain/entities/modalidad.entity';
import { PeriodoAcademico } from '../src/domain/entities/periodo.entity';
import { CicloAcademico, DatosPractica, EstadoPractica, Practica } from '../src/domain/entities/practica.entity';
import { DatosUsuario, Usuario } from '../src/domain/entities/usuario.entity';
import { AsignacionDocenteSinu, MatriculaSinu } from '../src/domain/ports/out/servicios-externos.port';
import { Rol } from '../src/domain/value-objects/rol.vo';

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const HOY = dia('2026-08-03');

class UsuariosEnMemoria {
  filas: DatosUsuario[] = [];
  async buscarPorId(id: string) { const d = this.filas.find((f) => f.id === id); return d ? Usuario.desde(d) : null; }
  async buscarPorCorreo(c: string) { const d = this.filas.find((f) => f.correo === c.toLowerCase()); return d ? Usuario.desde(d) : null; }
  async buscarPorDocumento(doc: string) { const d = this.filas.find((f) => f.documento === doc); return d ? Usuario.desde(d) : null; }
  async buscarTexto(t: string) { return this.filas.filter((f) => f.nombre.toLowerCase().includes(t.toLowerCase())).map((f) => Usuario.desde(f)); }
  async listarPorRol(rol: string) { return this.filas.filter((f) => (f.rol as string) === rol).map((f) => Usuario.desde(f)); }
  async listar(filtro: { roles?: readonly string[]; activo?: boolean } = {}) {
    return this.filas
      .filter((f) => !filtro.roles || filtro.roles.includes(f.rol))
      .filter((f) => filtro.activo === undefined || f.activo === filtro.activo)
      .map((f) => Usuario.desde(f));
  }
  async guardar(d: DatosUsuario) { this.filas = [...this.filas.filter((f) => f.id !== d.id), d]; return Usuario.desde(d); }
}

const usuario = (sobrescribir: Partial<DatosUsuario>): DatosUsuario => ({
  id: 'u', correo: 'x@cun.edu.co', nombre: 'X', documento: null, rol: Rol.TUTOR, permiso: 'escritura', escuelas: [],
  empresaId: null, programaId: null, activo: true, creadoEn: HOY, ultimoAccesoEn: null, ...sobrescribir,
});

const admin = { id: 'adm-1', correo: 'admin@cun.edu.co', rol: Rol.ADMINISTRADOR, permiso: 'escritura' as const, escuelas: [], empresaId: null };
const coordinacion = { id: 'coo-1', correo: 'coordinacion@cun.edu.co', rol: Rol.COORDINADOR, permiso: 'escritura' as const, escuelas: [], empresaId: null };
const coordinacionEscuela = { ...coordinacion, id: 'coo-2', escuelas: ['ESC-NEG'] };
const docente = { id: 'doc-1', correo: 'docente@cun.edu.co', rol: Rol.TUTOR, permiso: 'escritura' as const, escuelas: ['ESC-NEG'], empresaId: null };

describe('Gestión de usuarios administrativos', () => {
  function armar() {
    const usuarios = new UsuariosEnMemoria();
    const auditoria: string[] = [];
    const caso = new GestionarUsuariosUseCase(usuarios, { registrar: async (r: { accion: string }) => { auditoria.push(r.accion); } } as never);
    return { caso, usuarios, auditoria };
  }
  const nuevo = { correo: 'Ana.Lopez@cun.edu.co', nombre: 'Ana López', documento: '52123456', rol: Rol.AUXILIAR, permiso: 'consulta' as const };

  it('solo administración o la coordinación del área gestionan usuarios', async () => {
    const { caso } = armar();
    await expect(caso.crear(nuevo, docente)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(caso.crear(nuevo, coordinacionEscuela)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('crea con correo institucional normalizado, actor y permiso; audita', async () => {
    const { caso, auditoria } = armar();
    const u = await caso.crear(nuevo, coordinacion, HOY);
    expect(u).toMatchObject({ correo: 'ana.lopez@cun.edu.co', rol: Rol.AUXILIAR, rolEtiqueta: 'Auxiliar', permiso: 'consulta', activo: true });
    expect(auditoria).toEqual(['usuario_creado']);
    await expect(caso.crear({ ...nuevo, correo: 'ana@gmail.com' }, coordinacion)).rejects.toBeInstanceOf(BadRequestException);
    await expect(caso.crear(nuevo, coordinacion)).rejects.toBeInstanceOf(ConflictException);
    await expect(caso.crear({ ...nuevo, correo: 'otra@cun.edu.co' }, coordinacion)).rejects.toThrow(/documento/);
  });

  it('coordinación no crea administradores ni los modifica', async () => {
    const { caso } = armar();
    await expect(caso.crear({ ...nuevo, rol: Rol.ADMINISTRADOR }, coordinacion)).rejects.toBeInstanceOf(ForbiddenException);
    const a = await caso.crear({ ...nuevo, rol: Rol.ADMINISTRADOR }, admin, HOY);
    await expect(caso.actualizar(a.id, { activo: false }, coordinacion)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('edita, filtra por nombre, perfil y estado; «eliminar» inhabilita', async () => {
    const { caso } = armar();
    const u = await caso.crear(nuevo, admin, HOY);
    await caso.crear({ ...nuevo, correo: 'pedro@cun.edu.co', documento: '80111222', nombre: 'Pedro Díaz', rol: Rol.TUTOR }, admin, HOY);
    const editado = await caso.actualizar(u.id, { permiso: 'escritura', escuelas: ['ESC-NEG'] }, admin);
    expect(editado).toMatchObject({ permiso: 'escritura', escuelas: ['ESC-NEG'] });
    expect(await caso.listar({ rol: Rol.TUTOR }, admin)).toHaveLength(1);
    expect(await caso.listar({ nombre: 'pedro' }, admin)).toHaveLength(1);
    const eliminado = await caso.eliminar(u.id, admin);
    expect(eliminado.activo).toBe(false);
    expect(await caso.listar({ activo: true }, admin)).toHaveLength(1);
    expect(await caso.listar({}, admin)).toHaveLength(2);
    await expect(caso.actualizar('adm-1', { activo: false }, admin)).rejects.toBeInstanceOf(Error);
  });
});

describe('Vistas SINU y sincronizador prácticas–docente', () => {
  const matricula: MatriculaSinu = {
    documentoEstudiante: '1032456786', nombreEstudiante: 'Laura Sofía Ramírez Ortiz',
    correoInstitucional: 'laura.ramirez@estudiante.cun.edu.co', programaId: 'ADM-PRO', programaNombre: 'Administración',
    escuelaId: 'ESC-NEG', ciclo: 'profesional', periodoAcademico: '2026C', asignaturaPractica: 'Práctica Profesional I',
  };
  const asignacion: AsignacionDocenteSinu = {
    documentoEstudiante: '1032456786', periodoAcademico: '2026C', asignaturaPractica: 'Práctica Profesional I',
    documentoDocente: '79654321', nombreDocente: 'Carlos Pérez', correoDocente: 'Carlos.Perez@cun.edu.co',
  };
  const practicaBase = (sobrescribir: Partial<DatosPractica> = {}): DatosPractica => ({
    id: 'p1', numeroFur: 3, estudianteId: 'est-1', programaId: 'ADM-PRO', escuelaId: 'ESC-NEG', regional: null,
    asignatura: 'Práctica Profesional I', ciclo: CicloAcademico.PROFESIONAL, periodoAcademico: '2026C',
    modalidad: ModalidadPractica.PASANTIA, estado: EstadoPractica.DOCUMENTACION, tutorId: null, empresaId: null,
    empresaRazonSocial: null, empresaNit: null, area: null, cargo: null, tipoRemuneracion: null, salario: null, horario: null,
    jefeInmediatoNombre: null, jefeInmediatoCargo: null, jefeInmediatoCorreo: null, jefeInmediatoTelefono: null, ciudad: null,
    funcionesRelevantes: null, fechaInicio: null, fechaFin: null, horasRegistradas: null, arlVerificada: false,
    responsableArlPractica: null, arlFechaAfiliacion: null, terminosAceptadosEn: null, registradaPor: 'estudiante', nota: null, cerradaEn: null,
    ultimaActividad: HOY, creadaEn: HOY, actualizadaEn: HOY, ...sobrescribir,
  });

  function armar(opciones: { sincronizacion?: boolean; practicas?: DatosPractica[]; asignaciones?: AsignacionDocenteSinu[] } = {}) {
    const usuarios = new UsuariosEnMemoria();
    usuarios.filas.push(usuario({ id: 'est-1', correo: matricula.correoInstitucional, nombre: 'Laura Sofía Ramírez Ortiz', documento: '1032456786', rol: Rol.ESTUDIANTE, programaId: 'ADM-PRO' }));
    let practicas: DatosPractica[] = opciones.practicas ?? [practicaBase()];
    const periodo = PeriodoAcademico.desde({
      codigo: '2026C', nombre: '2026C', calendario: 'presencial', fechaInicio: dia('2026-07-20'), fechaFin: dia('2026-12-04'),
      ventanas: PeriodoAcademico.ventanasHabituales(dia('2026-07-20'), dia('2026-12-04'), dia('2026-08-21')),
      jornadasInduccion: [], fechaCargueDocumentos: null, sincronizacionDocentes: opciones.sincronizacion ?? true, modalidadesHabilitadas: [], activo: true, creadoEn: HOY, actualizadoEn: HOY,
    });
    const auditoria: { accion: string; actorRol: string | null }[] = [];
    const caso = new VistasSinuUseCase(
      {
        buscarPorDocumento: async (d: string) => (d === matricula.documentoEstudiante ? matricula : null),
        listarMatriculasPractica: async () => [matricula, { ...matricula, documentoEstudiante: '999', nombreEstudiante: 'Sin registro' }],
        listarAsignacionesDocentes: async () => opciones.asignaciones ?? [asignacion],
      },
      usuarios,
      {
        listar: async (f: { estudianteId?: string; periodoAcademico?: string }) => practicas
          .filter((p) => (!f.estudianteId || p.estudianteId === f.estudianteId) && (!f.periodoAcademico || p.periodoAcademico === f.periodoAcademico))
          .map((p) => Practica.desde(p)),
        buscarRegistroVigente: async (e: string, per: string) => { const p = practicas.find((x) => x.estudianteId === e && x.periodoAcademico === per); return p ? Practica.desde(p) : null; },
        guardar: async (d: DatosPractica) => { practicas = [...practicas.filter((p) => p.id !== d.id), d]; return Practica.desde(d); },
      } as never,
      { buscarPorCodigo: async () => periodo, listar: async () => [periodo] } as never,
      { registrar: async (r: { accion: string; actorRol: string | null }) => { auditoria.push(r); } } as never,
    );
    return { caso, usuarios, auditoria, practicas: () => practicas };
  }

  it('la consulta muestra SINU, SGP y la correspondencia campo a campo', async () => {
    const { caso } = armar();
    const v = await caso.consultarEstudiante('1032456786', coordinacion);
    expect(v.matricula?.programaNombre).toBe('Administración');
    expect(v.practica).toMatchObject({ numeroFur: 3, estadoSgp: 'Inscrito' });
    expect(v.correspondencia.every((c) => c.coincide)).toBe(true);
    const sinRegistro = await caso.consultarEstudiante('999', coordinacion);
    expect(sinRegistro.matricula).toBeNull();
    expect(sinRegistro.usuarioSgp).toBeNull();
    await expect(caso.consultarEstudiante('1032456786', { ...docente, rol: Rol.EMPRESA })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('las matrículas del periodo indican quién ya registró en SGP', async () => {
    const { caso } = armar();
    const filas = await caso.listarMatriculas('2026C', coordinacion);
    expect(filas.map((f) => f.registradaEnSgp)).toEqual([true, false]);
    expect(filas[0].estadoSgp).toBe('Inscrito');
  });

  it('el sincronizador crea al docente que falta, lo asigna y audita; la segunda corrida no cambia nada', async () => {
    const { caso, usuarios, auditoria, practicas } = armar();
    const r = await caso.sincronizarDocentes('2026C', coordinacion, HOY);
    expect(r).toMatchObject({ practicasRevisadas: 1, asignadas: 1, docentesCreados: 1, sinCambios: 0 });
    const creado = await usuarios.buscarPorCorreo('carlos.perez@cun.edu.co');
    expect(creado?.rol).toBe(Rol.TUTOR);
    expect(creado?.escuelas).toEqual(['ESC-NEG']);
    expect(practicas()[0].tutorId).toBe(creado?.id);
    expect(auditoria[0]).toMatchObject({ accion: 'sincronizacion_docentes', actorRol: Rol.COORDINADOR });

    const segunda = await caso.sincronizarDocentes('2026C', coordinacion, HOY);
    expect(segunda).toMatchObject({ asignadas: 0, sinCambios: 1, docentesCreados: 0 });
  });

  it('sin asignación en SINU la práctica queda reportada como «sin asignación»', async () => {
    const { caso } = armar({ asignaciones: [] });
    const r = await caso.sincronizarDocentes('2026C', admin, HOY);
    expect(r.sinDocenteEnSinu).toEqual([{ practicaId: 'p1', estudianteDocumento: '1032456786' }]);
  });

  it('respeta la habilitación del periodo y el perfil; la tarea programada corre como sistema', async () => {
    const deshabilitado = armar({ sincronizacion: false });
    await expect(deshabilitado.caso.sincronizarDocentes('2026C', admin, HOY)).rejects.toBeInstanceOf(BadRequestException);
    const { caso, auditoria } = armar();
    await expect(caso.sincronizarDocentes('2026C', docente, HOY)).rejects.toBeInstanceOf(ForbiddenException);
    const resultados = await caso.sincronizarPeriodosActivos(HOY);
    expect(resultados).toHaveLength(1);
    expect(auditoria[0].actorRol).toBe('sistema');
  });
});
