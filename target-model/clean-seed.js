const { TARGET_SCHEMA_VERSION, validateTargetData } = require('./schema');

const SEED_TIMESTAMP = '2026-08-07T00:00:00.000Z';

const CLEAN_SEED = {
  schemaVersion: TARGET_SCHEMA_VERSION,
  organizations: [
    {
      id: 'org-1',
      name: 'Organization 1',
      description: 'Fictional Organization for the repository-safe Priorena seed.',
      archived: false,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP
    }
  ],
  workspaces: [
    {
      id: 'workspace-1',
      organizationId: 'org-1',
      name: 'PM Workspace 1',
      description: 'Fictional PM Workspace for the repository-safe Priorena seed.',
      archived: false,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
      settings: {
        sprintCatalog: [],
        currentSprint: null,
        commentFreshnessDays: 7,
        milestoneDueSoonDays: 14
      },
      promptOverrides: {},
      draftingGuidance: '',
      assigneeDirectory: [],
      jiraStatusMapping: {},
      savedViews: []
    }
  ],
  scopes: [
    {
      id: 'scope-1',
      organizationId: 'org-1',
      workspaceId: 'workspace-1',
      name: 'Scope 1',
      description: '',
      owner: null,
      archived: false,
      primaryMilestoneId: null,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP
    },
    {
      id: 'scope-2',
      organizationId: 'org-1',
      workspaceId: 'workspace-1',
      name: 'Scope 2',
      description: '',
      owner: null,
      archived: false,
      primaryMilestoneId: null,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP
    },
    {
      id: 'scope-3',
      organizationId: 'org-1',
      workspaceId: 'workspace-1',
      name: 'Scope 3',
      description: '',
      owner: null,
      archived: false,
      primaryMilestoneId: null,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP
    },
    {
      id: 'scope-4',
      organizationId: 'org-1',
      workspaceId: 'workspace-1',
      name: 'Scope 4',
      description: '',
      owner: null,
      archived: false,
      primaryMilestoneId: null,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP
    }
  ],
  features: [],
  jiraEpicMappings: [],
  workItems: [],
  milestones: [],
  sources: [],
  findings: [],
  evidence: [],
  proposedChanges: [],
  briefings: [],
  briefingVersions: [],
  auditEvents: [],
  userPreferences: {
    activeOrganizationId: 'org-1',
    activeWorkspaceIdsByOrganization: {
      'org-1': 'workspace-1'
    }
  },
  globalTechnicalSettings: {}
};

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

validateTargetData(CLEAN_SEED);
deepFreeze(CLEAN_SEED);

function createCleanSeed() {
  return structuredClone(CLEAN_SEED);
}

module.exports = {
  CLEAN_SEED,
  SEED_TIMESTAMP,
  createCleanSeed
};
