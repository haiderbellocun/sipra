import { DatosDocumento, EstadoDocumento } from '../src/domain/entities/documento.entity';

/**
 * Emulación EN MEMORIA de las operaciones atómicas del repositorio de
 * documentos (compare-and-set). Node es monohilo y cada método resuelve sin
 * cederle el control a nadie entre leer y escribir, de modo que se comporta
 * como la sentencia SQL condicional: de varios intentos, uno solo gana.
 *
 * La prueba REAL de atomicidad contra PostgreSQL vive en
 * `herramientas/verificar-concurrencia-pg.ts`.
 */
export function operacionesAtomicasEnMemoria(
  leer: () => DatosDocumento,
  escribir: (datos: DatosDocumento) => void,
) {
  return {
    reclamarProcesamiento: (_id: string, ahora: Date, caducidadMs: number): Promise<boolean> => {
      const actual = leer();
      const reclamable =
        actual.estado === EstadoDocumento.RECIBIDO ||
        (actual.estado === EstadoDocumento.ANALIZANDO &&
          ahora.getTime() - actual.actualizadoEn.getTime() >= caducidadMs);
      if (reclamable) escribir({ ...actual, estado: EstadoDocumento.ANALIZANDO, actualizadoEn: ahora });
      return Promise.resolve(reclamable);
    },
    liberarReclamo: (_id: string, ahora: Date): Promise<boolean> => {
      const actual = leer();
      if (actual.estado !== EstadoDocumento.ANALIZANDO) return Promise.resolve(false);
      escribir({ ...actual, estado: EstadoDocumento.RECIBIDO, actualizadoEn: ahora });
      return Promise.resolve(true);
    },
    guardarSiEstado: (datos: DatosDocumento, estadoEsperado: EstadoDocumento): Promise<boolean> => {
      if (leer().estado !== estadoEsperado) return Promise.resolve(false);
      escribir(datos);
      return Promise.resolve(true);
    },
    listarProcesamientoCaducado: (): Promise<never[]> => Promise.resolve([]),
  };
}
