function createDemoWorkspace() {
  return {
    demoMetadata: {
      fictional: true,
      fixtureVersion: 'priorena-demo-v2',
      notice: 'All names, organizations, work items, dates, and evidence in this workspace are fictional.',
      walkthrough: [
        'Scan the work items and accepted evidence to understand the launch picture.',
        'Change a status or assignee to see a temporary, session-only update.',
        'Submit fictional evidence, review it, and reset the demo when finished.'
      ]
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
          },
          {
            id: 'demo-story-103',
            jiraId: 'DEMO-103',
            itemType: 'Story',
            summary: 'Instrument the launch-health dashboard',
            description: 'Add fictional events and measures for the launch-health view.',
            status: 'Planned',
            owner: 'Priya Shah',
            assignee: 'Priya Shah',
            sprint: 'Demo Sprint 4',
            labels: ['planned', 'analytics'],
            dependencies: 'Waiting for the fictional analytics event contract.',
            updates: []
          },
          {
            id: 'demo-story-104',
            jiraId: 'DEMO-104',
            itemType: 'Task',
            summary: 'Complete accessibility validation',
            description: 'Validate the fictional keyboard and screen-reader launch flows.',
            status: 'Done',
            owner: 'Jordan Lee',
            assignee: 'Jordan Lee',
            sprint: 'Demo Sprint 3',
            labels: ['done', 'accessibility'],
            updates: []
          },
          {
            id: 'demo-story-105',
            jiraId: 'DEMO-105',
            itemType: 'Task',
            summary: 'Confirm support handoff and rollback owner',
            description: 'Prepare the fictional support rehearsal and rollback ownership.',
            status: 'In progress',
            owner: 'Avery Chen',
            assignee: 'Avery Chen',
            sprint: 'Demo Sprint 4',
            labels: ['in-progress', 'operations'],
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
          },
          {
            id: 'demo-milestone-2',
            title: 'Fictional support rehearsal',
            date: '2026-08-18',
            status: 'Upcoming',
            notes: 'Demonstration date only.'
          },
          {
            id: 'demo-milestone-3',
            title: 'Fictional launch decision',
            date: '2026-08-21',
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
              },
              {
                id: 'demo-finding-3',
                storyId: 'demo-story-103',
                jiraId: 'DEMO-103',
                category: 'risk',
                exactExcerpt: 'DEMO-103 may miss two launch-health events unless the fictional event names are confirmed.',
                summary: 'Two launch-health events remain at risk until their names are confirmed.',
                reviewStatus: 'accepted',
                reviewedAt: '2026-07-20T14:04:00.000Z'
              },
              {
                id: 'demo-finding-4',
                storyId: 'demo-story-104',
                jiraId: 'DEMO-104',
                category: 'decision',
                exactExcerpt: 'DEMO-104 accessibility validation is complete, and the tested fictional flows were approved.',
                summary: 'The tested accessibility flows were approved.',
                reviewStatus: 'accepted',
                reviewedAt: '2026-07-20T14:06:00.000Z'
              },
              {
                id: 'demo-finding-5',
                storyId: 'demo-story-105',
                jiraId: 'DEMO-105',
                category: 'action',
                exactExcerpt: 'DEMO-105 support handoff owner will publish the fictional rehearsal runbook before the checkpoint.',
                summary: 'The support rehearsal runbook needs to be published before the checkpoint.',
                reviewStatus: 'accepted',
                reviewedAt: '2026-07-20T14:08:00.000Z'
              },
              {
                id: 'demo-finding-6',
                storyId: 'demo-story-103',
                jiraId: 'DEMO-103',
                category: 'dependency',
                exactExcerpt: 'DEMO-103 depends on the fictional analytics event contract being finalized before implementation.',
                summary: 'Dashboard implementation depends on the final analytics event contract.',
                reviewStatus: 'accepted',
                reviewedAt: '2026-07-20T14:10:00.000Z'
              }
            ]
          }
        ]
      }
    },
    settings: { commentStaleDays: 7, sprintOptions: ['Demo Sprint 3', 'Demo Sprint 4'] },
    aiPrompts: {},
    briefingStreams: [],
    briefings: []
  };
}

module.exports = { createDemoWorkspace };
