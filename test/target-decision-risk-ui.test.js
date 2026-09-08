'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const {
  MANAGEMENT_PAGE_SIZE,
  compatibleEvidence,
  createDecisionRiskState,
  createTargetDecisionRiskApiClient,
  managementQuery,
  validateManagementList,
  validateMutationRecord,
  validateTransitionPreview
} = require('../public/target-decision-risk-state');

const ROOT = path.join(__dirname, '..');
const REVISION = 'a'.repeat(64);
const ORGANIZATION_ID = 'org-fictional';
const WORKSPACE_ID = 'workspace-fictional';
const TIMESTAMP = '2026-09-08T12:00:00.000Z';

function response(body = {}) {
  return {
    ok: true,
    headers: { get: name => name === 'x-priorena-target-revision' ? REVISION : null },
    json: async () => structuredClone(body)
  };
}

function decision(overrides = {}) {
  return {
    id: 'decision-fictional',
    organizationId: ORGANIZATION_ID,
    workspaceId: WORKSPACE_ID,
    initiativeId: null,
    workItemId: null,
    title: 'Fictional delivery choice',
    outcome: null,
    rationale: null,
    evidenceIds: [],
    status: 'draft',
    supersedesDecisionId: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    decidedAt: null,
    decidedBy: null,
    ...overrides
  };
}

function risk(overrides = {}) {
  return {
    id: 'risk-fictional',
    organizationId: ORGANIZATION_ID,
    workspaceId: WORKSPACE_ID,
    initiativeId: null,
    workItemId: null,
    title: 'Fictional delivery condition',
    description: 'A bounded fictional delivery condition needs explicit review.',
    responsePlan: null,
    owner: null,
    reviewOn: null,
    evidenceIds: [],
    status: 'open',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    closedAt: null,
    closedBy: null,
    closureNote: null,
    ...overrides
  };
}

test('Decision and Risk browser client uses exact bounded parent-scoped routes and methods', async () => {
  const requests = [];
  const client = createTargetDecisionRiskApiClient({
    request: async (url, options) => {
      requests.push({ url, options });
      return response();
    }
  });
  const base = `/api/v2/organizations/${ORGANIZATION_ID}/workspaces/${WORKSPACE_ID}`;
  await client.listDecisions(ORGANIZATION_ID, WORKSPACE_ID, { page: 2, pageSize: 25, status: 'draft' });
  await client.getDecision(ORGANIZATION_ID, WORKSPACE_ID, 'decision-fictional');
  await client.createDecision(ORGANIZATION_ID, WORKSPACE_ID, { decision: {} });
  await client.updateDecision(ORGANIZATION_ID, WORKSPACE_ID, 'decision-fictional', { changes: {} });
  await client.previewDecision(ORGANIZATION_ID, WORKSPACE_ID, 'decision-fictional', { outcome: 'Fictional' });
  await client.decide(ORGANIZATION_ID, WORKSPACE_ID, 'decision-fictional', { previewHash: REVISION });
  await client.listRisks(ORGANIZATION_ID, WORKSPACE_ID);
  await client.getRisk(ORGANIZATION_ID, WORKSPACE_ID, 'risk-fictional');
  await client.createRisk(ORGANIZATION_ID, WORKSPACE_ID, { risk: {} });
  await client.updateRisk(ORGANIZATION_ID, WORKSPACE_ID, 'risk-fictional', { changes: {} });
  await client.previewRiskClosure(ORGANIZATION_ID, WORKSPACE_ID, 'risk-fictional', { closureNote: 'Fictional' });
  await client.closeRisk(ORGANIZATION_ID, WORKSPACE_ID, 'risk-fictional', { previewHash: REVISION });

  assert.deepEqual(requests.map(item => item.url), [
    `${base}/decisions?page=2&pageSize=25&status=draft`,
    `${base}/decisions/decision-fictional`,
    `${base}/decisions`,
    `${base}/decisions/decision-fictional`,
    `${base}/decisions/decision-fictional/decide/preview`,
    `${base}/decisions/decision-fictional/decide/apply`,
    `${base}/risks?page=1&pageSize=${MANAGEMENT_PAGE_SIZE}`,
    `${base}/risks/risk-fictional`,
    `${base}/risks`,
    `${base}/risks/risk-fictional`,
    `${base}/risks/risk-fictional/close/preview`,
    `${base}/risks/risk-fictional/close/apply`
  ]);
  assert.deepEqual(requests.map(item => item.options.method), [
    'GET', 'GET', 'POST', 'PATCH', 'POST', 'POST', 'GET', 'GET', 'POST', 'PATCH', 'POST', 'POST'
  ]);
  assert.throws(() => managementQuery({ page: 0 }, ['draft']), /pagination/);
  assert.throws(() => managementQuery({ pageSize: 101 }, ['draft']), /pagination/);
  assert.throws(() => client.listDecisions('../foreign', WORKSPACE_ID), /stable opaque IDs/);
});

test('Decision and Risk browser validation fails closed before assigning malformed or foreign state', () => {
  const decisionList = {
    revision: REVISION,
    body: {
      organizationId: ORGANIZATION_ID,
      workspaceId: WORKSPACE_ID,
      page: 1,
      pageSize: 25,
      total: 1,
      decisions: [decision()]
    }
  };
  const riskList = {
    revision: REVISION,
    body: {
      organizationId: ORGANIZATION_ID,
      workspaceId: WORKSPACE_ID,
      page: 1,
      pageSize: 25,
      total: 1,
      risks: [risk()]
    }
  };
  assert.equal(validateManagementList(decisionList, 'decision', ORGANIZATION_ID, WORKSPACE_ID).decisions[0].status, 'draft');
  assert.equal(validateManagementList(riskList, 'risk', ORGANIZATION_ID, WORKSPACE_ID).risks[0].status, 'open');
  assert.equal(validateMutationRecord({ revision: REVISION, body: { decision: decision() } }, 'decision', ORGANIZATION_ID, WORKSPACE_ID).id, 'decision-fictional');

  const foreign = structuredClone(decisionList);
  foreign.body.decisions[0].workspaceId = 'workspace-foreign';
  assert.throws(() => validateManagementList(foreign, 'decision', ORGANIZATION_ID, WORKSPACE_ID), /parent context/);

  const leaked = structuredClone(riskList);
  leaked.body.risks[0].exactExcerpt = 'Fictional Source content must not enter this response.';
  assert.throws(() => validateManagementList(leaked, 'risk', ORGANIZATION_ID, WORKSPACE_ID), /unexpected shape/);

  const premature = structuredClone(decisionList);
  premature.body.decisions[0].outcome = 'Premature outcome';
  assert.throws(() => validateManagementList(premature, 'decision', ORGANIZATION_ID, WORKSPACE_ID), /terminal values/);

  const looseTimestamp = structuredClone(decisionList);
  looseTimestamp.body.decisions[0].updatedAt = '2026-09-08T12:00:00Z';
  assert.throws(() => validateManagementList(looseTimestamp, 'decision', ORGANIZATION_ID, WORKSPACE_ID), /timestamp/);

  const reversedTimestamps = structuredClone(decisionList);
  reversedTimestamps.body.decisions[0].createdAt = '2026-09-08T12:01:00.000Z';
  assert.throws(() => validateManagementList(reversedTimestamps, 'decision', ORGANIZATION_ID, WORKSPACE_ID), /inconsistent/);

  const impossibleDate = structuredClone(riskList);
  impossibleDate.body.risks[0].reviewOn = '2026-02-30';
  assert.throws(() => validateManagementList(impossibleDate, 'risk', ORGANIZATION_ID, WORKSPACE_ID), /review date/);

  const reopened = structuredClone(riskList);
  reopened.body.risks[0] = risk({ status: 'closed', closedAt: null, closedBy: null, closureNote: null });
  assert.throws(() => validateManagementList(reopened, 'risk', ORGANIZATION_ID, WORKSPACE_ID), /closure owner/);

  const emptyOptionalText = structuredClone(riskList);
  emptyOptionalText.body.risks[0].owner = '';
  assert.throws(() => validateManagementList(emptyOptionalText, 'risk', ORGANIZATION_ID, WORKSPACE_ID), /owner/);

  assert.throws(() => validateMutationRecord({
    revision: REVISION,
    body: { decision: decision(), leaked: 'unexpected' }
  }, 'decision', ORGANIZATION_ID, WORKSPACE_ID), /unexpected shape/);
  assert.equal(validateMutationRecord({
    revision: REVISION,
    body: { decision: decision(), appliedPreviewHash: 'b'.repeat(64) }
  }, 'decision', ORGANIZATION_ID, WORKSPACE_ID).id, 'decision-fictional');
});

test('terminal previews must match exact parents, entity, revision, hashes, and entered values', () => {
  const values = {
    outcome: 'Use the fictional reviewed path.',
    rationale: 'Fictional accepted Evidence supports the choice.',
    decidedBy: 'fictional-owner'
  };
  const result = {
    revision: REVISION,
    body: {
      preview: {
        organizationId: ORGANIZATION_ID,
        workspaceId: WORKSPACE_ID,
        entityType: 'decision',
        entityId: 'decision-fictional',
        action: 'decide',
        currentRecordHash: 'b'.repeat(64),
        ...values,
        expectedRevision: REVISION,
        previewHash: 'c'.repeat(64)
      }
    }
  };
  assert.equal(validateTransitionPreview(
    result,
    'decision',
    { organizationId: ORGANIZATION_ID, workspaceId: WORKSPACE_ID },
    'decision-fictional',
    values,
    REVISION
  ).previewHash, 'c'.repeat(64));

  const altered = structuredClone(result);
  altered.body.preview.outcome = 'Different value';
  assert.throws(() => validateTransitionPreview(
    altered,
    'decision',
    { organizationId: ORGANIZATION_ID, workspaceId: WORKSPACE_ID },
    'decision-fictional',
    values,
    REVISION
  ), /does not match/);
});

test('Evidence choices narrow deterministically without replacing server validation', () => {
  const workItems = [
    { id: 'work-item-one', initiativeId: 'initiative-one' },
    { id: 'work-item-two', initiativeId: 'initiative-two' }
  ];
  const generic = { id: 'evidence-generic', initiativeId: null, workItemId: null };
  const first = { id: 'evidence-one', initiativeId: 'initiative-one', workItemId: 'work-item-one' };
  const second = { id: 'evidence-two', initiativeId: 'initiative-two', workItemId: 'work-item-two' };
  assert.equal(compatibleEvidence(generic, { initiativeId: 'initiative-one', workItemId: 'work-item-one' }, workItems), true);
  assert.equal(compatibleEvidence(first, { initiativeId: 'initiative-one', workItemId: 'work-item-one' }, workItems), true);
  assert.equal(compatibleEvidence(second, { initiativeId: 'initiative-one', workItemId: 'work-item-one' }, workItems), false);
  assert.equal(compatibleEvidence(first, { initiativeId: 'initiative-two', workItemId: 'work-item-one' }, workItems), false);
  assert.equal(compatibleEvidence(first, { initiativeId: null, workItemId: null }, workItems), true);
});

test('Decision and Risk UI is explicit, inert, context-cleared, and has no external action', async () => {
  const [markup, client, moduleSource, styles, architecture] = await Promise.all([
    fs.readFile(path.join(ROOT, 'public', 'target', 'index.html'), 'utf8'),
    fs.readFile(path.join(ROOT, 'public', 'target', 'app.js'), 'utf8'),
    fs.readFile(path.join(ROOT, 'public', 'target-decision-risk-state.js'), 'utf8'),
    fs.readFile(path.join(ROOT, 'public', 'target', 'styles.css'), 'utf8'),
    fs.readFile(path.join(ROOT, 'docs', 'architecture', 'DECISION_RISK_MANAGEMENT_WORKFLOWS.md'), 'utf8')
  ]);
  assert.match(markup, /data-view="decisions"/);
  assert.match(markup, /data-view="risks"/);
  assert.match(markup, /target-decision-risk-state\.js/);
  assert.match(client, /validateManagementList\(results\[0\], kind/);
  assert.match(client, /state\.workflow\?\.revision !== results\[0\]\.revision/);
  assert.match(client, /const references = kind === 'decision'[\s\S]*if \(references && results\[1\]\.revision !== results\[0\]\.revision\)[\s\S]*state\.decisionRisk\[kind/);
  assert.match(client, /validateTransitionPreview\(result, 'decision'/);
  assert.match(client, /validateTransitionPreview\(result, 'risk'/);
  assert.match(client, /confirmAction\('Decide this Draft\?'/);
  assert.match(client, /confirmAction\('Close this Risk\?'/);
  assert.match(client, /Decision recorded and now immutable/);
  assert.match(client, /Risk closed and now immutable/);
  assert.match(client, /Priorena sent nothing externally/);
  assert.match(client, /Risks have no severity, probability, impact score, or inferred priority/);
  assert.equal((client.match(/clearDecisionRiskData\(\);/g) || []).length >= 1, true);
  assert.match(moduleSource, /exactKeys\(record, keys, label\)/);
  assert.doesNotMatch(`${client}\n${moduleSource}`, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.doesNotMatch(moduleSource, /XMLHttpRequest|WebSocket|openai|chatgpt|atlassian|jira/i);
  assert.match(styles, /\.management-transition-form/);
  assert.match(styles, /\.management-terminal/);
  assert.match(architecture, /Decided Decisions and Closed Risks render as[\s\S]*read-only history/);
  assert.deepEqual(createDecisionRiskState(), {
    decisions: { page: 1, pageSize: 25, status: 'all', total: 0, records: [], revision: null },
    risks: { page: 1, pageSize: 25, status: 'all', total: 0, records: [], revision: null },
    decisionReferences: { records: [], total: 0, revision: null },
    requestId: 0
  });
});
