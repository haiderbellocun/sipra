// E2E local de la Mesa de Actas de Iniciación en un navegador real (Chrome instalado, por CDP).
//
// Requisitos (todo local y desechable):
//   · API en dev (AUTH_MODO=abierto) contra una base DESECHABLE con las semillas sintéticas, preparada con
//     `apps/api/herramientas/preparar-e2e-actas.ts` (deja las prácticas coherentes y genera los PDF sintéticos).
//   · Frontend servido (ng serve) con proxy al API.
//   · Variables: E2E_API (por defecto http://localhost:3000/api/v1), E2E_WEB (http://localhost:4201),
//     E2E_ACTAS (carpeta con manifiesto.json y los PDF sintéticos), E2E_CAPTURAS (carpeta opcional para capturas) y, opcional,
//     E2E_PSQL + E2E_DB (psql y base desechable) para el caso de la inconsistencia heredada, que solo se puede crear en la base.
// Uso: node pruebas/e2e/mesa-actas.e2e.mjs
//
// Recorrido: estudiante carga el Acta → auxiliar toma, revisa y DEVUELVE → estudiante ve el motivo y REENVÍA → auxiliar toma la
// versión nueva y APRUEBA; coordinación corrige el responsable de la ARL (recálculo), libera una reserva y ve el aviso posterior
// a la decisión. Además: rechazo, supervisión, inconsistencia operativa, responsive, claro/oscuro y accesibilidad.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Navegador } from './cdp.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3000/api/v1';
const WEB = process.env.E2E_WEB ?? 'http://localhost:4201';
const ACTAS = process.env.E2E_ACTAS;
const CAPTURAS = process.env.E2E_CAPTURAS;
if (!ACTAS) { console.error('Falta E2E_ACTAS (carpeta con manifiesto.json y los PDF sintéticos).'); process.exit(2); }
const manifiesto = JSON.parse(readFileSync(join(ACTAS, 'manifiesto.json'), 'utf8'));

const resultados = [];
const paso = async (nombre, f) => {
  try { await f(); resultados.push({ nombre, ok: true }); console.log(`  ✔ ${nombre}`); }
  catch (e) { resultados.push({ nombre, ok: false, error: e.message }); console.log(`  ✘ ${nombre}\n      ${e.message}`); }
};
const afirmar = (cond, mensaje) => { if (!cond) throw new Error(mensaje); };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const ESTUDIANTES = [
  { correo: 'laura.ramirez@estudiante.cun.edu.co', practica: manifiesto.practicas[0], nombre: 'Laura Sofía Ramírez Ortiz' },
  { correo: 'andres.mora@estudiante.cun.edu.co', practica: manifiesto.practicas[1], nombre: 'Andrés Felipe Mora Castaño' },
  { correo: 'valentina.ochoa@estudiante.cun.edu.co', practica: manifiesto.practicas[2], nombre: 'Valentina Ochoa Ruiz' },
];
const [LAURA, ANDRES, VALENTINA] = ESTUDIANTES;

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

async function cargarActaPorApi(sesion, practica, archivo) {
  const f = new FormData();
  f.append('tipo', 'acta_inicio');
  f.append('archivo', new Blob([readFileSync(archivo)], { type: 'application/pdf' }), 'acta.pdf');
  const r = await api(`/documentos/practica/${practica}`, { token: sesion.accessToken, metodo: 'POST', formulario: f });
  if (r.estado >= 300) throw new Error(`No se pudo cargar el Acta: ${r.estado} ${JSON.stringify(r.json)}`);
}

async function esperarBandeja(token, condicion, ms = 60000, descripcion = 'la bandeja') {
  const limite = Date.now() + ms;
  let ultima = null;
  while (Date.now() < limite) {
    ultima = (await api('/actas-iniciacion', { token })).json;
    if (ultima && condicion(ultima)) return ultima;
    await dormir(600);
  }
  throw new Error(`Tiempo agotado esperando ${descripcion}`);
}
const casoDe = (lista, estudiante) => lista.items.find((i) => i.estudiante.nombre === estudiante.nombre);

// ── Utilidades de pantalla ──────────────────────────────────────────────────

const sinDesborde = 'document.documentElement.scrollWidth <= window.innerWidth + 1';
const textoPagina = 'document.body.innerText';
const textoDe = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.innerText ?? '')`;
/** Controles visibles sin etiqueta accesible (ni <label>, ni aria-label, ni aria-labelledby). */
const SIN_ETIQUETA = `[...document.querySelectorAll('input, select, textarea')].filter((e) => (e.offsetWidth || e.offsetHeight) && e.type !== 'hidden' && !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).map((e) => e.id || e.name || e.tagName)`;

/**
 * Razón de contraste WCAG del texto de `sel` contra su fondo efectivo. Los colores (incluidos los `color-mix`, que salen como
 * `oklab()`) se convierten a sRGB con un canvas y las transparencias se componen capa por capa, de abajo hacia arriba.
 */
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

async function abrirMesa(nav, sesion, { ancho = 1440, alto = 900, tema = 'oscuro' } = {}) {
  await nav.sembrarSesion(sesion);
  // La lista de casos se fija junto al caso (en escritorio, de fábrica se oculta con un caso abierto): estos pasos usan la lista.
  await nav.enviar('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('sipra.actas.lista','si');localStorage.setItem('sipra.tema',${JSON.stringify(tema)});}catch(e){}` });
  await nav.vista(ancho, alto);
  await nav.ir(`${WEB}/actas`);
  await nav.esperar(`document.querySelector('h1')?.textContent.includes('Mesa de Actas de Iniciación')`, 30000, 'título de la Mesa');
  await nav.esperar(`!document.body.innerText.includes('Cargando los casos')`, 20000, 'fin de la carga');
}

async function abrirCaso(nav, estudiante) {
  await nav.clic('.caso', estudiante.nombre);
  await nav.esperar(`document.querySelector('sipra-actas-detalle h2')?.textContent.includes(${JSON.stringify(estudiante.nombre)})`, 20000, `caso de ${estudiante.nombre}`);
}

const confirmarDialogo = async (nav, texto) => { await nav.clic('dialog[open] button', texto); };
const dialogoAbierto = `!!document.querySelector('dialog[open]')`;

async function main() {
  if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });
  const captura = async (nav, nombre) => { if (CAPTURAS) await nav.captura(join(CAPTURAS, `${nombre}.png`)); };
  const aux = await ingresar('auxiliar');
  const coord = await ingresar('coordinador');
  const admin = await ingresar('administrador');
  const tutor = await ingresar('tutor');
  const estLaura = await ingresar('estudiante', LAURA.correo);
  const estAndres = await ingresar('estudiante', ANDRES.correo);
  const estValentina = await ingresar('estudiante', VALENTINA.correo);

  console.log('\nPreparación (API): Andrés (ARL contraria al registro) y Valentina (un documento que no es el Acta)');
  await cargarActaPorApi(estAndres, ANDRES.practica, manifiesto.archivos['2-arl-cun']);
  await cargarActaPorApi(estValentina, VALENTINA.practica, manifiesto.archivos['otro-documento']);

  const nav = await Navegador.abrir();
  try {
    // ── 1 · Estudiante: carga el Acta (versión 1) ───────────────────────────
    console.log('\nEstudiante: carga su Acta');
    await paso('el estudiante ve «Acta pendiente de cargar» con qué pasó y qué hacer, sin códigos', async () => {
      await nav.sembrarSesion(estLaura);
      await nav.vista(1440, 900);
      await nav.ir(`${WEB}/practicas/${LAURA.practica}`);
      await nav.esperar(`!!document.querySelector('[data-acta-estado]')`, 30000, 'la tarjeta del Acta');
      const t = await nav.evaluar(textoDe('[data-acta-mensaje]'));
      afirmar(await nav.evaluar(textoDe('[data-acta-estado]')) === 'Acta pendiente de cargar', 'falta el estado «Acta pendiente de cargar»');
      afirmar(/¿Qué pasó\?/.test(t) && /¿Qué debo hacer\?/.test(t), 'debe responder qué pasó y qué hacer');
      afirmar(!/sin_cargar|en_cola|con_el_equipo|por_corregir/.test(t), 'no debe mostrar nombres internos');
      await captura(nav, 'estudiante-1-pendiente');
    });
    await paso('carga el Acta (sin firma de la empresa) por el expediente y queda «en revisión»', async () => {
      await nav.evaluar(`(() => { const s = document.querySelector('#tipo-doc'); s.value = 'acta_inicio'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await nav.archivo('input[type=file]', manifiesto.archivos['1-sin-firma-empresa']);
      await nav.esperar(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Cargar y validar') && !b.disabled)`, 15000, 'botón Cargar y validar');
      await nav.clic('button', 'Cargar y validar');
      await nav.esperar(`document.querySelector('[data-acta-estado]')?.innerText === 'Acta en revisión'`, 60000, 'estado «Acta en revisión»');
      const t = await nav.evaluar(textoDe('[data-acta-mensaje]'));
      afirmar(/Tu acta de iniciación está en revisión/.test(t), `mensaje inesperado: ${t}`);
      afirmar(!(await nav.evaluar(`[...document.querySelectorAll('[data-acta-mensaje] button')].some((b) => /nueva versión/i.test(b.textContent))`)), 'no debe ofrecer reenviar mientras está en revisión');
    });
    await esperarBandeja(aux.accessToken, (l) => l.items.length >= 3 && l.items.every((i) => i.estado === 'revision'), 60000, 'los 3 casos en revisión');

    // ── 2 · Responsive: la bandeja ──────────────────────────────────────────
    for (const [ancho, alto, etiqueta] of [[1920, 1080, '1920'], [1440, 900, '1440'], [1366, 768, '1366'], [1024, 768, '1024'], [768, 1024, '768'], [390, 844, 'móvil 390']]) {
      console.log(`\nVista ${etiqueta}`);
      await paso(`${etiqueta}: bandeja con KPIs, filtros esenciales y lista, sin desborde horizontal`, async () => {
        await abrirMesa(nav, aux, { ancho, alto });
        afirmar(await nav.evaluar(`document.querySelectorAll('.kpi').length >= 5`), 'faltan los KPIs');
        afirmar(await nav.evaluar(`!!document.querySelector('#f-buscar') && !!document.querySelector('#f-reserva') && !!document.querySelector('#f-firmas')`), 'faltan la búsqueda y los filtros esenciales');
        afirmar(await nav.evaluar(`document.querySelectorAll('.caso').length === 3`), 'deben verse los 3 casos');
        afirmar(await nav.evaluar(sinDesborde), `desborde horizontal a ${etiqueta}`);
        afirmar((await nav.evaluar(SIN_ETIQUETA)).length === 0, `controles sin etiqueta: ${await nav.evaluar(`JSON.stringify(${SIN_ETIQUETA})`)}`);
        await captura(nav, `bandeja-${ancho}`);
      });
    }

    // ── 3 · Bandeja: contenido, filtros, KPIs ───────────────────────────────
    console.log('\nBandeja');
    await abrirMesa(nav, aux);
    await paso('cada caso se escanea rápido: estudiante, empresa, problema principal, prioridad y estado (sin pilas de insignias)', async () => {
      const t = await nav.evaluar(textoDe('.lista'));
      afirmar(t.includes(LAURA.nombre) && t.includes('Soluciones Logísticas Andinas'), 'falta el estudiante o la empresa');
      afirmar(/Falta la firma de la empresa/.test(t), 'falta el problema de Laura');
      afirmar(/Parece ser otro documento/.test(t), 'falta el problema de Valentina');
      afirmar(/Diferencias críticas con la práctica/.test(t), 'falta el problema de Andrés');
      afirmar(/Prioridad \d+ · .*Disponible/.test(t), 'falta prioridad · estado');
      afirmar(await nav.evaluar(`document.querySelectorAll('.lista .etiqueta').length === 0`), 'la bandeja no debe llenarse de insignias');
      afirmar(!/_|discrepancia_critica|revision\b/.test(t.replace(/Sin diferencias/g, '')), `la bandeja muestra códigos internos: ${t.slice(0, 200)}`);
    });
    await paso('los KPIs son operativos y filtran: «Firmas pendientes» deja solo a Laura; pulsar de nuevo quita el filtro', async () => {
      const k = await nav.evaluar(`[...document.querySelectorAll('.kpi')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`);
      afirmar(k.some((x) => /^3 Pendientes$/.test(x)) && k.some((x) => /Firmas pendientes/.test(x)) && k.some((x) => /Con discrepancias/.test(x)) && k.some((x) => /Documento incorrecto/.test(x)), `KPIs: ${k.join(' | ')}`);
      await nav.clic('.kpi', 'Firmas pendientes');
      await nav.esperar(`document.querySelectorAll('.caso').length === 1 && document.querySelector('.caso').innerText.includes(${JSON.stringify(LAURA.nombre)})`, 10000, 'filtro por firmas');
      afirmar(await nav.evaluar(`document.querySelector('.kpi[aria-pressed=true]')?.innerText.includes('Firmas pendientes')`), 'el KPI activo debe marcarse (aria-pressed)');
      await nav.clic('.kpi', 'Firmas pendientes');
      await nav.esperar(`document.querySelectorAll('.caso').length === 3`, 10000, 'sin filtro');
    });
    await paso('la búsqueda por estudiante y «Más filtros» (con la cantidad de filtros activos) funcionan', async () => {
      await nav.escribir('#f-buscar', 'valentina');
      await nav.esperar(`document.querySelectorAll('.caso').length === 1`, 10000, 'búsqueda');
      await nav.escribir('#f-buscar', '');
      await nav.esperar(`document.querySelectorAll('.caso').length === 3`, 10000, 'búsqueda vacía');
      afirmar(await nav.evaluar(`document.querySelector('#mas-filtros').hidden`), 'los filtros secundarios deben empezar plegados');
      await nav.clic('button', 'Más filtros');
      afirmar(await nav.evaluar(`!document.querySelector('#mas-filtros').hidden && !!document.querySelector('#f-rem') && !!document.querySelector('#f-arl') && !!document.querySelector('#f-ant') && !!document.querySelector('#f-prio')`), 'faltan los filtros de más');
      afirmar(!(await nav.evaluar(`!!document.querySelector('#f-estado')`)), 'el filtro por estado es solo de supervisión');
      await nav.evaluar(`(() => { const s = document.querySelector('#f-arl'); s.value = 'cun'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await nav.esperar(`document.querySelectorAll('.caso').length === 1 && document.querySelector('.caso').innerText.includes(${JSON.stringify(ANDRES.nombre)}) && /\\(1\\)/.test(document.querySelector('[aria-controls=mas-filtros]').innerText)`, 10000, 'filtro por ARL del Acta (CUN) y su contador');
      await nav.clic('button', 'Limpiar filtros');
      await nav.esperar(`document.querySelectorAll('.caso').length === 3`, 10000, 'limpiar filtros');
    });

    // ── 4 · Auxiliar: «Tomar siguiente» (Valentina: documento incorrecto) y rechazo ─────
    console.log('\nAuxiliar: documento incorrecto y rechazo');
    await paso('«Tomar siguiente» elige el de mayor prioridad (documento incorrecto), lo reserva y abre el Acta', async () => {
      await nav.clic('button', 'Tomar siguiente');
      await nav.esperar(`document.querySelector('sipra-actas-detalle h2')?.textContent.includes(${JSON.stringify(VALENTINA.nombre)})`, 20000, 'caso de Valentina');
      const t = await nav.evaluar(textoPagina);
      afirmar(/Tomado por usted/.test(t) && /le quedan/.test(t), 'debe verse la reserva propia con el tiempo restante');
      afirmar(/DOCUMENTO INCORRECTO/i.test(await nav.evaluar(textoDe('[data-resultado]'))) && /El archivo cargado no parece ser un Acta de Iniciación\./.test(t), 'falta el resultado «Documento incorrecto»');
      await nav.esperar(`!!document.querySelector('sipra-actas-visor iframe')`, 20000, 'el visor con el Acta');
      afirmar(await nav.evaluar(`document.querySelector('sipra-actas-visor iframe').src.startsWith('blob:')`), 'el visor debe usar un blob local, no una URL del servidor');
      afirmar(!nav.solicitudes.some((s) => /\/archivo/.test(s.url) && /token|access|jwt/i.test(s.url)), 'no debe haber credenciales en la URL del archivo');
      afirmar(nav.solicitudes.filter((s) => /\/actas-iniciacion\/.+\/archivo/.test(s.url)).every((s) => s.cabeceras.Authorization || s.cabeceras.authorization), 'el archivo debe pedirse con la cabecera Authorization');
      await captura(nav, 'caso-documento-incorrecto');
    });
    await paso('rechazar exige justificación y confirmación explícita; el diálogo habla de impacto sin ser alarmista', async () => {
      await nav.clic('.barra-decision button', 'Rechazar');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      const d = await nav.evaluar(textoDe('dialog[open]'));
      afirmar(/Rechazar es una decisión de mayor impacto/.test(d) && /devolverla/.test(d), 'falta el aviso de impacto');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.includes('Rechazar Acta')).disabled`), 'el botón debe estar deshabilitado sin justificación');
      await nav.escribir('#acta-just', 'Es una cédula.');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.includes('Rechazar Acta')).disabled`), 'sin confirmar, sigue deshabilitado');
      await nav.clic('dialog[open] input[type=checkbox]');
      afirmar(await nav.evaluar(`![...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.includes('Rechazar Acta')).disabled`), 'con justificación y confirmación debe habilitarse');
      await captura(nav, 'dialogo-rechazar');
      await confirmarDialogo(nav, 'Rechazar Acta');
      await nav.esperar(`/Acta rechazada\\./.test(document.body.innerText) && /Decisión: Rechazada/.test(document.body.innerText)`, 20000, 'rechazo registrado');
      afirmar(await nav.evaluar(`![...document.querySelectorAll('.barra-decision button')].length`), 'tras decidir no se ofrecen más decisiones');
    });
    await paso('el estudiante ve «Acta rechazada» con qué pasó y qué hacer', async () => {
      await nav.sembrarSesion(estValentina);
      await nav.ir(`${WEB}/practicas/${VALENTINA.practica}`);
      await nav.esperar(`document.querySelector('[data-acta-estado]')?.innerText === 'Acta rechazada'`, 30000, 'estado «Acta rechazada»');
      const t = await nav.evaluar(textoDe('[data-acta-mensaje]'));
      afirmar(/rechazada por el equipo de prácticas/.test(t) && /Comunícate con coordinación/.test(t) && /Subir una nueva Acta/.test(t), `mensaje: ${t}`);
    });

    // ── 5 · Auxiliar: Laura — devolver con motivo ───────────────────────────
    console.log('\nAuxiliar: revisar y devolver el Acta de Laura');
    await abrirMesa(nav, aux);
    await paso('abrir un caso libre no lo reserva: se ve el resultado y hay que tomarlo para abrir el Acta y decidir', async () => {
      await abrirCaso(nav, LAURA);
      afirmar(/Disponible/.test(await nav.evaluar(textoDe('sipra-actas-detalle header'))), 'debe verse «Disponible»');
      afirmar(/Tome el caso para abrir el Acta/.test(await nav.evaluar(textoDe('sipra-actas-visor'))), 'el visor debe pedir tomar el caso');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('.barra-decision button')].every((b) => b.disabled)`), 'las decisiones deben estar deshabilitadas sin la reserva');
      afirmar(/Toma el caso para poder decidir/.test(await nav.evaluar(textoDe('.barra-decision'))), 'debe decir por qué no se puede decidir');
    });
    await paso('al tomar el caso: reservado a su nombre y el Acta se abre sola', async () => {
      await nav.clic('sipra-actas-detalle button', 'Tomar el caso');
      await nav.esperar(`/Tomado por usted/.test(document.body.innerText) && !!document.querySelector('sipra-actas-visor iframe')`, 20000, 'reserva y visor');
      afirmar(await nav.evaluar(`![...document.querySelectorAll('.barra-decision button')].some((b) => b.disabled)`), 'las decisiones deben habilitarse con el caso tomado');
    });
    await paso('resumen superior: remuneración y responsable de la ARL (SIPRA / Acta) y las dos firmas, con su ayuda', async () => {
      const claves = await nav.evaluar(`[...document.querySelectorAll('.clave')].map((e) => ({ k: e.dataset.clave, t: e.innerText.replace(/\\s+/g, ' ').trim() }))`);
      const de = (k) => claves.find((c) => c.k === k)?.t ?? '';
      afirmar(/REMUNERACIÓN.*SIPRA.*No remunerada.*Acta.*No remunerada.*Coincide/i.test(de('remuneracion')), `remuneración: ${de('remuneracion')}`);
      afirmar(/RESPONSABLE ARL.*SIPRA.*Empresa.*Acta.*Empresa.*Coincide/i.test(de('arl')), `ARL: ${de('arl')}`);
      afirmar(/FIRMA EMPRESA.*No detectada/i.test(de('firma-empresa')), `firma empresa: ${de('firma-empresa')}`);
      afirmar(/FIRMA PRACTICANTE.*Detectada/i.test(de('firma-practicante')) && !/No detectada/.test(de('firma-practicante')), `firma practicante: ${de('firma-practicante')}`);
      afirmar(/SIPRA detecta presencia probable de firma; no valida su autenticidad\./.test(await nav.evaluar(textoPagina)), 'falta la ayuda sobre las firmas');
      afirmar(/REVISIÓN NECESARIA|FALTA UNA FIRMA/i.test(await nav.evaluar(textoDe('[data-resultado]'))), 'falta el resultado principal');
      await captura(nav, 'caso-laura-resumen');
    });
    await paso('comparación: Campo | SIPRA | Acta | Resultado, en el orden pedido, con la sugerencia de la modalidad aparte', async () => {
      const cab = await nav.evaluar(`[...document.querySelectorAll('table.cmp thead th')].map((e) => e.innerText.trim())`);
      afirmar(/^CAMPO\|SIPRA\|ACTA\|RESULTADO$/i.test(cab.join('|')), `encabezados: ${cab.join('|')}`);
      const campos = await nav.evaluar(`[...document.querySelectorAll('table.cmp tbody th[scope=row]')].map((e) => e.innerText.trim())`);
      const orden = ['Estudiante', 'Documento', 'Empresa', 'NIT', 'Fecha', 'Fecha', 'Modalidad', 'Remuneración', 'Responsable', 'Programa', 'Jefe', 'Funciones'];
      afirmar(campos.length === 12 && orden.every((o, i) => campos[i].includes(o)), `orden de los campos: ${campos.join(' | ')}`);
      afirmar(await nav.evaluar(`document.querySelectorAll('table.cmp tbody tr').length === 12 && !document.querySelector('sipra-actas-detalle .tarjeta .tarjeta')`), 'no debe haber una card por campo');
      afirmar(/Datos registrados en SIPRA/.test(await nav.evaluar(textoPagina)), 'falta «Datos registrados en SIPRA»');
      const sug = await nav.evaluar(textoDe('[data-sugerencia-arl]'));
      if (sug) afirmar(/Sugerencia de la modalidad: .*no es el dato registrado/.test(sug), `la sugerencia debe ir aparte: ${sug}`);
      afirmar(!(await nav.evaluar(`!!document.querySelector('[aria-label="Corregir datos"]') || [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Corregir datos'))`)), 'un auxiliar no corrige datos de la práctica');
    });
    await paso('pestañas Versiones | Evidencia | Historial: versión activa por defecto y teclado (flechas)', async () => {
      const tabs = await nav.evaluar(`[...document.querySelectorAll('[role=tab]')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`);
      afirmar(/^Versiones/.test(tabs[0]) && /^Evidencia/.test(tabs[1]) && /^Historial/.test(tabs[2]), `pestañas: ${tabs.join(' | ')}`);
      afirmar(await nav.evaluar(`document.querySelector('#at-versiones').getAttribute('aria-selected') === 'true'`), 'Versiones debe ser la pestaña por defecto');
      afirmar(/v1.*Vigente.*En revisión.*En pantalla/s.test(await nav.evaluar(textoDe('#ap-versiones'))), 'falta la versión 1 vigente');
      await nav.evaluar(`document.querySelector('#at-versiones').focus()`);
      await nav.enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await nav.enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await nav.esperar(`document.querySelector('#at-evidencia').getAttribute('aria-selected') === 'true' && document.activeElement.id === 'at-evidencia'`, 5000, 'flecha derecha → Evidencia');
      const ev = await nav.evaluar(textoDe('#ap-evidencia'));
      afirmar(/Lectura del documento|Comparación con la práctica/.test(ev) && !/_/.test(ev.replace(/\bsin_/g, '')), `evidencia: ${ev}`);
      await nav.clic('[role=tab]', 'Versiones');
    });
    await paso('devolver: motivo del catálogo y vista previa de lo que leerá el estudiante', async () => {
      await nav.clic('.barra-decision button', 'Devolver');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.includes('Devolver Acta')).disabled`), 'sin motivo no se puede devolver');
      const motivos = await nav.evaluar(`[...document.querySelectorAll('#acta-motivo option')].map((o) => o.textContent.trim())`);
      afirmar(motivos.length === 10 && motivos.includes('Falta la firma de la empresa') && motivos.includes('Otro motivo (explicar)'), `motivos: ${motivos.join(' | ')}`);
      await nav.evaluar(`(() => { const s = document.querySelector('#acta-motivo'); s.value = 'falta_firma_empresa'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await nav.esperar(`/El estudiante verá/.test(document.querySelector('dialog[open]').innerText)`, 5000, 'vista previa');
      const prev = await nav.evaluar(textoDe('dialog[open] .previa'));
      afirmar(/Al acta le falta la firma de la empresa\./.test(prev) && /Pide a la empresa que la firme y cárgala de nuevo\./.test(prev), `vista previa: ${prev}`);
      await captura(nav, 'dialogo-devolver');
    });
    await paso('con «Otro» el texto es obligatorio (mínimo 10) y la vista previa lo muestra', async () => {
      await nav.evaluar(`(() => { const s = document.querySelector('#acta-motivo'); s.value = 'otro'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await nav.esperar(`!!document.querySelector('#acta-detalle')`, 5000, 'campo de texto');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.includes('Devolver Acta')).disabled`), 'con «otro» sin texto no se puede devolver');
      await nav.escribir('#acta-detalle', 'corto');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.includes('Devolver Acta')).disabled`), 'con menos de 10 caracteres sigue deshabilitado');
      afirmar(/5 \/ 10/.test(await nav.evaluar(textoDe('dialog[open]'))), 'debe mostrar el contador 5 / 10');
      await nav.escribir('#acta-detalle', 'Falta el sello de la empresa en la última página.');
      await nav.esperar(`/Falta el sello de la empresa en la última página\\./.test(document.querySelector('dialog[open] .previa').innerText)`, 5000, 'vista previa del texto libre');
      // Vuelve al motivo del catálogo y confirma.
      await nav.evaluar(`(() => { const s = document.querySelector('#acta-motivo'); s.value = 'falta_firma_empresa'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await nav.esperar(`![...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.includes('Devolver Acta')).disabled`, 5000, 'botón habilitado');
    });
    await paso('cancelar devuelve el foco al botón que abrió el diálogo (teclado)', async () => {
      await nav.clic('dialog[open] button', 'Cancelar');
      await nav.esperar(`!document.querySelector('dialog[open]')`, 5000, 'cierre');
      await nav.evaluar(`(() => { const b = [...document.querySelectorAll('.barra-decision button')].find((x) => x.textContent.includes('Devolver')); b.focus(); })()`);
      // Activado con el teclado: Enter sobre el botón enfocado abre el diálogo y, al cancelar, el foco vuelve a él.
      await nav.enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await nav.enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await nav.esperar(dialogoAbierto, 5000, 'diálogo abierto con el teclado');
      await nav.clic('dialog[open] button', 'Cancelar');
      await nav.esperar(`!document.querySelector('dialog[open]')`, 5000, 'cierre');
      afirmar(await nav.evaluar(`document.activeElement?.textContent.includes('Devolver')`), `el foco quedó en: ${await nav.evaluar('document.activeElement?.outerHTML.slice(0, 80)')}`);
    });
    await paso('confirmar la devolución: queda devuelta, con quién y cuándo, y no se puede decidir de nuevo', async () => {
      await nav.clic('.barra-decision button', 'Devolver');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      await nav.evaluar(`(() => { const s = document.querySelector('#acta-motivo'); s.value = 'falta_firma_empresa'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await nav.esperar(`![...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.includes('Devolver Acta')).disabled`, 5000, 'botón habilitado');
      await confirmarDialogo(nav, 'Devolver Acta');
      await nav.esperar(`/Acta devuelta al estudiante\\./.test(document.body.innerText) && /Decisión: Devuelta/.test(document.body.innerText)`, 20000, 'devolución registrada');
      afirmar(await nav.evaluar(`document.querySelectorAll('.barra-decision button').length === 0`), 'tras decidir no se ofrecen más decisiones');
      afirmar(/Aux|auxiliar|Julián/i.test(await nav.evaluar(textoDe('[data-decision]'))), 'debe decir quién decidió');
    });

    // ── 6 · Estudiante: ve el motivo y reenvía ──────────────────────────────
    console.log('\nEstudiante: ve el motivo y reenvía');
    await paso('«Necesita corrección»: qué pasó, qué hacer, sin códigos, con el botón para subir una nueva versión', async () => {
      await nav.sembrarSesion(estLaura);
      await nav.vista(1440, 900);
      await nav.ir(`${WEB}/practicas/${LAURA.practica}`);
      await nav.esperar(`document.querySelector('[data-acta-estado]')?.innerText === 'Necesita corrección'`, 30000, 'estado «Necesita corrección»');
      const t = await nav.evaluar(textoDe('[data-acta-mensaje]'));
      afirmar(/¿Qué pasó\?.*Al acta le falta la firma de la empresa\./s.test(t), `qué pasó: ${t}`);
      afirmar(/¿Qué debo hacer\?.*Pide a la empresa que la firme y cárgala de nuevo\./s.test(t), `qué hacer: ${t}`);
      afirmar(!/falta_firma|devuelto|por_corregir|revision|arl_no|_/.test(t), `códigos internos en el mensaje: ${t}`);
      afirmar(await nav.evaluar(`[...document.querySelectorAll('[data-acta-mensaje] button')].some((b) => b.textContent.includes('Subir nueva versión'))`), 'falta «Subir nueva versión»');
      await captura(nav, 'estudiante-2-devuelta');
    });
    await paso('«Subir nueva versión» lleva a la carga con el Acta elegida; tras cargar: versión 2 en revisión y la 1 en segundo plano', async () => {
      await nav.clic('[data-acta-mensaje] button', 'Subir nueva versión');
      await nav.esperar(`document.querySelector('#tipo-doc')?.value === 'acta_inicio'`, 5000, 'tipo elegido');
      await nav.archivo('input[type=file]', manifiesto.archivos['1-completa']);
      await nav.esperar(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Cargar y validar') && !b.disabled)`, 15000, 'botón Cargar y validar');
      await nav.clic('button', 'Cargar y validar');
      await nav.esperar(`document.querySelector('[data-acta-estado]')?.innerText === 'Acta en revisión'`, 60000, 'versión 2 en revisión');
      const t = await nav.evaluar(textoDe('sipra-acta-estudiante'));
      afirmar(/versión 2/i.test(t), `debe indicar la versión 2: ${t}`);
      afirmar(/Versión 1 · Necesita corrección/.test(t), 'la versión anterior debe verse en segundo plano');
      afirmar(!/Al acta le falta la firma/.test(await nav.evaluar(textoDe('[data-acta-mensaje]'))), 'los estados de las versiones no deben mezclarse');
    });

    // ── 7 · Auxiliar: versión 2, historial por versión y aprobar ────────────
    console.log('\nAuxiliar: revisar la versión 2 y aprobar');
    await abrirMesa(nav, aux);
    await paso('la bandeja marca el reenvío; el caso muestra v2 vigente en revisión y v1 anterior devuelta', async () => {
      const t = await nav.evaluar(textoDe('.lista'));
      afirmar(/Reenvío \(v2\)/.test(t), `la bandeja debe marcar el reenvío: ${t}`);
      await abrirCaso(nav, LAURA);
      const v = await nav.evaluar(textoDe('#ap-versiones'));
      afirmar(/v2\s+Vigente\s+.*En revisión/s.test(v) && /v1\s+Anterior\s+.*Devuelta/s.test(v), `versiones: ${v}`);
      afirmar(/versión 2/.test(await nav.evaluar(textoDe('sipra-actas-detalle header'))), 'el caso abierto debe ser la versión 2');
    });
    await paso('el historial pertenece a SU versión: la decisión de la v1 no aparece en la v2, y sí al ver la v1', async () => {
      await nav.clic('[role=tab]', 'Historial');
      afirmar(!/Decisión de una persona/.test(await nav.evaluar(textoDe('#ap-historial'))), 'el historial de la v2 no debe traer la decisión de la v1');
      await nav.clic('[role=tab]', 'Versiones');
      await nav.clic('#ap-versiones button', 'Ver');
      await nav.esperar(`/No es la versión vigente/.test(document.body.innerText)`, 15000, 'aviso de versión no vigente');
      await nav.clic('[role=tab]', 'Historial');
      afirmar(/Decisión de una persona/.test(await nav.evaluar(textoDe('#ap-historial'))), 'el historial de la v1 sí debe traer su decisión');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('.barra-decision button')].length === 0 || [...document.querySelectorAll('.barra-decision button')].every((b) => b.disabled)`), 'la v1 no se decide');
      await nav.clic('#ap-versiones button, [role=tab]', 'Versiones');
      await nav.clic('#ap-versiones button', 'Ver');
      await nav.esperar(`/versión 2/.test(document.querySelector('sipra-actas-detalle header').innerText)`, 15000, 'volver a la v2');
    });
    await paso('Acta consistente: aprobar es una confirmación simple (sin justificación), y queda aprobada', async () => {
      await nav.clic('sipra-actas-detalle button', 'Tomar el caso');
      await nav.esperar(`/Tomado por usted/.test(document.body.innerText)`, 20000, 'reserva');
      afirmar(/CONSISTENTE/i.test(await nav.evaluar(textoDe('[data-resultado]'))) && /Los datos principales del Acta coinciden con la práctica\./.test(await nav.evaluar(textoPagina)), 'debe verse «Consistente»');
      await nav.clic('.barra-decision button', 'Aprobar');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      afirmar(!(await nav.evaluar(`!!document.querySelector('dialog[open] textarea')`)), 'una aprobación consistente no pide justificación');
      afirmar(!/distinta de la recomendación/.test(await nav.evaluar(textoDe('dialog[open]'))), 'no debe advertir que se aparta de la recomendación');
      await confirmarDialogo(nav, 'Aprobar Acta');
      await nav.esperar(`/Acta aprobada\\./.test(document.body.innerText) && /Decisión: Aprobada/.test(document.body.innerText)`, 20000, 'aprobación');
    });
    await paso('el estudiante ve «Acta validada»', async () => {
      await nav.sembrarSesion(estLaura);
      await nav.ir(`${WEB}/practicas/${LAURA.practica}`);
      await nav.esperar(`document.querySelector('[data-acta-estado]')?.innerText === 'Acta validada'`, 30000, 'estado «Acta validada»');
      afirmar(/Tu acta de iniciación fue validada/.test(await nav.evaluar(textoDe('[data-acta-mensaje]'))), 'mensaje de validada');
    });

    // ── 8 · Andrés: discrepancia crítica y apartarse de la recomendación ────
    console.log('\nAuxiliar: discrepancia crítica y justificación reforzada');
    await abrirMesa(nav, aux);
    await abrirCaso(nav, ANDRES);
    await nav.clic('sipra-actas-detalle button', 'Tomar el caso');
    await nav.esperar(`/Tomado por usted/.test(document.body.innerText)`, 20000, 'reserva de Andrés');
    await paso('el responsable de la ARL no coincide y se ve CRÍTICO en el resumen y en la tabla', async () => {
      const arl = await nav.evaluar(`document.querySelector('.clave[data-clave=arl]').innerText.replace(/\\s+/g, ' ')`);
      afirmar(/SIPRA.*Empresa.*Acta.*CUN.*No coincide.*CRÍTICO/i.test(arl), `ARL: ${arl}`);
      const fila = await nav.evaluar(`[...document.querySelectorAll('table.cmp tbody tr')].find((r) => r.querySelector('th').innerText.includes('Responsable'))?.innerText.replace(/\\s+/g, ' ')`);
      afirmar(/Empresa.*CUN.*No coincide.*CRÍTICO/i.test(fila), `fila de la tabla: ${fila}`);
      afirmar(/Diferencias críticas|REVISIÓN NECESARIA/i.test(await nav.evaluar(textoDe('[data-resultado]'))), 'resultado principal');
      afirmar(/Encontramos diferencias que requieren revisión\./.test(await nav.evaluar(textoPagina)), 'frase del resultado');
      await captura(nav, 'caso-andres-critico');
    });
    await paso('aprobar contra la recomendación: aviso, justificación con contador 0 / 40 y no se envía hasta cumplirlo', async () => {
      await nav.clic('.barra-decision button', 'Aprobar');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      const d = await nav.evaluar(textoDe('dialog[open]'));
      afirmar(/Estás tomando una decisión distinta de la recomendación del sistema\./.test(d), 'falta el aviso de apartarse de la recomendación');
      afirmar(/0 \/ 40/.test(d), 'falta el contador 0 / 40');
      const dis = () => nav.evaluar(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.includes('Aprobar Acta')).disabled`);
      afirmar(await dis(), 'sin justificación debe estar deshabilitado');
      await nav.escribir('#acta-just', 'x'.repeat(39));
      afirmar(await dis() && /39 \/ 40/.test(await nav.evaluar(textoDe('dialog[open]'))), '39 caracteres no alcanzan');
      await nav.escribir('#acta-just', 'x'.repeat(40));
      afirmar(!(await dis()), '40 caracteres deben habilitar el botón');
      await captura(nav, 'dialogo-aprobar-contra-recomendacion');
      await nav.clic('dialog[open] button', 'Cancelar');
      await nav.esperar(`!document.querySelector('dialog[open]')`, 5000, 'cierre');
    });
    await paso('el servidor sigue siendo la autoridad: aprobar con 40 caracteres desde la API también exige la misma regla', async () => {
      const lista = await esperarBandeja(aux.accessToken, () => true);
      const id = casoDe(lista, ANDRES).validacionId;
      const corto = await api(`/actas-iniciacion/${id}/decision`, { token: aux.accessToken, metodo: 'POST', cuerpo: { decision: 'aprobar', justificacion: 'x'.repeat(39) } });
      afirmar(corto.estado === 400, `con 39 caracteres el servidor debe responder 400 y respondió ${corto.estado}`);
    });

    // ── 9 · Coordinación: supervisión, liberar, corregir ────────────────────
    console.log('\nCoordinación: supervisión, liberar reserva y corrección controlada');
    await abrirMesa(nav, coord);
    await paso('la supervisión muestra libres, tomados, por vencer, vencidos, por funcionario, discrepancias y documentos incorrectos', async () => {
      await nav.esperar(`!!document.querySelector('[data-supervision] .cifras')`, 20000, 'supervisión');
      const t = await nav.evaluar(textoDe('[data-supervision]'));
      for (const x of ['Libres', 'Tomados', 'Por vencer', 'Vencidos', 'Discrepancias críticas', 'Documentos incorrectos', 'Carga por funcionario']) afirmar(t.includes(x), `falta «${x}» en la supervisión`);
      afirmar(/Tomados/.test(t) && (await nav.evaluar(`[...document.querySelectorAll('[data-supervision] .cifra')].find((e) => e.innerText.includes('Tomados')).innerText.trim().startsWith('1')`)), 'debe haber 1 tomado (Andrés)');
      afirmar(/Julián|Auxiliar/i.test(t), 'debe verse la carga del auxiliar');
      await captura(nav, 'supervision');
    });
    await paso('liberar la reserva de otra persona pide confirmación: cancelar la deja; confirmar la libera', async () => {
      await nav.clic('[data-supervision] .cifra', 'Tomados');
      await nav.esperar(`document.querySelectorAll('.caso').length === 1`, 10000, 'filtro de tomados');
      await abrirCaso(nav, ANDRES);
      afirmar(/Tomado por/.test(await nav.evaluar(textoDe('sipra-actas-detalle header'))), 'debe verse quién lo tiene');
      await nav.clic('sipra-actas-detalle button', 'Liberar la reserva de otra persona');
      await nav.esperar(`!!document.querySelector('[data-aviso=liberar]')`, 5000, 'confirmación');
      afirmar(/Esa persona perderá el caso/.test(await nav.evaluar(textoDe('[data-aviso=liberar]'))), 'falta la advertencia');
      await nav.clic('[data-aviso=liberar] button', 'Cancelar');
      afirmar(/Tomado por/.test(await nav.evaluar(textoDe('sipra-actas-detalle header'))), 'cancelar no debe liberar');
      await nav.clic('sipra-actas-detalle button', 'Liberar la reserva de otra persona');
      await nav.esperar(`!!document.querySelector('[data-aviso=liberar]')`, 5000, 'confirmación');
      await nav.clic('[data-aviso=liberar] button', 'Sí, liberar la reserva');
      await nav.esperar(`/Reserva liberada/.test(document.body.innerText) && /Disponible/.test(document.querySelector('sipra-actas-detalle header').innerText)`, 20000, 'liberación');
    });
    await paso('corregir el responsable de la ARL: advertencia de recálculo, justificación y resultado explicado', async () => {
      await nav.clic('sipra-actas-detalle button', 'Tomar el caso');
      await nav.esperar(`/Tomado por usted/.test(document.body.innerText)`, 20000, 'reserva de coordinación');
      await nav.clic('sipra-actas-detalle button', 'Corregir datos');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo de corrección');
      const d = await nav.evaluar(textoDe('dialog[open]'));
      afirmar(/Este cambio puede recalcular la comparación del Acta\./.test(d), 'falta la advertencia de recálculo');
      afirmar(!/no modificará la decisión histórica/.test(d), 'sin decisión no debe decir que se conserva una decisión');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.includes('Guardar')).disabled`), 'sin cambios ni justificación no se guarda');
      await nav.evaluar(`(() => { const s = document.querySelector('#corr-arl'); s.value = 'cun'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await nav.escribir('#corr-just', 'Corto');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.includes('Guardar')).disabled`), 'con justificación corta no se guarda');
      await nav.escribir('#corr-just', 'El convenio de esta práctica establece que la CUN afilia a la ARL.');
      await captura(nav, 'dialogo-corregir');
      await nav.clic('dialog[open] button', 'Guardar corrección');
      await nav.esperar(`/Datos corregidos\\./.test(document.querySelector('dialog[open]')?.innerText ?? '')`, 20000, 'resultado de la corrección');
      afirmar(/La comparación del Acta se recalculó con los datos nuevos\./.test(await nav.evaluar(textoDe('dialog[open]'))), 'debe decir que la comparación se recalculó');
      await nav.clic('dialog[open] button', 'Entendido');
      await nav.esperar(`!document.querySelector('dialog[open]')`, 5000, 'cierre');
    });
    await paso('tras recalcular: el responsable de la ARL coincide y el caso pasa a consistente (nueva ronda en el historial)', async () => {
      await nav.esperar(`/CONSISTENTE/i.test(document.querySelector('[data-resultado]').innerText)`, 20000, 'resultado consistente');
      const arl = await nav.evaluar(`document.querySelector('.clave[data-clave=arl]').innerText.replace(/\\s+/g, ' ')`);
      afirmar(/SIPRA.*CUN.*Acta.*CUN.*Coincide/i.test(arl) && !/CRÍTICO/.test(arl), `ARL tras corregir: ${arl}`);
      await nav.clic('[role=tab]', 'Evidencia');
      afirmar(/Comparación con la práctica/.test(await nav.evaluar(textoDe('#ap-evidencia'))), 'la nueva ronda debe quedar como evidencia');
    });

    // ── 10 · Aviso posterior a la decisión ──────────────────────────────────
    console.log('\nCoordinación: aviso posterior a la decisión');
    await paso('supervisión ve las Actas decididas con el filtro de estado; corregir un dato conserva la decisión histórica y se avisa', async () => {
      await nav.clic('button', 'Limpiar filtros');
      await nav.esperar(`!document.querySelector('[aria-controls=mas-filtros]').innerText.includes('(')`, 10000, 'filtros limpios');
      await nav.clic('button', 'Más filtros');
      await nav.evaluar(`(() => { const s = document.querySelector('#f-estado'); s.value = 'aprobado_manual'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await nav.esperar(`document.querySelectorAll('.caso').length === 1 && document.querySelector('.caso').innerText.includes(${JSON.stringify(LAURA.nombre)})`, 15000, 'Actas aprobadas');
      await abrirCaso(nav, LAURA);
      afirmar(!(await nav.evaluar(`!!document.querySelector('[data-aviso=datos-cambiaron]')`)), 'todavía no deben haber cambiado los datos');
      await nav.clic('sipra-actas-detalle button', 'Corregir datos');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo de corrección');
      afirmar(/Este cambio no modificará la decisión histórica/.test(await nav.evaluar(textoDe('dialog[open]'))), 'debe advertir que no cambia la decisión histórica');
      await nav.evaluar(`(() => { const s = document.querySelector('#corr-arl'); s.value = 'cun'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await nav.escribir('#corr-just', 'Se corrige el acuerdo: finalmente la CUN afilia a la ARL.');
      await nav.clic('dialog[open] button', 'Guardar corrección');
      await nav.esperar(`/Datos corregidos\\./.test(document.querySelector('dialog[open]')?.innerText ?? '')`, 20000, 'resultado');
      afirmar(/La decisión histórica se conservó/.test(await nav.evaluar(textoDe('dialog[open]'))), 'debe decir que la decisión histórica se conservó');
      await nav.clic('dialog[open] button', 'Entendido');
      await nav.esperar(`!!document.querySelector('[data-aviso=datos-cambiaron]')`, 20000, 'aviso');
      const a = await nav.evaluar(textoDe('[data-aviso=datos-cambiaron]'));
      afirmar(/Los datos de la práctica cambiaron después de esta decisión\./.test(a) && /Esta decisión corresponde a la información registrada en ese momento\./.test(a), `aviso: ${a}`);
      afirmar(/Decisión: Aprobada/.test(await nav.evaluar(textoPagina)), 'la decisión histórica sigue siendo «Aprobada»');
      await captura(nav, 'aviso-datos-cambiaron');
      await nav.clic('[data-aviso=datos-cambiaron] button', 'Ver historial');
      await nav.esperar(`document.querySelector('#at-historial').getAttribute('aria-selected') === 'true'`, 5000, 'pestaña Historial');
      afirmar(/Cambio de datos de la práctica/.test(await nav.evaluar(textoDe('#ap-historial'))), 'el historial debe traer el cambio de datos');
    });

    // ── 11 · Inconsistencia operativa (si hay acceso a la base desechable) ──
    console.log('\nInconsistencia operativa');
    if (process.env.E2E_PSQL && process.env.E2E_DB) {
      await cargarActaPorApi(estValentina, VALENTINA.practica, manifiesto.archivos['3-completa']);
      const l = await esperarBandeja(aux.accessToken, (b) => b.items.some((i) => i.estudiante.nombre === VALENTINA.nombre && i.version === 2 && i.estado === 'revision'), 60000, 'la v2 de Valentina');
      const caso = casoDe(l, VALENTINA);
      execFileSync(process.env.E2E_PSQL, ['-h', '127.0.0.1', '-p', new URL(process.env.E2E_DB).port || '5432', '-U', 'postgres', '-d', new URL(process.env.E2E_DB).pathname.slice(1), '-qc',
        `UPDATE documentos SET estado = 'aprobado', decidido_por = (SELECT id FROM usuarios WHERE rol = 'auxiliar' LIMIT 1), justificacion_decision = 'Estado heredado sintetico.' WHERE id = (SELECT documento_id FROM validaciones_acta_iniciacion WHERE id = '${caso.validacionId}')`]);
      await abrirMesa(nav, coord);
      await paso('la bandeja y la supervisión señalan el caso heredado y el detalle exige revisión administrativa', async () => {
        const t = await nav.evaluar(textoDe('.lista'));
        afirmar(/Requiere revisión administrativa/.test(t), `la bandeja no lo marca: ${t}`);
        await nav.esperar(`!!document.querySelector('[data-inconsistencias]')`, 20000, 'el aviso de la supervisión');
        afirmar(/requiere revisión administrativa/i.test(await nav.evaluar(textoDe('[data-inconsistencias]'))), 'texto de la supervisión');
        await nav.clic('[data-inconsistencias] button', 'Abrir el caso');
        await nav.esperar(`!!document.querySelector('[data-aviso=inconsistencia]')`, 20000, 'aviso en el detalle');
        afirmar(/Este caso requiere revisión administrativa\./.test(await nav.evaluar(textoDe('[data-aviso=inconsistencia]'))), 'falta el aviso');
        afirmar(await nav.evaluar(`[...document.querySelectorAll('.barra-decision button')].every((b) => b.disabled)`), 'no debe permitir decidir');
        afirmar(await nav.evaluar(`![...document.querySelectorAll('sipra-actas-detalle button')].some((b) => b.textContent.includes('Tomar el caso') && !b.disabled)`), 'no debe permitir tomar el caso');
        await captura(nav, 'inconsistencia-operativa');
      });
    } else {
      console.log('  – omitido: defina E2E_PSQL y E2E_DB para crear el estado heredado en la base desechable');
    }

    // ── 12 · Permisos y navegación ──────────────────────────────────────────
    console.log('\nPermisos y navegación');
    await paso('el menú muestra «Actas de iniciación» a auxiliar, coordinación y administración, separado de la EPS', async () => {
      for (const s of [aux, coord, admin]) {
        await nav.sembrarSesion(s);
        await nav.ir(`${WEB}/inicio`);
        await nav.esperar(`!!document.querySelector('a[href="/actas"]') && !!document.querySelector('a[href="/eps"]')`, 20000, 'menú');
        afirmar(/Actas de iniciación/.test(await nav.evaluar(`document.querySelector('a[href="/actas"]').innerText`)), 'etiqueta del menú');
      }
    });
    await paso('el estudiante y el docente no entran a /actas (ni lo ven en el menú); la API tampoco los deja', async () => {
      for (const s of [estLaura, tutor]) {
        await nav.sembrarSesion(s);
        await nav.ir(`${WEB}/inicio`);
        await nav.esperar(`!!document.querySelector('main')`, 20000, 'inicio');
        afirmar(!(await nav.evaluar(`!!document.querySelector('a[href="/actas"]')`)), 'no debe verse el menú de Actas');
        await nav.ir(`${WEB}/actas`);
        await dormir(800);
        afirmar(!(await nav.evaluar(`document.body.innerText.includes('Mesa de Actas de Iniciación')`)), 'no debe abrir la Mesa');
      }
      afirmar((await api('/actas-iniciacion', { token: estLaura.accessToken })).estado === 403 && (await api('/actas-iniciacion', { token: tutor.accessToken })).estado === 403, 'la API debe negar la bandeja a estudiante y docente');
    });
    await paso('en el expediente, un funcionario ve que el Acta se decide en la Mesa (y no hay botones para decidirla ahí)', async () => {
      await nav.sembrarSesion(coord);
      await nav.ir(`${WEB}/practicas/${LAURA.practica}`);
      await nav.esperar(`!!document.querySelector('[data-acta-mesa]')`, 30000, 'nota del Acta');
      afirmar(/se revisa y se decide en la Mesa de Actas/.test(await nav.evaluar(textoDe('[data-acta-mesa]'))), 'falta la nota');
    });

    // ── 13 · Responsive del caso abierto ────────────────────────────────────
    // El caso abierto es el de Andrés, que coordinación tiene reservado: el Acta se abre sola y la decisión está habilitada.
    for (const [ancho, alto, etiqueta] of [[1920, 1080, '1920'], [1440, 900, '1440'], [1366, 768, '1366'], [1024, 768, '1024'], [768, 1024, '768'], [390, 844, 'móvil 390']]) {
      console.log(`\nCaso abierto · ${etiqueta}`);
      await paso(`${etiqueta}: caso con Acta, resumen, comparación y decisión sin desborde horizontal`, async () => {
        await abrirMesa(nav, coord, { ancho, alto });
        await abrirCaso(nav, ANDRES);
        await nav.esperar(`!!document.querySelector('sipra-actas-detalle h2')`, 20000, 'detalle');
        await dormir(800);
        afirmar(await nav.evaluar(sinDesborde), `desborde horizontal a ${etiqueta}`);
        afirmar(await nav.evaluar(`document.querySelectorAll('.clave').length === 4 && document.querySelectorAll('table.cmp tbody tr').length === 12`), 'faltan el resumen o la comparación');
        if (ancho >= 1024) {
          const caja = await nav.evaluar(`(() => { const e = document.querySelector('sipra-actas-visor'); const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()`);
          afirmar(caja.w >= 330 && caja.h >= 380, `el Acta debe tener espacio para revisarse (${caja.w}×${caja.h})`);
        }
        // La comparación nunca desborda: en angosto se apila por campo.
        if (ancho <= 480) afirmar(await nav.evaluar(`getComputedStyle(document.querySelector('table.cmp tbody tr')).display === 'grid'`), 'en pantallas angostas la comparación debe apilarse');
        // La barra de decisión queda al alcance, sin quedar tapada por la navegación inferior.
        const barra = await nav.evaluar(`(() => { const b = document.querySelector('.barra-decision'); if (!b) return null; b.scrollIntoView({ block: 'end' }); const r = b.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + Math.min(r.height / 2, 20); const t = document.elementFromPoint(x, y); return { dentro: !!t && b.contains(t), visible: r.bottom <= window.innerHeight + 1 && r.top >= 0 }; })()`);
        afirmar(barra?.dentro && barra?.visible, `la barra de decisión debe verse sin quedar tapada: ${JSON.stringify(barra)}`);
        await captura(nav, `caso-${ancho}`);
        if (ancho < 1200) {
          afirmar(await nav.evaluar(`getComputedStyle(document.querySelector('.lista-col')).display === 'none'`), 'en pantallas angostas se ve una cosa a la vez: el caso');
          await nav.clic('button', 'Volver a la lista');
          await nav.esperar(`document.querySelectorAll('.caso').length >= 1 && getComputedStyle(document.querySelector('.detalle-col')).display === 'none'`, 5000, 'volver a la lista');
        }
      });
    }

    // ── 14 · Claro / oscuro y contraste ─────────────────────────────────────
    for (const tema of ['oscuro', 'claro']) {
      console.log(`\nTema ${tema}`);
      await paso(`${tema}: contraste ≥ 4,5:1 en tabla, estados críticos, advertencias, firmas, botones y visor`, async () => {
        await abrirMesa(nav, coord, { tema });
        await abrirCaso(nav, ANDRES);
        await nav.esperar(`!!document.querySelector('.clave')`, 20000, 'resumen');
        const medir = {
          'resultado principal': '[data-resultado] .frase', 'título del resultado': '[data-resultado] .etiqueta', 'tabla (encabezado)': 'table.cmp thead th',
          'tabla (campo)': 'table.cmp tbody th', 'tabla (resultado)': 'table.cmp tbody .etiqueta', 'dato clave': '.clave .k', 'valor clave': '.clave strong, .clave .grande',
          'ayuda de firmas': '.ayuda-firmas', 'pestaña activa': '[role=tab][aria-selected=true]', 'pestaña inactiva': '[role=tab][aria-selected=false]',
          'barra de decisión (nota)': '.barra-decision .pista', 'item de la bandeja': '.caso .empresa', 'problema de la bandeja': '.caso .problema',
          'registrados en SIPRA': 'dl.registrados dd',
        };
        const fallos = [];
        for (const [nombreMedida, sel] of Object.entries(medir)) {
          const c = await nav.evaluar(contrasteDe(sel));
          if (c !== null && c < 4.5) fallos.push(`${nombreMedida}: ${c}`);
        }
        afirmar(fallos.length === 0, `contraste insuficiente en ${tema}: ${fallos.join('; ')}`);
        afirmar(await nav.evaluar(sinDesborde), 'desborde');
        await captura(nav, `tema-${tema}`);
      });
      await paso(`${tema}: los diálogos y los estados deshabilitados son legibles`, async () => {
        const abierto = await nav.evaluar(`[...document.querySelectorAll('.barra-decision button')].some((b) => !b.disabled)`);
        if (!abierto) return; // el caso abierto no se puede decidir: la medición de los diálogos se hizo con el auxiliar
        await nav.clic('.barra-decision button', 'Devolver');
        await nav.esperar(dialogoAbierto, 5000, 'diálogo');
        const c = await nav.evaluar(contrasteDe('dialog[open] h2'));
        afirmar(c >= 4.5, `contraste del título del diálogo: ${c}`);
        await nav.clic('dialog[open] button', 'Cancelar');
      });
    }

    // ── Errores de consola y de red ─────────────────────────────────────────
    await paso('sin errores de consola ni excepciones durante el último recorrido', async () => {
      const errores = nav.erroresPagina.filter((e) => !/Failed to load resource|favicon|403|404|401/.test(e));
      afirmar(errores.length === 0, `errores de consola: ${errores.slice(0, 3).join(' | ')}`);
    });
  } finally {
    await nav.cerrar();
  }

  const fallidos = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - fallidos.length}/${resultados.length} pasos correctos${fallidos.length ? `, ${fallidos.length} con fallos` : ''}`);
  process.exitCode = fallidos.length === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
