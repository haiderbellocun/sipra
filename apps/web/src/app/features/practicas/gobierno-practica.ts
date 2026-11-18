import { Practica } from '@core/models/modelos';

/**
 * G5 · Editor de la práctica (presentación). El servidor autoriza (solo coordinación y analista), valida y audita;
 * aquí se arma el formulario, se calcula el resumen «antes → después» y se envían SOLO los campos que cambiaron.
 * Fechas, periodo, empresa, estado, nota y horas no se editan aquí.
 */
export interface FormularioPractica {
  modalidad: string;
  area: string;
  cargo: string;
  tipoRemuneracion: '' | 'remunerada' | 'no_remunerada';
  salario: string;
  responsableArl: '' | 'empresa' | 'cun';
  horario: string;
  ciudad: string;
  jefeInmediatoNombre: string;
  jefeInmediatoCargo: string;
  jefeInmediatoCorreo: string;
  jefeInmediatoTelefono: string;
  funcionesRelevantes: string;
}

export const CAMPOS_PRACTICA: readonly { clave: keyof FormularioPractica; etiqueta: string }[] = [
  { clave: 'modalidad', etiqueta: 'Modalidad' },
  { clave: 'area', etiqueta: 'Área' },
  { clave: 'cargo', etiqueta: 'Cargo' },
  { clave: 'tipoRemuneracion', etiqueta: 'Remuneración' },
  { clave: 'salario', etiqueta: 'Salario' },
  { clave: 'responsableArl', etiqueta: 'Responsable ARL' },
  { clave: 'horario', etiqueta: 'Horario' },
  { clave: 'ciudad', etiqueta: 'Ciudad' },
  { clave: 'jefeInmediatoNombre', etiqueta: 'Jefe inmediato' },
  { clave: 'jefeInmediatoCargo', etiqueta: 'Cargo del jefe' },
  { clave: 'jefeInmediatoCorreo', etiqueta: 'Correo del jefe' },
  { clave: 'jefeInmediatoTelefono', etiqueta: 'Teléfono del jefe' },
  { clave: 'funcionesRelevantes', etiqueta: 'Funciones' },
];

export function formularioDesdePractica(p: Practica): FormularioPractica {
  return {
    modalidad: p.modalidad, area: p.area ?? '', cargo: p.cargo ?? '', tipoRemuneracion: p.tipoRemuneracion ?? '',
    salario: p.salario === null ? '' : String(p.salario), responsableArl: p.responsableArl ?? '', horario: p.horario ?? '',
    ciudad: p.ciudad ?? '', jefeInmediatoNombre: p.jefeInmediatoNombre ?? '', jefeInmediatoCargo: p.jefeInmediatoCargo ?? '',
    jefeInmediatoCorreo: p.jefeInmediatoCorreo ?? '', jefeInmediatoTelefono: p.jefeInmediatoTelefono ?? '',
    funcionesRelevantes: p.funcionesRelevantes ?? '',
  };
}

export interface CambioCampo { clave: keyof FormularioPractica; etiqueta: string; de: string; a: string }

/** Resumen «antes → después» con valores legibles (la etiqueta de cada valor la da quien llama). */
export function cambiosFormulario(
  original: FormularioPractica, actual: FormularioPractica, legible: (clave: keyof FormularioPractica, valor: string) => string,
): CambioCampo[] {
  const salida: CambioCampo[] = [];
  for (const { clave, etiqueta } of CAMPOS_PRACTICA) {
    const de = String(original[clave] ?? '').trim();
    const a = String(actual[clave] ?? '').trim();
    if (clave === 'salario' && actual.tipoRemuneracion === 'no_remunerada') continue; // lo limpia el servidor
    if (de !== a) salida.push({ clave, etiqueta, de: legible(clave, de) || '—', a: legible(clave, a) || '—' });
  }
  return salida;
}

/** Cuerpo de la petición: solo lo que cambió, más justificación y versión (control optimista). */
export function cuerpoModificacion(original: FormularioPractica, actual: FormularioPractica, justificacion: string, version: string): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = { justificacion: justificacion.trim(), actualizadaEn: version };
  for (const { clave } of CAMPOS_PRACTICA) {
    const a = String(actual[clave] ?? '').trim();
    if (a === String(original[clave] ?? '').trim()) continue;
    if (clave === 'salario') { if (actual.tipoRemuneracion !== 'no_remunerada' && a !== '') cuerpo['salario'] = Number(a); continue; }
    if (a === '' && (clave === 'tipoRemuneracion' || clave === 'responsableArl' || clave === 'modalidad')) continue; // no se «borran»
    cuerpo[clave] = a;
  }
  return cuerpo;
}

export const JUSTIFICACION_MINIMA = 10;

export function problemasEdicion(actual: FormularioPractica, justificacion: string): Partial<Record<'justificacion' | 'jefeInmediatoCorreo' | 'salario', string>> {
  const p: Partial<Record<'justificacion' | 'jefeInmediatoCorreo' | 'salario', string>> = {};
  if (justificacion.trim().length < JUSTIFICACION_MINIMA) p.justificacion = `Escribe el motivo del cambio (mínimo ${JUSTIFICACION_MINIMA} caracteres).`;
  if (actual.jefeInmediatoCorreo.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(actual.jefeInmediatoCorreo.trim())) p.jefeInmediatoCorreo = 'Escribe un correo válido.';
  if (actual.salario.trim() && !(Number(actual.salario) >= 0)) p.salario = 'El salario es un número positivo.';
  return p;
}
