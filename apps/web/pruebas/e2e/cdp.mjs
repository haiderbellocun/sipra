// Cliente mínimo del protocolo de Chrome (CDP) para las pruebas E2E. No hay Playwright ni
// Puppeteer en el repositorio (y no se agregan dependencias): se lanza el Chrome instalado
// y se le habla por WebSocket (el `WebSocket` global de Node 22+).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUTAS_CHROME = [
  process.env.E2E_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export class Navegador {
  static async abrir() {
    const ruta = RUTAS_CHROME.find((r) => existsSync(r));
    if (!ruta) throw new Error('No se encontró Chrome ni Edge (defina E2E_CHROME).');
    const perfil = mkdtempSync(join(tmpdir(), 'sipra-e2e-chrome-'));
    const proceso = spawn(ruta, [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${perfil}`, '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--disable-extensions', '--hide-scrollbars', '--window-size=1440,900', 'about:blank',
    ], { stdio: 'ignore' });
    const archivoPuerto = join(perfil, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !existsSync(archivoPuerto); i += 1) await dormir(100);
    if (!existsSync(archivoPuerto)) { proceso.kill(); throw new Error('Chrome no abrió el puerto de depuración.'); }
    const puerto = readFileSync(archivoPuerto, 'utf8').split('\n')[0].trim();
    let destinos = [];
    for (let i = 0; i < 50 && destinos.length === 0; i += 1) {
      destinos = (await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json()).filter((d) => d.type === 'page');
      if (destinos.length === 0) await dormir(100);
    }
    const nav = new Navegador(proceso, perfil, destinos[0].webSocketDebuggerUrl);
    await nav.conectar();
    return nav;
  }

  constructor(proceso, perfil, url) {
    this.proceso = proceso; this.perfil = perfil; this.url = url;
    this.siguiente = 1; this.pendientes = new Map(); this.escuchas = new Map();
    this.solicitudes = []; this.erroresPagina = [];
  }

  async conectar() {
    this.ws = new WebSocket(this.url);
    await new Promise((ok, mal) => { this.ws.onopen = ok; this.ws.onerror = () => mal(new Error('No se pudo conectar con Chrome.')); });
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pendientes.has(msg.id)) {
        const { ok, mal } = this.pendientes.get(msg.id);
        this.pendientes.delete(msg.id);
        if (msg.error) mal(new Error(`${msg.error.message}`)); else ok(msg.result);
      } else if (msg.method) {
        for (const f of this.escuchas.get(msg.method) ?? []) f(msg.params);
      }
    };
    this.on('Network.requestWillBeSent', (p) => this.solicitudes.push({ url: p.request.url, metodo: p.request.method, cabeceras: p.request.headers }));
    this.on('Runtime.exceptionThrown', (p) => this.erroresPagina.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'excepción'));
    this.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') this.erroresPagina.push(p.args.map((a) => a.value ?? a.description ?? '').join(' ')); });
    await this.enviar('Page.enable'); await this.enviar('Runtime.enable'); await this.enviar('Network.enable');
  }

  on(metodo, f) { this.escuchas.set(metodo, [...(this.escuchas.get(metodo) ?? []), f]); }
  enviar(metodo, params = {}) {
    const id = this.siguiente++;
    return new Promise((ok, mal) => { this.pendientes.set(id, { ok, mal }); this.ws.send(JSON.stringify({ id, method: metodo, params })); });
  }

  /** Antes de la primera navegación: deja la sesión en localStorage (solo desarrollo local). */
  async sembrarSesion(sesion) {
    await this.enviar('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('sipra.sesion', ${JSON.stringify(JSON.stringify(sesion))});}catch(e){}` });
  }

  async ir(url) {
    this.erroresPagina = [];
    await this.enviar('Page.navigate', { url });
    await this.esperar('document.readyState === "complete"', 30000);
  }

  async vista(ancho, alto) {
    await this.enviar('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: 1, mobile: ancho < 600 });
  }

  async evaluar(expresion) {
    const r = await this.enviar('Runtime.evaluate', { expression: expresion, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`Error al evaluar: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  }

  async esperar(expresion, ms = 15000, descripcion = expresion) {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      try { if (await this.evaluar(expresion)) return true; } catch { /* la página puede estar navegando */ }
      await dormir(150);
    }
    throw new Error(`Tiempo agotado esperando: ${descripcion}`);
  }

  /** Clic al primer elemento visible y habilitado de `selector` cuyo texto contiene `texto`. */
  async clic(selector, texto = '') {
    const ok = await this.evaluar(`(() => {
      const visible = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
      const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => visible(x) && !x.disabled && x.textContent.trim().includes(${JSON.stringify(texto)}));
      if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true;
    })()`);
    if (!ok) throw new Error(`No se encontró «${selector}» con texto «${texto}»`);
  }

  async escribir(selector, valor) {
    await this.evaluar(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.focus(); e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  }

  async archivo(selector, ruta) {
    const { root } = await this.enviar('DOM.getDocument');
    const { nodeId } = await this.enviar('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`No existe ${selector}`);
    await this.enviar('DOM.setFileInputFiles', { files: [ruta], nodeId });
  }

  async captura(ruta) {
    const { data } = await this.enviar('Page.captureScreenshot', { format: 'png' });
    (await import('node:fs')).writeFileSync(ruta, Buffer.from(data, 'base64'));
  }

  async cerrar() {
    try { this.ws.close(); } catch { /* ya cerrado */ }
    this.proceso.kill();
    await dormir(400);
    try { rmSync(this.perfil, { recursive: true, force: true }); } catch { /* Windows retiene el perfil un momento */ }
  }
}
