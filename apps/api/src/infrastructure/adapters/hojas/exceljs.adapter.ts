import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { GeneradorHojaCalculoPort, LibroCalculo } from '../../../domain/ports/out/servicios-externos.port';

/**
 * Libros .xlsx con exceljs: encabezado fijo en azul CUN, filtro automático,
 * anchos por columna y fechas como fechas (no como texto), para que quien
 * abre el reporte pueda ordenar y filtrar sin limpiar nada.
 */
@Injectable()
export class ExcelJsAdapter implements GeneradorHojaCalculoPort {
  async generar(libro: LibroCalculo): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SIPRA PRÁCTICAS — CUN';
    workbook.title = libro.titulo;
    workbook.created = new Date();

    for (const hoja of libro.hojas) {
      const ws = workbook.addWorksheet(hoja.nombre.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = hoja.columnas.map((c) => ({
        header: c.encabezado, key: c.clave, width: c.ancho ?? Math.min(60, Math.max(12, c.encabezado.length + 4)),
      }));
      const encabezado = ws.getRow(1);
      encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123C6E' } };
      encabezado.alignment = { vertical: 'middle', wrapText: true };
      encabezado.height = 30;
      for (const fila of hoja.filas) {
        const valores: Record<string, ExcelJS.CellValue> = {};
        for (const c of hoja.columnas) valores[c.clave] = fila[c.clave] ?? null;
        ws.addRow(valores);
      }
      if (hoja.columnas.length > 0) {
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, hoja.filas.length + 1), column: hoja.columnas.length } };
      }
      for (const c of hoja.columnas) {
        if (hoja.filas.some((f) => f[c.clave] instanceof Date)) ws.getColumn(c.clave).numFmt = 'yyyy-mm-dd hh:mm';
      }
    }
    const salida = await workbook.xlsx.writeBuffer();
    return Buffer.from(salida);
  }
}
