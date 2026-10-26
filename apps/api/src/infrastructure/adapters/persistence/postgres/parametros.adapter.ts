import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ValorParametro } from '../../../../domain/entities/parametro.entity';
import {
  ParametroRepositoryPort, SobrescrituraParametro,
} from '../../../../domain/ports/out/repositorios.port';

/**
 * M12. El valor se guarda envuelto en un objeto (`{ v: … }`) porque un jsonb
 * escalar obliga a distinguir a mano entre número, booleano y cadena al leer;
 * envuelto, el tipo vuelve tal como se guardó.
 */
@Injectable()
export class ParametroRepositoryAdapter implements ParametroRepositoryPort {
  constructor(@InjectDataSource() private readonly datos: DataSource) {}

  async listarSobrescrituras(): Promise<SobrescrituraParametro[]> {
    interface Fila {
      clave: string;
      valor: { v: ValorParametro };
      motivo: string;
      actualizado_por: string;
      actualizado_en: Date;
    }
    const filas: Fila[] = await this.datos.query(
      'SELECT clave, valor, motivo, actualizado_por, actualizado_en FROM parametros ORDER BY clave',
    );
    return filas.map((f) => ({
      clave: f.clave,
      valor: f.valor.v,
      motivo: f.motivo,
      actualizadoPor: f.actualizado_por,
      actualizadoEn: f.actualizado_en,
    }));
  }

  async guardar(s: Omit<SobrescrituraParametro, 'actualizadoEn'>): Promise<void> {
    await this.datos.query(
      `INSERT INTO parametros (clave, valor, motivo, actualizado_por, actualizado_en)
       VALUES ($1, $2::jsonb, $3, $4, now())
       ON CONFLICT (clave) DO UPDATE
         SET valor = EXCLUDED.valor, motivo = EXCLUDED.motivo,
             actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
      [s.clave, JSON.stringify({ v: s.valor }), s.motivo, s.actualizadoPor],
    );
  }

  /** Volver al valor por defecto es borrar la sobrescritura, no escribir otra. */
  async restaurar(clave: string): Promise<void> {
    await this.datos.query('DELETE FROM parametros WHERE clave = $1', [clave]);
  }
}
