import http from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, 'dist');

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return fallback;
  }
  return process.argv[index + 1];
}

const host = readArg('--host', '127.0.0.1');
const port = Number.parseInt(readArg('--port', '4173'), 10);
const openUrl = readArg('--open-url', '');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function safePathFromRequest(urlPath) {
  const requestUrl = new URL(urlPath, `http://${host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const candidate = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.resolve(rootDir, `.${candidate}`);
  if (!resolved.startsWith(rootDir)) {
    return null;
  }
  if (existsSync(resolved) && statSync(resolved).isFile()) {
    return resolved;
  }
  return path.join(rootDir, 'index.html');
}

function sendFile(filePath, response) {
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': contentTypes[extension] || 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  const filePath = safePathFromRequest(request.url || '/');
  if (!filePath) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }
  sendFile(filePath, response);
});

function openDefaultBrowser(targetUrl) {
  if (!targetUrl) {
    return;
  }

  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', targetUrl], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }

  if (process.platform === 'darwin') {
    const child = spawn('open', [targetUrl], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }

  const child = spawn('xdg-open', [targetUrl], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

server.listen(port, host, () => {
  console.log(`Static preview listening on http://${host}:${port}`);
  openDefaultBrowser(openUrl);
});
