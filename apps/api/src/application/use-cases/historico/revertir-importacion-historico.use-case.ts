import { HistoricoRepositorio, ResultadoReversion, ReversionNoPermitidaError } from '../../../domain/ports/out/historico-repositorio.port';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reversión de UNA importación del histórico (§53–54 del encargo H2). La unidad es la importación: no existe forma de
 * borrar un `source_record_id` suelto. El repositorio la ejecuta en una transacción, bajo el mismo bloqueo consultivo
 * que la importación, y solo sobre la última importación `completed` del sistema de origen.
 */
export class RevertirImportacionHistoricoUseCase {
  constructor(private readonly repositorio: HistoricoRepositorio) {}

  async ejecutar(importacionId: string): Promise<ResultadoReversion> {
    if (!UUID.test(importacionId ?? '')) throw new ReversionNoPermitidaError('el identificador de importación debe ser un UUID');
    return this.repositorio.revertir(importacionId);
  }
}
