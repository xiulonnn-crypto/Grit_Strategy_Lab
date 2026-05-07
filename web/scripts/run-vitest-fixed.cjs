const childProcess = require('node:child_process');
const moduleBuiltin = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const webRoot = path.resolve(__dirname, '..');

function createNoopChild(error, callback) {
  if (callback) {
    setImmediate(() => callback(error, '', ''));
  }
  return {
    pid: 0,
    stdout: null,
    stderr: null,
    stdin: null,
    killed: false,
    connected: false,
    exitCode: null,
    signalCode: null,
    on() {
      return this;
    },
    once() {
      return this;
    },
    kill() {
      return false;
    },
  };
}

function installWindowsSpawnGuards() {
  const originalExec = childProcess.exec;
  childProcess.exec = function guardedExec(...args) {
    try {
      return originalExec.apply(this, args);
    } catch (error) {
      const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      return createNoopChild(error, callback);
    }
  };

  moduleBuiltin.syncBuiltinESMExports();
}

function createTypeScriptTranspilePlugin() {
  return {
    name: 'codex-typescript-transpile',
    enforce: 'pre',
    transform(code, id) {
      const filePath = id.split('?')[0];
      if (filePath.includes('/node_modules/') || filePath.includes('\\node_modules\\')) {
        return null;
      }
      if (!/\.[cm]?tsx?$/.test(filePath)) {
        return null;
      }

      const transpiled = ts.transpileModule(code, {
        fileName: filePath,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          jsx: filePath.endsWith('.tsx') ? ts.JsxEmit.ReactJSX : ts.JsxEmit.Preserve,
          useDefineForClassFields: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          sourceMap: true,
        },
      });

      return {
        code: transpiled.outputText,
        map: transpiled.sourceMapText ? JSON.parse(transpiled.sourceMapText) : null,
      };
    },
  };
}

function normalizeSetupFiles(value) {
  if (!value) {
    return ['./src/testSetup.ts'];
  }
  const entries = Array.isArray(value) ? value : [value];
  return Array.from(new Set([...entries, './src/testSetup.ts']));
}

async function main() {
  installWindowsSpawnGuards();
  const { parseCLI, startVitest } = await import('vitest/node');
  const parsed = parseCLI(['vitest', 'run', ...process.argv.slice(2)]);
  const cliOptions = parsed.options || {};
  const cliPoolOptions = cliOptions.poolOptions || {};
  const cliThreadOptions = cliPoolOptions.threads || {};

  const vitestOptions = {
    ...cliOptions,
    config: false,
    root: cliOptions.root || webRoot,
    run: true,
    environment: cliOptions.environment || 'jsdom',
    globals: cliOptions.globals ?? true,
    setupFiles: normalizeSetupFiles(cliOptions.setupFiles),
    pool: cliOptions.pool || 'threads',
    poolOptions: {
      ...cliPoolOptions,
      threads: {
        ...cliThreadOptions,
        singleThread: cliThreadOptions.singleThread ?? true,
      },
    },
    fileParallelism: cliOptions.fileParallelism ?? false,
    maxWorkers: cliOptions.maxWorkers || 1,
  };

  const viteOverrides = {
    esbuild: false,
    optimizeDeps: {
      disabled: true,
    },
    plugins: [createTypeScriptTranspilePlugin()],
    server: {
      proxy: {
        '^/(workspace|strategies|strategy-creation-sessions|backtest-runs|optimization-jobs|data-snapshots|admin)(/.*)?$': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
  };

  const ctx = await startVitest('test', parsed.filter, vitestOptions, viteOverrides);
  await ctx?.close?.();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
