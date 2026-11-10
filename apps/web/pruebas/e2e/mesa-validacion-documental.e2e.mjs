// E2E local de la Mesa de Validación Documental UNIFICADA en un navegador real (Chrome/Edge instalado, por CDP).
//
// Requisitos (todo local y desechable; SOLO PDF sintéticos; NUNCA el API 3000, el frontend 4200 ni la base sipra_dev 5433):
//   · API en dev (AUTH_MODO=abierto) contra una base DESECHABLE migrada y sembrada, preparada con
//     `apps/api/herramientas/preparar-e2e-validacion-documental.ts` (crea a «Estudiante Prueba CUNbre», práctica de CUNbre consolidado y
//     los PDF sintéticos de EPS, RUT, Cámara, acta y un documento general).
//   · Frontend servido (compilado o ng serve) con proxy al API.
// Variables: E2E_API (por defecto http://localhost:3101/api/v1), E2E_WEB (http://127.0.0.1:4203), E2E_VD (carpeta con manifiesto.json y los
//   PDF; obligatoria), E2E_CAPTURAS (carpeta opcional), E2E_PSQL + E2E_DB (psql y base desechable, puerto 55432: solo para comprobar hechos
//   de la base), E2E_CHROME (ruta del navegador).
// Uso: node pruebas/e2e/mesa-validacion-documental.e2e.mjs        (--help muestra esta cabecera)
//
// Recorrido principal: COORDINACIÓN abre la Mesa Documental → busca «Estudiante Prueba CUNbre» → abre su expediente → ve EPS, RUT, Cámara y
// las demás obligaciones reales → abre EPS y la toma → «siguiente pendiente» (salta el RUT que otra persona tiene tomado) → abre la Cámara →
// la devuelve → permanece dentro del mismo expediente. Además: multiusuario (el docente toma el RUT; coordinación ve «tomado por otra
// persona» y toma la Cámara), devolución → reenvío del estudiante → versión vigente e histórico bajo demanda, actualización de progreso y
// contadores sin recargar, permisos por motor, supervisión, el expediente tradicional sin decisiones generales para los motores y
// responsive (1920, 1440, 1366, 1024, 768 y 390).
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Navegador } from './cdp.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const cabecera = readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n');
  console.log(cabecera);
  process.exit(0);
}

const API = process.env.E2E_API ?? 'http://localhost:3101/api/v1';
const WEB = process.env.E2E_WEB ?? 'http://127.0.0.1:4203';
const CARPETA = process.env.E2E_VD;
const CAPTURAS = process.env.E2E_CAPTURAS;
if (!CARPETA) { console.error('Falta E2E_VD (carpeta con manifiesto.json y los PDF sintéticos). Use --help.'); process.exit(2); }
if (/:(3000|4200|5433)\b/.test(API + WEB)) { console.error('Se niega a correr contra el API 3000, el frontend 4200 o la base 5433.'); process.exit(2); }
const manifiesto = JSON.parse(readFileSync(join(CARPETA, 'manifiesto.json'), 'utf8'));
const PRACTICA = manifiesto.practica;
const NOMBRE = manifiesto.estudiante.nombre;

const resultados = [];
const paso = async (nombre, f) => {
  try { await f(); resultados.push({ nombre, ok: true }); console.log(`  ✔ ${nombre}`); }
  catch (e) { resultados.push({ nombre, ok: false, error: e.message }); console.log(`  ✘ ${nombre}\n      ${e.message}`); }
};
const afirmar = (cond, mensaje) => { if (!cond) throw new Error(mensaje); };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function cargarPorApi(sesion, tipo, archivo) {
  const f = new FormData();
  f.append('tipo', tipo);
  f.append('archivo', new Blob([readFileSync(archivo)], { type: 'application/pdf' }), `${tipo}.pdf`);
  const r = await api(`/documentos/practica/${PRACTICA}`, { token: sesion.accessToken, metodo: 'POST', formulario: f });
  if (r.estado >= 300) throw new Error(`No se pudo cargar ${tipo}: ${r.estado} ${JSON.stringify(r.json)}`);
}

const expedienteApi = async (token) => (await api(`/validacion-documental/${PRACTICA}`, { token })).json;
const docApi = (e, tipo) => e.documentos.find((d) => d.tipoDocumento === tipo);

async function esperarExpediente(token, condicion, ms = 90000, descripcion = 'el expediente') {
  const limite = Date.now() + ms;
  let ultimo = null;
  while (Date.now() < limite) {
    ultimo = await expedienteApi(token);
    if (ultimo?.documentos && condicion(ultimo)) return ultimo;
    await dormir(700);
  }
  throw new Error(`Tiempo agotado esperando ${descripcion}: ${JSON.stringify(ultimo?.documentos?.map((d) => [d.tipoDocumento, d.estadoHumano]))}`);
}

// ── Utilidades de pantalla ──────────────────────────────────────────────────

const sinDesborde = 'document.documentElement.scrollWidth <= window.innerWidth + 1';
const textoPagina = 'document.body.innerText';
const textoDe = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.innerText ?? '')`;
const SIN_ETIQUETA = `[...document.querySelectorAll('input, select, textarea')].filter((e) => (e.offsetWidth || e.offsetHeight) && e.type !== 'hidden' && !(e.labels && e.labels.length) && !e.getAttribute('aria-label')).map((e) => e.id || e.name || e.type)`;
const dialogoAbierto = `!!document.querySelector('dialog[open]')`;
const elegir = (nav, selector, valor) => nav.evaluar(`(() => { const s = document.querySelector(${JSON.stringify(selector)}); s.value = ${JSON.stringify(valor)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const chipDoc = (tipo) => `document.querySelector('[data-vd-doc][data-tipo="${tipo}"]')?.innerText ?? ''`;

async function abrirMesa(nav, sesion, { ancho = 1440, alto = 900, tema = 'oscuro' } = {}) {
  await nav.sembrarSesion(sesion);
  await nav.enviar('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('sipra.tema',${JSON.stringify(tema)});}catch(e){}` });
  await nav.vista(ancho, alto);
  await nav.ir(`${WEB}/validacion-documental`);
  await nav.esperar(`document.querySelector('h1')?.textContent.includes('Validación documental')`, 30000, 'título de la Mesa Documental');
  await nav.esperar(`!document.body.innerText.includes('Cargando expedientes')`, 20000, 'fin de la carga de la cola');
}

async function abrirExpediente(nav, sesion, { ancho = 1440, alto = 900, doc = '', minimo = 6 } = {}) {
  await nav.sembrarSesion(sesion);
  await nav.vista(ancho, alto);
  await nav.ir(`${WEB}/validacion-documental/${PRACTICA}${doc ? `?doc=${doc}` : ''}`);
  await nav.esperar(`document.querySelectorAll('[data-vd-doc]').length >= ${minimo}`, 30000, 'la lista de documentos del expediente');
}

async function decidirCamara(nav, { boton, accion }) {
  await nav.clic('sipra-vd-camara .barra-decision button', boton);
  await nav.esperar(dialogoAbierto, 5000, 'diálogo de decisión');
  await accion?.();
}

async function main() {
  if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });
  const captura = async (nav, nombre) => { if (CAPTURAS) await nav.captura(join(CAPTURAS, `${nombre}.png`)); };

  const est = await ingresar('estudiante', manifiesto.estudiante.correo);
  const coord = await ingresar('coordinador', 'coordinacion.practicas@cun.edu.co');
  const tutor = await ingresar('tutor');
  const aux = await ingresar('auxiliar');
  const ext = await ingresar('extension');
  const emp = await ingresar('empresa');

  console.log('\nPreparación (API): el estudiante carga EPS, RUT, Cámara (otra razón social), acta y un documento general');
  await cargarPorApi(est, 'certificado_eps', manifiesto.archivos.eps);
  await cargarPorApi(est, 'rut_juridico', manifiesto.archivos.rut);
  await cargarPorApi(est, 'camara_comercio', manifiesto.archivos['camara-razon-distinta']);
  await cargarPorApi(est, 'acta_inicio', manifiesto.archivos.acta);
  await cargarPorApi(est, 'soporte_aceptacion_cunbre', manifiesto.archivos.general);
  let e0 = await esperarExpediente(coord.accessToken, (e) => e.documentos.filter((d) => d.documentoId).every((d) => d.estadoHumano !== 'procesando'), 120000, 'que los motores procesen los cinco documentos');

  // ── 1 · Contrato normalizado, obligaciones, versiones y permisos (API) ─────────────────────────
  console.log('\nAgregador (API)');
  await paso('contrato normalizado por documento y motor correcto (EPS, acta, RUT, Cámara y general)', async () => {
    const claves = ['documentoId', 'practicaId', 'estudianteId', 'tipoDocumento', 'nombreHumano', 'motor', 'version', 'estadoInterno', 'estadoHumano', 'fechaCarga', 'problemaPrincipal',
      'requiereRevision', 'reserva', 'validacionId', 'obligatorio', 'operable', 'puedeTomar', 'puedeDecidir'];
    for (const d of e0.documentos) for (const k of claves) afirmar(k in d, `falta ${k} en ${d.tipoDocumento}`);
    const motor = (t) => docApi(e0, t).motor;
    afirmar(motor('certificado_eps') === 'eps' && motor('acta_inicio') === 'acta' && motor('rut_juridico') === 'rut' && motor('camara_comercio') === 'camara' && motor('soporte_aceptacion_cunbre') === 'general', 'motores');
    for (const t of ['certificado_eps', 'rut_juridico', 'camara_comercio', 'acta_inicio']) afirmar(docApi(e0, t).validacionId, `${t} debe traer el id de su validación`);
  });
  await paso('las obligaciones salen de la modalidad: lo no cargado es «Pendiente de cargar» y el progreso no marca «completo»', async () => {
    const pendientes = e0.documentos.filter((d) => d.estadoHumano === 'pendiente_de_cargar').map((d) => d.tipoDocumento);
    afirmar(pendientes.includes('certificado_arl') && pendientes.includes('evaluacion_final_cunbre') && pendientes.includes('entregable_mentoria_1'), `pendientes: ${pendientes.join(',')}`);
    afirmar(e0.progreso.completo === false && e0.progreso.aprobados === 0 && e0.progreso.total >= 10, JSON.stringify(e0.progreso));
    afirmar(e0.progreso.requierenRevision >= 3, `requieren revisión: ${e0.progreso.requierenRevision}`);
  });
  await paso('estados humanos comunes sin tocar los internos: cada motor conserva su estado propio', async () => {
    afirmar(docApi(e0, 'certificado_eps').estadoInterno === 'procesado' && docApi(e0, 'rut_juridico').estadoInterno === 'revision' && docApi(e0, 'soporte_aceptacion_cunbre').estadoInterno === 'en_revision', 'estados internos');
    afirmar(e0.documentos.filter((d) => d.documentoId).every((d) => d.estadoHumano === 'disponible_para_revision'), 'todos disponibles para revisión');
    afirmar(docApi(e0, 'camara_comercio').problemaPrincipal && /no coincide/.test(docApi(e0, 'camara_comercio').problemaPrincipal), 'la Cámara debe señalar su problema principal');
  });
  await paso('permisos por motor: el docente opera RUT, Cámara y general pero NO EPS ni acta; el auxiliar opera EPS y acta pero NO RUT ni Cámara', async () => {
    const t = await expedienteApi(tutor.accessToken);
    afirmar(docApi(t, 'certificado_eps').operable === false && docApi(t, 'certificado_eps').puedeTomar === false, 'el docente no opera EPS');
    afirmar(docApi(t, 'acta_inicio').operable === false, 'el docente no opera el acta');
    afirmar(docApi(t, 'rut_juridico').operable && docApi(t, 'rut_juridico').puedeTomar && docApi(t, 'camara_comercio').operable, 'el docente opera RUT y Cámara');
    afirmar(docApi(t, 'soporte_aceptacion_cunbre').operable && docApi(t, 'soporte_aceptacion_cunbre').puedeDecidir, 'el docente decide el general');
    const a = await expedienteApi(aux.accessToken);
    afirmar(docApi(a, 'certificado_eps').operable && docApi(a, 'acta_inicio').operable, 'el auxiliar opera EPS y acta');
    afirmar(docApi(a, 'rut_juridico')?.operable === false && docApi(a, 'camara_comercio')?.operable === false, 'el auxiliar no opera RUT ni Cámara');
    afirmar(!docApi(a, 'soporte_aceptacion_cunbre'), 'el auxiliar no ve documentos fuera de su proceso');
  });
  await paso('el agregador no eleva privilegios: extensión, empresa y estudiante reciben 403 y el camino general no decide RUT ni Cámara', async () => {
    for (const [rol, tok] of [['extensión', ext], ['empresa', emp], ['estudiante', est]]) {
      afirmar((await api('/validacion-documental', { token: tok.accessToken })).estado === 403, `${rol}: la cola debe dar 403`);
      afirmar((await api(`/validacion-documental/${PRACTICA}`, { token: tok.accessToken })).estado === 403, `${rol}: el expediente debe dar 403`);
    }
    afirmar((await api('/validacion-documental/supervision', { token: tutor.accessToken })).estado === 403, 'el docente no supervisa');
    for (const t of ['rut_juridico', 'camara_comercio']) {
      const r = await api(`/documentos/${docApi(e0, t).documentoId}/decision`, { token: tutor.accessToken, metodo: 'PATCH', cuerpo: { decision: 'aprobar', justificacion: 'Intento por el camino general.' } });
      afirmar(r.estado === 403, `${t}: el camino general debe dar 403 (dio ${r.estado})`);
    }
  });
  await paso('contrato común de la cola: cada expediente trae progreso, indicadores, chips por documento y quién trabaja', async () => {
    const l = (await api('/validacion-documental?buscar=Prueba', { token: coord.accessToken })).json;
    afirmar(l.items.length === 1 && l.items[0].estudiante.nombre === NOMBRE, 'debe haber un expediente');
    const i = l.items[0];
    afirmar(i.progreso.total >= 10 && i.documentos.length >= 10 && 'indicadores' in i && Array.isArray(i.funcionariosTrabajando) && i.prioridad.grupo, JSON.stringify(Object.keys(i)));
    afirmar(i.indicadores.criticos >= 1, 'la Cámara con otra razón social debe contar como crítica');
    afirmar(l.kpis.expedientes === 1 && l.kpis.documentosPorRevisar >= 3, JSON.stringify(l.kpis));
    afirmar(!i.estudiante.documentoEnmascarado.includes('1098765432') && /••••/.test(i.estudiante.documentoEnmascarado), 'el documento debe ir enmascarado');
  });

  const nav = await Navegador.abrir();
  try {
    // ── 2 · Recorrido principal (coordinación) ────────────────────────────────
    console.log('\nCoordinación: abre la Mesa Documental, busca al estudiante y revisa su paquete');
    await paso('abre la Mesa Documental y busca «Estudiante Prueba CUNbre»', async () => {
      await abrirMesa(nav, coord);
      afirmar(await nav.evaluar(`document.querySelectorAll('.kpi').length >= 5`), 'faltan los indicadores');
      await nav.escribir('#vd-buscar', 'Prueba CUNbre');
      await nav.esperar(`document.querySelectorAll('[data-vd-expediente]').length === 1`, 10000, 'un solo expediente');
      const fila = await nav.evaluar(textoDe('[data-vd-expediente]'));
      afirmar(fila.includes(NOMBRE) && /0 \/ \d+ aprobados/.test(fila), `fila: ${fila}`);
      afirmar(/Certificado de afiliación a EPS · Disponible para revisión/.test(fila.replace(/\n/g, ' ')) || /Disponible para revisión/.test(fila), 'la fila debe mostrar el estado humano común de cada documento');
      afirmar(/Pendiente de cargar/.test(fila), 'la fila debe mostrar lo pendiente');
      await captura(nav, 'cola');
    });
    await nav.evaluar(`window.__vd = 'misma-pagina'`);
    // El docente (funcionario A) toma el RUT por el endpoint de su motor.
    const tutorTomaRut = await api(`/mesa-rut/${docApi(e0, 'rut_juridico').validacionId}/tomar`, { token: tutor.accessToken, metodo: 'POST' });
    afirmar(tutorTomaRut.estado === 200, `el docente debe poder tomar el RUT: ${tutorTomaRut.estado}`);

    await paso('abre el expediente: ve EPS, RUT, Cámara y las demás obligaciones reales, con progreso y contadores', async () => {
      await nav.clic('[data-vd-expediente]', NOMBRE);
      await nav.esperar(`document.querySelectorAll('[data-vd-doc]').length > 5 && !!document.querySelector('[data-vd-progreso]')`, 30000, 'el expediente');
      afirmar(await nav.evaluar(`location.pathname.includes(${JSON.stringify(PRACTICA)})`), 'la URL debe ser la del expediente');
      const docs = await nav.evaluar(`[...document.querySelectorAll('[data-vd-doc]')].map((d) => d.innerText.replace(/\\n/g, ' · '))`);
      const todo = docs.join(' | ');
      for (const n of ['EPS', 'RUT', 'Cámara', 'Pendiente de cargar']) afirmar(todo.includes(n), `falta «${n}» en la lista de documentos`);
      afirmar(/\d+ \/ \d+ aprobados/.test(await nav.evaluar(textoDe('[data-vd-progreso]'))), 'falta «X / Y aprobados»');
      const cont = await nav.evaluar(textoDe('[data-vd-contadores]'));
      afirmar(/Pendientes de cargar/.test(cont) && /Requieren revisión/.test(cont) && /Necesitan corrección/.test(cont), `contadores: ${cont}`);
      afirmar(!/Completa/i.test(await nav.evaluar(textoDe('[data-vd-etiqueta-progreso]'))) && /En curso/.test(await nav.evaluar(textoDe('[data-vd-etiqueta-progreso]'))), 'no debe decir «completa»');
      afirmar(await nav.evaluar(`document.querySelector('[data-vd-doc][data-tipo="certificado_eps"]').getAttribute('aria-current') === 'true'`), 'el primer pendiente (EPS) debe quedar activo');
      await captura(nav, 'expediente');
    });
    await paso('EPS dentro del mismo espacio: visor + resultado + acciones con el componente de su motor; se toma desde aquí', async () => {
      await nav.esperar(`!!document.querySelector('sipra-vd-eps sipra-eps-detalle h2')`, 30000, 'el detalle de EPS');
      afirmar(await nav.evaluar(`!!document.querySelector('sipra-vd-eps sipra-eps-visor')`), 'falta el visor de EPS');
      await nav.clic('sipra-vd-eps button', 'Tomar el caso');
      await nav.esperar(`/Tomado por usted/.test(${chipDoc('certificado_eps')})`, 20000, 'EPS tomada, reflejada en la lista de documentos');
      afirmar(await nav.evaluar(`window.__vd === 'misma-pagina'`), 'la página no debe recargarse al tomar');
      afirmar(/En revisión/.test(await nav.evaluar(chipDoc('certificado_eps'))), 'EPS debe pasar a «En revisión»');
      await captura(nav, 'eps-tomada');
    });
    await paso('multiusuario: el RUT aparece «tomado por otra persona» (el docente) y no se ofrece tomarlo', async () => {
      const rut = await nav.evaluar(chipDoc('rut_juridico'));
      afirmar(/Tomado por Hern/.test(rut) && !/Tomado por usted/.test(rut), `RUT: ${rut}`);
      afirmar(/En revisión/.test(rut), 'el RUT tomado debe verse «En revisión»');
    });
    await paso('«Documento siguiente» pasa al siguiente documento sin volver a la cola y abre el RUT con el componente de su motor', async () => {
      await nav.clic('[data-vd-nav] button', 'Documento siguiente');
      await nav.esperar(`document.querySelector('[data-vd-doc][data-tipo="rut_juridico"]').getAttribute('aria-current') === 'true'`, 10000, 'RUT activo');
      await nav.esperar(`!!document.querySelector('sipra-vd-rut sipra-rut-detalle h2')`, 30000, 'el detalle del RUT');
      const t = await nav.evaluar(textoDe('sipra-vd-rut'));
      afirmar(/Tomado por/.test(t) && !/Tomado por usted/.test(t), 'el RUT debe verse tomado por otra persona');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('sipra-vd-rut .barra-decision button')].every((b) => b.disabled)`), 'sin la reserva no se puede decidir');
    });
    await paso('«Siguiente pendiente» salta el RUT ajeno y llega a la Cámara; la Cámara libre se toma desde aquí', async () => {
      await nav.clic('[data-vd-nav] button', 'Siguiente pendiente');
      await nav.esperar(`document.querySelector('[data-vd-doc][data-tipo="camara_comercio"]').getAttribute('aria-current') === 'true'`, 10000, 'Cámara activa');
      await nav.esperar(`!!document.querySelector('sipra-vd-camara sipra-camara-detalle h2')`, 30000, 'el detalle de la Cámara');
      await nav.clic('sipra-vd-camara button', 'Tomar el caso');
      await nav.esperar(`/Tomado por usted/.test(${chipDoc('camara_comercio')}) && !!document.querySelector('sipra-vd-camara sipra-camara-visor iframe')`, 20000, 'Cámara tomada y visor');
      afirmar(await nav.evaluar(`!!document.querySelector('sipra-vd-camara table.cmp')`), 'falta la tabla de comparación del motor');
      await captura(nav, 'camara-tomada');
    });
    await paso('decide la Cámara (devolver) con la decisión del motor y PERMANECE en el mismo expediente: estado, progreso y contadores se actualizan sin recargar', async () => {
      await decidirCamara(nav, {
        boton: 'Devolver',
        accion: async () => {
          await elegir(nav, '#camara-motivo', 'razon_social_no_coincide');
          await nav.esperar(`/El estudiante verá/.test(document.querySelector('dialog[open]').innerText)`, 5000, 'vista previa');
          await nav.clic('dialog[open] button', 'Devolver certificado');
        },
      });
      await nav.esperar(`/Necesita corrección/.test(${chipDoc('camara_comercio')})`, 20000, 'la lista refleja «Necesita corrección»');
      afirmar(await nav.evaluar(`window.__vd === 'misma-pagina'`), 'no debe recargarse la aplicación');
      afirmar(await nav.evaluar(`location.pathname.includes(${JSON.stringify(PRACTICA)})`), 'debe seguir dentro del expediente');
      afirmar(/Necesitan corrección: 1/.test((await nav.evaluar(textoDe('[data-vd-contadores]'))).replace(/\s+/g, ' ')), 'el contador de correcciones debe subir a 1');
      // V3: desde 1280 px la cola queda visible junto al expediente; por debajo se pliega y se pide con «Mostrar la cola».
      if (await nav.evaluar(`[...document.querySelectorAll('button')].some((b) => (b.offsetWidth || b.offsetHeight) && b.textContent.includes('Mostrar la cola'))`)) await nav.clic('button', 'Mostrar la cola');
      await nav.esperar(`document.querySelectorAll('[data-vd-expediente]').length >= 1`, 10000, 'la cola');
      afirmar(/Necesita corrección/.test(await nav.evaluar(textoDe('[data-vd-expediente]'))), 'la cola también debe reflejar el cambio');
      await captura(nav, 'camara-devuelta');
    });
    const eDev = await expedienteApi(coord.accessToken);
    await paso('el estado interno de cada motor no cambió: la Cámara quedó «devuelto» en su motor y EPS sigue tomada', async () => {
      afirmar(docApi(eDev, 'camara_comercio').estadoInterno === 'devuelto' && docApi(eDev, 'camara_comercio').estadoHumano === 'necesita_correccion', JSON.stringify(docApi(eDev, 'camara_comercio')));
      afirmar(docApi(eDev, 'certificado_eps').reserva.estado === 'mia' && docApi(eDev, 'rut_juridico').reserva.estado === 'otro', 'reservas por documento');
    });

    // ── 3 · El expediente tradicional ya no ofrece decisiones generales para los motores ──
    console.log('\nExpediente tradicional (hueco del RUT)');
    await paso('el expediente tradicional NO ofrece Aprobar/Devolver/Rechazar para EPS, acta, RUT ni Cámara; sí para el documento general', async () => {
      await nav.sembrarSesion(coord);
      await nav.ir(`${WEB}/practicas/${PRACTICA}`);
      await nav.esperar(`document.querySelectorAll('.doc').length > 5`, 30000, 'el expediente tradicional');
      const info = await nav.evaluar(`(() => {
        const bloques = [...document.querySelectorAll('.doc')];
        const conBoton = bloques.filter((b) => [...b.querySelectorAll('button')].some((x) => /^Aprobar$/.test(x.textContent.trim())));
        return { botones: conBoton.map((b) => b.innerText.split('\\n')[0]), notas: document.querySelectorAll('[data-motor-mesa]').length, acta: !!document.querySelector('[data-acta-mesa]'), camara: !!document.querySelector('[data-camara-mesa]') };
      })()`);
      afirmar(info.botones.length === 1 && /Soporte|aceptaci/i.test(info.botones[0]), `solo el general debe ofrecer decidir: ${JSON.stringify(info)}`);
      afirmar(info.notas >= 2 && info.camara, `deben verse las notas de los motores (EPS, RUT y Cámara; el acta no es obligación de esta modalidad): ${JSON.stringify(info)}`);
      afirmar(await nav.evaluar(`[...document.querySelectorAll('[data-motor-mesa] a')].every((a) => a.getAttribute('href').includes('/validacion-documental/'))`), 'las notas enlazan a la Mesa de Validación Documental');
    });

    // ── 4 · Devolución → reenvío → nueva versión vigente ───────────────────────
    console.log('\nDevolución, reenvío y versiones');
    await paso('el estudiante ve «Necesita corrección», reenvía y la nueva versión queda vigente (la anterior, histórica)', async () => {
      await cargarPorApi(est, 'camara_comercio', manifiesto.archivos['camara-ok']);
      const e = await esperarExpediente(coord.accessToken, (x) => docApi(x, 'camara_comercio').version === 2 && docApi(x, 'camara_comercio').estadoHumano !== 'procesando', 90000, 'la versión 2 de la Cámara');
      const c = docApi(e, 'camara_comercio');
      afirmar(c.estadoHumano === 'disponible_para_revision' && c.esReenvio === true && c.versionesAnteriores === 1, JSON.stringify(c));
      const vs = (await api(`/validacion-documental/${PRACTICA}/documentos/camara_comercio/versiones`, { token: coord.accessToken })).json;
      afirmar(vs.length === 2 && vs[0].vigente && vs[0].version === 2 && !vs[1].vigente && vs[1].estadoHumano === 'necesita_correccion', JSON.stringify(vs));
    });
    await paso('la versión vigente se muestra en la Mesa; el histórico se abre bajo demanda', async () => {
      await abrirExpediente(nav, coord, { doc: 'camara_comercio' });
      await nav.esperar(`!!document.querySelector('sipra-vd-camara sipra-camara-detalle h2')`, 30000, 'el detalle de la Cámara');
      const fila = await nav.evaluar(chipDoc('camara_comercio'));
      afirmar(/versión 2/.test(fila) && /Disponible para revisión/.test(fila), `fila: ${fila}`);
      afirmar(!(await nav.evaluar(textoDe('[data-vd-versiones]'))).includes('histórica'), 'el histórico no debe cargarse hasta pedirlo');
      await nav.clic('[data-vd-versiones] button', 'Ver versiones anteriores');
      await nav.esperar(`/histórica/.test(document.querySelector('[data-vd-versiones]').innerText)`, 15000, 'el histórico');
      const h = await nav.evaluar(textoDe('[data-vd-versiones]'));
      afirmar(/Versión 2 \(vigente\)/.test(h) && /Versión 1 \(histórica\)/.test(h) && /Necesita corrección/.test(h), `histórico: ${h}`);
    });
    await paso('aprueba la nueva versión (consistente: sin justificación larga) y el progreso sube a «1 / N aprobados» sin recargar', async () => {
      await nav.evaluar(`window.__vd = 'misma-pagina-2'`);
      await nav.clic('sipra-vd-camara button', 'Tomar el caso');
      await nav.esperar(`/Tomado por usted/.test(${chipDoc('camara_comercio')})`, 20000, 'Cámara tomada');
      await decidirCamara(nav, { boton: 'Aprobar', accion: async () => { await nav.clic('dialog[open] button', 'Aprobar certificado'); } });
      await nav.esperar(`/Aprobado/.test(${chipDoc('camara_comercio')})`, 20000, 'Cámara aprobada en la lista');
      await nav.esperar(`/^1 \\/ \\d+ aprobados/.test(document.querySelector('[data-vd-progreso]').innerText.trim())`, 10000, 'progreso actualizado');
      afirmar(await nav.evaluar(`window.__vd === 'misma-pagina-2'`), 'no debe recargarse la aplicación');
      afirmar(/Requieren revisión: \d+/.test((await nav.evaluar(textoDe('[data-vd-contadores]')))), 'contadores visibles');
      await captura(nav, 'camara-aprobada');
    });

    // ── 5 · Permisos en pantalla ───────────────────────────────────────────────
    console.log('\nPermisos en pantalla');
    await paso('el auxiliar abre el expediente: opera EPS pero RUT y Cámara muestran solo estado y un aviso, sin acciones', async () => {
      await abrirExpediente(nav, aux, { doc: 'rut_juridico', minimo: 3 });
      await nav.esperar(`!!document.querySelector('[data-vd-sin-permiso]')`, 20000, 'el aviso de permiso del RUT');
      afirmar(!(await nav.evaluar(`!!document.querySelector('sipra-vd-rut')`)), 'no debe incrustar el motor que no opera');
      afirmar(/su perfil no lo opera/.test(await nav.evaluar(textoDe('[data-vd-sin-permiso]'))), 'falta el aviso');
      await nav.clic('[data-vd-doc]', 'Certificado de afiliación a EPS');
      await nav.esperar(`!!document.querySelector('sipra-vd-eps sipra-eps-detalle h2')`, 30000, 'EPS para el auxiliar');
      afirmar(!(await nav.evaluar(`[...document.querySelectorAll('[data-vd-doc]')].some((d) => /Soporte de aceptación/.test(d.innerText))`)), 'el auxiliar no debe ver documentos fuera de su proceso');
    });
    await paso('el docente: EPS solo informativa (sin acciones) y el documento general se decide desde la Mesa con el flujo general', async () => {
      await abrirExpediente(nav, tutor, { doc: 'certificado_eps' });
      await nav.esperar(`!!document.querySelector('[data-vd-sin-permiso]')`, 20000, 'aviso de EPS');
      afirmar(!(await nav.evaluar(`!!document.querySelector('sipra-vd-eps')`)), 'el docente no opera EPS');
      await nav.clic('[data-vd-doc]', 'Soporte de aceptación');
      await nav.esperar(`!!document.querySelector('[data-vd-general]')`, 20000, 'el documento general');
      afirmar(!(await nav.evaluar(`!!document.querySelector('sipra-vd-eps, sipra-vd-rut, sipra-vd-camara, sipra-vd-acta')`)), 'el general no usa ningún motor');
      await nav.escribir('#vd-gen-just', 'Soporte revisado y conforme al formato.');
      await nav.esperar(`![...document.querySelectorAll('[data-vd-general] button')].find((b) => b.textContent.trim() === 'Aprobar').disabled`, 5000, 'botón Aprobar');
      await nav.clic('[data-vd-general] button', 'Aprobar');
      await nav.esperar(`/Aprobado/.test(${chipDoc('soporte_aceptacion_cunbre')})`, 20000, 'general aprobado en la lista');
      afirmar(await nav.evaluar(`/^2 \\/ \\d+ aprobados/.test(document.querySelector('[data-vd-progreso]').innerText.trim())`), 'el progreso debe subir a 2');
    });

    // ── 6 · Supervisión ────────────────────────────────────────────────────────
    console.log('\nSupervisión');
    await paso('coordinación ve la vista agregada (reservas, carga por funcionario, aprobados hoy) y abre un expediente desde ahí', async () => {
      await abrirMesa(nav, coord);
      await nav.clic('button', 'Supervisión');
      await nav.esperar(`!!document.querySelector('[data-vd-supervision] .cifra')`, 20000, 'la supervisión');
      const t = await nav.evaluar(textoDe('[data-vd-supervision]'));
      for (const n of ['Expedientes abiertos', 'Documentos por revisar', 'Aprobados hoy', 'Devueltos', 'Rechazados', 'Reservas activas', 'Reservas por vencer', 'Reservas vencidas', 'Carga por funcionario']) afirmar(t.includes(n), `falta «${n}»`);
      const s = (await api('/validacion-documental/supervision', { token: coord.accessToken })).json;
      afirmar(s.aprobadosHoy >= 2 && s.reservasActivas >= 2 && s.funcionarios.some((f) => /Hern/.test(f.nombre)), JSON.stringify({ a: s.aprobadosHoy, r: s.reservasActivas }));
      await nav.clic('[data-vd-supervision] button.enlace', 'Estudiante Prueba');
      await nav.esperar(`document.querySelectorAll('[data-vd-doc]').length > 5`, 30000, 'el expediente abierto desde la supervisión');
    });

    // ── 7 · Responsive y accesibilidad ─────────────────────────────────────────
    for (const [ancho, alto, etiqueta] of [[1920, 1080, '1920'], [1440, 900, '1440'], [1366, 768, '1366'], [1024, 768, '1024'], [768, 1024, '768'], [390, 844, 'móvil 390']]) {
      console.log(`\nVista ${etiqueta}`);
      await paso(`${etiqueta}: cola con indicadores y filtros etiquetados, sin desborde horizontal`, async () => {
        await abrirMesa(nav, coord, { ancho, alto });
        afirmar(await nav.evaluar(`document.querySelectorAll('.kpi').length >= 5 && document.querySelectorAll('[data-vd-expediente]').length >= 1`), 'faltan indicadores o expedientes');
        afirmar(await nav.evaluar(sinDesborde), `desborde horizontal a ${etiqueta}`);
        const sin = await nav.evaluar(`JSON.stringify(${SIN_ETIQUETA})`);
        afirmar(sin === '[]', `controles sin etiqueta: ${sin}`);
        await captura(nav, `cola-${ancho}`);
      });
      await paso(`${etiqueta}: el expediente con su documento activo se ve sin desborde${ancho < 900 ? '; en móvil: lista → expediente → documento' : ''}`, async () => {
        await nav.ir(`${WEB}/validacion-documental/${PRACTICA}?doc=camara_comercio`);
        await nav.esperar(`document.querySelectorAll('[data-vd-doc]').length > 5`, 30000, 'el expediente');
        if (ancho < 900) {
          afirmar(await nav.evaluar(`!document.querySelector('.p-doc') || getComputedStyle(document.querySelector('.p-doc')).display === 'none'`), 'en móvil primero se ve la lista de documentos');
          await nav.clic('[data-vd-doc]', 'Cámara de Comercio');
          await nav.esperar(`!!document.querySelector('sipra-vd-camara sipra-camara-detalle h2') && getComputedStyle(document.querySelector('.p-doc')).display !== 'none'`, 30000, 'el documento');
          afirmar(await nav.evaluar(`getComputedStyle(document.querySelector('.p-exp')).display === 'none'`), 'en móvil se ve una sola cosa a la vez');
        } else {
          await nav.esperar(`!!document.querySelector('sipra-vd-camara sipra-camara-detalle h2')`, 30000, 'el documento activo');
          afirmar(await nav.evaluar(`getComputedStyle(document.querySelector('.p-exp')).display !== 'none' && getComputedStyle(document.querySelector('.p-doc')).display !== 'none'`), 'deben verse la lista de documentos y el documento');
        }
        afirmar(await nav.evaluar(sinDesborde), `desborde horizontal con el expediente a ${etiqueta}`);
        afirmar(await nav.evaluar(`[...document.querySelectorAll('[data-vd-nav] button')].every((b) => (b.textContent.trim().length > 0))`), 'los botones de navegación deben tener nombre');
        await captura(nav, `expediente-${ancho}`);
      });
    }
    await paso('accesibilidad: lista de documentos con estado en texto + icono, barra de progreso con nombre y foco por teclado', async () => {
      await abrirExpediente(nav, coord, { doc: 'rut_juridico' });
      afirmar(await nav.evaluar(`[...document.querySelectorAll('[data-vd-doc]')].every((d) => /[A-Za-zÁ-ú]{4,}/.test(d.querySelector('.est')?.innerText ?? ''))`), 'cada documento debe decir su estado con palabras');
      afirmar(await nav.evaluar(`!!document.querySelector('[role=progressbar][aria-label]') && document.querySelector('[role=progressbar]').getAttribute('aria-valuemax') > 0`), 'la barra de progreso debe tener nombre y valores');
      await nav.evaluar(`document.querySelector('[data-vd-doc]').focus()`);
      afirmar(await nav.evaluar(`document.activeElement?.hasAttribute('data-vd-doc')`), 'los documentos deben poder enfocarse con el teclado');
    });
    await paso('sin errores de consola/página en todo el recorrido', async () => {
      const malos = nav.erroresPagina.filter((e) => !/favicon|net::ERR_ABORTED|ResizeObserver|Failed to load resource: the server responded with a status of (4\d\d)/.test(e));
      afirmar(malos.length === 0, `errores: ${malos.slice(0, 3).join(' | ')}`);
    });
  } finally {
    await nav.cerrar();
  }

  const fallos = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - fallos.length}/${resultados.length} pasos correctos`);
  if (fallos.length) { console.log('FALLOS:'); for (const f of fallos) console.log(` - ${f.nombre}\n     ${f.error}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
