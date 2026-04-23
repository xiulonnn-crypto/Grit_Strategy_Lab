const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function resolveManifestPath() {
  if (process.env.LIVE_FIXTURE_MANIFEST) {
    return path.resolve(process.env.LIVE_FIXTURE_MANIFEST);
  }
  return path.resolve(process.cwd(), '..', 'harness', 'fixtures', 'seed_workspace', 'manifest.json');
}

function readManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const parsed = JSON.parse(raw);
  const requiredKeys = [
    'creation_session_id',
    'strategy_id',
    'optimization_strategy_id',
    'run_id',
    'optimization_job_id',
  ];
  for (const key of requiredKeys) {
    if (!parsed[key]) {
      throw new Error(`Fixture manifest is missing required key: ${key}`);
    }
  }
  return parsed;
}

const vitestEntry = require.resolve('vitest/vitest.mjs');
const extraArgs = process.argv.slice(2);
const manifestPath = resolveManifestPath();
const manifest = readManifest(manifestPath);
const liveApiBase = process.env.LIVE_API_BASE || 'http://127.0.0.1:8000';

const result = spawnSync(
  process.execPath,
  [vitestEntry, 'run', 'workspace.real-api.smoke.test.tsx', ...extraArgs],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      LIVE_API_SMOKE: '1',
      LIVE_API_BASE: liveApiBase,
      LIVE_CREATION_SESSION_ID: String(manifest.creation_session_id),
      LIVE_STRATEGY_ID: String(manifest.strategy_id),
      LIVE_OPTIMIZATION_STRATEGY_ID: String(manifest.optimization_strategy_id),
      LIVE_RUN_ID: String(manifest.run_id),
      LIVE_OPTIMIZATION_JOB_ID: String(manifest.optimization_job_id),
    },
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
