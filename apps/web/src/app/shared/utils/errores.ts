import { HttpErrorResponse } from '@angular/common/http';

/** Texto legible de un error de la API: el mensaje del servidor si lo trae. */
export function leerError(error: unknown, porDefecto = 'No fue posible completar la operación.'): string {
  if (error instanceof HttpErrorResponse) {
    const cuerpo = error.error as { message?: string | string[]; mensaje?: string } | null;
    if (cuerpo?.mensaje) return cuerpo.mensaje;
    if (Array.isArray(cuerpo?.message)) return cuerpo.message.join('. ');
    if (typeof cuerpo?.message === 'string') return cuerpo.message;
    if (error.status === 0) return 'No hay conexión con el servidor.';
  }
  return porDefecto;
}

/** Descarga un blob con el nombre que trae la cabecera Content-Disposition. */
export function descargarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(url);
}

export function nombreDeCabecera(disposicion: string | null, porDefecto: string): string {
  return disposicion?.match(/filename="([^"]+)"/)?.[1] ?? porDefecto;
}
