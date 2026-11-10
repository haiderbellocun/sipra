/* Aplica el tema guardado ANTES del primer pintado para evitar el parpadeo del tema incorrecto.
   Misma clave y valores que el armazón ('sipra.tema': 'oscuro' | 'claro'); sin preferencia guardada
   se respeta prefers-color-scheme y, si no, el tema oscuro (predeterminado de SIPRA). */
(function () {
  try {
    var guardado = localStorage.getItem('sipra.tema');
    var claro = guardado === 'claro' || (guardado !== 'oscuro' && matchMedia('(prefers-color-scheme: light)').matches);
    var raiz = document.documentElement;
    raiz.dataset.theme = claro ? 'light' : 'dark';
    raiz.dataset.modo = claro ? 'claro' : 'oscuro';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', claro ? '#D3E4EE' : '#0A1C20');
  } catch (e) { /* sin almacenamiento: queda el predeterminado oscuro */ }
})();
