import { RegistroAuditoria } from '../../entities/auditoria.entity';
import { DatosEntradaBitacora } from '../../entities/bitacora.entity';
import { CargaDocenteEscuela, PracticaPorDistribuir } from '../../services/distribucion-docentes.domain-service';

/**
 * G6 · Persistencia de la distribución de docentes facilitadores. Dos lecturas agregadas (sin N+1) y una
 * aplicación atómica: o se asignan TODAS las prácticas del lote (cada una solo si sigue sin docente y no es
 * terminal) junto con su auditoría y su bitácora, o no se escribe nada.
 */
export interface DistribucionDocentesPort {
  /** Prácticas NO terminales del periodo y SIN docente; `escuelas` null = todas. Una consulta. */
  practicasSinDocente(periodoAcademico: string, escuelas: readonly string[] | null): Promise<PracticaPorDistribuir[]>;
  /** Prácticas NO terminales del periodo YA asignadas, agregadas por docente y escuela. Una consulta. */
  cargas(periodoAcademico: string): Promise<CargaDocenteEscuela[]>;
  /**
   * Aplica el lote en una transacción. Devuelve `false` (y revierte todo) si alguna práctica ya tenía docente
   * o pasó a un estado terminal: la vista previa quedó obsoleta.
   */
  aplicar(lote: {
    asignaciones: readonly { practicaId: string; tutorId: string }[];
    ahora: Date;
    auditoria: readonly RegistroAuditoria[];
    bitacora: readonly DatosEntradaBitacora[];
  }): Promise<boolean>;
}

export const DISTRIBUCION_DOCENTES = Symbol('DISTRIBUCION_DOCENTES');
