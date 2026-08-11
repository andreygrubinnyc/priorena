const { TARGET_SCHEMA_VERSION, validateTargetData } = require('./schema');

const SEED_TIMESTAMP = '2026-08-07T00:00:00.000Z';

const CLEAN_SEED = {
  schemaVersion: TARGET_SCHEMA_VERSION,
  organizations: [
    {
      id: 'org-example',
      name: 'Example Organization',
      description: 'Fictional organization for the repository-safe Priorena example.',
      archived: false,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP
    }
  ],
  workspaces: [
    {
      id: 'workspace-example-data-analytics-delivery',
      organizationId: 'org-example',
      name: 'Data & Analytics Delivery',
      description: 'Fictional PM Workspace for repository-safe delivery examples.',
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
      id: 'scope-example-regulatory-reporting',
      organizationId: 'org-example',
      workspaceId: 'workspace-example-data-analytics-delivery',
      name: 'Regulatory Reporting',
      description: '',
      owner: null,
      archived: false,
      primaryMilestoneId: null,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP
    },
    {
      id: 'scope-example-capacity-planning',
      organizationId: 'org-example',
      workspaceId: 'workspace-example-data-analytics-delivery',
      name: 'Capacity Planning',
      description: '',
      owner: null,
      archived: false,
      primaryMilestoneId: null,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP
    },
    {
      id: 'scope-example-bi-modernization',
      organizationId: 'org-example',
      workspaceId: 'workspace-example-data-analytics-delivery',
      name: 'BI Modernization',
      description: '',
      owner: null,
      archived: false,
      primaryMilestoneId: null,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP
    },
    {
      id: 'scope-example-master-data-management',
      organizationId: 'org-example',
      workspaceId: 'workspace-example-data-analytics-delivery',
      name: 'Master Data Management',
      description: '',
      owner: null,
      archived: false,
      primaryMilestoneId: null,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP
    }
  ],
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
    activeOrganizationId: 'org-example',
    activeWorkspaceIdsByOrganization: {
      'org-example': 'workspace-example-data-analytics-delivery'
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
