// E2E local de la Mesa de EPS en un navegador real (Chrome instalado, por CDP).
//
// Requisitos (todo local y desechable; no toca ADRES ni Internet):
//   · API en dev (AUTH_MODO=abierto) contra una base con las semillas sintéticas.
//   · Frontend servido (ng serve) con proxy al API.
//   · Variables: E2E_API (por defecto http://localhost:3000/api/v1), E2E_WEB (http://localhost:4201),
//     E2E_CAPTURAS (carpeta opcional para guardar capturas).
// Uso: node pruebas/e2e/mesa-eps.e2e.mjs
//
// Los certificados y resultados de ADRES son PDF sintéticos generados aquí; el salto al
// portal de ADRES NO se ejecuta: solo se comprueba que el enlace apunta al sitio oficial.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Navegador } from './cdp.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3000/api/v1';
const WEB = process.env.E2E_WEB ?? 'http://localhost:4201';
const CAPTURAS = process.env.E2E_CAPTURAS;
const PDFDocument = createRequire(import.meta.url)('pdfkit');

const resultados = [];
const paso = async (nombre, f) => {
  try { await f(); resultados.push({ nombre, ok: true }); console.log(`  ✔ ${nombre}`); }
  catch (e) { resultados.push({ nombre, ok: false, error: e.message }); console.log(`  ✘ ${nombre}\n      ${e.message}`); }
};
const afirmar = (cond, mensaje) => { if (!cond) throw new Error(mensaje); };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Datos sintéticos ────────────────────────────────────────────────────────

function pdf(lineas) {
  return new Promise((ok) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const partes = [];
    doc.on('data', (c) => partes.push(c));
    doc.on('end', () => ok(Buffer.concat(partes)));
    for (const l of lineas) { doc.fontSize(13).text(l); doc.moveDown(0.4); }
    doc.end();
  });
}
const hoy = new Date();
const fecha = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const certificado = (nombre, documento) => pdf([
  'Entidad Promotora de Salud NUEVA EPS S.A.', 'CERTIFICADO DE AFILIACION', `Nombre: ${nombre}`, `Documento: CC ${documento}`,
  'Régimen: Contributivo - Beneficiario', 'Estado: ACTIVO', `Fecha de expedición: ${fecha(hoy)}`,
]);
const resultadoAdres = (nombres, apellidos, numero) => pdf([
  'ADRES - Administradora de los Recursos del Sistema General de Seguridad Social en Salud', 'Consulta de afiliados a la BDUA',
  'Tipo de documento: CC', `Número de documento: ${numero}`, `Nombres: ${nombres}`, `Apellidos: ${apellidos}`, 'Entidad: NUEVA EPS S.A.',
  'Régimen: CONTRIBUTIVO', 'Estado de afiliación: ACTIVO', 'Fecha de afiliación: 05/02/2024', `Fecha de consulta: ${fecha(hoy)}`, 'Fecha de corte: 30/09/2026',
]);

const ESTUDIANTES = [
  { correo: 'laura.ramirez@estudiante.cun.edu.co', practica: '00000000-0000-4000-8000-000000000041', nombre: 'LAURA SOFIA RAMIREZ ORTIZ', doc: '1032456786', mostrado: 'Laura Sofía Ramírez Ortiz' },
  { correo: 'andres.mora@estudiante.cun.edu.co', practica: '00000000-0000-4000-8000-000000000042', nombre: 'ANDRES FELIPE MORA CASTANO', doc: '1019887000', mostrado: 'Andrés Felipe Mora Castaño' }, // documento distinto al de SIPRA → discrepancia crítica
  { correo: 'valentina.ochoa@estudiante.cun.edu.co', practica: '00000000-0000-4000-8000-000000000043', nombre: 'VALENTINA OCHOA RUIZ', doc: '1023445561', mostrado: 'Valentina Ochoa Ruiz' },
];

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

async function prepararCasos() {
  for (const e of ESTUDIANTES) {
    const s = await ingresar('estudiante', e.correo);
    const f = new FormData();
    f.append('tipo', 'certificado_eps');
    f.append('archivo', new Blob([await certificado(e.nombre, e.doc)], { type: 'application/pdf' }), 'certificado-eps.pdf');
    const r = await api(`/documentos/practica/${e.practica}`, { token: s.accessToken, metodo: 'POST', formulario: f });
    if (r.estado >= 300) throw new Error(`No se pudo cargar el certificado de ${e.mostrado}: ${r.estado} ${JSON.stringify(r.json)}`);
  }
}

// ── Utilidades de pantalla ──────────────────────────────────────────────────

const sinDesborde = `document.documentElement.scrollWidth <= window.innerWidth + 1`;
const textoPagina = `document.body.innerText`;

async function abrirMesa(nav, sesion, ancho = 1440, alto = 900) {
  await nav.sembrarSesion(sesion);
  await nav.vista(ancho, alto);
  await nav.ir(`${WEB}/eps`);
  await nav.esperar(`document.querySelector('h1')?.textContent.includes('Mesa de validación de EPS')`, 30000, 'título de la Mesa');
  await nav.esperar(`!document.body.innerText.includes('Cargando los casos')`, 20000, 'fin de la carga');
}

async function main() {
  const carpeta = mkdtempSync(join(tmpdir(), 'sipra-e2e-'));
  if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });
  const aux = await ingresar('auxiliar');
  const coord = await ingresar('coordinador');
  const tutor = await ingresar('tutor');
  const estu = await ingresar('estudiante', ESTUDIANTES[0].correo);

  console.log('\nPreparación (API): se cargan 3 certificados sintéticos');
  await prepararCasos();
  let filas = [];
  for (let i = 0; i < 60 && filas.length < 3; i += 1) { await dormir(500); filas = (await api('/mesa-eps', { token: aux.accessToken })).json?.filas ?? []; }
  afirmar(filas.length >= 3, `La Mesa solo tiene ${filas.length} casos tras esperar el procesamiento`);

  const nav = await Navegador.abrir();
  try {
    // ── Responsive: 1440, 1366, 1024 y móvil ────────────────────────────────
    for (const [ancho, alto, etiqueta] of [[1440, 900, '1440'], [1366, 768, '1366'], [1024, 768, '1024'], [390, 844, 'móvil 390']]) {
      console.log(`\nVista ${etiqueta}`);
      await paso(`${etiqueta}: carga la Mesa con KPIs, filtros y lista sin desborde horizontal`, async () => {
        await abrirMesa(nav, aux, ancho, alto);
        afirmar(await nav.evaluar(`document.querySelectorAll('.kpi').length >= 6`), 'faltan los KPIs');
        afirmar(await nav.evaluar(`!!document.querySelector('form[role=search] #f-buscar')`), 'falta la búsqueda');
        afirmar(await nav.evaluar(`document.querySelectorAll('.caso').length >= 3`), 'la lista no muestra los casos');
        afirmar(await nav.evaluar(sinDesborde), `hay desborde horizontal (scrollWidth ${await nav.evaluar('document.documentElement.scrollWidth')} > ${ancho})`);
        if (CAPTURAS) await nav.captura(join(CAPTURAS, `mesa-${etiqueta.replace(' ', '-')}-lista.png`));
      });
      await paso(`${etiqueta}: abrir un caso muestra el detalle${ancho < 1024 ? ' y oculta la lista (lista → detalle)' : ' junto a la lista'}`, async () => {
        await nav.clic('.caso', 'Laura');
        await nav.esperar(`document.querySelector('sipra-eps-detalle h2')?.textContent.includes('Laura')`, 15000, 'detalle del caso');
        if (ancho < 1024) {
          afirmar(await nav.evaluar(`getComputedStyle(document.querySelector('.lista-col')).display === 'none'`), 'la lista debería ocultarse en pantallas angostas');
          afirmar(await nav.evaluar(`[...document.querySelectorAll('.atras')].some((b) => b.offsetWidth > 0)`), 'falta el botón «Volver a la lista»');
        } else {
          afirmar(await nav.evaluar(`document.querySelector('.lista-col').offsetWidth > 0`), 'la lista debería seguir visible');
        }
        afirmar(await nav.evaluar(sinDesborde), 'desborde horizontal en el detalle');
        if (CAPTURAS) await nav.captura(join(CAPTURAS, `mesa-${etiqueta.replace(' ', '-')}-detalle.png`));
        if (ancho < 1024) {
          await nav.clic('.atras', 'Volver');
          await nav.esperar(`getComputedStyle(document.querySelector('.lista-col')).display !== 'none'`, 5000, 'regreso a la lista');
        }
      });
    }

    // ── Flujo completo en 1440 ──────────────────────────────────────────────
    console.log('\nFlujo del funcionario (1440)');
    await abrirMesa(nav, aux);
    const laura = filas.find((f) => f.estudiante.nombre.startsWith('Laura'));
    afirmar(!!laura, 'no está el caso de Laura en la Mesa');

    await paso('sin tomar el caso: datos personales ocultos, certificado cerrado y decisiones inactivas', async () => {
      await nav.clic('.caso', 'Laura');
      await nav.esperar(`document.querySelector('sipra-eps-detalle h2')?.textContent.includes('Laura')`);
      const t = await nav.evaluar(textoPagina);
      afirmar(t.includes('Los datos personales se muestran cuando usted tiene el caso tomado'), 'debería ocultar los datos personales');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('.decisiones button')].every((b) => b.disabled)`), 'las decisiones deberían estar inactivas');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('sipra-eps-visor button')].some((b) => b.textContent.includes('Abrir') && b.disabled)`), 'abrir el certificado debería estar inactivo');
    });

    await paso('tomar el caso: queda "Tomado por usted" y se habilita el certificado', async () => {
      await nav.clic('sipra-eps-detalle button', 'Tomar el caso');
      await nav.esperar(`document.querySelector('sipra-eps-detalle')?.innerText.includes('Tomado por usted')`, 15000, 'reserva propia');
      afirmar(await nav.evaluar(`[...document.querySelectorAll('sipra-eps-visor button')].some((b) => b.textContent.includes('Abrir') && !b.disabled)`), 'abrir el certificado debería habilitarse');
    });

    await paso('el visor abre el certificado como blob local, con sesión autenticada y sin credenciales en la URL', async () => {
      nav.solicitudes.length = 0;
      await nav.clic('sipra-eps-visor button', 'Abrir el certificado');
      await nav.esperar(`document.querySelector('sipra-eps-visor iframe')?.src.startsWith('blob:')`, 20000, 'iframe del PDF');
      const pedido = nav.solicitudes.find((s) => /\/mesa-eps\/[^/]+\/certificado/.test(s.url));
      afirmar(!!pedido, 'no se pidió el certificado a la API');
      afirmar(!/token|access|firma|signature|sig=/i.test(pedido.url), `la URL del certificado lleva credenciales: ${pedido.url}`);
      afirmar(/^Bearer /.test(pedido.cabeceras.Authorization ?? pedido.cabeceras.authorization ?? ''), 'el certificado debe pedirse con la cabecera Authorization');
      const src = await nav.evaluar(`document.querySelector('sipra-eps-visor iframe').src`);
      afirmar(!/token|access/i.test(src), 'el iframe no debe llevar credenciales');
      if (CAPTURAS) await nav.captura(join(CAPTURAS, 'mesa-1440-visor.png'));
    });

    await paso('muestra datos extraídos con su fuente, comparación, discrepancias y la recomendación como ayuda', async () => {
      const t = await nav.evaluar(textoPagina);
      afirmar(t.includes('Datos extraídos del certificado'), 'falta el panel de datos extraídos');
      afirmar(/Texto del PDF|OCR|QR/.test(t), 'los campos deben indicar su fuente');
      afirmar(t.includes('Comparación SIPRA'), 'falta la comparación triple');
      afirmar(t.includes('Discrepancias'), 'falta el panel de discrepancias');
      afirmar(/RECOMENDACIÓN DEL SISTEMA/i.test(t), 'falta la recomendación del sistema');
      afirmar(t.includes('no es una decisión'), 'la recomendación debe aclararse como ayuda');
      afirmar(t.includes('POLÍTICA DE RETENCIÓN EPS PENDIENTE DE DEFINICIÓN INSTITUCIONAL'), 'falta el aviso de retención');
      afirmar(t.includes('1032456786') || t.includes('1.032.456.786'), 'con el caso tomado debería verse el documento');
    });

    await paso('consultar ADRES: prepara la consulta, enlaza al portal oficial (sin abrirlo) y carga el PDF', async () => {
      await nav.clic('sipra-eps-adres button', 'Consultar ADRES');
      await nav.esperar(`!!document.querySelector('sipra-eps-adres #a-tipo, sipra-eps-adres .consulta a[href]')`, 15000, 'consulta preparada o tipo de documento');
      // SIPRA no deduce el tipo de documento del número: si no lo conoce, la persona lo confirma.
      if (await nav.evaluar(`!!document.querySelector('sipra-eps-adres #a-tipo')`)) {
        await nav.evaluar(`(() => { const s = document.querySelector('#a-tipo'); s.value = 'CC'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        await nav.clic('sipra-eps-adres button', 'Confirmar y preparar');
      }
      await nav.esperar(`!!document.querySelector('sipra-eps-adres .consulta a[href]')`, 15000, 'consulta preparada');
      const href = await nav.evaluar(`document.querySelector('sipra-eps-adres .consulta a[href]').href`);
      afirmar(/^https:\/\/([a-z0-9-]+\.)*adres\.gov\.co\//.test(href), `el enlace no apunta al portal oficial: ${href}`);
      afirmar(!nav.solicitudes.some((s) => /adres\.gov\.co/.test(s.url)), 'la pantalla no debe llamar a ADRES');
      const ruta = join(carpeta, 'adres-laura.pdf');
      writeFileSync(ruta, await resultadoAdres('LAURA SOFIA', 'RAMIREZ ORTIZ', ESTUDIANTES[0].doc));
      await nav.archivo('#a-arch', ruta);
      await nav.esperar(`!document.querySelector('sipra-eps-adres .consulta button[disabled]') || [...document.querySelectorAll('sipra-eps-adres .consulta button')].some((b) => b.textContent.includes('Cargar') && !b.disabled)`, 5000);
      await nav.clic('sipra-eps-adres .consulta button', 'Cargar y procesar');
      await nav.esperar(`/ADRES \\(BDUA\\)/.test(document.body.innerText) && /Procesado/.test(document.body.innerText)`, 30000, 'resultado de ADRES procesado');
      afirmar(!nav.solicitudes.some((s) => /adres\.gov\.co/.test(s.url)), 'SIPRA no debe llamar a ADRES');
    });

    await paso('la comparación triple muestra los tres valores con icono y texto por campo', async () => {
      const filasComparacion = await nav.evaluar(`[...document.querySelectorAll('sipra-eps-comparacion tbody tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' ').trim())`);
      afirmar(filasComparacion.length >= 4, `la comparación tiene ${filasComparacion.length} filas`);
      afirmar(filasComparacion.every((f) => /Coincide|Diferente|Sin información/.test(f)), 'cada fila debe decir su resultado con texto');
      afirmar(filasComparacion.some((f) => /Coincide/.test(f)), 'debería coincidir al menos un campo');
      if (CAPTURAS) await nav.captura(join(CAPTURAS, 'mesa-1440-comparacion.png'));
    });

    await paso('aprobar: el diálogo resume el caso, la decisión se registra y el caso sale de la bandeja', async () => {
      await nav.clic('.decisiones button', 'Aprobar');
      await nav.esperar(`!!document.querySelector('dialog[open]')`, 5000, 'diálogo de decisión');
      const d = await nav.evaluar(`document.querySelector('dialog[open]').innerText`);
      afirmar(/Autenticidad/i.test(d) && /Afiliación/i.test(d) && /Recomendación del sistema/i.test(d), 'el diálogo debe resumir autenticidad, afiliación y recomendación');
      await nav.clic('dialog[open] .pie button', 'Aprobar');
      await nav.esperar(`/Certificado aprobado/.test(document.body.innerText)`, 15000, 'aviso de éxito');
      const detalle = (await api(`/mesa-eps/${laura.validacionId}`, { token: aux.accessToken })).json;
      afirmar(detalle?.caso?.decision === 'aprobado_manual', `la decisión registrada es «${detalle?.caso?.decision}»`);
      await nav.esperar(`![...document.querySelectorAll('.caso')].some((c) => c.textContent.includes('Laura'))`, 15000, 'salida de la bandeja');
    });

    // ── Diálogo de decisión: justificación reforzada y motivos ─────────────
    await paso('devolver exige motivo; rechazar exige justificación (el servidor revalida)', async () => {
      await nav.clic('.caso', 'Andrés');
      await nav.esperar(`document.querySelector('sipra-eps-detalle h2')?.textContent.includes('Andrés')`);
      await nav.clic('sipra-eps-detalle button', 'Tomar el caso');
      await nav.esperar(`document.querySelector('sipra-eps-detalle')?.innerText.includes('Tomado por usted')`, 15000);
      await nav.clic('.decisiones button', 'Devolver');
      await nav.esperar(`!!document.querySelector('dialog[open] #eps-motivo')`, 5000, 'motivo de devolución');
      await nav.clic('dialog[open] .pie button', 'Devolver');
      await nav.esperar(`/Elija el motivo/.test(document.querySelector('dialog[open]')?.innerText ?? '')`, 5000, 'validación del motivo');
      await nav.clic('dialog[open] .pie button', 'Cancelar');
      await nav.clic('.decisiones button', 'Rechazar');
      await nav.esperar(`!!document.querySelector('dialog[open] #eps-just')`, 5000);
      await nav.clic('dialog[open] .pie button', 'Rechazar');
      await nav.esperar(`/al menos \\d+ caracteres/.test(document.querySelector('dialog[open]')?.innerText ?? '')`, 5000, 'validación de justificación');
      await nav.clic('dialog[open] .pie button', 'Cancelar');
    });

    await paso('aprobar con discrepancia crítica exige justificación reforzada (40 caracteres)', async () => {
      const t = await nav.evaluar(textoPagina);
      afirmar(/Crítica/.test(t), 'el caso de Andrés debería mostrar una discrepancia crítica (documento distinto)');
      await nav.clic('.decisiones button', 'Aprobar');
      await nav.esperar(`!!document.querySelector('dialog[open]')`, 5000);
      const d = await nav.evaluar(`document.querySelector('dialog[open]').innerText`);
      afirmar(/Se aparta de la recomendación del sistema/.test(d) && /40/.test(d), 'debe pedir justificación reforzada de 40 caracteres');
      await nav.escribir('dialog[open] #eps-just', 'Corta');
      await nav.clic('dialog[open] .pie button', 'Aprobar');
      await nav.esperar(`/al menos 40 caracteres/.test(document.querySelector('dialog[open]')?.innerText ?? '')`, 5000, 'rechazo del cliente');
      await nav.clic('dialog[open] .pie button', 'Cancelar');
    });

    await paso('devolver con motivo del catálogo: queda registrado', async () => {
      await nav.clic('.decisiones button', 'Devolver');
      await nav.esperar(`!!document.querySelector('dialog[open] #eps-motivo')`, 5000);
      await nav.evaluar(`(() => { const s = document.querySelector('#eps-motivo'); s.value = 'datos_no_coinciden'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await nav.clic('dialog[open] .pie button', 'Devolver');
      await nav.esperar(`/devuelto al estudiante/.test(document.body.innerText)`, 15000, 'aviso de devolución');
      const f = filas.find((x) => x.estudiante.nombre.startsWith('Andrés'));
      const detalle = (await api(`/mesa-eps/${f.validacionId}`, { token: aux.accessToken })).json;
      afirmar(detalle?.caso?.decision === 'devuelto', `la decisión registrada es «${detalle?.caso?.decision}»`);
    });

    // ── Tomar siguiente (atómico) ───────────────────────────────────────────
    console.log('\nTomar siguiente y permisos');
    await paso('tomar siguiente: asigna el caso restante y luego avisa que no hay más', async () => {
      await abrirMesa(nav, aux);
      await nav.clic('button', 'Tomar siguiente');
      await nav.esperar(`document.querySelector('sipra-eps-detalle')?.innerText.includes('Tomado por usted') && document.querySelector('sipra-eps-detalle h2')?.textContent.includes('Valentina')`, 20000, 'caso asignado');
      await nav.clic('button', 'Tomar siguiente');
      await nav.esperar(`/No hay casos disponibles/.test(document.body.innerText)`, 15000, 'mensaje de sin casos');
    });

    await paso('el funcionario no ve la supervisión; coordinación sí', async () => {
      afirmar(!(await nav.evaluar(`!!document.querySelector('.sup')`)), 'el auxiliar no debería ver la supervisión');
      const nav2 = await Navegador.abrir();
      try {
        await abrirMesa(nav2, coord);
        await nav2.esperar(`!!document.querySelector('.sup')`, 15000, 'panel de supervisión');
        await nav2.esperar(`!!document.querySelector('.sup table')`, 15000, 'tabla de supervisión');
        // El caso que tiene el auxiliar aparece como reserva ajena para coordinación.
        await nav2.clic('.caso', 'Valentina');
        await nav2.esperar(`document.body.innerText.includes('Tomado por otra persona')`, 15000, 'reserva ajena');
        afirmar(await nav2.evaluar(`[...document.querySelectorAll('.decisiones button')].every((b) => b.disabled)`), 'coordinación no puede decidir un caso reservado por otra persona');
      } finally { await nav2.cerrar(); }
    });

    await paso('estudiante y tutor no entran a la Mesa (pantalla y API)', async () => {
      const nav3 = await Navegador.abrir();
      try {
        await nav3.sembrarSesion(estu);
        await nav3.ir(`${WEB}/eps`);
        await dormir(1500);
        afirmar(!(await nav3.evaluar(`location.pathname.startsWith('/eps')`)), 'el estudiante no debería quedarse en /eps');
      } finally { await nav3.cerrar(); }
      for (const [nombre, s] of [['estudiante', estu], ['tutor', tutor]]) {
        for (const ruta of ['/mesa-eps', '/mesa-eps/supervision']) {
          const r = await api(ruta, { token: s.accessToken });
          afirmar(r.estado === 403, `${nombre} ${ruta} respondió ${r.estado}, se esperaba 403`);
        }
        const r = await api('/mesa-eps/siguiente', { token: s.accessToken, metodo: 'POST', cuerpo: {} });
        afirmar(r.estado === 403, `${nombre} POST /mesa-eps/siguiente respondió ${r.estado}`);
      }
      const sin = await api('/mesa-eps');
      afirmar(sin.estado === 401, `sin sesión respondió ${sin.estado}`);
    });

    await paso('sin errores de consola ni excepciones en la página', async () => {
      await abrirMesa(nav, aux);
      await dormir(500);
      afirmar(nav.erroresPagina.length === 0, `errores en la página: ${nav.erroresPagina.slice(0, 3).join(' | ')}`);
    });

    await paso('accesibilidad básica: botones y campos con nombre accesible', async () => {
      const sinNombre = await nav.evaluar(`[...document.querySelectorAll('button, a[href]')].filter((e) => !(e.textContent.trim() || e.getAttribute('aria-label') || e.getAttribute('title'))).length`);
      afirmar(sinNombre === 0, `${sinNombre} botones o enlaces sin nombre accesible`);
      const sinEtiqueta = await nav.evaluar(`[...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter((e) => !(e.labels?.length || e.getAttribute('aria-label') || e.getAttribute('aria-labelledby'))).length`);
      afirmar(sinEtiqueta === 0, `${sinEtiqueta} campos sin etiqueta`);
    });
  } finally {
    await nav.cerrar();
    rmSync(carpeta, { recursive: true, force: true });
  }

  const fallos = resultados.filter((r) => !r.ok);
  console.log(`\nE2E de la Mesa de EPS: ${resultados.length - fallos.length} de ${resultados.length} pasos correctos`);
  process.exitCode = fallos.length === 0 ? 0 : 1;
}

main().catch((e) => { console.error(`\nE2E abortado: ${e.message}`); process.exitCode = 1; });
