'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  ALPHA,
  BETA,
  createTargetApiHarness,
  persisted,
  requestApp,
  workspaceBase
} = require('../test-support/target-api-harness');

function dateOffset(days) {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function attentionFixture(document) {
  const assigned = document.workItems.find(item => item.id === 'work-item-alpha-assigned');
  assigned.canonicalStatus = 'Blocked';
  assigned.currentStateConfidence = 'inferred';
  assigned.followUp.dueAt = dateOffset(-1);

  const unassigned = document.workItems.find(item => item.id === 'work-item-alpha-unassigned');
  unassigned.itemType = 'Unknown';
  unassigned.canonicalStatus = 'Unknown';
  unassigned.currentStateConfidence = 'unknown';

  const atRisk = structuredClone(assigned);
  atRisk.id = 'work-item-alpha-at-risk';
  atRisk.jiraId = null;
  atRisk.jiraKey = null;
  atRisk.summary = 'ALPHA SENTINEL — at-risk fictional work item';
  atRisk.canonicalStatus = 'At risk';
  atRisk.currentStateConfidence = 'confirmed';
  atRisk.followUp = {
    state: 'none',
    contact: null,
    lastContactAt: null,
    lastCapturedCommentAt: null,
    nextAction: null,
    dueAt: null,
    note: null
  };
  document.workItems.push(atRisk);

  document.milestones.find(item => item.id === 'milestone-alpha-workspace').date = dateOffset(-2);
  document.milestones.find(item => item.id === 'milestone-alpha-initiative').date = dateOffset(2);

  document.findings.push({
    id: 'finding-alpha-pending-attention',
    organizationId: ALPHA.organizationId,
    workspaceId: ALPHA.workspaceId,
    sourceId: 'source-alpha-sentinel',
    exactExcerpt: 'The fictional Alpha dependency is waiting for review.',
    extractionMethod: 'deterministic-test-extraction',
    extractionVersion: 'portfolio-attention-fixture-1',
    category: 'status',
    reviewStatus: 'pending',
    proposedWorkItemId: 'work-item-alpha-assigned',
    proposedInitiativeId: 'initiative-alpha-multiple-mappings',
    currentness: 'unknown',
    supersededBy: null
  });

  document.workItems.find(item => item.id === 'work-item-beta-assigned').canonicalStatus = 'Blocked';
}

test('Portfolio returns bounded Organization-scoped attention signals without scoring or Source content', async t => {
  const { app, targetDataFile } = await createTargetApiHarness(t, ({ document }) => attentionFixture(document));
  const before = await persisted(targetDataFile);
  const response = await requestApp(app, {
    url: `/api/v2/organizations/${ALPHA.organizationId}/portfolio`
  });
  assert.equal(response.status, 200);
  const portfolio = response.json();

  assert.equal(portfolio.organization.id, ALPHA.organizationId);
  assert.deepEqual(portfolio.attention.workspaceLevels, {
    urgent: 1,
    attention: 1,
    review: 0,
    readiness: 0,
    clear: 0
  });
  assert.equal(portfolio.attention.queueMeta.total, 2);
  assert.equal(portfolio.attention.queueMeta.returned, 2);
  assert.equal(portfolio.attention.queueMeta.truncated, false);
  assert.equal(portfolio.attention.queue[0].workspace.id, ALPHA.workspaceId);
  assert.equal(portfolio.attention.queue[0].level, 'urgent');
  assert.deepEqual(portfolio.attention.queue[0].signals.slice(0, 3).map(signal => signal.key), [
    'blocked-work',
    'overdue-milestones',
    'overdue-follow-ups'
  ]);

  assert.equal(portfolio.counts.blockedWorkItems, 2);
  assert.equal(portfolio.counts.atRiskWorkItems, 1);
  assert.equal(portfolio.counts.overdueFollowUps, 1);
  assert.equal(portfolio.counts.overdueMilestones, 1);
  assert.equal(portfolio.counts.dueSoonMilestones, 1);
  assert.equal(portfolio.counts.proposedChangesToReview, 1);
  assert.equal(portfolio.counts.unknownStatusWorkItems, 1);
  assert.equal(portfolio.counts.unknownTypeWorkItems, 1);

  const serialized = JSON.stringify(portfolio);
  assert.doesNotMatch(serialized, /org-fixture-beta|workspace-beta-shared|BETA SENTINEL/i);
  assert.doesNotMatch(serialized, /The fictional Alpha dependency is waiting for review\./);
  assert.doesNotMatch(serialized, /beforeValue|proposedValue|snapshotHash|riskScore/i);

  const after = await persisted(targetDataFile);
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.document, before.document);
});

test('Today explains grounded delivery, review, milestone, and readiness attention separately', async t => {
  const { app } = await createTargetApiHarness(t, ({ document }) => attentionFixture(document));
  const response = await requestApp(app, { url: `${workspaceBase(ALPHA)}/today` });
  assert.equal(response.status, 200);
  const today = response.json();

  assert.equal(today.attention.level, 'urgent');
  assert.equal(today.counts.blockedWorkItems, 2);
  assert.equal(today.counts.atRiskWorkItems, 1);
  assert.equal(today.counts.overdueFollowUps, 1);
  assert.equal(today.counts.overdueMilestones, 1);
  assert.equal(today.counts.dueSoonMilestones, 1);
  assert.equal(today.counts.findingsToReview, 1);
  assert.equal(today.counts.proposedChangesToReview, 1);
  assert.equal(today.counts.unknownStatusWorkItems, 1);
  assert.equal(today.counts.unknownTypeWorkItems, 1);
  assert.equal(today.counts.currentStateNeedsConfirmation, 1);

  assert.deepEqual(today.attention.blockedWorkItems.map(item => item.id), ['work-item-alpha-assigned', 'work-item-alpha-at-risk']);
  assert.deepEqual(today.attention.atRiskWorkItems.map(item => item.id), ['work-item-alpha-at-risk']);
  assert.deepEqual(today.attention.milestones.map(item => item.timing.pressure), ['overdue', 'due-soon']);
  assert.equal(today.attention.findingsToReview[0].id, 'finding-alpha-pending-attention');
  assert.deepEqual(Object.keys(today.attention.proposedChangesToReview[0]).sort(), [
    'field',
    'id',
    'organizationId',
    'reviewStatus',
    'workItem',
    'workspaceId'
  ]);
  assert.equal(today.attention.proposedChangesToReview[0].workItem.id, 'work-item-alpha-assigned');

  const readiness = new Map(today.attention.readinessWorkItems.map(item => [item.id, item.attentionReasons.map(reason => reason.key)]));
  assert.deepEqual(readiness.get('work-item-alpha-assigned'), ['current-state-needs-confirmation']);
  assert.deepEqual(readiness.get('work-item-alpha-unassigned'), ['unknown-status', 'unknown-type', 'unassigned']);
  assert.ok(Object.values(today.attention.limits.truncated).every(value => value === false));

  const serialized = JSON.stringify(today);
  assert.doesNotMatch(serialized, /org-fixture-beta|workspace-beta-shared|BETA SENTINEL/i);
  assert.doesNotMatch(serialized, /"content":|"metadata":/);
  assert.doesNotMatch(serialized, /beforeValue|proposedValue|snapshotHash/);

  const foreign = await requestApp(app, { url: `${workspaceBase(BETA)}/today` });
  assert.equal(foreign.status, 200);
  assert.equal(foreign.json().attention.blockedWorkItems[0].id, 'work-item-beta-assigned');
  assert.doesNotMatch(JSON.stringify(foreign.json()), /work-item-alpha|ALPHA SENTINEL/i);
});

test('Portfolio attention queue is capped and reports deterministic truncation', async t => {
  const { app } = await createTargetApiHarness(t, ({ document }) => {
    attentionFixture(document);
    const workspaceTemplate = document.workspaces.find(item => item.id === 'workspace-alpha-secondary');
    const workItemTemplate = document.workItems.find(item => item.id === 'work-item-alpha-secondary');
    for (let index = 1; index <= 55; index += 1) {
      const suffix = String(index).padStart(2, '0');
      const workspaceId = `workspace-alpha-attention-${suffix}`;
      document.workspaces.push({
        ...structuredClone(workspaceTemplate),
        id: workspaceId,
        name: `Attention Workspace ${suffix}`
      });
      document.workItems.push({
        ...structuredClone(workItemTemplate),
        id: `work-item-alpha-attention-${suffix}`,
        workspaceId,
        initiativeId: null,
        workstreamId: null,
        jiraEpicMappingId: null,
        summary: `Fictional bounded attention item ${suffix}`,
        followUp: {
          state: 'none',
          contact: null,
          lastContactAt: null,
          lastCapturedCommentAt: null,
          nextAction: null,
          dueAt: null,
          note: null
        }
      });
    }
  });

  const response = await requestApp(app, { url: `/api/v2/organizations/${ALPHA.organizationId}/portfolio` });
  assert.equal(response.status, 200);
  const { attention } = response.json();
  assert.equal(attention.queueMeta.total, 57);
  assert.equal(attention.queueMeta.returned, 50);
  assert.equal(attention.queueMeta.limit, 50);
  assert.equal(attention.queueMeta.truncated, true);
  assert.equal(attention.queue.length, 50);
  assert.equal(attention.queue[0].workspace.id, ALPHA.workspaceId);
  assert.deepEqual(attention.queue.slice(1, 4).map(item => item.workspace.name), [
    'Secondary Delivery Workspace',
    'Attention Workspace 01',
    'Attention Workspace 02'
  ]);
});

test('Portfolio and Today UI explain overlap, render attention categories, and support explicit drill-down', () => {
  const client = fs.readFileSync(require.resolve('../public/target/app.js'), 'utf8');
  const styles = fs.readFileSync(require.resolve('../public/target/styles.css'), 'utf8');

  assert.match(client, /Workspace attention/);
  assert.match(client, /these counts prioritize review and are not a risk score/);
  assert.match(client, /openPortfolioWorkspaceToday/);
  assert.match(client, /Open Today/);
  assert.match(client, /Proposed Changes/);
  assert.match(client, /Readiness gaps/);
  assert.match(client, /does not infer or change values/);
  assert.match(styles, /\.attention-signal-list/);
  assert.match(styles, /\.badge\.review-badge/);
  assert.match(styles, /\.badge\.readiness-badge/);
});
