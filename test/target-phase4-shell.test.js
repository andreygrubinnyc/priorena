'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createCleanSeed } = require('../target-model/clean-seed');
const { serializeTargetData } = require('../target-model/persistence');
const { createTargetApiApp } = require('../target-server/app');
const { LOOPBACK_HOST, parseArguments } = require('../target-server/dev');
const {
  categorizeVersions,
  createTargetBriefingApiClient,
  targetStableId,
  validateBriefingResponse
} = require('../public/target-briefing-state');

const root = path.join(__dirname, '..');

async function source(file) {
  return fs.readFile(path.join(root, file), 'utf8');
}

function functionSlice(client, name, nextName) {
  const start = client.indexOf(`function ${name}`);
  const end = client.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return client.slice(start, end);
}

test('target development launcher requires explicit paths and binds only to loopback', () => {
  assert.equal(LOOPBACK_HOST, '127.0.0.1');
  assert.throws(() => parseArguments([]), /requires explicit/);
  assert.throws(() => parseArguments(['--data-file', 'target.json']), /requires explicit/);
  assert.throws(() => parseArguments(['--data-file', 'target.json', '--source-files-root', 'sources', '--port', '70000']), /port is invalid/);
  const parsed = parseArguments(['--data-file', 'target.json', '--source-files-root', 'sources', '--port', '0']);
  assert.equal(parsed.targetDataFile, path.join(process.cwd(), 'target.json'));
  assert.equal(parsed.sourceFilesRoot, path.join(process.cwd(), 'sources'));
  assert.equal(parsed.port, 0);
});

test('isolated target entry exposes the canonical hierarchy and operational navigation', async () => {
  const markup = await source('public/target/index.html');
  for (const expected of [
    'Organization', 'PM Workspace', 'Portfolio', 'Today', 'Work Items', 'Follow-Up', 'Milestones',
    'Add Source', 'Source Library', 'Review', 'Briefings', 'Settings', 'All scopes'
  ]) assert.match(markup, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  for (const prohibited of [
    'Project / Jira Epic', 'Project/Epic', 'All projects', 'whole PM workspace', 'Project stream',
    'Briefing stream', 'Project not identified', 'Miscellaneous / No Epic', 'Evidence pending',
    'Extracted DSU updates', 'Teams Draft', 'Status Summary'
  ]) assert.doesNotMatch(markup, new RegExp(prohibited.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

  assert.match(markup, /<main[^>]+id="target-main"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /<dialog[^>]+aria-labelledby="dialog-title"/);
  assert.match(markup, /No operational request runs before initialization/);
});

test('target client renders untrusted values as text and avoids blocking browser dialogs', async () => {
  const client = await source('public/target/app.js');
  assert.match(client, /textContent/);
  assert.match(client, /replaceChildren/);
  assert.doesNotMatch(client, /\.innerHTML\b/);
  assert.doesNotMatch(client, /\bwindow\.(?:alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(client, /(?:^|[^A-Za-z])(?:alert|confirm|prompt)\s*\(/m);
  assert.doesNotMatch(client, /javascript:/i);
  assert.doesNotMatch(client, /insertAdjacentHTML|outerHTML|document\.write/);
  assert.match(client, /elements\.initialize\.addEventListener\('click', initialize\)/);
  assert.match(client, /state\.context = null;[\s\S]*state\.workflow = null;/);
  assert.match(client, /generation !== state\.generation/);
  assert.match(client, /function clearBriefingData\(\)/);
  assert.equal((client.match(/clearBriefingData\(\);/g) || []).length >= 2, true);
  assert.match(client, /briefingOperationCurrent/);
  assert.match(client, /Manual PM input/);
  assert.match(client, /Mark as communicated/);
  assert.match(client, /Snapshot prepared/);
  assert.match(client, /Priorena does not send/);
  assert.match(client, /Priorena sent nothing/);
  assert.doesNotMatch(client, /sendBriefing|sendOutput|autoPublish/);
});

test('target DOM integration rejects late context renders and keeps page scope truthful', async () => {
  const client = await source('public/target/app.js');
  const portfolio = functionSlice(client, 'renderPortfolio', 'renderToday');
  const today = functionSlice(client, 'renderToday', 'visibleWorkItems');
  const organizationSelector = functionSlice(client, 'selectOrganization', 'selectWorkspace');
  const workspaceSelector = functionSlice(client, 'selectWorkspace', 'confirmAction');
  assert.match(portfolio, /const generation = state\.generation;[\s\S]*await requestJson[\s\S]*generation !== state\.generation[\s\S]*elements\.view\.replaceChildren/);
  assert.match(today, /const generation = state\.generation;[\s\S]*await requestJson[\s\S]*generation !== state\.generation[\s\S]*elements\.view\.replaceChildren/);
  assert.match(today, /today\.attention\.milestones/);
  assert.match(today, /today\.attention\.findingsToReview/);
  assert.match(organizationSelector, /const generation = \+\+state\.generation;[\s\S]*if \(generation !== state\.generation\) return;/);
  assert.match(workspaceSelector, /const generation = \+\+state\.generation;[\s\S]*if \(generation !== state\.generation\) return;/);
  assert.match(client, /const organizationScoped = \['portfolio', 'briefings'\]\.includes\(state\.activeView\)/);
  assert.match(client, /elements\.scope\.hidden = true/);
});

test('Follow-Up filtering retains its surface and communication channel is independent of output format', async () => {
  const client = await source('public/target/app.js');
  const filter = functionSlice(client, 'scopeFilterControl', 'previewScopeAssignment');
  const followUp = functionSlice(client, 'renderFollowUp', 'renderMilestones');
  const finalized = functionSlice(client, 'renderFinalizedEditor', 'renderCommunicatedEditor');
  assert.match(filter, /renderFilteredView = renderWorkItems/);
  assert.match(filter, /renderFilteredView\(\)/);
  assert.match(followUp, /scopeFilterControl\(renderFollowUp\)/);
  assert.match(finalized, /External communication channel/);
  assert.match(finalized, /option\('other', 'Other'\)/);
  assert.match(finalized, /channel: channel\.value/);
  assert.doesNotMatch(finalized, /channel: format\.value/);
  assert.match(client, /'status-update': 'Status Update'/);
  assert.match(client, /draft: 'Draft', finalized: 'Finalized', communicated: 'Communicated'/);
});

test('Briefing client uses stable parent routes and explicit lifecycle placement', async () => {
  const requests = [];
  const client = createTargetBriefingApiClient({
    request: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        headers: { get: name => name === 'x-priorena-target-revision' ? 'fixture-revision' : null },
        json: async () => ({ briefings: [] })
      };
    }
  });
  const listed = await client.listBriefings('org-fixture-alpha');
  await client.previewCommunicate('org-fixture-alpha', 'briefing-alpha', 'briefing-version-alpha-finalized', 'teams');
  assert.equal(listed.revision, 'fixture-revision');
  assert.equal(requests[0].url, '/api/v2/organizations/org-fixture-alpha/briefings');
  assert.equal(requests[1].url, '/api/v2/organizations/org-fixture-alpha/briefings/briefing-alpha/versions/briefing-version-alpha-finalized/communicate/preview');
  assert.equal(JSON.parse(requests[1].options.body).outputFormat, 'teams');
  assert.throws(() => targetStableId('../foreign'), /stable opaque IDs/);
  assert.deepEqual(categorizeVersions([
    { id: 'draft', status: 'draft' },
    { id: 'final', status: 'finalized' },
    { id: 'history', status: 'communicated' }
  ]), {
    open: [{ id: 'draft', status: 'draft' }, { id: 'final', status: 'finalized' }],
    history: [{ id: 'history', status: 'communicated' }]
  });
  assert.throws(() => validateBriefingResponse({
    briefings: [{ organizationId: 'org-fixture-beta', workspaces: [], scopes: [] }]
  }, 'org-fixture-alpha'), /crossed its Organization context/);
});

test('target styles cover focus, responsive layouts, wrapping, dialogs, and reduced motion', async () => {
  const css = await source('public/target/styles.css');
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /max-height: calc\(100vh - 2rem\)/);
  assert.doesNotMatch(css, /min-width:\s*[7-9]\d\dpx/);
});

test('target UI is registered only on the isolated target app without mutating target data', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'priorena-phase4-shell-'));
  const targetDataFile = path.join(tempRoot, 'target-v2.json');
  const sourceFilesRoot = path.join(tempRoot, 'source-files');
  await fs.mkdir(sourceFilesRoot, { mode: 0o700 });
  await fs.writeFile(targetDataFile, serializeTargetData(createCleanSeed()), { mode: 0o600 });
  const before = await fs.readFile(targetDataFile);
  const { app } = createTargetApiApp({ targetDataFile, sourceFilesRoot });
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  assert.equal(typeof app.handle, 'function');
  assert.equal(app._router.stack.some(layer => String(layer.regexp).includes('target')), true);
  assert.deepEqual(await fs.readFile(targetDataFile), before);

  const legacyServer = await source('server.js');
  const legacyEntry = await source('public/index.html');
  assert.doesNotMatch(legacyServer, /target-server\/dev|public\/target/);
  assert.doesNotMatch(legacyEntry, /\/target\//);
});
