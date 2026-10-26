import {
  SaneamientoPdfDomainService,
} from '../src/domain/services/saneamiento-pdf.domain-service';

const saneador = new SaneamientoPdfDomainService();

function pdf(cuerpo: string): Buffer {
  return Buffer.from(
    ['%PDF-1.7', cuerpo, 'trailer << /Root 1 0 R >>', '%%EOF'].join('\n'),
    'latin1',
  );
}

describe('Saneamiento de PDF', () => {
  it('deja intacto un PDF sin objetos activos', () => {
    const original = pdf('1 0 obj << /Type /Page >> endobj\nBT (Certificado) Tj ET');
    const resultado = saneador.sanear(original);
    expect(resultado.modificado).toBe(false);
    expect(resultado.hallazgos).toHaveLength(0);
    expect(resultado.contenido.equals(original)).toBe(true);
  });

  it('neutraliza JavaScript embebido', () => {
    const resultado = saneador.sanear(
      pdf('1 0 obj << /S /JavaScript /JS (app.alert\\(1\\)) >> endobj'),
    );
    expect(resultado.modificado).toBe(true);
    expect(resultado.hallazgos.some((h) => h.tipo === 'javascript')).toBe(true);
    expect(resultado.contenido.toString('latin1')).not.toContain('/JavaScript');
  });

  it('neutraliza la acción que se ejecuta al abrir el documento', () => {
    const resultado = saneador.sanear(pdf('1 0 obj << /OpenAction 2 0 R >> endobj'));
    expect(resultado.hallazgos.some((h) => h.tipo === 'accion_apertura')).toBe(true);
    expect(resultado.contenido.toString('latin1')).not.toContain('/OpenAction');
  });

  it('neutraliza el lanzamiento de programas externos', () => {
    const resultado = saneador.sanear(pdf('1 0 obj << /S /Launch /F (cmd.exe) >> endobj'));
    expect(resultado.hallazgos.some((h) => h.tipo === 'accion_lanzamiento')).toBe(true);
  });

  it('neutraliza archivos embebidos y envío de formularios', () => {
    const resultado = saneador.sanear(
      pdf('1 0 obj << /Type /EmbeddedFile >> endobj\n2 0 obj << /S /SubmitForm >> endobj'),
    );
    const tipos = resultado.hallazgos.map((h) => h.tipo);
    expect(tipos).toContain('archivo_embebido');
    expect(tipos).toContain('envio_formulario');
  });

  it('conserva el tamaño del archivo para no romper las referencias cruzadas', () => {
    const original = pdf('1 0 obj << /S /JavaScript /JS (x) /OpenAction 2 0 R >> endobj');
    const resultado = saneador.sanear(original);
    expect(resultado.contenido.length).toBe(original.length);
  });

  it('no confunde nombres que apenas empiezan igual', () => {
    // `/JSName` no es una acción JavaScript: no debe tocarse.
    const resultado = saneador.sanear(pdf('1 0 obj << /JSName (inocuo) >> endobj'));
    expect(resultado.modificado).toBe(false);
  });

  it('cuenta todas las ocurrencias del mismo tipo', () => {
    const resultado = saneador.sanear(
      pdf('<< /S /JavaScript >> << /S /JavaScript >> << /S /JavaScript >>'),
    );
    const js = resultado.hallazgos.find((h) => h.tipo === 'javascript');
    expect(js?.ocurrencias).toBe(3);
  });

  it('inspeccionar informa sin modificar el original', () => {
    const original = pdf('1 0 obj << /S /JavaScript >> endobj');
    const hallazgos = saneador.inspeccionar(original);
    expect(hallazgos).toHaveLength(1);
    expect(original.toString('latin1')).toContain('/JavaScript');
  });
});
