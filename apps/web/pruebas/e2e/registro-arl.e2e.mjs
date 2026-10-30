// E2E local del registro de práctica: «¿Quién asume la ARL?» (Chrome real, por CDP). Mismos requisitos que mesa-actas.e2e.mjs
// (API en dev contra una base desechable con semillas, y ng serve con proxy). Solo lee: no registra ninguna práctica.
// Uso: E2E_API=… E2E_WEB=… node pruebas/e2e/registro-arl.e2e.mjs
import { Navegador } from './cdp.mjs';

const API = process.env.E2E_API ?? 'http://localhost:3000/api/v1';
const WEB = process.env.E2E_WEB ?? 'http://localhost:4201';
const resultados = [];
const paso = async (nombre, f) => {
  try { await f(); resultados.push(true); console.log(`  ✔ ${nombre}`); } catch (e) { resultados.push(false); console.log(`  ✘ ${nombre}\n      ${e.message}`); }
};
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const sesion = await (await fetch(`${API}/auth/ingresar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rol: 'estudiante', correo: 'valentina.ochoa@estudiante.cun.edu.co' }) })).json();

const elegirModalidad = (nav, valor) => nav.evaluar(`(() => { const s = document.querySelector('#r-modalidad'); s.value = ${JSON.stringify(valor)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const marcado = (nav) => nav.evaluar(`[...document.querySelectorAll('input[name=responsableArl]')].filter((r) => r.checked).map((r) => r.value)`);
const ayuda = (nav) => nav.evaluar(`document.querySelector('#r-arl-ayuda')?.innerText ?? ''`);

const nav = await Navegador.abrir();
try {
  await nav.enviar('Emulation.setFocusEmulationEnabled', { enabled: true });
  await nav.sembrarSesion(sesion);
  await nav.vista(1440, 900);
  await nav.ir(`${WEB}/registro`);
  await nav.esperar(`!!document.querySelector('#r-modalidad') && document.querySelectorAll('#r-modalidad option').length > 1`, 30000, 'el formulario de registro');
  const modalidades = await nav.evaluar(`[...document.querySelectorAll('#r-modalidad option')].map((o) => o.value).filter(Boolean)`);

  await paso('el grupo es un fieldset con legend y dos radios con etiqueta, y empieza sin ninguna opción marcada', async () => {
    afirmar(await nav.evaluar(`!!document.querySelector('fieldset legend') && [...document.querySelectorAll('fieldset legend')].some((l) => l.innerText.includes('¿Quién asume la ARL?'))`), 'falta fieldset/legend');
    afirmar(await nav.evaluar(`[...document.querySelectorAll('input[name=responsableArl]')].every((r) => r.labels.length === 1)`), 'cada radio debe tener su etiqueta');
    afirmar((await marcado(nav)).length === 0, 'no debe haber nada marcado');
  });
  await paso('al elegir una modalidad con sugerencia: se muestra la sugerencia y NO se marca nada', async () => {
    let visto = null;
    for (const m of modalidades) {
      await elegirModalidad(nav, m);
      await nav.esperar(`document.querySelector('#r-modalidad').value === ${JSON.stringify(m)}`, 3000, 'modalidad');
      const t = await ayuda(nav);
      if (/Sugerencia según la modalidad: (Empresa|CUN)\./.test(t)) { visto = { m, t }; break; }
    }
    afirmar(visto, 'ninguna modalidad del catálogo trae sugerencia');
    afirmar(/La modalidad sugiere esta opción, pero confirma quién asume la ARL en esta práctica\./.test(visto.t), `ayuda: ${visto.t}`);
    afirmar((await marcado(nav)).length === 0, 'la modalidad no debe marcar ninguna opción');
    afirmar(await nav.evaluar(`[...document.querySelectorAll('button[type=submit]')].every((b) => b.disabled)`), 'el formulario no debe poder enviarse sin elegir');
    afirmar(/¿Quién asume la ARL\?/.test(await nav.evaluar(`document.querySelector('form').innerText`)), 'debe decir que falta ese dato');
  });
  await paso('cambiar de modalidad sin haber elegido solo cambia la sugerencia: sigue sin marcarse nada', async () => {
    const antes = await ayuda(nav);
    for (const m of modalidades) {
      await elegirModalidad(nav, m);
      await nav.esperar(`document.querySelector('#r-modalidad').value === ${JSON.stringify(m)}`, 3000, 'modalidad');
      afirmar((await marcado(nav)).length === 0, `la modalidad ${m} marcó una opción`);
    }
    afirmar(typeof antes === 'string', 'ayuda');
  });
  await paso('pasar por el grupo sin elegir muestra el error humano, asociado al grupo', async () => {
    await nav.evaluar(`document.querySelector('input[name=responsableArl]').focus()`);
    await nav.enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await nav.enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await nav.esperar(`!!document.querySelector('#r-arl-error')`, 5000, 'error');
    afirmar(await nav.evaluar(`document.querySelector('#r-arl-error').innerText.trim()`) === 'Selecciona quién asume la ARL.', 'texto del error');
    afirmar(await nav.evaluar(`document.querySelector('fieldset').getAttribute('aria-describedby').includes('r-arl-error') && document.querySelector('fieldset').getAttribute('aria-invalid') === 'true'`), 'el error debe estar asociado al grupo');
    afirmar(await nav.evaluar(`document.querySelector('#r-arl-error').getAttribute('role') === 'alert'`), 'el error debe anunciarse');
  });
  await paso('elegir una opción quita el error; con otra modalidad la elección NO se pisa y, si difiere de la sugerencia, se avisa sin bloquear', async () => {
    await nav.clic('label.opcion', 'CUN');
    await nav.esperar(`!document.querySelector('#r-arl-error')`, 5000, 'sin error');
    afirmar((await marcado(nav)).join() === 'cun', 'debe quedar marcada CUN');
    let aviso = false;
    for (const m of modalidades) {
      await elegirModalidad(nav, m);
      await nav.esperar(`document.querySelector('#r-modalidad').value === ${JSON.stringify(m)}`, 3000, 'modalidad');
      afirmar((await marcado(nav)).join() === 'cun', `la modalidad ${m} pisó la elección`);
      if (/Tu elección es diferente de la sugerencia de la modalidad\./.test(await ayuda(nav))) aviso = true;
    }
    afirmar(aviso, 'alguna modalidad sugiere «Empresa» y debía advertir que la elección es diferente');
    afirmar(!(await nav.evaluar(`document.querySelector('fieldset').getAttribute('aria-invalid')`)), 'ya no debe marcarse inválido');
  });
  await paso('se puede elegir con el teclado (flechas entre las dos opciones)', async () => {
    await nav.evaluar(`document.querySelector('input[name=responsableArl][value=cun]').focus()`);
    await nav.enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
    await nav.enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
    await nav.esperar(`document.querySelector('input[name=responsableArl][value=empresa]').checked`, 5000, 'flecha');
  });
} finally {
  await nav.cerrar();
}
const fallos = resultados.filter((r) => !r).length;
console.log(`\n${resultados.length - fallos}/${resultados.length} pasos correctos`);
process.exitCode = fallos === 0 ? 0 : 1;
