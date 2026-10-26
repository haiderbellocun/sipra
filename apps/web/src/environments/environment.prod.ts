export const entorno = {
  produccion: true,
  /**
   * En Google Cloud el frontend se sirve desde Cloud Storage tras el CDN y la
   * API vive en Cloud Run bajo el mismo dominio institucional, con el balanceador
   * enrutando /api. Por eso la ruta es relativa: no hay host embebido en el bundle.
   */
  apiBase: '/api/v1',
  nombre: 'SIPRA PRÁCTICAS',
  ambiente: 'prod',
};
