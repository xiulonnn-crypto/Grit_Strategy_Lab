const fs = require('fs');
const path = require('path');

const webRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webRoot, '..');
const rootFallback = path.join(repoRoot, 'scripts', 'run-recovery-tests.ps1');
const esbuildCandidates = [
  path.join(webRoot, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
  path.join(webRoot, 'node_modules', 'esbuild', 'bin', 'esbuild.exe'),
  path.join(webRoot, 'node_modules', 'esbuild', 'bin', 'esbuild'),
];

function print(line = '') {
  process.stdout.write(`${line}\n`);
}

print('Vitest spawn diagnosis');
print(`cwd: ${process.cwd()}`);
print(`web root: ${webRoot}`);
print(`node: ${process.version}`);
print(`platform: ${process.platform} ${process.arch}`);
print('');
print('Detected esbuild binaries:');
for (const candidate of esbuildCandidates) {
  print(`- ${fs.existsSync(candidate) ? 'FOUND' : 'MISS '} ${candidate}`);
}
print('');
print('Known sandbox issue: Vite/Vitest can fail before tests start with "esbuild spawn EPERM".');
print('');
print('Recommended fallback paths:');
print(`1. Repo-root recovery runner: powershell -ExecutionPolicy Bypass -File "${rootFallback}" -Target frontend`);
print('2. Full frontend type scan:  Set-Location web; npx tsc --noEmit');
print('3. Current runtime route smoke: Set-Location web; npm test -- --run src/app.routes.test.tsx');
print('');
print('If option 1 still fails with EPERM, rerun from a non-sandboxed PowerShell session.');
