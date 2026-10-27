import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaveInterruptorEps, INTERRUPTORES_EPS, interruptorActivo } from '../../domain/services/interruptores-eps';

export { INTERRUPTORES_EPS };

export function interruptorEps(config: ConfigService | undefined, clave: ClaveInterruptorEps): boolean {
  return interruptorActivo(config?.get<string | boolean | undefined>(clave), clave);
}

/** Si el interruptor está apagado responde 503 con un mensaje claro; no cambia ningún dato. */
export function exigirInterruptorEps(config: ConfigService | undefined, clave: ClaveInterruptorEps, mensaje: string): void {
  if (!interruptorEps(config, clave)) throw new ServiceUnavailableException(mensaje);
}
