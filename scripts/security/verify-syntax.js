'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
}

try {
  const output = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.js'], { capture: true });
  const files = output.split('\0').filter(Boolean).filter(file => fs.existsSync(file));
  for (const file of files) run(process.execPath, ['--check', file]);
  console.log(`JavaScript syntax verification passed (${files.length} files).`);
} catch (error) {
  console.error(`JavaScript syntax verification failed: ${error.message}`);
  process.exitCode = 1;
}
