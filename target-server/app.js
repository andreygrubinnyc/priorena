'use strict';

const express = require('express');

const { methodNotAllowed, notFound, publicErrorBody, TargetApiError } = require('./errors');
const {
  targetRequestLimit,
  targetRequestProvenance,
  targetSecurityHeaders
} = require('./http-security');
const { createTargetServices } = require('./services');
const { safeDownloadName } = require('./source-files');

const TARGET_API_NAMESPACE = '/api/v2';

function createTargetApiApp(options = {}) {
  const services = createTargetServices(options);
  const app = express();
  const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

  app.disable('x-powered-by');
  app.use(targetSecurityHeaders);
  app.use(targetRequestProvenance);
  app.use(targetRequestLimit);
  app.options(`${TARGET_API_NAMESPACE}/*`, (req, res) => res.status(204).end());
  app.use(TARGET_API_NAMESPACE, (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) throw methodNotAllowed();
    next();
  });

  function send(result, res) {
    res.set('X-Priorena-Target-Revision', result.revision);
    return res.json(result.value);
  }

  function jsonRoute(route, handler) {
    app.get(route, wrap(async (req, res) => send(await handler(req), res)));
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

  jsonRoute(`${TARGET_API_NAMESPACE}/organizations/:organizationId/briefings`, req => services.listBriefings(req.params.organizationId));
  jsonRoute(`${TARGET_API_NAMESPACE}/organizations/:organizationId/briefings/:briefingId`, req => services.getBriefing(req.params.organizationId, req.params.briefingId));
  jsonRoute(`${TARGET_API_NAMESPACE}/organizations/:organizationId/briefings/:briefingId/versions`, req => services.listBriefingVersions(req.params.organizationId, req.params.briefingId));
  jsonRoute(`${TARGET_API_NAMESPACE}/organizations/:organizationId/briefings/:briefingId/versions/:versionId`, req => services.getBriefingVersion(req.params.organizationId, req.params.briefingId, req.params.versionId));

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

  app.use(`${TARGET_API_NAMESPACE}/*`, (req, res, next) => next(notFound()));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof TargetApiError) return res.status(error.statusCode).json(publicErrorBody(error));
    console.error(`Target v2 request failed: ${String(error?.code || error?.name || 'UNKNOWN_ERROR')}`);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  return Object.freeze({ app, services });
}

module.exports = {
  TARGET_API_NAMESPACE,
  createTargetApiApp
};
