'use strict';

const path = require('node:path');

const { readTargetDataWithRevision } = require('../target-model/persistence');
const { outputTooLarge } = require('./errors');
const {
  buildAiContext,
  buildOrganizationArchive,
  buildPortfolio,
  buildToday,
  getBriefing,
  getBriefingVersion,
  getEvidenceForSource,
  getFindingForSource,
  getOrganization,
  getWorkspace,
  getWorkspaceChild,
  listBriefingVersions,
  listBriefings,
  listEvidenceForSource,
  listFindingsForSource,
  listOrganizations,
  listWorkspaceCollection,
  listWorkspaces,
  resolveActiveContext,
  searchWorkspace
} = require('./projections');
const { createTargetResolvers } = require('./resolvers');
const { readSourceFile, requireExplicitRoot } = require('./source-files');
const { createCaptureServices } = require('./capture-services');
const { createWorkServices } = require('./work-services');

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;
const MAX_AI_CONTEXT_BYTES = 512 * 1024;

function requireExplicitTargetDataFile(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new TypeError('Target services require an explicit version-2 data-file path');
  return path.resolve(filePath);
}

function boundedArchive(document, organizationId, kind) {
  const archive = buildOrganizationArchive(document, organizationId, kind);
  if (Buffer.byteLength(JSON.stringify(archive), 'utf8') > MAX_ARCHIVE_BYTES) throw outputTooLarge();
  return archive;
}

function boundedAiContext(document, organizationId, workspaceId) {
  const context = buildAiContext(document, organizationId, workspaceId);
  if (Buffer.byteLength(JSON.stringify(context), 'utf8') > MAX_AI_CONTEXT_BYTES) throw outputTooLarge();
  return context;
}

function createTargetServices(options = {}) {
  const targetDataFile = requireExplicitTargetDataFile(options.targetDataFile);
  const sourceFilesRoot = requireExplicitRoot(options.sourceFilesRoot);
  const captureServices = createCaptureServices({ ...options, targetDataFile });
  const workServices = createWorkServices({ ...options, targetDataFile });

  async function read(projector) {
    const { document, revision } = await readTargetDataWithRevision(targetDataFile);
    return { value: await projector(document), revision };
  }

  return Object.freeze({
    ...captureServices,
    ...workServices,
    listOrganizations: () => read(listOrganizations),
    getOrganization: organizationId => read(document => getOrganization(document, organizationId)),
    listWorkspaces: organizationId => read(document => listWorkspaces(document, organizationId)),
    getWorkspace: (organizationId, workspaceId) => read(document => getWorkspace(document, organizationId, workspaceId)),
    resolveContext: (organizationId, workspaceId = null) => read(document => resolveActiveContext(document, organizationId, workspaceId)),
    portfolio: organizationId => read(document => buildPortfolio(document, organizationId)),
    today: (organizationId, workspaceId) => read(document => buildToday(document, organizationId, workspaceId)),
    search: (organizationId, workspaceId, query) => read(document => searchWorkspace(document, organizationId, workspaceId, query)),
    listChildren: (collection, organizationId, workspaceId) => read(document => listWorkspaceCollection(document, collection, organizationId, workspaceId)),
    getChild: (collection, organizationId, workspaceId, childId) => read(document => getWorkspaceChild(document, collection, organizationId, workspaceId, childId)),
    listSourceFindings: (organizationId, workspaceId, sourceId) => read(document => listFindingsForSource(document, organizationId, workspaceId, sourceId)),
    getSourceFinding: (organizationId, workspaceId, sourceId, findingId) => read(document => getFindingForSource(document, organizationId, workspaceId, sourceId, findingId)),
    listSourceEvidence: (organizationId, workspaceId, sourceId) => read(document => listEvidenceForSource(document, organizationId, workspaceId, sourceId)),
    getSourceEvidence: (organizationId, workspaceId, sourceId, evidenceId) => read(document => getEvidenceForSource(document, organizationId, workspaceId, sourceId, evidenceId)),
    getSourceFile: (organizationId, workspaceId, sourceId) => read(async document => {
      const source = createTargetResolvers(document).resolveWorkspaceChild('sources', organizationId, workspaceId, sourceId);
      return readSourceFile(source, sourceFilesRoot);
    }),
    listBriefings: organizationId => read(document => listBriefings(document, organizationId)),
    getBriefing: (organizationId, briefingId) => read(document => getBriefing(document, organizationId, briefingId)),
    listBriefingVersions: (organizationId, briefingId) => read(document => listBriefingVersions(document, organizationId, briefingId)),
    getBriefingVersion: (organizationId, briefingId, versionId) => read(document => getBriefingVersion(document, organizationId, briefingId, versionId)),
    exportOrganization: organizationId => read(document => boundedArchive(document, organizationId, 'export')),
    backupOrganization: organizationId => read(document => boundedArchive(document, organizationId, 'backup')),
    buildAiContext: (organizationId, workspaceId) => read(document => boundedAiContext(document, organizationId, workspaceId))
  });
}

module.exports = {
  MAX_AI_CONTEXT_BYTES,
  MAX_ARCHIVE_BYTES,
  boundedAiContext,
  boundedArchive,
  createTargetServices,
  requireExplicitTargetDataFile
};
