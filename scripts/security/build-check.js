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
    'public/target/index.html',
    'public/target/app.js',
    'public/target/styles.css',
    'demo/demo-fixture.js',
    'demo/demo-session-store.js'
  ];
  for (const file of requiredFiles) assert.equal(fs.existsSync(file), true, `Missing required application file: ${file}`);

  const { app, isLoopbackHost } = require('../../server');
  assert.equal(typeof app?.handle, 'function');
  assert.equal(isLoopbackHost('127.0.0.1:3000'), true);
  assert.equal(isLoopbackHost('example.test:3000'), false);

  const targetDataFile = path.join(tempRoot, 'target-v2.json');
  const targetSourceFilesRoot = path.join(tempRoot, 'target-source-files');
  const { createCleanSeed } = require('../../target-model/clean-seed');
  const { serializeTargetData } = require('../../target-model/persistence');
  const { createTargetApiApp } = require('../../target-server/app');
  fs.mkdirSync(targetSourceFilesRoot, { mode: 0o700 });
  fs.writeFileSync(targetDataFile, serializeTargetData(createCleanSeed()), { mode: 0o600 });
  const target = createTargetApiApp({ targetDataFile, sourceFilesRoot: targetSourceFilesRoot });
  assert.equal(typeof target.app?.handle, 'function');
  const { parseArguments } = require('../../target-server/dev');
  assert.deepEqual(parseArguments([
    '--data-file', targetDataFile,
    '--source-files-root', targetSourceFilesRoot,
    '--port', '0'
  ]), { targetDataFile, sourceFilesRoot: targetSourceFilesRoot, port: 0 });
  console.log('Production validation build passed.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
