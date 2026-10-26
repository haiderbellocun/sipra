import {
  DISPOSICION_TRAMA, Pdf417DomainService,
} from '../src/domain/services/pdf417.domain-service';

const pdf417 = new Pdf417DomainService();

/**
 * Trama de la Registraduría con los campos en sus posiciones fijas.
 * Los datos son ficticios: no corresponden a ninguna persona real.
 */
function trama(opciones: {
  numero: string;
  primerApellido: string;
  segundoApellido: string;
  nombres: string;
  sexo?: 'M' | 'F';
  nacimiento?: string;
}): string {
  const campos = new Array(200).fill(' ');
  const escribir = (texto: string, desde: number): void => {
    [...texto].forEach((caracter, i) => {
      campos[desde + i] = caracter;
    });
  };

  // Cabecera y número con relleno de ceros, como en la trama real.
  const cabecera = `PubDSK_1${'0'.repeat(38 - opciones.numero.length)}${opciones.numero}`;
  escribir(cabecera, 0);
  escribir(opciones.primerApellido, DISPOSICION_TRAMA.primerApellido.desde);
  escribir(opciones.segundoApellido, DISPOSICION_TRAMA.segundoApellido.desde);
  escribir(opciones.nombres, DISPOSICION_TRAMA.nombres.desde);
  escribir(`${opciones.sexo ?? 'F'} ${opciones.nacimiento ?? '19990415'}`,
    DISPOSICION_TRAMA.nombres.desde + DISPOSICION_TRAMA.nombres.largo + 1);
  return campos.join('').trimEnd();
}

const cedulaValida = trama({
  numero: '1032456789',
  primerApellido: 'RAMIREZ',
  segundoApellido: 'ORTIZ',
  nombres: 'LAURA SOFIA',
});

describe('Interpretación de la trama de la cédula', () => {
  it('extrae los campos de las posiciones declaradas', () => {
    const { leida, cedula } = pdf417.interpretar(cedulaValida);
    expect(leida).toBe(true);
    expect(cedula!.numeroDocumento).toBe('1032456789');
    expect(cedula!.primerApellido).toBe('RAMIREZ');
    expect(cedula!.segundoApellido).toBe('ORTIZ');
    expect(cedula!.nombres).toBe('LAURA SOFIA');
  });

  it('declara que la disposición de la trama aún no está conciliada', () => {
    expect(pdf417.interpretar(cedulaValida).cedula!.disposicionConfirmada).toBe(false);
  });

  it('lee el sexo y la fecha de nacimiento cuando vienen', () => {
    const { cedula } = pdf417.interpretar(cedulaValida);
    expect(cedula!.sexo).toBe('F');
    expect(cedula!.fechaNacimiento).toBe('1999-04-15');
  });

  it('rechaza una fecha imposible en vez de devolverla', () => {
    // Una fecha inválida en un documento de identidad es una lectura fallida,
    // no un dato que se pueda pasar adelante.
    const { cedula } = pdf417.interpretar(
      trama({
        numero: '1032456789', primerApellido: 'RAMIREZ', segundoApellido: 'ORTIZ',
        nombres: 'LAURA', nacimiento: '19991345',
      }),
    );
    expect(cedula!.fechaNacimiento).toBeNull();
  });

  describe('lecturas que no proceden', () => {
    it('un contenido vacío pide volver a capturar el reverso', () => {
      const { leida, motivo } = pdf417.interpretar('');
      expect(leida).toBe(false);
      expect(motivo).toMatch(/REVERSO/);
    });

    it('un código que no es de una cédula lo dice', () => {
      const { leida, motivo } = pdf417.interpretar('https://ejemplo.com/algo');
      expect(leida).toBe(false);
      expect(motivo).toMatch(/no corresponde a una cédula/);
    });

    it('una trama sin número de documento no se da por leída', () => {
      const { leida, motivo } = pdf417.interpretar('PubDSK_1 SIN DATOS NUMERICOS AQUI');
      expect(leida).toBe(false);
      expect(motivo).toMatch(/número de documento/);
    });
  });
});

describe('Dígito de verificación del NUIP', () => {
  it('acepta un número cuyo dígito cuadra', () => {
    // Se construye el número calculando su propio dígito, para no depender de
    // un caso memorizado.
    const base = '103245678';
    const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41];
    const suma = [...base].reduce((t, d, i) => t + Number(d) * pesos[i], 0);
    const residuo = suma % 11;
    const digito = residuo > 1 ? 11 - residuo : residuo;
    expect(pdf417.verificarNumero(base + digito)).toBe(true);
  });

  it('rechaza un número cuyo dígito no cuadra', () => {
    const base = '103245678';
    const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41];
    const suma = [...base].reduce((t, d, i) => t + Number(d) * pesos[i], 0);
    const residuo = suma % 11;
    const correcto = residuo > 1 ? 11 - residuo : residuo;
    const incorrecto = (correcto + 1) % 10;
    expect(pdf417.verificarNumero(base + incorrecto)).toBe(false);
  });

  it('no se pronuncia sobre cédulas anteriores al NUIP', () => {
    // No llevan dígito de verificación. Devolver false haría parecer
    // sospechoso un documento perfectamente válido.
    expect(pdf417.verificarNumero('52334455')).toBeNull();
    expect(pdf417.verificarNumero('79554433')).toBeNull();
  });

  it('no se pronuncia ante un valor que no es numérico', () => {
    expect(pdf417.verificarNumero('10A2456789')).toBeNull();
  });
});

describe('Correspondencia con el estudiante matriculado', () => {
  const cedula = pdf417.interpretar(cedulaValida).cedula!;

  it('NO se pronuncia mientras la disposición de la trama no esté conciliada', () => {
    // Es la garantía que importa hoy: acusar a un estudiante con nombres
    // leídos de posiciones supuestas sería peor que no comprobar nada.
    expect(DISPOSICION_TRAMA.confirmada).toBe(false);
    expect(pdf417.correspondeA(cedula, 'Laura Sofía Ramírez Ortiz')).toBeNull();
    expect(pdf417.correspondeA(cedula, 'Andrés Felipe Mora Castaño')).toBeNull();
  });

  describe('una vez conciliada la disposición', () => {
    const conDisposicion = { ...cedula, disposicionConfirmada: true };

    it('reconoce al titular aunque cambie el orden de los nombres', () => {
      expect(pdf417.correspondeA(conDisposicion, 'Laura Sofía Ramírez Ortiz')).toBe(true);
      expect(pdf417.correspondeA(conDisposicion, 'Ramírez Ortiz Laura Sofía')).toBe(true);
    });

    it('tolera las tildes, que rara vez viajan en el código', () => {
      expect(pdf417.correspondeA(conDisposicion, 'LAURA SOFÍA RAMÍREZ ORTIZ')).toBe(true);
    });

    it('reconoce al titular aunque falte un nombre', () => {
      expect(pdf417.correspondeA(conDisposicion, 'Laura Ramírez')).toBe(true);
    });

    it('NO reconoce a otra persona: es el caso que importa', () => {
      expect(pdf417.correspondeA(conDisposicion, 'Andrés Felipe Mora Castaño')).toBe(false);
    });

    it('no reconoce a alguien que solo comparte un apellido', () => {
      expect(pdf417.correspondeA(conDisposicion, 'Carlos Ramírez Peña')).toBe(false);
    });

    it('rechaza un nombre vacío', () => {
      expect(pdf417.correspondeA(conDisposicion, '')).toBe(false);
    });
  });
});
