const assert = require('node:assert/strict');
const test = require('node:test');

const { createDemoWorkspace } = require('../demo/demo-fixture');
const {
  DEFAULT_ABSOLUTE_MS,
  DEFAULT_IDLE_MS,
  MAX_MANUAL_CONTEXT_CHARS,
  DemoSessionStore
} = require('../demo/demo-session-store');

test('demo fixture is explicitly fictional and independent for every session', () => {
  const first = createDemoWorkspace();
  const second = createDemoWorkspace();
  assert.equal(first.demoMetadata.fictional, true);
  assert.match(first.demoMetadata.notice, /fictional/i);
  assert.equal(first.demoMetadata.fixtureVersion, 'priorena-demo-v2');
  assert.equal(first.demoMetadata.walkthrough.length, 3);
  assert.deepEqual(Object.keys(first.projects), ['Northstar Launch']);
  assert.equal(first.projects['Northstar Launch'].stories.length, 5);
  assert.equal(first.projects['Northstar Launch'].transcripts[0].extractedFindings.length, 6);
  assert.deepEqual(
    [...new Set(first.projects['Northstar Launch'].transcripts[0].extractedFindings.map(finding => finding.category))].sort(),
    ['action', 'blocker', 'decision', 'dependency', 'progress_update', 'risk']
  );
  first.projects['Northstar Launch'].stories[0].summary = 'Changed temporarily';
  assert.equal(second.projects['Northstar Launch'].stories[0].summary, 'Complete launch-readiness review');
  assert.doesNotMatch(JSON.stringify(first), /REALORG|INTERNALORG|jira\.internal|confluence\.internal/i);
});

test('demo sessions are isolated, bounded, and expire on idle or absolute lifetime', () => {
  let now = Date.parse('2026-07-20T12:00:00.000Z');
  const store = new DemoSessionStore({ clock: () => now, maxSessions: 2 });
  const first = store.create();
  const second = store.create();
  assert.notEqual(first.id, second.id);

  store.updateManualContext(first.id, 'A temporary fictional leadership note.');
  assert.equal(store.get(first.id).manualContext, 'A temporary fictional leadership note.');
  assert.equal(store.get(second.id).manualContext, '');
  const changed = store.updateWorkItem(first.id, {
    project: 'Northstar Launch',
    storyId: 'demo-story-101',
    status: 'Done',
    assignee: 'Jordan Rivera'
  });
  assert.equal(changed.workspace.projects['Northstar Launch'].stories[0].status, 'Done');
  assert.equal(changed.workspace.projects['Northstar Launch'].stories[0].assignee, 'Jordan Rivera');
  assert.equal(store.get(second.id).workspace.projects['Northstar Launch'].stories[0].status, 'In progress');
  assert.throws(() => store.updateManualContext(first.id, 'x'.repeat(MAX_MANUAL_CONTEXT_CHARS + 1)), /characters or fewer/);
  assert.throws(() => store.updateWorkItem(first.id, {
    project: 'Northstar Launch', storyId: 'demo-story-101', status: 'Invented', assignee: 'Jordan Rivera'
  }), /status is invalid/);
  assert.throws(() => store.updateWorkItem(first.id, {
    project: 'Northstar Launch', storyId: 'demo-story-101', status: 'Done', assignee: 'Jordan Rivera', summary: 'Not allowed'
  }), /unsupported or missing fields/);
  assert.throws(() => store.updateWorkItem(first.id, {
    project: 'Northstar Launch', storyId: 'demo-story-101', status: 'Done', assignee: 'x'.repeat(81)
  }), /visible characters/);
  assert.throws(() => store.updateWorkItem(first.id, {
    project: 'Unknown Project', storyId: 'demo-story-101', status: 'Done', assignee: 'Jordan Rivera'
  }), /project was not found/);
  const evidencePayload = {
    project: 'Northstar Launch',
    jiraId: 'DEMO-101',
    category: 'progress_update',
    sourceTitle: 'Fictional readiness note',
    summary: 'Checklist review is underway.',
    exactExcerpt: 'DEMO-101 checklist review is underway in the fictional launch exercise.',
    attested: true
  };
  const withEvidence = store.addEvidence(first.id, evidencePayload);
  const submittedSource = withEvidence.workspace.projects['Northstar Launch'].transcripts.at(-1);
  const submittedFinding = submittedSource.extractedFindings[0];
  assert.equal(submittedSource.sourceKind, 'demo-sanitized-manual');
  assert.equal(submittedFinding.reviewStatus, 'pending');
  assert.equal(submittedFinding.sourceId, submittedSource.id);
  assert.match(submittedFinding.associationReason, /Exact Jira key DEMO-101/);
  assert.equal(store.get(second.id).workspace.projects['Northstar Launch'].transcripts.length, 1);
  const reviewed = store.reviewEvidence(first.id, {
    project: 'Northstar Launch', findingId: submittedFinding.id, reviewStatus: 'accepted'
  });
  assert.equal(reviewed.workspace.projects['Northstar Launch'].transcripts.at(-1).extractedFindings[0].reviewStatus, 'accepted');
  assert.deepEqual(reviewed.workspace.projects['Northstar Launch'].stories[0].updates, []);
  assert.throws(() => store.reviewEvidence(first.id, {
    project: 'Northstar Launch', findingId: submittedFinding.id, reviewStatus: 'rejected'
  }), /already been reviewed/);
  assert.throws(() => store.addEvidence(first.id, { ...evidencePayload, exactExcerpt: 'See https://private.example.invalid/item' }), /sanitize it/);
  assert.throws(() => store.addEvidence(first.id, { ...evidencePayload, attested: false }), /Confirm that the evidence/);
  assert.throws(() => store.addEvidence(first.id, { ...evidencePayload, extra: 'not allowed' }), /unsupported or missing fields/);
  assert.throws(() => store.create(), /capacity/);

  now += DEFAULT_IDLE_MS;
  assert.equal(store.get(first.id), null);
  const replacement = store.create();
  now += DEFAULT_ABSOLUTE_MS;
  assert.equal(store.get(replacement.id), null);
});

test('invalid demo tokens never resolve or mutate a session', () => {
  const store = new DemoSessionStore();
  const session = store.create();
  assert.equal(store.get('not-a-token'), null);
  assert.equal(store.updateManualContext('0'.repeat(64), 'text'), null);
  assert.equal(store.addEvidence('0'.repeat(64), {
    project: 'Northstar Launch', jiraId: 'DEMO-101', category: 'other', sourceTitle: 'Fictional note',
    summary: 'A fictional summary.', exactExcerpt: 'A fictional exact excerpt.', attested: true
  }), null);
  assert.equal(store.destroy('not-a-token'), false);
  assert.ok(store.get(session.id));
});

test('manual demo evidence is capped per temporary session', () => {
  const store = new DemoSessionStore();
  const session = store.create();
  const base = {
    project: 'Northstar Launch', jiraId: 'DEMO-101', category: 'other',
    summary: 'A fictional bounded summary.', exactExcerpt: 'A fictional bounded exact excerpt.', attested: true
  };
  for (let index = 1; index <= 25; index += 1) {
    store.addEvidence(session.id, { ...base, sourceTitle: `Fictional note ${index}` });
  }
  assert.throws(() => store.addEvidence(session.id, { ...base, sourceTitle: 'Fictional note 26' }), /evidence limit/);
});
