/**
 * NIT colombiano con dígito de verificación calculado según el algoritmo
 * publicado por la DIAN. Capa 0 del pipeline de validación (determinística).
 */
export class NitInvalidoError extends Error {
  constructor(motivo: string) {
    super(`NIT inválido: ${motivo}`);
    this.name = 'NitInvalidoError';
  }
}

/** Pesos oficiales DIAN, aplicados de derecha a izquierda sobre el número base. */
const PESOS_DIAN = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

export class Nit {
  private constructor(
    public readonly numero: string,
    public readonly digitoVerificacion: number,
  ) {}

  /** Calcula el DV de un NIT sin él. `901458772` → `2`. */
  static calcularDigitoVerificacion(numero: string): number {
    const base = numero.replace(/\D/g, '');
    if (base.length === 0 || base.length > PESOS_DIAN.length) {
      throw new NitInvalidoError(`longitud no admitida (${base.length} dígitos)`);
    }
    const invertido = base.split('').reverse();
    const suma = invertido.reduce(
      (acumulado, digito, indice) => acumulado + Number(digito) * PESOS_DIAN[indice],
      0,
    );
    const residuo = suma % 11;
    return residuo > 1 ? 11 - residuo : residuo;
  }

  /** Construye desde `900123456-7`, `9001234567` o `900123456`. */
  static crear(entrada: string): Nit {
    const limpio = (entrada ?? '').trim();
    if (!limpio) throw new NitInvalidoError('valor vacío');

    const conGuion = limpio.match(/^(\d{5,15})\s*-\s*(\d)$/);
    if (conGuion) {
      const [, base, dv] = conGuion;
      const esperado = Nit.calcularDigitoVerificacion(base);
      if (esperado !== Number(dv)) {
        throw new NitInvalidoError(`el dígito de verificación debería ser ${esperado}`);
      }
      return new Nit(base, esperado);
    }

    const soloDigitos = limpio.replace(/\D/g, '');
    if (soloDigitos.length < 6) throw new NitInvalidoError('menos de 6 dígitos');
    return new Nit(soloDigitos, Nit.calcularDigitoVerificacion(soloDigitos));
  }

  /** Verifica una pareja número/DV sin lanzar. */
  static esValido(numero: string, digitoVerificacion: number): boolean {
    try {
      return Nit.calcularDigitoVerificacion(numero) === digitoVerificacion;
    } catch {
      return false;
    }
  }

  get formateado(): string {
    return `${this.numero}-${this.digitoVerificacion}`;
  }

  equals(otro: Nit): boolean {
    return this.numero === otro.numero;
  }

  toString(): string {
    return this.formateado;
  }
}
