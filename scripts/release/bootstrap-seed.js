'use strict';

const fs = require('node:fs/promises');

const { createBootstrapSeed } = require('../../target-model/bootstrap-seed');
const { EXPECT_TARGET_ABSENT, readTargetDataWithRevision, writeTargetData } = require('../../target-model/persistence');
const { assertOutsideRepository, parseFlagPairs } = require('./safety');

const MAX_BOOTSTRAP_INPUT_BYTES = 64 * 1024;

async function readPrivateInput(inputPath) {
  const stats = await fs.lstat(inputPath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Bootstrap input must be a regular non-symlink file');
  if ((stats.mode & 0o777) !== 0o600) throw new Error('Bootstrap input must use mode 0600');
  if (stats.size > MAX_BOOTSTRAP_INPUT_BYTES) throw new Error('Bootstrap input exceeds the bounded input limit');
  return JSON.parse(await fs.readFile(inputPath, 'utf8'));
}

async function run(argv = process.argv.slice(2), repositoryRoot = process.cwd()) {
  const args = parseFlagPairs(argv, new Set(['--input', '--output']));
  const inputPath = assertOutsideRepository(args['--input'], repositoryRoot, 'Private bootstrap input');
  const outputPath = assertOutsideRepository(args['--output'], repositoryRoot, 'Private staged seed');
  if (inputPath === outputPath) throw new Error('Bootstrap input and staged output must be different files');
  const seed = createBootstrapSeed(await readPrivateInput(inputPath));
  await writeTargetData(outputPath, seed, { expectedRevision: EXPECT_TARGET_ABSENT });
  const { document, revision } = await readTargetDataWithRevision(outputPath);
  const stats = await fs.stat(outputPath);
  const result = {
    schemaVersion: document.schemaVersion,
    sha256: revision,
    byteSize: stats.size,
    mode: `0${(stats.mode & 0o777).toString(8)}`,
    counts: {
      organizations: document.organizations.length,
      workspaces: document.workspaces.length,
      scopes: document.scopes.length,
      operationalRecords: 0
    }
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`Private bootstrap failed: ${String(error?.code || error?.name || 'BOOTSTRAP_ERROR')}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  MAX_BOOTSTRAP_INPUT_BYTES,
  readPrivateInput,
  run
};
