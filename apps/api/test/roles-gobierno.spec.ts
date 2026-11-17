import { Controller, ExecutionContext, ForbiddenException, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QueryRunner } from 'typeorm';
import { ETIQUETA_ROL } from '../src/application/dtos/usuario.dto';
import { GestionarUsuariosUseCase } from '../src/application/use-cases/administracion/gestionar-usuarios.use-case';
import { escuelasDeReportes, ROLES_REPORTES } from '../src/application/use-cases/reportes/alcance-reportes';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { DatosUsuario, Usuario } from '../src/domain/entities/usuario.entity';
import { esSupervisorMesaActas, puedeCorregirDatosConActa, puedeOperarMesaActas } from '../src/domain/value-objects/acceso-acta.vo';
import { esSupervisorRevisionCamara, puedeOperarRevisionCamara } from '../src/domain/value-objects/acceso-camara.vo';
import { puedeCargarDocumentos, puedeConsultarDocumentos, puedeVerDocumento } from '../src/domain/value-objects/acceso-documental.vo';
import {
  esSupervisorEps, puedeDecidirDocumento, puedeOperarValidacionEps, puedeVerLecturaInterna,
} from '../src/domain/value-objects/acceso-eps.vo';
import { esSupervisorRevisionRut, puedeOperarRevisionRut } from '../src/domain/value-objects/acceso-rut.vo';
import { esSupervisorValidacionDocumental, puedeUsarValidacionDocumental } from '../src/domain/value-objects/acceso-validacion-documental.vo';
import * as rolVo from '../src/domain/value-objects/rol.vo';
import {
  ROLES_ADMINISTRATIVOS, ROLES_INTERNOS, ROLES_OPERACION_PRACTICAS, Rol, alcancePorRol, escuelasDeCoordinacion,
  esCoordinacionInstitucional, esCoordinacionOperativa, puedeGestionarPeriodos, puedeGestionarUsuarios, puedeModificarPractica,
  puedeSupervisarInstitucionalmente, rolesGestionablesPor,
} from '../src/domain/value-objects/rol.vo';
import { Roles } from '../src/infrastructure/auth/roles.decorator';
import { RolesGuard } from '../src/infrastructure/auth/roles.guard';
import { MIGRACIONES } from '../src/infrastructure/persistence/postgres/migrations/todas.migracion';
import { RolesGobiernoOperativo1756000022000 } from '../src/infrastructure/persistence/postgres/migrations/1756000022000-RolesGobiernoOperativo';
import { actorDe, practicaDe } from './soporte-autorizacion';

const HOY = new Date('2026-11-17T00:00:00.000Z');
const ESC_A = 'ESC-ING';
const ESC_B = 'ESC-NEG';
const TODOS = Object.values(Rol);
const quienes = (f: (r: Rol) => boolean): Rol[] => TODOS.filter(f).sort();

const director = actorDe(Rol.DIRECTOR);
const directorConEscuelas = actorDe(Rol.DIRECTOR, { escuelas: [ESC_A] }); // dato inesperado: no debe restringir
const analistaArea = actorDe(Rol.ANALISTA);
const analistaEscuela = actorDe(Rol.ANALISTA, { escuelas: [ESC_A] });
const coordinadorArea = actorDe(Rol.COORDINADOR);
const coordinadorEscuela = actorDe(Rol.COORDINADOR, { escuelas: [ESC_A] });
const admin = actorDe(Rol.ADMINISTRADOR);

describe('G1 · modelo de roles', () => {
  it('existen director y analista; coordinador no cambia de valor', () => {
    expect(Rol.DIRECTOR).toBe('director');
    expect(Rol.ANALISTA).toBe('analista');
    expect(Rol.COORDINADOR).toBe('coordinador');
  });

  it('son internos y administrativos; estudiantes y empresas no se gestionan como administrativos', () => {
    for (const r of [Rol.DIRECTOR, Rol.ANALISTA]) {
      expect(ROLES_INTERNOS).toContain(r);
      expect(ROLES_ADMINISTRATIVOS).toContain(r);
    }
    expect([...ROLES_ADMINISTRATIVOS].sort()).toEqual(
      [Rol.ADMINISTRADOR, Rol.DIRECTOR, Rol.COORDINADOR, Rol.ANALISTA, Rol.AUXILIAR, Rol.TUTOR, Rol.EXTENSION].sort(),
    );
  });

  it('etiquetas institucionales', () => {
    expect(ETIQUETA_ROL[Rol.DIRECTOR]).toBe('Director');
    expect(ETIQUETA_ROL[Rol.COORDINADOR]).toBe('Coordinador de prácticas');
    expect(ETIQUETA_ROL[Rol.ANALISTA]).toBe('Analista de prácticas');
    expect(ETIQUETA_ROL[Rol.TUTOR]).toBe('Docente facilitador');
  });

  it('operación de prácticas = coordinador + analista; el director NO pertenece', () => {
    expect([...ROLES_OPERACION_PRACTICAS].sort()).toEqual([Rol.ANALISTA, Rol.COORDINADOR]);
    expect(quienes((r) => esCoordinacionOperativa(r))).toEqual([Rol.ANALISTA, Rol.COORDINADOR]);
    expect(esCoordinacionOperativa(director)).toBe(false);
  });

  it('ya no existe la expansión implícita de grupos', () => {
    const exportados = Object.keys(rolVo);
    for (const eliminado of ['expandirRoles', 'ROLES_COORDINACION', 'esCoordinacion', 'puedeGobernarPracticas']) {
      expect(exportados).not.toContain(eliminado);
    }
  });
});

describe('G1 · matriz de capacidades (0.39.1)', () => {
  const de = (f: (a: ReturnType<typeof actorDe>) => boolean) => quienes((r) => f(actorDe(r)));

  it('gestionar periodos: administrador + director', () => {
    expect(de(puedeGestionarPeriodos)).toEqual([Rol.ADMINISTRADOR, Rol.DIRECTOR].sort());
  });

  it('gestionar usuarios: administrador + director', () => {
    expect(de(puedeGestionarUsuarios)).toEqual([Rol.ADMINISTRADOR, Rol.DIRECTOR].sort());
  });

  it('modificar práctica (G5): EXCLUSIVAMENTE coordinador + analista; ni administrador ni director', () => {
    expect(de(puedeModificarPractica)).toEqual([Rol.ANALISTA, Rol.COORDINADOR]);
  });

  it('supervisión institucional: administrador + director', () => {
    expect(de(puedeSupervisarInstitucionalmente)).toEqual([Rol.ADMINISTRADOR, Rol.DIRECTOR].sort());
  });

  it('coordinación institucional: coordinador o analista SIN escuelas; nunca el director', () => {
    expect(esCoordinacionInstitucional(coordinadorArea)).toBe(true);
    expect(esCoordinacionInstitucional(analistaArea)).toBe(true);
    expect(esCoordinacionInstitucional(coordinadorEscuela)).toBe(false);
    expect(esCoordinacionInstitucional(analistaEscuela)).toBe(false);
    expect(esCoordinacionInstitucional(director)).toBe(false);
  });

  it('roles gestionables: el administrador todos; el director solo los operativos; nadie más', () => {
    expect(rolesGestionablesPor(admin)).toEqual(ROLES_ADMINISTRATIVOS);
    expect([...rolesGestionablesPor(director)].sort())
      .toEqual([Rol.COORDINADOR, Rol.ANALISTA, Rol.AUXILIAR, Rol.TUTOR, Rol.EXTENSION].sort());
    for (const a of [coordinadorArea, analistaArea, actorDe(Rol.AUXILIAR)]) expect(rolesGestionablesPor(a)).toEqual([]);
  });

  it('reportes: el director genera reportes (lectura)', () => {
    expect(ROLES_REPORTES).toContain(Rol.DIRECTOR);
    expect(ROLES_REPORTES).toContain(Rol.ANALISTA);
  });
});

describe('G1 · documentos y Mesas: el director consulta, no carga, no decide ni opera', () => {
  it('documentos: consulta sí; carga no; decisión no; lectura interna (puntaje, banderas) no', () => {
    expect(puedeConsultarDocumentos(Rol.DIRECTOR)).toBe(true);
    expect(puedeVerDocumento(Rol.DIRECTOR, TipoDocumento.CERTIFICADO_EPS)).toBe(true);
    expect(puedeCargarDocumentos(Rol.DIRECTOR)).toBe(false);
    for (const tipo of Object.values(TipoDocumento)) {
      expect(puedeDecidirDocumento(Rol.DIRECTOR, tipo)).toBe(false);
      expect(puedeVerLecturaInterna(Rol.DIRECTOR, tipo)).toBe(false);
    }
  });

  it('analista: conserva lo que hacía como coordinador (carga y decide)', () => {
    expect(puedeCargarDocumentos(Rol.ANALISTA)).toBe(true);
    expect(puedeDecidirDocumento(Rol.ANALISTA, TipoDocumento.RUT_NATURAL)).toBe(true);
  });

  it('Mesas EPS, RUT, Cámara, Actas y Validación Documental: el director ni opera ni supervisa (la supervisión libera reservas ajenas)', () => {
    const operar = [puedeOperarValidacionEps, puedeOperarRevisionRut, puedeOperarRevisionCamara, puedeOperarMesaActas, puedeUsarValidacionDocumental];
    const supervisar = [esSupervisorEps, esSupervisorRevisionRut, esSupervisorRevisionCamara, esSupervisorMesaActas, esSupervisorValidacionDocumental];
    for (const f of [...operar, ...supervisar]) {
      expect(f(Rol.DIRECTOR)).toBe(false);
      expect(f(Rol.ANALISTA)).toBe(f(Rol.COORDINADOR)); // el analista, igual que el coordinador
    }
    expect(puedeCorregirDatosConActa(Rol.DIRECTOR)).toBe(false);
    expect(puedeCorregirDatosConActa(Rol.ANALISTA)).toBe(true);
  });
});

describe('G1 · alcances', () => {
  it('director: institucional siempre, aun con escuelas guardadas', () => {
    expect(alcancePorRol(Rol.DIRECTOR, { escuelas: [ESC_A] })).toEqual({ propio: false, escuelas: [], empresaId: null, institucional: true });
    expect(escuelasDeCoordinacion(directorConEscuelas)).toBeNull();
  });

  it('analista: el mismo mecanismo de escuelas que coordinación (vacío = institucional)', () => {
    expect(alcancePorRol(Rol.ANALISTA).institucional).toBe(true);
    expect(alcancePorRol(Rol.ANALISTA, { escuelas: [ESC_A] })).toEqual(alcancePorRol(Rol.COORDINADOR, { escuelas: [ESC_A] }));
    expect(escuelasDeCoordinacion(analistaArea)).toBeNull();
    expect(escuelasDeCoordinacion(analistaEscuela)).toEqual([ESC_A]);
  });

  it('coordinador: sin regresión', () => {
    expect(alcancePorRol(Rol.COORDINADOR).institucional).toBe(true);
    expect(escuelasDeCoordinacion(coordinadorEscuela)).toEqual([ESC_A]);
  });

  it('reportes: director y analista del Área sin acotar; analista de escuela acotado', () => {
    expect(escuelasDeReportes(director)).toBeUndefined();
    expect(escuelasDeReportes(directorConEscuelas)).toBeUndefined();
    expect(escuelasDeReportes(analistaArea)).toBeUndefined();
    expect(escuelasDeReportes(analistaEscuela)).toEqual([ESC_A]);
  });
});

describe('G1 · Practica.visiblePara', () => {
  const deA = practicaDe({ escuelaId: ESC_A });
  const deB = practicaDe({ escuelaId: ESC_B });

  it('director institucional', () => {
    expect(deA.visiblePara(director)).toBe(true);
    expect(deB.visiblePara(directorConEscuelas)).toBe(true);
  });
  it('analista institucional (sin escuelas)', () => {
    expect(deB.visiblePara(analistaArea)).toBe(true);
  });
  it('analista restringido por escuela', () => {
    expect(deA.visiblePara(analistaEscuela)).toBe(true);
    expect(deB.visiblePara(analistaEscuela)).toBe(false);
  });
  it('coordinador sin regresión', () => {
    expect(deB.visiblePara(coordinadorArea)).toBe(true);
    expect(deB.visiblePara(coordinadorEscuela)).toBe(false);
  });
});

class UsuariosEnMemoria {
  filas: DatosUsuario[] = [];
  async buscarPorId(id: string) { const d = this.filas.find((f) => f.id === id); return d ? Usuario.desde(d) : null; }
  async buscarPorCorreo(c: string) { const d = this.filas.find((f) => f.correo === c.toLowerCase()); return d ? Usuario.desde(d) : null; }
  async buscarPorDocumento(doc: string) { const d = this.filas.find((f) => f.documento === doc); return d ? Usuario.desde(d) : null; }
  async buscarTexto() { return []; }
  async listar(filtro: { roles?: readonly string[] } = {}) {
    return this.filas.filter((f) => !filtro.roles || filtro.roles.includes(f.rol)).map((f) => Usuario.desde(f));
  }
  async guardar(d: DatosUsuario) { this.filas = [...this.filas.filter((f) => f.id !== d.id), d]; return Usuario.desde(d); }
}

const fila = (id: string, rol: Rol, escuelas: string[] = []): DatosUsuario => ({
  id, correo: `${id}@cun.edu.co`, nombre: id, documento: `doc-${id}`, rol, permiso: 'escritura', escuelas,
  empresaId: null, programaId: null, activo: true, creadoEn: HOY, ultimoAccesoEn: null,
});

describe('G1 · gestión de usuarios administrativos', () => {
  function armar() {
    const usuarios = new UsuariosEnMemoria();
    usuarios.filas.push(fila('adm-2', Rol.ADMINISTRADOR), fila('dir-2', Rol.DIRECTOR), fila('aux-2', Rol.AUXILIAR));
    const caso = new GestionarUsuariosUseCase(usuarios as never, { registrar: async () => undefined } as never);
    return { caso, usuarios };
  }
  const alta = (rol: Rol, extra: Record<string, unknown> = {}) => ({
    correo: `nuevo.${rol}@cun.edu.co`, nombre: `Nuevo ${rol}`, documento: `doc-nuevo-${rol}`, rol, permiso: 'escritura' as const, ...extra,
  });

  it('director NO crea administradores ni directores', async () => {
    const { caso } = armar();
    await expect(caso.crear(alta(Rol.ADMINISTRADOR), director, HOY)).rejects.toThrow(new ForbiddenException('Solo un administrador crea administradores'));
    await expect(caso.crear(alta(Rol.DIRECTOR), director, HOY)).rejects.toThrow(new ForbiddenException('Solo un administrador crea directores'));
  });

  it('director NO modifica ni inhabilita administradores ni directores', async () => {
    const { caso } = armar();
    for (const id of ['adm-2', 'dir-2']) {
      await expect(caso.actualizar(id, { nombre: 'X' }, director)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(caso.eliminar(id, director)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('director SÍ gestiona perfiles operativos', async () => {
    const { caso } = armar();
    for (const rol of [Rol.COORDINADOR, Rol.ANALISTA, Rol.AUXILIAR, Rol.TUTOR, Rol.EXTENSION]) {
      expect((await caso.crear(alta(rol), director, HOY)).rol).toBe(rol);
    }
    expect((await caso.actualizar('aux-2', { nombre: 'Auxiliar editado' }, director)).nombre).toBe('Auxiliar editado');
    expect((await caso.eliminar('aux-2', director)).activo).toBe(false);
  });

  it('administrador SÍ crea, modifica e inhabilita directores; el director queda sin escuelas', async () => {
    const { caso } = armar();
    expect(await caso.crear(alta(Rol.DIRECTOR, { escuelas: [ESC_A] }), admin, HOY)).toMatchObject({ rol: Rol.DIRECTOR, rolEtiqueta: 'Director', escuelas: [] });
    expect(await caso.actualizar('dir-2', { nombre: 'Dirección editada', escuelas: [ESC_A] }, admin)).toMatchObject({ nombre: 'Dirección editada', escuelas: [] });
    expect((await caso.eliminar('dir-2', admin)).activo).toBe(false);
  });

  it('coordinador y analista ya NO gestionan usuarios (gobierno = administrador + director)', async () => {
    const { caso } = armar();
    for (const a of [coordinadorArea, analistaArea, coordinadorEscuela]) {
      await expect(caso.crear(alta(Rol.AUXILIAR), a, HOY)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(caso.listar({}, a)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});

@Controller('g1')
class RutasG1 {
  @Get('a') @Roles(Rol.COORDINADOR, Rol.ADMINISTRADOR) soloCoordinador(): void { /* exactamente estos dos */ }
  @Get('b') @Roles(Rol.COORDINADOR, Rol.ANALISTA) operacion(): void { /* coordinación operativa explícita */ }
  @Get('c') @Roles(Rol.DIRECTOR, Rol.ADMINISTRADOR) gobierno(): void { /* gobierno */ }
}

describe('G1 · @Roles significa exactamente los roles declarados', () => {
  const guard = new RolesGuard(new Reflector());
  const manejador = (ruta: string) => (RutasG1.prototype as unknown as Record<string, () => void>)[ruta];
  const ctx = (ruta: string, req: object) => ({
    getHandler: () => manejador(ruta), getClass: () => RutasG1, switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;
  const entran = (ruta: string) => quienes((r) => { try { return guard.canActivate(ctx(ruta, { actor: actorDe(r) })); } catch { return false; } });

  it('@Roles(COORDINADOR, ADMINISTRADOR): ni analista ni director entran', () => {
    expect(entran('soloCoordinador')).toEqual([Rol.ADMINISTRADOR, Rol.COORDINADOR]);
  });
  it('@Roles(COORDINADOR, ANALISTA): solo esos dos', () => {
    expect(entran('operacion')).toEqual([Rol.ANALISTA, Rol.COORDINADOR]);
  });
  it('@Roles(DIRECTOR, ADMINISTRADOR): solo gobierno', () => {
    expect(entran('gobierno')).toEqual([Rol.ADMINISTRADOR, Rol.DIRECTOR].sort());
  });
  it('el rol sale del actor de la sesión, nunca de un parámetro del cliente', () => {
    expect(() => guard.canActivate(ctx('gobierno', { query: { rol: Rol.ADMINISTRADOR } }))).toThrow(ForbiddenException);
  });
});

describe('G1 · persistencia: migración 22 (sin ejecutar)', () => {
  async function sqlDe(metodo: 'up' | 'down', filas = 0): Promise<{ sql: string[]; error?: Error }> {
    const emitido: string[] = [];
    const corredor = { query: (sql: string) => { emitido.push(sql.replace(/\s+/g, ' ').trim()); return Promise.resolve(/count\(\*\)/.test(sql) ? [{ n: filas }] : undefined); } };
    try {
      await new RolesGobiernoOperativo1756000022000()[metodo](corredor as unknown as QueryRunner);
      return { sql: emitido };
    } catch (e) {
      return { sql: emitido, error: e as Error };
    }
  }

  it('está registrada justo después de los motivos de la Cámara', () => {
    const i = MIGRACIONES.indexOf(RolesGobiernoOperativo1756000022000);
    expect(i).toBeGreaterThan(0);
    expect(MIGRACIONES[i - 1].name).toBe('MotivosDecisionCamara1756000021000');
  });

  it('up: el CHECK admite director y analista y conserva todos los roles anteriores; no toca filas', async () => {
    const up = (await sqlDe('up')).sql.join('\n');
    expect(up).toMatch(/DROP CONSTRAINT IF EXISTS ck_usuarios_rol/);
    for (const r of TODOS) expect(up).toContain(`'${r}'`);
    expect(up).not.toMatch(/UPDATE |INSERT |DELETE |CREATE TABLE|ADD COLUMN|DROP TABLE|TRUNCATE/i);
  });

  it('down: se niega si hay usuarios director/analista; sin ellos, restaura el CHECK anterior', async () => {
    const conFilas = await sqlDe('down', 2);
    expect(conFilas.error?.message).toMatch(/No se revierte/);
    expect(conFilas.sql.some((s) => /DROP CONSTRAINT/.test(s))).toBe(false);
    const check = (await sqlDe('down', 0)).sql.find((s) => /ADD CONSTRAINT ck_usuarios_rol/.test(s)) ?? '';
    expect(check).not.toContain("'director'");
    expect(check).not.toContain("'analista'");
    expect(check).toContain("'coordinador'");
  });

  it('el usuario se reconstruye con su rol (director y analista)', () => {
    for (const r of [Rol.DIRECTOR, Rol.ANALISTA]) {
      expect(Usuario.desde(Usuario.desde(fila(`p-${r}`, r)).instantanea()).rol).toBe(r);
    }
  });
});
