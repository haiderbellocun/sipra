import {
  CAMPOS_PLAZA, CAMPOS_VACANTE, MARCA_BORRADOR, RegistroVacanteSpe,
  ReportesSpeDomainService, SEPARADOR,
} from '../src/domain/services/reportes-spe.domain-service';

const generador = new ReportesSpeDomainService();

const vacante = (sobrescribir: Partial<RegistroVacanteSpe> = {}): RegistroVacanteSpe => ({
  identificadorVacante: 'v-1',
  nitEmpresa: '901458772-2',
  razonSocial: 'Soluciones Logísticas Andinas S.A.S.',
  cargo: 'Auxiliar de inventario',
  descripcion: 'Apoyo al control de inventario.',
  funciones: 'Conteo cíclico y registro en sistema.',
  requisitos: 'Técnico en logística.',
  codigoCno: '4321',
  codigoCiiu: '5210',
  divipolaMunicipio: '11001',
  nivelEducativo: 'tecnologica',
  numeroVacantes: 2,
  salarioMinimo: 1_423_500,
  salarioMaximo: null,
  fechaPublicacion: new Date('2026-08-28T00:00:00Z'),
  fechaVencimiento: new Date('2027-02-28T00:00:00Z'),
  ...sobrescribir,
});

const opciones = {
  anexoConfirmado: true,
  fecha: new Date('2026-08-28T00:00:00Z'),
  nitPrestador: '860013779',
};

describe('Archivo plano para la Unidad del SPE', () => {
  it('usa el separador |$$| entre campos', () => {
    const archivo = generador.generarVacantes([vacante()], opciones);
    const [cabecera, fila] = archivo.contenido.trim().split('\n');
    expect(cabecera.split(SEPARADOR)).toHaveLength(CAMPOS_VACANTE.length);
    expect(fila.split(SEPARADOR)).toHaveLength(CAMPOS_VACANTE.length);
  });

  it('la cabecera nombra los campos en el orden declarado', () => {
    const archivo = generador.generarVacantes([], opciones);
    expect(archivo.contenido.trim().split(SEPARADOR)[0]).toBe('IDENTIFICADOR_VACANTE');
    expect(archivo.contenido).toContain('CODIGO_DIVIPOLA');
  });

  it('nombra el archivo con el NIT del prestador y la fecha', () => {
    expect(generador.generarVacantes([], opciones).nombre)
      .toBe('860013779_VACANTES_20260828.txt');
    expect(generador.generarPlazas([], opciones).nombre)
      .toBe('860013779_PLAZAS_20260828.txt');
  });

  it('cuenta los registros emitidos', () => {
    expect(generador.generarVacantes([vacante(), vacante()], opciones).registros).toBe(2);
  });

  describe('saneamiento de valores', () => {
    it('elimina el separador que venga dentro de un campo', () => {
      // Sin esto, el separador incrustado partiría la fila y desplazaría
      // todas las columnas siguientes en el sistema receptor.
      const archivo = generador.generarVacantes(
        [vacante({ cargo: `Auxiliar${SEPARADOR}de inventario` })],
        opciones,
      );
      const fila = archivo.contenido.trim().split('\n')[1];
      expect(fila.split(SEPARADOR)).toHaveLength(CAMPOS_VACANTE.length);
      expect(fila).toContain('Auxiliar de inventario');
    });

    it('elimina saltos de línea que romperían el registro', () => {
      const archivo = generador.generarVacantes(
        [vacante({ descripcion: 'Primera línea\nSegunda línea\r\nTercera' })],
        opciones,
      );
      expect(archivo.contenido.trim().split('\n')).toHaveLength(2);
    });

    it('colapsa espacios repetidos y recorta los extremos', () => {
      expect(generador.sanearValor('  Auxiliar    de   inventario  '))
        .toBe('Auxiliar de inventario');
    });
  });

  describe('marca de borrador', () => {
    it('marca el archivo cuando el anexo técnico no está conciliado', () => {
      const archivo = generador.generarVacantes([vacante()], {
        ...opciones, anexoConfirmado: false,
      });
      expect(archivo.contenido).toContain(MARCA_BORRADOR);
      expect(archivo.contenido).toContain('No radicar');
    });

    it('no marca nada cuando el anexo está confirmado', () => {
      expect(generador.generarVacantes([vacante()], opciones).contenido)
        .not.toContain(MARCA_BORRADOR);
    });
  });

  describe('campos', () => {
    it('deja vacío el salario máximo cuando no se declaró', () => {
      const fila = generador.generarVacantes([vacante({ salarioMaximo: null })], opciones)
        .contenido.trim().split('\n')[1].split(SEPARADOR);
      const indice = CAMPOS_VACANTE.findIndex((c) => c.nombre === 'SALARIO_MAXIMO');
      expect(fila[indice]).toBe('');
    });

    it('escribe las fechas en formato AAAA-MM-DD', () => {
      const fila = generador.generarVacantes([vacante()], opciones)
        .contenido.trim().split('\n')[1].split(SEPARADOR);
      const indice = CAMPOS_VACANTE.findIndex((c) => c.nombre === 'FECHA_PUBLICACION');
      expect(fila[indice]).toBe('2026-08-28');
    });

    it('el archivo de plazas declara sus propios campos', () => {
      const nombres = CAMPOS_PLAZA.map((c) => c.nombre);
      expect(nombres).toContain('DOCUMENTO_PRACTICANTE');
      expect(nombres).toContain('MODALIDAD');
      expect(nombres).not.toContain('SALARIO_MINIMO');
    });
  });
});
