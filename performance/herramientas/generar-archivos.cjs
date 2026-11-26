// Generador de archivos SINTÉTICOS válidos para las pruebas de carga (P4). Escribe en performance/archivos/ (ignorado
// por Git). Sin JavaScript, acciones ni adjuntos: el saneamiento del PDF no debe alterarlos.
//
//   node performance/herramientas/generar-archivos.cjs
//
// Clases: pequeno (PDF ≈150 KB), medio (PDF ≈2 MB), medio-jpg (JPG ≈1,5 MB), limite (PDF ≈9,5 MB),
// negativo (PDF ≈10,5 MB: debe RECHAZARSE con DOC_TAMANO_MAXIMO_MB=10).
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const DIR = join(__dirname, '..', 'archivos');
const KB = 1024;
const MB = 1024 * 1024;

/** PDF 1.4 válido: una página con texto y un objeto de relleno ASCIIHex (solo [0-9A-F]: ningún «/JS» posible). */
function pdf(bytesObjetivo, etiqueta) {
  const partes = [];
  const offsets = [];
  let largo = 0;
  const add = (s) => { const b = Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1'); partes.push(b); largo += b.length; };
  const obj = (n, cuerpo) => { offsets[n] = largo; add(`${n} 0 obj\n`); add(cuerpo); add('\nendobj\n'); };
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const texto = `BT /F1 14 Tf 72 720 Td (Documento sintetico de performance SIPRA - ${etiqueta}) Tj ET`;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>');
  obj(4, `<< /Length ${texto.length} >>\nstream\n${texto}\nendstream`);
  obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  // Relleno: objeto no referenciado con datos hexadecimales pseudoaleatorios deterministas.
  const reserva = 600; // xref + trailer + cabecera del objeto 6
  const n = Math.max(0, bytesObjetivo - largo - reserva);
  const hex = Buffer.alloc(n);
  let s = 0x9e3779b9 ^ bytesObjetivo;
  const H = '0123456789ABCDEF';
  for (let i = 0; i < n; i += 1) {
    if (i % 80 === 79) { hex[i] = 0x0a; continue; }
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    hex[i] = H.charCodeAt((s >>> 0) & 15);
  }
  offsets[6] = largo;
  add(`6 0 obj\n<< /Length ${n + 1} /Filter /ASCIIHexDecode >>\nstream\n`);
  add(hex);
  add('>\nendstream\nendobj\n');
  const xref = largo;
  add(`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  add(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(partes);
}

/**
 * JPEG baseline válido (escala de grises 64×64, todos los bloques planos) con tablas Huffman mínimas de un código
 * (DC categoría 0 y EOB). El tamaño se alcanza con segmentos COM de texto, que los decodificadores ignoran.
 */
function jpg(bytesObjetivo) {
  const seg = (marca, datos) => { const l = Buffer.alloc(4); l.writeUInt16BE(marca, 0); l.writeUInt16BE(datos.length + 2, 2); return Buffer.concat([l, datos]); };
  const partes = [Buffer.from([0xff, 0xd8])];
  partes.push(seg(0xffe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0])));
  partes.push(seg(0xffdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 1)])));
  partes.push(seg(0xffc0, Buffer.from([8, 0, 64, 0, 64, 1, 1, 0x11, 0])));
  const tabla = (clase) => { const bits = Buffer.alloc(16); bits[0] = 1; return Buffer.concat([Buffer.from([clase]), bits, Buffer.from([0x00])]); };
  partes.push(seg(0xffc4, Buffer.concat([tabla(0x00), tabla(0x10)])));
  const fijo = partes.reduce((a, b) => a + b.length, 0) + 14 + 16 + 2;
  let falta = Math.max(0, bytesObjetivo - fijo);
  const relleno = [];
  while (falta > 4) {
    const n = Math.min(65533, falta - 4);
    relleno.push(seg(0xfffe, Buffer.alloc(n, 0x2e)));
    falta -= n + 4;
  }
  partes.splice(1, 0, ...relleno);
  partes.push(seg(0xffda, Buffer.from([1, 1, 0x00, 0, 63, 0])));
  partes.push(Buffer.alloc(16, 0x00)); // 64 bloques × (DC «0» + EOB «0») = 128 bits a cero
  partes.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(partes);
}

mkdirSync(DIR, { recursive: true });
const archivos = [
  ['pequeno.pdf', pdf(150 * KB, 'pequeno')],
  ['medio.pdf', pdf(2 * MB, 'medio')],
  ['medio.jpg', jpg(1.5 * MB)],
  ['limite.pdf', pdf(Math.round(9.5 * MB), 'limite')],
  ['negativo.pdf', pdf(Math.round(10.5 * MB), 'negativo')],
];
for (const [nombre, contenido] of archivos) {
  writeFileSync(join(DIR, nombre), contenido);
  console.log(`${nombre.padEnd(14)} ${(contenido.length / MB).toFixed(3)} MB`);
}
