const { spawnSync } = require('node:child_process');

const vitestEntry = require.resolve('vitest/vitest.mjs');
const extraArgs = process.argv.slice(2);

const result = spawnSync(
  process.execPath,
  [vitestEntry, 'run', 'workspace.real-api.smoke.test.tsx', ...extraArgs],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      LIVE_API_SMOKE: '1',
    },
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
