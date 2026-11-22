import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.GUPPY_PORT || 3456);
const DB_PATH = path.join(process.env.HOME || '/Users/je', 'Library/Application Support/com.je.guppy/local_media.db');
const cfgCandidates = [
  new URL('../src/lib/guppyConfig.js', import.meta.url).pathname,
  path.join(process.env.HOME || '/Users/je', 'guppy/src/lib/guppyConfig.js')
];
const cfgPath = cfgCandidates.find(p => fsSync.existsSync(p));
const { GUPPY_CONFIG } = cfgPath ? await import(cfgPath) : {
  GUPPY_CONFIG: {
    hostDriveRoot: '/Volumes/4TB0-SEAGATE',
    hostJellyRoot: '/Volumes/4TB0-SEAGATE/jelly',
    artFilmsRoot: '/Volumes/4TB0-SEAGATE/jelly/art-films',
    localShareMount: '/Volumes/jelly'
  }
};
const ALLOWED_ROOTS = [GUPPY_CONFIG.hostDriveRoot];
const ART_FILMS_ROOT = GUPPY_CONFIG.artFilmsRoot;
const LOCAL_BUILD = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../build');
const STATIC_DIR = fsSync.existsSync(LOCAL_BUILD) ? LOCAL_BUILD : '/Users/je/guppy/build';
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo'
};

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

const sseClients = new Set();

function broadcastDbChanged(source = 'server') {
  const payload = `data: ${JSON.stringify({ type: 'db_changed', source, ts: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (_) {
      sseClients.delete(client);
    }
  }
}

setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(': ping\n\n');
    } catch (_) {
      sseClients.delete(client);
    }
  }
}, 20000);

function assertSafePath(targetPath, isRemoteClient = false) {
  const resolved = path.resolve(String(targetPath || ''));
  if (!ALLOWED_ROOTS.some(root => resolved === root || resolved.startsWith(root + '/'))) {
    throw new Error(`Access denied outside ${ALLOWED_ROOTS.join(', ')}: ${resolved}`);
  }
  if (isRemoteClient && (resolved === ART_FILMS_ROOT || resolved.startsWith(ART_FILMS_ROOT + '/'))) {
    throw new Error(`Access denied to restricted folder: ${resolved}`);
  }
  return resolved;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

const HOST_IP = ['192', '168', '50', '164'].join('.');

function getClientLabel(req, isRemoteClient) {
  const rawIp = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  const ip = !rawIp || rawIp === '::1' || rawIp === '127.0.0.1' ? HOST_IP : rawIp;
  const role = isRemoteClient ? 'client' : 'host';
  return `${ip} (${role})`;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Guppy-Client');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const rawClientIp = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  const isRemoteClient = req.headers['x-guppy-client'] === 'remote' || (rawClientIp && rawClientIp !== '::1' && rawClientIp !== '127.0.0.1' && rawClientIp !== HOST_IP);

  try {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, db: DB_PATH }));
      return;
    }

    if (req.url === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
      sseClients.add(res);
      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    if (req.url === '/api/notify') {
      broadcastDbChanged('host');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, clients: sseClients.size }));
      return;
    }

    const body = await readJsonBody(req);

    if (req.url === '/api/sql/select') {
      const stmt = db.prepare(body.sql);
      let rows = stmt.all(...(body.params || []));
      if (isRemoteClient && String(body.sql || '').toLowerCase().includes('wishlist_videos')) {
        rows = rows.filter(r => !(r.tags || '').toLowerCase().split(',').map(t => t.trim()).includes('adult'));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rows }));
      return;
    }

    if (req.url === '/api/sql/execute') {
      const sourceLabel = getClientLabel(req, isRemoteClient);
      const params = (body.params || []).map(p =>
        typeof p === 'string' ? p.replace('__SOURCE__', sourceLabel) : p
      );
      const stmt = db.prepare(body.sql);
      const info = stmt.run(...params);
      if (info.changes > 0) {
        broadcastDbChanged(isRemoteClient ? 'remote' : 'host');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }));
      return;
    }

    if (req.url === '/api/fs/readDir') {
      const dir = assertSafePath(body.path, isRemoteClient);
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      const entries = dirents.map(d => ({
        name: d.name,
        isDirectory: d.isDirectory(),
        isFile: d.isFile(),
        isSymlink: d.isSymbolicLink()
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ entries }));
      return;
    }

    if (req.url === '/api/fs/exists') {
      const target = assertSafePath(body.path, isRemoteClient);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ exists: fsSync.existsSync(target) }));
      return;
    }

    if (req.url === '/api/fs/mkdir') {
      const target = assertSafePath(body.path, isRemoteClient);
      await fs.mkdir(target, { recursive: Boolean(body.recursive) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === '/api/fs/rename') {
      const from = assertSafePath(body.oldPath, isRemoteClient);
      const to = assertSafePath(body.newPath, isRemoteClient);
      await fs.rename(from, to);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === '/api/fs/remove') {
      const target = assertSafePath(body.path, isRemoteClient);
      await fs.rm(target, { recursive: Boolean(body.recursive), force: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === '/api/fs/writeTextFile') {
      const target = assertSafePath(body.path, isRemoteClient);
      await fs.writeFile(target, String(body.contents ?? ''), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === '/api/fs/writeFile') {
      const target = assertSafePath(body.path, isRemoteClient);
      await fs.writeFile(target, Buffer.from(body.bytesBase64 || '', 'base64'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && req.url.startsWith('/stream')) {
      const u = new URL(req.url, 'http://localhost');
      const reqPath = u.searchParams.get('path') || '';
      const sharePrefix = `${GUPPY_CONFIG.localShareMount}/`;
      const mapped = reqPath.startsWith(sharePrefix)
        ? `${GUPPY_CONFIG.hostJellyRoot}/` + reqPath.slice(sharePrefix.length)
        : reqPath;
      const safeFile = assertSafePath(mapped, true);
      const stat = fsSync.statSync(safeFile);
      const ext = path.extname(safeFile).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': (end - start) + 1,
          'Content-Type': contentType
        });
        fsSync.createReadStream(safeFile, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Accept-Ranges': 'bytes',
          'Content-Type': contentType
        });
        fsSync.createReadStream(safeFile).pipe(res);
      }
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && !req.url.startsWith('/api/')) {
      const urlPath = decodeURIComponent(req.url.split('?').at(0));
      let filePath = path.join(STATIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
      if (!filePath.startsWith(STATIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (!fsSync.existsSync(filePath) || fsSync.statSync(filePath).isDirectory()) {
        filePath = path.join(STATIC_DIR, 'index.html');
      }
      if (fsSync.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', ...(ext === '.html' ? { 'Cache-Control': 'no-store' } : {}) });
        fsSync.createReadStream(filePath).pipe(res);
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Guppy LAN server running at http://0.0.0.0:${PORT}`);
});
