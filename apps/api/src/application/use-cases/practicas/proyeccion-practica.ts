import { SenalAcompanamiento } from '../../../domain/entities/practica.entity';
import { AvanceDocumental } from '../../../domain/services/avance-documental.domain-service';
import { Rol } from '../../../domain/value-objects/rol.vo';
import { PracticaRespuestaDto } from '../../dtos/practica.dto';

/**
 * Minimización por rol de la respuesta de una práctica.
 *
 * El expediente completo (estudiante, docente, coordinación, administración) no
 * cambia. Para los demás perfiles se devuelve solo lo que su función requiere;
 * lo que no les corresponde llega como `null` o neutro, de modo que el contrato
 * de la API (y el frontend) se mantiene sin filtrar información.
 *
 *  · Empresa: lo de su relación con el practicante. Sin nota, sin datos del
 *    docente, sin avance documental ni estados administrativos internos.
 *  · Auxiliar: lo operativo para validar ARL y documentos (estudiante, programa,
 *    modalidad, periodo, fechas, empresa, jefe inmediato, estado). Sin nota, sin
 *    remuneración ni horario, sin funciones, sin horas, sin avance documental.
 *  · Extensión: empresa y vacante. Sin expediente académico ni documental, sin
 *    nota, sin remuneración, sin docente ni señales de riesgo.
 */

/** Avance «reservado»: conserva la forma que el cliente espera, sin revelar nada del expediente. */
export const AVANCE_RESERVADO: AvanceDocumental = {
  exigidos: 0,
  cargados: 0,
  aprobados: 0,
  porcentajeCargado: 0,
  porcentajeAprobado: 0,
  momentos: [],
  pendientes: [],
  momentoActual: null,
};

/** Lo que ningún perfil externo al acompañamiento académico recibe. */
const SIN_ACADEMICO_NI_DOCUMENTAL: Partial<PracticaRespuestaDto> = {
  nota: null,
  avance: AVANCE_RESERVADO,
  senal: SenalAcompanamiento.AL_DIA,
  disparadoresSenal: [],
  transicionesPosibles: [],
};

const POR_ROL: Partial<Record<Rol, Partial<PracticaRespuestaDto>>> = {
  [Rol.EMPRESA]: {
    ...SIN_ACADEMICO_NI_DOCUMENTAL,
    tutorId: null,
    tutorNombre: null,
    numeroFur: null,
    regional: null,
    asignatura: null,
    estadoSgp: '',
  },
  [Rol.AUXILIAR]: {
    ...SIN_ACADEMICO_NI_DOCUMENTAL,
    salario: null,
    tipoRemuneracion: null,
    horario: null,
    funcionesRelevantes: null,
    asignatura: null,
    horasRegistradas: null,
  },
  [Rol.EXTENSION]: {
    ...SIN_ACADEMICO_NI_DOCUMENTAL,
    tutorId: null,
    tutorNombre: null,
    numeroFur: null,
    asignatura: null,
    estadoSgp: '',
    salario: null,
    tipoRemuneracion: null,
    horario: null,
    funcionesRelevantes: null,
    horasRegistradas: null,
  },
};

export function proyectarPracticaPara(rol: Rol, completa: PracticaRespuestaDto): PracticaRespuestaDto {
  const ocultar = POR_ROL[rol];
  return ocultar ? { ...completa, ...ocultar } : completa;
}
