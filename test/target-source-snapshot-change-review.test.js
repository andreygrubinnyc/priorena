'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const { PUBLIC_ERRORS } = require('../target-server/errors');
const {
  MAX_CHANGE_VALUE_CHARACTERS,
  MAX_SOURCE_CHANGE_OUTPUT_BYTES,
  SOURCE_CHANGE_FIELDS
} = require('../target-server/source-change-projections');
const {
  SOURCE_CHANGE_REASONS,
  createTargetEvidenceReviewApiClient,
  validateSourceComparison
} = require('../public/target-evidence-review-state');
const {
  ALPHA,
  BETA,
  createTargetApiHarness,
  requestApp,
  workspaceBase
} = require('../test-support/target-api-harness');
const {
  createTriageFixture,
  normalizedFeedSource
} = require('../test-support/target-triage-fixtures');

const root = path.join(__dirname, '..');

function createSourceChangeFixture() {
  const document = createTriageFixture();
  document.sources.push(
    normalizedFeedSource('source-change-baseline', 'Fictional Baseline Snapshot', [
      {
        externalKey: 'FICTA-100',
        itemType: 'Story',
        summary: 'Fictional unchanged row',
        description: 'Fictional unchanged description.',
        canonicalStatus: 'Planned',
        category: 'status'
      },
      {
        externalKey: 'FICTA-101',
        itemType: 'Task',
        summary: 'Fictional original change row',
        description: 'A'.repeat(350),
        canonicalStatus: 'Planned',
        category: 'status'
      },
      {
        externalKey: 'FICTA-102',
        itemType: 'Bug',
        summary: 'Fictional removed row',
        canonicalStatus: 'Open',
        category: 'risk'
      }
    ], '2026-08-20'),
    normalizedFeedSource('source-change-current', 'Fictional Current Snapshot', [
      {
        externalKey: 'FICTA-100',
        itemType: 'Story',
        summary: 'Fictional unchanged row',
        description: 'Fictional unchanged description.',
        canonicalStatus: 'Planned',
        category: 'status'
      },
      {
        externalKey: 'FICTA-101',
        itemType: 'Task',
        summary: '<script>fictionalChange()</script> Fictional changed row',
        description: 'B'.repeat(351),
        canonicalStatus: 'In Progress',
        category: 'status'
      },
      {
        externalKey: 'FICTA-103',
        itemType: 'Story',
        summary: '<img src=x onerror=fictionalAdded()> Fictional added row',
        canonicalStatus: 'Ready',
        category: 'status'
      }
    ], '2026-08-21'),
    normalizedFeedSource('source-change-duplicate', 'Fictional Duplicate-Key Snapshot', [
      { externalKey: 'FICTA-201', summary: 'Fictional first duplicate', category: 'note' },
      { externalKey: 'FICTA-201', summary: 'Fictional second duplicate', category: 'note' }
    ], '2026-08-22'),
    normalizedFeedSource('source-change-missing-key', 'Fictional Missing-Key Snapshot', [
      { summary: 'Fictional row intentionally missing an exact external key', category: 'note' }
    ], '2026-08-23')
  );
  return document;
}

async function sourceChangeHarness(t) {
  return createTargetApiHarness(t, () => {}, { fixtureFactory: createSourceChangeFixture });
}

function changeUrl(baselineSourceId, currentSourceId, context = ALPHA) {
  const query = new URLSearchParams({ baselineSourceId, currentSourceId });
  return `${workspaceBase(context)}/sources/change-review?${query.toString()}`;
}

function notFoundBody() {
  return { error: { code: 'NOT_FOUND', message: PUBLIC_ERRORS.NOT_FOUND.message } };
}

test('explicit normalized Source snapshots produce a deterministic bounded write-free comparison', async t => {
  const { app, targetDataFile } = await sourceChangeHarness(t);
  const before = await fs.readFile(targetDataFile);
  const url = changeUrl('source-change-baseline', 'source-change-current');
  const first = await requestApp(app, { url });
  const repeated = await requestApp(app, { url });

  assert.equal(first.status, 200, first.body);
  assert.equal(repeated.status, 200, repeated.body);
  assert.equal(first.headers['x-priorena-target-revision'], repeated.headers['x-priorena-target-revision']);
  assert.deepEqual(first.json(), repeated.json());

  const comparison = first.json();
  assert.equal(comparison.organizationId, ALPHA.organizationId);
  assert.equal(comparison.workspaceId, ALPHA.workspaceId);
  assert.deepEqual(comparison.comparisonBasis, {
    identity: 'exact-external-key',
    baselinePersisted: false,
    trustLabel: 'Source comparison — not accepted Evidence or current state'
  });
  assert.deepEqual(comparison.readiness, { ready: true, reasons: [] });
  assert.deepEqual(comparison.counts, { added: 1, removed: 1, changed: 1, unchanged: 1 });
  assert.deepEqual(comparison.changes.map(change => [change.externalKey, change.status]), [
    ['FICTA-100', 'unchanged'],
    ['FICTA-101', 'changed'],
    ['FICTA-102', 'removed'],
    ['FICTA-103', 'added']
  ]);

  const changed = comparison.changes.find(change => change.externalKey === 'FICTA-101');
  assert.deepEqual(changed.fieldChanges.map(change => change.field), ['summary', 'description', 'canonicalStatus']);
  const description = changed.fieldChanges.find(change => change.field === 'description');
  assert.deepEqual(description.baseline, {
    value: 'A'.repeat(MAX_CHANGE_VALUE_CHARACTERS),
    truncated: true,
    originalCharacterCount: 350
  });
  assert.deepEqual(description.current, {
    value: 'B'.repeat(MAX_CHANGE_VALUE_CHARACTERS),
    truncated: true,
    originalCharacterCount: 351
  });
  assert.equal(changed.current.summary.value, '<script>fictionalChange()</script> Fictional changed row');
  assert.equal(comparison.changes.find(change => change.status === 'added').current.summary.value.includes('onerror='), true);
  assert.deepEqual(Object.keys(comparison.baselineSource).sort(), [
    'createdAt', 'date', 'id', 'organizationId', 'sourceKind', 'title', 'type', 'workspaceId'
  ]);
  assert.deepEqual(SOURCE_CHANGE_FIELDS, [
    'itemType', 'externalItemType', 'summary', 'description', 'jiraProjectKey', 'jiraEpicKey', 'noEpic',
    'requestedInitiativeId', 'initiativeName', 'canonicalStatus', 'evidenceExcerpt', 'category'
  ]);
  assert.ok(Buffer.byteLength(first.body, 'utf8') < MAX_SOURCE_CHANGE_OUTPUT_BYTES);
  for (const omitted of ['"content"', '"metadata"', '"provenance"', 'A'.repeat(350), 'B'.repeat(351)]) {
    assert.equal(first.body.includes(omitted), false, omitted.slice(0, 40));
  }
  assert.deepEqual(await fs.readFile(targetDataFile), before, 'comparison reads never mutate persisted schema-v5 data');
});

test('ambiguous, malformed, and unsupported Sources stop without partial change rows', async t => {
  const { app, targetDataFile } = await sourceChangeHarness(t);
  const before = await fs.readFile(targetDataFile);
  const cases = [
    ['source-triage-malformed', 'source-invalid', 0],
    ['source-change-duplicate', 'duplicate-external-key', 2],
    ['source-change-missing-key', 'missing-external-key', 1],
    ['source-alpha-sentinel', 'source-not-normalized-feed', 0]
  ];
  for (const [currentSourceId, reason, affectedRecords] of cases) {
    const response = await requestApp(app, { url: changeUrl('source-change-baseline', currentSourceId) });
    assert.equal(response.status, 200, `${currentSourceId}: ${response.body}`);
    const comparison = response.json();
    assert.deepEqual(comparison.readiness, {
      ready: false,
      reasons: [{ sourceRole: 'current', reason, affectedRecords }]
    });
    assert.deepEqual(comparison.counts, { added: 0, removed: 0, changed: 0, unchanged: 0 });
    assert.deepEqual(comparison.changes, []);
  }
  assert.deepEqual(await fs.readFile(targetDataFile), before, 'blocked comparisons are write-free');
});

test('comparison query, parent, disclosure, and method boundaries fail closed', async t => {
  const { app } = await sourceChangeHarness(t);
  for (const url of [
    `${workspaceBase(ALPHA)}/sources/change-review`,
    changeUrl('source-change-baseline', 'source-change-baseline'),
    `${changeUrl('source-change-baseline', 'source-change-current')}&unexpected=value`,
    `${workspaceBase(ALPHA)}/sources/change-review?baselineSourceId=source-change-baseline&baselineSourceId=source-change-current&currentSourceId=source-change-current`
  ]) {
    const response = await requestApp(app, { url });
    assert.equal(response.status, 400, `${url}: ${response.body}`);
    assert.equal(response.json().error.code, 'INVALID_QUERY');
  }

  const wrongParent = await requestApp(app, {
    url: changeUrl('source-change-baseline', 'source-change-current', BETA)
  });
  const unknown = await requestApp(app, {
    url: changeUrl('source-change-baseline', 'source-change-unknown')
  });
  assert.equal(wrongParent.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(wrongParent.json(), unknown.json());
  assert.deepEqual(unknown.json(), notFoundBody());

  const post = await requestApp(app, {
    method: 'POST',
    url: changeUrl('source-change-baseline', 'source-change-current')
  });
  assert.equal(post.status, 405);
  assert.equal(post.json().error.code, 'METHOD_NOT_ALLOWED');
});

test('browser client constructs exact read URL and validates revision, parents, readiness, counts, and rows', async t => {
  const { app } = await sourceChangeHarness(t);
  const response = await requestApp(app, { url: changeUrl('source-change-baseline', 'source-change-current') });
  const revision = response.headers['x-priorena-target-revision'];
  const body = response.json();
  let requestDetails = null;
  const client = createTargetEvidenceReviewApiClient({
    request: async (url, options) => {
      requestDetails = { url, options };
      return {
        ok: true,
        headers: { get: name => name.toLowerCase() === 'x-priorena-target-revision' ? revision : null },
        json: async () => body
      };
    }
  });
  const result = await client.compareSources(
    ALPHA.organizationId,
    ALPHA.workspaceId,
    'source-change-baseline',
    'source-change-current'
  );
  assert.equal(requestDetails.options.method, 'GET');
  assert.equal(requestDetails.url, changeUrl('source-change-baseline', 'source-change-current'));
  assert.equal(validateSourceComparison(
    result,
    ALPHA.organizationId,
    ALPHA.workspaceId,
    'source-change-baseline',
    'source-change-current',
    revision
  ), body);
  assert.throws(() => client.compareSources(
    ALPHA.organizationId,
    ALPHA.workspaceId,
    'source/change-unsafe',
    'source-change-current'
  ), /stable opaque IDs/);

  const wrongRevision = { body, revision: 'f'.repeat(64) };
  assert.throws(() => validateSourceComparison(
    wrongRevision, ALPHA.organizationId, ALPHA.workspaceId,
    'source-change-baseline', 'source-change-current', revision
  ), error => error.code === 'REVISION_CONFLICT');

  const wrongParent = structuredClone(body);
  wrongParent.currentSource.workspaceId = 'workspace-fictional-wrong';
  assert.throws(() => validateSourceComparison(
    { body: wrongParent, revision }, ALPHA.organizationId, ALPHA.workspaceId,
    'source-change-baseline', 'source-change-current', revision
  ), /validated parent context/);

  const wrongCount = structuredClone(body);
  wrongCount.counts.changed = 2;
  assert.throws(() => validateSourceComparison(
    { body: wrongCount, revision }, ALPHA.organizationId, ALPHA.workspaceId,
    'source-change-baseline', 'source-change-current', revision
  ), /counts do not match/);

  const partialBlocked = structuredClone(body);
  partialBlocked.readiness = {
    ready: false,
    reasons: [{ sourceRole: 'current', reason: 'source-invalid', affectedRecords: 0 }]
  };
  assert.throws(() => validateSourceComparison(
    { body: partialBlocked, revision }, ALPHA.organizationId, ALPHA.workspaceId,
    'source-change-baseline', 'source-change-current', revision
  ), /partial change results/);
  assert.equal(SOURCE_CHANGE_REASONS['duplicate-external-key'].includes('only once'), true);
});

test('Source Library renders the comparison as inert text with explicit no-write and no-auto-baseline copy', async () => {
  const appSource = await fs.readFile(path.join(root, 'public', 'target', 'app.js'), 'utf8');
  const stateSource = await fs.readFile(path.join(root, 'public', 'target-evidence-review-state.js'), 'utf8');
  const styles = await fs.readFile(path.join(root, 'public', 'target', 'styles.css'), 'utf8');
  const architecture = await fs.readFile(path.join(root, 'docs', 'architecture', 'SOURCE_SNAPSHOT_CHANGE_REVIEW.md'), 'utf8');

  assert.match(appSource, /Priorena does not infer chronology, automatically choose a baseline, or save either role/);
  assert.match(appSource, /does not create or change Sources, Findings, Evidence, Work Items, or current state/);
  assert.match(appSource, /Source comparison — not accepted Evidence or current state|comparisonBasis\.trustLabel/);
  assert.match(appSource, /textContent = String\(options\.text\)/);
  assert.doesNotMatch(`${appSource}\n${stateSource}`, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.match(styles, /\.source-change-review/);
  assert.match(architecture, /schema-v5 read projection/);
  assert.match(architecture, /does not infer chronology/);
  assert.match(architecture, /durable snapshot lineage/);
});
