// One command before finishing work: lint, syntax, types, formatting, tests — in that order,
// stopping at the first failure. Node only, so it behaves the same in PowerShell and Git Bash.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const steps = ['lint', 'check:syntax', 'typecheck', 'format:check', 'test'];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const started = Date.now();

for (const [index, step] of steps.entries()) {
  console.log(`\n=== [${index + 1}/${steps.length}] npm run ${step} ===`);
  const stepStarted = Date.now();
  // shell: true lets Windows run npm.cmd (spawning .cmd files directly is refused since Node 20.12).
  const result = spawnSync(npm, ['run', '--silent', step], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  const seconds = ((Date.now() - stepStarted) / 1000).toFixed(1);
  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message);
    console.error(`\nverify: "${step}" failed (exit ${result.status ?? 'error'}, ${seconds} s).`);
    process.exit(result.status || 1);
  }
  console.log(`--- ${step}: ok (${seconds} s)`);
}
console.log(
  `\nverify: all ${steps.length} steps passed in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
);
