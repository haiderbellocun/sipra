'use strict';
/**
 * Prueba de humo del ARRANQUE REAL del API.
 *
 * Carga el JS COMPILADO (`dist/`), no el TypeScript: ts-jest hoistea imports y resuelve la
 * inyección de forma distinta, por lo que dos defectos de la Fase 3 (imports pegados tras la
 * clase y un `@Inject` faltante) pasaron todas las pruebas y rompían `node dist/main.js`.
 *
 * Qué detecta: providers faltantes, `@Inject` ausentes, imports en orden inválido, ciclos
 * críticos de carga y errores de configuración. Levanta la aplicación en un puerto efímero,
 * consulta `/salud`, comprueba que rutas protegidas respondan 401 (y no 404, que indicaría
 * un controlador sin registrar) y cierra limpio.
 *
 * Requisitos: `npm run build` hecho y las variables DB_* / JWT_SECRETO / SIPRA_AMBIENTE /
 * AUTH_MODO definidas (la base debe estar migrada). Nunca apunta a una base institucional:
 * se niega si el host no es local.
 */
const host = (process.env.DB_HOST || (process.env.DB_URL ? new URL(process.env.DB_URL).hostname : '')).trim();
if (!['127.0.0.1', 'localhost', '::1', '[::1]', 'postgres'].includes(host)) {
  console.error(`Smoke de arranque: se niega a correr contra un host no local («${host}»).`);
  process.exit(2);
}
// La configuración exige PORT >= 1: se reserva un puerto libre y se suelta justo antes de arrancar.
const net = require('node:net');
const puertoLibre = () => new Promise((ok, mal) => {
  const s = net.createServer();
  s.once('error', mal);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});
process.env.LOG_NIVEL = process.env.LOG_NIVEL || 'warn';

const RUTAS_PROTEGIDAS = ['/api/v1/mesa-eps', '/api/v1/validaciones-eps/adres/bandeja', '/api/v1/documentos/practica/00000000-0000-4000-8000-000000000041'];

async function main() {
  const puerto = await puertoLibre();
  process.env.PORT = String(puerto);
  const { crearAplicacion } = require('../dist/crear-aplicacion.js');
  const app = await crearAplicacion();
  const fallos = [];
  try {
    await app.listen(puerto, '127.0.0.1');
    const base = `http://127.0.0.1:${puerto}`;

    const salud = await fetch(`${base}/api/v1/salud`);
    if (salud.status !== 200) fallos.push(`/salud respondió ${salud.status}`);
    for (const ruta of RUTAS_PROTEGIDAS) {
      const r = await fetch(`${base}${ruta}`);
      if (r.status !== 401) fallos.push(`${ruta} sin sesión respondió ${r.status} (se esperaba 401)`);
    }
    // Metrics no debe estar abierto sin token.
    const m = await fetch(`${base}/api/v1/metrics`);
    if (m.status === 200) fallos.push('/metrics respondió 200 sin credenciales');
  } finally {
    await app.close();
  }
  if (fallos.length > 0) {
    console.error(`Smoke de arranque: FALLÓ\n  · ${fallos.join('\n  · ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('Smoke de arranque: OK (AppModule resuelto, /salud 200, rutas protegidas 401, cierre limpio)');
}

// Salida diferida: en Windows process.exit con handles cerrándose dispara una aserción de libuv.
const salir = (codigo) => setTimeout(() => process.exit(codigo), 300);
main().then(() => salir(process.exitCode || 0), (e) => {
  console.error(`Smoke de arranque: FALLÓ al iniciar\n${e && e.stack ? e.stack : e}`);
  salir(1);
});
