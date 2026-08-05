'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
} catch {
  console.log('Git hooks were not installed because this is not a Git checkout.');
  process.exit(0);
}

for (const hook of ['.githooks/pre-commit', '.githooks/pre-push']) {
  if (!fs.existsSync(hook)) throw new Error(`Missing required hook: ${hook}`);
  fs.chmodSync(hook, 0o755);
}

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
console.log('Priorena secure Git hooks installed from .githooks/.');
