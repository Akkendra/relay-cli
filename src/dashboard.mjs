import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from './usage.mjs';
import { relayConfigDir } from './routing.mjs';
import { accountCache, readCodexAccount } from './codex-account.mjs';
import { readCatalog } from './catalog.mjs';

// The React page is built with `npm run build:dashboard`; files are read per request so a rebuild needs no restart.
const defaultDistDir = fileURLToPath(new URL('../dist/dashboard/', import.meta.url));
const defaultSiteDir = fileURLToPath(new URL('../dist/site/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};
// Decisions use the resolved path, not the request text, so encoded ../ segments can't escape assets/.
// Built asset names carry a content hash, so assets can be cached forever; index.html must not be.
function staticFile(distDir, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); } catch { return null; }
  const root = resolve(distDir), file = resolve(root, '.' + rel);
  const immutable = file.startsWith(join(root, 'assets') + sep);
  if (!immutable && file !== join(root, 'index.html')) return null;
  try { return statSync(file).isFile() ? { file, immutable } : null; } catch { return null; }
}

// Read-only and bound to loopback. The Host check stops other web pages from reading the API through DNS rebinding;
// allowHosts adds explicitly named hosts, such as a Tailscale Serve name that proxies to this loopback port.
export function startDashboard({ port = 4318, home = homedir(), configDir = relayConfigDir(), now = () => new Date(), allowHosts = [], distDir = defaultDistDir, siteDir = defaultSiteDir,
  readAccount = threadIds => readCodexAccount({ threadIds }) } = {}) {
  let codexIds = [];
  const account = accountCache({ read: () => readAccount(codexIds) });
  const catalog = accountCache({ read: async () => readCatalog({ home }) });
  let hosts = new Set();
  const server = createServer((req, res) => {
    if (!hosts.has(String(req.headers.host ?? '').toLowerCase())) { res.writeHead(421, headers).end('Misdirected request'); return; }
    if (req.method !== 'GET') { res.writeHead(405, { ...headers, Allow: 'GET' }).end('Read-only'); return; }
    const url = new URL(req.url, 'http://localhost'), path = url.pathname;
    if (path === '/api/summary') {
      let body;
      try {
        const summary = summarize({ home, configDir, now: now(), codexAccount: account.get(), project: url.searchParams.get('project') || null });
        codexIds = summary.sessions.filter(s => s.provider === 'codex' && s.id).map(s => s.id);
        body = JSON.stringify({ ...summary, catalog: catalog.get() });
      }
      catch (e) { res.writeHead(500, { ...headers, 'Content-Type': 'application/json' }).end(JSON.stringify({ error: e.message })); return; }
      res.writeHead(200, { ...headers, 'Content-Type': 'application/json' }).end(body);
      return;
    }
    // / is the landing page (npm run build:site); /dashboard is the dashboard. Both use the same strict policy.
    if (path === '/welcome' || path.startsWith('/welcome/')) { res.writeHead(301, { ...headers, Location: '/' }).end(); return; }
    if (path === '/dashboard') { res.writeHead(301, { ...headers, Location: '/dashboard/' }).end(); return; }
    const inDashboard = path.startsWith('/dashboard/');
    const asset = staticFile(inDashboard ? distDir : siteDir, inDashboard ? path.slice('/dashboard'.length) : path);
    if (asset) {
      const cache = asset.immutable ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {};
      res.writeHead(200, { ...headers, ...cache, 'Content-Type': types[extname(asset.file)] ?? 'application/octet-stream' }).end(readFileSync(asset.file));
      return;
    }
    if (path === '/' || path === '/dashboard/') { res.writeHead(503, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end(`Not built. In the Relay folder run: npm run ${path === '/' ? 'build:site' : 'build:dashboard'}`); return; }
    res.writeHead(404, headers).end('Not found');
  });
  return new Promise((yes, no) => {
    server.once('error', e => no(e.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use. Try relay dashboard --port <number>.`) : e));
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      hosts = new Set([`127.0.0.1:${p}`, `localhost:${p}`, ...allowHosts.flatMap(h => [h.toLowerCase(), `${h.toLowerCase()}:443`])]);
      yes(server);
    });
  });
}
