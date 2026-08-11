'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const { TargetResourceLimitError, TargetValidationError } = require('../target-model/schema');
const {
  invalidRequest,
  methodNotAllowed,
  notFound,
  outputTooLarge,
  publicErrorBody,
  TargetApiError
} = require('./errors');
const {
  MAX_TARGET_REQUEST_BYTES,
  targetRequestLimit,
  targetRequestProvenance,
  targetSecurityHeaders
} = require('./http-security');
const { createTargetServices } = require('./services');
const { safeDownloadName } = require('./source-files');

const TARGET_API_NAMESPACE = '/api/v2';
const PUBLIC_ROOT = path.join(__dirname, '..', 'public');
const TARGET_MODULE_ASSETS = Object.freeze([
  ['target-context-state.js', fs.readFileSync(path.join(PUBLIC_ROOT, 'target-context-state.js'), 'utf8')],
  ['target-workflow-state.js', fs.readFileSync(path.join(PUBLIC_ROOT, 'target-workflow-state.js'), 'utf8')],
  ['target-briefing-state.js', fs.readFileSync(path.join(PUBLIC_ROOT, 'target-briefing-state.js'), 'utf8')]
].map(([name, source]) => Object.freeze({ route: `/target-modules/${name}`, source })));

function createTargetApiApp(options = {}) {
  const services = createTargetServices(options);
  const app = express();
  const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

  app.disable('x-powered-by');
  app.use(targetSecurityHeaders);
  app.use(targetRequestProvenance);
  app.use(targetRequestLimit);
  const targetUiRoot = path.join(PUBLIC_ROOT, 'target');
  app.use('/target', express.static(targetUiRoot, {
    dotfiles: 'deny',
    etag: false,
    fallthrough: false,
    index: 'index.html',
    maxAge: 0,
    redirect: true
  }));
  TARGET_MODULE_ASSETS.forEach(asset => {
    app.get(asset.route, (req, res) => res.type('application/javascript').send(asset.source));
  });
  app.use('/target-modules/*', (req, res, next) => next(notFound()));
  app.options(`${TARGET_API_NAMESPACE}/*`, (req, res) => res.status(204).end());
  app.use(TARGET_API_NAMESPACE, express.json({ limit: MAX_TARGET_REQUEST_BYTES, strict: true, type: 'application/json' }));

  function send(result, res) {
    res.set('X-Priorena-Target-Revision', result.revision);
    return res.json(result.value);
  }

  function jsonRoute(route, handler) {
    app.get(route, wrap(async (req, res) => send(await handler(req), res)));
  }

  function mutationRoute(method, route, handler) {
    app[method](route, wrap(async (req, res) => send(await handler(req), res)));
  }

  jsonRoute(`${TARGET_API_NAMESPACE}/organizations`, () => services.listOrganizations());
  jsonRoute(`${TARGET_API_NAMESPACE}/organizations/:organizationId`, req => services.getOrganization(req.params.organizationId));
  jsonRoute(`${TARGET_API_NAMESPACE}/organizations/:organizationId/workspaces`, req => services.listWorkspaces(req.params.organizationId));
  jsonRoute(`${TARGET_API_NAMESPACE}/organizations/:organizationId/workspaces/:workspaceId`, req => services.getWorkspace(req.params.organizationId, req.params.workspaceId));
  jsonRoute(`${TARGET_API_NAMESPACE}/context`, req => services.resolveContext(req.query.organizationId, req.query.workspaceId));
  jsonRoute(`${TARGET_API_NAMESPACE}/organizations/:organizationId/portfolio`, req => services.portfolio(req.params.organizationId));

  const workspaceBase = `${TARGET_API_NAMESPACE}/organizations/:organizationId/workspaces/:workspaceId`;
  jsonRoute(`${workspaceBase}/today`, req => services.today(req.params.organizationId, req.params.workspaceId));
  jsonRoute(`${workspaceBase}/search`, req => services.search(req.params.organizationId, req.params.workspaceId, req.query.q));

  mutationRoute('post', `${workspaceBase}/scopes`, req => services.createScope(req.params.organizationId, req.params.workspaceId, req.body));
  mutationRoute('patch', `${workspaceBase}/scopes/:scopeId`, req => services.updateScope(req.params.organizationId, req.params.workspaceId, req.params.scopeId, req.body));
  mutationRoute('post', `${workspaceBase}/scopes/:scopeId/archive`, req => services.setScopeArchived(req.params.organizationId, req.params.workspaceId, req.params.scopeId, req.body));
  jsonRoute(`${workspaceBase}/scopes/:scopeId/jira-epic-mappings`, req => services.listScopeMappings(req.params.organizationId, req.params.workspaceId, req.params.scopeId));
  mutationRoute('post', `${workspaceBase}/scopes/:scopeId/jira-epic-mappings`, req => services.createJiraMapping(req.params.organizationId, req.params.workspaceId, req.params.scopeId, req.body));
  mutationRoute('patch', `${workspaceBase}/scopes/:scopeId/jira-epic-mappings/:mappingId`, req => services.updateJiraMapping(req.params.organizationId, req.params.workspaceId, req.params.scopeId, req.params.mappingId, req.body));

  mutationRoute('post', `${workspaceBase}/work-items`, req => services.createWorkItem(req.params.organizationId, req.params.workspaceId, req.body));
  mutationRoute('post', `${workspaceBase}/work-items/bulk/preview`, req => services.previewBulkWorkItems(req.params.organizationId, req.params.workspaceId, req.body));
  mutationRoute('post', `${workspaceBase}/work-items/bulk/apply`, req => services.applyBulkWorkItems(req.params.organizationId, req.params.workspaceId, req.body));
  mutationRoute('patch', `${workspaceBase}/work-items/:workItemId`, req => services.updateWorkItem(req.params.organizationId, req.params.workspaceId, req.params.workItemId, req.body));
  mutationRoute('post', `${workspaceBase}/work-items/:workItemId/preview`, req => services.previewWorkItemAction(req.params.organizationId, req.params.workspaceId, req.params.workItemId, req.body));
  mutationRoute('post', `${workspaceBase}/work-items/:workItemId/apply`, req => services.applyWorkItemAction(req.params.organizationId, req.params.workspaceId, req.params.workItemId, req.body));

  mutationRoute('post', `${workspaceBase}/milestones`, req => services.createMilestone(req.params.organizationId, req.params.workspaceId, req.body));
  mutationRoute('patch', `${workspaceBase}/milestones/:milestoneId`, req => services.updateMilestone(req.params.organizationId, req.params.workspaceId, req.params.milestoneId, req.body));

  mutationRoute('post', `${workspaceBase}/sources`, req => services.captureSource(req.params.organizationId, req.params.workspaceId, req.body));
  mutationRoute('post', `${workspaceBase}/imports/preview`, req => services.previewImport(req.params.organizationId, req.params.workspaceId, req.body));
  mutationRoute('post', `${workspaceBase}/imports/apply`, req => services.applyImport(req.params.organizationId, req.params.workspaceId, req.body));
  jsonRoute(`${workspaceBase}/findings`, req => services.listFindings(req.params.organizationId, req.params.workspaceId, req.query));
  mutationRoute('post', `${workspaceBase}/findings/bulk-review`, req => services.reviewFindingsBulk(req.params.organizationId, req.params.workspaceId, req.body));
  mutationRoute('post', `${workspaceBase}/findings/:findingId/review`, req => services.reviewFinding(req.params.organizationId, req.params.workspaceId, req.params.findingId, req.body));
  mutationRoute('post', `${workspaceBase}/proposed-changes/preview`, req => services.previewProposedChange(req.params.organizationId, req.params.workspaceId, req.body));
  mutationRoute('post', `${workspaceBase}/proposed-changes`, req => services.createProposedChange(req.params.organizationId, req.params.workspaceId, req.body));
  mutationRoute('post', `${workspaceBase}/proposed-changes/:proposedChangeId/review`, req => services.reviewProposedChange(req.params.organizationId, req.params.workspaceId, req.params.proposedChangeId, req.body));
  mutationRoute('post', `${workspaceBase}/proposed-changes/:proposedChangeId/apply`, req => services.applyProposedChange(req.params.organizationId, req.params.workspaceId, req.params.proposedChangeId, req.body));

  const collections = Object.freeze({
    scopes: 'scopes',
    'jira-epic-mappings': 'jiraEpicMappings',
    'work-items': 'workItems',
    milestones: 'milestones',
    sources: 'sources',
    findings: 'findings',
    evidence: 'evidence',
    'proposed-changes': 'proposedChanges'
  });
  Object.entries(collections).forEach(([routeName, collection]) => {
    jsonRoute(`${workspaceBase}/${routeName}`, req => services.listChildren(collection, req.params.organizationId, req.params.workspaceId));
    jsonRoute(`${workspaceBase}/${routeName}/:childId`, req => services.getChild(collection, req.params.organizationId, req.params.workspaceId, req.params.childId));
  });

  jsonRoute(`${workspaceBase}/sources/:sourceId/findings`, req => services.listSourceFindings(req.params.organizationId, req.params.workspaceId, req.params.sourceId));
  jsonRoute(`${workspaceBase}/sources/:sourceId/findings/:findingId`, req => services.getSourceFinding(req.params.organizationId, req.params.workspaceId, req.params.sourceId, req.params.findingId));
  jsonRoute(`${workspaceBase}/sources/:sourceId/evidence`, req => services.listSourceEvidence(req.params.organizationId, req.params.workspaceId, req.params.sourceId));
  jsonRoute(`${workspaceBase}/sources/:sourceId/evidence/:evidenceId`, req => services.getSourceEvidence(req.params.organizationId, req.params.workspaceId, req.params.sourceId, req.params.evidenceId));

  app.get(`${workspaceBase}/sources/:sourceId/file`, wrap(async (req, res) => {
    const result = await services.getSourceFile(req.params.organizationId, req.params.workspaceId, req.params.sourceId);
    const file = result.value;
    res.set('X-Priorena-Target-Revision', result.revision);
    res.set('Content-Type', file.mediaType);
    res.set('Content-Length', String(file.byteLength));
    res.set('Content-Disposition', `attachment; filename="${safeDownloadName(file.displayName)}"`);
    res.send(file.bytes);
  }));

  const briefingBase = `${TARGET_API_NAMESPACE}/organizations/:organizationId/briefings`;
  jsonRoute(briefingBase, req => services.listBriefings(req.params.organizationId));
  mutationRoute('post', briefingBase, req => services.createBriefing(req.params.organizationId, req.body));
  jsonRoute(`${briefingBase}/:briefingId`, req => services.getBriefing(req.params.organizationId, req.params.briefingId));
  mutationRoute('patch', `${briefingBase}/:briefingId`, req => services.updateBriefing(req.params.organizationId, req.params.briefingId, req.body));
  mutationRoute('post', `${briefingBase}/:briefingId/candidates/prepare`, req => services.prepareBriefingCandidates(req.params.organizationId, req.params.briefingId, req.body));
  jsonRoute(`${briefingBase}/:briefingId/versions`, req => services.listBriefingVersions(req.params.organizationId, req.params.briefingId));
  mutationRoute('post', `${briefingBase}/:briefingId/versions`, req => services.createDraft(req.params.organizationId, req.params.briefingId, req.body));
  jsonRoute(`${briefingBase}/:briefingId/versions/open`, req => services.listOpenBriefingVersions(req.params.organizationId, req.params.briefingId));
  jsonRoute(`${briefingBase}/:briefingId/versions/history`, req => services.listBriefingHistory(req.params.organizationId, req.params.briefingId));
  jsonRoute(`${briefingBase}/:briefingId/versions/:versionId`, req => services.getBriefingVersion(req.params.organizationId, req.params.briefingId, req.params.versionId));
  mutationRoute('patch', `${briefingBase}/:briefingId/versions/:versionId`, req => services.editDraft(req.params.organizationId, req.params.briefingId, req.params.versionId, req.body));
  mutationRoute('post', `${briefingBase}/:briefingId/versions/:versionId/refresh`, req => services.refreshDraft(req.params.organizationId, req.params.briefingId, req.params.versionId, req.body));
  mutationRoute('post', `${briefingBase}/:briefingId/versions/:versionId/outputs/preview`, req => services.previewDraftOutputs(req.params.organizationId, req.params.briefingId, req.params.versionId, req.body));
  jsonRoute(`${briefingBase}/:briefingId/versions/:versionId/outputs/:format`, req => services.getFrozenOutput(req.params.organizationId, req.params.briefingId, req.params.versionId, req.params.format));
  mutationRoute('post', `${briefingBase}/:briefingId/versions/:versionId/finalize/preview`, req => services.previewFinalize(req.params.organizationId, req.params.briefingId, req.params.versionId, req.body));
  mutationRoute('post', `${briefingBase}/:briefingId/versions/:versionId/finalize`, req => services.finalize(req.params.organizationId, req.params.briefingId, req.params.versionId, req.body));
  mutationRoute('post', `${briefingBase}/:briefingId/versions/:versionId/communicate/preview`, req => services.previewCommunicate(req.params.organizationId, req.params.briefingId, req.params.versionId, req.body));
  mutationRoute('post', `${briefingBase}/:briefingId/versions/:versionId/communicate`, req => services.markCommunicated(req.params.organizationId, req.params.briefingId, req.params.versionId, req.body));

  for (const kind of ['export', 'backup']) {
    app.get(`${TARGET_API_NAMESPACE}/organizations/:organizationId/${kind}`, wrap(async (req, res) => {
      const result = kind === 'export'
        ? await services.exportOrganization(req.params.organizationId)
        : await services.backupOrganization(req.params.organizationId);
      res.set('X-Priorena-Target-Revision', result.revision);
      res.set('Content-Disposition', `attachment; filename="priorena-organization-${kind}-${safeDownloadName(req.params.organizationId)}.json"`);
      res.json(result.value);
    }));
  }

  app.use(`${TARGET_API_NAMESPACE}/*`, (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next(methodNotAllowed());
    return next(notFound());
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof TargetApiError) return res.status(error.statusCode).json(publicErrorBody(error));
    if (error instanceof TargetResourceLimitError) {
      const safe = outputTooLarge();
      return res.status(safe.statusCode).json(publicErrorBody(safe));
    }
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'REQUEST_TOO_LARGE', message: 'Request body is too large' } });
    }
    if (error instanceof TargetValidationError || error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
      const safe = invalidRequest();
      return res.status(safe.statusCode).json(publicErrorBody(safe));
    }
    console.error(`Target v2 request failed: ${String(error?.code || error?.name || 'UNKNOWN_ERROR')}`);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  return Object.freeze({ app, services });
}

module.exports = {
  TARGET_API_NAMESPACE,
  createTargetApiApp
};
