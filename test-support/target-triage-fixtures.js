'use strict';

const {
  FIXTURE_TIMESTAMP,
  createMultiOrganizationFixture,
  workItem
} = require('./target-v5-fixtures');

const TRIAGE_CONTEXT = Object.freeze({
  organizationId: 'org-fixture-alpha',
  workspaceId: 'workspace-alpha-shared'
});

function normalizedFeedSource(id, title, records, date = '2026-08-18') {
  return {
    id,
    ...TRIAGE_CONTEXT,
    title,
    type: 'normalized-json',
    sourceKind: 'normalized-feed',
    date,
    provenance: 'Synthetic fictional target-v4 feed for Post-Import Triage tests.',
    content: JSON.stringify({ version: 'target-v4', records }),
    metadata: { capture: { format: 'target-json', contentHash: `fictional-${id}-hash` } },
    processingState: 'processed',
    createdAt: `${date}T12:00:00.000Z`
  };
}

function configureTriageWorkItem(item, index) {
  const types = ['Unknown', 'Task', 'Story', 'Bug', 'Other'];
  const statuses = ['Unknown', 'Planned', 'In Progress'];
  item.jiraId = null;
  item.jiraKey = `FICTA-${1000 + index}`;
  item.itemType = types[index % types.length];
  item.canonicalStatus = statuses[index % statuses.length];
  item.currentStateProvenance = 'fictional-approved-import';
  item.currentStateConfidence = index % 3 === 0 ? 'confirmed' : 'unknown';
  item.summary = index === 7 || index === 8
    ? 'Fictional stable sort tie'
    : `Fictional triage item ${String(index + 1).padStart(2, '0')}`;
  item.description = index === 0
    ? '<script>fictionalWorkItem()</script> This hostile-looking fictional text must render literally and wrap safely. '.repeat(8)
    : `Synthetic English description for fictional triage item ${index + 1}.`;
  item.createdAt = `2026-08-${String(10 + (index % 9)).padStart(2, '0')}T12:00:00.000Z`;
  item.updatedAt = item.createdAt;
  return item;
}

function createTriageFixture() {
  const document = createMultiOrganizationFixture();
  const alphaAssigned = document.workItems.find(item => item.id === 'work-item-alpha-assigned');
  alphaAssigned.itemType = 'Task';
  alphaAssigned.canonicalStatus = 'Planned';
  alphaAssigned.summary = 'Fictional imported item with a known type';

  const alphaUnassigned = document.workItems.find(item => item.id === 'work-item-alpha-unassigned');
  alphaUnassigned.jiraId = null;
  alphaUnassigned.jiraKey = 'FICTA-901';
  alphaUnassigned.itemType = 'Unknown';
  alphaUnassigned.canonicalStatus = 'Unknown';
  alphaUnassigned.currentStateConfidence = 'confirmed';
  alphaUnassigned.summary = '<img src=x onerror=fictional()> Fictional imported review item';
  alphaUnassigned.description = 'A long fictional Work Item description that remains inert text. '.repeat(30);

  for (let index = 0; index < 73; index += 1) {
    const initiativeId = index % 3 === 0
      ? null
      : (index % 2 === 0 ? 'initiative-alpha-multiple-mappings' : 'initiative-alpha-zero-mapping');
    const workstreamId = initiativeId === 'initiative-alpha-multiple-mappings' && index % 4 === 0
      ? 'workstream-alpha-mapped'
      : (initiativeId === 'initiative-alpha-zero-mapping' && index % 5 === 0 ? 'workstream-alpha-zero' : null);
    const jiraEpicMappingId = initiativeId === 'initiative-alpha-multiple-mappings' && index % 6 === 0
      ? 'jira-mapping-alpha-one'
      : null;
    const item = workItem(
      `work-item-triage-${String(index + 1).padStart(3, '0')}`,
      TRIAGE_CONTEXT.organizationId,
      TRIAGE_CONTEXT.workspaceId,
      initiativeId,
      `Fictional triage item ${index + 1}`,
      'none',
      workstreamId,
      jiraEpicMappingId
    );
    document.workItems.push(configureTriageWorkItem(item, index));
  }

  const primaryRecords = [
    {
      externalKey: 'FICTA-901',
      summary: '<b>Fictional Source summary</b>',
      canonicalStatus: '<script>fictionalStatus()</script> Awaiting review',
      evidenceExcerpt: '<svg onload=fictional()> Fictional status wording.',
      category: 'status'
    },
    { externalKey: 'FICTA-900', summary: 'Fictional known item Source row', category: 'note' },
    ...Array.from({ length: 20 }, (_, offset) => ({
      externalKey: `FICTA-${1000 + (offset * 2)}`,
      summary: `Fictional exact Source row ${offset + 1}`,
      canonicalStatus: offset % 2 === 0 ? 'Fictional review suggested' : null,
      category: 'status'
    }))
  ];
  document.sources.push(
    normalizedFeedSource('source-triage-primary', 'Fictional Primary Import Feed', primaryRecords),
    normalizedFeedSource('source-triage-secondary', 'Fictional Secondary Import Feed', [
      { externalKey: 'FICTA-901', summary: 'Second exact fictional row', canonicalStatus: 'Fictional ready suggestion', category: 'status' },
      { externalKey: 'FICTA-1000', summary: 'Second Source match for a fictional item', category: 'note' }
    ], '2026-08-19'),
    normalizedFeedSource('source-triage-title-only', 'Fictional Title Similarity Feed', [
      { externalKey: 'FICTA-1099', summary: 'Fictional triage item 02', canonicalStatus: 'Should not match by title', category: 'status' }
    ]),
    normalizedFeedSource('source-triage-partial-key', 'Fictional Partial Key Feed', [
      { externalKey: 'FICTA-100', summary: 'Partial key must not match FICTA-1000', category: 'note' }
    ]),
    normalizedFeedSource('source-triage-row-order', 'Fictional Row Order Feed', [
      { externalKey: 'FICTA-1002', summary: 'Fictional triage item 04', category: 'note' },
      { externalKey: 'FICTA-1003', summary: 'Fictional triage item 03', category: 'note' }
    ])
  );
  document.sources.push({
    id: 'source-triage-malformed',
    ...TRIAGE_CONTEXT,
    title: 'Fictional Malformed Import Feed',
    type: 'normalized-json',
    sourceKind: 'normalized-feed',
    date: '2026-08-20',
    provenance: 'Synthetic malformed Source for fail-closed exact-match tests.',
    content: '{"version":"target-v4","records":[',
    metadata: { capture: { format: 'target-json', contentHash: 'fictional-malformed-hash' } },
    processingState: 'processed',
    createdAt: '2026-08-20T12:00:00.000Z'
  });

  document.auditEvents.push(
    {
      id: 'audit-event-triage-item-imported',
      ...TRIAGE_CONTEXT,
      entityType: 'workItem',
      entityId: alphaUnassigned.id,
      action: 'work-item-created-from-approved-import-proposal',
      actor: 'fictional-import-reviewer',
      timestamp: FIXTURE_TIMESTAMP,
      beforeHash: null,
      afterHash: 'a'.repeat(64)
    },
    {
      id: 'audit-event-triage-item-reviewed',
      ...TRIAGE_CONTEXT,
      entityType: 'workItem',
      entityId: alphaUnassigned.id,
      action: 'work-item-metadata-reviewed',
      actor: 'fictional-triage-reviewer',
      timestamp: '2026-08-21T12:00:00.000Z',
      beforeHash: 'a'.repeat(64),
      afterHash: 'b'.repeat(64)
    },
    {
      id: 'audit-event-triage-single-source-reviewed',
      ...TRIAGE_CONTEXT,
      entityType: 'workItem',
      entityId: 'work-item-triage-013',
      action: 'work-item-metadata-reviewed',
      actor: 'fictional-triage-reviewer',
      timestamp: '2026-08-21T13:00:00.000Z',
      beforeHash: 'c'.repeat(64),
      afterHash: 'd'.repeat(64)
    }
  );
  return document;
}

module.exports = {
  TRIAGE_CONTEXT,
  createTriageFixture,
  normalizedFeedSource
};
