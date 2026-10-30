import { Actor } from '../src/application/use-cases/practicas/gestionar-practica.use-case';
import {
  DatosDocumento, Documento, EstadoDocumento, TipoDocumento,
} from '../src/domain/entities/documento.entity';
import { DatosEmpresa, Empresa, EstadoEmpresa } from '../src/domain/entities/empresa.entity';
import {
  CicloAcademico, DatosPractica, EstadoPractica, ModalidadPractica, Practica,
} from '../src/domain/entities/practica.entity';
import { DatosUsuario, Usuario } from '../src/domain/entities/usuario.entity';
import { Rol } from '../src/domain/value-objects/rol.vo';

/** Fábricas de entidades y actores para las pruebas de autorización. */

export const ESC_A = 'ESC-NEG';
export const ESC_B = 'ESC-ING';

export function actorDe(rol: Rol, extra: Partial<Actor> = {}): Actor {
  return {
    id: `${rol}-1`,
    correo: `${rol}@cun.edu.co`,
    rol,
    permiso: 'escritura',
    escuelas: [],
    empresaId: null,
    ...extra,
  };
}

export function practicaDe(sobrescribir: Partial<DatosPractica> = {}): Practica {
  const ahora = new Date();
  return Practica.desde({
    id: 'practica-1',
    estudianteId: 'estudiante-1',
    programaId: 'ADM-PRO',
    escuelaId: ESC_A,
    ciclo: CicloAcademico.PROFESIONAL,
    periodoAcademico: '2026-2',
    modalidad: ModalidadPractica.PASANTIA,
    estado: EstadoPractica.ACTIVA,
    tutorId: 'tutor-asignado',
    empresaId: 'empresa-a',
    cargo: 'Practicante',
    jefeInmediatoNombre: null,
    jefeInmediatoCorreo: null,
    fechaInicio: null,
    fechaFin: null,
    horasRegistradas: null,
    arlVerificada: true,
    responsableArlPractica: null, arlFechaAfiliacion: null,
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

export function documentoDe(tipo: TipoDocumento, sobrescribir: Partial<DatosDocumento> = {}): Documento {
  const ahora = new Date();
  return Documento.desde({
    id: `doc-${tipo}`,
    practicaId: 'practica-1',
    tipo,
    version: 1,
    estado: EstadoDocumento.APROBADO,
    nombreOriginal: `${tipo}.pdf`,
    mimeReal: 'application/pdf',
    tamanoBytes: 1024,
    hashSha256: 'a'.repeat(64),
    hashPerceptual: null,
    rutaAlmacenamiento: `practicas/practica-1/${tipo}-v1.pdf`,
    calidadCaptura: null,
    banderas: [],
    puntaje: 100,
    banda: null,
    extraccion: null,
    decididoPor: null,
    justificacionDecision: null,
    motivoDevolucion: null,
    cargadoEn: ahora,
    actualizadoEn: ahora,
    purgarDespuesDe: null,
    ...sobrescribir,
  });
}

export function usuarioDe(rol: Rol, sobrescribir: Partial<DatosUsuario> = {}): Usuario {
  return Usuario.desde({
    id: `${rol}-1`,
    correo: `${rol}@cun.edu.co`,
    nombre: `Usuario ${rol}`,
    documento: null,
    rol,
    permiso: 'escritura',
    escuelas: [],
    empresaId: null,
    programaId: null,
    activo: true,
    creadoEn: new Date(),
    ultimoAccesoEn: null,
    ...sobrescribir,
  });
}

export function empresaDe(id: string, sobrescribir: Partial<DatosEmpresa> = {}): Empresa {
  const ahora = new Date();
  return Empresa.desde({
    id,
    razonSocial: `Empresa ${id} S.A.S.`,
    nitNumero: '900123456',
    nitDv: 8,
    ciiu: null,
    divipolaMunicipio: null,
    direccion: null,
    telefono: null,
    solicitanteNombre: 'Solicitante Reservado',
    solicitanteCorreo: 'solicitante@empresa.example',
    solicitanteCargo: null,
    representanteLegal: null,
    estado: EstadoEmpresa.HABILITADA,
    senales: [],
    decididaPor: null,
    justificacionDecision: null,
    solicitadaEn: ahora,
    actualizadaEn: ahora,
    ...sobrescribir,
  });
}
