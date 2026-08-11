'use strict';

const fs = require('node:fs/promises');

const { readTargetDataWithRevision } = require('../../target-model/persistence');
const { parseFlagPairs, requireExplicitPath } = require('./safety');

const OPERATIONAL_COLLECTIONS = Object.freeze([
  'jiraEpicMappings',
  'workItems',
  'milestones',
  'sources',
  'findings',
  'evidence',
  'proposedChanges',
  'briefings',
  'briefingVersions',
  'auditEvents'
]);

function assertBootstrapOnly(document) {
  if (document.organizations.length < 1 || document.workspaces.length < 1) throw new Error('A staged seed requires at least one Organization and Workspace');
  for (const collection of OPERATIONAL_COLLECTIONS) {
    if (document[collection].length !== 0) throw new Error('A staged seed must not contain operational records or history');
  }
}

async function validateSeed(filePath) {
  const resolved = requireExplicitPath(filePath, 'Staged seed');
  const stats = await fs.lstat(resolved);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('The staged seed must be a regular non-symlink file');
  if ((stats.mode & 0o777) !== 0o600) throw new Error('The staged seed must use mode 0600');
  const { document, revision } = await readTargetDataWithRevision(resolved);
  assertBootstrapOnly(document);
  return {
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
}

async function run(argv = process.argv.slice(2)) {
  const args = parseFlagPairs(argv, new Set(['--data-file']));
  const result = await validateSeed(args['--data-file']);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`Staged-seed validation failed: ${String(error?.code || error?.name || 'SEED_VALIDATION_ERROR')}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  OPERATIONAL_COLLECTIONS,
  assertBootstrapOnly,
  run,
  validateSeed
};
