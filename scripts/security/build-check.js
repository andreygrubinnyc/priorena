'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'priorena-build-check-'));

async function run() {
  const requiredFiles = [
    'public/target/index.html',
    'public/target/app.js',
    'public/target/styles.css',
    'public/target-context-state.js',
    'public/target-workflow-state.js',
    'public/target-briefing-state.js'
  ];
  for (const file of requiredFiles) assert.equal(fs.existsSync(file), true, `Missing required application file: ${file}`);

  const targetDataFile = path.join(tempRoot, 'target-v3.json');
  const targetSourceFilesRoot = path.join(tempRoot, 'target-source-files');
  const privateLogFile = path.join(tempRoot, 'target.log');
  const { createCleanSeed } = require('../../target-model/clean-seed');
  const { serializeTargetData } = require('../../target-model/persistence');
  const { createTargetApiApp } = require('../../target-server/app');
  fs.mkdirSync(targetSourceFilesRoot, { mode: 0o700 });
  fs.writeFileSync(targetDataFile, serializeTargetData(createCleanSeed()), { mode: 0o600 });
  const target = createTargetApiApp({ targetDataFile, sourceFilesRoot: targetSourceFilesRoot });
  assert.equal(typeof target.app?.handle, 'function');
  const { parseArguments, validateTargetStartup } = require('../../target-server/start');
  assert.deepEqual(parseArguments([
    '--data-file', targetDataFile,
    '--source-files-root', targetSourceFilesRoot,
    '--log-file', privateLogFile,
    '--port', '0'
  ]), { targetDataFile, sourceFilesRoot: targetSourceFilesRoot, logFile: privateLogFile, port: 0 });
  const validated = await validateTargetStartup({ targetDataFile, sourceFilesRoot: targetSourceFilesRoot });
  assert.match(validated.revision, /^[a-f0-9]{64}$/);
  console.log('Production validation build passed.');
}

run()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
