#!/usr/bin/env node
// Ноорог харах локал сервер (хамааралгүй).
//   node tools/build.mjs --preview && node tools/preview.mjs [--port 8766]
// .preview/ (ноорогтой HTML) → repo-ийн файл гэсэн дарааллаар үйлчилнэ; Vercel шиг ташуу зураасгүй URL,
// .vercelignore-д орсон файлыг (content/, tools/ г.м.) үзүүлэхгүй. Зөвхөн 127.0.0.1 — сүлжээнд нээгдэхгүй.

import http from 'node:http';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vercelIgnore } from './lib/assets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREV = join(ROOT, '.preview');
const i = process.argv.indexOf('--port');
const PORT = i > -1 ? Number(process.argv[i + 1]) : 8766;
const ignored = vercelIgnore(ROOT);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

function resolve(rel) {
  for (const base of [PREV, ROOT]) {
    for (const cand of rel === '' ? ['index.html'] : [rel, rel + '/index.html']) {
      const abs = join(base, cand);
      if (abs.startsWith(base) && existsSync(abs) && statSync(abs).isFile()) return abs;
    }
  }
  return null;
}

http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (p.length > 1 && p.endsWith('/')) { res.writeHead(308, { Location: p.replace(/\/+$/, '') }).end(); return; }
  const rel = normalize(p).replace(/^\/+/, '');
  if (rel.startsWith('..') || /(^|\/)\.(git|preview)(\/|$)/.test(rel) || (rel && ignored(rel))) { res.writeHead(404).end('Not found'); return; }
  const abs = resolve(rel);
  const headers = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' };
  if (!abs) {
    res.writeHead(404, { ...headers, 'Content-Type': TYPES['.html'] }).end(readFileSync(join(ROOT, '404.html')));
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(abs).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(abs));
}).listen(PORT, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${PORT}/  (.preview/ → repo; Ctrl+C зогсооно)`));
