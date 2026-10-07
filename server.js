#!/usr/bin/env node
/*
 * Мини-сервер CG-пакета (без зависимостей, Node 18+).
 *  - раздаёт статику (index.html — графика, control.html — пульт)
 *  - синхронизирует пульт и графику: POST /api/state  →  SSE /api/events
 *  - хранит последнее состояние (графика после перезагрузки восстанавливается)
 *  - /api/sheet?gid=… — резервный прокси CSV из Google Sheets
 *
 * Запуск:  node server.js            (порт 8787)
 *          PORT=9000 node server.js
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = +process.env.PORT || 8787;
const ROOT = __dirname;
const STATE_FILE = path.join(ROOT, '.state.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8'
};

let state = { rev: 0, center: null, bottom: null };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { /* первый запуск */ }
const clients = new Set();

function broadcast() {
  const msg = 'data: ' + JSON.stringify(state) + '\n\n';
  for (const res of clients) { try { res.write(msg); } catch (e) { clients.delete(res); } }
}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(STATE_FILE, JSON.stringify(state), () => {}), 300);
}

function readBody(req, limit = 2e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // ---------- API ----------
  if (p === '/api/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(state));
  }
  if (p === '/api/state' && req.method === 'POST') {
    try {
      const st = JSON.parse(await readBody(req));
      state = Object.assign({ center: null, bottom: null }, st, { rev: (state.rev || 0) + 1, ts: Date.now() });
      broadcast(); persist();
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      return res.end(JSON.stringify({ ok: true, rev: state.rev }));
    } catch (e) { res.writeHead(400); return res.end('bad json'); }
  }
  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 1000\n');
    res.write('data: ' + JSON.stringify(state) + '\n\n');
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (p === '/api/sheet') {
    const id = url.searchParams.get('id'), gid = url.searchParams.get('gid');
    if (!id || !/^[\w-]+$/.test(id) || !/^\d+$/.test(gid || '')) { res.writeHead(400); return res.end('id/gid'); }
    try {
      const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, { redirect: 'follow' });
      const t = await r.text();
      res.writeHead(r.status, { 'Content-Type': MIME['.csv'], 'Cache-Control': 'no-store' });
      return res.end(t);
    } catch (e) { res.writeHead(502); return res.end(String(e.message || e)); }
  }

  // ---------- статика ----------
  let file = path.normalize(path.join(ROOT, p === '/' ? '/index.html' : p));
  if (!file.startsWith(ROOT) || /(^|[\\/])\./.test(path.relative(ROOT, file))) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err2, buf) => {
      if (err2) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\n  CG · Гонки дронов 2026 — сервер запущен\n');
  console.log(`  Графика (vMix → Web Browser):  http://localhost:${PORT}/`);
  console.log(`  Пульт управления:              http://localhost:${PORT}/control.html`);
  ips.forEach(ip => console.log(`  В локальной сети:              http://${ip}:${PORT}/control.html`));
  console.log('\n  Ctrl+C — остановить\n');
});
