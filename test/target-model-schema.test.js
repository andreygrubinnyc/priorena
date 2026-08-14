const assert = require('node:assert/strict');
const test = require('node:test');

const { CLEAN_SEED, createCleanSeed } = require('../target-model/clean-seed');
const {
  AUDIT_ACTIONS,
  MAX_AGGREGATE_ROOT_RECORDS,
  MAX_ROOT_COLLECTION_RECORDS,
  ROOT_COLLECTIONS,
  TARGET_SCHEMA_VERSION,
  TargetResourceLimitError,
  TargetSchemaVersionError,
  TargetValidationError,
  UNASSIGNED_INITIATIVE,
  createStableId,
  validateRootCollectionBounds,
  validateTargetData
} = require('../target-model/schema');
const {
  createWorkstreamIndependenceFixture,
  createInvalidCrossOrganizationFixture,
  createInvalidCrossWorkspaceFixture,
  createMultiOrganizationFixture,
  followUp
} = require('../test-support/target-v5-fixtures');

function clonedFixture() {
  return createMultiOrganizationFixture();
}

function assertInvalid(document, pattern = /must|invalid|required|unsupported|duplicate|reference/i) {
  assert.throws(() => validateTargetData(document), error => {
    assert.equal(error instanceof TargetValidationError, true);
    assert.match(error.message, pattern);
    return true;
  });
}

function documentWithOrganizationCount(count) {
  const document = createCleanSeed();
  const template = document.organizations[0];
  document.organizations = Array.from({ length: count }, (_, index) => ({
    ...template,
    id: index === 0 ? template.id : `org-bounded-${index}`
  }));
  return document;
}

function documentWithAggregateRootCount(count) {
  const document = createCleanSeed();
  ROOT_COLLECTIONS.forEach(collection => {
    document[collection] = [];
  });
  let remaining = count;
  ROOT_COLLECTIONS.forEach(collection => {
    const collectionCount = Math.min(remaining, MAX_ROOT_COLLECTION_RECORDS);
    document[collection] = Array(collectionCount).fill(null);
    remaining -= collectionCount;
  });
  assert.equal(remaining, 0);
  return document;
}

test('the deterministic clean seed is a valid complete schema-v5 document', () => {
  const first = createCleanSeed();
  const second = createCleanSeed();
  assert.equal(first.schemaVersion, TARGET_SCHEMA_VERSION);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(validateTargetData(first), first);
  assert.equal(Object.isFrozen(CLEAN_SEED), true);
  assert.deepEqual(Object.keys(first), [
    'schemaVersion',
    ...ROOT_COLLECTIONS,
    'userPreferences',
    'globalTechnicalSettings'
  ]);
});

test('the clean seed contains exactly the approved fictional hierarchy', () => {
  const seed = createCleanSeed();
  assert.deepEqual(seed.organizations.map(({ id, name }) => ({ id, name })), [
    { id: 'org-1', name: 'Organization 1' }
  ]);
  assert.deepEqual(seed.workspaces.map(({ id, organizationId, name }) => ({ id, organizationId, name })), [
    {
      id: 'workspace-1',
      organizationId: 'org-1',
      name: 'Workspace 1'
    }
  ]);
  assert.deepEqual(seed.initiatives.map(({ id, name }) => ({ id, name })), [
    { id: 'initiative-1', name: 'Initiative 1' },
    { id: 'initiative-2', name: 'Initiative 2' },
    { id: 'initiative-3', name: 'Initiative 3' },
    { id: 'initiative-4', name: 'Initiative 4' }
  ]);
  assert.ok(seed.initiatives.every(initiative => initiative.organizationId === 'org-1' && initiative.workspaceId === 'workspace-1'));
  assert.deepEqual(seed.userPreferences, {
    activeOrganizationId: 'org-1',
    activeWorkspaceIdsByOrganization: { 'org-1': 'workspace-1' }
  });
});

test('the clean seed contains none of the prohibited data collections or catch-all records', () => {
  const seed = createCleanSeed();
  [
    'workstreams', 'jiraEpicMappings', 'workItems', 'milestones', 'sources', 'findings', 'evidence',
    'proposedChanges', 'briefings', 'briefingVersions', 'auditEvents'
  ].forEach(collection => assert.deepEqual(seed[collection], []));
  assert.equal('projects' in seed, false);
  assert.equal('deliveryProjects' in seed, false);
  assert.equal('stories' in seed, false);
  assert.equal('timeline' in seed, false);
  assert.equal('transcripts' in seed, false);
  assert.doesNotMatch(JSON.stringify(seed), /Miscellaneous \/ No Epic|No Epic|catch-all/i);
  assert.doesNotMatch(JSON.stringify(seed), /PM Workspace|Scope|Feature|PJM|scope-|feature-/i);
});

test('schemaVersion is mandatory', () => {
  const document = createCleanSeed();
  delete document.schemaVersion;
  assertInvalid(document, /schemaVersion.*required/);
});

test('unsupported past schema versions fail closed', () => {
  const document = createCleanSeed();
  document.schemaVersion = 4;
  assert.throws(() => validateTargetData(document), error => {
    assert.equal(error instanceof TargetSchemaVersionError, true);
    assert.equal(error.code, 'UNSUPPORTED_TARGET_SCHEMA_VERSION');
    return true;
  });
});

test('unknown future schema versions fail closed', () => {
  const document = createCleanSeed();
  document.schemaVersion = 6;
  assert.throws(() => validateTargetData(document), TargetSchemaVersionError);
  assert.equal(document.schemaVersion, 6);
});

test('every root collection is mandatory and must be an array', () => {
  const missing = createCleanSeed();
  delete missing.auditEvents;
  assertInvalid(missing, /auditEvents.*required/);

  const malformed = createCleanSeed();
  malformed.organizations = {};
  assertInvalid(malformed, /organizations.*array/);
});

test('unsupported root and entity fields are rejected instead of normalized', () => {
  const legacyRoot = createCleanSeed();
  legacyRoot.projects = {};
  assertInvalid(legacyRoot, /unsupported field "projects"/);

  const legacyRelationship = clonedFixture();
  legacyRelationship.workItems[0].deliveryProjectId = 'legacy-project';
  assertInvalid(legacyRelationship, /unsupported field "deliveryProjectId"/);

  for (const legacyCollection of ['scopes', 'features']) {
    const document = createCleanSeed();
    document[legacyCollection] = [];
    assertInvalid(document, new RegExp(`unsupported field "${legacyCollection}"`));
  }

  for (const legacyField of ['scopeId', 'featureId']) {
    const document = clonedFixture();
    document.workItems[0][legacyField] = null;
    assertInvalid(document, new RegExp(`unsupported field "${legacyField}"`));
  }
});

test('malformed entity records and missing required parent IDs are rejected', () => {
  const malformed = clonedFixture();
  malformed.organizations[0].archived = 'false';
  assertInvalid(malformed, /archived.*boolean/);

  const incomplete = clonedFixture();
  delete incomplete.initiatives[0].organizationId;
  assertInvalid(incomplete, /organizationId.*required/);
});

test('generated stable IDs are opaque and display-name changes preserve identity', () => {
  const stableId = createStableId('initiative', { uuid: '123e4567-e89b-12d3-a456-426614174000' });
  assert.equal(stableId, 'initiative-123e4567-e89b-12d3-a456-426614174000');

  const document = clonedFixture();
  const workspace = document.workspaces[0];
  const initiative = document.initiatives[0];
  const workItem = document.workItems[0];
  const ids = [workspace.id, initiative.id, workItem.id];
  workspace.name = 'Renamed Fictional Workspace';
  initiative.name = 'Renamed Fictional Initiative';
  workItem.summary = 'Renamed fictional Work Item';
  validateTargetData(document);
  assert.deepEqual([workspace.id, initiative.id, workItem.id], ids);
});

test('duplicate Workspace names across Organizations are valid and IDs remain the lookup boundary', () => {
  const document = clonedFixture();
  const duplicateNames = document.workspaces.filter(item => item.name === 'Shared Delivery Workspace');
  assert.equal(duplicateNames.length, 2);
  assert.notEqual(duplicateNames[0].organizationId, duplicateNames[1].organizationId);
  assert.notEqual(duplicateNames[0].id, duplicateNames[1].id);
  validateTargetData(document);
});

test('a Workspace must reference an existing Organization', () => {
  const document = clonedFixture();
  document.workspaces[0].organizationId = 'org-missing';
  assertInvalid(document, /existing Organization/);
});

test('Workspace parent mismatches invalidate every dependent parent chain', () => {
  const document = clonedFixture();
  document.workspaces.find(item => item.id === 'workspace-alpha-shared').organizationId = 'org-fixture-beta';
  assertInvalid(document, /matching Organization|matching Organization and Workspace/);
});

test('duplicate Initiative names are valid in different Workspaces and Organizations', () => {
  const document = clonedFixture();
  const sharedInitiatives = document.initiatives.filter(item => item.name === 'Shared Initiative');
  assert.equal(sharedInitiatives.length, 3);
  assert.equal(new Set(sharedInitiatives.map(item => item.workspaceId)).size, 3);
  assert.equal(new Set(sharedInitiatives.map(item => item.organizationId)).size, 2);
  validateTargetData(document);
});

test('Workstreams are first-class Initiative children and duplicate display names remain ID-scoped', () => {
  const document = clonedFixture();
  assert.equal(document.workstreams.length, 4);
  assert.equal(new Set(document.workstreams.map(item => item.name)).size, 1);
  assert.equal(new Set(document.workstreams.map(item => item.id)).size, 4);
  validateTargetData(document);

  const wrongInitiative = clonedFixture();
  wrongInitiative.workstreams.find(item => item.id === 'workstream-alpha-mapped').initiativeId = 'initiative-beta-shared';
  assertInvalid(wrongInitiative, /Initiative with matching Organization and Workspace/);

  const extraField = clonedFixture();
  extraField.workstreams[0].archived = false;
  assertInvalid(extraField, /unsupported field "archived"/);
});

test('Work Item Workstream references require an exact Organization, Workspace, and Initiative match', () => {
  const document = clonedFixture();
  const workstreamAssigned = document.workItems.find(item => item.id === 'work-item-alpha-assigned');
  assert.equal(workstreamAssigned.workstreamId, 'workstream-alpha-mapped');
  validateTargetData(document);

  const unscoped = clonedFixture();
  const unassigned = unscoped.workItems.find(item => item.id === 'work-item-alpha-unassigned');
  unassigned.workstreamId = 'workstream-alpha-mapped';
  assertInvalid(unscoped, /requires a non-null Initiative/);

  const wrongInitiative = clonedFixture();
  wrongInitiative.workItems.find(item => item.id === 'work-item-alpha-assigned').workstreamId = 'workstream-alpha-zero';
  assertInvalid(wrongInitiative, /Workstream with matching Organization, Workspace, and Initiative/);

  const foreign = clonedFixture();
  foreign.workItems.find(item => item.id === 'work-item-alpha-assigned').workstreamId = 'workstream-beta-shared';
  assertInvalid(foreign, /Workstream with matching Organization, Workspace, and Initiative/);
});

test('hierarchy, Jira, and Sub-task labels are not Work Item types', () => {
  for (const rejectedType of ['Initiative', 'Workstream', 'Feature', 'Epic', 'Sub-task']) {
    const document = clonedFixture();
    document.workItems[0].itemType = rejectedType;
    assertInvalid(document, /Story, Task, Bug, Other, Unknown/);
  }
});

test('the complete schema-v5 Work Item type set is accepted', () => {
  for (const itemType of ['Story', 'Task', 'Bug', 'Other', 'Unknown']) {
    const document = clonedFixture();
    document.workItems[0].itemType = itemType;
    assert.equal(validateTargetData(document), document);
  }
});

test('schema-v5 Work Items require an explicit nullable Jira Epic mapping reference', () => {
  const document = clonedFixture();
  const assigned = document.workItems.find(item => item.id === 'work-item-alpha-assigned');
  const unassigned = document.workItems.find(item => item.id === 'work-item-alpha-unassigned');
  assert.equal(assigned.jiraEpicMappingId, 'jira-mapping-alpha-one');
  assert.equal(unassigned.jiraEpicMappingId, null);
  validateTargetData(document);

  const missing = clonedFixture();
  delete missing.workItems[0].jiraEpicMappingId;
  assertInvalid(missing, /jiraEpicMappingId.*required/);

  const malformed = clonedFixture();
  malformed.workItems[0].jiraEpicMappingId = {};
  assertInvalid(malformed, /jiraEpicMappingId.*must be text/);
});

test('Work Item Jira Epic references require exact Organization, Workspace, and Initiative parents', () => {
  const unscoped = clonedFixture();
  const unassigned = unscoped.workItems.find(item => item.id === 'work-item-alpha-unassigned');
  unassigned.jiraEpicMappingId = 'jira-mapping-alpha-one';
  assertInvalid(unscoped, /jiraEpicMappingId.*requires a non-null Initiative/);

  const wrongInitiative = clonedFixture();
  wrongInitiative.workItems.find(item => item.id === 'work-item-alpha-assigned').jiraEpicMappingId = 'jira-mapping-alpha-secondary';
  assertInvalid(wrongInitiative, /Jira Epic mapping with matching Organization, Workspace, and Initiative/);

  const foreign = clonedFixture();
  foreign.workItems.find(item => item.id === 'work-item-alpha-assigned').jiraEpicMappingId = 'jira-mapping-beta-shared-key';
  assertInvalid(foreign, /Jira Epic mapping with matching Organization, Workspace, and Initiative/);
});

test('schema-v5 permits all five independent Initiative, Workstream, and Jira Epic association states', () => {
  const document = clonedFixture();
  const template = structuredClone(document.workItems.find(item => item.id === 'work-item-alpha-assigned'));
  document.workItems = [
    { ...structuredClone(template), id: 'work-item-state-unassigned', initiativeId: null, workstreamId: null, jiraEpicMappingId: null },
    { ...structuredClone(template), id: 'work-item-state-initiative', workstreamId: null, jiraEpicMappingId: null },
    { ...structuredClone(template), id: 'work-item-state-workstream', jiraEpicMappingId: null },
    { ...structuredClone(template), id: 'work-item-state-jira', workstreamId: null },
    { ...structuredClone(template), id: 'work-item-state-both' }
  ];
  document.milestones.forEach(milestone => { milestone.linkedWorkItemIds = []; });
  document.findings.forEach(finding => { finding.proposedWorkItemId = null; });
  document.evidence.forEach(item => { item.workItemId = null; });
  document.proposedChanges = [];
  document.auditEvents = [];
  validateTargetData(document);
  assert.deepEqual(
    document.workItems.map(item => [item.initiativeId, item.workstreamId, item.jiraEpicMappingId]),
    [
      [null, null, null],
      ['initiative-alpha-multiple-mappings', null, null],
      ['initiative-alpha-multiple-mappings', 'workstream-alpha-mapped', null],
      ['initiative-alpha-multiple-mappings', null, 'jira-mapping-alpha-one'],
      ['initiative-alpha-multiple-mappings', 'workstream-alpha-mapped', 'jira-mapping-alpha-one']
    ]
  );
});

test('Initiatives support zero, one, and multiple Jira Epic mappings', () => {
  const document = clonedFixture();
  const counts = Object.fromEntries(document.initiatives.map(initiative => [
    initiative.id,
    document.jiraEpicMappings.filter(mapping => mapping.initiativeId === initiative.id).length
  ]));
  assert.equal(counts['initiative-alpha-zero-mapping'], 0);
  assert.equal(counts['initiative-alpha-secondary'], 1);
  assert.equal(counts['initiative-alpha-multiple-mappings'], 2);
  validateTargetData(document);
});

test('Jira mappings and Workstreams remain independent for mapped Initiatives and scoped Work Items', () => {
  const document = createWorkstreamIndependenceFixture();
  const initiativeId = 'initiative-alpha-mapping-only';
  const mapping = document.jiraEpicMappings.find(item => item.initiativeId === initiativeId);
  const assigned = document.workItems.find(item => item.id === 'work-item-alpha-initiative-only-no-workstream');
  assert.ok(mapping);
  assert.equal(document.workstreams.some(item => item.initiativeId === initiativeId), false);
  assert.equal(assigned.initiativeId, initiativeId);
  assert.equal(assigned.workstreamId, null);
  validateTargetData(document);

  const workstreamsBefore = structuredClone(document.workstreams);
  mapping.jiraEpicName = 'Fictional Renamed Mapping Without Workstream';
  mapping.jiraEpicKey = 'FICTA-302';
  validateTargetData(document);
  assert.deepEqual(document.workstreams, workstreamsBefore);
});

test('a Jira Epic mapping rejects missing or foreign Initiative parents', () => {
  const missing = clonedFixture();
  missing.jiraEpicMappings[0].initiativeId = 'initiative-missing';
  assertInvalid(missing, /Initiative with matching/);

  const foreign = clonedFixture();
  foreign.jiraEpicMappings[0].initiativeId = 'initiative-beta-shared';
  assertInvalid(foreign, /Initiative with matching/);
});

test('a Jira Epic mapping rejects mismatched Organization or Workspace parents', () => {
  const organizationMismatch = clonedFixture();
  organizationMismatch.jiraEpicMappings[0].organizationId = 'org-fixture-beta';
  assertInvalid(organizationMismatch, /matching Organization/);

  const workspaceMismatch = clonedFixture();
  workspaceMismatch.jiraEpicMappings[0].workspaceId = 'workspace-alpha-secondary';
  assertInvalid(workspaceMismatch, /matching Organization and Workspace/);
});

test('active Jira Epic mappings are unique within a Workspace but may repeat across Organizations', () => {
  const valid = clonedFixture();
  assert.equal(valid.jiraEpicMappings[0].jiraEpicKey, valid.jiraEpicMappings[3].jiraEpicKey);
  assert.equal(new Set(valid.jiraEpicMappings.map(mapping => mapping.jiraEpicName)).size, 1);
  assert.equal(new Set(valid.jiraEpicMappings.map(mapping => mapping.id)).size, 4);
  validateTargetData(valid);

  const duplicate = clonedFixture();
  duplicate.jiraEpicMappings[1].jiraEpicKey = duplicate.jiraEpicMappings[0].jiraEpicKey.toLowerCase();
  assertInvalid(duplicate, /duplicates an active Jira Epic mapping/);

  duplicate.jiraEpicMappings[1].mappingStatus = 'inactive';
  validateTargetData(duplicate);
});

test('Jira project and Epic keys reject leading or trailing whitespace without normalization', () => {
  const cases = [
    ['jiraProjectKey', ' FICTA'],
    ['jiraProjectKey', 'FICTA '],
    ['jiraEpicKey', ' FICTA-101'],
    ['jiraEpicKey', 'FICTA-101 ']
  ];

  cases.forEach(([field, value]) => {
    const document = clonedFixture();
    document.jiraEpicMappings[0][field] = value;
    assertInvalid(document, new RegExp(`${field}.*leading or trailing whitespace`));
    assert.equal(document.jiraEpicMappings[0][field], value);
  });
});

test('case- and whitespace-equivalent active Jira mappings cannot bypass one-Initiative ownership', () => {
  const caseEquivalent = clonedFixture();
  const caseDuplicate = caseEquivalent.jiraEpicMappings[1];
  caseDuplicate.initiativeId = 'initiative-alpha-zero-mapping';
  caseDuplicate.jiraProjectKey = caseEquivalent.jiraEpicMappings[0].jiraProjectKey.toLowerCase();
  caseDuplicate.jiraEpicKey = caseEquivalent.jiraEpicMappings[0].jiraEpicKey.toLowerCase();
  assertInvalid(caseEquivalent, /duplicates an active Jira Epic mapping/);

  const whitespaceEquivalent = clonedFixture();
  const whitespaceDuplicate = whitespaceEquivalent.jiraEpicMappings[1];
  whitespaceDuplicate.initiativeId = 'initiative-alpha-zero-mapping';
  whitespaceDuplicate.jiraProjectKey = ` ${whitespaceEquivalent.jiraEpicMappings[0].jiraProjectKey}`;
  whitespaceDuplicate.jiraEpicKey = `${whitespaceEquivalent.jiraEpicMappings[0].jiraEpicKey} `;
  assertInvalid(whitespaceEquivalent, /leading or trailing whitespace/);
});

test('canonical Jira keys remain valid and equivalent keys remain permitted across Organizations', () => {
  const document = clonedFixture();
  const alpha = document.jiraEpicMappings.find(mapping => mapping.id === 'jira-mapping-alpha-one');
  const beta = document.jiraEpicMappings.find(mapping => mapping.id === 'jira-mapping-beta-shared-key');
  assert.deepEqual(
    [alpha.jiraProjectKey, alpha.jiraEpicKey, beta.jiraProjectKey, beta.jiraEpicKey],
    ['FICTA', 'FICTA-101', 'FICTA', 'FICTA-101']
  );
  assert.notEqual(alpha.organizationId, beta.organizationId);
  validateTargetData(document);
});

test('changing Jira keys or names never renames or re-identifies an Initiative', () => {
  const document = clonedFixture();
  const initiative = document.initiatives.find(item => item.id === 'initiative-alpha-multiple-mappings');
  const original = { id: initiative.id, name: initiative.name };
  document.jiraEpicMappings[0].jiraEpicKey = 'FICTA-999';
  document.jiraEpicMappings[0].jiraEpicName = 'Renamed Fictional External Epic';
  validateTargetData(document);
  assert.deepEqual({ id: initiative.id, name: initiative.name }, original);
});

test('missing Jira metadata leaves Work Items Unassigned and never creates an Initiative', () => {
  const document = clonedFixture();
  const unassigned = document.workItems.find(item => item.id === 'work-item-alpha-unassigned');
  const initiativeCount = document.initiatives.length;
  assert.equal(unassigned.initiativeId, null);
  assert.equal(unassigned.jiraId, null);
  assert.equal(unassigned.jiraKey, null);
  validateTargetData(document);
  assert.equal(document.initiatives.length, initiativeCount);
  assert.equal(UNASSIGNED_INITIATIVE.label, 'Unassigned');
  assert.equal(UNASSIGNED_INITIATIVE.initiativeId, null);
});

test('Unassigned and no-Epic labels cannot be persisted as fake Initiative entities', () => {
  for (const forbiddenName of ['Unassigned', 'Miscellaneous / No Epic', 'No Epic']) {
    const document = clonedFixture();
    document.initiatives[0].name = forbiddenName;
    assertInvalid(document, /must not create an Unassigned or no-Epic catch-all Initiative/);
  }
});

test('Work Items accept null or a valid same-parent Initiative', () => {
  const document = clonedFixture();
  assert.equal(document.workItems.find(item => item.id === 'work-item-alpha-unassigned').initiativeId, null);
  assert.equal(document.workItems.find(item => item.id === 'work-item-alpha-assigned').initiativeId, 'initiative-alpha-multiple-mappings');
  validateTargetData(document);
});

test('Work Item current-state provenance, confidence, captured-comment timestamp, and source status validate', () => {
  const document = clonedFixture();
  const workItem = document.workItems[0];
  workItem.currentStateProvenance = 'fictional-reviewed-jira-capture';
  workItem.currentStateConfidence = 'inferred';
  workItem.lastCapturedCommentAt = '2026-08-07T11:00:00.000Z';
  workItem.sourceStatus = 'Fictional source-system status';
  validateTargetData(document);
  assert.equal(workItem.canonicalStatus, 'Planned');
  assert.equal(workItem.currentStateConfidence, 'inferred');
  assert.equal(workItem.lastCapturedCommentAt, '2026-08-07T11:00:00.000Z');
  assert.equal(workItem.sourceStatus, 'Fictional source-system status');
});

test('missing or malformed Work Item current-state provenance is rejected', () => {
  const missingProvenance = clonedFixture();
  delete missingProvenance.workItems[0].currentStateProvenance;
  assertInvalid(missingProvenance, /currentStateProvenance.*required/);

  const malformedConfidence = clonedFixture();
  malformedConfidence.workItems[0].currentStateConfidence = 'certain';
  assertInvalid(malformedConfidence, /confirmed, inferred, unknown/);

  const missingCapturedCommentState = clonedFixture();
  delete missingCapturedCommentState.workItems[0].lastCapturedCommentAt;
  assertInvalid(missingCapturedCommentState, /lastCapturedCommentAt.*required/);

  const malformedTimestamp = clonedFixture();
  malformedTimestamp.workItems[0].lastCapturedCommentAt = 'not-a-timestamp';
  assertInvalid(malformedTimestamp, /ISO-8601 UTC timestamp/);
});

test('Work Items reject cross-Workspace and cross-Organization Initiative references', () => {
  assertInvalid(createInvalidCrossWorkspaceFixture(), /Initiative with matching Organization and Workspace/);
  assertInvalid(createInvalidCrossOrganizationFixture(), /Initiative with matching Organization and Workspace/);
});

test('Work Items reject missing Initiative references', () => {
  const document = clonedFixture();
  document.workItems[0].initiativeId = 'initiative-missing';
  assertInvalid(document, /Initiative with matching/);
});

test('Follow-Up none, open, waiting, and resolved remain nested on Work Items', () => {
  const document = clonedFixture();
  assert.deepEqual(new Set(document.workItems.map(item => item.followUp.state)), new Set(['none', 'open', 'waiting', 'resolved']));
  assert.equal('followUps' in document, false);
  validateTargetData(document);
});

test('malformed Follow-Up states and incomplete none-state objects are rejected', () => {
  const badState = clonedFixture();
  badState.workItems[0].followUp.state = 'blocked';
  assertInvalid(badState, /none, open, waiting, resolved/);

  const badNone = clonedFixture();
  badNone.workItems.find(item => item.followUp.state === 'none').followUp.note = 'This would make none ambiguous.';
  assertInvalid(badNone, /must be null when Follow-Up state is none/);
});

test('Follow-Up cannot become a top-level hierarchy or independent record', () => {
  const document = clonedFixture();
  document.followUps = [{ id: 'follow-up-standalone', ...followUp('open') }];
  assertInvalid(document, /unsupported field "followUps"/);
});

test('Workspace-level and Initiative-level Milestones validate canonical links', () => {
  const document = clonedFixture();
  const workspaceMilestone = document.milestones.find(item => item.id === 'milestone-alpha-workspace');
  const initiativeMilestone = document.milestones.find(item => item.id === 'milestone-alpha-initiative');
  assert.equal(workspaceMilestone.initiativeId, null);
  assert.equal(initiativeMilestone.initiativeId, 'initiative-alpha-multiple-mappings');
  assert.deepEqual(initiativeMilestone.linkedWorkItemIds, ['work-item-alpha-assigned']);
  validateTargetData(document);
});

test('Milestones reject foreign Initiatives and missing linked Work Items', () => {
  const foreignInitiative = clonedFixture();
  foreignInitiative.milestones[0].initiativeId = 'initiative-beta-shared';
  assertInvalid(foreignInitiative, /Initiative with matching/);

  const missingWorkItem = clonedFixture();
  missingWorkItem.milestones[0].linkedWorkItemIds.push('work-item-missing');
  assertInvalid(missingWorkItem, /Work Item with matching/);
});

test('Milestones reject foreign-Workspace and foreign-Organization linked Work Items', () => {
  const foreignWorkspace = clonedFixture();
  foreignWorkspace.milestones[0].linkedWorkItemIds.push('work-item-alpha-secondary');
  assertInvalid(foreignWorkspace, /Work Item with matching/);

  const foreignOrganization = clonedFixture();
  foreignOrganization.milestones[0].linkedWorkItemIds.push('work-item-beta-assigned');
  assertInvalid(foreignOrganization, /Work Item with matching/);
});

test('Work Items cannot store a competing canonical milestone relationship', () => {
  const document = clonedFixture();
  document.workItems[0].milestoneId = 'milestone-alpha-initiative';
  assertInvalid(document, /unsupported field "milestoneId"/);
});

test('Sources and Findings validate complete matching parent chains', () => {
  const document = clonedFixture();
  validateTargetData(document);

  const foreignSource = clonedFixture();
  foreignSource.findings[0].sourceId = 'source-beta-sentinel';
  assertInvalid(foreignSource, /Source with matching/);
});

test('Finding extraction method and version preserve explicit extraction provenance', () => {
  const document = clonedFixture();
  const finding = document.findings[0];
  assert.equal(finding.extractionMethod, 'deterministic-test-extraction');
  assert.equal(finding.extractionVersion, 'target-v5-fixture-1');
  validateTargetData(document);
});

test('missing or malformed Finding extraction provenance is rejected', () => {
  const missingMethod = clonedFixture();
  delete missingMethod.findings[0].extractionMethod;
  assertInvalid(missingMethod, /extractionMethod.*required/);

  const missingVersion = clonedFixture();
  delete missingVersion.findings[0].extractionVersion;
  assertInvalid(missingVersion, /extractionVersion.*required/);

  const malformedMethod = clonedFixture();
  malformedMethod.findings[0].extractionMethod = 42;
  assertInvalid(malformedMethod, /extractionMethod.*text/);

  const malformedVersion = clonedFixture();
  malformedVersion.findings[0].extractionVersion = '';
  assertInvalid(malformedVersion, /extractionVersion.*must not be empty/);
});

test('Evidence requires accepted exact provenance with matching parents', () => {
  const document = clonedFixture();
  validateTargetData(document);

  const excerptMismatch = clonedFixture();
  excerptMismatch.evidence[0].exactExcerpt = 'A different excerpt.';
  assertInvalid(excerptMismatch, /preserve accepted Finding and Source provenance exactly/);

  const foreignSource = clonedFixture();
  foreignSource.evidence[0].sourceId = 'source-beta-sentinel';
  assertInvalid(foreignSource, /Source with matching/);
});

test('Evidence with matching Work Item and Initiative succeeds, including Workspace-level Evidence', () => {
  const matching = clonedFixture();
  validateTargetData(matching);

  const workspaceLevel = clonedFixture();
  workspaceLevel.evidence[0].initiativeId = null;
  workspaceLevel.evidence[0].workItemId = null;
  validateTargetData(workspaceLevel);
});

test('Evidence rejects an Initiative that disagrees with its Work Item', () => {
  const mismatched = clonedFixture();
  mismatched.evidence[0].initiativeId = 'initiative-alpha-zero-mapping';
  assertInvalid(mismatched, /must match the Initiative of the referenced Work Item/);

  const unassignedMismatch = clonedFixture();
  unassignedMismatch.evidence[0].workItemId = 'work-item-alpha-unassigned';
  unassignedMismatch.evidence[0].initiativeId = 'initiative-alpha-zero-mapping';
  assertInvalid(unassignedMismatch, /must match the Initiative of the referenced Work Item/);
});

test('Proposed Changes require valid same-parent targets and supporting Evidence', () => {
  const document = clonedFixture();
  validateTargetData(document);

  const foreignTarget = clonedFixture();
  foreignTarget.proposedChanges[0].workItemId = 'work-item-beta-assigned';
  assertInvalid(foreignTarget, /Work Item with matching/);

  const unsupportedEvidence = clonedFixture();
  unsupportedEvidence.proposedChanges[0].evidenceIds = ['evidence-beta-accepted'];
  assertInvalid(unsupportedEvidence, /Evidence with matching/);
});

test('Proposed Changes reject Evidence associated with a different Work Item', () => {
  const document = clonedFixture();
  const otherWorkItemEvidence = {
    ...structuredClone(document.evidence[0]),
    id: 'evidence-alpha-other-work-item',
    initiativeId: null,
    workItemId: 'work-item-alpha-unassigned'
  };
  document.evidence.push(otherWorkItemEvidence);
  document.proposedChanges[0].evidenceIds = [otherWorkItemEvidence.id];
  assertInvalid(document, /Evidence associated with a different Work Item/);
});

test('Proposed Changes accept compatible Work Item Evidence and generic Workspace-level Evidence', () => {
  const matching = clonedFixture();
  validateTargetData(matching);

  const generic = clonedFixture();
  const workspaceEvidence = {
    ...structuredClone(generic.evidence[0]),
    id: 'evidence-alpha-workspace-level',
    initiativeId: null,
    workItemId: null
  };
  generic.evidence.push(workspaceEvidence);
  generic.proposedChanges[0].evidenceIds = [workspaceEvidence.id];
  validateTargetData(generic);
});

test('accepted Evidence remains separate from current Work Item state', () => {
  const document = clonedFixture();
  const workItem = document.workItems.find(item => item.id === 'work-item-alpha-assigned');
  const evidence = document.evidence.find(item => item.workItemId === workItem.id);
  const change = document.proposedChanges.find(item => item.workItemId === workItem.id);
  assert.equal(workItem.canonicalStatus, 'Planned');
  assert.equal(evidence.currentness, 'current');
  assert.equal(change.proposedValue, 'Waiting');
  assert.equal(change.reviewStatus, 'pending');
  validateTargetData(document);
  assert.equal(workItem.canonicalStatus, 'Planned');
});

test('Briefings may select only Workspaces and Initiatives inside one Organization', () => {
  const document = clonedFixture();
  validateTargetData(document);

  const crossOrganization = clonedFixture();
  crossOrganization.briefings[0].workspaceIds.push('workspace-beta-shared');
  assertInvalid(crossOrganization, /matching Organization/);

  const unselectedWorkspace = clonedFixture();
  unselectedWorkspace.briefings[1].initiativeIds = ['initiative-alpha-multiple-mappings'];
  assertInvalid(unselectedWorkspace, /selected Workspaces and matching Organization/);
});

test('Briefing Versions validate Briefing, Organization, Workspace, and Initiative parents', () => {
  const document = clonedFixture();
  validateTargetData(document);

  const wrongBriefing = clonedFixture();
  wrongBriefing.briefingVersions[1].briefingId = 'briefing-alpha';
  assertInvalid(wrongBriefing, /Briefing with matching Organization/);

  const crossWorkspace = clonedFixture();
  crossWorkspace.briefingVersions[1].initiativeIds = ['initiative-alpha-multiple-mappings'];
  assertInvalid(crossWorkspace, /version Workspaces and matching Organization/);
});

test('Communicated Briefing Version timestamps are chronological and use a bounded audit action', () => {
  assert.equal(AUDIT_ACTIONS.BRIEFING_VERSION_COMMUNICATED, 'briefing-version-communicated');

  const document = clonedFixture();
  document.briefingVersions[0].communicatedAt = '2026-08-07T12:59:59.999Z';
  assertInvalid(document, /communicatedAt.*equal to or later than finalizedAt/);
});

test('Briefing baselines reference only communicated Versions of the same Briefing', () => {
  const document = clonedFixture();
  document.briefings[0].lastCommunicatedVersionId = 'briefing-version-beta-draft';
  assertInvalid(document, /communicated Version of this Briefing/);
});

test('Audit Events validate Organization, Workspace, and target entity parents', () => {
  const document = clonedFixture();
  validateTargetData(document);

  const foreignTarget = clonedFixture();
  foreignTarget.auditEvents[0].entityType = 'workItem';
  foreignTarget.auditEvents[0].entityId = 'work-item-beta-assigned';
  assertInvalid(foreignTarget, /matching Organization parents/);
});

test('Workspace-owned Audit Events require the exact target Workspace', () => {
  const missingWorkspace = clonedFixture();
  missingWorkspace.auditEvents[0].workspaceId = null;
  assertInvalid(missingWorkspace, /required for a Workspace-owned target entity/);

  const foreignWorkspace = clonedFixture();
  foreignWorkspace.auditEvents[0].workspaceId = 'workspace-alpha-secondary';
  assertInvalid(foreignWorkspace, /must match the target entity Workspace/);
});

test('valid Organization-level and Workspace-level Audit Events succeed', () => {
  const document = clonedFixture();
  document.auditEvents.push({
    id: 'audit-event-alpha-organization',
    organizationId: 'org-fixture-alpha',
    workspaceId: null,
    entityType: 'organization',
    entityId: 'org-fixture-alpha',
    action: 'reviewed',
    actor: 'local-review-session',
    timestamp: '2026-08-07T15:00:00.000Z',
    beforeHash: null,
    afterHash: null
  });
  validateTargetData(document);
  assert.equal(document.auditEvents[0].workspaceId, 'workspace-alpha-shared');
  assert.equal(document.auditEvents[1].workspaceId, null);
});

test('saved User Preference IDs are revalidated against their parents', () => {
  const document = clonedFixture();
  validateTargetData(document);

  const wrongWorkspace = clonedFixture();
  wrongWorkspace.userPreferences.activeWorkspaceIdsByOrganization['org-fixture-alpha'] = 'workspace-beta-shared';
  assertInvalid(wrongWorkspace, /Workspace with matching Organization parents/);

  const missingOrganization = clonedFixture();
  missingOrganization.userPreferences.activeOrganizationId = 'org-missing';
  assertInvalid(missingOrganization, /existing Organization/);
});

test('IDs cannot collide across entity collections', () => {
  const document = clonedFixture();
  document.initiatives[0].id = document.workspaces[0].id;
  assertInvalid(document, /duplicates an ID/);
});

test('Workspace prompt overrides and drafting guidance are rejected from global settings', () => {
  const promptOverride = createCleanSeed();
  promptOverride.globalTechnicalSettings.promptOverrides = { system: 'not allowed globally' };
  assertInvalid(promptOverride, /Workspace-specific/);

  const draftingGuidance = createCleanSeed();
  draftingGuidance.globalTechnicalSettings.draftingGuidance = 'not allowed globally';
  assertInvalid(draftingGuidance, /Workspace-specific/);

  const nestedPromptOverride = createCleanSeed();
  nestedPromptOverride.globalTechnicalSettings.ai = { promptOverrides: { summary: 'not allowed globally' } };
  assertInvalid(nestedPromptOverride, /Workspace-specific/);
});

test('validation is fail-closed and never normalizes malformed relationships', () => {
  const document = createInvalidCrossOrganizationFixture();
  const before = structuredClone(document);
  assertInvalid(document, /Initiative with matching/);
  assert.deepEqual(document, before);
});

test('every root collection enforces the exported per-collection cardinality limit', () => {
  ROOT_COLLECTIONS.forEach(collection => {
    for (const count of [MAX_ROOT_COLLECTION_RECORDS - 1, MAX_ROOT_COLLECTION_RECORDS]) {
      const document = createCleanSeed();
      ROOT_COLLECTIONS.forEach(rootCollection => {
        document[rootCollection] = [];
      });
      document[collection] = Array(count).fill(null);
      assert.equal(validateRootCollectionBounds(document), count);
    }

    const oversized = createCleanSeed();
    ROOT_COLLECTIONS.forEach(rootCollection => {
      oversized[rootCollection] = [];
    });
    oversized[collection] = Array(MAX_ROOT_COLLECTION_RECORDS + 1).fill(null);
    assert.throws(() => validateRootCollectionBounds(oversized), error => {
      assert.equal(error instanceof TargetResourceLimitError, true);
      assert.equal(error.code, 'TARGET_RESOURCE_LIMIT_EXCEEDED');
      assert.equal(error.path, collection);
      return true;
    });
  });
});

test('root collection bounds run before record-shape and duplicate-ID validation', () => {
  validateTargetData(documentWithOrganizationCount(MAX_ROOT_COLLECTION_RECORDS - 1));
  validateTargetData(documentWithOrganizationCount(MAX_ROOT_COLLECTION_RECORDS));

  const oversized = createCleanSeed();
  oversized.organizations = Array(MAX_ROOT_COLLECTION_RECORDS + 1).fill(null);
  assert.throws(() => validateTargetData(oversized), error => {
    assert.equal(error instanceof TargetResourceLimitError, true);
    assert.equal(error.path, 'organizations');
    assert.doesNotMatch(error.message, /object|duplicate ID/);
    return true;
  });
});

test('aggregate root-record bounds reject limit evasion across individually bounded collections', () => {
  assert.equal(
    validateRootCollectionBounds(documentWithAggregateRootCount(MAX_AGGREGATE_ROOT_RECORDS - 1)),
    MAX_AGGREGATE_ROOT_RECORDS - 1
  );
  assert.equal(
    validateRootCollectionBounds(documentWithAggregateRootCount(MAX_AGGREGATE_ROOT_RECORDS)),
    MAX_AGGREGATE_ROOT_RECORDS
  );
  assert.throws(
    () => validateRootCollectionBounds(documentWithAggregateRootCount(MAX_AGGREGATE_ROOT_RECORDS + 1)),
    error => error instanceof TargetResourceLimitError && error.path === 'root'
  );
});

test('resource bounds accept the clean seed and multi-Organization fixture', () => {
  assert.equal(validateRootCollectionBounds(createCleanSeed()) < MAX_AGGREGATE_ROOT_RECORDS, true);
  assert.equal(validateRootCollectionBounds(clonedFixture()) < MAX_AGGREGATE_ROOT_RECORDS, true);
  validateTargetData(createCleanSeed());
  validateTargetData(clonedFixture());
});
