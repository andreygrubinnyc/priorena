'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'priorena-build-check-'));

try {
  process.env.PMDS_DATA_FILE = path.join(tempRoot, 'pilot-data.json');
  process.env.PMDS_UPLOADS_DIR = path.join(tempRoot, 'uploads');
  process.env.PMDS_RECOVERY_DIR = path.join(tempRoot, 'backups');
  process.env.PRIORENA_DEMO_MODE = '1';
  fs.writeFileSync(process.env.PMDS_DATA_FILE, JSON.stringify({ projects: {} }), { mode: 0o600 });

  const requiredFiles = [
    'public/index.html',
    'public/app.js',
    'public/styles.css',
    'demo/demo-fixture.js',
    'demo/demo-session-store.js'
  ];
  for (const file of requiredFiles) assert.equal(fs.existsSync(file), true, `Missing required application file: ${file}`);

  const { app, isLoopbackHost } = require('../../server');
  assert.equal(typeof app?.handle, 'function');
  assert.equal(isLoopbackHost('127.0.0.1:3000'), true);
  assert.equal(isLoopbackHost('example.test:3000'), false);
  console.log('Production validation build passed.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
