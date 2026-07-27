function createDemoWorkspace() {
  return {
    demoMetadata: {
      fictional: true,
      fixtureVersion: 'priorena-demo-v1',
      notice: 'All names, organizations, work items, dates, and evidence in this workspace are fictional.'
    },
    projects: {
      'Northstar Launch': {
        description: 'Fictional customer-portal launch used only to demonstrate Priorena.',
        stories: [
          {
            id: 'demo-story-101',
            jiraId: 'DEMO-101',
            itemType: 'Story',
            summary: 'Complete launch-readiness review',
            description: 'Confirm the fictional launch checklist and unresolved readiness items.',
            status: 'In progress',
            owner: 'Maya Chen',
            assignee: 'Maya Chen',
            sprint: 'Demo Sprint 4',
            labels: ['in-progress'],
            updates: []
          },
          {
            id: 'demo-story-102',
            jiraId: 'DEMO-102',
            itemType: 'Story',
            summary: 'Validate notification templates',
            description: 'Review fictional email and in-app notification templates.',
            status: 'Blocked',
            owner: 'Leo Park',
            assignee: 'Leo Park',
            sprint: 'Demo Sprint 4',
            labels: ['blocked'],
            dependencies: 'Waiting for the fictional legal-language review.',
            updates: []
          }
        ],
        timeline: [
          {
            id: 'demo-milestone-1',
            title: 'Fictional readiness checkpoint',
            date: '2026-08-14',
            status: 'Upcoming',
            notes: 'Demonstration date only.'
          }
        ],
        transcripts: [
          {
            id: 'demo-source-1',
            title: 'Fictional DSU — launch readiness',
            type: 'DSU',
            sourceKind: 'demo-fixture',
            date: '2026-07-20',
            extractedFindings: [
              {
                id: 'demo-finding-1',
                storyId: 'demo-story-101',
                jiraId: 'DEMO-101',
                category: 'progress_update',
                exactExcerpt: 'DEMO-101 readiness review is underway and the checklist is being verified.',
                summary: 'Readiness review and checklist verification are underway.',
                reviewStatus: 'accepted',
                reviewedAt: '2026-07-20T14:00:00.000Z'
              },
              {
                id: 'demo-finding-2',
                storyId: 'demo-story-102',
                jiraId: 'DEMO-102',
                category: 'blocker',
                exactExcerpt: 'DEMO-102 remains blocked while the fictional legal language is reviewed.',
                summary: 'Notification templates remain blocked by legal-language review.',
                reviewStatus: 'accepted',
                reviewedAt: '2026-07-20T14:02:00.000Z'
              }
            ]
          }
        ]
      }
    },
    settings: { commentStaleDays: 7, sprintOptions: ['Demo Sprint 4'] },
    aiPrompts: {},
    briefingStreams: [],
    briefings: []
  };
}

module.exports = { createDemoWorkspace };
