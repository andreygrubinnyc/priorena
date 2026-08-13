'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough, Readable } = require('node:stream');
const test = require('node:test');

const { createTargetApiClient, createTargetContextController } = require('../public/target-context-state');
const { createTargetApiApp, TARGET_API_NAMESPACE } = require('../target-server/app');
const { PUBLIC_ERRORS } = require('../target-server/errors');
const { MAX_SOURCE_FILE_BYTES } = require('../target-server/source-files');
const { EXPECT_TARGET_ABSENT, writeTargetData } = require('../target-model/persistence');
const { validateTargetData } = require('../target-model/schema');
const { createMultiOrganizationFixture } = require('../test-support/target-v3-fixtures');

const ALPHA = Object.freeze({
  organizationId: 'org-fixture-alpha',
  workspaceId: 'workspace-alpha-shared',
  sourceId: 'source-alpha-sentinel',
  briefingId: 'briefing-alpha',
  versionId: 'briefing-version-alpha-communicated',
  fileText: 'ALPHA FILE SENTINEL — fictional local Source file.\n'
});
const BETA = Object.freeze({
  organizationId: 'org-fixture-beta',
  workspaceId: 'workspace-beta-shared',
  sourceId: 'source-beta-sentinel',
  briefingId: 'briefing-beta',
  versionId: 'briefing-version-beta-draft',
  fileText: 'BETA FILE SENTINEL — fictional local Source file.\n'
});

function requestApp(app, { method = 'GET', url = '/', headers = {}, body = Buffer.alloc(0) } = {}) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    let pushed = false;
    const req = new Readable({
      read() {
        if (pushed) return;
        pushed = true;
        if (payload.length) this.push(payload);
        this.push(null);
      }
    });
    req.method = method;
    req.url = url;
    req.headers = { host: '127.0.0.1:3000', ...headers };
    req.rawHeaders = Object.entries(req.headers).flat();
    req.socket = new PassThrough();
    Object.defineProperty(req.socket, 'remoteAddress', { value: '127.0.0.1' });
    req.connection = req.socket;
    req.on('error', reject);

    const responseHeaders = Object.create(null);
    const chunks = [];
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headersSent = false;
    res.destroyed = false;
    res.setHeader = (name, value) => { responseHeaders[String(name).toLowerCase()] = value; };
    res.getHeader = name => responseHeaders[String(name).toLowerCase()];
    res.getHeaders = () => ({ ...responseHeaders });
    res.removeHeader = name => { delete responseHeaders[String(name).toLowerCase()]; };
    res.write = (chunk, encoding, callback) => {
      res.headersSent = true;
      if (chunk) chunks.push(Buffer.from(chunk));
      if (typeof encoding === 'function') encoding();
      if (callback) callback();
      return true;
    };
    res.end = (chunk, encoding, callback) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      res.headersSent = true;
      res.finished = true;
      if (typeof encoding === 'function') encoding();
      if (callback) callback();
      const bytes = Buffer.concat(chunks);
      res.emit('finish');
      resolve({
        status: res.statusCode,
        headers: responseHeaders,
        bytes,
        body: bytes.toString('utf8'),
        json() { return JSON.parse(this.body); }
      });
    };
    res.destroy = error => {
      res.destroyed = true;
      if (error) reject(error);
      res.emit('close');
    };
    res.writeHead = (statusCode, nextHeaders) => {
      res.statusCode = statusCode;
      if (nextHeaders) Object.entries(nextHeaders).forEach(([name, value]) => res.setHeader(name, value));
      res.headersSent = true;
      return res;
    };
    app.handle(req, res, reject);
  });
}

function prepareInitialFixture() {
  const document = createMultiOrganizationFixture();
  const communicated = document.briefingVersions.find(version => version.id === ALPHA.versionId);
  communicated.status = 'finalized';
  communicated.communicatedAt = null;
  document.briefings.find(briefing => briefing.id === ALPHA.briefingId).lastCommunicatedVersionId = null;
  document.globalTechnicalSettings.customerContext = 'GLOBAL CUSTOMER CONTEXT SENTINEL — must never enter scoped AI context.';
  return document;
}

async function createHarness(t, mutate = () => {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'priorena-target-api-'));
  const sourceFilesRoot = path.join(root, 'source-files');
  const targetDataFile = path.join(root, 'target-v4.json');
  await fs.mkdir(sourceFilesRoot, { mode: 0o700 });
  const document = prepareInitialFixture();

  for (const context of [ALPHA, BETA]) {
    const fileName = `${context.organizationId}.txt`;
    const bytes = Buffer.from(context.fileText);
    await fs.writeFile(path.join(sourceFilesRoot, fileName), bytes, { mode: 0o600 });
    const source = document.sources.find(item => item.id === context.sourceId);
    source.metadata.file = {
      relativePath: fileName,
      displayName: `${context.organizationId}-source.txt`,
      mediaType: 'text/plain',
      byteLength: bytes.length
    };
  }

  await mutate({ document, root, sourceFilesRoot, targetDataFile });
  validateTargetData(document);
  await writeTargetData(targetDataFile, document, { expectedRevision: EXPECT_TARGET_ABSENT });
  const { app, services } = createTargetApiApp({ targetDataFile, sourceFilesRoot });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { app, document, root, services, sourceFilesRoot, targetDataFile };
}

function workspaceBase(context) {
  return `${TARGET_API_NAMESPACE}/organizations/${context.organizationId}/workspaces/${context.workspaceId}`;
}

function notFoundBody() {
  return { error: { code: 'NOT_FOUND', message: PUBLIC_ERRORS.NOT_FOUND.message } };
}

function assertNoSentinel(value, sentinels) {
  const serialized = Buffer.isBuffer(value) ? value.toString('utf8') : JSON.stringify(value);
  sentinels.forEach(sentinel => assert.doesNotMatch(serialized, new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')));
}

test('target services require explicit isolated data and Source-file paths', () => {
  assert.throws(() => createTargetApiApp({}), /explicit schema-v4 data-file path/);
  assert.throws(() => createTargetApiApp({ targetDataFile: 'target-v4.json' }), /explicit safe root/);
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'target-server', 'services.js'), 'utf8');
  assert.doesNotMatch(source, /PMDS_DATA_FILE|PMDS_UPLOADS_DIR|\.priorena-data|pilot-data\.json/);
  assert.doesNotMatch(source, /require\(['"]\.\.\/server['"]\)/);
  const targetSource = require('node:fs').readdirSync(path.join(__dirname, '..', 'target-server'))
    .filter(file => file.endsWith('.js'))
    .map(file => require('node:fs').readFileSync(path.join(__dirname, '..', 'target-server', file), 'utf8'))
    .join('\n');
  assert.doesNotMatch(targetSource, /\bfetch\s*\(|require\(['"]node:https?['"]\)|https?:\/\//);
});

test('resolver routes use stable IDs and keep malformed IDs distinct from unknown or foreign IDs', async t => {
  const { app } = await createHarness(t);
  let response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}` });
  assert.equal(response.status, 200);
  assert.equal(response.json().organization.id, ALPHA.organizationId);

  response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/bad%20id` });
  assert.equal(response.status, 400);
  assert.equal(response.json().error.code, 'INVALID_ID');

  const unknown = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/org-fixture-unknown/workspaces/${ALPHA.workspaceId}` });
  const foreign = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${BETA.organizationId}/workspaces/${ALPHA.workspaceId}` });
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.json(), notFoundBody());
  assert.deepEqual(foreign.json(), unknown.json());
});

test('Organization and Workspace listings expose safe metadata and preserve duplicate-name ID identity', async t => {
  const { app } = await createHarness(t);
  let response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations` });
  assert.equal(response.status, 200);
  assert.equal(response.json().organizations.length, 2);
  response.json().organizations.forEach(organization => {
    assert.deepEqual(Object.keys(organization).sort(), ['archived', 'description', 'id', 'name']);
  });

  response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}/workspaces` });
  const workspaces = response.json().workspaces;
  assert.equal(workspaces.length, 2);
  assert.ok(workspaces.every(workspace => workspace.organizationId === ALPHA.organizationId));
  assertNoSentinel(workspaces, ['org-fixture-beta', 'BETA SENTINEL']);

  const betaResponse = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${BETA.organizationId}/workspaces` });
  assert.equal(workspaces.find(item => item.id === ALPHA.workspaceId).name, betaResponse.json().workspaces[0].name);
  assert.notEqual(workspaces.find(item => item.id === ALPHA.workspaceId).id, betaResponse.json().workspaces[0].id);
});

test('active context revalidates explicit and remembered Workspace IDs within the Organization', async t => {
  const { app } = await createHarness(t);
  let response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/context?organizationId=${ALPHA.organizationId}` });
  assert.equal(response.status, 200);
  assert.equal(response.json().workspace.id, ALPHA.workspaceId);

  response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/context?organizationId=${ALPHA.organizationId}&workspaceId=${BETA.workspaceId}` });
  assert.equal(response.status, 404);
  assert.deepEqual(response.json(), notFoundBody());

  response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/context?organizationId=${ALPHA.organizationId}&workspaceId=workspace-unknown` });
  assert.equal(response.status, 404);
  assert.deepEqual(response.json(), notFoundBody());
});

test('Portfolio is an Organization-only projection with stable Workspace rows and local counts', async t => {
  const { app } = await createHarness(t);
  const response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}/portfolio` });
  assert.equal(response.status, 200);
  const portfolio = response.json();
  assert.equal(portfolio.organization.id, ALPHA.organizationId);
  assert.equal(portfolio.counts.workspaces, 2);
  assert.equal(portfolio.counts.workItems, 3);
  assert.equal(portfolio.counts.unassignedWorkItems, 1);
  assert.equal(portfolio.workspaces.find(item => item.id === ALPHA.workspaceId).counts.workItems, 2);
  assertNoSentinel(portfolio, ['org-fixture-beta', 'workspace-beta-shared', 'BETA SENTINEL', 'BETA MILESTONE']);

  const absentGlobal = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/portfolio` });
  assert.equal(absentGlobal.status, 404);
});

test('Today is Workspace-scoped and preserves Unassigned as scopeId null', async t => {
  const { app } = await createHarness(t);
  const response = await requestApp(app, { url: `${workspaceBase(ALPHA)}/today` });
  assert.equal(response.status, 200);
  const today = response.json();
  assert.equal(today.organization.id, ALPHA.organizationId);
  assert.equal(today.workspace.id, ALPHA.workspaceId);
  assert.equal(today.counts.workItems, 2);
  assert.equal(today.counts.unassignedWorkItems, 1);
  const unassigned = today.workItems.find(item => item.id === 'work-item-alpha-unassigned');
  assert.equal(unassigned.scopeId, null);
  assert.equal(unassigned.scope, null);
  assertNoSentinel(today, ['org-fixture-beta', 'workspace-beta-shared', 'BETA SENTINEL', 'BETA MILESTONE']);

  const foreign = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}/workspaces/${BETA.workspaceId}/today` });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.json(), notFoundBody());
});

test('parent-scoped search validates bounds and returns only safe local metadata', async t => {
  const { app } = await createHarness(t);
  for (const query of ['', 'x', `x${'y'.repeat(200)}`, '%20alpha']) {
    const response = await requestApp(app, { url: `${workspaceBase(ALPHA)}/search?q=${query}` });
    assert.equal(response.status, 400);
    assert.equal(response.json().error.code, 'INVALID_QUERY');
  }

  let response = await requestApp(app, { url: `${workspaceBase(ALPHA)}/search?q=fictional` });
  assert.equal(response.status, 200);
  assert.ok(response.json().results.length > 0);
  assert.ok(response.json().results.every(result => result.workspaceId === ALPHA.workspaceId));
  assertNoSentinel(response.json(), ['org-fixture-beta', 'workspace-beta-shared', 'BETA SENTINEL']);

  response = await requestApp(app, { url: `${workspaceBase(ALPHA)}/search?q=source` });
  const sourceResult = response.json().results.find(result => result.kind === 'source');
  assert.ok(sourceResult);
  assert.equal(sourceResult.content, undefined);
  assert.equal(sourceResult.provenance, undefined);
});

test('every Workspace-owned child route rejects known IDs under wrong parents like unknown IDs', async t => {
  const { app } = await createHarness(t);
  const cases = [
    ['scopes', 'scope-alpha-multiple-mappings'],
    ['jira-epic-mappings', 'jira-mapping-alpha-one'],
    ['work-items', 'work-item-alpha-assigned'],
    ['milestones', 'milestone-alpha-workspace'],
    ['sources', ALPHA.sourceId],
    ['findings', 'finding-alpha-accepted'],
    ['evidence', 'evidence-alpha-accepted'],
    ['proposed-changes', 'proposed-change-alpha-status']
  ];
  for (const [route, id] of cases) {
    const valid = await requestApp(app, { url: `${workspaceBase(ALPHA)}/${route}/${id}` });
    assert.equal(valid.status, 200, `${route} valid`);
    const wrongWorkspace = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}/workspaces/workspace-alpha-secondary/${route}/${id}` });
    const wrongOrganization = await requestApp(app, { url: `${workspaceBase(BETA)}/${route}/${id}` });
    const unknown = await requestApp(app, { url: `${workspaceBase(ALPHA)}/${route}/${route}-unknown` });
    assert.equal(wrongWorkspace.status, 404, `${route} wrong Workspace`);
    assert.deepEqual(wrongWorkspace.json(), unknown.json(), `${route} unknown shape`);
    assert.deepEqual(wrongOrganization.json(), unknown.json(), `${route} wrong Organization shape`);
  }
});

test('Source list and detail separate metadata from explicitly parent-validated content', async t => {
  const { app } = await createHarness(t);
  let response = await requestApp(app, { url: `${workspaceBase(ALPHA)}/sources` });
  assert.equal(response.status, 200);
  assert.equal(response.json().sources.length, 1);
  assert.equal(response.json().sources[0].content, undefined);
  assert.deepEqual(response.json().sources[0].file, {
    displayName: `${ALPHA.organizationId}-source.txt`,
    mediaType: 'text/plain',
    byteLength: Buffer.byteLength(ALPHA.fileText)
  });
  assertNoSentinel(response.json(), ['relativePath', 'org-fixture-beta', 'BETA SENTINEL']);

  response = await requestApp(app, { url: `${workspaceBase(ALPHA)}/sources/${ALPHA.sourceId}` });
  assert.equal(response.status, 200);
  assert.match(response.json().source.content, /fictional Alpha dependency/);
  assertNoSentinel(response.json(), ['org-fixture-beta', 'BETA SENTINEL']);
});

test('Source responses and Organization archives omit raw paths and arbitrary file metadata', async t => {
  const rawPath = '/private/fictional-review/source-note.txt';
  const { app } = await createHarness(t, ({ document }) => {
    const source = document.sources.find(item => item.id === ALPHA.sourceId);
    source.metadata.file.displayName = rawPath;
    source.metadata.capture = { originalLocalPath: rawPath };
  });

  const list = await requestApp(app, { url: `${workspaceBase(ALPHA)}/sources` });
  assert.equal(list.status, 200);
  assert.equal(list.json().sources[0].file.displayName, 'source-note.txt');
  assertNoSentinel(list.json(), ['/private/fictional-review', 'originalLocalPath', 'relativePath']);

  for (const kind of ['export', 'backup']) {
    const response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}/${kind}` });
    assert.equal(response.status, 200);
    assertNoSentinel(response.json(), ['/private/fictional-review', 'originalLocalPath', 'relativePath']);
  }
});

test('Source Finding and Evidence routes validate the full Source parent chain', async t => {
  const { app } = await createHarness(t);
  let response = await requestApp(app, { url: `${workspaceBase(ALPHA)}/sources/${ALPHA.sourceId}/findings` });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json().findings.map(item => item.id), ['finding-alpha-accepted']);
  response = await requestApp(app, { url: `${workspaceBase(ALPHA)}/sources/${ALPHA.sourceId}/findings/finding-alpha-accepted` });
  assert.equal(response.status, 200);
  response = await requestApp(app, { url: `${workspaceBase(ALPHA)}/sources/${ALPHA.sourceId}/evidence/evidence-alpha-accepted` });
  assert.equal(response.status, 200);

  const foreignFinding = await requestApp(app, { url: `${workspaceBase(ALPHA)}/sources/${ALPHA.sourceId}/findings/finding-beta-accepted` });
  const foreignEvidence = await requestApp(app, { url: `${workspaceBase(ALPHA)}/sources/${ALPHA.sourceId}/evidence/evidence-beta-accepted` });
  assert.deepEqual(foreignFinding.json(), notFoundBody());
  assert.deepEqual(foreignEvidence.json(), notFoundBody());
});

test('Source-file access returns bounded bytes only after parent and metadata validation', async t => {
  const { app } = await createHarness(t);
  const response = await requestApp(app, { url: `${workspaceBase(ALPHA)}/sources/${ALPHA.sourceId}/file` });
  assert.equal(response.status, 200);
  assert.equal(response.body, ALPHA.fileText);
  assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(response.headers['content-length'], String(Buffer.byteLength(ALPHA.fileText)));
  assert.match(response.headers['content-disposition'], /org-fixture-alpha-source\.txt/);
  assertNoSentinel(response.headers, ['relativePath', 'source-files']);
});

test('foreign and nonexistent Source files have the same public response with no filesystem hints', async t => {
  const { app } = await createHarness(t);
  const foreign = await requestApp(app, { url: `${workspaceBase(BETA)}/sources/${ALPHA.sourceId}/file` });
  const unknown = await requestApp(app, { url: `${workspaceBase(BETA)}/sources/source-unknown/file` });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.json(), notFoundBody());
  assert.deepEqual(foreign.json(), unknown.json());
  assertNoSentinel(foreign.json(), ['alpha', 'source-files', '.txt']);
});

test('Source-file containment, type, metadata-size, and missing-file checks fail closed', async t => {
  const mutations = [
    metadata => { metadata.relativePath = '../outside.txt'; },
    metadata => { metadata.displayName = 'unsafe.exe'; metadata.mediaType = 'application/octet-stream'; },
    metadata => { metadata.byteLength = MAX_SOURCE_FILE_BYTES + 1; },
    metadata => { metadata.relativePath = 'missing.txt'; }
  ];
  for (const mutateMetadata of mutations) {
    await t.test(mutateMetadata.toString().slice(0, 60), async child => {
      const { app } = await createHarness(child, async ({ document, root }) => {
        const metadata = document.sources.find(source => source.id === ALPHA.sourceId).metadata.file;
        mutateMetadata(metadata);
        if (metadata.relativePath === '../outside.txt') await fs.writeFile(path.join(root, 'outside.txt'), ALPHA.fileText);
      });
      const response = await requestApp(app, { url: `${workspaceBase(ALPHA)}/sources/${ALPHA.sourceId}/file` });
      assert.equal(response.status, 404);
      assert.deepEqual(response.json(), notFoundBody());
    });
  }
});

test('Source-file access rejects an ancestor symlink swap after real-path validation', async t => {
  let insideDirectory;
  let relocatedDirectory;
  let outsideDirectory;
  let insidePath;
  const insideText = 'INSIDE FILE SENTINEL'.padEnd(64, '.');
  const outsideText = 'OUTSIDE PATH SENTINEL'.padEnd(64, '!');
  assert.equal(Buffer.byteLength(insideText), Buffer.byteLength(outsideText));

  const { app } = await createHarness(t, async ({ document, root, sourceFilesRoot }) => {
    insideDirectory = path.join(sourceFilesRoot, 'nested');
    relocatedDirectory = path.join(sourceFilesRoot, 'nested-original');
    outsideDirectory = path.join(root, 'outside');
    insidePath = path.join(insideDirectory, 'alpha.txt');
    await fs.mkdir(insideDirectory);
    await fs.mkdir(outsideDirectory);
    await fs.writeFile(insidePath, insideText, { mode: 0o600 });
    await fs.writeFile(path.join(outsideDirectory, 'alpha.txt'), outsideText, { mode: 0o600 });
    document.sources.find(item => item.id === ALPHA.sourceId).metadata.file = {
      relativePath: 'nested/alpha.txt',
      displayName: 'alpha.txt',
      mediaType: 'text/plain',
      byteLength: Buffer.byteLength(insideText)
    };
  });

  const expectedOpenPath = await fs.realpath(insidePath);
  const originalOpen = fs.open;
  let swapped = false;
  fs.open = async function guardedOpen(candidate, ...args) {
    if (!swapped && candidate === expectedOpenPath) {
      swapped = true;
      await fs.rename(insideDirectory, relocatedDirectory);
      await fs.symlink(outsideDirectory, insideDirectory, 'dir');
    }
    return originalOpen.call(fs, candidate, ...args);
  };
  try {
    const response = await requestApp(app, { url: `${workspaceBase(ALPHA)}/sources/${ALPHA.sourceId}/file` });
    assert.equal(swapped, true);
    assert.equal(response.status, 404);
    assert.deepEqual(response.json(), notFoundBody());
    assertNoSentinel(response.body, ['OUTSIDE PATH SENTINEL']);
  } finally {
    fs.open = originalOpen;
  }
});

test('Briefing reads remain Organization-scoped and frozen content is returned without mutation commands', async t => {
  const { app, document } = await createHarness(t, ({ document: fixture }) => {
    fixture.briefingVersions.find(version => version.id === ALPHA.versionId).outputs = [{
      format: 'UNSAFE FORMAT SENTINEL',
      mediaType: 'application/x-fictional-private',
      body: 'Fictional local output body.'
    }];
  });
  let response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}/briefings` });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json().briefings.map(item => item.id), [ALPHA.briefingId]);
  assertNoSentinel(response.json(), ['org-fixture-beta', 'BETA BRIEFING']);

  response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}/briefings/${ALPHA.briefingId}/versions/${ALPHA.versionId}` });
  assert.equal(response.status, 200);
  const persistedVersion = document.briefingVersions.find(version => version.id === ALPHA.versionId);
  assert.deepEqual(response.json().version.frozenSnapshot, persistedVersion.frozenSnapshot);
  assert.equal(response.json().version.outputs, undefined);
  assert.ok(Array.isArray(response.json().version.outputMetadata));
  assert.equal(response.json().version.outputMetadata[0].format, null);
  assert.equal(response.json().version.outputMetadata[0].mediaType, 'application/json');
  assertNoSentinel(response.json(), ['UNSAFE FORMAT SENTINEL', 'application/x-fictional-private']);

  const foreign = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${BETA.organizationId}/briefings/${ALPHA.briefingId}` });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.json(), notFoundBody());
  for (const suffix of ['draft', 'finalize', 'communicate']) {
    const missing = await requestApp(app, { method: 'POST', url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}/briefings/${ALPHA.briefingId}/${suffix}` });
    assert.equal(missing.status, 405);
  }
});

test('Briefing Version detail, archives, and AI context fail closed on nested foreign records', async t => {
  const { app, services } = await createHarness(t, ({ document }) => {
    const foreignWorkItem = document.workItems.find(item => item.id === 'work-item-beta-assigned');
    const version = document.briefingVersions.find(item => item.id === ALPHA.versionId);
    version.frozenSnapshot = { selectedRecord: structuredClone(foreignWorkItem) };
    version.facts = [{ supportingRecordId: foreignWorkItem.id, summary: foreignWorkItem.summary }];
  });

  const detail = await requestApp(app, {
    url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}/briefings/${ALPHA.briefingId}/versions/${ALPHA.versionId}`
  });
  assert.equal(detail.status, 404);
  assert.deepEqual(detail.json(), notFoundBody());

  for (const kind of ['export', 'backup']) {
    const response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}/${kind}` });
    assert.equal(response.status, 404);
    assert.deepEqual(response.json(), notFoundBody());
  }

  const aiContext = await services.buildAiContext(ALPHA.organizationId, ALPHA.workspaceId);
  assertNoSentinel(aiContext.value, ['work-item-beta-assigned', 'BETA SENTINEL', 'org-fixture-beta']);
});

test('Organization export and ordinary backup share a bounded scoped projection without paths or globals', async t => {
  const { app } = await createHarness(t);
  for (const kind of ['export', 'backup']) {
    const response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}/${kind}` });
    assert.equal(response.status, 200);
    const archive = response.json();
    assert.equal(archive.scope.kind, kind);
    assert.deepEqual(archive.organizations.map(item => item.id), [ALPHA.organizationId]);
    assert.ok(archive.workspaces.every(item => item.organizationId === ALPHA.organizationId));
    assert.ok(archive.scopes.every(item => archive.workspaces.some(workspace => workspace.id === item.workspaceId)));
    assert.equal(archive.globalTechnicalSettings, undefined);
    assertNoSentinel(archive, ['org-fixture-beta', 'workspace-beta-shared', 'BETA SENTINEL', 'BETA PROMPT', 'relativePath', 'GLOBAL CUSTOMER CONTEXT']);
    assert.match(response.headers['content-disposition'], new RegExp(`priorena-organization-${kind}-${ALPHA.organizationId}\\.json`));
  }
  const globalExport = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/export` });
  const globalBackup = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/backup` });
  assert.equal(globalExport.status, 404);
  assert.equal(globalBackup.status, 404);
});

test('AI-context assembly is pure, exact, Workspace-scoped, and excludes global customer context', async t => {
  const { services } = await createHarness(t);
  const result = await services.buildAiContext(ALPHA.organizationId, ALPHA.workspaceId);
  const context = result.value;
  assert.equal(context.organization.id, ALPHA.organizationId);
  assert.equal(context.workspace.id, ALPHA.workspaceId);
  assert.match(context.workspace.draftingGuidance, /ALPHA GUIDANCE SENTINEL/);
  assert.match(JSON.stringify(context.workspace.promptOverrides), /ALPHA PROMPT SENTINEL/);
  assert.ok(context.sources.some(source => /Alpha dependency/.test(source.content)));
  assert.ok(context.evidence.some(item => item.id === 'evidence-alpha-accepted'));
  assert.deepEqual(context.briefings, []);
  assert.deepEqual(context.briefingVersions, []);
  assertNoSentinel(context, [
    'workspace-alpha-secondary',
    'ALPHA SECONDARY SENTINEL',
    'org-fixture-beta',
    'workspace-beta-shared',
    'BETA SENTINEL',
    'BETA PROMPT',
    'BETA BRIEFING',
    'GLOBAL CUSTOMER CONTEXT'
  ]);

  const betaContext = (await services.buildAiContext(BETA.organizationId, BETA.workspaceId)).value;
  assert.ok(betaContext.briefings.some(item => item.id === BETA.briefingId));
  assert.ok(betaContext.briefingVersions.some(item => item.id === BETA.versionId));
});

test('AI context and Organization archives enforce independent bounded-output limits', async t => {
  await t.test('AI context', async child => {
    const { services } = await createHarness(child, ({ document }) => {
      document.sources.find(source => source.id === ALPHA.sourceId).content = 'A'.repeat(600 * 1024);
    });
    await assert.rejects(services.buildAiContext(ALPHA.organizationId, ALPHA.workspaceId), error => error.code === 'OUTPUT_TOO_LARGE');
  });

  await t.test('Organization archive', async child => {
    const { app } = await createHarness(child, ({ document }) => {
      document.sources.find(source => source.id === ALPHA.sourceId).content = 'A'.repeat(2_000_000);
      document.findings.find(finding => finding.id === 'finding-alpha-accepted').exactExcerpt = 'F'.repeat(50_000);
      document.evidence.find(item => item.id === 'evidence-alpha-accepted').exactExcerpt = 'F'.repeat(50_000);
      const workItem = document.workItems.find(item => item.id === 'work-item-alpha-assigned');
      workItem.description = 'D'.repeat(20_000);
      workItem.notes = 'N'.repeat(20_000);
      document.workspaces.find(item => item.id === ALPHA.workspaceId).draftingGuidance = 'G'.repeat(20_000);
    });
    const response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}/export` });
    assert.equal(response.status, 413);
    assert.equal(response.json().error.code, 'OUTPUT_TOO_LARGE');
  });
});

test('client Organization switching clears all prior operational state before any next load resolves', async () => {
  let releaseBeta;
  const betaWorkspaces = new Promise(resolve => { releaseBeta = resolve; });
  const api = {
    async listWorkspaces(organizationId) {
      if (organizationId === BETA.organizationId) return betaWorkspaces;
      return { workspaces: [{ id: ALPHA.workspaceId, organizationId, name: 'Shared Delivery Workspace' }] };
    },
    async resolveContext(organizationId) {
      return { organization: { id: organizationId }, workspace: { id: organizationId === ALPHA.organizationId ? ALPHA.workspaceId : BETA.workspaceId } };
    },
    async loadPortfolio(organizationId) { return { organizationId, marker: `${organizationId} portfolio` }; },
    async loadToday(organizationId, workspaceId) { return { organizationId, workspaceId, workItems: [{ id: `${organizationId}-item` }], counts: { workItems: 1 } }; }
  };
  const controller = createTargetContextController(api);
  await controller.selectOrganization(ALPHA.organizationId);
  const alphaToken = controller.captureWorkspaceRequestToken();
  controller.replaceWorkspaceData(alphaToken, {
    pendingSelections: ['ALPHA SENTINEL'],
    searchResults: ['ALPHA SENTINEL'],
    sources: ['ALPHA SENTINEL'],
    evidence: ['ALPHA SENTINEL'],
    briefings: ['ALPHA SENTINEL'],
    renderedOutput: 'ALPHA SENTINEL'
  });

  const switching = controller.selectOrganization(BETA.organizationId);
  const duringLoad = controller.snapshot();
  assert.equal(duringLoad.activeOrganizationId, BETA.organizationId);
  assert.equal(duringLoad.activeWorkspaceId, null);
  assert.equal(duringLoad.portfolio, null);
  assert.equal(duringLoad.today, null);
  assertNoSentinel(duringLoad, ['ALPHA SENTINEL', 'org-fixture-alpha']);
  releaseBeta({ workspaces: [{ id: BETA.workspaceId, organizationId: BETA.organizationId, name: 'Shared Delivery Workspace' }] });
  const completed = await switching;
  assert.equal(completed.activeWorkspaceId, BETA.workspaceId);
  assertNoSentinel(completed, ['ALPHA SENTINEL', 'org-fixture-alpha']);
});

test('client ignores late operational responses after Organization and Workspace request tokens change', async () => {
  const controller = createTargetContextController({
    async listWorkspaces(organizationId) {
      return { workspaces: [{ id: `${organizationId}-workspace`, organizationId, name: 'Fictional Workspace' }] };
    },
    async resolveContext(organizationId, workspaceId) {
      return { organization: { id: organizationId }, workspace: { id: workspaceId || `${organizationId}-workspace` } };
    },
    async loadPortfolio(organizationId) { return { organizationId }; },
    async loadToday(organizationId, workspaceId) { return { organizationId, workspaceId, workItems: [], counts: {} }; }
  });

  await controller.selectOrganization('org-client-alpha');
  const alphaToken = controller.captureWorkspaceRequestToken();
  await controller.selectOrganization('org-client-beta');
  const betaToken = controller.captureWorkspaceRequestToken();

  controller.replaceWorkspaceData(alphaToken, {
    searchResults: ['ALPHA LATE RESPONSE'],
    sources: ['ALPHA LATE RESPONSE'],
    evidence: ['ALPHA LATE RESPONSE'],
    briefings: ['ALPHA LATE RESPONSE'],
    renderedOutput: 'ALPHA LATE RESPONSE'
  });
  let state = controller.snapshot();
  assert.equal(state.activeOrganizationId, 'org-client-beta');
  assertNoSentinel(state, ['ALPHA LATE RESPONSE', 'org-client-alpha']);

  controller.replaceWorkspaceData(betaToken, {
    searchResults: ['BETA CURRENT RESPONSE'],
    sources: ['BETA CURRENT RESPONSE'],
    evidence: ['BETA CURRENT RESPONSE'],
    briefings: ['BETA CURRENT RESPONSE'],
    renderedOutput: 'BETA CURRENT RESPONSE'
  });
  state = controller.snapshot();
  assert.match(JSON.stringify(state), /BETA CURRENT RESPONSE/);

  const workspaceToken = controller.captureWorkspaceRequestToken();
  await controller.selectWorkspace('org-client-beta-workspace-next');
  controller.replaceWorkspaceData(workspaceToken, { renderedOutput: 'OLD WORKSPACE RESPONSE' });
  assertNoSentinel(controller.snapshot(), ['OLD WORKSPACE RESPONSE']);
});

test('client failed saved-Workspace validation leaves an empty safe state', async () => {
  const calls = [];
  const controller = createTargetContextController({
    async listWorkspaces() { return { workspaces: [{ id: ALPHA.workspaceId, name: 'Shared Delivery Workspace' }] }; },
    async resolveContext(organizationId, workspaceId) {
      calls.push({ organizationId, workspaceId });
      throw new Error('Scoped context was rejected');
    },
    async loadPortfolio() { return { marker: 'must be discarded' }; },
    async loadToday() { throw new Error('must not load'); }
  });
  const state = await controller.selectOrganization(ALPHA.organizationId, { savedWorkspaceId: BETA.workspaceId });
  assert.deepEqual(calls, [{ organizationId: ALPHA.organizationId, workspaceId: BETA.workspaceId }]);
  assert.equal(state.activeWorkspaceId, null);
  assert.equal(state.portfolio, null);
  assert.equal(state.today, null);
  assert.deepEqual(state.workspaces, []);
  assert.deepEqual(state.searchResults, []);
  assert.equal(state.loading, false);
  assert.match(state.error, /rejected/);
});

test('client duplicate display names never replace stable-ID selection', async () => {
  const controller = createTargetContextController({
    async listWorkspaces(organizationId) {
      return { workspaces: [
        { id: 'workspace-one', organizationId, name: 'Duplicate Workspace' },
        { id: 'workspace-two', organizationId, name: 'Duplicate Workspace' }
      ] };
    },
    async resolveContext(organizationId, workspaceId) { return { organization: { id: organizationId }, workspace: { id: workspaceId || 'workspace-two' } }; },
    async loadPortfolio(organizationId) { return { organizationId }; },
    async loadToday(organizationId, workspaceId) { return { organizationId, workspaceId, workItems: [], counts: {} }; }
  });
  let state = await controller.selectOrganization('org-duplicates', { savedWorkspaceId: 'workspace-two' });
  assert.equal(state.activeWorkspaceId, 'workspace-two');
  state = await controller.selectWorkspace('workspace-one');
  assert.equal(state.activeWorkspaceId, 'workspace-one');
});

test('client API consumption constructs only stable parent-scoped Workspace, Portfolio, Today, and context URLs', async () => {
  const urls = [];
  const client = createTargetApiClient({
    async request(url) {
      urls.push(url);
      return { marker: url };
    }
  });
  await client.listWorkspaces(ALPHA.organizationId);
  await client.resolveContext(ALPHA.organizationId, ALPHA.workspaceId);
  await client.loadPortfolio(ALPHA.organizationId);
  await client.loadToday(ALPHA.organizationId, ALPHA.workspaceId);
  assert.deepEqual(urls, [
    `/api/v2/organizations/${ALPHA.organizationId}/workspaces`,
    `/api/v2/context?organizationId=${ALPHA.organizationId}&workspaceId=${ALPHA.workspaceId}`,
    `/api/v2/organizations/${ALPHA.organizationId}/portfolio`,
    `/api/v2/organizations/${ALPHA.organizationId}/workspaces/${ALPHA.workspaceId}/today`
  ]);
  urls.forEach(url => assert.doesNotMatch(url, /all-organizations|workspaceName|organizationName/));
  assert.throws(() => client.loadToday(ALPHA.organizationId, 'Shared Delivery Workspace'), /stable opaque ID/);
});

test('adversarial cross-surface integration contains zero foreign IDs or sentinel text in both directions', async t => {
  const { app, services } = await createHarness(t);
  const cases = [
    {
      own: ALPHA,
      foreign: ['org-fixture-beta', 'workspace-beta-shared', 'BETA SENTINEL', 'BETA PROMPT', 'BETA GUIDANCE', 'BETA BRIEFING', 'BETA FILE']
    },
    {
      own: BETA,
      foreign: ['org-fixture-alpha', 'workspace-alpha-shared', 'ALPHA SENTINEL', 'ALPHA PROMPT', 'ALPHA GUIDANCE', 'ALPHA BRIEFING', 'ALPHA FILE']
    }
  ];

  for (const { own, foreign } of cases) {
    const surfaces = [];
    surfaces.push((await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${own.organizationId}/portfolio` })).json());
    surfaces.push((await requestApp(app, { url: `${workspaceBase(own)}/today` })).json());
    surfaces.push((await requestApp(app, { url: `${workspaceBase(own)}/search?q=fictional` })).json());
    surfaces.push((await requestApp(app, { url: `${workspaceBase(own)}/sources/${own.sourceId}` })).json());
    surfaces.push((await requestApp(app, { url: `${workspaceBase(own)}/sources/${own.sourceId}/evidence` })).json());
    surfaces.push((await requestApp(app, { url: `${workspaceBase(own)}/sources/${own.sourceId}/file` })).bytes);
    surfaces.push((await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${own.organizationId}/briefings` })).json());
    surfaces.push((await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${own.organizationId}/export` })).json());
    surfaces.push((await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${own.organizationId}/backup` })).json());
    surfaces.push((await services.buildAiContext(own.organizationId, own.workspaceId)).value);
    surfaces.forEach(surface => assertNoSentinel(surface, foreign));
  }
});

test('target API retains loopback, headers, method, request-size, and revision protections', async t => {
  const { app } = await createHarness(t);
  let response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations`, headers: { host: 'attacker.example' } });
  assert.equal(response.status, 421);
  response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations` });
  assert.equal(response.status, 200);
  assert.match(response.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.headers['x-priorena-target-revision'], /^[a-f0-9]{64}$/);

  response = await requestApp(app, { method: 'POST', url: `${TARGET_API_NAMESPACE}/organizations`, headers: { origin: 'http://attacker.example' } });
  assert.equal(response.status, 403);
  response = await requestApp(app, { method: 'POST', url: `${TARGET_API_NAMESPACE}/organizations` });
  assert.equal(response.status, 405);
  assert.equal(response.json().error.code, 'METHOD_NOT_ALLOWED');
  response = await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations`, headers: { 'content-length': String(2 * 1024 * 1024 + 1) } });
  assert.equal(response.status, 413);
});

test('all read-only API and service operations leave the schema-v4 target file unchanged', async t => {
  const { app, services, targetDataFile } = await createHarness(t);
  const before = await fs.readFile(targetDataFile);
  await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}/portfolio` });
  await requestApp(app, { url: `${workspaceBase(ALPHA)}/today` });
  await requestApp(app, { url: `${workspaceBase(ALPHA)}/search?q=fictional` });
  await requestApp(app, { url: `${workspaceBase(ALPHA)}/sources/${ALPHA.sourceId}/file` });
  await requestApp(app, { url: `${TARGET_API_NAMESPACE}/organizations/${ALPHA.organizationId}/export` });
  await services.buildAiContext(ALPHA.organizationId, ALPHA.workspaceId);
  const after = await fs.readFile(targetDataFile);
  assert.deepEqual(after, before);
});
