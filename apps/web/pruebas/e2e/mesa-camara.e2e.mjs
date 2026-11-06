// E2E local de la Mesa de Cámara de Comercio en un navegador real (Chrome/Edge instalado, por CDP). NO lo ejecuta el asistente.
//
// Requisitos (todo local y desechable; SOLO PDF sintéticos; NUNCA el API 3000, el frontend 4200 ni la base sipra_dev 5433):
//   · API en dev (AUTH_MODO=abierto) contra una base DESECHABLE migrada (incluye la migración 21) con las semillas sintéticas.
//   · Frontend servido (compilado o ng serve) con proxy al API.
//   · Una carpeta con `manifiesto.json` y los PDF sintéticos:
//       { "practicas": [ID_LAURA, ID_ANDRES, ID_VALENTINA],
//         "archivos": {
//           "pj-razon-distinta":         existencia y representación con razón social DISTINTA a la de SIPRA (discrepancia crítica),
//           "pj-consistente":            existencia y representación igual a SIPRA (NIT, DV, razón social y representante),
//           "pj-representante-distinto": igual a SIPRA salvo el representante legal,
//           "pn-persona-distinta":       matrícula de PERSONA NATURAL cuando SIPRA espera persona jurídica,
//           "documento-incorrecto":      una factura u otro documento que no es un certificado,
//           "pj-dudosa":                 NIT con dígito de verificación que no cuadra (lectura dudosa),
//           "pj-cancelada":              igual a SIPRA y con «Estado de la matrícula: CANCELADA»
//         } }
//     Laura (y Valentina) pertenecen al docente; Andrés a la escuela de la coordinación de ingenierías (como en el E2E del RUT).
//
// Variables: E2E_API (por defecto http://localhost:3100/api/v1), E2E_WEB (http://localhost:4202),
//   E2E_CAMARA (carpeta con manifiesto.json y los PDF; obligatoria), E2E_CAPTURAS (carpeta opcional para capturas),
//   E2E_PSQL (ruta de psql) + E2E_DB (base desechable, puerto 55432): para marcar el método OCR y cambiar datos de SIPRA,
//   que solo se pueden hacer en la base. E2E_CHROME: ruta del navegador.
// Uso: node pruebas/e2e/mesa-camara.e2e.mjs        (--help muestra esta cabecera)
//
// Recorrido principal: ESTUDIANTE carga la Cámara → procesamiento → FUNCIONARIO toma, revisa y DEVUELVE → ESTUDIANTE ve el mensaje y
// REENVÍA → FUNCIONARIO toma la versión nueva y APRUEBA. Además: rechazo con confirmación, discrepancia crítica + 40 caracteres, OCR dudoso,
// persona distinta, documento incorrecto, matrícula cancelada, representante diferente, reserva concurrente y liberar, supervisión,
// datos de SIPRA que cambian, permisos y responsive (1920, 1440, 1366, 1024, 768 y 390).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Navegador } from './cdp.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const cabecera = readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n');
  console.log(cabecera);
  process.exit(0);
}

const API = process.env.E2E_API ?? 'http://localhost:3100/api/v1';
const WEB = process.env.E2E_WEB ?? 'http://localhost:4202';
const CARPETA = process.env.E2E_CAMARA;
const CAPTURAS = process.env.E2E_CAPTURAS;
const PSQL = process.env.E2E_PSQL ?? 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const DB = process.env.E2E_DB ?? 'sipra_e2e_camara';
if (!CARPETA) { console.error('Falta E2E_CAMARA (carpeta con manifiesto.json y los PDF sintéticos). Use --help.'); process.exit(2); }
if (/:(3000|4200|5433)\b/.test(API + WEB)) { console.error('Se niega a correr contra el API 3000, el frontend 4200 o la base 5433.'); process.exit(2); }
const manifiesto = JSON.parse(readFileSync(join(CARPETA, 'manifiesto.json'), 'utf8'));

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

async function cargarPorApi(sesion, practica, archivo) {
  const f = new FormData();
  f.append('tipo', 'camara_comercio');
  f.append('archivo', new Blob([readFileSync(archivo)], { type: 'application/pdf' }), 'camara.pdf');
  const r = await api(`/documentos/practica/${practica}`, { token: sesion.accessToken, metodo: 'POST', formulario: f });
  if (r.estado >= 300) throw new Error(`No se pudo cargar la Cámara: ${r.estado} ${JSON.stringify(r.json)}`);
}

async function esperarBandeja(token, condicion, ms = 90000, descripcion = 'la bandeja') {
  const limite = Date.now() + ms;
  let ultima = null;
  while (Date.now() < limite) {
    ultima = (await api('/mesa-camara', { token })).json;
    if (ultima && condicion(ultima)) return ultima;
    await dormir(700);
  }
  throw new Error(`Tiempo agotado esperando ${descripcion}: ${JSON.stringify(ultima?.items?.map((i) => [i.estudiante.nombre, i.estado, i.recomendacion]))}`);
}
const casoDe = (lista, estudiante, version) => lista.items.find((i) => i.estudiante.nombre === estudiante.nombre && (version === undefined || i.version === version));

// ── Utilidades de pantalla ──────────────────────────────────────────────────

const sinDesborde = 'document.documentElement.scrollWidth <= window.innerWidth + 1';
const textoPagina = 'document.body.innerText';
const textoDe = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.innerText ?? '')`;
const SIN_ETIQUETA = `[...document.querySelectorAll('input, select, textarea')].filter((e) => (e.offsetWidth || e.offsetHeight) && e.type !== 'hidden' && !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).map((e) => e.id || e.name || e.tagName)`;
const BOTON = (dialogo, texto) => `[...document.querySelectorAll('${dialogo} button')].find((b) => b.textContent.includes(${JSON.stringify(texto)}))`;
const dialogoAbierto = `!!document.querySelector('dialog[open]')`;
const elegir = (nav, selector, valor) => nav.evaluar(`(() => { const s = document.querySelector(${JSON.stringify(selector)}); s.value = ${JSON.stringify(valor)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);

async function abrirMesa(nav, sesion, { ancho = 1440, alto = 900, tema = 'oscuro' } = {}) {
  await nav.sembrarSesion(sesion);
  await nav.enviar('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('sipra.camara.lista','si');localStorage.setItem('sipra.tema',${JSON.stringify(tema)});}catch(e){}` });
  await nav.vista(ancho, alto);
  await nav.ir(`${WEB}/mesa-camara`);
  await nav.esperar(`document.querySelector('h1')?.textContent.includes('Mesa de Cámara')`, 30000, 'título de la Mesa de Cámara');
  await nav.esperar(`!document.body.innerText.includes('Cargando los casos')`, 20000, 'fin de la carga');
}

async function abrirCaso(nav, estudiante) {
  await nav.clic('.caso', estudiante.nombre);
  await nav.esperar(`document.querySelector('sipra-camara-detalle h2')?.textContent.includes(${JSON.stringify(estudiante.nombre)})`, 20000, `caso de ${estudiante.nombre}`);
}

async function tomarCaso(nav) {
  await nav.clic('sipra-camara-detalle button', 'Tomar el caso');
  await nav.esperar(`/Tomado por usted/.test(document.body.innerText) && !!document.querySelector('sipra-camara-visor iframe')`, 20000, 'reserva y visor');
}

async function estudianteCarga(nav, sesion, estudiante, archivo) {
  await nav.sembrarSesion(sesion);
  await nav.vista(1440, 900);
  await nav.ir(`${WEB}/practicas/${estudiante.practica}`);
  await nav.esperar(`!!document.querySelector('[data-camara-estado]')`, 30000, 'la tarjeta de la Cámara');
  await nav.evaluar(`(() => { const s = document.querySelector('#tipo-doc'); s.value = 'camara_comercio'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await nav.archivo('input[type=file]', archivo);
  await nav.esperar(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Cargar y validar') && !b.disabled)`, 15000, 'botón Cargar y validar');
  await nav.clic('button', 'Cargar y validar');
}

async function decidirEnPantalla(nav, { boton, justificacion, motivo, detalle, confirmar }) {
  await nav.clic('.barra-decision button', boton);
  await nav.esperar(dialogoAbierto, 5000, 'diálogo de decisión');
  if (motivo) await elegir(nav, '#camara-motivo', motivo);
  if (detalle) await nav.escribir('#camara-detalle', detalle);
  if (justificacion) await nav.escribir('#camara-just', justificacion);
  if (confirmar) await nav.clic('dialog[open] input[type=checkbox]');
}

async function main() {
  if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });
  const captura = async (nav, nombre) => { if (CAPTURAS) await nav.captura(join(CAPTURAS, `${nombre}.png`)); };
  const tutor = await ingresar('tutor');
  // Coordinación de ingenierías: solo alcanza a Andrés.
  const coord = await ingresar('coordinador', 'coordinacion.ingenierias@cun.edu.co');
  const admin = await ingresar('administrador');
  const aux = await ingresar('auxiliar');
  const estLaura = await ingresar('estudiante', LAURA.correo);
  const estAndres = await ingresar('estudiante', ANDRES.correo);
  const estValentina = await ingresar('estudiante', VALENTINA.correo);

  console.log('\nPreparación (API): Andrés (representante distinto) y Valentina (persona natural cuando se espera jurídica)');
  await cargarPorApi(estAndres, ANDRES.practica, manifiesto.archivos['pj-representante-distinto']);
  await cargarPorApi(estValentina, VALENTINA.practica, manifiesto.archivos['pn-persona-distinta']);

  const nav = await Navegador.abrir();
  try {
    // ── 1 · Estudiante: carga la Cámara (versión 1) ─────────────────────────
    console.log('\nEstudiante: carga su certificado de Cámara');
    await paso('el estudiante ve «Pendiente de cargar» con qué pasó y qué hacer, sin códigos', async () => {
      await nav.sembrarSesion(estLaura);
      await nav.vista(1440, 900);
      await nav.ir(`${WEB}/practicas/${LAURA.practica}`);
      await nav.esperar(`!!document.querySelector('[data-camara-estado]')`, 30000, 'la tarjeta de la Cámara');
      const t = await nav.evaluar(textoDe('[data-camara-mensaje]'));
      afirmar(await nav.evaluar(textoDe('[data-camara-estado]')) === 'Pendiente de cargar', 'falta el estado «Pendiente de cargar»');
      afirmar(/¿Qué pasó\?/.test(t) && /¿Qué debo hacer\?/.test(t), 'debe responder qué pasó y qué hacer');
      afirmar(!/_|hash|confianza|OCR/i.test(t), 'no debe mostrar nombres internos');
      await captura(nav, 'estudiante-1-pendiente');
    });
    await paso('carga el certificado con otra razón social y queda «En revisión» (sin ofrecer reenviar todavía)', async () => {
      await estudianteCarga(nav, estLaura, LAURA, manifiesto.archivos['pj-razon-distinta']);
      await nav.esperar(`document.querySelector('[data-camara-estado]')?.innerText === 'En revisión'`, 90000, 'estado «En revisión»');
      const t = await nav.evaluar(textoDe('[data-camara-mensaje]'));
      afirmar(/en revisión por el equipo de prácticas/.test(t), `mensaje inesperado: ${t}`);
      afirmar(!(await nav.evaluar(`[...document.querySelectorAll('[data-camara-mensaje] button')].some((b) => /nueva versión/i.test(b.textContent))`)), 'no debe ofrecer reenviar mientras está en revisión');
    });
    const bandejaTutor = await esperarBandeja(tutor.accessToken, (l) => l.items.length >= 2 && l.items.every((i) => i.estado === 'revision'), 90000, 'los 2 casos del docente en revisión');
    const bandejaCoord = await esperarBandeja(coord.accessToken, (l) => l.items.length >= 1, 90000, 'el caso de la coordinación');
    const idAndres = casoDe(bandejaCoord, ANDRES).validacionId;

    await paso('contrato común para la futura Mesa Documental: practicaId, estudianteId, documentoId, tipo, estado, estadoHumano, reserva, problemaPrincipal y fechaCarga', async () => {
      const i = casoDe(bandejaTutor, LAURA);
      for (const k of ['practicaId', 'estudianteId', 'documentoId', 'tipo', 'estado', 'estadoHumano', 'reserva', 'problemaPrincipal', 'fechaCarga']) afirmar(k in i, `falta ${k}`);
      afirmar(i.tipo === 'camara_comercio' && i.estadoHumano.etiqueta === 'Revisión necesaria', `contrato: ${JSON.stringify(i.estadoHumano)}`);
    });
    await paso('alcance: la coordinación de ingenierías ve solo el de su escuela; el docente, solo los suyos; administración, todos', async () => {
      afirmar(bandejaCoord.items.length === 1 && bandejaCoord.items[0].estudiante.nombre === ANDRES.nombre, `coordinación: ${JSON.stringify(bandejaCoord.items.map((i) => i.estudiante.nombre))}`);
      afirmar(!bandejaTutor.items.some((i) => i.estudiante.nombre === ANDRES.nombre), 'el docente no debe ver el caso de otra escuela');
      afirmar((await api('/mesa-camara', { token: admin.accessToken })).json.items.length === 3, 'administración debe ver los 3');
    });

    // ── 2 · Responsive: bandeja y caso ──────────────────────────────────────
    for (const [ancho, alto, etiqueta] of [[1920, 1080, '1920'], [1440, 900, '1440'], [1366, 768, '1366'], [1024, 768, '1024'], [768, 1024, '768'], [390, 844, 'móvil 390']]) {
      console.log(`\nVista ${etiqueta}`);
      await paso(`${etiqueta}: bandeja con KPIs y filtros, sin desborde horizontal y con controles etiquetados`, async () => {
        await abrirMesa(nav, tutor, { ancho, alto });
        afirmar(await nav.evaluar(`document.querySelectorAll('.kpi').length >= 6`), 'faltan los KPIs');
        afirmar(await nav.evaluar(`!!document.querySelector('#f-buscar') && !!document.querySelector('#f-reserva') && !!document.querySelector('#f-persona')`), 'faltan los filtros esenciales');
        afirmar(await nav.evaluar(`document.querySelectorAll('.caso').length === 2`), 'el docente debe ver 2 casos');
        afirmar(await nav.evaluar(sinDesborde), `desborde horizontal a ${etiqueta}`);
        afirmar((await nav.evaluar(SIN_ETIQUETA)).length === 0, `controles sin etiqueta: ${await nav.evaluar(`JSON.stringify(${SIN_ETIQUETA})`)}`);
        await captura(nav, `bandeja-${ancho}`);
      });
      await paso(`${etiqueta}: el caso (documento + comparación + decisión) se abre sin desborde; en pantalla angosta se vuelve a la lista`, async () => {
        await abrirCaso(nav, LAURA);
        await nav.esperar(`!!document.querySelector('table.cmp')`, 20000, 'la tabla de comparación');
        afirmar(await nav.evaluar(sinDesborde), `desborde horizontal con el caso a ${etiqueta}`);
        afirmar(await nav.evaluar(`!!document.querySelector('.barra-decision')`), 'falta la barra de decisión');
        if (ancho < 1200) {
          afirmar(await nav.evaluar(`getComputedStyle(document.querySelector('.lista-col')).display === 'none'`), 'en pantalla angosta se ve una sola cosa: el caso');
          await nav.clic('sipra-camara-detalle button', 'Volver a la lista');
          await nav.esperar(`getComputedStyle(document.querySelector('.lista-col')).display !== 'none'`, 5000, 'volver a la lista');
        } else {
          afirmar(await nav.evaluar(`document.querySelectorAll('.caso').length === 2`), 'en escritorio la lista sigue junto al caso');
        }
        await captura(nav, `caso-${ancho}`);
      });
    }

    // ── 3 · Bandeja: contenido y KPIs ───────────────────────────────────────
    console.log('\nBandeja (docente)');
    await abrirMesa(nav, tutor);
    await paso('cada caso muestra estudiante, modalidad, tipo esperado/detectado, PN/PJ, problema principal, lectura, antigüedad y reserva; sin códigos internos', async () => {
      const t = await nav.evaluar(textoDe('.lista'));
      afirmar(t.includes(LAURA.nombre) && t.includes(VALENTINA.nombre), 'faltan los estudiantes');
      afirmar(/Esperado: Certificado de Cámara de Comercio · Detectado: Existencia y representación legal · Persona jurídica/.test(t), 'falta lo esperado/detectado de Laura');
      afirmar(/Detectado: Matrícula mercantil · persona natural · Persona natural/.test(t), 'falta lo detectado de Valentina');
      afirmar(/Un dato clave del certificado no coincide con SIPRA/.test(t) && /distinta de la esperada/i.test(t), 'faltan los problemas principales');
      afirmar(/Texto digital/.test(t) && /(Hoy|\d+ días?) · .*Disponible/.test(t), 'falta lectura, antigüedad y reserva');
      afirmar(!/_|discrepancia_critica|persona_distinta|revision\b/.test(t), `la bandeja muestra códigos internos: ${t.slice(0, 200)}`);
      afirmar(!t.includes(ANDRES.nombre), 'el docente NO debe ver el caso de otra escuela');
    });
    await paso('los KPIs son operativos (pendientes, míos, discrepancias, OCR, persona/tipo distinto, documento incorrecto) y filtran', async () => {
      const k = await nav.evaluar(`[...document.querySelectorAll('.kpi')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`);
      afirmar(['Pendientes', 'Míos', 'Con discrepancias', 'OCR', 'Persona o tipo distinto', 'Documento incorrecto'].every((x) => k.some((y) => y.includes(x))), `KPIs: ${k.join(' | ')}`);
      await nav.clic('.kpi', 'Persona o tipo distinto');
      await nav.esperar(`document.querySelectorAll('.caso').length === 1 && document.querySelector('.caso').innerText.includes(${JSON.stringify(VALENTINA.nombre)})`, 10000, 'filtro persona distinta');
      afirmar(await nav.evaluar(`document.querySelector('.kpi[aria-pressed=true]')?.innerText.includes('Persona o tipo distinto')`), 'el KPI activo debe marcarse (aria-pressed)');
      await nav.clic('.kpi', 'Persona o tipo distinto');
      await nav.esperar(`document.querySelectorAll('.caso').length === 2`, 10000, 'sin filtro');
    });

    // ── 4 · Docente: Laura — discrepancia crítica, devolución, reenvío y aprobación ─────────
    console.log('\nDocente: discrepancia crítica (Laura), devolución, reenvío y aprobación');
    await paso('abrir un caso libre no lo reserva: se ve el resultado, y hay que tomarlo para abrir el documento y decidir', async () => {
      await abrirCaso(nav, LAURA);
      afirmar(/Disponible/.test(await nav.evaluar(textoDe('sipra-camara-detalle header'))), 'debe verse «Disponible»');
      afirmar(/Tome el caso para abrir el certificado/.test(await nav.evaluar(textoDe('sipra-camara-visor'))), 'el visor debe pedir tomar el caso');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('.barra-decision button')].every((b) => b.disabled)`), 'las decisiones deben estar deshabilitadas sin la reserva');
    });
    await paso('al tomarlo, el PDF llega por blob local con Authorization y sin credenciales en la URL', async () => {
      await tomarCaso(nav);
      afirmar(await nav.evaluar(`document.querySelector('sipra-camara-visor iframe').src.startsWith('blob:')`), 'el visor debe usar un blob local');
      afirmar(!nav.solicitudes.some((s) => /\/archivo/.test(s.url) && /token|access|jwt/i.test(s.url)), 'no debe haber credenciales en la URL del archivo');
      afirmar(nav.solicitudes.filter((s) => /\/mesa-camara\/.+\/archivo/.test(s.url)).every((s) => s.cabeceras.Authorization || s.cabeceras.authorization), 'el archivo debe pedirse con la cabecera Authorization');
      await captura(nav, 'caso-discrepancia');
    });
    await paso('visor: página, zoom, ajustar ancho y pantalla ampliada', async () => {
      const src0 = await nav.evaluar(`document.querySelector('sipra-camara-visor iframe').src`);
      afirmar(/page=1/.test(src0) && /view=FitH/.test(src0), `parámetros iniciales: ${src0}`);
      await nav.clic('sipra-camara-visor button', '+');
      await nav.esperar(`/zoom=125/.test(document.querySelector('sipra-camara-visor iframe').src)`, 5000, 'zoom 125');
      await nav.clic('sipra-camara-visor button', 'Ajustar ancho');
      await nav.esperar(`/view=FitH/.test(document.querySelector('sipra-camara-visor iframe').src)`, 5000, 'ajuste al ancho');
      await nav.clic('sipra-camara-visor button', 'Ampliar');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo ampliado');
      await nav.clic('dialog.ampliado[open] button', 'Cerrar');
      await nav.esperar(`!document.querySelector('dialog[open]')`, 5000, 'cierre');
    });
    await paso('comparación: Campo | SIPRA | Cámara | Resultado; la razón social figura «No coincide · CRÍTICO» (texto + icono, no solo color)', async () => {
      const cab = await nav.evaluar(`[...document.querySelectorAll('table[data-tabla=criticos] thead th')].map((e) => e.innerText.trim())`);
      afirmar(/^CAMPO\|SIPRA\|CÁMARA\|RESULTADO$/i.test(cab.join('|')), `encabezados: ${cab.join('|')}`);
      const razon = await nav.evaluar(`[...document.querySelectorAll('table[data-tabla=criticos] tr')].find((r) => /Razón social/.test(r.innerText))?.innerText ?? ''`);
      afirmar(/No coincide/.test(razon) && /CRÍTICO/.test(razon), `razón social: ${razon}`);
      const v = await nav.evaluar(textoDe('[data-seccion=verificacion]'));
      afirmar(/Autenticidad|No verificada/.test(v) && !/aut[eé]ntico|Certificado vigente/i.test(v), `verificación: ${v}`);
      afirmar(!/Vigente|Vencido|No vigente|Expirado/.test(await nav.evaluar(textoDe('[data-seccion=informativos]'))), 'renovación y expedición no deben decir vigente/vencido');
    });
    await paso('devolver: el catálogo (12 motivos) viene de la API; «otro» exige detalle; la vista previa dice qué pasó y qué hacer', async () => {
      await nav.clic('.barra-decision button', 'Devolver');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      afirmar(await nav.evaluar(`${BOTON('dialog[open]', 'Devolver certificado')}.disabled`), 'sin motivo no se puede devolver');
      const catalogo = (await api('/mesa-camara/motivos-devolucion', { token: tutor.accessToken })).json;
      afirmar(catalogo.length === 12 && catalogo.every((m) => m.codigo && m.titulo && m.mensajeEstudiante?.que && m.mensajeEstudiante?.hacer), 'el catálogo debe traer 12 motivos completos');
      const motivos = await nav.evaluar(`[...document.querySelectorAll('#camara-motivo option')].map((o) => o.textContent.trim())`);
      afirmar(catalogo.filter((m) => m.aplicaA.includes('juridica')).every((m) => motivos.includes(m.titulo)), `motivos: ${motivos.join(' | ')}`);
      await elegir(nav, '#camara-motivo', 'otro');
      await nav.esperar(`!!document.querySelector('#camara-detalle')`, 5000, 'campo de detalle');
      afirmar(await nav.evaluar(`${BOTON('dialog[open]', 'Devolver certificado')}.disabled`), 'con «otro» sin texto no se puede devolver');
      await elegir(nav, '#camara-motivo', 'razon_social_no_coincide');
      await nav.esperar(`/El estudiante verá/.test(document.querySelector('dialog[open]').innerText)`, 5000, 'vista previa');
      const m = catalogo.find((x) => x.codigo === 'razon_social_no_coincide');
      const prev = await nav.evaluar(textoDe('dialog[open] .previa'));
      afirmar(prev.includes(m.mensajeEstudiante.que) && prev.includes(m.mensajeEstudiante.hacer), `vista previa: ${prev}`);
      await captura(nav, 'dialogo-devolver');
      await nav.clic('dialog[open] button', 'Devolver certificado');
      await nav.esperar(`/Certificado devuelto/.test(document.body.innerText) && /Decisión: Devuelto/.test(document.body.innerText)`, 20000, 'devolución registrada');
    });
    await paso('el estudiante ve «Necesita corrección» con qué pasó y qué hacer, sin códigos ni detalle técnico, y puede reenviar', async () => {
      await nav.sembrarSesion(estLaura);
      await nav.ir(`${WEB}/practicas/${LAURA.practica}`);
      await nav.esperar(`document.querySelector('[data-camara-estado]')?.innerText === 'Necesita corrección'`, 30000, 'estado «Necesita corrección»');
      const t = await nav.evaluar(textoDe('[data-camara-mensaje]'));
      const m = (await api('/mesa-camara/motivos-devolucion', { token: tutor.accessToken })).json.find((x) => x.codigo === 'razon_social_no_coincide');
      afirmar(t.includes(m.mensajeEstudiante.que) && t.includes(m.mensajeEstudiante.hacer), `mensaje: ${t}`);
      afirmar(!/_|hash|confianza|OCR|[0-9a-f]{32}/i.test(t), 'no debe mostrar códigos, hash, confianza ni OCR');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('[data-camara-mensaje] button')].some((b) => /nueva versión/i.test(b.textContent))`), 'debe ofrecer subir una nueva versión');
    });
    await paso('reenvío: la nueva carga crea la versión 2 y una validación nueva; la v1 queda como historia', async () => {
      await estudianteCarga(nav, estLaura, LAURA, manifiesto.archivos['pj-consistente']);
      await nav.esperar(`document.querySelector('[data-camara-estado]')?.innerText === 'En revisión'`, 90000, 'estado «En revisión» de la versión 2');
      const lista = await esperarBandeja(tutor.accessToken, (l) => l.items.some((i) => i.estudiante.nombre === LAURA.nombre && i.version === 2), 90000, 'la versión 2 de Laura');
      afirmar(casoDe(lista, LAURA, 2).recomendacion === 'consistente', `la v2 debía ser consistente: ${casoDe(lista, LAURA, 2).recomendacion}`);
      afirmar(!lista.items.some((i) => i.estudiante.nombre === LAURA.nombre && i.version === 1), 'la versión 1 no debe estar en la bandeja');
    });
    await abrirMesa(nav, tutor);
    await paso('el docente toma la versión nueva y la aprueba SIN justificación larga (consistente); la versión 1 consta como histórica', async () => {
      await abrirCaso(nav, LAURA);
      await tomarCaso(nav);
      const r = await nav.evaluar(textoDe('[data-resultado]'));
      afirmar(/CONSISTENTE/i.test(r), `resultado: ${r}`);
      await nav.clic('.barra-decision button', 'Aprobar');
      await nav.esperar(dialogoAbierto, 5000, 'diálogo');
      afirmar(await nav.evaluar(`!${BOTON('dialog[open]', 'Aprobar certificado')}.disabled`), 'un caso consistente se aprueba sin justificación larga');
      await nav.clic('dialog[open] button', 'Aprobar certificado');
      await nav.esperar(`/Certificado aprobado/.test(document.body.innerText) && /Decisión: Aprobado/.test(document.body.innerText)`, 20000, 'aprobación registrada');
      const versiones = await nav.evaluar(textoDe('#rp-versiones'));
      afirmar(/v2.*Vigente.*Aprobado/s.test(versiones) && /v1.*Anterior.*Devuelto/s.test(versiones), `versiones: ${versiones}`);
    });
    await paso('el estudiante ve «Aprobado»', async () => {
      await nav.sembrarSesion(estLaura);
      await nav.ir(`${WEB}/practicas/${LAURA.practica}`);
      await nav.esperar(`document.querySelector('[data-camara-estado]')?.innerText === 'Aprobado'`, 30000, 'estado «Aprobado»');
    });

    // ── 5 · Valentina: persona distinta, documento incorrecto y rechazo ─────
    console.log('\nDocente: persona distinta (Valentina), documento incorrecto y rechazo con confirmación');
    await abrirMesa(nav, tutor);
    await paso('persona distinta: «Persona distinta», no «documento inválido»; los críticos son «No aplica»', async () => {
      await abrirCaso(nav, VALENTINA);
      const r = await nav.evaluar(textoDe('[data-resultado]'));
      afirmar(/PERSONA DISTINTA/i.test(r) && !/inválid/i.test(r), `resultado: ${r}`);
      const filas = await nav.evaluar(textoDe('table[data-tabla=criticos]'));
      afirmar(/No aplica/.test(filas) && !/No coincide/.test(filas), `críticos: ${filas}`);
      await captura(nav, 'caso-persona-distinta');
    });
    await paso('aprobar un caso que el sistema no ve consistente exige 40 caracteres de justificación (contador visible)', async () => {
      await tomarCaso(nav);
      await decidirEnPantalla(nav, { boton: 'Aprobar', justificacion: 'Texto corto.' });
      afirmar(await nav.evaluar(`${BOTON('dialog[open]', 'Aprobar certificado')}.disabled`), 'con menos de 40 caracteres debe estar deshabilitado');
      afirmar(/12 \/ 40/.test(await nav.evaluar(textoDe('dialog[open]'))), 'debe mostrar el contador 12 / 40');
      await nav.clic('dialog[open] button', 'Cancelar');
      await nav.esperar(`!document.querySelector('dialog[open]')`, 5000, 'cierre');
    });
    await paso('devolver la v1 de Valentina; el estudiante reenvía un documento incorrecto (v2)', async () => {
      await decidirEnPantalla(nav, { boton: 'Devolver', motivo: 'persona_no_coincide' });
      await nav.clic('dialog[open] button', 'Devolver certificado');
      await nav.esperar(`/Decisión: Devuelto/.test(document.body.innerText)`, 20000, 'devolución');
      await cargarPorApi(estValentina, VALENTINA.practica, manifiesto.archivos['documento-incorrecto']);
      await esperarBandeja(tutor.accessToken, (l) => l.items.some((i) => i.estudiante.nombre === VALENTINA.nombre && i.version === 2), 90000, 'la versión 2 de Valentina');
    });
    await abrirMesa(nav, tutor);
    await paso('documento incorrecto: «Documento no corresponde», sin comparación inventada; rechazar exige justificación y confirmación explícita', async () => {
      await abrirCaso(nav, VALENTINA);
      afirmar(/DOCUMENTO NO CORRESPONDE/i.test(await nav.evaluar(textoDe('[data-resultado]'))), 'falta «Documento no corresponde»');
      afirmar(!(await nav.evaluar(`!!document.querySelector('table[data-tabla=criticos]')`)), 'no debe haber tabla de comparación para un documento incorrecto');
      await tomarCaso(nav);
      await decidirEnPantalla(nav, { boton: 'Rechazar', justificacion: 'No es un certificado de Cámara de Comercio: es otro documento.' });
      afirmar(await nav.evaluar(`${BOTON('dialog[open]', 'Rechazar certificado')}.disabled`), 'sin confirmar, el rechazo debe seguir deshabilitado');
      afirmar(/Esta versión quedará cerrada/.test(await nav.evaluar(textoDe('dialog[open]'))), 'falta el aviso de impacto');
      await captura(nav, 'dialogo-rechazar');
      await nav.clic('dialog[open] input[type=checkbox]');
      await nav.clic('dialog[open] button', 'Rechazar certificado');
      await nav.esperar(`/Certificado rechazado/.test(document.body.innerText) && /Decisión: Rechazado/.test(document.body.innerText)`, 20000, 'rechazo registrado');
    });
    await paso('la API exige confirmar=true para rechazar (400 sin él) y el estudiante ve «Rechazado»', async () => {
      const lista = (await api('/mesa-camara?estado=revision,aprobado_manual,devuelto,rechazado', { token: admin.accessToken })).json;
      afirmar(lista.items.some((i) => i.estudiante.nombre === VALENTINA.nombre && i.estado === 'rechazado'), 'el rechazo debe constar');
      await nav.sembrarSesion(estValentina);
      await nav.ir(`${WEB}/practicas/${VALENTINA.practica}`);
      await nav.esperar(`document.querySelector('[data-camara-estado]')?.innerText === 'Rechazado'`, 30000, 'estado «Rechazado»');
    });

    // ── 6 · Valentina v3: lectura dudosa (OCR), reserva concurrente y liberar ───────
    console.log('\nAdministración: lectura dudosa por OCR, reserva concurrente y liberar (Valentina, versión 3)');
    await cargarPorApi(estValentina, VALENTINA.practica, manifiesto.archivos['pj-dudosa']);
    const lista3 = await esperarBandeja(admin.accessToken, (l) => l.items.some((i) => i.estudiante.nombre === VALENTINA.nombre && i.version === 3), 90000, 'la versión 3 de Valentina');
    const caso3 = casoDe(lista3, VALENTINA, 3);
    afirmar(caso3.lecturaDudosa === true, `la versión 3 debía ser dudosa: ${JSON.stringify(caso3)}`);
    // Una lectura OCR se simula marcando el método en la base desechable (el OCR real no es estable sobre un PDF sintético).
    sql(`UPDATE validaciones_documento_empresarial SET metodo_lectura = 'ocr' WHERE id = '${caso3.validacionId}'`);
    await paso('reserva concurrente: 25 funcionarios a la vez → un ganador (200) y 24 conflictos (409)', async () => {
      const tokens = [admin.accessToken, tutor.accessToken];
      const res = await Promise.all(Array.from({ length: 25 }, (_, i) => api(`/mesa-camara/${caso3.validacionId}/tomar`, { token: tokens[i % 2], metodo: 'POST' })));
      const ok = res.filter((r) => r.estado === 200).length;
      afirmar(ok >= 1 && res.every((r) => [200, 409].includes(r.estado)), `estados: ${res.map((r) => r.estado).join(',')}`);
      afirmar((await api(`/mesa-camara/${caso3.validacionId}/liberar`, { token: admin.accessToken, metodo: 'POST' })).estado === 200, 'la administración debe poder liberar');
      afirmar((await api(`/mesa-camara/${caso3.validacionId}/tomar`, { token: tutor.accessToken, metodo: 'POST' })).estado === 200, 'el docente debe poder tomarlo');
    });
    await abrirMesa(nav, admin);
    await paso('administración ve el caso tomado por otra persona y lo libera con confirmación (queda en la auditoría)', async () => {
      await abrirCaso(nav, VALENTINA);
      afirmar(/Tomado por/.test(await nav.evaluar(textoDe('sipra-camara-detalle header'))) && !/Tomado por usted/.test(await nav.evaluar(textoDe('sipra-camara-detalle header'))), 'debe verse tomado por otra persona');
      await nav.clic('sipra-camara-detalle button', 'Liberar la reserva de otra persona');
      await nav.esperar(`!!document.querySelector('[data-aviso=liberar]')`, 5000, 'confirmación');
      await nav.clic('[data-aviso=liberar] button', 'Sí, liberar la reserva');
      await nav.esperar(`/Disponible/.test(document.querySelector('sipra-camara-detalle header').innerText)`, 15000, 'caso disponible');
      afirmar(Number(sql(`SELECT count(*) FROM auditoria WHERE accion = 'camara_liberada' AND entidad_id = '${caso3.validacionId}'`)) >= 1, 'la liberación debe constar en la auditoría');
    });
    await paso('lectura dudosa: «Leído por OCR · revisar contra el documento»; los críticos dicen «Información insuficiente», nunca «No coincide»', async () => {
      const t = await nav.evaluar(textoDe('[data-lectura]'));
      afirmar(t.includes('Leído por OCR · revisar contra el documento'), `lectura: ${t}`);
      const filas = await nav.evaluar(textoDe('table[data-tabla=criticos]'));
      afirmar(/Información insuficiente/.test(filas) && !/No coincide/.test(filas) && !/Coincide\b/.test(filas.replace(/No coincide/g, '')), `críticos: ${filas}`);
      afirmar(!/\d\s?%/.test(await nav.evaluar(textoDe('sipra-camara-detalle'))), 'no debe mostrarse una confianza global como certeza');
    });

    // ── 7 · Valentina v4: matrícula cancelada y datos de SIPRA que cambian ──────────
    console.log('\nAdministración: matrícula cancelada y cambio de datos de SIPRA (Valentina, versión 4)');
    await paso('devolver la v3 y cargar la v4 con la matrícula cancelada', async () => {
      await abrirMesa(nav, admin);
      await abrirCaso(nav, VALENTINA);
      await tomarCaso(nav);
      await decidirEnPantalla(nav, { boton: 'Devolver', motivo: 'documento_ilegible' });
      await nav.clic('dialog[open] button', 'Devolver certificado');
      await nav.esperar(`/Decisión: Devuelto/.test(document.body.innerText)`, 20000, 'devolución');
      await cargarPorApi(estValentina, VALENTINA.practica, manifiesto.archivos['pj-cancelada']);
      await esperarBandeja(admin.accessToken, (l) => l.items.some((i) => i.estudiante.nombre === VALENTINA.nombre && i.version === 4), 90000, 'la versión 4');
    });
    await abrirMesa(nav, admin);
    await paso('matrícula cancelada: alerta «El certificado declara que la matrícula está cancelada.»; no hay rechazo automático', async () => {
      await abrirCaso(nav, VALENTINA);
      const a = await nav.evaluar(textoDe('[data-alerta=cancelada]'));
      afirmar(a.includes('El certificado declara que la matrícula está cancelada.') && /no hay rechazo automático/.test(a), `alerta: ${a}`);
      afirmar(/Cancelado/.test(await nav.evaluar(textoDe('[data-seccion=estado-registral]'))), 'el estado registral debe decir Cancelado');
      afirmar(/REVISIÓN NECESARIA/i.test(await nav.evaluar(textoDe('[data-resultado]'))), 'debe llevar a revisión humana');
      await captura(nav, 'caso-cancelada');
    });
    await paso('los datos de SIPRA cambian mientras el caso está abierto: la Mesa lo avisa y recalcula sin releer el PDF', async () => {
      sql(`UPDATE practicas SET empresa_razon_social = COALESCE(empresa_razon_social, '') || ' CAMBIADA' WHERE id = '${VALENTINA.practica}'`);
      sql(`UPDATE empresas SET razon_social = razon_social || ' CAMBIADA' WHERE id = (SELECT empresa_id FROM practicas WHERE id = '${VALENTINA.practica}')`);
      await nav.clic('sipra-camara-detalle button', 'Recalcular comparación');
      await nav.esperar(`/Los datos de SIPRA cambiaron después de esta validación/.test(document.body.innerText)`, 15000, 'aviso de datos de SIPRA');
      const evs = Number(sql(`SELECT count(*) FROM evidencias_validacion_doc_empresarial e JOIN validaciones_documento_empresarial v ON v.id = e.validacion_id WHERE v.practica_id = '${VALENTINA.practica}' AND e.tipo = 'comparacion'`));
      afirmar(evs >= 2, `debe haber una evidencia de comparación nueva: ${evs}`);
    });
    await paso('aprobar con matrícula cancelada o discrepancia exige 40 caracteres y queda con la justificación en la evidencia', async () => {
      await tomarCaso(nav);
      const justificacion = 'Coordinación confirmó por escrito que la matrícula fue reactivada.';
      await decidirEnPantalla(nav, { boton: 'Aprobar', justificacion });
      await nav.clic('dialog[open] button', 'Aprobar certificado');
      await nav.esperar(`/Decisión: Aprobado/.test(document.body.innerText)`, 20000, 'aprobación');
      const ev = sql(`SELECT datos->>'justificacion' FROM evidencias_validacion_doc_empresarial e JOIN validaciones_documento_empresarial v ON v.id = e.validacion_id WHERE v.practica_id = '${VALENTINA.practica}' AND e.tipo = 'decision_humana' AND e.resultado = 'aprobar'`);
      afirmar(ev.includes('reactivada'), `justificación en la evidencia: ${ev}`);
    });
    await paso('tras una decisión, un cambio de SIPRA NO altera la decisión: queda el aviso y una constancia en el historial', async () => {
      sql(`UPDATE practicas SET empresa_razon_social = COALESCE(empresa_razon_social, '') || ' OTRA' WHERE id = '${VALENTINA.practica}'`);
      sql(`UPDATE empresas SET razon_social = razon_social || ' OTRA' WHERE id = (SELECT empresa_id FROM practicas WHERE id = '${VALENTINA.practica}')`);
      await nav.clic('sipra-camara-detalle button', 'Actualizar');
      await nav.esperar(`/Los datos de SIPRA cambiaron después de esta validación/.test(document.body.innerText) && /no se modifica/.test(document.body.innerText)`, 15000, 'aviso posterior a la decisión');
      afirmar(/Decisión: Aprobado/.test(await nav.evaluar(textoPagina)), 'la decisión histórica debe seguir intacta');
    });

    // ── 8 · Representante diferente (coordinación) ───────────────────────────
    // Las tres prácticas comparten la empresa sintética: se restaura lo que los pasos anteriores cambiaron en SIPRA.
    sql(`UPDATE empresas SET razon_social = replace(replace(razon_social, ' CAMBIADA', ''), ' OTRA', '')`);
    sql(`UPDATE practicas SET empresa_razon_social = NULLIF(trim(replace(replace(COALESCE(empresa_razon_social, ''), ' CAMBIADA', ''), ' OTRA', '')), '')`);
    console.log('\nCoordinación: representante diferente (Andrés)');
    await abrirMesa(nav, coord);
    await paso('representante diferente: sección «Representante legal · Importante», «No coincide» sin la marca CRÍTICO y aviso de revisión', async () => {
      await abrirCaso(nav, ANDRES);
      const rep = await nav.evaluar(textoDe('[data-seccion=representante]'));
      afirmar(/Importante/.test(rep) && /No coincide/.test(rep) && !/CRÍTICO/.test(rep), `representante: ${rep}`);
      afirmar(/revíselo antes de decidir/.test(await nav.evaluar(textoDe('[data-aviso=representante]'))), 'falta el aviso de revisión');
      afirmar(/REVISIÓN NECESARIA/i.test(await nav.evaluar(textoDe('[data-resultado]'))), 'debe pedir revisión');
      afirmar(!/CRÍTICO/.test(await nav.evaluar(textoDe('table[data-tabla=criticos]'))), 'NIT, DV y razón social coinciden: ningún crítico en falla');
    });

    // ── 9 · Supervisión y permisos ──────────────────────────────────────────
    console.log('\nSupervisión y permisos');
    await paso('supervisión (coordinación/administración): libres, tomados, por vencer, vencidos, discrepancias, OCR, tipo/persona distinta, incorrectos y carga por funcionario', async () => {
      const s = (await api('/mesa-camara/supervision', { token: admin.accessToken })).json;
      for (const k of ['abiertas', 'libres', 'tomadas', 'porVencer', 'vencidas', 'conDiscrepancia', 'documentoIncorrecto', 'lecturaDudosa', 'personaDistinta', 'porEstado', 'funcionarios']) afirmar(k in s, `falta ${k}`);
      await abrirMesa(nav, admin);
      await nav.clic('button', 'Cargar la supervisión').catch(() => undefined);
      await nav.esperar(`!!document.querySelector('[data-supervision] .cifras')`, 15000, 'supervisión');
      const t = await nav.evaluar(textoDe('[data-supervision]'));
      afirmar(/Libres/.test(t) && /Tomados/.test(t) && /Por vencer/.test(t) && /Vencidos/.test(t) && /Carga por funcionario/.test(t), `supervisión: ${t.slice(0, 300)}`);
    });
    await paso('permisos: el auxiliar, la empresa, la extensión y el estudiante no operan la Mesa (403); el docente no supervisa', async () => {
      const ext = await ingresar('extension');
      const emp = await ingresar('empresa');
      for (const [rol, tok] of [['auxiliar', aux], ['empresa', emp], ['extensión', ext], ['estudiante', estLaura]]) {
        afirmar((await api('/mesa-camara', { token: tok.accessToken })).estado === 403, `${rol}: la bandeja debe dar 403`);
      }
      afirmar((await api('/mesa-camara/supervision', { token: tutor.accessToken })).estado === 403, 'el docente no supervisa');
      afirmar((await api('/mesa-camara/supervision', { token: coord.accessToken })).estado === 200, 'la coordinación sí supervisa');
      // El camino general ya no decide la Cámara: solo la Mesa.
      const doc = (await api(`/documentos/practica/${LAURA.practica}`, { token: tutor.accessToken })).json;
      const camara = (Array.isArray(doc) ? doc : doc?.items ?? []).find((d) => d.tipo === 'camara_comercio');
      if (camara) afirmar((await api(`/documentos/${camara.id}/decision`, { token: tutor.accessToken, metodo: 'PATCH', cuerpo: { decision: 'aprobar', justificacion: 'Intento por el camino general.' } })).estado === 403, 'el camino general no debe decidir la Cámara');
    });
    await paso('el estudiante no ve la Mesa ni el menú de revisión', async () => {
      await nav.sembrarSesion(estLaura);
      await nav.ir(`${WEB}/mesa-camara`);
      await dormir(1500);
      afirmar(!/Mesa de Cámara/.test(await nav.evaluar(`document.querySelector('h1')?.textContent ?? ''`)), 'el estudiante no debe ver la Mesa de Cámara');
    });

    // ── 10 · Accesibilidad por tema ─────────────────────────────────────────
    for (const tema of ['claro', 'oscuro']) {
      await paso(`tema ${tema}: controles con etiqueta, tablas con encabezados, botones con nombre y resultados que no dependen solo del color`, async () => {
        await abrirMesa(nav, admin, { tema });
        await nav.clic('button', 'Más filtros');
        await elegir(nav, '#f-estado', 'revision,aprobado_manual,devuelto,rechazado');
        await nav.esperar(`document.querySelectorAll('.caso').length >= 3`, 15000, 'todos los estados');
        await nav.clic('.caso', LAURA.nombre);
        await nav.esperar(`!!document.querySelector('[data-resultado]')`, 20000, 'resultado');
        afirmar((await nav.evaluar(SIN_ETIQUETA)).length === 0, `controles sin etiqueta: ${await nav.evaluar(`JSON.stringify(${SIN_ETIQUETA})`)}`);
        afirmar(await nav.evaluar(`[...document.querySelectorAll('table.cmp')].every((t) => t.querySelector('caption') && t.querySelectorAll('thead th[scope=col]').length === 4 && t.querySelectorAll('tbody th[scope=row]').length > 0)`), 'las tablas deben tener caption, encabezados de columna y de fila');
        afirmar(await nav.evaluar(`[...document.querySelectorAll('.res .etiqueta')].every((e) => e.innerText.trim().length > 2)`), 'los resultados no dependen solo del color');
        afirmar(await nav.evaluar(sinDesborde), 'sin desborde horizontal');
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
