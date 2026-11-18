import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * Límite de solicitudes para los endpoints PÚBLICOS de cartas (consulta por identificación, descarga y verificación).
 * SIPRA no tenía un mecanismo de throttling: este es el único, pequeño y explícito.
 *
 * Ventanas fijas por IP (la API confía en el proxy: `trustProxy`) y por regla:
 *  - consulta por identificación: 10 por minuto y 60 por hora;
 *  - consultas SIN resultado: tras 8 en 15 minutos, la IP queda en pausa 15 minutos (protección adaptativa contra el
 *    barrido de cédulas, sin CAPTCHA ni proveedor externo);
 *  - descarga pública: 30 por minuto; verificación por referencia: 60 por minuto.
 * Un empresario legítimo consulta unas pocas cédulas; un barrido necesita miles.
 *
 * Alcance: memoria del proceso. Con varias instancias de Cloud Run el límite es por instancia (el total permitido se
 * multiplica por el número de instancias): en pre/prod debe complementarse con una regla de Cloud Armor sobre
 * `/api/v1/cartas-presentacion/publica/*` (documentado como riesgo).
 */
export type ReglaLimite = 'consulta_minuto' | 'consulta_hora' | 'fallidas' | 'descarga' | 'verificacion';

const REGLAS: Readonly<Record<ReglaLimite, { maximo: number; ventanaMs: number }>> = {
  consulta_minuto: { maximo: 10, ventanaMs: 60_000 },
  consulta_hora: { maximo: 60, ventanaMs: 3_600_000 },
  fallidas: { maximo: 8, ventanaMs: 15 * 60_000 },
  descarga: { maximo: 30, ventanaMs: 60_000 },
  verificacion: { maximo: 60, ventanaMs: 60_000 },
};

export const MENSAJE_LIMITE = 'Demasiadas consultas desde esta conexión. Intenta de nuevo en unos minutos.';

@Injectable()
export class LimitadorPublicoService {
  private readonly ventanas = new Map<string, { inicio: number; cuenta: number }>();
  private ultimaLimpieza = 0;

  /** Lanza 429 si la IP ya agotó la regla; si no, cuenta esta solicitud. */
  exigir(regla: ReglaLimite, ip: string, ahora: number = Date.now()): void {
    const espera = this.restante(regla, ip, ahora);
    if (espera > 0) throw new HttpException({ statusCode: 429, message: MENSAJE_LIMITE, reintentarEnSegundos: Math.ceil(espera / 1000) }, HttpStatus.TOO_MANY_REQUESTS);
    this.contar(regla, ip, ahora);
  }

  /** Solo consulta (sin contar): para la regla de fallidas, que cuenta únicamente los resultados vacíos. */
  verificarSinContar(regla: ReglaLimite, ip: string, ahora: number = Date.now()): void {
    const espera = this.restante(regla, ip, ahora);
    if (espera > 0) throw new HttpException({ statusCode: 429, message: MENSAJE_LIMITE, reintentarEnSegundos: Math.ceil(espera / 1000) }, HttpStatus.TOO_MANY_REQUESTS);
  }

  contar(regla: ReglaLimite, ip: string, ahora: number = Date.now()): void {
    this.limpiar(ahora);
    const clave = `${regla}|${ip}`;
    const { ventanaMs } = REGLAS[regla];
    const v = this.ventanas.get(clave);
    if (!v || ahora - v.inicio >= ventanaMs) this.ventanas.set(clave, { inicio: ahora, cuenta: 1 });
    else v.cuenta += 1;
  }

  /** Milisegundos hasta que la IP vuelva a tener cupo en la regla (0 = tiene cupo). */
  private restante(regla: ReglaLimite, ip: string, ahora: number): number {
    const v = this.ventanas.get(`${regla}|${ip}`);
    const { maximo, ventanaMs } = REGLAS[regla];
    if (!v || ahora - v.inicio >= ventanaMs) return 0;
    return v.cuenta >= maximo ? v.inicio + ventanaMs - ahora : 0;
  }

  /** Evita que el mapa crezca sin fin (una pasada por minuto). */
  private limpiar(ahora: number): void {
    if (ahora - this.ultimaLimpieza < 60_000) return;
    this.ultimaLimpieza = ahora;
    for (const [clave, v] of this.ventanas) {
      const regla = clave.split('|')[0] as ReglaLimite;
      if (ahora - v.inicio >= REGLAS[regla].ventanaMs) this.ventanas.delete(clave);
    }
  }
}
