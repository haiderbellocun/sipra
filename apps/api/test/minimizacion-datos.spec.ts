import {
  GestionarPracticaUseCase,
} from '../src/application/use-cases/practicas/gestionar-practica.use-case';
import {
  AVANCE_RESERVADO, proyectarPracticaPara,
} from '../src/application/use-cases/practicas/proyeccion-practica';
import { SenalAcompanamiento } from '../src/domain/entities/practica.entity';
import { TipoDocumento } from '../src/domain/entities/documento.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';
import { actorDe, documentoDe, empresaDe, practicaDe, usuarioDe } from './soporte-autorizacion';

/**
 * Minimización por rol de la respuesta de una práctica: cada perfil recibe lo
 * que su función requiere, no todo lo que existe en la entidad. Se prueba a
 * través de `presentar`, que es por donde sale toda respuesta de práctica.
 */

const NOTA = 4.7;
const SALARIO = 3_456_789;

function montar() {
  const practica = practicaDe({
    id: 'practica-1', estudianteId: 'estudiante-1', tutorId: 'tutor-asignado', empresaId: 'empresa-a',
    numeroFur: 7788, regional: 'Bogotá', asignatura: 'Práctica profesional I',
    area: 'Logística', cargo: 'Practicante de logística', ciudad: 'Bogotá',
    tipoRemuneracion: 'remunerada' as never, salario: SALARIO, horario: 'L-V 8:00-17:00',
    funcionesRelevantes: 'Funciones sintéticas de prueba para la práctica',
    jefeInmediatoNombre: 'Jefe Sintético', jefeInmediatoCargo: 'Coordinador', jefeInmediatoCorreo: 'jefe@empresa.example',
    jefeInmediatoTelefono: '3000000000', horasRegistradas: 120, nota: NOTA,
    fechaInicio: new Date('2026-03-01T00:00:00Z'), fechaFin: new Date('2026-07-01T00:00:00Z'),
  });
  const casoDeUso = new GestionarPracticaUseCase(
    {} as never, // prácticas
    { listarPorPractica: () => Promise.resolve([]) } as never, // obligaciones
    { listarPorPractica: () => Promise.resolve([documentoDe(TipoDocumento.CEDULA), documentoDe(TipoDocumento.CERTIFICADO_EPS)]) } as never,
    { buscarPorId: () => Promise.resolve(empresaDe('empresa-a')) } as never,
    {
      buscarPorId: (id: string) => Promise.resolve(
        id === 'tutor-asignado' ? usuarioDe(Rol.TUTOR, { id, nombre: 'Docente Sintético' })
          : usuarioDe(Rol.ESTUDIANTE, { id, nombre: 'Estudiante Sintético' })),
    } as never,
    {} as never,
    { numero: () => Promise.resolve(15) } as never,
  );
  return { casoDeUso, practica };
}

const presentar = async (rol: Rol) => {
  const { casoDeUso, practica } = montar();
  return casoDeUso.presentar(practica, actorDe(rol, { id: 'actor', empresaId: 'empresa-a', escuelas: [] }));
};

describe('Minimización · perfiles con el expediente completo', () => {
  it.each([Rol.ESTUDIANTE, Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR])('%s recibe el expediente sin recortes', async (rol) => {
    const r = await presentar(rol);
    expect(r).toMatchObject({
      nota: NOTA, salario: SALARIO, tutorNombre: 'Docente Sintético', numeroFur: 7788, regional: 'Bogotá',
      asignatura: 'Práctica profesional I', horasRegistradas: 120, funcionesRelevantes: expect.any(String),
    });
    expect(r.avance.cargados).toBeGreaterThan(0);
    expect(r.avance.momentos.length).toBeGreaterThan(0);
  });
});

describe('Minimización · empresa', () => {
  it('recibe lo de su relación con el practicante', async () => {
    const r = await presentar(Rol.EMPRESA);
    expect(r).toMatchObject({
      estudianteNombre: 'Estudiante Sintético', programaId: 'ADM-PRO', periodoAcademico: '2026-2',
      modalidad: expect.any(String), estado: expect.any(String), empresaRazonSocial: expect.any(String),
      area: 'Logística', cargo: 'Practicante de logística', ciudad: 'Bogotá', horario: 'L-V 8:00-17:00',
      jefeInmediatoNombre: 'Jefe Sintético', jefeInmediatoCorreo: 'jefe@empresa.example',
      fechaInicio: '2026-03-01T00:00:00.000Z', fechaFin: '2026-07-01T00:00:00.000Z', arlVerificada: true,
    });
  });

  it('NO recibe nota, datos del docente, avance documental ni estados administrativos internos', async () => {
    const r = await presentar(Rol.EMPRESA);
    expect(r.nota).toBeNull();
    expect(r.tutorId).toBeNull();
    expect(r.tutorNombre).toBeNull();
    expect(r.avance).toEqual(AVANCE_RESERVADO);
    expect(r.estadoSgp).toBe('');
    expect(r.numeroFur).toBeNull();
    expect(r.regional).toBeNull();
    expect(r.asignatura).toBeNull();
    expect(r.senal).toBe(SenalAcompanamiento.AL_DIA);
    expect(r.disparadoresSenal).toEqual([]);
    expect(r.transicionesPosibles).toEqual([]);
    const json = JSON.stringify(r);
    expect(json).not.toContain('Docente Sintético');
    expect(json).not.toContain(String(NOTA));
    expect(json).not.toContain('Práctica profesional I');
  });
});

describe('Minimización · auxiliar de prácticas', () => {
  it('recibe lo operativo para validar ARL y documentos', async () => {
    const r = await presentar(Rol.AUXILIAR);
    expect(r).toMatchObject({
      estudianteId: 'estudiante-1', estudianteNombre: 'Estudiante Sintético', programaId: 'ADM-PRO',
      modalidad: expect.any(String), periodoAcademico: '2026-2', estado: expect.any(String),
      fechaInicio: '2026-03-01T00:00:00.000Z', fechaFin: '2026-07-01T00:00:00.000Z',
      empresaRazonSocial: expect.any(String), empresaNit: expect.any(String),
      jefeInmediatoNombre: 'Jefe Sintético', jefeInmediatoCorreo: 'jefe@empresa.example',
      numeroFur: 7788, tutorNombre: 'Docente Sintético', arlVerificada: true, estadoSgp: expect.any(String),
    });
  });

  it('NO recibe nota, remuneración, horario, funciones, horas ni el avance documental', async () => {
    const r = await presentar(Rol.AUXILIAR);
    expect(r.nota).toBeNull();
    expect(r.salario).toBeNull();
    expect(r.tipoRemuneracion).toBeNull();
    expect(r.horario).toBeNull();
    expect(r.funcionesRelevantes).toBeNull();
    expect(r.horasRegistradas).toBeNull();
    expect(r.asignatura).toBeNull();
    expect(r.avance).toEqual(AVANCE_RESERVADO);
    expect(r.transicionesPosibles).toEqual([]);
    const json = JSON.stringify(r);
    expect(json).not.toContain(String(SALARIO));
    expect(json).not.toContain(String(NOTA));
    expect(json).not.toContain('Funciones sintéticas');
  });
});

describe('Minimización · extensión', () => {
  it('recibe lo de empresa y vacante', async () => {
    const r = await presentar(Rol.EXTENSION);
    expect(r).toMatchObject({
      estudianteNombre: 'Estudiante Sintético', programaId: 'ADM-PRO', periodoAcademico: '2026-2',
      modalidad: expect.any(String), empresaRazonSocial: expect.any(String), empresaNit: expect.any(String),
      area: 'Logística', cargo: 'Practicante de logística', ciudad: 'Bogotá',
      jefeInmediatoNombre: 'Jefe Sintético', jefeInmediatoCorreo: 'jefe@empresa.example',
    });
  });

  it('NO recibe expediente académico ni documental completo', async () => {
    const r = await presentar(Rol.EXTENSION);
    expect(r.nota).toBeNull();
    expect(r.avance).toEqual(AVANCE_RESERVADO);
    expect(r.tutorId).toBeNull();
    expect(r.tutorNombre).toBeNull();
    expect(r.salario).toBeNull();
    expect(r.tipoRemuneracion).toBeNull();
    expect(r.horario).toBeNull();
    expect(r.funcionesRelevantes).toBeNull();
    expect(r.horasRegistradas).toBeNull();
    expect(r.numeroFur).toBeNull();
    expect(r.senal).toBe(SenalAcompanamiento.AL_DIA);
    expect(r.disparadoresSenal).toEqual([]);
    const json = JSON.stringify(r);
    expect(json).not.toContain(String(SALARIO));
    expect(json).not.toContain(String(NOTA));
    expect(json).not.toContain('Docente Sintético');
  });
});

describe('proyectarPracticaPara', () => {
  it('no modifica el original y conserva la forma completa de la respuesta', async () => {
    const completa = await presentar(Rol.ADMINISTRADOR);
    const copia = JSON.stringify(completa);
    for (const rol of [Rol.EMPRESA, Rol.AUXILIAR, Rol.EXTENSION]) {
      const reducida = proyectarPracticaPara(rol, completa);
      expect(Object.keys(reducida).sort()).toEqual(Object.keys(completa).sort());
    }
    expect(JSON.stringify(completa)).toBe(copia);
  });

  it('los roles con acompañamiento académico reciben el mismo objeto, sin copia ni recorte', async () => {
    const completa = await presentar(Rol.ADMINISTRADOR);
    for (const rol of [Rol.ESTUDIANTE, Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR]) {
      expect(proyectarPracticaPara(rol, completa)).toBe(completa);
    }
  });
});
