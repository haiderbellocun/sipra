// Servidor de CALIBRACIÓN del generador (P15): consume el cuerpo y responde 201. Sin SIPRA, sin base, sin disco.
// node performance/herramientas/eco-servidor.cjs [puerto=3199]
const http = require('node:http');
const puerto = Number(process.argv[2] ?? 3199);
http.createServer((req, res) => {
  let n = 0;
  req.on('data', (c) => { n += c.length; });
  req.on('end', () => { res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ bytes: n })); });
}).listen(puerto, '0.0.0.0', () => console.log(`eco en ${puerto}`));
