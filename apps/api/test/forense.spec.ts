import { SeveridadBandera } from '../src/domain/entities/documento.entity';
import { ForenseDomainService } from '../src/domain/services/forense.domain-service';

const forense = new ForenseDomainService();

function pdf(opciones: { productor?: string; eofs?: number; texto?: string } = {}): Buffer {
  const { productor = 'JasperReports Library', eofs = 1, texto = 'BT /F1 12 Tf (Certificado) Tj ET' } = opciones;
  const cuerpo = [
    '%PDF-1.7',
    '1 0 obj << /Type /Font /BaseFont /Helvetica >> endobj',
    `2 0 obj << /Producer (${productor}) /CreationDate (D:20260801120000) >> endobj`,
    texto,
    'trailer << /Root 1 0 R >>',
    ...Array.from({ length: eofs }, () => '%%EOF'),
  ].join('\n');
  return Buffer.from(cuerpo, 'latin1');
}

describe('Capa 0 — tipo real por firma binaria', () => {
  it('reconoce un PDF', () => {
    expect(forense.detectarMimeReal(pdf())).toBe('application/pdf');
  });

  it('reconoce JPEG y PNG', () => {
    expect(forense.detectarMimeReal(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg');
    expect(
      forense.detectarMimeReal(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
  });

  it('un .txt renombrado a .pdf no pasa', () => {
    const texto = Buffer.from('esto es texto plano, no un PDF', 'utf8');
    expect(forense.detectarMimeReal(texto)).toBeNull();

    const banderas = forense.analizar({
      buffer: texto,
      nombreDeclarado: 'certificado.pdf',
      mimeDeclarado: 'application/pdf',
      coincidenciasHash: 0,
      esperaProductorInstitucional: true,
    });
    expect(banderas[0].codigo).toBe('C0_TIPO_NO_RECONOCIDO');
    expect(banderas[0].severidad).toBe(SeveridadBandera.CRITICA);
  });

  it('marca como crítico el mismo archivo presentado por varios estudiantes', () => {
    const banderas = forense.analizar({
      buffer: pdf(),
      nombreDeclarado: 'planilla.pdf',
      mimeDeclarado: 'application/pdf',
      coincidenciasHash: 3,
      esperaProductorInstitucional: false,
    });
    const duplicado = banderas.find((b) => b.codigo === 'C0_HASH_DUPLICADO');
    expect(duplicado?.severidad).toBe(SeveridadBandera.CRITICA);
  });
});

describe('Capa 1 — forense del archivo', () => {
  it('caso 6: productor de escritorio en documento que debe emitir un sistema', () => {
    const banderas = forense.analizar({
      buffer: pdf({ productor: 'Microsoft Word 2019' }),
      nombreDeclarado: 'existencia.pdf',
      mimeDeclarado: 'application/pdf',
      coincidenciasHash: 0,
      esperaProductorInstitucional: true,
    });
    const bandera = banderas.find((b) => b.codigo === 'C1_PRODUCTOR_ESCRITORIO');
    expect(bandera?.severidad).toBe(SeveridadBandera.CRITICA);
    expect(forense.debeCortocircuitar(banderas)).toBe(true);
  });

  it('caso 1: certificado con productor institucional no levanta banderas críticas', () => {
    const banderas = forense.analizar({
      buffer: pdf({ productor: 'JasperReports Library version 6.20' }),
      nombreDeclarado: 'arl.pdf',
      mimeDeclarado: 'application/pdf',
      coincidenciasHash: 0,
      esperaProductorInstitucional: true,
    });
    expect(forense.debeCortocircuitar(banderas)).toBe(false);
    expect(forense.calcularPuntaje(banderas)).toBeGreaterThanOrEqual(85);
  });

  it('detecta revisiones incrementales por conteo de %%EOF', () => {
    const banderas = forense.analizar({
      buffer: pdf({ eofs: 3 }),
      nombreDeclarado: 'arl.pdf',
      mimeDeclarado: 'application/pdf',
      coincidenciasHash: 0,
      esperaProductorInstitucional: true,
    });
    expect(banderas.some((b) => b.codigo === 'C1_REVISIONES_INCREMENTALES')).toBe(true);
  });

  it('lee los metadatos del PDF sin dependencias externas', () => {
    const meta = forense.leerMetadatosPdf(pdf({ productor: 'iText 7.2.5' }));
    expect(meta.productor).toBe('iText 7.2.5');
    expect(meta.marcasFinArchivo).toBe(1);
    expect(meta.fechaCreacion?.getUTCFullYear()).toBe(2026);
    expect(meta.tieneCapaTexto).toBe(true);
  });
});

describe('Capa 5 — puntaje y bandas', () => {
  it('una bandera crítica manda a banda roja, nunca a rechazo automático', () => {
    const puntaje = forense.calcularPuntaje([
      { codigo: 'X', capa: 1, severidad: SeveridadBandera.CRITICA, mensaje: '' },
    ]);
    expect(puntaje).toBe(30);
  });

  it('un documento sin banderas obtiene 100', () => {
    expect(forense.calcularPuntaje([])).toBe(100);
  });

  it('el puntaje nunca baja de 0', () => {
    const muchas = Array.from({ length: 10 }, () => ({
      codigo: 'X', capa: 1 as const, severidad: SeveridadBandera.CRITICA, mensaje: '',
    }));
    expect(forense.calcularPuntaje(muchas)).toBe(0);
  });
});
