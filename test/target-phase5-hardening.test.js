'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createBootstrapSeed, normalizeBootstrapDefinition } = require('../target-model/bootstrap-seed');
const { createCleanSeed } = require('../target-model/clean-seed');
const { serializeTargetData } = require('../target-model/persistence');
const { createTargetApiApp } = require('../target-server/app');
const { createOperationalLogger } = require('../target-server/operational-log');
const { validateTargetStartup } = require('../target-server/start');
const { requestApp } = require('../test-support/target-api-harness');
const { assertBootstrapOnly, validateSeed } = require('../scripts/release/validate-seed');
const { run: runBootstrap } = require('../scripts/release/bootstrap-seed');
const { scanText: scanLegacyText } = require('../scripts/release/legacy-scan');

async function harness(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'priorena-phase5-hardening-'));
  const targetDataFile = path.join(root, 'target-v3.json');
  const sourceFilesRoot = path.join(root, 'sources');
  await fs.mkdir(sourceFilesRoot, { mode: 0o700 });
  await fs.writeFile(targetDataFile, serializeTargetData(createCleanSeed()), { mode: 0o600 });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, sourceFilesRoot, targetDataFile };
}

test('release startup validates strict schema-v3 bytes before listening', async t => {
  const context = await harness(t);
  const before = await fs.readFile(context.targetDataFile);
  const validated = await validateTargetStartup(context);
  assert.match(validated.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(await fs.readFile(context.targetDataFile), before);

  for (const invalid of [
    Buffer.from('{"projects":{}}'),
    Buffer.from('{ invalid'),
    Buffer.from(JSON.stringify({ ...createCleanSeed(), schemaVersion: 99 }))
  ]) {
    await fs.writeFile(context.targetDataFile, invalid, { mode: 0o600 });
    await assert.rejects(validateTargetStartup(context), /target|schema|JSON|version/i);
    assert.deepEqual(await fs.readFile(context.targetDataFile), invalid);
  }
});

test('release startup rejects permissive modes and symlink endpoints', async t => {
  const context = await harness(t);
  await fs.chmod(context.targetDataFile, 0o644);
  await assert.rejects(validateTargetStartup(context), /0600/);
  await fs.chmod(context.targetDataFile, 0o600);
  await fs.chmod(context.sourceFilesRoot, 0o755);
  await assert.rejects(validateTargetStartup(context), /group or world/);
  await fs.chmod(context.sourceFilesRoot, 0o700);

  const linkedData = path.join(context.root, 'linked-target.json');
  await fs.symlink(context.targetDataFile, linkedData);
  await assert.rejects(validateTargetStartup({ ...context, targetDataFile: linkedData }), /non-symlink/);
});

test('bounded operational logs stay private and exclude raw paths and payloads', async t => {
  const context = await harness(t);
  const logFile = path.join(context.root, 'private', 'target.log');
  const repositoryRoot = path.join(context.root, 'repository');
  await fs.mkdir(repositoryRoot, { mode: 0o700 });
  const logger = createOperationalLogger({
    logFile,
    repositoryRoot,
    clock: () => '2026-08-11T00:00:00.000Z'
  });
  logger.info('startup', {
    status: 'success',
    dataFileIdentity: 'a'.repeat(64),
    ignoredPayload: 'must not be logged',
    category: 'safe\ncategory'
  });
  logger.close();
  const stats = await fs.stat(logFile);
  const content = await fs.readFile(logFile, 'utf8');
  assert.equal(stats.mode & 0o777, 0o600);
  assert.doesNotMatch(content, /ignoredPayload|must not be logged/);
  assert.doesNotMatch(content, /\\ncategory/);
  assert.match(content, /"dataFileIdentity":"a{64}"/);
  assert.throws(() => createOperationalLogger({
    logFile: path.join(repositoryRoot, 'tracked.log'),
    repositoryRoot
  }), /outside the repository/);

  const outsideLookingAlias = path.join(context.root, 'outside-looking-alias');
  await fs.symlink(repositoryRoot, outsideLookingAlias, 'dir');
  assert.throws(() => createOperationalLogger({
    logFile: path.join(outsideLookingAlias, 'escaped.log'),
    repositoryRoot
  }), /outside the repository/);
  await assert.rejects(fs.stat(path.join(repositoryRoot, 'escaped.log')), { code: 'ENOENT' });
});

test('private bootstrap output cannot enter the repository through a symlinked ancestor', async t => {
  const context = await harness(t);
  const repositoryRoot = path.join(context.root, 'repository');
  const outsideLookingAlias = path.join(context.root, 'bootstrap-output-alias');
  const inputPath = path.join(context.root, 'private-bootstrap-input.json');
  await fs.mkdir(repositoryRoot, { mode: 0o700 });
  await fs.symlink(repositoryRoot, outsideLookingAlias, 'dir');
  await fs.writeFile(inputPath, JSON.stringify({
    organization: { name: 'Fictional Organization' },
    workspace: { name: 'Fictional Workspace' },
    scopes: [{ name: 'Fictional Scope' }]
  }), { mode: 0o600 });
  await assert.rejects(runBootstrap([
    '--input', inputPath,
    '--output', path.join(outsideLookingAlias, 'private-seed.json')
  ], repositoryRoot), /outside the repository/);
  await assert.rejects(fs.stat(path.join(repositoryRoot, 'private-seed.json')), { code: 'ENOENT' });
});

test('target API and assets have independent bounded local rate limits', async t => {
  const context = await harness(t);
  const api = createTargetApiApp({
    ...context,
    rateLimit: { apiLimit: 2, assetLimit: 2, windowMs: 60_000 }
  }).app;
  assert.equal((await requestApp(api, { url: '/api/v2/organizations' })).status, 200);
  assert.equal((await requestApp(api, { url: '/api/v2/organizations' })).status, 200);
  const limitedApi = await requestApp(api, { url: '/api/v2/organizations' });
  assert.equal(limitedApi.status, 429);
  assert.equal(limitedApi.json().error.code, 'RATE_LIMITED');

  assert.equal((await requestApp(api, { url: '/target-modules/target-context-state.js' })).status, 200);
  assert.equal((await requestApp(api, { url: '/target-modules/target-workflow-state.js' })).status, 200);
  const limitedAsset = await requestApp(api, { url: '/target-modules/target-briefing-state.js' });
  assert.equal(limitedAsset.status, 429);
});

test('release UI method allowlists fail closed', async t => {
  const context = await harness(t);
  const { app } = createTargetApiApp(context);
  const response = await requestApp(app, { method: 'POST', url: '/target/' });
  assert.equal(response.status, 405);
  assert.equal(response.json().error.code, 'METHOD_NOT_ALLOWED');
  assert.match(response.headers['content-security-policy'], /default-src 'none'/);
});

test('bounded-log failures cannot replace the safe client error response', async t => {
  const context = await harness(t);
  const { app } = createTargetApiApp({
    ...context,
    logger: { error: () => { throw new Error('simulated bounded-log failure'); } }
  });
  await fs.writeFile(context.targetDataFile, Buffer.from('{ invalid'), { mode: 0o600 });
  const response = await requestApp(app, { url: '/api/v2/organizations' });
  assert.equal(response.status, 500);
  assert.deepEqual(response.json(), { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  assert.doesNotMatch(response.body, /bounded-log|invalid|targetDataFile/);
});

test('generic private bootstrap is deterministic, strict, and target-only', () => {
  const definition = {
    organization: { name: 'Organization 1' },
    workspace: { name: 'PM Workspace 1' },
    scopes: [
      { name: 'Scope 1' },
      { name: 'Scope 2' },
      { name: 'Scope 3' },
      { name: 'Scope 4' }
    ]
  };
  const first = createBootstrapSeed(definition);
  const second = createBootstrapSeed(structuredClone(definition));
  assert.deepEqual(first, second);
  assert.equal(serializeTargetData(first), serializeTargetData(second));
  assertBootstrapOnly(first);
  assert.equal(first.workItems.length, 0);
  assert.equal(first.features.length, 0);
  assert.equal(first.jiraEpicMappings.length, 0);
  assert.equal(first.briefings.length, 0);
  assert.doesNotMatch(JSON.stringify(first), /Miscellaneous|No Epic/i);
  assert.deepEqual(first.organizations.map(item => item.id), ['org-1']);
  assert.deepEqual(first.workspaces.map(item => item.id), ['workspace-1']);
  assert.deepEqual(first.scopes.map(item => item.id), ['scope-1', 'scope-2', 'scope-3', 'scope-4']);
  assert.throws(() => normalizeBootstrapDefinition({ ...definition, unexpected: true }), /unsupported fields/);
  assert.throws(() => normalizeBootstrapDefinition({ ...definition, scopes: [{ name: 'Same' }, { name: 'same' }] }), /unique/);
});

test('staged-seed validation rejects operational history and permissive modes', async t => {
  const context = await harness(t);
  const result = await validateSeed(context.targetDataFile);
  assert.equal(result.schemaVersion, 3);
  assert.equal(result.counts.operationalRecords, 0);

  const withHistory = createCleanSeed();
  withHistory.auditEvents.push({});
  await fs.writeFile(context.targetDataFile, JSON.stringify(withHistory), { mode: 0o600 });
  await assert.rejects(validateSeed(context.targetDataFile));

  await fs.writeFile(context.targetDataFile, serializeTargetData(createCleanSeed()), { mode: 0o600 });
  await fs.chmod(context.targetDataFile, 0o644);
  await assert.rejects(validateSeed(context.targetDataFile), /0600/);
});

test('legacy regression scan catches active behavior and permits only narrow enforcement references', () => {
  const legacyCollection = 'delivery' + 'Projects';
  const nativePopup = 'con' + 'firm(';
  const catchAllScope = ['miscellaneous', ' / ', 'no epic'].join('');
  const compactCatchAllScope = ['miscellaneous', '/', 'no epic'].join('');
  const legacyRootCollection = ['pro', 'jects'].join('');
  assert.ok(scanLegacyText('target-server/example.js', `const value = document.${legacyCollection};`).length);
  assert.ok(scanLegacyText('public/target/example.js', `window.${nativePopup}\"Apply?\")`).length);
  const safeSchemaLine = `const FORBIDDEN_SCOPE_NAMES = new Set(['unassigned', '${catchAllScope}', '${compactCatchAllScope}', 'no epic']);`;
  assert.deepEqual(scanLegacyText('target-model/schema.js', safeSchemaLine), []);
  assert.ok(scanLegacyText('target-model/schema.js', `${safeSchemaLine}\nfunction defaultScope(){ return '${catchAllScope}'; }`).length);
  assert.ok(scanLegacyText('scripts/release/rehearse.js', `const legacyBytes = Buffer.from('{"${legacyRootCollection}": {}}\\n');\nconst releaseData = { ${legacyRootCollection}: { active: true } };`).length);
  assert.ok(scanLegacyText('target-server/example.js', catchAllScope).length);
});

test('CI fetches the known rollback commit history before running the exact-revision rehearsal', async () => {
  const workflow = await fs.readFile(path.join(__dirname, '..', '.github', 'workflows', 'security-gate.yml'), 'utf8');
  assert.match(workflow, /uses: actions\/checkout@[^\n]+[\s\S]{0,200}fetch-depth: 0[\s\S]{0,100}persist-credentials: false/);
});

test('CI provides fail-closed process inspection before the release rehearsal', async () => {
  const workflow = await fs.readFile(path.join(__dirname, '..', '.github', 'workflows', 'security-gate.yml'), 'utf8');
  const prerequisite = workflow.indexOf('name: Ensure release process inspection is available');
  const gate = workflow.indexOf('name: Run the complete security gate');
  assert.ok(prerequisite > -1 && prerequisite < gate);
  assert.match(workflow, /if ! command -v lsof[^\n]+[\s\S]{0,160}apt-get install --yes --no-install-recommends lsof[\s\S]{0,100}command -v lsof/);
});
