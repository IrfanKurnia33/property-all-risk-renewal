import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browserTemp = resolve(root, '.cache/browser-temp');
mkdirSync(browserTemp, { recursive: true });
// Playwright reads this during import, before its test configuration runs.
const env = {
  ...process.env,
  PLAYWRIGHT_BROWSERS_PATH: resolve(root, '.cache/ms-playwright'),
  TMP: browserTemp,
  TEMP: browserTemp,
};
const result = spawnSync(process.execPath, [resolve(root, 'node_modules/@playwright/test/cli.js'), ...process.argv.slice(2)], {
  cwd: root, env, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
