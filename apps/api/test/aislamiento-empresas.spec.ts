import {
  CicloAcademico, DatosPractica, EstadoPractica, ModalidadPractica, Practica,
} from '../src/domain/entities/practica.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';

/**
 * PRUEBA DE AISLAMIENTO ENTRE EMPRESAS — condición de despliegue.
 *
 * Si una empresa alcanza un solo registro de otra, la construcción falla
 * (sección 5.3 del documento técnico y criterio de aceptación D08).
 *
 * Se ejecuta en cada integración: `npm run test:aislamiento`.
 */

const EMPRESA_A = 'empresa-a';
const EMPRESA_B = 'empresa-b';

function practicaDe(empresaId: string | null, sobrescribir: Partial<DatosPractica> = {}): Practica {
  const ahora = new Date();
  return Practica.desde({
    id: `p-${empresaId ?? 'sin'}-${Math.random().toString(36).slice(2)}`,
    estudianteId: 'estudiante-1',
    programaId: 'ADM-PRO',
    escuelaId: 'ESC-NEG',
    ciclo: CicloAcademico.PROFESIONAL,
    periodoAcademico: '2026-2',
    modalidad: ModalidadPractica.PASANTIA,
    estado: EstadoPractica.ACTIVA,
    tutorId: 'tutor-1',
    empresaId,
    cargo: 'Practicante',
    jefeInmediatoNombre: null,
    jefeInmediatoCorreo: null,
    fechaInicio: null,
    fechaFin: null,
    horasRegistradas: null,
    arlVerificada: true,
    arlFechaAfiliacion: null,
    numeroFur: null,
    regional: null,
    asignatura: null,
    empresaRazonSocial: null,
    empresaNit: null,
    area: null,
    tipoRemuneracion: null,
    salario: null,
    horario: null,
    jefeInmediatoCargo: null,
    jefeInmediatoTelefono: null,
    ciudad: null,
    funcionesRelevantes: null,
    terminosAceptadosEn: null,
    registradaPor: 'coordinacion',
    nota: null,
    cerradaEn: null,
    ultimaActividad: ahora,
    creadaEn: ahora,
    actualizadaEn: ahora,
    ...sobrescribir,
  });
}

describe('Aislamiento entre empresas', () => {
  const actorEmpresaA = {
    id: 'usuario-a', rol: Rol.EMPRESA, escuelas: [] as string[], empresaId: EMPRESA_A,
  };

  it('la empresa A ve sus propios expedientes', () => {
    expect(practicaDe(EMPRESA_A).visiblePara(actorEmpresaA)).toBe(true);
  });

  it('la empresa A NO alcanza ni un solo expediente de la empresa B', () => {
    const expedientesDeB = Array.from({ length: 50 }, () => practicaDe(EMPRESA_B));
    const alcanzados = expedientesDeB.filter((p) => p.visiblePara(actorEmpresaA));
    expect(alcanzados).toHaveLength(0);
  });

  it('la empresa A no alcanza expedientes sin empresa asignada', () => {
    expect(practicaDe(null).visiblePara(actorEmpresaA)).toBe(false);
  });

  it('un usuario de empresa sin empresaId no alcanza ningún expediente', () => {
    const huerfano = { id: 'u', rol: Rol.EMPRESA, escuelas: [] as string[], empresaId: null };
    expect(practicaDe(EMPRESA_A).visiblePara(huerfano)).toBe(false);
    expect(practicaDe(null).visiblePara(huerfano)).toBe(false);
  });

  it('coincidir en el identificador de usuario no abre la puerta entre empresas', () => {
    // El estudiante de la práctica y el usuario de empresa comparten id por error.
    const practica = practicaDe(EMPRESA_B, { estudianteId: 'usuario-a' });
    expect(practica.visiblePara(actorEmpresaA)).toBe(false);
  });
});

describe('Aislamiento por rol', () => {
  it('el estudiante solo ve su propio expediente', () => {
    const actor = { id: 'estudiante-1', rol: Rol.ESTUDIANTE, escuelas: [] as string[], empresaId: null };
    expect(practicaDe(EMPRESA_A).visiblePara(actor)).toBe(true);
    expect(practicaDe(EMPRESA_A, { estudianteId: 'otro' }).visiblePara(actor)).toBe(false);
  });

  it('el estudiante no gana visibilidad por pertenecer a una empresa', () => {
    const actor = {
      id: 'estudiante-9', rol: Rol.ESTUDIANTE, escuelas: [] as string[], empresaId: EMPRESA_A,
    };
    expect(practicaDe(EMPRESA_A).visiblePara(actor)).toBe(false);
  });

  it('el coordinador ve solo las escuelas de su alcance', () => {
    const actor = {
      id: 'coord', rol: Rol.COORDINADOR, escuelas: ['ESC-ING'], empresaId: null,
    };
    expect(practicaDe(EMPRESA_A, { escuelaId: 'ESC-ING' }).visiblePara(actor)).toBe(true);
    expect(practicaDe(EMPRESA_A, { escuelaId: 'ESC-NEG' }).visiblePara(actor)).toBe(false);
  });

  it('el tutor ve sus asignados y las escuelas de su alcance, nada más', () => {
    const actor = { id: 'tutor-1', rol: Rol.TUTOR, escuelas: ['ESC-NEG'], empresaId: null };
    expect(practicaDe(EMPRESA_A, { tutorId: 'tutor-1', escuelaId: 'ESC-SOC' }).visiblePara(actor)).toBe(true);
    expect(practicaDe(EMPRESA_A, { tutorId: 'otro', escuelaId: 'ESC-NEG' }).visiblePara(actor)).toBe(true);
    expect(practicaDe(EMPRESA_A, { tutorId: 'otro', escuelaId: 'ESC-SOC' }).visiblePara(actor)).toBe(false);
  });

  it('el administrador ve todo el ámbito institucional', () => {
    const actor = { id: 'admin', rol: Rol.ADMINISTRADOR, escuelas: [] as string[], empresaId: null };
    expect(practicaDe(EMPRESA_B, { escuelaId: 'ESC-SOC' }).visiblePara(actor)).toBe(true);
  });
});
