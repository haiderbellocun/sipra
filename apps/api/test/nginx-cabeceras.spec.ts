import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * nginx NO hereda los `add_header` del nivel superior en un bloque que declara
 * alguno propio. Esta prueba fija la configuración del frontend: todo bloque con
 * cabeceras propias debe repetir las de seguridad, y las métricas no se publican.
 */

const CONFIGURACION = readFileSync(join(__dirname, '..', '..', 'web', 'nginx.conf'), 'utf8');

interface Bloque { encabezado: string; cuerpo: string }

/** Bloques `location ... { ... }` (en esta configuración no se anidan). */
function locations(texto: string): Bloque[] {
  return [...texto.matchAll(/location\s+([^{]+?)\s*\{([^}]*)\}/g)].map((m) => ({
    encabezado: m[1].trim(), cuerpo: m[2],
  }));
}

const CABECERAS_DE_SEGURIDAD = [
  /add_header\s+X-Content-Type-Options\s+"nosniff"/,
  /add_header\s+Referrer-Policy\s+"strict-origin-when-cross-origin"/,
  /add_header\s+X-Frame-Options\s+"DENY"/,
];

describe('nginx · cabeceras de seguridad', () => {
  const bloques = locations(CONFIGURACION);

  it('el nivel del servidor declara las cabeceras de seguridad', () => {
    const servidor = CONFIGURACION.replace(/location\s+[^{]+\{[^}]*\}/g, '');
    for (const cabecera of CABECERAS_DE_SEGURIDAD) expect(servidor).toMatch(cabecera);
  });

  it('se encontraron los bloques que importan (index, estáticos, SPA, API)', () => {
    const nombres = bloques.map((b) => b.encabezado);
    expect(nombres).toEqual(expect.arrayContaining(['= /index.html', '/api/', '/']));
    expect(nombres.some((n) => n.startsWith('~* '))).toBe(true);
  });

  it('todo bloque con add_header propio repite las cabeceras de seguridad (index.html, estáticos…)', () => {
    const conCabecerasPropias = bloques.filter((b) => /add_header/.test(b.cuerpo));
    expect(conCabecerasPropias.length).toBeGreaterThanOrEqual(2);
    for (const bloque of conCabecerasPropias) {
      for (const cabecera of CABECERAS_DE_SEGURIDAD) {
        expect({ bloque: bloque.encabezado, cumple: cabecera.test(bloque.cuerpo) })
          .toEqual({ bloque: bloque.encabezado, cumple: true });
      }
    }
  });

  it('el respaldo de la SPA y el index.html salen con las cabeceras (directas o heredadas)', () => {
    const spa = bloques.find((b) => b.encabezado === '/');
    const index = bloques.find((b) => b.encabezado === '= /index.html');
    expect(spa?.cuerpo).toContain('try_files $uri $uri/ /index.html');
    expect(spa?.cuerpo).not.toContain('add_header'); // hereda las del servidor
    for (const cabecera of CABECERAS_DE_SEGURIDAD) expect(index?.cuerpo).toMatch(cabecera);
  });
});

describe('nginx · métricas', () => {
  const bloques = locations(CONFIGURACION);

  it('no se publican por el origen web: 404 y antes del proxy de la API', () => {
    const metricas = bloques.find((b) => b.encabezado.includes('metrics'));
    expect(metricas).toBeDefined();
    expect(metricas?.cuerpo).toMatch(/return\s+404/);
    expect(new RegExp(metricas!.encabezado.replace(/^~\s*/, '')).test('/api/v1/metrics')).toBe(true);
    expect(new RegExp(metricas!.encabezado.replace(/^~\s*/, '')).test('/api/v2/metrics/')).toBe(true);
    expect(new RegExp(metricas!.encabezado.replace(/^~\s*/, '')).test('/api/v1/salud')).toBe(false);
    expect(CONFIGURACION.indexOf(metricas!.encabezado)).toBeLessThan(CONFIGURACION.indexOf('location /api/'));
  });
});
