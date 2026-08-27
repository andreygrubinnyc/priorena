'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const { createTargetResolvers } = require('../target-server/resolvers');
const {
  DEPENDENCY_CONTEXT_TRUST_LABEL,
  DEPENDENCY_REVIEW_CUES,
  MAX_DEPENDENCY_CONTEXT_ITEMS,
  MAX_DEPENDENCY_CONTEXT_OUTPUT_BYTES,
  buildDependencyContext
} = require('../target-server/triage-projections');
const {
  validateDependencyContext
} = require('../public/target-triage-state');
const {
  ALPHA,
  BETA,
  createTargetApiHarness,
  requestApp,
  workspaceBase
} = require('../test-support/target-api-harness');
const { createTriageFixture } = require('../test-support/target-triage-fixtures');
const { workItem } = require('../test-support/target-v5-fixtures');

const root = path.join(__dirname, '..');
const SELECTED_ID = 'work-item-alpha-unassigned';

function item(document, id) {
  return document.workItems.find(candidate => candidate.id === id);
}

function configureDependencyFixture() {
  const document = createTriageFixture();
  const selected = item(document, SELECTED_ID);
  const blocked = item(document, 'work-item-alpha-assigned');
  const atRisk = item(document, 'work-item-triage-002');
  const planned = item(document, 'work-item-triage-003');
  const unknown = item(document, 'work-item-triage-004');
  blocked.jiraKey = 'FICTA-099';
  blocked.canonicalStatus = ' Blocked ';
  blocked.currentStateConfidence = 'inferred';
  blocked.archived = true;
  blocked.description = 'FICTIONAL RELATED DESCRIPTION MUST NOT ENTER DEPENDENCY CONTEXT';
  blocked.notes = 'FICTIONAL RELATED NOTE MUST NOT ENTER DEPENDENCY CONTEXT';
  blocked.assignee = 'Fictional private-looking assignee value';
  atRisk.canonicalStatus = 'At-risk';
  atRisk.currentStateConfidence = 'unknown';
  atRisk.summary = '<img src=x onerror=fictionalDependency()> Fictional dependency text';
  planned.canonicalStatus = 'Planned';
  planned.currentStateConfidence = 'confirmed';
  unknown.canonicalStatus = 'Unknown';
  unknown.currentStateConfidence = 'confirmed';
  selected.dependencies = [unknown.id, blocked.id, planned.id, atRisk.id];

  item(document, 'work-item-triage-005').dependencies = [selected.id];
  item(document, 'work-item-triage-006').dependencies = [selected.id, atRisk.id];
  return document;
}

async function dependencyHarness(t, fixtureFactory = configureDependencyFixture) {
  return createTargetApiHarness(t, () => {}, { fixtureFactory });
}

function detailUrl(context = ALPHA, workItemId = SELECTED_ID) {
  return `${workspaceBase(context)}/work-items/${workItemId}/triage`;
}

function resultFor(response) {
  return {
    body: response.json(),
    revision: response.headers['x-priorena-target-revision']
  };
}

test('exact schema-v5 dependencies produce deterministic bounded same-Workspace context without a write', async t => {
  const { app, targetDataFile } = await dependencyHarness(t);
  const before = await fs.readFile(targetDataFile);
  const first = await requestApp(app, { url: detailUrl() });
  const repeated = await requestApp(app, { url: detailUrl() });
  assert.equal(first.status, 200, first.body);
  assert.equal(repeated.status, 200, repeated.body);
  assert.equal(first.headers['x-priorena-target-revision'], repeated.headers['x-priorena-target-revision']);
  assert.deepEqual(first.json(), repeated.json());

  const context = first.json().dependencyContext;
  assert.equal(context.organizationId, ALPHA.organizationId);
  assert.equal(context.workspaceId, ALPHA.workspaceId);
  assert.equal(context.workItemId, SELECTED_ID);
  assert.equal(context.trustLabel, DEPENDENCY_CONTEXT_TRUST_LABEL);
  assert.deepEqual(DEPENDENCY_REVIEW_CUES, [
    'archived', 'blocked-status', 'at-risk-status', 'unknown-status', 'state-needs-confirmation'
  ]);
  assert.deepEqual(context.listedDependencies.items.map(candidate => candidate.id), [
    'work-item-alpha-assigned',
    'work-item-triage-002',
    'work-item-triage-003',
    'work-item-triage-004'
  ]);
  assert.deepEqual(context.listedDependencies, {
    items: context.listedDependencies.items,
    total: 4,
    returned: 4,
    limit: MAX_DEPENDENCY_CONTEXT_ITEMS,
    truncated: false
  });
  assert.deepEqual(context.referencingWorkItems.items.map(candidate => candidate.id), [
    'work-item-triage-005', 'work-item-triage-006'
  ]);
  assert.deepEqual(context.cueCounts, {
    archived: 1,
    'blocked-status': 1,
    'at-risk-status': 1,
    'unknown-status': 1,
    'state-needs-confirmation': 2
  });
  assert.deepEqual(context.listedDependencies.items[0].reviewCues, [
    'archived', 'blocked-status', 'state-needs-confirmation'
  ]);
  assert.deepEqual(context.listedDependencies.items[1].reviewCues, [
    'at-risk-status', 'state-needs-confirmation'
  ]);
  assert.equal(context.listedDependencies.items[1].summary, '<img src=x onerror=fictionalDependency()> Fictional dependency text');
  assert.deepEqual(context.listedDependencies.items[2].reviewCues, []);
  assert.deepEqual(context.listedDependencies.items[3].reviewCues, ['unknown-status']);
  assert.equal(Object.hasOwn(context.referencingWorkItems.items[0], 'reviewCues'), false);
  assert.deepEqual(context.listedDependencies.items[0].initiative, {
    id: 'initiative-alpha-multiple-mappings',
    name: 'Mapped Initiative'
  }, 'cross-Initiative dependency context stays explicit');

  const serialized = JSON.stringify(context);
  for (const omitted of [
    'description', 'notes', 'labels', 'assignee', 'followUp', 'currentStateProvenance',
    'sourceMatches', 'evidence', 'proposedChanges', 'FICTIONAL RELATED DESCRIPTION',
    'FICTIONAL RELATED NOTE', 'private-looking assignee'
  ]) {
    assert.equal(serialized.includes(omitted), false, omitted);
  }
  assert.ok(Buffer.byteLength(serialized, 'utf8') < MAX_DEPENDENCY_CONTEXT_OUTPUT_BYTES);
  assert.deepEqual(await fs.readFile(targetDataFile), before, 'dependency reads preserve exact persisted bytes');
});

test('dependency context validates exact parents and does not disclose wrong-parent Work Items', async t => {
  const { app } = await dependencyHarness(t);
  const response = await requestApp(app, { url: detailUrl() });
  const valid = resultFor(response);
  assert.equal(validateDependencyContext(valid, ALPHA.organizationId, ALPHA.workspaceId, SELECTED_ID), valid.body.dependencyContext);

  const foreign = await requestApp(app, { url: detailUrl(BETA) });
  const unknown = await requestApp(app, { url: detailUrl(BETA, 'work-item-fictional-unknown') });
  assert.equal(foreign.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(foreign.json(), unknown.json());

  const cases = [
    value => { value.revision = 'not-a-revision'; },
    value => { value.body.dependencyContext.workspaceId = 'workspace-fictional-wrong'; },
    value => { value.body.dependencyContext.trustLabel = 'Fictional altered trust label'; },
    value => { value.body.dependencyContext.listedDependencies.items[0].reviewCues.reverse(); },
    value => { value.body.dependencyContext.listedDependencies.returned = 99; },
    value => { value.body.dependencyContext.referencingWorkItems.items.push(
      structuredClone(value.body.dependencyContext.referencingWorkItems.items[0])
    ); value.body.dependencyContext.referencingWorkItems.returned += 1; }
  ];
  cases.forEach(mutate => {
    const candidate = structuredClone(valid);
    mutate(candidate);
    assert.throws(
      () => validateDependencyContext(candidate, ALPHA.organizationId, ALPHA.workspaceId, SELECTED_ID),
      /Dependency context/
    );
  });
});

test('both dependency directions truncate independently at 100 while counts cover every exact relationship', async t => {
  const fixtureFactory = () => {
    const document = createTriageFixture();
    const selected = item(document, SELECTED_ID);
    const listed = [];
    for (let index = 0; index < 105; index += 1) {
      const dependency = workItem(
        `work-item-dependency-${String(index).padStart(3, '0')}`,
        ALPHA.organizationId,
        ALPHA.workspaceId,
        index % 2 ? 'initiative-alpha-zero-mapping' : 'initiative-alpha-multiple-mappings',
        `Fictional dependency ${String(index).padStart(3, '0')}`
      );
      dependency.jiraKey = `FICTD-${2000 + index}`;
      dependency.canonicalStatus = 'Blocked';
      document.workItems.push(dependency);
      listed.push(dependency.id);

      const referencing = workItem(
        `work-item-referencing-${String(index).padStart(3, '0')}`,
        ALPHA.organizationId,
        ALPHA.workspaceId,
        null,
        `Fictional referencing item ${String(index).padStart(3, '0')}`
      );
      referencing.jiraKey = `FICTR-${3000 + index}`;
      referencing.dependencies = [selected.id];
      document.workItems.push(referencing);
    }
    selected.dependencies = listed;
    return document;
  };
  const { app, targetDataFile } = await dependencyHarness(t, fixtureFactory);
  const before = await fs.readFile(targetDataFile);
  const response = await requestApp(app, { url: detailUrl() });
  assert.equal(response.status, 200, response.body);
  const result = resultFor(response);
  const context = validateDependencyContext(result, ALPHA.organizationId, ALPHA.workspaceId, SELECTED_ID);
  assert.deepEqual(
    [context.listedDependencies.total, context.listedDependencies.returned, context.listedDependencies.limit, context.listedDependencies.truncated],
    [105, 100, 100, true]
  );
  assert.deepEqual(
    [context.referencingWorkItems.total, context.referencingWorkItems.returned, context.referencingWorkItems.limit, context.referencingWorkItems.truncated],
    [105, 100, 100, true]
  );
  assert.equal(context.cueCounts['blocked-status'], 105, 'cue counts cover truncated exact relationships');
  assert.deepEqual(await fs.readFile(targetDataFile), before);
});

test('dependency context enforces its independent one MiB fail-closed output boundary', () => {
  const document = createTriageFixture();
  const selected = item(document, SELECTED_ID);
  const dependencyIds = [];
  for (let index = 0; index < MAX_DEPENDENCY_CONTEXT_ITEMS; index += 1) {
    const dependency = workItem(
      `work-item-oversized-${String(index).padStart(3, '0')}`,
      ALPHA.organizationId,
      ALPHA.workspaceId,
      null,
      `Fictional oversized projection value ${'X'.repeat(12_000)}`
    );
    document.workItems.push(dependency);
    dependencyIds.push(dependency.id);
  }
  selected.dependencies = dependencyIds;
  const resolvers = createTargetResolvers(document);
  assert.throws(
    () => buildDependencyContext(document, resolvers, ALPHA.organizationId, ALPHA.workspaceId, selected),
    error => error.code === 'OUTPUT_TOO_LARGE'
  );
});

test('Work Item detail validates before state assignment and renders dependency values as inert text', async () => {
  const client = await fs.readFile(path.join(root, 'public', 'target', 'app.js'), 'utf8');
  const state = await fs.readFile(path.join(root, 'public', 'target-triage-state.js'), 'utf8');
  const architecture = await fs.readFile(path.join(root, 'docs', 'architecture', 'WORK_ITEM_DEPENDENCY_CONTEXT.md'), 'utf8');
  assert.match(client, /validateDependencyContext\(result, token\.organizationId, token\.workspaceId, workItemId\);[\s\S]*state\.triage\.detail = result\.body/);
  assert.match(client, /validateDependencyContext\(refreshed, token\.organizationId, token\.workspaceId, detail\.workItem\.id\);[\s\S]*state\.triage\.detail = refreshed\.body/);
  assert.match(client, /Explicit dependency context/);
  assert.match(client, /does not infer whether a relationship blocks work, is satisfied, creates impact or risk, or should change priority/);
  assert.match(client, /deterministic non-priority order/);
  assert.match(client, /options\.text[^\n]*textContent|textContent = String\(options\.text\)/);
  assert.doesNotMatch(`${client}\n${state}`, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.match(state, /Dependency context does not match the validated parent context/);
  assert.match(state, /Dependency context is not deterministically ordered/);
  assert.match(architecture, /unchanged strict `schemaVersion: 5`/);
  assert.match(architecture, /not a score, severity order, satisfaction assessment, blocker/);
  assert.match(architecture, /Descriptions, notes, labels, assignees/);
});
