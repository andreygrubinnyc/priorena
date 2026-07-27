const CATEGORY_MAP = Object.freeze({
  progress_update: 'progress',
  sprint_commitment: 'progress',
  carryover: 'risk',
  capacity_constraint: 'risk',
  scope_change: 'decision',
  acceptance_criterion: 'other',
  missing_information: 'open_question',
  estimate: 'open_question',
  readiness_gap: 'risk',
  story_split: 'decision',
  action: 'next_action',
  ownership: 'next_action',
  question: 'open_question',
  blocker: 'blocker',
  dependency: 'dependency',
  decision: 'decision',
  risk: 'risk',
  open_question: 'open_question',
  other: 'other'
});

const MAX_CANDIDATES = 500;

function bounded(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function briefingCategory(value) {
  return CATEGORY_MAP[String(value || '').toLowerCase()] || 'other';
}

function sourceKindForTranscript(transcript) {
  const type = String(transcript && transcript.type || '').toLowerCase();
  const sourceKind = String(transcript && transcript.sourceKind || '').toLowerCase();
  if (type === 'dsu') return 'dsu_transcript';
  if (type === 'developer conversation' || sourceKind === 'developer-message') return 'developer_message';
  if (sourceKind === 'external-ai-transcription') return 'external_evidence';
  return 'ceremony_evidence';
}

function deliveryProjectContext(project, story) {
  const item = (Array.isArray(project.deliveryProjects) ? project.deliveryProjects : [])
    .find(candidate => candidate && candidate.id === story?.deliveryProjectId);
  return {
    deliveryProjectId: bounded(item?.id || story?.deliveryProjectId, 220),
    deliveryProjectName: bounded(item?.name, 300)
  };
}

function jiraCommentCandidateId(projectName, story) {
  const fingerprint = [projectName, story.id || '', story.jiraId || '', story.lastCommentedAt || '', story.lastComment || ''].join('\u0000');
  return `jira-comment-${crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 32)}`;
}

function collectAcceptedEvidenceCandidates(projects, briefing, limit = MAX_CANDIDATES) {
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return [];
  if (!briefing || !Array.isArray(briefing.projectNames)) return [];
  const boundedLimit = Math.max(1, Math.min(Number(limit) || MAX_CANDIDATES, MAX_CANDIDATES));
  const candidates = [];
  const seen = new Set();
  const selectedDeliveryProjects = new Set(briefing.deliveryProjectIds || []);

  briefing.projectNames.forEach(projectName => {
    const project = projects[projectName];
    if (!project) return;
    const stories = Array.isArray(project.stories) ? project.stories : [];
    const storyMap = new Map(stories.map(story => [story.id, story]));
    stories.forEach(story => {
      const exactExcerpt = bounded(story && story.lastComment, 10_000);
      const sourceDate = bounded(story && story.lastCommentedAt, 100);
      const projectContext = deliveryProjectContext(project, story);
      if (!exactExcerpt || !sourceDate || (selectedDeliveryProjects.size && !selectedDeliveryProjects.has(projectContext.deliveryProjectId))) return;
      const id = jiraCommentCandidateId(projectName, story);
      seen.add(id);
      candidates.push({
        id,
        projectName: bounded(projectName, 160),
        ...projectContext,
        workItemId: bounded(story.id, 200),
        jiraId: bounded(story.jiraId, 100),
        category: 'progress',
        evidenceCategory: 'last_comment',
        exactExcerpt,
        suggestedText: exactExcerpt.slice(0, 500),
        sourceTitle: `${bounded(story.jiraId, 100) || 'Work item'} last comment`,
        sourceType: 'Jira work item',
        sourceKind: 'jira_last_comment',
        sourceDate,
        speaker: '',
        attributionRequired: false,
        reviewedAt: sourceDate
      });
    });
    if (!Array.isArray(project.transcripts)) return;
    project.transcripts.forEach(transcript => {
      (Array.isArray(transcript.extractedFindings) ? transcript.extractedFindings : []).forEach(finding => {
        const id = bounded(finding && finding.id, 220);
        const exactExcerpt = bounded(finding && (finding.exactExcerpt || finding.excerpt), 10_000);
        const story = storyMap.get(finding.storyId);
        const projectContext = deliveryProjectContext(project, story);
        if (!id || seen.has(id) || finding.reviewStatus !== 'accepted' || !exactExcerpt) return;
        if (selectedDeliveryProjects.size && !selectedDeliveryProjects.has(projectContext.deliveryProjectId)) return;
        seen.add(id);
        candidates.push({
          id,
          projectName: bounded(projectName, 160),
          ...projectContext,
          workItemId: bounded(finding.storyId, 200),
          jiraId: bounded(finding.jiraId, 100),
          category: briefingCategory(finding.category),
          evidenceCategory: bounded(finding.category, 100),
          exactExcerpt,
          suggestedText: bounded(finding.summary, 500) || exactExcerpt.slice(0, 500),
          sourceTitle: bounded(transcript.title, 300) || 'Untitled source',
          sourceType: bounded(transcript.type, 100),
          sourceKind: sourceKindForTranscript(transcript),
          sourceDate: bounded(finding.visibleTimestamp || transcript.date || transcript.uploadedAt, 100),
          speaker: bounded(finding.owner, 300),
          attributionRequired: sourceKindForTranscript(transcript) === 'developer_message' && !!bounded(finding.owner, 300),
          reviewedAt: bounded(finding.reviewedAt || finding.createdAt || transcript.date || transcript.uploadedAt, 100)
        });
      });
    });
  });

  return candidates
    .sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)) || a.id.localeCompare(b.id))
    .slice(0, boundedLimit);
}

module.exports = { CATEGORY_MAP, MAX_CANDIDATES, briefingCategory, collectAcceptedEvidenceCandidates, jiraCommentCandidateId, sourceKindForTranscript };
const crypto = require('node:crypto');
