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
  UNASSIGNED_SCOPE,
  createStableId,
  validateRootCollectionBounds,
  validateTargetData
} = require('../target-model/schema');
const {
  createFeatureIndependenceFixture,
  createInvalidCrossOrganizationFixture,
  createInvalidCrossWorkspaceFixture,
  createMultiOrganizationFixture,
  followUp
} = require('../test-support/target-v3-fixtures');

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

test('the deterministic clean seed is a valid complete schema-v4 document', () => {
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
      name: 'PM Workspace 1'
    }
  ]);
  assert.deepEqual(seed.scopes.map(({ id, name }) => ({ id, name })), [
    { id: 'scope-1', name: 'Scope 1' },
    { id: 'scope-2', name: 'Scope 2' },
    { id: 'scope-3', name: 'Scope 3' },
    { id: 'scope-4', name: 'Scope 4' }
  ]);
  assert.ok(seed.scopes.every(scope => scope.organizationId === 'org-1' && scope.workspaceId === 'workspace-1'));
  assert.deepEqual(seed.userPreferences, {
    activeOrganizationId: 'org-1',
    activeWorkspaceIdsByOrganization: { 'org-1': 'workspace-1' }
  });
});

test('the clean seed contains none of the prohibited data collections or catch-all records', () => {
  const seed = createCleanSeed();
  [
    'features', 'jiraEpicMappings', 'workItems', 'milestones', 'sources', 'findings', 'evidence',
    'proposedChanges', 'briefings', 'briefingVersions', 'auditEvents'
  ].forEach(collection => assert.deepEqual(seed[collection], []));
  assert.equal('projects' in seed, false);
  assert.equal('deliveryProjects' in seed, false);
  assert.equal('stories' in seed, false);
  assert.equal('timeline' in seed, false);
  assert.equal('transcripts' in seed, false);
  assert.doesNotMatch(JSON.stringify(seed), /Miscellaneous \/ No Epic|No Epic|catch-all/i);
});

test('schemaVersion is mandatory', () => {
  const document = createCleanSeed();
  delete document.schemaVersion;
  assertInvalid(document, /schemaVersion.*required/);
});

test('unsupported past schema versions fail closed', () => {
  const document = createCleanSeed();
  document.schemaVersion = 3;
  assert.throws(() => validateTargetData(document), error => {
    assert.equal(error instanceof TargetSchemaVersionError, true);
    assert.equal(error.code, 'UNSUPPORTED_TARGET_SCHEMA_VERSION');
    return true;
  });
});

test('unknown future schema versions fail closed', () => {
  const document = createCleanSeed();
  document.schemaVersion = 5;
  assert.throws(() => validateTargetData(document), TargetSchemaVersionError);
  assert.equal(document.schemaVersion, 5);
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
});

test('malformed entity records and missing required parent IDs are rejected', () => {
  const malformed = clonedFixture();
  malformed.organizations[0].archived = 'false';
  assertInvalid(malformed, /archived.*boolean/);

  const incomplete = clonedFixture();
  delete incomplete.scopes[0].organizationId;
  assertInvalid(incomplete, /organizationId.*required/);
});

test('generated stable IDs are opaque and display-name changes preserve identity', () => {
  const stableId = createStableId('scope', { uuid: '123e4567-e89b-12d3-a456-426614174000' });
  assert.equal(stableId, 'scope-123e4567-e89b-12d3-a456-426614174000');

  const document = clonedFixture();
  const workspace = document.workspaces[0];
  const scope = document.scopes[0];
  const workItem = document.workItems[0];
  const ids = [workspace.id, scope.id, workItem.id];
  workspace.name = 'Renamed Fictional Workspace';
  scope.name = 'Renamed Fictional Scope';
  workItem.summary = 'Renamed fictional Work Item';
  validateTargetData(document);
  assert.deepEqual([workspace.id, scope.id, workItem.id], ids);
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

test('duplicate Scope names are valid in different Workspaces and Organizations', () => {
  const document = clonedFixture();
  const sharedScopes = document.scopes.filter(item => item.name === 'Shared Scope');
  assert.equal(sharedScopes.length, 3);
  assert.equal(new Set(sharedScopes.map(item => item.workspaceId)).size, 3);
  assert.equal(new Set(sharedScopes.map(item => item.organizationId)).size, 2);
  validateTargetData(document);
});

test('Features are first-class Scope children and duplicate display names remain ID-scoped', () => {
  const document = clonedFixture();
  assert.equal(document.features.length, 4);
  assert.equal(new Set(document.features.map(item => item.name)).size, 1);
  assert.equal(new Set(document.features.map(item => item.id)).size, 4);
  validateTargetData(document);

  const wrongScope = clonedFixture();
  wrongScope.features.find(item => item.id === 'feature-alpha-mapped').scopeId = 'scope-beta-shared';
  assertInvalid(wrongScope, /Scope with matching Organization and Workspace/);

  const extraField = clonedFixture();
  extraField.features[0].archived = false;
  assertInvalid(extraField, /unsupported field "archived"/);
});

test('Work Item Feature references require an exact Organization, Workspace, and Scope match', () => {
  const document = clonedFixture();
  const featured = document.workItems.find(item => item.id === 'work-item-alpha-assigned');
  assert.equal(featured.featureId, 'feature-alpha-mapped');
  validateTargetData(document);

  const unscoped = clonedFixture();
  const unassigned = unscoped.workItems.find(item => item.id === 'work-item-alpha-unassigned');
  unassigned.featureId = 'feature-alpha-mapped';
  assertInvalid(unscoped, /requires a non-null Scope/);

  const wrongScope = clonedFixture();
  wrongScope.workItems.find(item => item.id === 'work-item-alpha-assigned').featureId = 'feature-alpha-zero';
  assertInvalid(wrongScope, /Feature with matching Organization, Workspace, and Scope/);

  const foreign = clonedFixture();
  foreign.workItems.find(item => item.id === 'work-item-alpha-assigned').featureId = 'feature-beta-shared';
  assertInvalid(foreign, /Feature with matching Organization, Workspace, and Scope/);
});

test('Feature is not a Work Item type and old type values fail closed', () => {
  const document = clonedFixture();
  document.workItems[0].itemType = 'Feature';
  assertInvalid(document, /Story, Task, Bug, Other, Unknown/);
});

test('the complete schema-v4 Work Item type set is accepted', () => {
  for (const itemType of ['Story', 'Task', 'Bug', 'Other', 'Unknown']) {
    const document = clonedFixture();
    document.workItems[0].itemType = itemType;
    assert.equal(validateTargetData(document), document);
  }
});

test('schema-v4 Work Items require an explicit nullable Jira Epic mapping reference', () => {
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

test('Work Item Jira Epic references require exact Organization, Workspace, and Scope parents', () => {
  const unscoped = clonedFixture();
  const unassigned = unscoped.workItems.find(item => item.id === 'work-item-alpha-unassigned');
  unassigned.jiraEpicMappingId = 'jira-mapping-alpha-one';
  assertInvalid(unscoped, /jiraEpicMappingId.*requires a non-null Scope/);

  const wrongScope = clonedFixture();
  wrongScope.workItems.find(item => item.id === 'work-item-alpha-assigned').jiraEpicMappingId = 'jira-mapping-alpha-secondary';
  assertInvalid(wrongScope, /Jira Epic mapping with matching Organization, Workspace, and Scope/);

  const foreign = clonedFixture();
  foreign.workItems.find(item => item.id === 'work-item-alpha-assigned').jiraEpicMappingId = 'jira-mapping-beta-shared-key';
  assertInvalid(foreign, /Jira Epic mapping with matching Organization, Workspace, and Scope/);
});

test('schema-v4 permits all five independent Scope, Feature, and Jira Epic association states', () => {
  const document = clonedFixture();
  const template = structuredClone(document.workItems.find(item => item.id === 'work-item-alpha-assigned'));
  document.workItems = [
    { ...structuredClone(template), id: 'work-item-state-unassigned', scopeId: null, featureId: null, jiraEpicMappingId: null },
    { ...structuredClone(template), id: 'work-item-state-scope', featureId: null, jiraEpicMappingId: null },
    { ...structuredClone(template), id: 'work-item-state-feature', jiraEpicMappingId: null },
    { ...structuredClone(template), id: 'work-item-state-jira', featureId: null },
    { ...structuredClone(template), id: 'work-item-state-both' }
  ];
  document.milestones.forEach(milestone => { milestone.linkedWorkItemIds = []; });
  document.findings.forEach(finding => { finding.proposedWorkItemId = null; });
  document.evidence.forEach(item => { item.workItemId = null; });
  document.proposedChanges = [];
  document.auditEvents = [];
  validateTargetData(document);
  assert.deepEqual(
    document.workItems.map(item => [item.scopeId, item.featureId, item.jiraEpicMappingId]),
    [
      [null, null, null],
      ['scope-alpha-multiple-mappings', null, null],
      ['scope-alpha-multiple-mappings', 'feature-alpha-mapped', null],
      ['scope-alpha-multiple-mappings', null, 'jira-mapping-alpha-one'],
      ['scope-alpha-multiple-mappings', 'feature-alpha-mapped', 'jira-mapping-alpha-one']
    ]
  );
});

test('Scopes support zero, one, and multiple Jira Epic mappings', () => {
  const document = clonedFixture();
  const counts = Object.fromEntries(document.scopes.map(scope => [
    scope.id,
    document.jiraEpicMappings.filter(mapping => mapping.scopeId === scope.id).length
  ]));
  assert.equal(counts['scope-alpha-zero-mapping'], 0);
  assert.equal(counts['scope-alpha-secondary'], 1);
  assert.equal(counts['scope-alpha-multiple-mappings'], 2);
  validateTargetData(document);
});

test('Jira mappings and Features remain independent for mapped Scopes and scoped Work Items', () => {
  const document = createFeatureIndependenceFixture();
  const scopeId = 'scope-alpha-mapping-only';
  const mapping = document.jiraEpicMappings.find(item => item.scopeId === scopeId);
  const assigned = document.workItems.find(item => item.id === 'work-item-alpha-scoped-no-feature');
  assert.ok(mapping);
  assert.equal(document.features.some(item => item.scopeId === scopeId), false);
  assert.equal(assigned.scopeId, scopeId);
  assert.equal(assigned.featureId, null);
  validateTargetData(document);

  const featuresBefore = structuredClone(document.features);
  mapping.jiraEpicName = 'Fictional Renamed Mapping Without Feature';
  mapping.jiraEpicKey = 'FICTA-302';
  validateTargetData(document);
  assert.deepEqual(document.features, featuresBefore);
});

test('a Jira Epic mapping rejects missing or foreign Scope parents', () => {
  const missing = clonedFixture();
  missing.jiraEpicMappings[0].scopeId = 'scope-missing';
  assertInvalid(missing, /Scope with matching/);

  const foreign = clonedFixture();
  foreign.jiraEpicMappings[0].scopeId = 'scope-beta-shared';
  assertInvalid(foreign, /Scope with matching/);
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

test('case- and whitespace-equivalent active Jira mappings cannot bypass one-Scope ownership', () => {
  const caseEquivalent = clonedFixture();
  const caseDuplicate = caseEquivalent.jiraEpicMappings[1];
  caseDuplicate.scopeId = 'scope-alpha-zero-mapping';
  caseDuplicate.jiraProjectKey = caseEquivalent.jiraEpicMappings[0].jiraProjectKey.toLowerCase();
  caseDuplicate.jiraEpicKey = caseEquivalent.jiraEpicMappings[0].jiraEpicKey.toLowerCase();
  assertInvalid(caseEquivalent, /duplicates an active Jira Epic mapping/);

  const whitespaceEquivalent = clonedFixture();
  const whitespaceDuplicate = whitespaceEquivalent.jiraEpicMappings[1];
  whitespaceDuplicate.scopeId = 'scope-alpha-zero-mapping';
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

test('changing Jira keys or names never renames or re-identifies a Scope', () => {
  const document = clonedFixture();
  const scope = document.scopes.find(item => item.id === 'scope-alpha-multiple-mappings');
  const original = { id: scope.id, name: scope.name };
  document.jiraEpicMappings[0].jiraEpicKey = 'FICTA-999';
  document.jiraEpicMappings[0].jiraEpicName = 'Renamed Fictional External Epic';
  validateTargetData(document);
  assert.deepEqual({ id: scope.id, name: scope.name }, original);
});

test('missing Jira metadata leaves Work Items Unassigned and never creates a Scope', () => {
  const document = clonedFixture();
  const unassigned = document.workItems.find(item => item.id === 'work-item-alpha-unassigned');
  const scopeCount = document.scopes.length;
  assert.equal(unassigned.scopeId, null);
  assert.equal(unassigned.jiraId, null);
  assert.equal(unassigned.jiraKey, null);
  validateTargetData(document);
  assert.equal(document.scopes.length, scopeCount);
  assert.equal(UNASSIGNED_SCOPE.label, 'Unassigned');
  assert.equal(UNASSIGNED_SCOPE.scopeId, null);
});

test('Unassigned and no-Epic labels cannot be persisted as fake Scope entities', () => {
  for (const forbiddenName of ['Unassigned', 'Miscellaneous / No Epic', 'No Epic']) {
    const document = clonedFixture();
    document.scopes[0].name = forbiddenName;
    assertInvalid(document, /must not create an Unassigned or no-Epic catch-all Scope/);
  }
});

test('Work Items accept null or a valid same-parent Scope', () => {
  const document = clonedFixture();
  assert.equal(document.workItems.find(item => item.id === 'work-item-alpha-unassigned').scopeId, null);
  assert.equal(document.workItems.find(item => item.id === 'work-item-alpha-assigned').scopeId, 'scope-alpha-multiple-mappings');
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

test('Work Items reject cross-Workspace and cross-Organization Scope references', () => {
  assertInvalid(createInvalidCrossWorkspaceFixture(), /Scope with matching Organization and Workspace/);
  assertInvalid(createInvalidCrossOrganizationFixture(), /Scope with matching Organization and Workspace/);
});

test('Work Items reject missing Scope references', () => {
  const document = clonedFixture();
  document.workItems[0].scopeId = 'scope-missing';
  assertInvalid(document, /Scope with matching/);
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

test('Workspace-level and Scope-level Milestones validate canonical links', () => {
  const document = clonedFixture();
  const workspaceMilestone = document.milestones.find(item => item.id === 'milestone-alpha-workspace');
  const scopeMilestone = document.milestones.find(item => item.id === 'milestone-alpha-scope');
  assert.equal(workspaceMilestone.scopeId, null);
  assert.equal(scopeMilestone.scopeId, 'scope-alpha-multiple-mappings');
  assert.deepEqual(scopeMilestone.linkedWorkItemIds, ['work-item-alpha-assigned']);
  validateTargetData(document);
});

test('Milestones reject foreign Scopes and missing linked Work Items', () => {
  const foreignScope = clonedFixture();
  foreignScope.milestones[0].scopeId = 'scope-beta-shared';
  assertInvalid(foreignScope, /Scope with matching/);

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
  document.workItems[0].milestoneId = 'milestone-alpha-scope';
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
  assert.equal(finding.extractionVersion, 'target-v4-fixture-1');
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

test('Evidence with matching Work Item and Scope succeeds, including Workspace-level Evidence', () => {
  const matching = clonedFixture();
  validateTargetData(matching);

  const workspaceLevel = clonedFixture();
  workspaceLevel.evidence[0].scopeId = null;
  workspaceLevel.evidence[0].workItemId = null;
  validateTargetData(workspaceLevel);
});

test('Evidence rejects a Scope that disagrees with its Work Item', () => {
  const mismatched = clonedFixture();
  mismatched.evidence[0].scopeId = 'scope-alpha-zero-mapping';
  assertInvalid(mismatched, /must match the Scope of the referenced Work Item/);

  const unassignedMismatch = clonedFixture();
  unassignedMismatch.evidence[0].workItemId = 'work-item-alpha-unassigned';
  unassignedMismatch.evidence[0].scopeId = 'scope-alpha-zero-mapping';
  assertInvalid(unassignedMismatch, /must match the Scope of the referenced Work Item/);
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
    scopeId: null,
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
    scopeId: null,
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

test('Briefings may select only Workspaces and Scopes inside one Organization', () => {
  const document = clonedFixture();
  validateTargetData(document);

  const crossOrganization = clonedFixture();
  crossOrganization.briefings[0].workspaceIds.push('workspace-beta-shared');
  assertInvalid(crossOrganization, /matching Organization/);

  const unselectedWorkspace = clonedFixture();
  unselectedWorkspace.briefings[1].scopeIds = ['scope-alpha-multiple-mappings'];
  assertInvalid(unselectedWorkspace, /selected Workspaces and matching Organization/);
});

test('Briefing Versions validate Briefing, Organization, Workspace, and Scope parents', () => {
  const document = clonedFixture();
  validateTargetData(document);

  const wrongBriefing = clonedFixture();
  wrongBriefing.briefingVersions[1].briefingId = 'briefing-alpha';
  assertInvalid(wrongBriefing, /Briefing with matching Organization/);

  const crossWorkspace = clonedFixture();
  crossWorkspace.briefingVersions[1].scopeIds = ['scope-alpha-multiple-mappings'];
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
  document.scopes[0].id = document.workspaces[0].id;
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
  assertInvalid(document, /Scope with matching/);
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
