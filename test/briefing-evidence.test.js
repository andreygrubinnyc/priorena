const assert = require('node:assert/strict');
const test = require('node:test');

const { briefingCategory, collectAcceptedEvidenceCandidates } = require('../briefings/briefing-evidence');

test('accepted briefing evidence candidates are bounded, mapped, ordered, and review-safe', () => {
  const projects = {
    Apollo: {
      transcripts: [{
        id: 'source-1', title: 'Fictional DSU', type: 'DSU', extractedFindings: [
          { id: 'accepted-new', reviewStatus: 'accepted', category: 'progress_update', storyId: 'story-1', jiraId: 'APO-1', exactExcerpt: 'APO-1 moved to review.', summary: 'APO-1 moved to review.', reviewedAt: '2026-07-20T15:00:00.000Z' },
          { id: 'accepted-old', reviewStatus: 'accepted', category: 'capacity_constraint', exactExcerpt: 'Capacity is constrained this week.', summary: '', reviewedAt: '2026-07-19T15:00:00.000Z' },
          { id: 'pending', reviewStatus: 'pending', category: 'risk', exactExcerpt: 'Pending text must not appear.' },
          { id: 'rejected', reviewStatus: 'rejected', category: 'blocker', exactExcerpt: 'Rejected text must not appear.' },
          { id: 'empty', reviewStatus: 'accepted', category: 'risk', exactExcerpt: '' }
        ]
      }]
    },
    Outside: { transcripts: [{ extractedFindings: [{ id: 'outside', reviewStatus: 'accepted', exactExcerpt: 'Outside scope.' }] }] }
  };
  const briefing = { projectNames: ['Apollo'] };
  const candidates = collectAcceptedEvidenceCandidates(projects, briefing);

  assert.deepEqual(candidates.map(item => item.id), ['accepted-new', 'accepted-old']);
  assert.equal(candidates[0].category, 'progress');
  assert.equal(candidates[1].category, 'risk');
  assert.equal(candidates[1].suggestedText, 'Capacity is constrained this week.');
  assert.equal(briefingCategory('story_split'), 'decision');
  assert.equal(briefingCategory('unknown_category'), 'other');
});

test('briefing candidates unify Jira last comments, DSU, and developer messages while respecting Project scope', () => {
  const projects = {
    Apollo: {
      deliveryProjects: [{ id: 'delivery-a', name: 'Launch' }, { id: 'delivery-b', name: 'Operations' }],
      stories: [
        { id: 'story-a', jiraId: 'APO-1', deliveryProjectId: 'delivery-a', lastComment: 'Launch validation completed.', lastCommentedAt: '2026-07-20T14:00:00.000Z' },
        { id: 'story-b', jiraId: 'APO-2', deliveryProjectId: 'delivery-b', lastComment: 'Outside the selected Epic.', lastCommentedAt: '2026-07-20T15:00:00.000Z' }
      ],
      transcripts: [
        { id: 'dsu', title: 'Daily standup', type: 'DSU', date: '2026-07-20', extractedFindings: [{ id: 'dsu-finding', reviewStatus: 'accepted', category: 'progress_update', storyId: 'story-a', jiraId: 'APO-1', exactExcerpt: 'Testing is complete.', owner: 'Taylor', reviewedAt: '2026-07-20T16:00:00.000Z' }] },
        { id: 'teams', title: 'Developer conversation', type: 'Developer Conversation', date: '2026-07-20', extractedFindings: [{ id: 'developer-finding', reviewStatus: 'accepted', category: 'dependency', storyId: 'story-a', jiraId: 'APO-1', exactExcerpt: 'We still need the vendor response.', owner: 'Morgan', reviewedAt: '2026-07-20T17:00:00.000Z' }] }
      ]
    }
  };
  const candidates = collectAcceptedEvidenceCandidates(projects, { projectNames: ['Apollo'], deliveryProjectIds: ['delivery-a'] });
  assert.deepEqual(new Set(candidates.map(item => item.sourceKind)), new Set(['jira_last_comment', 'dsu_transcript', 'developer_message']));
  assert.ok(candidates.every(item => item.deliveryProjectId === 'delivery-a'));
  assert.equal(candidates.find(item => item.sourceKind === 'developer_message').attributionRequired, true);
  assert.doesNotMatch(candidates.map(item => item.exactExcerpt).join(' '), /Outside the selected Epic/);
});
