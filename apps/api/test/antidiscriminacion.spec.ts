import {
  AntidiscriminacionDomainService,
} from '../src/domain/services/antidiscriminacion.domain-service';

describe('Filtro antidiscriminación de vacantes', () => {
  const filtro = new AntidiscriminacionDomainService();

  it('bloquea el caso de referencia del demo', () => {
    const hallazgos = filtro.analizar('persona entre 20 y 30 años con foto reciente');
    expect(hallazgos.map((h) => h.categoria).sort()).toEqual(['edad', 'fotografia']);
    expect(filtro.esPublicable('persona entre 20 y 30 años con foto reciente')).toBe(false);
  });

  it.each([
    ['máximo 35 años', 'edad'],
    ['se busca mujer para el cargo', 'sexo'],
    ['adjuntar fotografía tipo documento', 'fotografia'],
    ['no extranjeros', 'origen'],
    ['solteros sin hijos', 'estado_civil'],
    ['buena presencia', 'apariencia'],
    ['religión católica', 'religion'],
  ])('bloquea «%s» por %s', (texto, categoria) => {
    expect(filtro.analizar(texto).some((h) => h.categoria === categoria)).toBe(true);
  });

  it('deja pasar una vacante redactada correctamente', () => {
    const publicable = filtro.esPublicable(
      'Practicante de operaciones logísticas',
      'Apoyo a la coordinación de despachos y control de inventario.',
      'Registro de guías, conciliación de inventario, apoyo en programación de rutas.',
      'Estudiante activo con matrícula vigente en la asignatura de práctica. Manejo de hojas de cálculo.',
    );
    expect(publicable).toBe(true);
  });

  it('analiza el conjunto del texto publicable, no solo el título', () => {
    const hallazgos = filtro.analizar(
      'Auxiliar contable',
      'Apoyo al área financiera.',
      'Conciliaciones bancarias.',
      'Preferiblemente mujer, con foto reciente.',
    );
    expect(hallazgos.length).toBeGreaterThanOrEqual(2);
  });

  it('cada hallazgo cita la norma que lo sustenta', () => {
    for (const hallazgo of filtro.analizar('máximo 30 años, sin tatuajes, foto reciente')) {
      expect(hallazgo.norma).toBeTruthy();
      expect(hallazgo.fragmento).toBeTruthy();
    }
  });
});
