// Flujo de cargue de un estudiante: consulta del expediente → upload → verificación de persistencia.
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { BASE, CORRIDA, MIME, NOMBRE_ARCHIVO, TIPO, cabeceras } from './config.js';

export const uploadsIniciados = new Counter('uploads_iniciados');
export const uploadsCompletados = new Counter('uploads_completados');
export const uploadsFallidos = new Counter('uploads_fallidos');
export const uploadsReintentos = new Counter('uploads_reintentos');
export const uploadDuracion = new Trend('upload_duracion', true);
export const persistenciaVerificada = new Counter('persistencia_verificada');

/** El binario y los tokens se abren en el contexto init de cada escenario (open() resuelve desde scenarios/). */
export function cargarDocumento(sesion, binario) {
  const h = cabeceras(sesion.token);

  const antes = http.get(`${BASE}/documentos/practica/${sesion.practicaId}`, { headers: h, tags: { name: 'GET documentos de la práctica' } });
  check(antes, { 'expediente 200': (r) => r.status === 200 });

  uploadsIniciados.add(1);
  const r = http.post(`${BASE}/documentos/practica/${sesion.practicaId}`, {
    tipo: TIPO,
    archivo: http.file(binario, NOMBRE_ARCHIVO, MIME),
  }, { headers: h, tags: { name: 'POST upload' }, timeout: '120s' });
  uploadDuracion.add(r.timings.duration);
  const ok = check(r, { 'upload 201': (x) => x.status === 201 });
  if (!ok) {
    uploadsFallidos.add(1);
    console.log(`UPLOAD_FALLIDO ${JSON.stringify({ corrida: CORRIDA, i: sesion.i, status: r.status, error: r.error_code || null })}`);
    return null;
  }
  uploadsCompletados.add(1);
  const doc = r.json();
  // Marca que lee el verificador de integridad (id del documento que el cliente vio como 201).
  console.log(`DOC201 ${JSON.stringify({ corrida: CORRIDA, i: sesion.i, practicaId: sesion.practicaId, documentoId: doc.id, version: doc.version, estado: doc.estado })}`);

  const despues = http.get(`${BASE}/documentos/practica/${sesion.practicaId}`, { headers: h, tags: { name: 'GET documentos (verificación)' } });
  if (check(despues, { 'documento visible tras el upload': (x) => x.status === 200 && x.json().some((d) => d.id === doc.id) })) persistenciaVerificada.add(1);
  return doc.id;
}
