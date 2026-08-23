// Fetches better-sqlite3's prebuilt binding for the installed Electron's ABI,
// so a fresh `npm install` needs no C++ toolchain. Runs as postinstall.
// prebuild-install ships as a dependency of better-sqlite3 itself.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const moduleDir = path.join(root, 'node_modules', 'better-sqlite3');

if (!existsSync(moduleDir)) {
  console.log('rebuild-native: better-sqlite3 not installed, skipping.');
  process.exit(0);
}

const require = createRequire(import.meta.url);
// Target the major only — ABI is per-major, and prebuild-install's bundled
// abi table can lag behind the newest patch releases.
const electronMajor = require('electron/package.json').version.split('.')[0];

try {
  execSync(`npx prebuild-install -r electron -t ${electronMajor}.0.0`, {
    cwd: moduleDir,
    stdio: 'inherit',
  });
  console.log(`rebuild-native: better-sqlite3 bound to Electron ${electronMajor} ABI.`);
} catch {
  console.warn(
    'rebuild-native: no prebuilt binary for this Electron version — ' +
      'run "npx electron-rebuild -w better-sqlite3" (requires a C++ toolchain), ' +
      'or align the electron/better-sqlite3 versions (see README).'
  );
}
