/* Precarga de pruebas: cualquier intento de red desde ESTE hilo se registra en un archivo y falla. */
const { appendFileSync } = require('node:fs');
const marca = process.env.SIPRA_MARCA_RED;
const avisar = (que) => {
  if (marca) appendFileSync(marca, `${que}\n`);
  throw new Error('red_bloqueada_en_prueba');
};
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
for (const [mod, nombre] of [[http, 'http'], [https, 'https']]) {
  mod.request = () => avisar(`${nombre}.request`);
  mod.get = () => avisar(`${nombre}.get`);
}
net.Socket.prototype.connect = function conectar() { return avisar('net.connect'); };
net.connect = () => avisar('net.connect');
tls.connect = () => avisar('tls.connect');
dns.lookup = () => avisar('dns.lookup');
if (typeof globalThis.fetch === 'function') globalThis.fetch = () => avisar('fetch');
if (marca) appendFileSync(marca, `cargado:${require('node:worker_threads').isMainThread ? 'principal' : 'hilo'}\n`);
