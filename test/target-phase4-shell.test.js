'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createCleanSeed } = require('../target-model/clean-seed');
const { serializeTargetData } = require('../target-model/persistence');
const { createTargetApiApp } = require('../target-server/app');
const { LOOPBACK_HOST, parseArguments } = require('../target-server/start');
const { requestApp } = require('../test-support/target-api-harness');
const {
  TARGET_V4_TEMPLATE,
  buildExtractionPrompt,
  canRunFinalPreview,
  createImportFeedState,
  createReviewDrafts,
  decisionForRow,
  formatLiveApplyLabel,
  formatForFilename,
  importValidationMessage,
  reviewReadiness,
  sourceDescriptor,
  summarizeFinalPreview,
  utf8ByteLength
} = require('../public/target-import-feed-state');
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

test('target release launcher requires explicit private paths and binds only to loopback', () => {
  assert.equal(LOOPBACK_HOST, '127.0.0.1');
  assert.throws(() => parseArguments([]), /requires explicit/);
  assert.throws(() => parseArguments(['--data-file', 'target.json']), /requires explicit/);
  assert.throws(() => parseArguments(['--data-file', 'target.json', '--source-files-root', 'sources', '--log-file', 'target.log', '--port', '70000']), /port is invalid/);
  const parsed = parseArguments(['--data-file', 'target.json', '--source-files-root', 'sources', '--log-file', 'target.log', '--port', '0']);
  assert.equal(parsed.targetDataFile, path.join(process.cwd(), 'target.json'));
  assert.equal(parsed.sourceFilesRoot, path.join(process.cwd(), 'sources'));
  assert.equal(parsed.logFile, path.join(process.cwd(), 'target.log'));
  assert.equal(parsed.port, 0);
});

test('isolated target entry exposes the canonical hierarchy and operational navigation', async () => {
  const markup = await source('public/target/index.html');
  for (const expected of [
    'Organization', 'Workspace', 'Portfolio', 'Today', 'Work Items', 'Workstream', 'Follow-Up', 'Milestones',
    'Add Source', 'Import Feed', 'Source Library', 'Review', 'Briefings', 'Settings', 'All initiatives'
  ]) assert.match(markup, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  for (const prohibited of [
    'Project / Jira Epic', 'Project/Epic', 'All projects', 'whole PM workspace', 'Project stream',
    'Briefing stream', 'Project not identified', 'Miscellaneous / No Epic', 'Evidence pending',
    'Extracted DSU updates', 'Teams Draft', 'Status Summary', 'Strategy', 'Sub-task', 'PM Workspace', 'Scope', 'Feature'
  ]) assert.doesNotMatch(markup, new RegExp(prohibited.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

  assert.match(markup, /<main[^>]+id="target-main"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /<dialog[^>]+aria-labelledby="dialog-title"/);
  assert.match(markup, /Open workspace/);
  assert.match(markup, /No workspace data is loaded until you open it/);
  assert.doesNotMatch(markup, /schema-v5|LOCAL · TARGET/);
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
  assert.match(client, /All Workstreams/);
  assert.match(client, /function workstreamOptionLabel\(workstream\)/);
  assert.match(client, /Stable ID: \$\{workstream\.id\}/);
  assert.match(client, /Create Workstream/);
  assert.match(client, /Preview changes/);
  assert.match(client, /All Jira Epics/);
  assert.match(client, /No Jira Epic/);
  assert.match(client, /function jiraEpicOptionLabel\(mapping\)/);
  assert.match(client, /jiraEpicAssignment\.disabled = controls\.jiraEpicDisabled/);
  assert.match(client, /result\.kind === 'workItem'/);
  assert.match(client, /Work Item Jira key/);
  assert.match(client, /Preview \$\{entityLabel\} rename/);
  assert.match(client, /onApplied\(result\.body\);[\s\S]*state\.workflow = null;[\s\S]*await loadWorkflow\(\);[\s\S]*renderSettings\(\);/);
  assert.match(client, /Existing frozen Briefing snapshots are not rewritten/);
  assert.doesNotMatch(client, /sendBriefing|sendOutput|autoPublish/);
});

test('Import Feed validation errors are actionable and stale review controls are removed after failures', async () => {
  assert.equal(importValidationMessage({
    code: 'IMPORT_VALIDATION_FAILED',
    validation: { reason: 'invalid-field', recordIndex: 2, field: 'externalKey' }
  }), 'Record 3, externalKey: enter a supported value in the required format.');
  assert.equal(importValidationMessage({
    code: 'IMPORT_VALIDATION_FAILED',
    validation: { reason: 'malformed-csv' }
  }), 'CSV contains invalid quote placement.');
  assert.equal(importValidationMessage({
    code: 'IMPORT_VALIDATION_FAILED',
    validation: { reason: 'field-too-long', recordIndex: 0, field: 'description' }
  }), 'Record 1, description: use 4,000 characters or fewer.');

  const client = await source('public/target/app.js');
  const validate = functionSlice(client, 'validateImportFeed', 'importReviewCounts');
  const preview = functionSlice(client, 'previewReviewedImport', 'importFinalPreviewPanel');
  const apply = functionSlice(client, 'applyReviewedImport', 'importOutcomePanel');
  assert.match(validate, /invalidateImportValidation\(\);[\s\S]*await renderImportFeed\(\);/);
  assert.match(preview, /state\.importFeed\.finalPreview = null;[\s\S]*await renderImportFeed\(\);/);
  assert.match(apply, /state\.importFeed\.finalPreview = null;[\s\S]*await renderImportFeed\(\);/);
  assert.match(apply, /state\.importFeed\.applying = true;[\s\S]*await renderImportFeed\(\);/);
  assert.match(client, /disabled: state\.importFeed\.applying/);
});

test('Settings exposes complete Initiative setup through the accepted revision-aware services', async () => {
  const client = await source('public/target/app.js');
  const create = functionSlice(client, 'createInitiativeFromSettings', 'initiativeRelationshipCounts');
  const lifecycle = functionSlice(client, 'setInitiativeArchivedFromSettings', 'initiativeSettingsCard');
  const settings = functionSlice(client, 'renderSettings', 'renderActiveView');

  assert.match(create, /Initiative name is required/);
  assert.match(create, /expectedRevision: state\.workflow\.revision/);
  assert.match(create, /description: controls\.description\.value\.trim\(\)/);
  assert.match(create, /owner: controls\.owner\.value\.trim\(\) \|\| null/);
  assert.match(create, /state\.workflow = null;[\s\S]*await loadWorkflow\(\);[\s\S]*renderSettings\(\)/);
  assert.match(lifecycle, /confirmAction\(/);
  assert.match(lifecycle, /Archive is reversible/);
  assert.match(lifecycle, /nothing is deleted/);
  assert.match(lifecycle, /expectedRevision: revision/);
  assert.match(lifecycle, /archived/);
  assert.match(client, /Stable ID: \$\{initiative\.id\}/);
  assert.match(client, /Restore Initiative/);
  assert.match(client, /No Initiatives exist in this Workspace yet/);
  assert.doesNotMatch(client, /deleteInitiative|method:\s*'DELETE'/);

  for (const label of ['Structure', 'Behavior and drafting', 'Data and privacy', 'Organization', 'Workspace', 'Initiatives', 'Workstreams', 'Jira Epic mappings', 'Behavior', 'AI — Advanced', 'Data & Privacy']) {
    assert.match(settings, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const instruction of [
    'Name your Organization and Workspace.',
    'Create or rename Initiatives.',
    'Add optional Workstreams.',
    'Add local Jira Epic mappings when needed.'
  ]) assert.match(settings, new RegExp(instruction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(settings, /Workstreams and Jira Epic mappings are optional and independent/);
  assert.match(settings, /aria-label': 'Settings sections'/);
  for (const href of ['#settings-structure', '#settings-behavior-drafting', '#settings-data-privacy']) {
    assert.match(settings, new RegExp(href));
  }
});

test('Work Item filters, bulk assignment, selection state, and empty states are separate and deterministic', async () => {
  const client = await source('public/target/app.js');
  const work = functionSlice(client, 'renderWorkItems', 'renderFollowUp');
  assert.match(work, /node\('fieldset', \{ className: 'control-group filters-group'/);
  assert.match(work, /node\('legend', \{ text: 'Filters' \}\)/);
  assert.match(work, /node\('fieldset', \{ className: 'control-group bulk-assignment-group'/);
  assert.match(work, /node\('legend', \{ text: 'Bulk assignment' \}\)/);
  assert.match(work, /workflowModule\.workItemControlState/);
  assert.match(work, /selectedCount\.textContent = controls\.selectedCountLabel/);
  assert.match(work, /assignment\.disabled = controls\.initiativeDisabled/);
  assert.match(work, /workstreamAssignment\.disabled = controls\.workstreamDisabled/);
  assert.match(work, /jiraEpicAssignment\.disabled = controls\.jiraEpicDisabled/);
  assert.match(work, /previewButton\.disabled = controls\.previewDisabled/);
  assert.match(work, /Select one or more Work Items to change their associations/);
  assert.match(work, /state\.selectedWorkItemIds\.(?:add|delete)/);
  assert.match(work, /No Work Items have been added to this Workspace yet/);
  assert.match(work, /Add and review source material to begin building the delivery view/);
  assert.match(work, /No Work Items match the current filters/);
  assert.match(work, /Clear or change the filters to see more work/);
  assert.match(work, /activateView\('add-source'\)/);
  assert.match(work, /clearWorkItemFilters/);
  assert.match(work, /workItemEmptyState\(totalWorkItems, items\.length\)/);
  assert.doesNotMatch(work, /Import Feed/);
});

test('ordinary interface copy is plain while local-only and no-send safeguards remain visible', async () => {
  const markup = await source('public/target/index.html');
  const client = await source('public/target/app.js');
  const visible = `${markup}\n${client}`;
  assert.match(client, /How this mapping was confirmed/);
  assert.match(client, /Priorena creates drafts for you to review and copy/);
  assert.match(client, /It never sends them automatically/);
  assert.match(client, /Your Priorena data stays in the selected local data file/);
  assert.match(client, /does not send analytics or telemetry/);
  assert.match(client, /does not create or modify anything in Jira/);
  assert.doesNotMatch(client, /Target-safe Organization, Workspace, behavior, and privacy settings/);
  assert.doesNotMatch(client, /Target data stays in the explicitly selected local schema-v5 file/);
  for (const phrase of [
    'The target data changed',
    'Target data changed while Briefings were loading',
    'The requested target page could not be loaded',
    'No Organizations exist in this target store'
  ]) assert.doesNotMatch(client, new RegExp(phrase));
  assert.match(markup, /<title>Priorena workspace<\/title>/);
  assert.match(markup, /aria-label="Priorena navigation"/);
  assert.match(markup, /aria-label="Priorena application"/);
  assert.match(visible, /Import Feed/);
  assert.match(client, /Priorena reads the selected feed locally/);
  assert.match(client, /does not upload screenshots, contact ChatGPT, write to Jira, or send messages/);
});

test('historical release note preserves its original scope and points to the later implemented follow-up', async () => {
  const note = await source('docs/release/STRUCTURE_SETUP_AND_EMPTY_STATE_UX.md');
  assert.match(note, /External Feed Import and Review UI/);
  assert.match(note, /backend already supports strict import parsing/);
  for (const capability of ['JSON and CSV upload', 'paste option', 'validation before persistence', 'duplicate review', 'Initiative mapping', 'Workstream mapping', 'Jira Epic mapping review', 'per-record and bulk approval', 'explicit apply', 'no automatic Jira write or communication']) {
    assert.match(note, new RegExp(capability.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.match(note, /not implemented by this release/);
  assert.match(note, /Later follow-up status/);
  assert.match(note, /docs\/release\/EXTERNAL_FEED_IMPORT_REVIEW_UI\.md/);
  assert.match(note, /does not\s+change the historical scope/);
});

test('target DOM integration rejects late context renders and keeps page context truthful', async () => {
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
  assert.match(client, /elements\.initiative\.hidden = true/);
});

test('Follow-Up filtering retains its surface and communication channel is independent of output format', async () => {
  const client = await source('public/target/app.js');
  const filter = functionSlice(client, 'initiativeFilterControl', 'previewInitiativeAssignment');
  const followUp = functionSlice(client, 'renderFollowUp', 'renderMilestones');
  const finalized = functionSlice(client, 'renderFinalizedEditor', 'renderCommunicatedEditor');
  assert.match(filter, /renderFilteredView = renderWorkItems/);
  assert.match(filter, /renderFilteredView\(\)/);
  assert.match(followUp, /initiativeFilterControl\(renderFollowUp\)/);
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
    briefings: [{ organizationId: 'org-fixture-beta', workspaces: [], initiatives: [] }]
  }, 'org-fixture-alpha'), /crossed its Organization context/);
});

test('local GPT extraction prompt is deterministic, target-v4 exact, and keeps screenshot review outside Priorena', () => {
  const prompt = buildExtractionPrompt();
  assert.equal(buildExtractionPrompt(), prompt);
  for (const required of [
    'screenshots remain in this separate ChatGPT conversation',
    'Do not invent, guess, complete, embellish',
    'outside knowledge',
    'Omit an unreadable field value',
    'exact visible Jira keys',
    'current information from historical information',
    'question, suggestion, intention, or possibility is not a decision or a current fact',
    'Never use proximity, similar titles, tabs, neighboring rows',
    'itemType only when that type is explicitly visible for the same Jira item',
    'Set jiraProjectKey and jiraEpicKey only when both values are explicitly visible for the same Jira item',
    'no Epic, None, No Epic, Unassigned',
    'evidenceExcerpt only for a readable exact excerpt',
    'Do not output requestedInitiativeId',
    'Feature must never become a Workstream suggestion',
    'Output exactly one raw JSON object and nothing else',
    'Do not wrap the JSON in a Markdown fence',
    '"target-v4"',
    'no more than 100 records',
    'review, map, and explicitly approve records inside Priorena',
    'Organization', 'Workspace', 'Initiative', 'Workstream', 'Jira Epic', 'Work Item', 'Finding', 'Evidence'
  ]) assert.match(prompt, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(prompt, /\/Users\/|\\Users\\|schema-v5|[a-f0-9]{64}|api[_ -]?key/i);
  assert.doesNotMatch(prompt, /```/);
  assert.equal(TARGET_V4_TEMPLATE, '{\n  "version": "target-v4",\n  "records": []\n}\n');
  assert.deepEqual(JSON.parse(TARGET_V4_TEMPLATE), { version: 'target-v4', records: [] });
});

test('Import Feed shared state validates local file formats, source descriptors, decisions, bytes, and outcome counts', () => {
  assert.equal(formatForFilename('fictional-feed.JSON'), 'target-json');
  assert.equal(formatForFilename('fictional-feed.csv'), 'target-csv');
  assert.throws(() => formatForFilename('fictional-feed.png'), /\.json or \.csv/);
  assert.equal(utf8ByteLength('é'), 2);
  assert.deepEqual(sourceDescriptor('target-json', { title: ' Feed ', date: '2026-08-14', provenance: ' Local ' }), {
    title: 'Feed', type: 'normalized-json', sourceKind: 'normalized-feed', date: '2026-08-14', provenance: 'Local'
  });
  assert.deepEqual(sourceDescriptor('structured-text', { title: 'Note', date: '2026-08-14', provenance: 'Paste' }), {
    title: 'Note', type: 'external-evidence-feed', sourceKind: 'external-evidence-metadata', date: '2026-08-14', provenance: 'Paste'
  });
  const state = createImportFeedState('2026-08-14');
  assert.equal(state.filename, null);
  assert.equal(state.sourceDate, '2026-08-14');
  assert.equal(state.rowDrafts instanceof Map, true);
  assert.equal(state.acknowledgedPreviewHash, null);
  const row = { recordIndex: 0, match: null, findingAvailable: true };
  assert.deepEqual(decisionForRow(row, { includeRecord: false }), {
    recordIndex: 0, includeRecord: false, createWorkItem: false, approvedItemType: null,
    approvedSummary: null, approvedDescription: null, initiativeId: null, workstreamId: null,
    jiraEpicMappingId: null, includeFinding: false
  });
  assert.deepEqual(decisionForRow(row, {
    includeRecord: true, createWorkItem: true, approvedItemType: 'Task', approvedSummary: 'Approved',
    approvedDescription: '', initiativeId: 'initiative-one', workstreamId: null, jiraEpicMappingId: null, includeFinding: true
  }), {
    recordIndex: 0, includeRecord: true, createWorkItem: true, approvedItemType: 'Task', approvedSummary: 'Approved',
    approvedDescription: '', initiativeId: 'initiative-one', workstreamId: null, jiraEpicMappingId: null, includeFinding: true
  });
  assert.deepEqual(summarizeFinalPreview({
    reviewRows: [{ supportedForApply: true }, { supportedForApply: false }],
    reviewDecisions: [{ includeRecord: true }, { includeRecord: false }],
    proposals: [
      { type: 'source-create' }, { type: 'work-item-create' }, { type: 'work-item-assign' },
      { type: 'finding-create' }, { type: 'proposed-current-state-change' }
    ]
  }), {
    sources: 1, newWorkItems: 1, relationshipChanges: 1, pendingFindings: 1,
    deferredCurrentStateChanges: 1, evidenceReassociations: 0,
    selectedRows: 1, excludedRows: 1, blockedRows: 1
  });
});

test('Import Feed readiness is derived from selected review decisions and never defaults canonical type', () => {
  const row = (recordIndex, changes = {}) => ({
    recordIndex,
    externalKey: `FICTA-${800 + recordIndex}`,
    sourceItemType: null,
    sourceSummary: `Fictional row ${recordIndex + 1}`,
    sourceDescription: '',
    match: null,
    duplicateReasons: [],
    reviewState: 'new-record',
    supportedForApply: true,
    findingAvailable: false,
    ...changes
  });
  const preview = { reviewRows: Array.from({ length: 5 }, (_, index) => row(index)) };
  const drafts = createReviewDrafts(preview);
  for (const draft of drafts.values()) {
    assert.equal(draft.approvedItemType, null);
    draft.includeRecord = true;
    draft.createWorkItem = true;
  }
  drafts.get(0).approvedItemType = 'Story';
  drafts.get(1).approvedItemType = 'Task';
  drafts.get(2).approvedItemType = 'Bug';

  let readiness = reviewReadiness(preview, drafts);
  assert.deepEqual({
    valid: readiness.valid,
    selected: readiness.selected,
    ready: readiness.ready,
    needsAction: readiness.needsAction,
    blocked: readiness.blocked
  }, { valid: 5, selected: 5, ready: 3, needsAction: 2, blocked: 0 });
  assert.equal(readiness.firstIncomplete.recordIndex, 3);
  assert.equal(readiness.firstIncomplete.focusTarget, 'item-type');
  assert.deepEqual(readiness.firstIncomplete.messages, ['Select a Work Item type.']);
  assert.equal(canRunFinalPreview(readiness, true), false);

  drafts.get(3).approvedItemType = 'Other';
  drafts.get(4).approvedItemType = 'Unknown';
  readiness = reviewReadiness(preview, drafts);
  assert.deepEqual({ ready: readiness.ready, needsAction: readiness.needsAction, blocked: readiness.blocked }, {
    ready: 5, needsAction: 0, blocked: 0
  });
  assert.equal(readiness.firstIncomplete, null);
  assert.equal(canRunFinalPreview(readiness, true), true);
  assert.equal(canRunFinalPreview(readiness, false), false);

  drafts.get(4).approvedItemType = null;
  assert.equal(reviewReadiness(preview, drafts).needsAction, 1);
  drafts.get(4).includeRecord = false;
  readiness = reviewReadiness(preview, drafts);
  assert.deepEqual({ selected: readiness.selected, ready: readiness.ready, needsAction: readiness.needsAction }, {
    selected: 4, ready: 4, needsAction: 0
  });
  assert.equal(canRunFinalPreview(readiness, true), true);
});

test('Import Feed readiness preserves blocked, duplicate, exact-match, and explicit-type behavior', () => {
  const creation = {
    recordIndex: 0, externalKey: 'FICTA-900', sourceSummary: 'Fictional creation', sourceDescription: '',
    sourceItemType: 'Story', match: null, duplicateReasons: [], reviewState: 'new-record',
    supportedForApply: true, findingAvailable: false
  };
  const exact = {
    recordIndex: 1, externalKey: 'FICTA-901', sourceSummary: 'Fictional exact match', sourceDescription: '',
    sourceItemType: 'Task', match: { workItemId: 'work-item-fixture', initiativeId: null, workstreamId: null, jiraEpicMappingId: null },
    duplicateReasons: [], reviewState: 'existing-record', supportedForApply: true, findingAvailable: false
  };
  const blocked = {
    recordIndex: 2, externalKey: 'FICTA-902', sourceSummary: 'Fictional blocked row', sourceDescription: '',
    sourceItemType: null, match: null, duplicateReasons: ['multiple-local-exact-matches'],
    reviewState: 'duplicate-review', supportedForApply: false, findingAvailable: false
  };
  const preview = { reviewRows: [creation, exact, blocked] };
  const drafts = createReviewDrafts(preview);
  drafts.get(0).includeRecord = true;
  drafts.get(0).createWorkItem = true;
  drafts.get(1).includeRecord = true;
  drafts.get(2).includeRecord = true;

  let readiness = reviewReadiness(preview, drafts);
  assert.equal(drafts.get(0).approvedItemType, null, 'a Story suggestion must not establish canonical Story');
  assert.equal(readiness.rows[0].state, 'needs-action');
  assert.equal(readiness.rows[1].state, 'ready', 'an exact match does not require a creation type');
  assert.equal(readiness.rows[2].state, 'blocked');
  assert.equal(readiness.blocked, 1);
  assert.equal(canRunFinalPreview(readiness, true), false);

  for (const itemType of ['Story', 'Task', 'Bug', 'Other', 'Unknown']) {
    drafts.get(0).approvedItemType = itemType;
    assert.equal(reviewReadiness(preview, drafts).rows[0].state, 'ready');
  }
  drafts.get(2).includeRecord = false;
  readiness = reviewReadiness(preview, drafts);
  assert.equal(readiness.blocked, 0);
  assert.equal(canRunFinalPreview(readiness, true), true);

  const duplicatePreview = { reviewRows: [
    { ...creation, recordIndex: 0, externalKey: 'FICTA-990', duplicateReasons: ['duplicate-external-key-in-feed'] },
    { ...creation, recordIndex: 1, externalKey: 'FICTA-990', duplicateReasons: ['duplicate-external-key-in-feed'] }
  ] };
  const duplicateDrafts = createReviewDrafts(duplicatePreview);
  duplicateDrafts.forEach(draft => {
    draft.includeRecord = true;
    draft.createWorkItem = true;
    draft.approvedItemType = 'Task';
  });
  assert.equal(reviewReadiness(duplicatePreview, duplicateDrafts).needsAction, 2);
  duplicateDrafts.get(1).includeRecord = false;
  assert.deepEqual({
    ready: reviewReadiness(duplicatePreview, duplicateDrafts).ready,
    needsAction: reviewReadiness(duplicatePreview, duplicateDrafts).needsAction
  }, { ready: 1, needsAction: 0 });
});

test('Import Feed live Apply wording uses authoritative Final Preview category counts', () => {
  assert.equal(formatLiveApplyLabel({
    sources: 1, newWorkItems: 5, relationshipChanges: 0, pendingFindings: 0, evidenceReassociations: 0
  }), 'Apply 1 Source and 5 Work Items to live Priorena');
  assert.equal(formatLiveApplyLabel({
    sources: 1, newWorkItems: 1, relationshipChanges: 2, pendingFindings: 3, evidenceReassociations: 4
  }), 'Apply 1 Source, 1 Work Item, 2 Relationship Changes, 3 Pending Findings, and 4 Evidence Reassociations to live Priorena');
});

test('Import Feed client uses native local file, prompt download, strict review, custom confirmation, and no external clients', async () => {
  const client = await source('public/target/app.js');
  const moduleSource = await source('public/target-import-feed-state.js');
  const invalidateFinal = functionSlice(client, 'invalidateImportFinalPreview', 'downloadLocalText');
  const incompleteNavigation = functionSlice(client, 'goToFirstIncompleteRecord', 'importReviewPanel');
  const finalPreview = functionSlice(client, 'previewReviewedImport', 'importProposalEffect');
  const finalPanel = functionSlice(client, 'importFinalPreviewPanel', 'applyReviewedImport');
  const apply = functionSlice(client, 'applyReviewedImport', 'importOutcomePanel');
  for (const expected of [
    "accept: '.json,.csv,application/json,text/csv,text/plain'", 'file.text()', 'file.size',
    'navigator.clipboard?.writeText', 'new Blob', 'URL.createObjectURL', 'Download target-v4 JSON template',
    'Accepted input: strict target-v4 JSON', 'characters per bounded cell',
    'Validate and preview', 'Clear prepared feed', 'Validation and preview have not changed Priorena data', 'Bounded bulk review',
    'Select eligible new Work Items', 'Set selected creation type', 'Set selected Initiative',
    'Set selected Workstream', 'Set selected Jira Epic', 'Include selected pending Findings',
    'Review readiness', 'Go to first incomplete record', 'Select a Work Item type',
    'Run final write-free preview', "confirmAction('Apply to live Priorena'", 'approvedProposalIds: preview.approvableProposalIds',
    'Dry run complete. Priorena has not been changed.', 'Stop here to leave your live Priorena data unchanged.',
    'Apply to live Priorena', 'This will change your live Priorena data. This is no longer a preview.',
    'I reviewed these changes and understand they will be saved to live Priorena.',
    'Import another feed', "activateView('work-items')", "activateView('review')", "activateView('source-library')"
  ]) assert.match(client, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(moduleSource, /target-v4/);
  assert.doesNotMatch(client, /approvedItemType:\s*'Story'/);
  assert.doesNotMatch(client, /value === 'Story'/);
  assert.match(incompleteNavigation, /rowFilter = 'all'/);
  assert.match(incompleteNavigation, /data-import-record/);
  assert.match(incompleteNavigation, /scrollIntoView/);
  assert.match(incompleteNavigation, /focus\(\{ preventScroll: true \}\)/);
  assert.match(invalidateFinal, /acknowledgedPreviewHash = null/);
  assert.match(finalPreview, /finalPreview = result\.preview;[\s\S]*acknowledgedPreviewHash = null/);
  assert.match(finalPanel, /acknowledgedPreviewHash === preview\.previewHash/);
  assert.match(finalPanel, /disabled: state\.importFeed\.applying \|\| !acknowledged/);
  assert.match(finalPanel, /acknowledgement\.checked \? preview\.previewHash : null/);
  assert.doesNotMatch(finalPanel, /workflowApi\.applyImport/);
  assert.match(apply, /acknowledgedPreviewHash !== preview\.previewHash/);
  assert.match(apply, /expectedRevision: preview\.expectedRevision/);
  assert.match(apply, /previewHash: preview\.previewHash/);
  assert.match(apply, /approvedProposalIds: preview\.approvableProposalIds/);
  assert.doesNotMatch(client, /acknowledgedPreviewHash:\s*preview\.previewHash/);
  assert.doesNotMatch(`${client}\n${moduleSource}`, /fetch\([^\n]*(?:openai|chatgpt|atlassian|jira)|XMLHttpRequest|WebSocket/i);
  assert.doesNotMatch(client, /\bwindow\.(?:alert|confirm|prompt)\s*\(/);
});

test('target styles cover focus, responsive layouts, wrapping, dialogs, and reduced motion', async () => {
  const css = await source('public/target/styles.css');
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /max-height: calc\(100vh - 2rem\)/);
  assert.match(css, /\.control-group/);
  assert.match(css, /\.settings-navigation/);
  assert.match(css, /\.settings-navigation a:hover, \.settings-navigation a:focus-visible/);
  assert.match(css, /\.settings-card-grid/);
  assert.match(css, /\.import-readiness-summary \{[^}]*position: sticky/);
  assert.match(css, /\.import-live-apply/);
  assert.match(css, /\.import-apply-acknowledgement/);
  assert.match(css, /\.settings-card \.actions input \{[^}]*min-width: 0/);
  assert.doesNotMatch(css, /min-width:\s*[7-9]\d\dpx/);
});

test('target UI is the release root and does not mutate target data', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'priorena-phase4-shell-'));
  const targetDataFile = path.join(tempRoot, 'target-v5.json');
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
  const rootResponse = await requestApp(app, { url: '/' });
  assert.equal(rootResponse.status, 302);
  assert.equal(rootResponse.headers.location, '/target/');
  for (const moduleName of ['target-context-state.js', 'target-workflow-state.js', 'target-import-feed-state.js', 'target-briefing-state.js']) {
    const response = await requestApp(app, { url: `/target-modules/${moduleName}` });
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /^application\/javascript/);
    assert.equal(response.body, await source(`public/${moduleName}`));
  }
  assert.equal((await requestApp(app, { url: '/target-modules/app.js' })).status, 404);
  assert.doesNotMatch(await source('target-server/app.js'), /\.sendFile\s*\(/);
  assert.deepEqual(await fs.readFile(targetDataFile), before);
});
