import http from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, 'dist');
const stagingDistDir = path.resolve(__dirname, '.tmp', 'preview-dist-next');
const legacyPreviousDistDir = path.resolve(__dirname, '.tmp', 'preview-dist-prev');
const retainedBuildsDir = path.resolve(__dirname, '.tmp', 'preview-dist-retained');
const viteCliPath = path.resolve(__dirname, 'node_modules', 'vite', 'bin', 'vite.js');
const watchDebounceMs = 180;
const retainedBuildLimit = 4;
const watchTargets = [
  path.resolve(__dirname, 'src'),
  path.resolve(__dirname, 'index.html'),
  path.resolve(__dirname, 'package.json'),
  path.resolve(__dirname, 'tsconfig.json'),
  path.resolve(__dirname, 'vite.config.js'),
  path.resolve(__dirname, 'vite.config.ts'),
].filter((candidate) => existsSync(candidate));

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return fallback;
  }
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const host = readArg('--host', '127.0.0.1');
const port = Number.parseInt(readArg('--port', '4173'), 10);
const openUrl = readArg('--open-url', '');
const watchMode = hasFlag('--watch');
const rebuildOnStart = hasFlag('--rebuild-on-start');
let activeDistDir = distDir;
const retainedDistRoots = [];

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

function isPathInside(rootDir, targetPath) {
  const relativePath = path.relative(rootDir, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function resolveRequestFile(rootDir, candidate) {
  const resolved = path.resolve(rootDir, `.${candidate}`);
  if (!isPathInside(rootDir, resolved)) {
    return { allowed: false, filePath: null };
  }
  if (existsSync(resolved) && statSync(resolved).isFile()) {
    return { allowed: true, filePath: resolved };
  }
  return { allowed: true, filePath: null };
}

function isAssetRequest(pathname) {
  return pathname.startsWith('/assets/') || Boolean(path.extname(pathname));
}

function uniqueExistingRoots(roots) {
  const seen = new Set();
  return roots.filter((root) => {
    if (!root || seen.has(root) || !existsSync(root)) {
      return false;
    }
    seen.add(root);
    return true;
  });
}

function activeFallbackRoots() {
  return uniqueExistingRoots([
    activeDistDir,
    ...retainedDistRoots,
    distDir,
    legacyPreviousDistDir,
  ]);
}

function safePathFromRequest(urlPath) {
  const requestUrl = new URL(urlPath, `http://${host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const candidate = pathname === '/' ? '/index.html' : pathname;
  for (const root of activeFallbackRoots()) {
    const requestedFilePath = resolveRequestFile(root, candidate);
    if (!requestedFilePath.allowed) {
      return { statusCode: 403, message: 'Forbidden' };
    }
    if (requestedFilePath.filePath) {
      return { filePath: requestedFilePath.filePath };
    }
  }

  if (isAssetRequest(pathname)) {
    return {
      statusCode: 404,
      message: `Asset not found: ${candidate}`,
    };
  }

  const activeIndexPath = activeFallbackRoots()
    .map((root) => path.join(root, 'index.html'))
    .find((indexPath) => existsSync(indexPath) && statSync(indexPath).isFile());
  return activeIndexPath ? { filePath: activeIndexPath } : { filePath: path.join(distDir, 'index.html') };
}

function sendText(statusCode, message, response) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end(message);
}

function sendFile(filePath, response) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(503, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    response.end('Frontend build not ready yet.');
    return;
  }
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': contentTypes[extension] || 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
}

function describePath(targetPath) {
  const relativePath = path.relative(__dirname, targetPath);
  return relativePath && !relativePath.startsWith('..') ? relativePath : targetPath;
}

function isIgnoredWatchPath(targetPath) {
  const normalizedPath = targetPath.replace(/\\/g, '/');
  if (
    normalizedPath.includes('/dist/') ||
    normalizedPath.includes('/node_modules/') ||
    normalizedPath.includes('/.tmp/')
  ) {
    return true;
  }
  const baseName = path.basename(targetPath);
  if (/\.(swp|swo|tmp)$/i.test(baseName) || baseName.endsWith('~')) {
    return true;
  }
  if (/\.(test|spec)\.[^.]+$/i.test(baseName) || /\.stories\.[^.]+$/i.test(baseName)) {
    return true;
  }
  return normalizedPath.includes('/__tests__/') || normalizedPath.includes('/__mocks__/');
}

function formatReasons(reasons) {
  const labels = [...reasons].filter(Boolean);
  if (!labels.length) {
    return 'source change';
  }
  if (labels.length <= 3) {
    return labels.join(', ');
  }
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more`;
}

function ensurePreviewTmpDir() {
  mkdirSync(path.dirname(stagingDistDir), { recursive: true });
}

function registerRetainedRoot(rootDir) {
  if (!rootDir || rootDir === activeDistDir) {
    return;
  }
  if (!existsSync(rootDir) || !existsSync(path.join(rootDir, 'index.html'))) {
    return;
  }
  const nextRoots = [rootDir, ...retainedDistRoots.filter((root) => root !== rootDir)];
  retainedDistRoots.length = 0;
  retainedDistRoots.push(...nextRoots.slice(0, retainedBuildLimit));
}

function cleanupRetainedBuilds() {
  if (!existsSync(retainedBuildsDir)) {
    return;
  }
  const protectedRoots = new Set([activeDistDir, ...retainedDistRoots, distDir, legacyPreviousDistDir]);
  const buildDirs = [];
  for (const item of readdirSync(retainedBuildsDir, { withFileTypes: true })) {
    if (!item.isDirectory()) {
      continue;
    }
    const root = path.join(retainedBuildsDir, item.name);
    if (protectedRoots.has(root)) {
      continue;
    }
    buildDirs.push({ root, mtimeMs: statSync(root).mtimeMs });
  }
  buildDirs
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(retainedBuildLimit)
    .forEach((entry) => rmSync(entry.root, { recursive: true, force: true }));
}

function promoteStagingDist() {
  const promotedDistDir = path.join(retainedBuildsDir, `build-${Date.now()}-${process.pid}`);
  try {
    mkdirSync(retainedBuildsDir, { recursive: true });
    registerRetainedRoot(activeDistDir);
    renameSync(stagingDistDir, promotedDistDir);
    activeDistDir = promotedDistDir;
    cleanupRetainedBuilds();
    return true;
  } catch (error) {
    console.error(`[preview] Failed to promote rebuilt dist: ${error instanceof Error ? error.message : String(error)}`);
    rmSync(promotedDistDir, { recursive: true, force: true });
    return false;
  } finally {
    rmSync(stagingDistDir, { recursive: true, force: true });
  }
}

function runBuildCommand() {
  return new Promise((resolve) => {
    if (!existsSync(viteCliPath)) {
      console.error(`[preview] Cannot find Vite CLI at ${viteCliPath}`);
      resolve(1);
      return;
    }
    ensurePreviewTmpDir();
    rmSync(stagingDistDir, { recursive: true, force: true });

    const child = spawn(process.execPath, [viteCliPath, 'build', '--outDir', stagingDistDir, '--emptyOutDir'], {
      cwd: __dirname,
      env: process.env,
      stdio: 'inherit',
    });

    child.once('error', (error) => {
      console.error(`[preview] Failed to start Vite build: ${error instanceof Error ? error.message : String(error)}`);
      resolve(1);
    });
    child.once('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

let buildInFlight = false;
let scheduledBuildTimer = null;
let queuedRebuild = false;
const queuedReasons = new Set();
const watcherHandles = [];

async function rebuildDist(reasons) {
  if (buildInFlight) {
    reasons.forEach((reason) => queuedReasons.add(reason));
    queuedRebuild = true;
    return;
  }

  buildInFlight = true;
  const startedAt = Date.now();
  console.log(`[preview] Rebuilding frontend because of: ${formatReasons(reasons)}`);

  try {
    const exitCode = await runBuildCommand();
    if (exitCode !== 0) {
      rmSync(stagingDistDir, { recursive: true, force: true });
      console.error('[preview] Rebuild failed. Keeping the last successful dist bundle.');
      return;
    }
    if (!promoteStagingDist()) {
      console.error('[preview] Rebuild finished, but dist promotion failed. Keeping the last successful dist bundle.');
      return;
    }
    const elapsedMs = Date.now() - startedAt;
    console.log(`[preview] Rebuild completed in ${(elapsedMs / 1000).toFixed(1)}s.`);
  } finally {
    buildInFlight = false;
    if (queuedRebuild) {
      const followUpReasons = new Set(queuedReasons);
      queuedReasons.clear();
      queuedRebuild = false;
      void rebuildDist(followUpReasons);
    }
  }
}

function queueRebuild(reason) {
  if (!watchMode) {
    return;
  }
  if (reason) {
    queuedReasons.add(reason);
  }
  if (scheduledBuildTimer) {
    clearTimeout(scheduledBuildTimer);
  }
  scheduledBuildTimer = setTimeout(() => {
    scheduledBuildTimer = null;
    const reasons = new Set(queuedReasons);
    queuedReasons.clear();
    void rebuildDist(reasons);
  }, watchDebounceMs);
}

function startWatchMode() {
  if (!watchMode) {
    return;
  }
  for (const targetPath of watchTargets) {
    const targetStats = statSync(targetPath);
    const recursive = targetStats.isDirectory();
    const watchRoot = recursive ? targetPath : path.dirname(targetPath);
    try {
      const watcher = watch(targetPath, { recursive }, (_eventType, filename) => {
        const watchedPath = filename ? path.resolve(watchRoot, String(filename)) : targetPath;
        if (isIgnoredWatchPath(watchedPath)) {
          return;
        }
        queueRebuild(describePath(watchedPath));
      });
      watcher.on('error', (error) => {
        console.error(
          `[preview] Watch error on ${describePath(targetPath)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      watcherHandles.push(watcher);
      console.log(`[preview] Watching ${describePath(targetPath)}${recursive ? ' recursively' : ''} for rebuilds.`);
    } catch (error) {
      console.error(
        `[preview] Failed to watch ${describePath(targetPath)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function stopWatchMode() {
  if (scheduledBuildTimer) {
    clearTimeout(scheduledBuildTimer);
    scheduledBuildTimer = null;
  }
  while (watcherHandles.length) {
    const watcher = watcherHandles.pop();
    try {
      watcher?.close();
    } catch {
      // Best effort cleanup.
    }
  }
}

const server = http.createServer((request, response) => {
  const resolved = safePathFromRequest(request.url || '/');
  if (!resolved.filePath) {
    sendText(resolved.statusCode ?? 404, resolved.message ?? 'Not found', response);
    return;
  }
  sendFile(resolved.filePath, response);
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

async function startServer() {
  if (watchMode && (rebuildOnStart || !existsSync(path.join(distDir, 'index.html')))) {
    await rebuildDist(new Set(['startup']));
  }

  server.listen(port, host, () => {
    console.log(`Static preview listening on http://${host}:${port}`);
    if (watchMode) {
      console.log('[preview] Auto rebuild is enabled for local frontend changes.');
      startWatchMode();
    }
    openDefaultBrowser(openUrl);
  });
}

function shutdown() {
  stopWatchMode();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 250).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

void startServer();
