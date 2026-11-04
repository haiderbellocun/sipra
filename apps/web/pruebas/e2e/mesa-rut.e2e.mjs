// E2E local de la Mesa de RUT en un navegador real (Chrome instalado, por CDP).
//
// Requisitos (todo local y desechable; SOLO PDF sintéticos):
//   · API en dev (AUTH_MODO=abierto) contra una base DESECHABLE con las semillas sintéticas, preparada con
//     `apps/api/herramientas/preparar-e2e-rut.ts` (ajusta las prácticas a CUNbre y genera los PDF sintéticos).
//   · Frontend servido (compilado o ng serve) con proxy al API.
//   · Variables: E2E_API (por defecto http://localhost:3100/api/v1), E2E_WEB (http://localhost:4202),
//     E2E_RUT (carpeta con manifiesto.json y los PDF), E2E_CAPTURAS (carpeta opcional), E2E_PSQL + E2E_DB (psql y base desechable:
//     para marcar el método de lectura como OCR y para cambiar datos de SIPRA, que solo se pueden hacer en la base).
// Uso: node pruebas/e2e/mesa-rut.e2e.mjs
//
// Recorrido: ESTUDIANTE carga el RUT → FUNCIONARIO (docente) toma, revisa y DEVUELVE → ESTUDIANTE ve el mensaje y REENVÍA → FUNCIONARIO
// toma la versión nueva y APRUEBA. Además: persona distinta, documento incorrecto + rechazo, lectura por OCR, discrepancia crítica con
// 40 caracteres, reserva concurrente y liberar, supervisión, datos de SIPRA que cambian, permisos y responsive.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Navegador } from './cdp.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3100/api/v1';
const WEB = process.env.E2E_WEB ?? 'http://localhost:4202';
const RUT = process.env.E2E_RUT;
const CAPTURAS = process.env.E2E_CAPTURAS;
const PSQL = process.env.E2E_PSQL ?? 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const DB = process.env.E2E_DB ?? 'sipra_e2e_rut';
if (!RUT) { console.error('Falta E2E_RUT (carpeta con manifiesto.json y los PDF sintéticos).'); process.exit(2); }
const manifiesto = JSON.parse(readFileSync(join(RUT, 'manifiesto.json'), 'utf8'));

const resultados = [];
const paso = async (nombre, f) => {
  try { await f(); resultados.push({ nombre, ok: true }); console.log(`  ✔ ${nombre}`); }
  catch (e) { resultados.push({ nombre, ok: false, error: e.message }); console.log(`  ✘ ${nombre}\n      ${e.message}`); }
};
const afirmar = (cond, mensaje) => { if (!cond) throw new Error(mensaje); };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (consulta) => execFileSync(PSQL, ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', DB, '-Atc', consulta], { encoding: 'utf8' }).trim();

const [P_LAURA, P_ANDRES, P_VALENTINA] = manifiesto.practicas;
const LAURA = { correo: 'laura.ramirez@estudiante.cun.edu.co', practica: P_LAURA, nombre: 'Laura Sofía Ramírez Ortiz' };
const ANDRES = { correo: 'andres.mora@estudiante.cun.edu.co', practica: P_ANDRES, nombre: 'Andrés Felipe Mora Castaño' };
const VALENTINA = { correo: 'valentina.ochoa@estudiante.cun.edu.co', practica: P_VALENTINA, nombre: 'Valentina Ochoa Ruiz' };

async function api(ruta, { token, metodo = 'GET', cuerpo, formulario } = {}) {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: formulario ?? (cuerpo ? JSON.stringify(cuerpo) : undefined),
  });
  const texto = await r.text();
  return { estado: r.status, json: texto ? (() => { try { return JSON.parse(texto); } catch { return null; } })() : null };
}
const ingresar = async (rol, correo) => (await api('/auth/ingresar', { metodo: 'POST', cuerpo: { rol, correo } })).json;

async function cargarRutPorApi(sesion, practica, tipo, archivo) {
  const f = new FormData();
  f.append('tipo', tipo);
  f.append('archivo', new Blob([readFileSync(archivo)], { type: 'application/pdf' }), 'rut.pdf');
  const r = await api(`/documentos/practica/${practica}`, { token: sesion.accessToken, metodo: 'POST', formulario: f });
  if (r.estado >= 300) throw new Error(`No se pudo cargar el RUT: ${r.estado} ${JSON.stringify(r.json)}`);
}

async function esperarBandeja(token, condicion, ms = 90000, descripcion = 'la bandeja') {
  const limite = Date.now() + ms;
  let ultima = null;
  while (Date.now() < limite) {
    ultima = (await api('/mesa-rut', { token })).json;
    if (ultima && condicion(ultima)) return ultima;
    await dormir(700);
  }
  throw new Error(`Tiempo agotado esperando ${descripcion}: ${JSON.stringify(ultima?.items?.map((i) => [i.estudiante.nombre, i.estado, i.recomendacion]))}`);
}
const casoDe = (lista, estudiante) => lista.items.find((i) => i.estudiante.nombre === estudiante.nombre);

// ── Utilidades de pantalla ──────────────────────────────────────────────────

const sinDesborde = 'document.documentElement.scrollWidth <= window.innerWidth + 1';
const textoPagina = 'document.body.innerText';
const textoDe = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.innerText ?? '')`;
const SIN_ETIQUETA = `[...document.querySelectorAll('input, select, textarea')].filter((e) => (e.offsetWidth || e.offsetHeight) && e.type !== 'hidden' && !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).map((e) => e.id || e.name || e.tagName)`;
const contrasteDe = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const pintar = (c) => { cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); };
  const leer = () => { const d = cx.getImageData(0, 0, 1, 1).data; return { r: d[0], g: d[1], b: d[2] }; };
  const capas = []; for (let e = el; e; e = e.parentElement) { capas.push(getComputedStyle(e).backgroundColor); }
  pintar('#ffffff'); for (const c of capas.reverse()) pintar(c);
  const fondo = leer();
  pintar('rgb(' + fondo.r + ',' + fondo.g + ',' + fondo.b + ')'); pintar(getComputedStyle(el).color);
  const texto = leer();
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const [x, y] = [lum(texto), lum(fondo)].sort((m, n) => n - m);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
})()`;

const BOTON = (dialogo, texto) => `[...document.querySelectorAll('${dialogo} button')].find((b) => b.textContent.includes(${JSON.stringify(texto)}))`;
const dialogoAbierto = `!!document.querySelector('dialog[open]')`;
const elegir = (nav, selector, valor) => nav.evaluar(`(() => { const s = document.querySelector(${JSON.stringify(selector)}); s.value = ${JSON.stringify(valor)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);

async function abrirMesa(nav, sesion, { ancho = 1440, alto = 900, tema = 'oscuro' } = {}) {
  await nav.sembrarSesion(sesion);
  await nav.enviar('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('sipra.rut.lista','si');localStorage.setItem('sipra.tema',${JSON.stringify(tema)});}catch(e){}` });
  await nav.vista(ancho, alto);
  await nav.ir(`${WEB}/mesa-rut`);
  await nav.esperar(`document.querySelector('h1')?.textContent.includes('Mesa de RUT')`, 30000, 'título de la Mesa de RUT');
  await nav.esperar(`!document.body.innerText.includes('Cargando los casos')`, 20000, 'fin de la carga');
}

async function abrirCaso(nav, estudiante) {
  await nav.clic('.caso', estudiante.nombre);
  await nav.esperar(`document.querySelector('sipra-rut-detalle h2')?.textContent.includes(${JSON.stringify(estudiante.nombre)})`, 20000, `caso de ${estudiante.nombre}`);
}

async function tomarCaso(nav) {
  await nav.clic('sipra-rut-detalle button', 'Tomar el caso');
  await nav.esperar(`/Tomado por usted/.test(document.body.innerText) && !!document.querySelector('sipra-rut-visor iframe')`, 20000, 'reserva y visor');
}

async function estudianteCarga(nav, sesion, estudiante, tipo, archivo) {
  await nav.sembrarSesion(sesion);
  await nav.vista(1440, 900);
  await nav.ir(`${WEB}/practicas/${estudiante.practica}`);
  await nav.esperar(`!!document.querySelector('[data-rut-estado]')`, 30000, 'la tarjeta del RUT');
  await nav.evaluar(`(() => { const s = document.querySelector('#tipo-doc'); s.value = ${JSON.stringify(tipo)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await nav.archivo('input[type=file]', archivo);
  await nav.esperar(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Cargar y validar') && !b.disabled)`, 15000, 'botón Cargar y validar');
  await nav.clic('button', 'Cargar y validar');
}

async function main() {
  if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });
  const captura = async (nav, nombre) => { if (CAPTURAS) await nav.captura(join(CAPTURAS, `${nombre}.png`)); };
  const tutor = await ingresar('tutor');
  // Coordinación de ingenierías (escuelas: ESC-ING): solo alcanza a Andrés.
  const coord = await ingresar('coordinador', 'coordinacion.ingenierias@cun.edu.co');
  const admin = await ingresar('administrador');
  const aux = await ingresar('auxiliar');
  const estLaura = await ingresar('estudiante', LAURA.correo);
  const estAndres = await ingresar('estudiante', ANDRES.correo);
  const estValentina = await ingresar('estudiante', VALENTINA.correo);

  console.log('\nPreparación (API): Andrés (RUT jurídico con otra razón social) y Valentina (RUT de persona jurídica cargado como natural)');
  await cargarRutPorApi(estAndres, ANDRES.practica, 'rut_juridico', manifiesto.archivos['juridica-otra-razon']);
  await cargarRutPorApi(estValentina, VALENTINA.practica, 'rut_natural', manifiesto.archivos['juridica-ok']);

  const nav = await Navegador.abrir();
  try {
    // ── 1 · Estudiante: carga el RUT (versión 1) ────────────────────────────
    console.log('\nEstudiante: carga su RUT');
    await paso('el estudiante ve «Pendiente de cargar» con qué pasó y qué hacer, sin códigos', async () => {
      await nav.sembrarSesion(estLaura);
      await nav.vista(1440, 900);
      await nav.ir(`${WEB}/practicas/${LAURA.practica}`);
      await nav.esperar(`!!document.querySelector('[data-rut-estado]')`, 30000, 'la tarjeta del RUT');
      const t = await nav.evaluar(textoDe('[data-rut-mensaje]'));
      afirmar(await nav.evaluar(textoDe('[data-rut-estado]')) === 'Pendiente de cargar', 'falta el estado «Pendiente de cargar»');
      afirmar(/¿Qué pasó\?/.test(t) && /¿Qué debo hacer\?/.test(t), 'debe responder qué pasó y qué hacer');
      afirmar(!/_|pendiente\b/.test(t.replace(/Pendiente/g, '')), 'no debe mostrar nombres internos');
      await captura(nav, 'estudiante-1-pendiente');
    });
    await paso('carga el RUT (con otro documento de identidad) por el expediente y queda «En revisión»', async () => {
      await estudianteCarga(nav, estLaura, LAURA, 'rut_natural', manifiesto.archivos['1-natural-otro-documento']);
      await nav.esperar(`document.querySelector('[data-rut-estado]')?.innerText === 'En revisión'`, 90000, 'estado «En revisión»');
      const t = await nav.evaluar(textoDe('[data-rut-mensaje]'));
      afirmar(/Tu RUT está en revisión/.test(t), `mensaje inesperado: ${t}`);
      afirmar(!(await nav.evaluar(`[...document.querySelectorAll('[data-rut-mensaje] button')].some((b) => /nueva versión/i.test(b.textContent))`)), 'no debe ofrecer reenviar mientras está en revisión');
    });
    const bandejaTutor = await esperarBandeja(tutor.accessToken, (l) => l.items.length >= 2 && l.items.every((i) => i.estado === 'revision'), 90000, 'los 2 casos del docente en revisión');
    const bandejaCoord = await esperarBandeja(coord.accessToken, (l) => l.items.length >= 1, 90000, 'el caso de la coordinación');
    const idAndres = casoDe(bandejaCoord, ANDRES).validacionId;
    await paso('alcance: con 3 casos abiertos, la coordinación de ingenierías ve solo el de su escuela y el docente solo los suyos', async () => {
      afirmar(bandejaCoord.items.length === 1 && bandejaCoord.items[0].estudiante.nombre === ANDRES.nombre, `coordinación: ${JSON.stringify(bandejaCoord.items.map((i) => i.estudiante.nombre))}`);
      afirmar(bandejaTutor.items.length === 2 && !bandejaTutor.items.some((i) => i.estudiante.nombre === ANDRES.nombre), 'el docente no debe ver el caso de otra escuela');
      const todo = (await api('/mesa-rut', { token: admin.accessToken })).json;
      afirmar(todo.items.length === 3, `administración debe ver los 3: ${todo.items.length}`);
    });

    // ── 2 · Responsive: bandeja y caso ──────────────────────────────────────
    for (const [ancho, alto, etiqueta] of [[1920, 1080, '1920'], [1440, 900, '1440'], [1366, 768, '1366'], [1024, 768, '1024'], [768, 1024, '768'], [390, 844, 'móvil 390']]) {
      console.log(`\nVista ${etiqueta}`);
      await paso(`${etiqueta}: bandeja con KPIs, filtros esenciales y lista, sin desborde horizontal`, async () => {
        await abrirMesa(nav, tutor, { ancho, alto });
        afirmar(await nav.evaluar(`document.querySelectorAll('.kpi').length >= 6`), 'faltan los KPIs');
        afirmar(await nav.evaluar(`!!document.querySelector('#f-buscar') && !!document.querySelector('#f-reserva') && !!document.querySelector('#f-persona')`), 'faltan la búsqueda y los filtros esenciales');
        afirmar(await nav.evaluar(`document.querySelectorAll('.caso').length === 2`), 'el docente debe ver 2 casos');
        afirmar(await nav.evaluar(sinDesborde), `desborde horizontal a ${etiqueta}`);
        afirmar((await nav.evaluar(SIN_ETIQUETA)).length === 0, `controles sin etiqueta: ${await nav.evaluar(`JSON.stringify(${SIN_ETIQUETA})`)}`);
        await captura(nav, `bandeja-${ancho}`);
      });
      await paso(`${etiqueta}: el caso (documento + comparación + decisión) se abre sin desborde y se vuelve a la lista`, async () => {
        await abrirCaso(nav, LAURA);
        await nav.esperar(`!!document.querySelector('table.cmp')`, 20000, 'la tabla de comparación');
        afirmar(await nav.evaluar(sinDesborde), `desborde horizontal con el caso a ${etiqueta}`);
        afirmar(await nav.evaluar(`!!document.querySelector('.barra-decision')`), 'falta la barra de decisión');
        if (ancho < 1200) {
          afirmar(await nav.evaluar(`getComputedStyle(document.querySelector('.lista-col')).display === 'none'`), 'en pantalla angosta se ve una sola cosa: el caso');
          await nav.clic('sipra-rut-detalle button', 'Volver a la lista');
          await nav.esperar(`getComputedStyle(document.querySelector('.lista-col')).display !== 'none'`, 5000, 'volver a la lista');
        } else {
          afirmar(await nav.evaluar(`document.querySelectorAll('.caso').length === 2`), 'en escritorio la lista sigue junto al caso');
        }
        await captura(nav, `caso-${ancho}`);
      });
    }

    // ── 3 · Bandeja: contenido, KPIs y filtros ──────────────────────────────
    console.log('\nBandeja (docente)');
    await abrirMesa(nav, tutor);
    await paso('cada caso se escanea rápido: estudiante, tipo esperado/detectado, problema principal, antigüedad y reserva (sin pilas de insignias)', async () => {
      const t = await nav.evaluar(textoDe('.lista'));
      afirmar(t.includes(LAURA.nombre) && t.includes(VALENTINA.nombre), 'faltan los estudiantes');
      afirmar(/Esperado: RUT persona natural · Detectado: RUT persona jurídica/.test(t), 'falta lo esperado/detectado de Valentina');
      afirmar(/Tipo de persona distinto al esperado/.test(t) && /Diferencias críticas con SIPRA/.test(t), 'faltan los problemas principales');
      afirmar(/(Hoy|\d+ días?) · .*Disponible/.test(t), 'falta antigüedad · reserva');
      afirmar(await nav.evaluar(`document.querySelectorAll('.lista .etiqueta').length === 0`), 'la bandeja no debe llenarse de insignias');
      afirmar(!/_|discrepancia_critica|persona_distinta|revision\b/.test(t), `la bandeja muestra códigos internos: ${t.slice(0, 200)}`);
      afirmar(!t.includes(ANDRES.nombre), 'el docente NO debe ver el caso de otra escuela');
    });
    await paso('los KPIs son operativos y filtran: «Persona distinta» deja solo a Valentina; pulsar de nuevo quita el filtro', async () => {
      const k = await nav.evaluar(`[...document.querySelectorAll('.kpi')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`);
      afirmar(['Pendientes', 'Míos', 'Con discrepancias', 'Leídos por OCR', 'Persona distinta', 'Documento incorrecto'].every((x) => k.some((y) => y.includes(x))), `KPIs: ${k.join(' | ')}`);
      afirmar(k.some((x) => /^2 Pendientes$/.test(x)), `pendientes: ${k.join(' | ')}`);
      await nav.clic('.kpi', 'Persona distinta');
      await nav.esperar(`document.querySelectorAll('.caso').length === 1 && document.querySelector('.caso').innerText.includes(${JSON.stringify(VALENTINA.nombre)})`, 10000, 'filtro persona distinta');
      afirmar(await nav.evaluar(`document.querySelector('.kpi[aria-pressed=true]')?.innerText.includes('Persona distinta')`), 'el KPI activo debe marcarse (aria-pressed)');
      await nav.clic('.kpi', 'Persona distinta');
      await nav.esperar(`document.querySelectorAll('.caso').length === 2`, 10000, 'sin filtro');
    });
    await paso('la búsqueda y «Más filtros» (con la cantidad activa) funcionan; el filtro de estado es solo de supervisión', async () => {
      await nav.escribir('#f-buscar', 'valentina');
      await nav.esperar(`document.querySelectorAll('.caso').length === 1`, 10000, 'búsqueda');
      await nav.escribir('#f-buscar', '');
      await nav.esperar(`document.querySelectorAll('.caso').length === 2`, 10000, 'búsqueda vacía');
      afirmar(await nav.evaluar(`document.querySelector('#mas-filtros').hidden`), 'los filtros secundarios deben empezar plegados');
      await nav.clic('button', 'Más filtros');
      afirmar(await nav.evaluar(`!document.querySelector('#mas-filtros').hidden && !!document.querySelector('#f-ocr') && !!document.querySelector('#f-pd') && !!document.querySelector('#f-prio')`), 'faltan los filtros de más');
      afirmar(!(await nav.evaluar(`!!document.querySelector('#f-estado')`)), 'el filtro por estado es solo de supervisión');
      await elegir(nav, '#f-pd', 'si');
      await nav.esperar(`document.querySelectorAll('.caso').length === 1 && /\\(1\\)/.test(document.querySelector('[aria-controls=mas-filtros]').innerText)`, 10000, 'filtro por persona distinta y su contador');
      await nav.clic('button', 'Limpiar filtros');
      await nav.esperar(`document.querySelectorAll('.caso').length === 2`, 10000, 'limpiar filtros');
    });

    // ── 4 · Docente: Valentina — persona distinta y devolución ──────────────
    console.log('\nDocente: persona distinta (Valentina) y devolución');
    await paso('abrir un caso libre no lo reserva: se ve el resultado, y hay que tomarlo para abrir el RUT y decidir', async () => {
      await abrirCaso(nav, VALENTINA);
      afirmar(/Disponible/.test(await nav.evaluar(textoDe('sipra-rut-detalle header'))), 'debe verse «Disponible»');
      afirmar(/Tome el caso para abrir el RUT/.test(await nav.evaluar(textoDe('sipra-rut-visor'))), 'el visor debe pedir tomar el caso');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('.barra-decision button')].every((b) => b.disabled)`), 'las decisiones deben estar deshabilitadas sin la reserva');
      afirmar(/Toma el caso para poder decidir/.test(await nav.evaluar(textoDe('.barra-decision'))), 'debe decir por qué no se puede decidir');
    });
    await paso('persona distinta: «El documento es un RUT válido, pero corresponde a un tipo de persona diferente al esperado.» (no «inválido»)', async () => {
      const r = await nav.evaluar(textoDe('[data-resultado]'));
      afirmar(/PERSONA DISTINTA/i.test(r), `resultado: ${r}`);
      afirmar(r.includes('El documento es un RUT válido, pero corresponde a un tipo de persona diferente al esperado.'), 'falta la frase de persona distinta');
      afirmar(!/inválid|incorrecto/i.test(r), 'no debe decir que el documento es inválido');
      const lectura = await nav.evaluar(textoDe('.lectura'));
      afirmar(/Esperado: RUT persona natural/.test(lectura) && /Detectado: RUT persona jurídica/.test(lectura) && /Persona: Persona jurídica/.test(lectura), `lectura: ${lectura}`);
    });
    await paso('al tomar el caso: reservado a su nombre, el RUT se abre solo (blob local, con Authorization, sin credenciales en la URL)', async () => {
      await tomarCaso(nav);
      afirmar(await nav.evaluar(`document.querySelector('sipra-rut-visor iframe').src.startsWith('blob:')`), 'el visor debe usar un blob local');
      afirmar(!nav.solicitudes.some((s) => /\/archivo/.test(s.url) && /token|access|jwt/i.test(s.url)), 'no debe haber credenciales en la URL del archivo');
      afirmar(nav.solicitudes.filter((s) => /\/mesa-rut\/.+\/archivo/.test(s.url)).every((s) => s.cabeceras.Authorization || s.cabeceras.authorization), 'el archivo debe pedirse con la cabecera Authorization');
      afirmar(await nav.evaluar(`![...document.querySelectorAll('.barra-decision button')].some((b) => b.disabled)`), 'las decisiones deben habilitarse con el caso tomado');
      await captura(nav, 'caso-persona-distinta');
    });
    await paso('visor: página, zoom, ajustar ancho y pantalla ampliada (diálogo que devuelve el foco)', async () => {
      const src0 = await nav.evaluar(`document.querySelector('sipra-rut-visor iframe').src`);
      afirmar(/page=1/.test(src0) && /view=FitH/.test(src0), `parámetros iniciales: ${src0}`);
      await nav.clic('sipra-rut-visor button', '+');
      await nav.esperar(`/zoom=125/.test(document.querySelector('sipra-rut-visor iframe').src)`, 5000, 'zoom 125');
      afirmar((await nav.evaluar(textoDe('sipra-rut-visor .controles'))).includes('125 %'), 'el zoom debe verse como 125 %');
      await nav.clic('sipra-rut-visor button', 'Ajustar ancho');
      await nav.esperar(`/view=FitH/.test(document.querySelector('sipra-rut-visor iframe').src)`, 5000, 'ajuste al ancho');
      await nav.clic('sipra-rut-visor button', '›');
      await nav.esperar(`/page=2/.test(document.querySelector('sipra-rut-visor iframe').src)`, 5000, 'página 2');
      await nav.clic('sipra-rut-visor button', 'Ampliar');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo ampliado');
      afirmar(await nav.evaluar(`!!document.querySelector('dialog.ampliado[open] iframe')`), 'el diálogo ampliado debe mostrar el PDF');
      await nav.clic('dialog.ampliado[open] button', 'Cerrar');
      await nav.esperar(`!document.querySelector('dialog[open]')`, 5000, 'cierre');
    });
    await paso('comparación: Campo | SIPRA | RUT | Resultado; lo que no se compara NO dice «No coincide»; el QR no se presenta como autenticidad', async () => {
      const cab = await nav.evaluar(`[...document.querySelectorAll('table[data-tabla=criticos] thead th')].map((e) => e.innerText.trim())`);
      afirmar(/^CAMPO\|SIPRA\|RUT\|RESULTADO$/i.test(cab.join('|')), `encabezados: ${cab.join('|')}`);
      const filas = await nav.evaluar(textoDe('table[data-tabla=criticos]'));
      afirmar(/No aplica/.test(filas) && !/No coincide/.test(filas), `persona distinta: los críticos son «No aplica»: ${filas}`);
      afirmar(await nav.evaluar(`document.querySelectorAll('table[data-tabla=informativos]').length === 1`), 'los informativos van en una tabla aparte');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('table[data-tabla=criticos] th[scope=row]')].every((e) => !/CIIU|DIVIPOLA|Fecha de generación/.test(e.innerText))`), 'los informativos no se mezclan con los críticos');
      const qr = await nav.evaluar(textoDe('[data-qr]'));
      afirmar(/QR (detectado|no determinado)/.test(qr) && /Autenticidad: no verificada/.test(qr), `QR: ${qr}`);
      afirmar(!/RUT aut[eé]ntico/i.test(await nav.evaluar(textoPagina)), 'nunca debe decir «RUT auténtico»');
    });
    await paso('pestañas Versiones | Evidencia | Historial: versión activa por defecto y teclado (flechas); la evidencia no muestra texto del documento', async () => {
      const tabs = await nav.evaluar(`[...document.querySelectorAll('[role=tab]')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`);
      afirmar(/^Versiones/.test(tabs[0]) && /^Evidencia/.test(tabs[1]) && /^Historial/.test(tabs[2]), `pestañas: ${tabs.join(' | ')}`);
      afirmar(await nav.evaluar(`document.querySelector('#rt-versiones').getAttribute('aria-selected') === 'true'`), 'Versiones debe ser la pestaña por defecto');
      afirmar(/v1.*Vigente.*En revisión.*En pantalla/s.test(await nav.evaluar(textoDe('#rp-versiones'))), 'falta la versión 1 vigente');
      await nav.evaluar(`document.querySelector('#rt-versiones').focus()`);
      await nav.enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await nav.enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await nav.esperar(`document.querySelector('#rt-evidencia').getAttribute('aria-selected') === 'true' && document.activeElement.id === 'rt-evidencia'`, 5000, 'flecha derecha → Evidencia');
      const ev = await nav.evaluar(textoDe('#rp-evidencia'));
      afirmar(/Lectura del documento|Clasificación del documento|Comparación con SIPRA/.test(ev) && !/[0-9a-f]{40}|_/.test(ev), `evidencia: ${ev}`);
      await nav.clic('[role=tab]', 'Versiones');
    });
    await paso('devolver: solo los motivos que aplican a persona jurídica, tomados de la API; vista previa de lo que leerá el estudiante', async () => {
      await nav.clic('.barra-decision button', 'Devolver');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      afirmar(await nav.evaluar(`${BOTON('dialog[open]', 'Devolver RUT')}.disabled`), 'sin motivo no se puede devolver');
      const motivos = await nav.evaluar(`[...document.querySelectorAll('#rut-motivo option')].map((o) => o.textContent.trim())`);
      const catalogo = (await api('/mesa-rut/motivos-devolucion', { token: tutor.accessToken })).json;
      const esperados = catalogo.filter((m) => m.aplicaA.includes('juridica')).map((m) => m.titulo);
      afirmar(esperados.length >= 8 && esperados.every((t) => motivos.includes(t)) && motivos.length === esperados.length + 1, `motivos: ${motivos.join(' | ')}`);
      afirmar(!catalogo.filter((m) => !m.aplicaA.includes('juridica')).some((m) => motivos.includes(m.titulo)), 'no deben ofrecerse motivos de persona natural');
      await elegir(nav, '#rut-motivo', 'persona_no_coincide');
      await nav.esperar(`/El estudiante verá/.test(document.querySelector('dialog[open]').innerText)`, 5000, 'vista previa');
      const prev = await nav.evaluar(textoDe('dialog[open] .previa'));
      const m = catalogo.find((x) => x.codigo === 'persona_no_coincide');
      afirmar(prev.includes(m.mensajeEstudiante.que) && prev.includes(m.mensajeEstudiante.hacer) && /¿Qué pasó\?/.test(prev) && /¿Qué debo hacer\?/.test(prev), `vista previa: ${prev}`);
      await captura(nav, 'dialogo-devolver');
    });
    await paso('con «Otro» el texto es obligatorio (mínimo 10, contador visible); cancelar devuelve el foco al botón que abrió el diálogo', async () => {
      await elegir(nav, '#rut-motivo', 'otro');
      await nav.esperar(`!!document.querySelector('#rut-detalle')`, 5000, 'campo de texto');
      afirmar(await nav.evaluar(`${BOTON('dialog[open]', 'Devolver RUT')}.disabled`), 'con «otro» sin texto no se puede devolver');
      await nav.escribir('#rut-detalle', 'corto');
      afirmar(/5 \/ 10/.test(await nav.evaluar(textoDe('dialog[open]'))), 'debe mostrar el contador 5 / 10');
      afirmar(await nav.evaluar(`${BOTON('dialog[open]', 'Devolver RUT')}.disabled`), 'con menos de 10 caracteres sigue deshabilitado');
      await nav.clic('dialog[open] button', 'Cancelar');
      await nav.esperar(`!document.querySelector('dialog[open]')`, 5000, 'cierre');
      await nav.evaluar(`[...document.querySelectorAll('.barra-decision button')].find((x) => x.textContent.includes('Devolver')).focus()`);
      await nav.enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await nav.enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await nav.esperar(dialogoAbierto, 5000, 'diálogo abierto con el teclado');
      await nav.clic('dialog[open] button', 'Cancelar');
      await nav.esperar(`!document.querySelector('dialog[open]')`, 5000, 'cierre');
      afirmar(await nav.evaluar(`document.activeElement?.textContent.includes('Devolver')`), `el foco quedó en: ${await nav.evaluar('document.activeElement?.outerHTML.slice(0, 80)')}`);
    });
    await paso('confirmar la devolución: queda devuelto, con quién, cuándo y motivo, y no se puede decidir de nuevo', async () => {
      await nav.clic('.barra-decision button', 'Devolver');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      await elegir(nav, '#rut-motivo', 'persona_no_coincide');
      await nav.esperar(`!${BOTON('dialog[open]', 'Devolver RUT')}.disabled`, 5000, 'botón habilitado');
      await nav.clic('dialog[open] button', 'Devolver RUT');
      await nav.esperar(`/RUT devuelto al estudiante\\./.test(document.body.innerText) && /Decisión: Devuelto/.test(document.body.innerText)`, 20000, 'devolución registrada');
      afirmar(await nav.evaluar(`document.querySelectorAll('.barra-decision button').length === 0`), 'tras decidir no se ofrecen más decisiones');
      afirmar(/Hernán/.test(await nav.evaluar(textoDe('[data-decision]'))), 'debe decir quién decidió');
    });
    await paso('el estudiante ve «Necesita corrección», qué pasó y qué hacer (del catálogo), sin códigos', async () => {
      await nav.sembrarSesion(estValentina);
      await nav.vista(1440, 900);
      await nav.ir(`${WEB}/practicas/${VALENTINA.practica}`);
      await nav.esperar(`document.querySelector('[data-rut-estado]')?.innerText === 'Necesita corrección'`, 30000, 'estado «Necesita corrección»');
      const t = await nav.evaluar(textoDe('[data-rut-mensaje]'));
      const m = (await api('/mesa-rut/motivos-devolucion', { token: tutor.accessToken })).json.find((x) => x.codigo === 'persona_no_coincide');
      afirmar(t.includes(m.mensajeEstudiante.que) && t.includes(m.mensajeEstudiante.hacer), `mensaje: ${t}`);
      afirmar(!/persona_no_coincide|devuelto|C[0-3]_|hash|confianza|_/.test(t), `códigos internos en el mensaje: ${t}`);
      afirmar(await nav.evaluar(`[...document.querySelectorAll('[data-rut-mensaje] button')].some((b) => b.textContent.includes('Subir nueva versión'))`), 'falta «Subir nueva versión»');
      await captura(nav, 'estudiante-devuelto');
    });

    // ── 5 · Valentina v2: documento incorrecto y rechazo ────────────────────
    console.log('\nDocente: documento incorrecto y rechazo (Valentina, versión 2)');
    await cargarRutPorApi(estValentina, VALENTINA.practica, 'rut_natural', manifiesto.archivos['otro-documento']);
    await esperarBandeja(tutor.accessToken, (l) => l.items.some((i) => i.estudiante.nombre === VALENTINA.nombre && i.version === 2 && i.recomendacion === 'documento_incorrecto'), 90000, 'la versión 2 de Valentina');
    await abrirMesa(nav, tutor);
    await paso('la versión 2 aparece como reenvío con «Parece ser otro documento»; la versión 1 devuelta ya no está en la cola', async () => {
      const t = await nav.evaluar(textoDe('.lista'));
      afirmar(/Parece ser otro documento/.test(t) && /Reenvío \(v2\)/.test(t), `cola: ${t}`);
      afirmar(await nav.evaluar(`[...document.querySelectorAll('.caso')].filter((c) => c.innerText.includes(${JSON.stringify(VALENTINA.nombre)})).length === 1`), 'solo la versión vigente');
    });
    await paso('documento incorrecto: «El archivo no corresponde al tipo de documento esperado.»; se puede revisar el archivo y NO se rechaza solo', async () => {
      await abrirCaso(nav, VALENTINA);
      await tomarCaso(nav);
      const r = await nav.evaluar(textoDe('[data-resultado]'));
      afirmar(/DOCUMENTO NO CORRESPONDE/i.test(r) && r.includes('El archivo no corresponde al tipo de documento esperado.'), `resultado: ${r}`);
      afirmar(/No se compara/.test(await nav.evaluar(textoPagina)), 'debe decir que no se compara');
      afirmar(await nav.evaluar(`!!document.querySelector('sipra-rut-visor iframe')`), 'debe poder revisarse visualmente');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('.barra-decision button')].every((b) => !b.disabled)`), 'la decisión sigue siendo humana (sin rechazo automático)');
      await captura(nav, 'caso-documento-incorrecto');
    });
    await paso('aprobar un documento incorrecto exige 40 caracteres, con advertencia y contador «0 / 40»', async () => {
      await nav.clic('.barra-decision button', 'Aprobar');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      const d = await nav.evaluar(textoDe('dialog[open]'));
      afirmar(/decisión distinta de la recomendación del sistema/.test(d) && /0 \/ 40/.test(d), `diálogo: ${d}`);
      afirmar(await nav.evaluar(`${BOTON('dialog[open]', 'Aprobar RUT')}.disabled`), 'sin justificación no se puede aprobar');
      await nav.clic('dialog[open] button', 'Cancelar');
      await nav.esperar(`!document.querySelector('dialog[open]')`, 5000, 'cierre');
    });
    await paso('rechazar exige justificación y confirmación explícita; avisa «Esta versión quedará cerrada»', async () => {
      await nav.clic('.barra-decision button', 'Rechazar');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      const d = await nav.evaluar(textoDe('dialog[open]'));
      afirmar(/Esta versión quedará cerrada/.test(d) && /devolverlo/.test(d), 'falta el aviso de impacto');
      afirmar(await nav.evaluar(`${BOTON('dialog[open]', 'Rechazar RUT')}.disabled`), 'sin justificación, deshabilitado');
      await nav.escribir('#rut-just', 'Es una cédula, no un RUT.');
      afirmar(await nav.evaluar(`${BOTON('dialog[open]', 'Rechazar RUT')}.disabled`), 'sin confirmar, sigue deshabilitado');
      await nav.clic('dialog[open] input[type=checkbox]');
      afirmar(await nav.evaluar(`!${BOTON('dialog[open]', 'Rechazar RUT')}.disabled`), 'con justificación y confirmación debe habilitarse');
      await captura(nav, 'dialogo-rechazar');
      await nav.clic('dialog[open] button', 'Rechazar RUT');
      await nav.esperar(`/RUT rechazado\\./.test(document.body.innerText) && /Decisión: Rechazado/.test(document.body.innerText)`, 20000, 'rechazo registrado');
    });
    await paso('el estudiante ve «Rechazado» con qué pasó y qué hacer', async () => {
      await nav.sembrarSesion(estValentina);
      await nav.ir(`${WEB}/practicas/${VALENTINA.practica}`);
      await nav.esperar(`document.querySelector('[data-rut-estado]')?.innerText === 'Rechazado'`, 30000, 'estado «Rechazado»');
      const t = await nav.evaluar(textoDe('[data-rut-mensaje]'));
      afirmar(/rechazado por el equipo de prácticas/.test(t) && /Comunícate con coordinación/.test(t), `mensaje: ${t}`);
    });

    // ── 6 · Valentina v3: lectura dudosa «leída por OCR», reserva concurrente y liberar (administración) ──────
    console.log('\nAdministración: lectura por OCR, reserva concurrente y liberar (Valentina, versión 3)');
    await cargarRutPorApi(estValentina, VALENTINA.practica, 'rut_natural', manifiesto.archivos['natural-dv-malo']);
    const lista3 = await esperarBandeja(admin.accessToken, (l) => l.items.some((i) => i.estudiante.nombre === VALENTINA.nombre && i.version === 3), 90000, 'la versión 3 de Valentina');
    const caso3 = casoDe(lista3, VALENTINA);
    afirmar(caso3.lecturaDudosa === true, `la versión 3 debía leerse como dudosa: ${JSON.stringify(caso3)}`);
    // Una lectura OCR se simula marcando el método en la base desechable (la lectura por OCR real no es estable sobre un PDF sintético).
    sql(`UPDATE validaciones_documento_empresarial SET metodo_lectura = 'ocr' WHERE id = '${caso3.validacionId}'`);
    await paso('reserva concurrente: dos funcionarios toman a la vez; uno gana y el otro recibe 409', async () => {
      const [a, b] = await Promise.all([
        api(`/mesa-rut/${caso3.validacionId}/tomar`, { token: admin.accessToken, metodo: 'POST' }),
        api(`/mesa-rut/${caso3.validacionId}/tomar`, { token: tutor.accessToken, metodo: 'POST' }),
      ]);
      afirmar([a.estado, b.estado].sort().join() === '200,409', `estados: ${a.estado}, ${b.estado}`);
      // Se libera (supervisión) y el docente la toma, para que la prueba de pantalla sea determinista.
      afirmar((await api(`/mesa-rut/${caso3.validacionId}/liberar`, { token: admin.accessToken, metodo: 'POST' })).estado === 200, 'la administración debe poder liberar');
      afirmar((await api(`/mesa-rut/${caso3.validacionId}/tomar`, { token: tutor.accessToken, metodo: 'POST' })).estado === 200, 'el docente debe poder tomarlo');
    });
    await abrirMesa(nav, admin);
    await paso('administración ve el caso tomado por otra persona y lo libera con confirmación (queda en la auditoría)', async () => {
      await abrirCaso(nav, VALENTINA);
      const cab = await nav.evaluar(textoDe('sipra-rut-detalle header'));
      afirmar(/Tomado por/.test(cab) && !/Tomado por usted/.test(cab), `cabecera: ${cab}`);
      await nav.clic('sipra-rut-detalle button', 'Liberar la reserva de otra persona');
      await nav.esperar(`!!document.querySelector('[data-aviso=liberar]')`, 5000, 'confirmación');
      afirmar(/Esa persona perderá el caso/.test(await nav.evaluar(textoDe('[data-aviso=liberar]'))), 'falta el aviso de impacto');
      await nav.clic('[data-aviso=liberar] button', 'Sí, liberar la reserva');
      await nav.esperar(`/Reserva liberada/.test(document.body.innerText) && /Disponible/.test(document.querySelector('sipra-rut-detalle header').innerText)`, 15000, 'reserva liberada');
      const aud = sql(`SELECT count(*) FROM auditoria WHERE accion = 'rut_liberado' AND entidad_id = '${caso3.validacionId}'`);
      afirmar(Number(aud) >= 2, `la liberación debe auditarse (hay ${aud})`);
    });
    await paso('lectura dudosa: «Leído por OCR · revisar contra el documento»; los críticos quedan «Información insuficiente» (nunca «No coincide»)', async () => {
      await tomarCaso(nav);
      afirmar(await nav.evaluar(textoDe('[data-lectura]')) === 'Leído por OCR · revisar contra el documento', `método: ${await nav.evaluar(textoDe('[data-lectura]'))}`);
      const tabla = await nav.evaluar(textoDe('table[data-tabla=criticos]'));
      afirmar(/Información insuficiente/.test(tabla) && !/No coincide/.test(tabla), `críticos: ${tabla}`);
      afirmar(/Leído por OCR · revisar contra el documento/.test(tabla), 'cada crítico debe llevar el aviso de revisión');
      afirmar(!/%/.test(await nav.evaluar(textoDe('sipra-rut-detalle .col-rev'))), 'no se muestra la confianza como porcentaje');
      await captura(nav, 'caso-ocr');
    });
    await paso('aprobar con lectura dudosa exige 40: contador 0 / 40, 39 no alcanza, 40 habilita; la aprobación queda registrada', async () => {
      await nav.clic('.barra-decision button', 'Aprobar');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      afirmar(/0 \/ 40/.test(await nav.evaluar(textoDe('dialog[open]'))), 'falta el contador 0 / 40');
      await nav.escribir('#rut-just', 'x'.repeat(39));
      afirmar(await nav.evaluar(`${BOTON('dialog[open]', 'Aprobar RUT')}.disabled`) && /39 \/ 40/.test(await nav.evaluar(textoDe('dialog[open]'))), '39 caracteres no alcanzan');
      await nav.escribir('#rut-just', 'Verificado contra el documento original: coincide con el estudiante.');
      await nav.esperar(`!${BOTON('dialog[open]', 'Aprobar RUT')}.disabled`, 5000, 'botón habilitado');
      await nav.clic('dialog[open] button', 'Aprobar RUT');
      await nav.esperar(`/RUT aprobado\\./.test(document.body.innerText) && /Decisión: Aprobado/.test(document.body.innerText)`, 20000, 'aprobación registrada');
    });
    await paso('datos de SIPRA cambian DESPUÉS de la decisión: la decisión no se altera y se avisa «Los datos de SIPRA cambiaron después de esta validación.»', async () => {
      sql(`UPDATE usuarios SET nombre = 'Valentina Ochoa Ruiz Cambiada' WHERE correo = '${VALENTINA.correo}'`);
      await nav.clic('sipra-rut-detalle button', 'Actualizar');
      await nav.esperar(`!!document.querySelector('[data-aviso=datos-sipra]')`, 15000, 'aviso de datos de SIPRA');
      const aviso = await nav.evaluar(textoDe('[data-aviso=datos-sipra]'));
      afirmar(aviso.includes('Los datos de SIPRA cambiaron después de esta validación.') && /no se modifica/.test(aviso), `aviso: ${aviso}`);
      afirmar(/Decisión: Aprobado/.test(await nav.evaluar(textoDe('[data-decision]'))), 'la decisión histórica no debe cambiar');
      afirmar(await nav.evaluar(`document.querySelectorAll('.barra-decision button').length === 0`), 'no se vuelve a decidir');
      await nav.clic('[data-aviso=datos-sipra] button', 'Ver historial');
      await nav.esperar(`document.querySelector('#rt-historial').getAttribute('aria-selected') === 'true'`, 5000, 'pestaña historial');
      const h = await nav.evaluar(textoDe('#rp-historial'));
      afirmar(/Decisión de una persona/.test(h), `historial: ${h}`);
      const ev = sql(`SELECT count(*) FROM evidencias_validacion_doc_empresarial WHERE validacion_id = '${caso3.validacionId}' AND tipo = 'cambio_datos_sipra'`);
      afirmar(Number(ev) === 1, `debe haber UNA constancia del cambio (hay ${ev})`);
      await captura(nav, 'caso-datos-sipra-cambiaron');
      sql(`UPDATE usuarios SET nombre = 'Valentina Ochoa Ruiz' WHERE correo = '${VALENTINA.correo}'`);
    });

    // ── 7 · Docente: Laura — discrepancia, devolver, reenvío y aprobar ──────
    console.log('\nDocente: Laura — discrepancia, devolución, reenvío y aprobación');
    await abrirMesa(nav, tutor);
    await paso('discrepancia crítica: «No coincide · CRÍTICO» en el documento (el nombre coincide); informativos aparte', async () => {
      await abrirCaso(nav, LAURA);
      await tomarCaso(nav);
      const fila = await nav.evaluar(`[...document.querySelectorAll('table[data-tabla=criticos] tbody tr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`);
      afirmar(fila.length === 2 && /Documento de identidad.*No coincide.*CRÍTICO/.test(fila[0]) && /Nombre.*Coincide/.test(fila[1]), `críticos: ${fila.join(' | ')}`);
      afirmar(/^PERSONA NATURAL|Persona natural/i.test(await nav.evaluar(textoDe('.lectura'))) || /Persona: Persona natural/.test(await nav.evaluar(textoDe('.lectura'))), 'debe decir persona natural');
      afirmar(/Texto digital/.test(await nav.evaluar(textoDe('[data-lectura]'))), 'debe indicar el método (texto digital)');
      const inf = await nav.evaluar(`[...document.querySelectorAll('table[data-tabla=informativos] th[scope=row]')].map((e) => e.innerText.trim())`);
      afirmar(inf.join('|') === 'Actividad económica (CIIU)|Municipio (DIVIPOLA)|Fecha de generación', `informativos: ${inf.join('|')}`);
      afirmar(/REVISIÓN NECESARIA/i.test(await nav.evaluar(textoDe('[data-resultado]'))), 'falta el resultado principal');
      await captura(nav, 'caso-laura-discrepancia');
    });
    await paso('aprobar contra una discrepancia crítica exige 40 (se puede cancelar sin efecto); devolver con motivo del catálogo', async () => {
      await nav.clic('.barra-decision button', 'Aprobar');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      afirmar(await nav.evaluar(`${BOTON('dialog[open]', 'Aprobar RUT')}.disabled`), 'sin justificación no se aprueba');
      await nav.clic('dialog[open] button', 'Cancelar');
      await nav.esperar(`!document.querySelector('dialog[open]')`, 5000, 'cierre');
      await nav.clic('.barra-decision button', 'Devolver');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      const motivos = await nav.evaluar(`[...document.querySelectorAll('#rut-motivo option')].map((o) => o.value)`);
      afirmar(motivos.includes('documento_no_coincide') && !motivos.includes('nit_no_coincide'), `motivos de persona natural: ${motivos.join(',')}`);
      await elegir(nav, '#rut-motivo', 'documento_no_coincide');
      await nav.esperar(`!${BOTON('dialog[open]', 'Devolver RUT')}.disabled`, 5000, 'botón habilitado');
      await nav.clic('dialog[open] button', 'Devolver RUT');
      await nav.esperar(`/RUT devuelto al estudiante\\./.test(document.body.innerText) && /Decisión: Devuelto/.test(document.body.innerText)`, 20000, 'devolución registrada');
    });
    await paso('ESTUDIANTE: ve el motivo y «Subir nueva versión» lleva a la carga; la versión 2 queda «En revisión» y la 1 en segundo plano', async () => {
      await nav.sembrarSesion(estLaura);
      await nav.vista(1440, 900);
      await nav.ir(`${WEB}/practicas/${LAURA.practica}`);
      await nav.esperar(`document.querySelector('[data-rut-estado]')?.innerText === 'Necesita corrección'`, 30000, 'estado «Necesita corrección»');
      const t = await nav.evaluar(textoDe('[data-rut-mensaje]'));
      const m = (await api('/mesa-rut/motivos-devolucion', { token: tutor.accessToken })).json.find((x) => x.codigo === 'documento_no_coincide');
      afirmar(t.includes(m.mensajeEstudiante.que) && t.includes(m.mensajeEstudiante.hacer), `mensaje: ${t}`);
      await nav.clic('[data-rut-mensaje] button', 'Subir nueva versión');
      await nav.esperar(`document.querySelector('#tipo-doc')?.value === 'rut_natural'`, 5000, 'tipo elegido');
      await nav.archivo('input[type=file]', manifiesto.archivos['1-natural-ok']);
      await nav.esperar(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Cargar y validar') && !b.disabled)`, 15000, 'botón Cargar y validar');
      await nav.clic('button', 'Cargar y validar');
      await nav.esperar(`document.querySelector('[data-rut-estado]')?.innerText === 'En revisión'`, 90000, 'versión 2 en revisión');
      const e = await nav.evaluar(textoDe('sipra-rut-estudiante'));
      afirmar(/versión 2/i.test(e) && /Versión 1/.test(e), `debe indicar la versión 2 y la 1 en segundo plano: ${e}`);
    });
    await esperarBandeja(tutor.accessToken, (l) => l.items.some((i) => i.estudiante.nombre === LAURA.nombre && i.version === 2), 90000, 'la versión 2 de Laura');
    await abrirMesa(nav, tutor);
    await paso('la versión 2 es un caso nuevo e independiente: reenvío en la cola, historial de versiones con el motivo de la anterior', async () => {
      afirmar(await nav.evaluar(`[...document.querySelectorAll('.caso')].filter((c) => c.innerText.includes(${JSON.stringify(LAURA.nombre)})).length === 1`), 'solo la versión vigente en la cola');
      await abrirCaso(nav, LAURA);
      const v = await nav.evaluar(textoDe('#rp-versiones'));
      afirmar(/v2.*Vigente/s.test(v) && /v1.*Anterior.*Devuelto.*Motivo: .*documento/s.test(v), `versiones: ${v}`);
      afirmar(/Sin diferencias/.test(await nav.evaluar(textoDe('.lista'))) || /CONSISTENTE/i.test(await nav.evaluar(textoDe('[data-resultado]'))), 'la versión 2 debe verse consistente');
    });
    await paso('RUT consistente: se aprueba SIN justificación larga y el estudiante lo ve «Aprobado»', async () => {
      await tomarCaso(nav);
      await nav.clic('.barra-decision button', 'Aprobar');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      afirmar(/El RUT queda aprobado/.test(await nav.evaluar(textoDe('dialog[open]'))) && !(await nav.evaluar(`!!document.querySelector('dialog[open] textarea')`)), 'no debe pedir justificación');
      await nav.clic('dialog[open] button', 'Aprobar RUT');
      await nav.esperar(`/RUT aprobado\\./.test(document.body.innerText) && /Decisión: Aprobado/.test(document.body.innerText)`, 20000, 'aprobación registrada');
      await nav.sembrarSesion(estLaura);
      await nav.ir(`${WEB}/practicas/${LAURA.practica}`);
      await nav.esperar(`document.querySelector('[data-rut-estado]')?.innerText === 'Aprobado'`, 30000, 'estado «Aprobado»');
      afirmar(!(await nav.evaluar(`[...document.querySelectorAll('[data-rut-mensaje] button')].some((b) => /nueva versión/i.test(b.textContent))`)), 'un RUT aprobado no se reenvía');
      await captura(nav, 'estudiante-aprobado');
    });

    // ── 8 · Coordinación: Andrés — persona jurídica, discrepancia + 40, supervisión ─────
    console.log('\nCoordinación: persona jurídica (Andrés) y supervisión');
    await abrirMesa(nav, coord);
    await paso('la coordinación (ingenierías) solo ve su escuela; «Tomar siguiente» elige el caso y abre el RUT', async () => {
      afirmar(await nav.evaluar(`document.querySelectorAll('.caso').length === 1 && document.querySelector('.caso').innerText.includes(${JSON.stringify(ANDRES.nombre)})`), 'solo el caso de su escuela');
      await nav.clic('button', 'Tomar siguiente');
      await nav.esperar(`document.querySelector('sipra-rut-detalle h2')?.textContent.includes(${JSON.stringify(ANDRES.nombre)}) && !!document.querySelector('sipra-rut-visor iframe')`, 20000, 'caso de Andrés abierto');
      afirmar(/Tomado por usted/.test(await nav.evaluar(textoPagina)), 'debe quedar reservado a su nombre');
    });
    await paso('persona jurídica: críticos NIT, DV y razón social; la razón social «No coincide · CRÍTICO»; informativos aparte', async () => {
      const filas = await nav.evaluar(`[...document.querySelectorAll('table[data-tabla=criticos] tbody tr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`);
      afirmar(filas.length === 3 && /^NIT.*Coincide/.test(filas[0]) && /^Dígito de verificación.*Coincide/.test(filas[1]) && /^Razón social.*No coincide.*CRÍTICO/.test(filas[2]), `críticos: ${filas.join(' | ')}`);
      afirmar(/Persona: Persona jurídica/.test(await nav.evaluar(textoDe('.lectura'))), 'debe decir persona jurídica');
      afirmar(await nav.evaluar(`document.querySelectorAll('table[data-tabla=informativos] tbody tr').length === 3`), 'faltan los 3 informativos');
      await captura(nav, 'caso-juridica');
    });
    await paso('aprobar con discrepancia crítica: 0 / 40, 39 no alcanza, 40 habilita; queda aprobado por la coordinación', async () => {
      await nav.clic('.barra-decision button', 'Aprobar');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      afirmar(/0 \/ 40/.test(await nav.evaluar(textoDe('dialog[open]'))), 'falta el contador');
      await nav.escribir('#rut-just', 'y'.repeat(39));
      afirmar(await nav.evaluar(`${BOTON('dialog[open]', 'Aprobar RUT')}.disabled`), '39 no alcanzan');
      await nav.escribir('#rut-just', 'La razón social cambió por una reforma estatutaria vigente.');
      await nav.esperar(`!${BOTON('dialog[open]', 'Aprobar RUT')}.disabled`, 5000, 'habilitado');
      await nav.clic('dialog[open] button', 'Aprobar RUT');
      await nav.esperar(`/RUT aprobado\\./.test(document.body.innerText) && /Decisión: Aprobado/.test(document.body.innerText)`, 20000, 'aprobación');
      const ev = sql(`SELECT datos->>'justificacion' FROM evidencias_validacion_doc_empresarial WHERE validacion_id = '${idAndres}' AND tipo = 'decision_humana'`);
      afirmar(/reforma estatutaria/.test(ev), 'la justificación debe quedar en la evidencia inmutable');
    });
    await paso('supervisión: libres, tomados, por vencer, vencidos, discrepancias, OCR, persona distinta, documento incorrecto y carga por funcionario', async () => {
      await nav.clic('[data-supervision] button', 'Actualizar');
      // La supervisión se recarga: se espera a que refleje la decisión recién tomada (carga por funcionario).
      await nav.esperar(`/Patricia Elena Cárdenas Nieto/.test(document.querySelector('[data-supervision]')?.innerText ?? '')`, 15000, 'carga por funcionario');
      const t = await nav.evaluar(textoDe('[data-supervision]'));
      for (const e of ['Libres', 'Tomados', 'Por vencer', 'Vencidos', 'Con discrepancias', 'Leídos por OCR', 'Persona distinta', 'Documento incorrecto', 'Carga por funcionario', 'Por estado']) afirmar(t.includes(e), `falta «${e}» en la supervisión`);
      afirmar(/Patricia Elena Cárdenas Nieto/.test(t), 'debe verse la carga por funcionario');
      afirmar(/Aprobado: 1/.test(t.replace(/\s+/g, ' ')), `por estado: ${t.slice(-200)}`);
      await captura(nav, 'supervision');
    });
    await paso('la supervisión es solo de coordinación/administración: el docente no la ve', async () => {
      await abrirMesa(nav, tutor);
      afirmar(await nav.evaluar(`!document.querySelector('[data-supervision]')`), 'el docente no debe ver la supervisión');
    });

    // ── 9 · Permisos ────────────────────────────────────────────────────────
    console.log('\nPermisos');
    await paso('el docente no alcanza (visual ni por API) un caso de otra escuela: 404', async () => {
      const r = await api(`/mesa-rut/${idAndres}`, { token: tutor.accessToken });
      afirmar(r.estado === 404, `API: ${r.estado}`);
      afirmar((await api(`/mesa-rut/${idAndres}/tomar`, { token: tutor.accessToken, metodo: 'POST' })).estado === 404, 'tomar debe dar 404');
      afirmar((await api(`/mesa-rut/${idAndres}/archivo`, { token: tutor.accessToken })).estado === 404, 'el archivo debe dar 404');
    });
    await paso('auxiliar, estudiante y extensión NO operan la Mesa de RUT (403 por API); el auxiliar no ve la entrada del menú ni entra a la pantalla', async () => {
      for (const [rol, tok] of [['auxiliar', aux], ['estudiante', estLaura]]) {
        afirmar((await api('/mesa-rut', { token: tok.accessToken })).estado === 403, `${rol}: la bandeja debe dar 403`);
        afirmar((await api(`/mesa-rut/${idAndres}/decision`, { token: tok.accessToken, metodo: 'POST', cuerpo: { decision: 'aprobar' } })).estado === 403, `${rol}: decidir debe dar 403`);
      }
      const ext = await ingresar('extension');
      afirmar((await api('/mesa-rut', { token: ext.accessToken })).estado === 403, 'extensión: 403');
      await nav.sembrarSesion(aux);
      await nav.ir(`${WEB}/inicio`);
      await nav.esperar(`!!document.querySelector('nav, [role=navigation]')`, 20000, 'el menú');
      afirmar(!(await nav.evaluar(`[...document.querySelectorAll('nav a, [role=navigation] a')].some((a) => a.getAttribute('href') === '/mesa-rut')`)), 'el auxiliar no debe ver la entrada RUT');
      await nav.ir(`${WEB}/mesa-rut`);
      await dormir(1500);
      afirmar(!(await nav.evaluar(`document.body.innerText.includes('Mesa de RUT')`)) || !(await nav.evaluar(`location.pathname.includes('mesa-rut')`)), 'el auxiliar no debe entrar a la pantalla');
    });
    await paso('el docente, coordinación y administración sí ven la entrada «RUT» del menú', async () => {
      for (const s of [tutor, coord, admin]) {
        await nav.sembrarSesion(s);
        await nav.ir(`${WEB}/inicio`);
        await nav.esperar(`!!document.querySelector('nav, [role=navigation]')`, 20000, 'el menú');
        afirmar(await nav.evaluar(`[...document.querySelectorAll('nav a, [role=navigation] a')].some((a) => a.getAttribute('href') === '/mesa-rut' && a.innerText.includes('RUT'))`), 'falta la entrada «RUT»');
      }
    });

    // ── 10 · Accesibilidad básica y tema ────────────────────────────────────
    console.log('\nAccesibilidad');
    for (const tema of ['oscuro', 'claro']) {
      await paso(`tema ${tema}: controles con etiqueta, tablas con encabezados de columna y fila, contraste AA del resultado principal`, async () => {
        await abrirMesa(nav, admin, { tema });
        // Todo está decidido: administración consulta por estado (filtro exclusivo de supervisión) y abre un caso decidido.
        await nav.clic('button', 'Más filtros');
        await elegir(nav, '#f-estado', 'revision,aprobado_manual,devuelto,rechazado');
        await nav.esperar(`document.querySelectorAll('.caso').length >= 3`, 15000, 'todos los estados');
        await nav.clic('.caso', LAURA.nombre);
        await nav.esperar(`!!document.querySelector('sipra-rut-detalle h2')`, 20000, 'caso');
        await nav.esperar(`!!document.querySelector('[data-resultado]')`, 20000, 'resultado');
        afirmar((await nav.evaluar(SIN_ETIQUETA)).length === 0, `controles sin etiqueta: ${await nav.evaluar(`JSON.stringify(${SIN_ETIQUETA})`)}`);
        afirmar(await nav.evaluar(`[...document.querySelectorAll('table.cmp')].every((t) => t.querySelector('caption') && t.querySelectorAll('thead th[scope=col]').length === 4 && t.querySelectorAll('tbody th[scope=row]').length > 0)`), 'las tablas deben tener caption, encabezados de columna y de fila');
        afirmar(await nav.evaluar(`document.querySelectorAll('.barra-decision').length === 1 && [...document.querySelectorAll('.barra-decision button')].every((b) => b.textContent.trim().length > 0)`), 'botones con nombre claro');
        const c = await nav.evaluar(contrasteDe('[data-resultado] .frase'));
        afirmar(c !== null && c >= 4.5, `contraste insuficiente (${c}) en ${tema}`);
        afirmar(await nav.evaluar(`[...document.querySelectorAll('.res .etiqueta')].every((e) => e.innerText.trim().length > 2)`), 'los resultados no dependen solo del color');
      });
    }
    await paso('sin errores de consola/página en todo el recorrido', async () => {
      afirmar(nav.erroresPagina.filter((e) => !/favicon|net::ERR_ABORTED|ResizeObserver|Failed to load resource: the server responded with a status of (4\d\d)/.test(e)).length === 0, `errores: ${nav.erroresPagina.join(' | ').slice(0, 300)}`);
    });
  } finally {
    await nav.cerrar();
  }

  const fallos = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - fallos.length}/${resultados.length} pasos correctos`);
  if (fallos.length) { console.log('FALLOS:'); for (const f of fallos) console.log(` - ${f.nombre}\n     ${f.error}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
