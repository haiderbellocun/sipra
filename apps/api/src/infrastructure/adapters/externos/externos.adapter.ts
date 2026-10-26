import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MatriculaSinu, MensajeNotificacion, NotificacionPort, ResultadoEnvio, ResultadoRues,
  AsignacionDocenteSinu, RuesPort, SinuPort,
} from '../../../domain/ports/out/servicios-externos.port';

/**
 * RUES simulado. La consulta real depende del convenio de acceso que gestione
 * la Dirección de Tecnología; el puerto ya está definido y el reemplazo no
 * toca el caso de uso.
 */
@Injectable()
export class RuesSimuladoAdapter implements RuesPort {
  private readonly log = new Logger(RuesSimuladoAdapter.name);

  /** Registro de referencia para el ambiente de pruebas. */
  private readonly registro: Record<string, ResultadoRues> = {
    '901458772': {
      encontrado: true,
      razonSocial: 'SOLUCIONES LOGÍSTICAS ANDINAS S.A.S.',
      estadoMatricula: 'activa',
      fechaMatricula: new Date('2019-03-14T00:00:00Z'),
      representanteLegal: 'Camila Restrepo Duarte',
    },
    '830045123': {
      encontrado: true,
      razonSocial: 'TECNOLOGÍA Y SERVICIOS DEL CARIBE LTDA',
      estadoMatricula: 'activa',
      fechaMatricula: new Date('2011-08-02T00:00:00Z'),
      representanteLegal: 'Jorge Enrique Pardo Silva',
    },
    '900777001': {
      encontrado: true,
      razonSocial: 'INVERSIONES MERIDIANO S.A.S.',
      estadoMatricula: 'cancelada',
      fechaMatricula: new Date('2021-11-19T00:00:00Z'),
      representanteLegal: 'Ana María Gutiérrez Peña',
    },
  };

  async consultarPorNit(nitNumero: string): Promise<ResultadoRues> {
    const limpio = nitNumero.replace(/\D/g, '');
    this.log.debug(`Consulta RUES simulada para NIT ${limpio}`);
    return (
      this.registro[limpio] ?? {
        encontrado: false,
        razonSocial: null,
        estadoMatricula: null,
        fechaMatricula: null,
        representanteLegal: null,
      }
    );
  }
}

/**
 * SINU en modo simulado. SINU es la fuente única de verdad académica y la
 * plataforma solo lee: no existe una operación de escritura en este puerto.
 */
@Injectable()
export class SinuSimuladoAdapter implements SinuPort {
  private readonly matriculas: MatriculaSinu[] = [
    {
      documentoEstudiante: '1032456786',
      nombreEstudiante: 'Laura Sofía Ramírez Ortiz',
      correoInstitucional: 'laura.ramirez@estudiante.cun.edu.co',
      programaId: 'ADM-PRO',
      programaNombre: 'Administración de Empresas',
      escuelaId: 'ESC-NEG',
      ciclo: 'profesional',
      periodoAcademico: '2026-2',
      asignaturaPractica: 'Práctica Profesional I',
      codigoAsignatura: 'ADM-PP1', regional: 'Bogotá', telefono: '3001234567', semestre: 8, pensum: 'ADM-2019',
    },
    {
      documentoEstudiante: '1019887659',
      nombreEstudiante: 'Andrés Felipe Mora Castaño',
      correoInstitucional: 'andres.mora@estudiante.cun.edu.co',
      programaId: 'SIS-TGO',
      programaNombre: 'Tecnología en Desarrollo de Software',
      escuelaId: 'ESC-ING',
      ciclo: 'tecnologo',
      periodoAcademico: '2026-2',
      asignaturaPractica: 'Práctica Tecnológica',
      codigoAsignatura: 'SIS-PT', regional: 'Medellín', telefono: '3109876543', semestre: 5, pensum: 'SIS-2021',
    },
    {
      documentoEstudiante: '1023445561',
      nombreEstudiante: 'Valentina Ochoa Ruiz',
      correoInstitucional: 'valentina.ochoa@estudiante.cun.edu.co',
      programaId: 'COM-TEC',
      programaNombre: 'Técnico Profesional en Procesos Comerciales',
      escuelaId: 'ESC-COM',
      ciclo: 'tecnico',
      periodoAcademico: '2026-2',
      asignaturaPractica: 'Práctica Técnica',
      codigoAsignatura: 'COM-PTC', regional: 'Cali', telefono: '3157654321', semestre: 3, pensum: 'COM-2022',
    },
  ];

  async listarMatriculasPractica(periodoAcademico: string): Promise<MatriculaSinu[]> {
    return this.matriculas.filter((m) => m.periodoAcademico === periodoAcademico);
  }

  async buscarPorDocumento(documento: string): Promise<MatriculaSinu | null> {
    return this.matriculas.find((m) => m.documentoEstudiante === documento) ?? null;
  }

  /**
   * Asignaciones sintéticas: cada matrícula de práctica tiene docente en el
   * mismo periodo, salvo la de procesos comerciales, que queda «sin
   * asignación» para que el filtro del SGP tenga qué mostrar.
   */
  async listarAsignacionesDocentes(periodoAcademico: string): Promise<AsignacionDocenteSinu[]> {
    const docentes = [
      { documentoDocente: '79654321', nombreDocente: 'Carlos Andrés Pérez Gómez', correoDocente: 'carlos.perez@cun.edu.co' },
      { documentoDocente: '52987123', nombreDocente: 'Diana Marcela Torres Ruiz', correoDocente: 'diana.torres@cun.edu.co' },
    ];
    return this.matriculas
      .filter((m) => m.escuelaId !== 'ESC-COM')
      .map((m, i) => ({
        documentoEstudiante: m.documentoEstudiante,
        periodoAcademico,
        asignaturaPractica: m.asignaturaPractica,
        ...docentes[i % docentes.length],
      }));
  }
}

/** Notificaciones por consola en desarrollo; Workspace en los demás ambientes. */
@Injectable()
export class NotificacionConsolaAdapter implements NotificacionPort {
  private readonly log = new Logger('Notificación');
  private readonly remitente: string;

  constructor(config: ConfigService) {
    this.remitente = config.get<string>('CORREO_REMITENTE') ?? 'practicas@cun.edu.co';
  }

  async enviar(mensaje: MensajeNotificacion): Promise<ResultadoEnvio> {
    this.log.log(
      `\n  De:      ${this.remitente}` +
        `\n  Para:    ${mensaje.destinatario}` +
        `\n  Asunto:  ${mensaje.asunto}` +
        `\n  ${mensaje.cuerpo.split('\n').join('\n  ')}`,
    );
    return { enviado: true, referencia: `consola-${Date.now().toString(36)}` };
  }
}
