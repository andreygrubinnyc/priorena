const assert = require('node:assert/strict');
const test = require('node:test');

const { buildExternalFeedPreview, validateExternalFeed } = require('../external-feed');

const helpers = { resolveStatus: value => value, isAcceptableTimestamp: () => true };

function feed(epicKey = 'APO-100') {
  return {
    schemaVersion: 'pm-external-feed/v3',
    generatedAt: '2026-07-20T16:00:00.000Z',
    source: {
      title: 'Fictional story snapshot', sourceType: 'Story Snapshot', visibleDate: '2026-07-20',
      transcriptionProvider: 'ChatGPT', promptVersion: 'pm-external-feed-v3.0', sourceDescription: 'Sanitized fixture'
    },
    warnings: [],
    workItems: [{
      jiraId: 'APO-1', fields: {}, fieldEvidence: {},
      epicAssociation: { jiraEpicKey: epicKey, jiraEpicName: '', evidenceIds: ['evidence-1'] }
    }],
    evidence: [{
      id: 'evidence-1', jiraId: 'APO-1', category: 'other', sourceRef: 'fictional image 1', speaker: '', visibleTimestamp: '',
      exactExcerpt: 'Epic Link: APO-100', reviewNote: ''
    }],
    unlinkedEvidence: []
  };
}

test('v3 Project association requires same-story evidence and exact active Epic match', () => {
  const projectData = {
    deliveryProjects: [{ id: 'delivery-a', name: 'Launch', jiraEpicKey: 'APO-100', jiraEpicName: 'Apollo Launch', archived: false }],
    stories: [{ id: 'story-a', jiraId: 'APO-1', summary: 'Fictional work', deliveryProjectId: '' }]
  };
  const validated = validateExternalFeed(feed(), helpers);
  const preview = buildExternalFeedPreview(projectData, validated, story => story.status || '');
  assert.equal(preview.items[0].epicAssociation.proposedDeliveryProjectId, 'delivery-a');
  assert.equal(preview.items[0].epicAssociation.changed, true);
  assert.equal(preview.items[0].epicAssociation.blocked, false);

  const unresolved = buildExternalFeedPreview(projectData, validateExternalFeed(feed('APO-999'), helpers), story => story.status || '');
  assert.equal(unresolved.items[0].epicAssociation.blocked, true);
  assert.match(unresolved.warnings.join(' '), /did not exactly match/);

  const wrongEvidence = feed();
  wrongEvidence.evidence[0].jiraId = 'APO-2';
  assert.throws(() => validateExternalFeed(wrongEvidence, helpers), /does not support APO-1/);
});
