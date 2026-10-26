import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { MetricasService } from './metricas.service';

/** Instrumenta tráfico, errores y latencia de todas las rutas. */
@Injectable()
export class MetricasInterceptor implements NestInterceptor {
  constructor(private readonly metricas: MetricasService) {}

  intercept(contexto: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    if (contexto.getType() !== 'http') return siguiente.handle();

    const http = contexto.switchToHttp();
    const request = http.getRequest<{ method: string; routerPath?: string; url: string }>();
    const respuesta = http.getResponse<{ statusCode: number }>();
    const inicio = process.hrtime.bigint();

    const registrar = (status: number): void => {
      const segundos = Number(process.hrtime.bigint() - inicio) / 1e9;
      // Se usa la plantilla de ruta, no la URL: evita cardinalidad ilimitada.
      const etiquetas = {
        method: request.method,
        route: request.routerPath ?? 'desconocida',
        status_code: String(status),
      };
      this.metricas.peticiones.inc(etiquetas);
      this.metricas.duracion.observe(etiquetas, segundos);
    };

    return siguiente.handle().pipe(
      tap(() => registrar(respuesta.statusCode ?? 200)),
      catchError((error: { status?: number }) => {
        registrar(error?.status ?? 500);
        return throwError(() => error);
      }),
    );
  }
}
