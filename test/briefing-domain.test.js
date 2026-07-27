const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeBriefingCollections,
  createBriefingStream,
  updateBriefingStream,
  createBriefingFact,
  buildBriefingSnapshot,
  detectBriefingChanges,
  createBriefing,
  replaceDraftFacts,
  finalizeBriefing,
  generateBriefingOutputs,
  findStreamBaseline,
  markBriefingCommunicated
} = require('../briefings/briefing-domain');

const now = '2026-07-20T16:00:00.000Z';

test('legacy workspaces receive compatibility-safe empty briefing collections', () => {
  const workspace = { projects: {} };
  assert.equal(normalizeBriefingCollections(workspace), workspace);
  assert.deepEqual(workspace.briefingStreams, []);
  assert.deepEqual(workspace.briefings, []);
  assert.throws(() => normalizeBriefingCollections({ projects: {}, briefingStreams: {} }), /briefingStreams must be an array/);
  assert.throws(() => normalizeBriefingCollections({ projects: {}, briefings: {} }), /briefings must be an array/);
});

test('stream updates preserve identity and communication history', () => {
  const original = createBriefingStream({
    name: 'Apollo manager brief',
    projectNames: ['Apollo'],
    audienceProfile: 'manager',
    preferredFormats: ['teams'],
    defaultSections: ['progress']
  }, { projectNames: ['Apollo', 'Ledger'], id: 'stream-1', now });
  original.lastCommunicatedBriefingId = 'briefing-previous';

  const updated = updateBriefingStream(original, {
    name: 'Portfolio manager brief',
    projectNames: ['Apollo', 'Ledger'],
    audienceProfile: 'mixed',
    preferredFormats: ['teams', 'email'],
    defaultSections: ['progress', 'risk']
  }, { projectNames: ['Apollo', 'Ledger'], now: '2026-07-20T17:00:00.000Z' });

  assert.equal(updated.id, 'stream-1');
  assert.equal(updated.createdAt, now);
  assert.equal(updated.lastCommunicatedBriefingId, 'briefing-previous');
  assert.deepEqual(updated.projectNames, ['Apollo', 'Ledger']);
});

test('briefing streams support project and portfolio scope with bounded canonical choices', () => {
  const stream = createBriefingStream({
    name: 'Delivery portfolio — leadership update',
    projectNames: ['Apollo', 'Ledger'],
    deliveryProjectIds: ['project-apollo'],
    audienceProfile: 'mixed',
    preferredFormats: ['teams', 'email', 'confluence'],
    defaultSections: ['progress', 'risk', 'decision', 'milestone']
  }, {
    projectNames: ['Apollo', 'Ledger', 'Insights'],
    deliveryProjectIds: ['project-apollo', 'project-ledger'],
    id: 'briefing-stream-1',
    now
  });

  assert.deepEqual(stream, {
    id: 'briefing-stream-1',
    name: 'Delivery portfolio — leadership update',
    projectNames: ['Apollo', 'Ledger'],
    deliveryProjectIds: ['project-apollo'],
    audienceProfile: 'mixed',
    preferredFormats: ['teams', 'email', 'confluence'],
    defaultSections: ['progress', 'risk', 'decision', 'milestone'],
    lastCommunicatedBriefingId: null,
    createdAt: now,
    updatedAt: now
  });

  assert.throws(() => createBriefingStream({
    name: 'Unknown project stream',
    projectNames: ['Private project'],
    audienceProfile: 'manager',
    preferredFormats: ['teams'],
    defaultSections: ['progress']
  }, { projectNames: ['Apollo'] }), /Unknown project/);

  assert.throws(() => createBriefingStream({
    name: 'Duplicate format stream',
    projectNames: ['Apollo'],
    audienceProfile: 'manager',
    preferredFormats: ['teams', 'teams'],
    defaultSections: ['progress']
  }, { projectNames: ['Apollo'] }), /duplicate/);

  assert.throws(() => createBriefingStream({
    name: 'Unsupported format stream',
    projectNames: ['Apollo'],
    audienceProfile: 'manager',
    preferredFormats: ['slack'],
    defaultSections: ['progress']
  }, { projectNames: ['Apollo'] }), /not supported/);

  assert.throws(() => createBriefingStream({
    name: 'Unknown Project scope', projectNames: ['Apollo'], deliveryProjectIds: ['unknown-project'],
    audienceProfile: 'manager', preferredFormats: ['teams'], defaultSections: ['progress']
  }, { projectNames: ['Apollo'], deliveryProjectIds: ['project-apollo'] }), /Unknown Project scope/);
});

test('Project-scoped snapshots include only explicitly associated work items', () => {
  const stream = createBriefingStream({
    name: 'Apollo Epic brief', projectNames: ['Apollo'], deliveryProjectIds: ['delivery-a'],
    audienceProfile: 'manager', preferredFormats: ['confluence'], defaultSections: ['progress']
  }, { projectNames: ['Apollo'], deliveryProjectIds: ['delivery-a', 'delivery-b'], id: 'stream-project', now });
  const snapshot = buildBriefingSnapshot(stream, {
    Apollo: {
      deliveryProjects: [
        { id: 'delivery-a', name: 'Launch', jiraEpicKey: 'APO-100', owner: 'Taylor', planningTarget: 'Q3', workstreams: [] },
        { id: 'delivery-b', name: 'Operations', jiraEpicKey: 'APO-200', owner: 'Morgan', planningTarget: '', workstreams: [] }
      ],
      stories: [
        { id: 'story-a', jiraId: 'APO-1', summary: 'Launch work', deliveryProjectId: 'delivery-a' },
        { id: 'story-b', jiraId: 'APO-2', summary: 'Operations work', deliveryProjectId: 'delivery-b' },
        { id: 'story-unassigned', jiraId: 'APO-3', summary: 'Needs review', deliveryProjectId: '' }
      ]
    }
  }, now);
  assert.deepEqual(snapshot.projects[0].deliveryProjects.map(item => item.id), ['delivery-a']);
  assert.deepEqual(snapshot.projects[0].workItems.map(item => item.jiraId), ['APO-1']);
  assert.equal(snapshot.projects[0].workItems[0].deliveryProjectName, 'Launch');
});

test('Project-scoped manual facts cannot escape or omit their Jira Epic scope', () => {
  const stream = createBriefingStream({
    name: 'Launch brief', projectNames: ['Apollo'], deliveryProjectIds: ['delivery-a'],
    audienceProfile: 'manager', preferredFormats: ['teams'], defaultSections: ['progress']
  }, { projectNames: ['Apollo'], deliveryProjectIds: ['delivery-a'], id: 'stream-scope', now });
  const briefing = createBriefing(stream, {
    Apollo: {
      deliveryProjects: [{ id: 'delivery-a', name: 'Launch', jiraEpicKey: 'APO-100', workstreams: [] }],
      stories: []
    }
  }, [], { id: 'briefing-scope', now });
  const baseFact = {
    category: 'progress', projectName: 'Apollo', origin: 'manual_pm_input', sourceEvidenceIds: [],
    detectedText: '', editedText: 'Fictional leadership context.', included: true
  };
  assert.throws(() => replaceDraftFacts(briefing, [baseFact]), /requires a Project \/ Jira Epic/);
  const scoped = replaceDraftFacts(briefing, [{ ...baseFact, deliveryProjectId: 'delivery-a' }], { ids: ['fact-scope'], now });
  assert.equal(scoped.facts[0].deliveryProjectName, 'Launch');
});

test('briefing facts preserve evidence provenance and label manual PM input', () => {
  const evidenceFact = createBriefingFact({
    category: 'risk',
    projectName: 'Apollo',
    workItemId: 'story-1',
    jiraId: 'APO-214',
    origin: 'evidence',
    sourceEvidenceIds: ['finding-1'],
    detectedText: 'The certificate renewal is waiting for security review.',
    editedText: 'Certificate renewal is waiting for security review.',
    included: true
  }, { id: 'briefing-fact-1', now });

  assert.equal(evidenceFact.origin, 'evidence');
  assert.deepEqual(evidenceFact.sourceEvidenceIds, ['finding-1']);
  assert.equal(evidenceFact.detectedText, 'The certificate renewal is waiting for security review.');

  const manualFact = createBriefingFact({
    category: 'decision',
    projectName: 'Apollo',
    workItemId: '',
    jiraId: '',
    origin: 'manual_pm_input',
    sourceEvidenceIds: [],
    detectedText: '',
    editedText: 'Leadership alignment is requested before the next delivery checkpoint.',
    included: true
  }, { id: 'briefing-fact-2', now });

  assert.equal(manualFact.origin, 'manual_pm_input');
  assert.equal(manualFact.detectedText, '');
  assert.throws(() => createBriefingFact({
    category: 'decision',
    projectName: 'Apollo',
    origin: 'manual_pm_input',
    sourceEvidenceIds: ['finding-1'],
    detectedText: '',
    editedText: 'Unsupported evidence claim',
    included: true
  }), /cannot claim source evidence/);
  assert.throws(() => createBriefingFact({
    category: 'risk',
    projectName: 'Apollo',
    origin: 'evidence',
    sourceEvidenceIds: [],
    detectedText: 'Risk detected',
    editedText: 'Risk detected',
    included: true
  }), /require at least one source evidence ID/);
});

test('only finalization plus explicit communication advances one stream baseline', () => {
  const streamA = { id: 'stream-a', lastCommunicatedBriefingId: null, updatedAt: now };
  const streamB = { id: 'stream-b', lastCommunicatedBriefingId: 'briefing-b', updatedAt: now };
  const draft = { id: 'briefing-a', streamId: 'stream-a', status: 'draft', finalizedAt: null, updatedAt: now };
  const finalized = { ...draft, status: 'finalized', finalizedAt: now };
  const existingB = { id: 'briefing-b', streamId: 'stream-b', status: 'communicated' };

  assert.throws(() => markBriefingCommunicated(streamA, draft, now), /Only a finalized briefing/);
  const communicated = markBriefingCommunicated(streamA, finalized, now);
  assert.equal(communicated.briefing.status, 'communicated');
  assert.equal(communicated.stream.lastCommunicatedBriefingId, 'briefing-a');
  assert.equal(streamA.lastCommunicatedBriefingId, null);
  assert.equal(streamB.lastCommunicatedBriefingId, 'briefing-b');

  const briefings = [communicated.briefing, existingB];
  assert.equal(findStreamBaseline(communicated.stream, briefings).id, 'briefing-a');
  assert.equal(findStreamBaseline(streamB, briefings).id, 'briefing-b');
  assert.equal(findStreamBaseline({ ...streamA, lastCommunicatedBriefingId: 'briefing-b' }, briefings), null);
});

test('briefing snapshots are immutable and changes are explainable against the communicated baseline', () => {
  const stream = createBriefingStream({
    name: 'Apollo brief',
    projectNames: ['Apollo'],
    audienceProfile: 'manager',
    preferredFormats: ['teams'],
    defaultSections: ['progress', 'risk']
  }, { projectNames: ['Apollo'], id: 'stream-a', now });
  const projects = {
    Apollo: {
      stories: [{
        id: 'story-1', jiraId: 'APO-1', itemType: 'Story', summary: 'Prepare fictional launch',
        status: 'In progress', owner: 'Taylor', sprint: 'Sprint 1', lastUpdate: now,
        lastCommentedAt: ''
      }]
    }
  };

  const first = createBriefing(stream, projects, [], { id: 'briefing-1', now });
  assert.equal(first.comparisonBriefingId, null);
  assert.deepEqual(first.detectedChanges, []);
  assert.equal(first.currentSnapshot.projects[0].workItems[0].status, 'In progress');

  const withFact = replaceDraftFacts(first, [{
    category: 'progress', projectName: 'Apollo', workItemId: 'story-1', jiraId: 'APO-1',
    origin: 'manual_pm_input', sourceEvidenceIds: [], detectedText: '',
    editedText: 'APO-1 is in progress.', included: true
  }], { ids: ['fact-1'], now });
  const finalized = finalizeBriefing(withFact, now);
  const communicated = markBriefingCommunicated(stream, finalized, now);

  projects.Apollo.stories[0].status = 'Done';
  projects.Apollo.stories[0].owner = 'Morgan';
  const second = createBriefing(communicated.stream, projects, [communicated.briefing], {
    id: 'briefing-2', now: '2026-07-20T18:00:00.000Z'
  });

  assert.equal(second.comparisonBriefingId, 'briefing-1');
  assert.deepEqual(second.detectedChanges.map(change => change.field), ['status', 'owner']);
  assert.deepEqual(second.detectedChanges[0], {
    id: 'briefing-change-1',
    type: 'field_changed', projectName: 'Apollo', workItemId: 'story-1', jiraId: 'APO-1',
    deliveryProjectId: '', deliveryProjectName: '',
    field: 'status', before: 'In progress', after: 'Done'
  });
  assert.equal(communicated.briefing.currentSnapshot.projects[0].workItems[0].status, 'In progress');

  const sourced = replaceDraftFacts(second, [{
    category: 'progress', projectName: 'Apollo', workItemId: 'story-1', jiraId: 'APO-1',
    origin: 'work_item_change', sourceEvidenceIds: ['briefing-change-1'],
    detectedText: 'Status changed from In progress to Done.', editedText: 'APO-1 is now Done.', included: true
  }], { allowedChangeIds: new Set(second.detectedChanges.map(change => change.id)), now });
  assert.equal(sourced.facts[0].sourceEvidenceIds[0], 'briefing-change-1');
  assert.throws(() => replaceDraftFacts(second, [{
    category: 'progress', projectName: 'Apollo', origin: 'work_item_change',
    sourceEvidenceIds: ['invented-change'], detectedText: 'Invented', editedText: 'Invented', included: true
  }], { allowedChangeIds: new Set(second.detectedChanges.map(change => change.id)) }), /unknown supporting source/);
});

test('snapshot and draft fact boundaries remain bounded and project-scoped', () => {
  const stream = createBriefingStream({
    name: 'Apollo brief', projectNames: ['Apollo'], audienceProfile: 'manager',
    preferredFormats: ['teams'], defaultSections: ['progress']
  }, { projectNames: ['Apollo'], id: 'stream-a', now });
  const projects = { Apollo: { stories: [{ id: 'story-1', summary: 'Fictional item' }] } };
  const snapshot = buildBriefingSnapshot(stream, projects, now);
  assert.equal(snapshot.projects[0].workItems.length, 1);
  assert.deepEqual(detectBriefingChanges(snapshot, snapshot), []);

  const briefing = createBriefing(stream, projects, [], { id: 'briefing-1', now });
  assert.throws(() => replaceDraftFacts(briefing, [{
    category: 'other', projectName: 'Ledger', origin: 'manual_pm_input', sourceEvidenceIds: [],
    detectedText: '', editedText: 'Outside the stream', included: true
  }]), /outside this briefing/);
  assert.throws(() => finalizeBriefing(briefing, now), /at least one included fact/);
});

test('deterministic outputs use one included fact set with distinct channel templates', () => {
  const stream = createBriefingStream({
    name: 'Fictional portfolio brief', projectNames: ['Apollo', 'Ledger'], audienceProfile: 'mixed',
    preferredFormats: ['teams', 'email', 'confluence'], defaultSections: ['risk', 'progress']
  }, { projectNames: ['Apollo', 'Ledger'], id: 'stream-output', now });
  const briefing = {
    id: 'briefing-output', streamId: stream.id, status: 'finalized', projectNames: ['Apollo', 'Ledger'], audienceProfile: 'mixed',
    finalizedAt: now, updatedAt: now, outputs: [], facts: [
      { id: 'fact-risk', category: 'risk', projectName: 'Apollo', jiraId: 'APO-1', workItemId: '', origin: 'evidence', editedText: 'A fictional dependency needs review.', included: true },
      { id: 'fact-manual', category: 'progress', projectName: 'Ledger', jiraId: '', workItemId: '', origin: 'manual_pm_input', editedText: 'Leadership framing for a fictional checkpoint.', included: true },
      { id: 'fact-excluded', category: 'blocker', projectName: 'Apollo', jiraId: '', workItemId: '', origin: 'manual_pm_input', editedText: 'This text must stay excluded.', included: false }
    ]
  };

  const rendered = generateBriefingOutputs(stream, briefing, '2026-07-20T19:00:00.000Z');
  assert.deepEqual(rendered.outputs.map(output => output.format), ['teams', 'email', 'confluence']);
  rendered.outputs.forEach(output => {
    assert.deepEqual(output.sourceFactIds, ['fact-risk', 'fact-manual']);
    assert.doesNotMatch(output.content, /This text must stay excluded/);
    assert.match(output.content, /\[Manual PM input\]/);
    assert.ok(output.content.indexOf('Apollo') < output.content.indexOf('Ledger'));
  });
  assert.match(rendered.outputs.find(output => output.format === 'teams').content, /Here is the Fictional portfolio brief update/);
  assert.match(rendered.outputs.find(output => output.format === 'email').content, /Hello,/);
  assert.match(rendered.outputs.find(output => output.format === 'confluence').content, /## Executive Summary/);
  assert.match(rendered.outputs.find(output => output.format === 'confluence').content, /## Project Sections/);
  assert.equal(rendered.outputs.find(output => output.format === 'email').subject, 'Fictional portfolio brief — 2026-07-20');
  assert.equal(rendered.outputs.find(output => output.format === 'teams').subject, '');
  assert.throws(() => generateBriefingOutputs(stream, { ...briefing, status: 'draft' }, now), /only for a finalized briefing/);
});
