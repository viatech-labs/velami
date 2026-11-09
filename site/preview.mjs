#!/usr/bin/env node
// Локальный просмотр dist/site с тем же выбором языка, что в nginx: node site/preview.mjs [port]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml' };

export function pickLang(header = '') {
  const first = header.split(',')[0].trim().toLowerCase();
  return first.startsWith('it') ? 'it' : first.startsWith('ru') ? 'ru' : 'en';
}

export function resolve(url, acceptLanguage) {
  const p = new URL(url, 'http://x').pathname;
  const m = p.match(/^\/(?:(en|it|ru)\/?)?(privacy)?\/?$/);
  if (m) return `${m[2] ? 'privacy' : 'index'}.${m[1] || pickLang(acceptLanguage)}.html`;
  return p.slice(1);
}

export function serve(port = 8090) {
  const server = http.createServer(async (req, res) => {
    const file = resolve(req.url, req.headers['accept-language']);
    try {
      const body = await readFile(path.join(DIR, path.normalize(file).replace(/^(\.\.[/\\])+/, '')));
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', vary: 'Accept-Language' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 8090);
  serve(port).then(() => console.log(`http://localhost:${port}`));
}
