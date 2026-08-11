const { TARGET_SCHEMA_VERSION } = require('../target-model/schema');

const FIXTURE_TIMESTAMP = '2026-08-07T12:00:00.000Z';

function organization(id, name) {
  return {
    id,
    name,
    description: 'Fictional Organization used only for target-model isolation tests.',
    archived: false,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP
  };
}

function workspace(id, organizationId, name) {
  return {
    id,
    organizationId,
    name,
    description: 'Fictional PM Workspace used only for target-model isolation tests.',
    archived: false,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    settings: {},
    promptOverrides: {},
    draftingGuidance: '',
    assigneeDirectory: [],
    jiraStatusMapping: {},
    savedViews: []
  };
}

function scope(id, organizationId, workspaceId, name) {
  return {
    id,
    organizationId,
    workspaceId,
    name,
    description: 'Fictional Scope used only for target-model tests.',
    owner: null,
    archived: false,
    primaryMilestoneId: null,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP
  };
}

function followUp(state = 'none') {
  const values = {
    none: {
      contact: null,
      lastContactAt: null,
      lastCapturedCommentAt: null,
      nextAction: null,
      dueAt: null,
      note: null
    },
    open: {
      contact: 'Fictional delivery contact',
      lastContactAt: '2026-08-06T12:00:00.000Z',
      lastCapturedCommentAt: null,
      nextAction: 'Confirm the fictional dependency status.',
      dueAt: '2026-08-12',
      note: 'Repository-safe test note.'
    },
    waiting: {
      contact: 'Fictional review contact',
      lastContactAt: '2026-08-05T12:00:00.000Z',
      lastCapturedCommentAt: '2026-08-04T12:00:00.000Z',
      nextAction: 'Wait for the fictional review response.',
      dueAt: null,
      note: null
    },
    resolved: {
      contact: null,
      lastContactAt: '2026-08-03T12:00:00.000Z',
      lastCapturedCommentAt: '2026-08-03T12:00:00.000Z',
      nextAction: null,
      dueAt: null,
      note: 'The fictional follow-up is resolved.'
    }
  };
  return { state, ...values[state] };
}

function workItem(id, organizationId, workspaceId, scopeId, summary, followUpState = 'none') {
  return {
    id,
    organizationId,
    workspaceId,
    scopeId,
    jiraId: null,
    jiraKey: null,
    itemType: 'Task',
    summary,
    description: 'Synthetic Work Item for version-2 schema tests.',
    canonicalStatus: 'Planned',
    currentStateProvenance: 'fictional-manual-review',
    currentStateConfidence: 'confirmed',
    lastCapturedCommentAt: null,
    sourceStatus: null,
    assignee: null,
    sprint: null,
    labels: [],
    dependencies: [],
    notes: '',
    archived: false,
    followUp: followUp(followUpState),
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP
  };
}

function createMultiOrganizationFixture() {
  const document = {
    schemaVersion: TARGET_SCHEMA_VERSION,
    organizations: [
      organization('org-fixture-alpha', 'Fictional Organization Alpha'),
      organization('org-fixture-beta', 'Fictional Organization Beta')
    ],
    workspaces: [
      workspace('workspace-alpha-shared', 'org-fixture-alpha', 'Shared Delivery Workspace'),
      workspace('workspace-alpha-secondary', 'org-fixture-alpha', 'Secondary Delivery Workspace'),
      workspace('workspace-beta-shared', 'org-fixture-beta', 'Shared Delivery Workspace')
    ],
    scopes: [
      scope('scope-alpha-zero-mapping', 'org-fixture-alpha', 'workspace-alpha-shared', 'Shared Scope'),
      scope('scope-alpha-multiple-mappings', 'org-fixture-alpha', 'workspace-alpha-shared', 'Mapped Scope'),
      scope('scope-alpha-secondary', 'org-fixture-alpha', 'workspace-alpha-secondary', 'Shared Scope'),
      scope('scope-beta-shared', 'org-fixture-beta', 'workspace-beta-shared', 'Shared Scope')
    ],
    jiraEpicMappings: [
      {
        id: 'jira-mapping-alpha-one',
        organizationId: 'org-fixture-alpha',
        workspaceId: 'workspace-alpha-shared',
        scopeId: 'scope-alpha-multiple-mappings',
        jiraProjectKey: 'FICTA',
        jiraEpicKey: 'FICTA-101',
        jiraEpicName: 'Fictional Epic Alpha One',
        mappingStatus: 'verified',
        provenance: 'Synthetic reviewed mapping.',
        verifiedAt: FIXTURE_TIMESTAMP
      },
      {
        id: 'jira-mapping-alpha-two',
        organizationId: 'org-fixture-alpha',
        workspaceId: 'workspace-alpha-shared',
        scopeId: 'scope-alpha-multiple-mappings',
        jiraProjectKey: 'FICTA',
        jiraEpicKey: 'FICTA-102',
        jiraEpicName: 'Fictional Epic Alpha Two',
        mappingStatus: 'verified',
        provenance: 'Synthetic reviewed mapping.',
        verifiedAt: FIXTURE_TIMESTAMP
      },
      {
        id: 'jira-mapping-alpha-secondary',
        organizationId: 'org-fixture-alpha',
        workspaceId: 'workspace-alpha-secondary',
        scopeId: 'scope-alpha-secondary',
        jiraProjectKey: 'FICTA',
        jiraEpicKey: 'FICTA-201',
        jiraEpicName: 'Fictional Secondary Epic',
        mappingStatus: 'verified',
        provenance: 'Synthetic reviewed mapping.',
        verifiedAt: FIXTURE_TIMESTAMP
      },
      {
        id: 'jira-mapping-beta-shared-key',
        organizationId: 'org-fixture-beta',
        workspaceId: 'workspace-beta-shared',
        scopeId: 'scope-beta-shared',
        jiraProjectKey: 'FICTA',
        jiraEpicKey: 'FICTA-101',
        jiraEpicName: 'Fictional Epic With Cross-Organization Duplicate Key',
        mappingStatus: 'verified',
        provenance: 'Synthetic reviewed mapping.',
        verifiedAt: FIXTURE_TIMESTAMP
      }
    ],
    workItems: [
      workItem(
        'work-item-alpha-assigned',
        'org-fixture-alpha',
        'workspace-alpha-shared',
        'scope-alpha-multiple-mappings',
        'ALPHA SENTINEL — assigned fictional work item',
        'open'
      ),
      workItem(
        'work-item-alpha-unassigned',
        'org-fixture-alpha',
        'workspace-alpha-shared',
        null,
        'ALPHA SENTINEL — Unassigned fictional work item',
        'none'
      ),
      workItem(
        'work-item-alpha-secondary',
        'org-fixture-alpha',
        'workspace-alpha-secondary',
        'scope-alpha-secondary',
        'ALPHA SECONDARY SENTINEL — fictional work item',
        'waiting'
      ),
      workItem(
        'work-item-beta-assigned',
        'org-fixture-beta',
        'workspace-beta-shared',
        'scope-beta-shared',
        'BETA SENTINEL — fictional work item',
        'resolved'
      )
    ],
    milestones: [
      {
        id: 'milestone-alpha-workspace',
        organizationId: 'org-fixture-alpha',
        workspaceId: 'workspace-alpha-shared',
        scopeId: null,
        title: 'Fictional Workspace Checkpoint',
        date: '2026-09-01',
        status: 'Planned',
        notes: '',
        linkedWorkItemIds: ['work-item-alpha-assigned', 'work-item-alpha-unassigned'],
        createdAt: FIXTURE_TIMESTAMP,
        updatedAt: FIXTURE_TIMESTAMP
      },
      {
        id: 'milestone-alpha-scope',
        organizationId: 'org-fixture-alpha',
        workspaceId: 'workspace-alpha-shared',
        scopeId: 'scope-alpha-multiple-mappings',
        title: 'Fictional Scope Checkpoint',
        date: '2026-09-15',
        status: 'Planned',
        notes: '',
        linkedWorkItemIds: ['work-item-alpha-assigned'],
        createdAt: FIXTURE_TIMESTAMP,
        updatedAt: FIXTURE_TIMESTAMP
      },
      {
        id: 'milestone-beta-workspace',
        organizationId: 'org-fixture-beta',
        workspaceId: 'workspace-beta-shared',
        scopeId: null,
        title: 'BETA MILESTONE SENTINEL — fictional workspace checkpoint',
        date: '2026-09-20',
        status: 'At risk',
        notes: 'Fictional Beta milestone note.',
        linkedWorkItemIds: ['work-item-beta-assigned'],
        createdAt: FIXTURE_TIMESTAMP,
        updatedAt: FIXTURE_TIMESTAMP
      }
    ],
    sources: [
      {
        id: 'source-alpha-sentinel',
        organizationId: 'org-fixture-alpha',
        workspaceId: 'workspace-alpha-shared',
        title: 'Fictional Alpha Source',
        type: 'meeting-note',
        sourceKind: 'structured-note',
        date: '2026-08-07',
        provenance: 'Synthetic source created for target-model tests.',
        content: 'The fictional Alpha dependency is waiting for review.',
        metadata: {},
        processingState: 'processed',
        createdAt: FIXTURE_TIMESTAMP
      },
      {
        id: 'source-beta-sentinel',
        organizationId: 'org-fixture-beta',
        workspaceId: 'workspace-beta-shared',
        title: 'Fictional Beta Source',
        type: 'meeting-note',
        sourceKind: 'structured-note',
        date: '2026-08-07',
        provenance: 'Synthetic source created for target-model tests.',
        content: 'The fictional Beta checkpoint is ready.',
        metadata: {},
        processingState: 'processed',
        createdAt: FIXTURE_TIMESTAMP
      }
    ],
    findings: [
      {
        id: 'finding-alpha-accepted',
        organizationId: 'org-fixture-alpha',
        workspaceId: 'workspace-alpha-shared',
        sourceId: 'source-alpha-sentinel',
        exactExcerpt: 'The fictional Alpha dependency is waiting for review.',
        extractionMethod: 'deterministic-test-extraction',
        extractionVersion: 'target-v2-fixture-1',
        category: 'dependency',
        reviewStatus: 'accepted',
        proposedWorkItemId: 'work-item-alpha-assigned',
        proposedScopeId: 'scope-alpha-multiple-mappings',
        currentness: 'current',
        supersededBy: null
      },
      {
        id: 'finding-beta-accepted',
        organizationId: 'org-fixture-beta',
        workspaceId: 'workspace-beta-shared',
        sourceId: 'source-beta-sentinel',
        exactExcerpt: 'The fictional Beta checkpoint is ready.',
        extractionMethod: 'deterministic-test-extraction',
        extractionVersion: 'target-v2-fixture-1',
        category: 'progress',
        reviewStatus: 'accepted',
        proposedWorkItemId: 'work-item-beta-assigned',
        proposedScopeId: 'scope-beta-shared',
        currentness: 'current',
        supersededBy: null
      }
    ],
    evidence: [
      {
        id: 'evidence-alpha-accepted',
        organizationId: 'org-fixture-alpha',
        workspaceId: 'workspace-alpha-shared',
        sourceId: 'source-alpha-sentinel',
        findingId: 'finding-alpha-accepted',
        scopeId: 'scope-alpha-multiple-mappings',
        workItemId: 'work-item-alpha-assigned',
        exactExcerpt: 'The fictional Alpha dependency is waiting for review.',
        sourceDate: '2026-08-07',
        acceptedAt: FIXTURE_TIMESTAMP,
        acceptedBy: 'local-review-session',
        currentness: 'current',
        supersededBy: null
      },
      {
        id: 'evidence-beta-accepted',
        organizationId: 'org-fixture-beta',
        workspaceId: 'workspace-beta-shared',
        sourceId: 'source-beta-sentinel',
        findingId: 'finding-beta-accepted',
        scopeId: 'scope-beta-shared',
        workItemId: 'work-item-beta-assigned',
        exactExcerpt: 'The fictional Beta checkpoint is ready.',
        sourceDate: '2026-08-07',
        acceptedAt: FIXTURE_TIMESTAMP,
        acceptedBy: 'local-review-session',
        currentness: 'current',
        supersededBy: null
      }
    ],
    proposedChanges: [
      {
        id: 'proposed-change-alpha-status',
        organizationId: 'org-fixture-alpha',
        workspaceId: 'workspace-alpha-shared',
        findingId: 'finding-alpha-accepted',
        evidenceIds: ['evidence-alpha-accepted'],
        workItemId: 'work-item-alpha-assigned',
        field: 'canonicalStatus',
        beforeValue: 'Planned',
        proposedValue: 'Waiting',
        reviewStatus: 'pending',
        snapshotHash: 'fictional-alpha-snapshot-hash'
      }
    ],
    briefings: [
      {
        id: 'briefing-alpha',
        organizationId: 'org-fixture-alpha',
        name: 'Fictional Alpha Delivery Briefing',
        workspaceIds: ['workspace-alpha-shared', 'workspace-alpha-secondary'],
        scopeIds: ['scope-alpha-multiple-mappings', 'scope-alpha-secondary'],
        audienceProfile: 'Fictional delivery stakeholders',
        preferredFormats: ['teams', 'email', 'confluence'],
        defaultSections: ['progress', 'risk'],
        lastCommunicatedVersionId: 'briefing-version-alpha-communicated',
        archived: false,
        createdAt: FIXTURE_TIMESTAMP,
        updatedAt: FIXTURE_TIMESTAMP
      },
      {
        id: 'briefing-beta',
        organizationId: 'org-fixture-beta',
        name: 'Fictional Beta Delivery Briefing',
        workspaceIds: ['workspace-beta-shared'],
        scopeIds: ['scope-beta-shared'],
        audienceProfile: 'Fictional delivery stakeholders',
        preferredFormats: ['teams'],
        defaultSections: ['progress'],
        lastCommunicatedVersionId: null,
        archived: false,
        createdAt: FIXTURE_TIMESTAMP,
        updatedAt: FIXTURE_TIMESTAMP
      }
    ],
    briefingVersions: [
      {
        id: 'briefing-version-alpha-communicated',
        organizationId: 'org-fixture-alpha',
        briefingId: 'briefing-alpha',
        workspaceIds: ['workspace-alpha-shared', 'workspace-alpha-secondary'],
        scopeIds: ['scope-alpha-multiple-mappings', 'scope-alpha-secondary'],
        status: 'communicated',
        comparisonVersionId: null,
        frozenSnapshot: { fixture: 'ALPHA BRIEFING SENTINEL' },
        facts: [],
        outputs: [],
        createdAt: FIXTURE_TIMESTAMP,
        finalizedAt: '2026-08-07T13:00:00.000Z',
        communicatedAt: '2026-08-07T14:00:00.000Z'
      },
      {
        id: 'briefing-version-beta-draft',
        organizationId: 'org-fixture-beta',
        briefingId: 'briefing-beta',
        workspaceIds: ['workspace-beta-shared'],
        scopeIds: ['scope-beta-shared'],
        status: 'draft',
        comparisonVersionId: null,
        frozenSnapshot: { fixture: 'BETA BRIEFING SENTINEL' },
        facts: [],
        outputs: [],
        createdAt: FIXTURE_TIMESTAMP,
        finalizedAt: null,
        communicatedAt: null
      }
    ],
    auditEvents: [
      {
        id: 'audit-event-alpha-proposal',
        organizationId: 'org-fixture-alpha',
        workspaceId: 'workspace-alpha-shared',
        entityType: 'proposedChange',
        entityId: 'proposed-change-alpha-status',
        action: 'previewed',
        actor: 'local-review-session',
        timestamp: FIXTURE_TIMESTAMP,
        beforeHash: null,
        afterHash: 'fictional-alpha-snapshot-hash'
      }
    ],
    userPreferences: {
      activeOrganizationId: 'org-fixture-alpha',
      activeWorkspaceIdsByOrganization: {
        'org-fixture-alpha': 'workspace-alpha-shared',
        'org-fixture-beta': 'workspace-beta-shared'
      }
    },
    globalTechnicalSettings: {
      logLevel: 'info'
    }
  };

  const alphaWorkspace = document.workspaces.find(item => item.id === 'workspace-alpha-shared');
  alphaWorkspace.promptOverrides = { statusDraft: 'ALPHA PROMPT SENTINEL — use only fictional Alpha records.' };
  alphaWorkspace.draftingGuidance = 'ALPHA GUIDANCE SENTINEL — fictional drafting guidance.';
  const betaWorkspace = document.workspaces.find(item => item.id === 'workspace-beta-shared');
  betaWorkspace.promptOverrides = { statusDraft: 'BETA PROMPT SENTINEL — use only fictional Beta records.' };
  betaWorkspace.draftingGuidance = 'BETA GUIDANCE SENTINEL — fictional drafting guidance.';

  return document;
}

function createInvalidCrossOrganizationFixture() {
  const document = createMultiOrganizationFixture();
  document.workItems.find(item => item.id === 'work-item-beta-assigned').scopeId = 'scope-alpha-multiple-mappings';
  return document;
}

function createInvalidCrossWorkspaceFixture() {
  const document = createMultiOrganizationFixture();
  document.workItems.find(item => item.id === 'work-item-alpha-secondary').scopeId = 'scope-alpha-multiple-mappings';
  return document;
}

module.exports = {
  FIXTURE_TIMESTAMP,
  createInvalidCrossOrganizationFixture,
  createInvalidCrossWorkspaceFixture,
  createMultiOrganizationFixture,
  followUp,
  workItem
};
