const projectSelector = document.getElementById('project-selector');
const mainNav = document.getElementById('main-nav');
const aiModeEl = document.getElementById('ai-mode');
const mainTitle = document.getElementById('main-title');
const mainSubtitle = document.getElementById('main-subtitle');
const overviewPanel = document.getElementById('overview-panel');
const portfolioPanel = document.getElementById('portfolio-panel');
const storiesPanel = document.getElementById('stories-panel');
const trackingPanel = document.getElementById('tracking-panel');
const timelinePanel = document.getElementById('timeline-panel');
const transcriptsPanel = document.getElementById('transcripts-panel');
const briefingsPanel = document.getElementById('briefings-panel');
const reportsPanel = document.getElementById('reports-panel');
const teamsPanel = document.getElementById('teams-panel');
const managePanel = document.getElementById('manage-panel');
const helpPanel = document.getElementById('help-panel');
const helpButton = document.getElementById('help-button');
const quickCaptureButton = document.getElementById('quick-capture-button');
const demoModeButton = document.getElementById('demo-mode-button');
const demoShell = document.getElementById('demo-shell');
const viewArea = document.getElementById('view-area');
const brandSub = document.querySelector('.brand-sub');
const footerRole = document.querySelector('.footer-role');
const navButtons = document.querySelectorAll('.nav-item');
const sidebarToggle = document.getElementById('sidebar-toggle');
const appElement = document.getElementById('app');
const { escapeCsvCell, escapeMarkdownCell } = window.PmSecurity;
const { inferStoryStatus: inferStoryStatusShared, daysSinceTimestamp, daysUntilCalendarDate } = window.PmDomain;
const { ITEM_TYPES, itemTypeOrUnknown } = window.PmWorkItemTypes;
const CAPTURE_SOURCE_TYPES = ['DSU', 'Sprint Planning', 'Backlog Refinement', 'Story Snapshot', 'Developer Conversation', 'Other External Evidence', 'Meeting', '1:1', 'Interview', 'Call', 'Notes', 'Other'];
const DEMO_STATUS_VALUES = ['Not started', 'Planned', 'In progress', 'Blocked', 'Done'];
const DEMO_EVIDENCE_CATEGORIES = ['progress_update', 'blocker', 'dependency', 'risk', 'decision', 'action', 'question', 'other'];
const DEMO_SCREEN_META = {
  overview: { title: 'Today', scope: 'fictional demo · delivery attention' },
  stories: { title: 'Work', scope: 'fictional demo · work items' },
  tracking: { title: 'Follow-Up', scope: 'fictional demo · attention queue' },
  timeline: { title: 'Milestones', scope: 'fictional demo · delivery dates' },
  transcripts: { title: 'Capture', scope: 'fictional demo · review-first evidence' },
  portfolio: { title: 'Portfolio', scope: 'fictional demo · one PM workspace' },
  reports: { title: 'Communicate', scope: 'fictional demo · consistent outputs' },
  briefings: { title: 'Communicate', scope: 'fictional demo · consistent outputs' },
  teams: { title: 'Teams Draft', scope: 'fictional demo · channel preview' },
  manage: { title: 'Settings', scope: 'fictional demo · read-only boundary' },
  help: { title: 'Demo Guide', scope: 'fictional demo · quick tour and safety' }
};
const DEMO_TABS = new Set(Object.keys(DEMO_SCREEN_META));

// Header title + scope shown per screen.
const SCREEN_META = {
  overview:    { title: 'Today', scope: 'PM workspace' },
  portfolio:   { title: 'Portfolio',    scope: 'all PM workspaces' },
  stories:     { title: 'Work Items',   scope: 'selected PM workspace' },
  tracking:    { title: 'Follow-Up',    scope: 'Jira work queue' },
  timeline:    { title: 'Milestones',   scope: 'selected PM workspace' },
  transcripts: { title: 'Capture',      scope: 'selected PM workspace' },
  briefings:   { title: 'Briefings',    scope: 'prepare · drafts · history' },
  reports:     { title: 'Communicate',   scope: 'grounded drafts' },
  teams:       { title: 'Teams Draft',  scope: 'selected PM workspace' },
  manage:      { title: 'Settings',     scope: 'workspace + AI' },
  help:        { title: 'Help',         scope: '' }
};
let currentTab = 'overview';
let aiProvider = null;
let showNewProjectForm = false;
let deliveryProjectSelections = new Set();
let demoAvailable = false;
let demoSession = null;
let demoBusy = false;
let demoFeedback = '';
let demoError = '';
let demoCurrentTab = 'overview';

let selectedProject = null;
let projects = {};
let manageSearch = '';
let manageProjectFilter = '';
let manageTypeFilter = '';
let manageSortKey = 'date';
let manageSortDirection = 'desc';
let manageEditing = null;
let manageEditData = {};
let trackingFilter = 'all';
let trackingSearch = '';
let trackingGroupByOwner = false;
let trackingCommentBannerDismissed = false;
let trackingShowAddForm = false;
let trackingProjectFilter = 'all';
let aiPrompts = { dsuExtraction: '', statusReport: '' };
let aiPromptStatus = '';
let settings = { commentStaleDays: 7, sprintOptions: [] };
let projectStatusReport = '';
let projectStatusSource = '';
let statusReportLoading = false;
let statusReportLoadingMode = '';
let statusReportError = '';
let teamsSelectedStories = new Set();
let teamsRecipient = '';
let teamsSubject = '';
let teamsMessage = '';
let teamsSource = '';
let teamsLoading = false;
let teamsLoadingMode = '';
let teamsError = '';
let teamsAssigneeFilter = 'all';
let teamsStatusFilter = 'all';
let teamsSprintFilter = 'all';
let teamsSearch = '';
let editingProjectDesc = false;
let storyEditing = null;
let transcriptEditing = null;
let storyShowAddForm = false;
let storyShowImportForm = false;
let storyImportPreview = null;
let storyImportError = '';
let storyImportLoading = false;
let storyStatusFilter = 'all';
let storyTypeFilter = 'all';
let storyAssigneeFilter = 'all';
let storySprintFilter = 'all';
let storySearch = '';
let workItemExpanded = new Set();
let trackingExpanded = new Set();
let captureFocus = '';
let captureSelectedFiles = [];
let captureUploadFeedback = null;
const CAPTURE_LIST_PAGE_SIZE = 5;
let captureExpandedSections = new Set(['externalFeed', 'evidenceQueue']);
let captureListPages = { sources: 0, findings: 0, updates: 0 };
let findingSelections = new Set();
let findingReviewDrafts = new Map();
let evidenceShowReviewed = false;
let evidenceReviewFeedback = null;
let dsuSelections = new Set();
let dsuReviewDrafts = new Map();
let dsuShowReviewed = false;
let dsuReviewFeedback = null;
let externalFeedText = '';
let externalFeedFileName = '';
let externalFeedPreview = null;
let externalFeedError = '';
let externalFeedPendingId = '';
let externalFeedCompletionFeedback = '';
let externalFeedSelections = new Set();
let externalFeedCreates = new Set();
let externalFeedCreateTypes = new Map();
let briefingStreams = [];
let briefings = [];
let briefingView = 'prepare';
let briefingActiveId = '';
let briefingHydratedId = '';
let briefingChangeSelections = new Set();
let briefingChangeEdits = new Map();
let briefingEvidenceCandidates = [];
let briefingEvidenceSelections = new Set();
let briefingEvidenceEdits = new Map();
let briefingEvidenceLoadedId = '';
let briefingEvidencePage = 0;
let briefingManualFacts = [];
let briefingPreservedFacts = [];
let briefingLoading = false;
let briefingError = '';
let briefingFeedback = '';
const copyPayloads = new Map();
let copyPayloadSequence = 0;

function registerCopyPayload(text) {
  if (copyPayloads.size >= 500) copyPayloads.clear();
  copyPayloadSequence += 1;
  const key = `copy-${copyPayloadSequence}`;
  copyPayloads.set(key, String(text || ''));
  return key;
}

const DECLARATIVE_ACTIONS = new Set([
  'activateTab', 'addProject', 'addManualBriefingFact', 'applyExternalFeed', 'applyStoryTemplate', 'archiveDeliveryProject', 'assignSelectedWorkItems', 'cancelEditProjectDesc', 'cancelManageEdit',
  'cancelStoryCsvImport', 'cancelStoryEdit', 'cancelTranscriptEdit', 'clearDsuSelection', 'clearFindingSelection', 'clearTeamsSelection',
  'communicateActiveBriefing', 'confirmStoryCsvImport', 'copyTeamsMessage', 'createBriefingStreamFromForm', 'createDeliveryProjectFromForm', 'createStory', 'createTimeline', 'createTrackedItem',
  'csvImportDragLeave', 'csvImportDragOver', 'csvImportDrop', 'csvImportFileChosen', 'deleteItem',
  'deleteBriefingStream', 'deleteProject', 'deleteUpdate', 'dismissCommentBanner', 'downloadWorkspaceBackup', 'dzLeave', 'dzOver',
  'dzDrop', 'dzFileChosen', 'exportManageCSV', 'exportManageMarkdown', 'exportTrackingCSV',
  'finalizeActiveBriefing', 'generateBriefingOutputs', 'generateStatusReport', 'generateTeamsUpdate', 'logItemComment', 'manageToggleNewProjectForm',
  'openCapture', 'openFollowUp', 'openMilestones', 'openPortfolio', 'openSettings', 'openStatusSummary',
  'openBriefing', 'openBriefings', 'openTeamsDraft', 'openWorkItems', 'previewStoryCsvImport', 'removeBriefingManualFact', 'removeCaptureFile', 'acceptSelectedDsuUpdates', 'acceptSelectedFindings', 'rejectSelectedDsuUpdates', 'rejectSelectedFindings',
  'resetExternalFeed', 'resetStoryCsvImport', 'resumeExternalFeed', 'reviewDsuFindingAgain', 'reviewFinding', 'saveAiPrompts', 'saveAssigneeDirectory', 'saveManageEdit', 'saveProjectDesc',
  'saveBriefingFacts', 'saveProjectStatusMappings', 'saveExternalFeed', 'saveStoryEdit', 'saveStructuredMeeting', 'saveTranscriptEdit',
  'saveWorkspaceSettings', 'selectAllTeams', 'selectProject', 'setCaptureListPage', 'setCommentStaleDays', 'setItemFlag',
  'setBriefingChangeField', 'setBriefingChangeIncluded', 'setBriefingEvidenceField', 'setBriefingEvidenceIncluded', 'setBriefingEvidencePage', 'setBriefingView', 'setExternalFeedCreateType', 'setManageFilter', 'setExternalFeedText', 'setStoryAssigneeFilter', 'setStoryFilter', 'setStorySearch', 'setStoryTypeFilter',
  'setStorySprintFilter', 'setTeamsAssigneeFilter', 'setTeamsField', 'setTeamsFilter',
  'setTrackingFilter', 'setTrackingProjectFilter', 'setTrackingSearch', 'startEditProjectDesc',
  'startBriefing', 'startManageEdit', 'startStoryEdit', 'startStoryFromTimeline', 'startTranscriptEdit',
  'submitLinkStory', 'toggleAddTrackedForm', 'toggleLinkStoryForm', 'toggleStoryAddForm',
  'toggleCaptureSection', 'toggleDeliveryProjectSelection', 'toggleDsuPageSelection', 'toggleDsuSelection', 'toggleDsuShowReviewed', 'toggleEvidenceShowReviewed', 'toggleExternalFeedAllFields', 'toggleExternalFeedCreate', 'toggleExternalFeedField', 'toggleFindingPageSelection', 'toggleFindingSelection', 'toggleStoryImportForm', 'toggleStoryTracked', 'toggleTeamsStory', 'toggleTrackingExpanded',
  'toggleDemoSession', 'resetDemoSession', 'saveDemoManualContext', 'saveDemoWorkItem', 'submitDemoEvidence', 'reviewDemoEvidence', 'toggleWorkItemExpanded', 'trackExistingStory', 'untrackItem', 'updateCaptureFile',
  'updateDsuDraft', 'updateFindingDraft', 'updateItemField', 'updateItemLastComment', 'updateManageEditField', 'uploadTranscript', 'externalFeedFileChosen', 'previewExternalFeed'
]);

function splitDeclarativeArguments(source) {
  const parts = [];
  let quote = '';
  let escaped = false;
  let current = '';
  for (const character of source) {
    if (escaped) { current += character; escaped = false; continue; }
    if (character === '\\') { current += character; escaped = true; continue; }
    if (quote) { current += character; if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; current += character; continue; }
    if (character === ',') { parts.push(current.trim()); current = ''; continue; }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function decodeDeclarativeString(token) {
  if (token.startsWith('"')) return JSON.parse(token);
  let value = '';
  for (let index = 1; index < token.length - 1; index += 1) {
    const character = token[index];
    if (character !== '\\') { value += character; continue; }
    index += 1;
    const escaped = token[index];
    value += ({ n: '\n', r: '\r', t: '\t' })[escaped] ?? escaped;
  }
  return value;
}

function parseDeclarativeArgument(token, element, event) {
  if (token === 'this.value') return element.value;
  if (token === 'this.checked') return element.checked;
  if (token === 'this') return element;
  if (token === 'event') return event;
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (token === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(token)) return Number(token);
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) return decodeDeclarativeString(token);
  throw new Error('Unsupported declarative action argument');
}

function runDeclarativeAction(rawExpression, element, event) {
  let expression = String(rawExpression || '').trim();
  if (!expression) return;
  if (expression.endsWith(';return false;')) {
    event.preventDefault();
    expression = expression.slice(0, -14);
  }
  const clickMatch = expression.match(/^document\.getElementById\('([^']+)'\)\.click\(\)$/);
  if (clickMatch) { document.getElementById(clickMatch[1])?.click(); return; }
  const conditionalMatch = expression.match(/^if\(this\.value\)([A-Za-z_$][\w$]*)\(this\.value\)$/);
  if (conditionalMatch) {
    if (!element.value) return;
    const functionName = conditionalMatch[1];
    if (DECLARATIVE_ACTIONS.has(functionName) && typeof globalThis[functionName] === 'function') globalThis[functionName](element.value);
    return;
  }
  const callMatch = expression.match(/^([A-Za-z_$][\w$]*)\((.*)\)$/s);
  if (!callMatch) return;
  const functionName = callMatch[1];
  if (!DECLARATIVE_ACTIONS.has(functionName) || typeof globalThis[functionName] !== 'function') return;
  const args = callMatch[2].trim() ? splitDeclarativeArguments(callMatch[2]).map(token => parseDeclarativeArgument(token, element, event)) : [];
  globalThis[functionName](...args);
}

['click', 'change', 'input', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  document.addEventListener(eventName, event => {
    const attribute = `data-on${eventName}`;
    const element = event.target.closest(`[${attribute}]`);
    if (element) runDeclarativeAction(element.getAttribute(attribute), element, event);
  });
});

const ASSIGNEE_DIRECTORY_STARTER = {
  achen: 'Avery Chen',
  jrivera: 'Jamie Rivera',
  jlee: 'Jordan Lee',
  mshah: 'Morgan Shah',
  tbrooks: 'Taylor Brooks'
};

const PROJECT_STATUS_MAPPING_STARTER = {
  Backlog: 'Planned',
  'Requirements Gathering': 'Planned',
  'Data Architecture': 'Planned',
  'Data Governance': 'Planned',
  'Ready for Dev': 'Planned',
  'In Dev': 'In progress',
  'Dev Peer Review': 'In progress',
  'QA Testing': 'In progress',
  'Prod Deployment': 'In progress',
  Qlik: 'Planned',
  Blocked: 'Blocked',
  Closed: 'Done'
};

const STORY_TEMPLATES = [
  {
    id: 'delivery',
    name: 'Delivery work item',
    description: 'Describe the delivery outcome, the affected scope, and the evidence that confirms completion.',
    acceptanceCriteria: ['Scope and owner are recorded', 'Delivery evidence is linked or noted', 'Dependencies and risks are documented'],
    labels: 'planned'
  },
  {
    id: 'requirement',
    name: 'Requirement',
    description: 'As a stakeholder, I need this requirement clarified so the team can build and validate the intended outcome.',
    acceptanceCriteria: ['Business rule is documented', 'Acceptance criteria are testable', 'Open questions and dependencies are captured'],
    labels: 'planned, requirements'
  },
  {
    id: 'defect',
    name: 'Defect / blocker',
    description: 'Describe the observed issue, impacted workflow, and current workaround.',
    acceptanceCriteria: ['Root cause or owning team is identified', 'Resolution is validated', 'Jira follow-up note is recorded'],
    labels: 'blocked'
  }
];

async function fetchProjects() {
  const response = await fetch('/api/projects');
  projects = await response.json();
  await fetchAiPrompts();
  await fetchSettings();
  await fetchMeta();
  renderProjectSelector();
  if (!selectedProject && Object.keys(projects).length > 0) {
    selectProject(Object.keys(projects)[0]);
  } else {
    renderNavBadges();
  }
}

async function readDemoResponse(response, fallbackMessage) {
  let body = {};
  try { body = await response.json(); } catch (error) { body = {}; }
  if (!response.ok) throw new Error(body.error || fallbackMessage);
  return body;
}

async function fetchDemoConfig() {
  try {
    const response = await fetch('/api/demo/config', { cache: 'no-store' });
    const config = await readDemoResponse(response, 'Unable to check Demo Mode');
    demoAvailable = config.enabled === true;
    demoModeButton?.classList.toggle('hidden', !demoAvailable);
    if (!demoAvailable) return;

    const sessionResponse = await fetch('/api/demo/session', { cache: 'no-store' });
    if (sessionResponse.ok) {
      demoSession = await sessionResponse.json();
      demoFeedback = 'Your temporary demo session was restored.';
      setDemoExperienceActive(true);
    } else if (sessionResponse.status === 401 || sessionResponse.status === 404) {
      await createDemoSession('A fictional starter project was loaded automatically.');
    }
  } catch (error) {
    demoAvailable = false;
    demoModeButton?.classList.add('hidden');
  }
}

function formatDemoExpiry(value) {
  if (!value) return 'Unavailable';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Unavailable' : parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function demoViewModel() {
  const workspace = demoSession?.workspace || {};
  const metadata = workspace.demoMetadata || {};
  const projectEntries = Object.entries(workspace.projects || {});
  const stories = projectEntries.flatMap(([projectName, project]) =>
    (project.stories || []).map(story => ({ ...story, projectName }))
  );
  const evidence = projectEntries.flatMap(([projectName, project]) => (project.transcripts || []).flatMap(source =>
    (source.extractedFindings || []).map(finding => ({
      ...finding,
      projectName,
      sourceTitle: source.title,
      sourceKind: source.sourceKind
    }))
  ));
  const milestones = projectEntries.flatMap(([projectName, project]) =>
    (project.timeline || []).map(milestone => ({ ...milestone, projectName }))
  );
  return {
    workspace,
    metadata,
    projectEntries,
    stories,
    milestones,
    evidence,
    acceptedEvidence: evidence.filter(finding => finding.reviewStatus === 'accepted'),
    userEvidence: evidence.filter(finding => finding.sourceKind === 'demo-sanitized-manual')
  };
}

function demoDate(value) {
  const parsed = new Date(`${value || ''}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? 'Date unavailable' : parsed.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function demoViewLead(eyebrow, title, description, detail = '') {
  return `<div class="demo-view-lead"><div><div class="eyebrow">${escapeHtml(eyebrow)}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</div>`;
}

function demoTryThis(instruction, interaction = 'Read-only example') {
  return `<div class="demo-try-this"><span>${escapeHtml(interaction)}</span><p><strong>What to try:</strong> ${escapeHtml(instruction)}</p></div>`;
}

function renderDemoOverview(data) {
  const walkthrough = Array.isArray(data.metadata.walkthrough) ? data.metadata.walkthrough.slice(0, 4) : [];
  const blocked = data.stories.filter(story => story.status === 'Blocked');
  const done = data.stories.filter(story => story.status === 'Done');
  const attention = data.stories.filter(story => story.status === 'Blocked' || story.dependencies);
  return `
    ${demoViewLead('TODAY · FICTIONAL SAMPLE', 'Northstar Launch command center', 'A safe overview of delivery status, reviewed evidence, upcoming milestones, and the work that needs attention.', `${data.stories.length} work items · ${data.acceptedEvidence.length} reviewed signals`)}
    ${demoTryThis('Scan the attention items, then follow the suggested workflow into Work, Capture, and Communicate.', 'Guided overview')}
    ${walkthrough.length ? `<section class="demo-walkthrough" aria-labelledby="demo-walkthrough-title"><div><div class="eyebrow">START HERE</div><h3 id="demo-walkthrough-title">Explore the fictional sample</h3></div><ol>${walkthrough.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol></section>` : ''}
    ${data.metadata.navigationNotice ? `<div class="note demo-navigation-note"><strong>Safe navigation:</strong> ${escapeHtml(data.metadata.navigationNotice)}</div>` : ''}
    <div class="demo-stat-grid">
      <button class="demo-stat-card" data-onclick="activateTab('stories')"><span>Work items</span><strong>${data.stories.length}</strong><small>${done.length} done · ${blocked.length} blocked</small></button>
      <button class="demo-stat-card" data-onclick="activateTab('transcripts')"><span>Accepted evidence</span><strong>${data.acceptedEvidence.length}</strong><small>reviewed before use</small></button>
      <button class="demo-stat-card" data-onclick="activateTab('timeline')"><span>Milestones</span><strong>${data.milestones.length}</strong><small>fictional dates</small></button>
      <button class="demo-stat-card" data-onclick="activateTab('reports')"><span>Overall status</span><strong class="demo-stat-text">${escapeHtml(data.metadata.communicationPreview?.overallStatus || 'Review')}</strong><small>same facts across outputs</small></button>
    </div>
    <div class="demo-grid">
      <section class="card demo-card">
        <div class="section-heading"><h3>Needs attention</h3><button class="button button-small secondary" data-onclick="activateTab('tracking')">Open Follow-Up</button></div>
        ${attention.map(story => `<article class="demo-list-item"><div><strong>${escapeHtml(story.jiraId)}</strong><span class="status-pill">${escapeHtml(story.status)}</span></div><h4>${escapeHtml(story.summary)}</h4><p>${escapeHtml(story.dependencies || 'Review the current owner and next action.')}</p></article>`).join('') || '<p>No fictional attention items.</p>'}
      </section>
      <section class="card demo-card">
        <div class="section-heading"><h3>Latest reviewed evidence</h3><button class="button button-small secondary" data-onclick="activateTab('transcripts')">Open Capture</button></div>
        ${data.acceptedEvidence.slice(0, 4).map(finding => `<article class="demo-list-item"><div><strong>${escapeHtml(finding.jiraId || 'Unlinked')}</strong><span class="status-pill accepted">Accepted</span></div><h4>${escapeHtml(String(finding.category || 'other').replaceAll('_', ' '))}</h4><p>${escapeHtml(finding.summary || finding.exactExcerpt)}</p></article>`).join('')}
      </section>
    </div>
    <section class="card demo-milestone-preview">
      <div class="section-heading"><h3>Upcoming milestones</h3><button class="button button-small secondary" data-onclick="activateTab('timeline')">Open Milestones</button></div>
      <div class="demo-milestone-row">${data.milestones.map(item => `<div><span>${escapeHtml(demoDate(item.date))}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.status || 'Upcoming')}</small></div>`).join('')}</div>
    </section>`;
}

function renderDemoWork(data) {
  return `
    ${demoViewLead('WORK · TEMPORARY EDITS', 'Fictional delivery scope', 'Inspect ownership and status, then make a temporary session-only change. Resetting or exiting erases every edit.', `${data.stories.length} work items`)}
    ${demoTryThis('Change one fictional status or assignee, select Apply temporarily, and confirm the update appears elsewhere in the demo.', 'Interactive · temporary')}
    <section class="card demo-card">
      ${data.stories.map(story => `
        <article class="demo-list-item">
          <div><strong>${escapeHtml(story.jiraId)}</strong><span class="status-pill">${escapeHtml(story.status)}</span></div>
          <h4>${escapeHtml(story.summary)}</h4>
          <p>${escapeHtml(story.projectName)} · ${escapeHtml(story.itemType)} · ${escapeHtml(story.assignee || story.owner || 'Unassigned')} · ${escapeHtml(story.sprint || 'No sprint')}</p>
          ${story.dependencies ? `<p class="demo-dependency"><strong>Dependency:</strong> ${escapeHtml(story.dependencies)}</p>` : ''}
          <div class="demo-edit-grid" data-demo-project="${escapeHtml(story.projectName)}" data-demo-story-id="${escapeHtml(story.id)}">
            <label>Status<select data-demo-status aria-label="Temporary status for ${escapeHtml(story.jiraId)}">${DEMO_STATUS_VALUES.map(status => `<option value="${escapeHtml(status)}" ${status === story.status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}</select></label>
            <label>Assignee<input data-demo-assignee maxlength="80" value="${escapeHtml(story.assignee || story.owner || '')}" aria-label="Temporary assignee for ${escapeHtml(story.jiraId)}" /></label>
            <button class="button button-small" data-onclick="saveDemoWorkItem(${escapeHtml(JSON.stringify(story.projectName))}, ${escapeHtml(JSON.stringify(story.id))})">Apply temporarily</button>
            <span class="demo-row-error" data-demo-row-error role="status"></span>
          </div>
        </article>`).join('') || '<p>No fictional work items are available.</p>'}
    </section>`;
}

function renderDemoFollowUp(data) {
  const queue = data.stories.filter(story => story.status !== 'Done');
  return `
    ${demoViewLead('FOLLOW-UP · FICTIONAL QUEUE', 'Attention and ownership', 'A read-only sample of the PM follow-up queue. Use Work to try temporary status or assignee changes.', `${queue.length} open items`)}
    ${demoTryThis('Identify which open item needs the next PM conversation, then return to Work to try a temporary change.')}
    <div class="demo-followup-grid">${queue.map(story => `
      <article class="card demo-followup-card">
        <div><strong>${escapeHtml(story.jiraId)}</strong><span class="status-pill">${escapeHtml(story.status)}</span></div>
        <h3>${escapeHtml(story.summary)}</h3>
        <p><strong>Owner:</strong> ${escapeHtml(story.assignee || story.owner || 'Unassigned')}</p>
        <p><strong>Next PM check:</strong> ${escapeHtml(story.dependencies || 'Confirm progress and the next visible update.')}</p>
      </article>`).join('')}</div>`;
}

function renderDemoMilestones(data) {
  return `
    ${demoViewLead('MILESTONES · FICTIONAL DATES', 'Launch decision path', 'These dates exist only to demonstrate how Priorena connects delivery scope to upcoming checkpoints.', `${data.milestones.length} milestones`)}
    ${demoTryThis('Follow the fictional checkpoint sequence and note which work must be resolved before the launch decision.')}
    <section class="card demo-timeline-card">
      ${data.milestones.map((item, index) => `<article class="demo-timeline-item"><div class="demo-timeline-index">${index + 1}</div><div><span>${escapeHtml(demoDate(item.date))} · ${escapeHtml(item.status || 'Upcoming')}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.notes || '')}</p></div></article>`).join('')}
    </section>`;
}

function renderDemoCapture(data) {
  return `
    ${demoViewLead('CAPTURE · REVIEW FIRST', 'Evidence intake and review', 'Only fictional or already-sanitized text is accepted. Submissions remain pending until you explicitly accept or reject them.', `${data.acceptedEvidence.length} accepted · ${data.userEvidence.filter(item => item.reviewStatus === 'pending').length} pending`)}
    ${demoTryThis('Add a short fictional finding, confirm it enters pending review, and explicitly accept or reject it.', 'Interactive · review first')}
    <div class="demo-grid">
      <section class="card demo-card">
        <h3>Accepted evidence</h3>
        ${data.acceptedEvidence.map(finding => `<article class="demo-list-item"><div><strong>${escapeHtml(finding.jiraId || 'Unlinked')}</strong><span class="status-pill accepted">Accepted</span></div><h4>${escapeHtml(String(finding.category || 'other').replaceAll('_', ' '))}</h4><blockquote>${escapeHtml(finding.exactExcerpt)}</blockquote><p>${escapeHtml(finding.sourceTitle)}</p></article>`).join('') || '<p>No fictional evidence is available.</p>'}
      </section>
      <section class="card demo-card">
        <div class="eyebrow">PROVENANCE</div><h3>Why this evidence is trusted</h3>
        <ul class="demo-check-list"><li>Every finding has an exact excerpt and work-item key.</li><li>Accepted and pending states remain distinct.</li><li>New demo input is bounded and rejected if it resembles a URL, email address, credential, or secret.</li><li>No file or original screenshot is accepted here.</li></ul>
      </section>
    </div>
    <section class="card demo-evidence-card">
      <div class="demo-evidence-intro"><div><div class="eyebrow">SANITIZED TEXT ONLY · REVIEW FIRST</div><h3>Try temporary evidence intake</h3><p>Enter fictional or already-sanitized text. The record stays only in this isolated session.</p></div><span>${data.userEvidence.filter(finding => finding.reviewStatus === 'pending').length} pending</span></div>
      <div class="demo-evidence-form">
        <label>Project<select id="demo-evidence-project">${data.projectEntries.map(([projectName]) => `<option value="${escapeHtml(projectName)}">${escapeHtml(projectName)}</option>`).join('')}</select></label>
        <label>Work item<select id="demo-evidence-jira">${data.stories.map(story => `<option value="${escapeHtml(story.jiraId)}">${escapeHtml(story.jiraId)} — ${escapeHtml(story.summary)}</option>`).join('')}</select></label>
        <label>Category<select id="demo-evidence-category">${DEMO_EVIDENCE_CATEGORIES.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category.replaceAll('_', ' '))}</option>`).join('')}</select></label>
        <label class="demo-evidence-wide">Source title<input id="demo-evidence-source-title" maxlength="120" placeholder="Fictional launch-readiness note" /></label>
        <label class="demo-evidence-wide">Short finding summary<input id="demo-evidence-summary" maxlength="240" placeholder="What should the reviewer understand?" /></label>
        <label class="demo-evidence-wide">Exact excerpt<textarea id="demo-evidence-excerpt" maxlength="1000" placeholder="Paste only fictional or sanitized evidence text."></textarea></label>
        <label class="demo-evidence-attestation"><input id="demo-evidence-attested" type="checkbox" />I confirm this text is fictional or sanitized and contains no private information, URLs, email addresses, credentials, or secrets.</label>
        <div class="demo-evidence-submit"><button class="button" data-onclick="submitDemoEvidence()">Add as pending evidence</button><span id="demo-evidence-error" class="demo-row-error" role="status"></span></div>
      </div>
      <div class="demo-review-list"><h4>Temporary evidence review</h4>
        ${data.userEvidence.map(finding => `<article class="demo-review-item"><div><strong>${escapeHtml(finding.jiraId)} · ${escapeHtml(String(finding.category).replaceAll('_', ' '))}</strong><span class="status-pill ${escapeHtml(finding.reviewStatus)}">${escapeHtml(finding.reviewStatus)}</span></div><p>${escapeHtml(finding.summary)}</p><blockquote>${escapeHtml(finding.exactExcerpt)}</blockquote><small>${escapeHtml(finding.sourceTitle)}</small>${finding.reviewStatus === 'pending' ? `<div class="demo-review-actions"><button class="button button-small" data-onclick="reviewDemoEvidence(${escapeHtml(JSON.stringify(finding.projectName))}, ${escapeHtml(JSON.stringify(finding.id))}, 'accepted')">Accept</button><button class="button button-small danger" data-onclick="reviewDemoEvidence(${escapeHtml(JSON.stringify(finding.projectName))}, ${escapeHtml(JSON.stringify(finding.id))}, 'rejected')">Reject</button></div>` : ''}</article>`).join('') || '<p>No temporary evidence has been submitted.</p>'}
      </div>
    </section>`;
}

function renderDemoPortfolio(data) {
  const projectName = data.projectEntries[0]?.[0] || 'Fictional workspace';
  const project = data.projectEntries[0]?.[1] || {};
  return `
    ${demoViewLead('PORTFOLIO · ONE FICTIONAL WORKSPACE', 'PM workspace overview', 'The public demo deliberately uses one bounded delivery scope so reviewers can understand the Project-to-Jira-Epic model without operational data.')}
    ${demoTryThis('Review how one PM workspace contains one fictional Jira Epic delivery scope.')}
    <section class="card demo-portfolio-card"><div><div class="eyebrow">PM WORKSPACE</div><h2>${escapeHtml(projectName)}</h2><p>${escapeHtml(project.description || '')}</p></div><div class="demo-portfolio-metrics"><div><strong>${data.stories.length}</strong><span>work items</span></div><div><strong>${data.acceptedEvidence.length}</strong><span>accepted evidence</span></div><div><strong>${data.milestones.length}</strong><span>milestones</span></div></div></section>
    <div class="note"><strong>Product model:</strong> a PM workspace is the local container; a user-facing Project represents one Jira Epic delivery scope. This fictional sample does not connect to Jira.</div>`;
}

function renderDemoCommunicate(data, teamsOnly = false) {
  const preview = data.metadata.communicationPreview || {};
  const teams = Array.isArray(preview.teams) ? preview.teams : [];
  const teamsCard = `<section class="card demo-channel-card"><div class="section-heading"><h3>Teams-ready draft</h3><span class="micro">fictional · not sent</span></div><p><strong>${escapeHtml(preview.headline || '')}</strong></p><ul>${teams.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`;
  return `
    ${demoViewLead(teamsOnly ? 'TEAMS DRAFT · NOT SENT' : 'COMMUNICATE · SAME FACT SET', teamsOnly ? 'Fictional Teams update' : 'Channel-ready briefing preview', 'These drafts are deterministic examples. Nothing is copied, sent, published, or marked communicated automatically.', escapeHtml(preview.overallStatus || 'Review'))}
    ${demoTryThis(teamsOnly ? 'Compare this Teams-ready wording with the broader Communicate preview.' : 'Compare Teams, email, and Confluence wording and confirm they use the same facts.', 'Drafts read-only · manual note temporary')}
    ${teamsOnly ? teamsCard : `<div class="demo-channel-grid">${teamsCard}<section class="card demo-channel-card"><div class="section-heading"><h3>Leadership email</h3><span class="micro">fictional · not sent</span></div><p class="demo-email-subject">${escapeHtml(preview.emailSubject || '')}</p><p>${escapeHtml(preview.emailOpening || '')}</p></section><section class="card demo-channel-card"><div class="section-heading"><h3>Confluence summary</h3><span class="micro">fictional · not published</span></div><p>${escapeHtml(preview.confluenceSummary || '')}</p><div class="demo-fact-strip"><span>${data.stories.length} work items</span><span>${data.acceptedEvidence.length} accepted findings</span><span>${data.milestones.length} milestones</span></div></section></div>`}
    <section class="card demo-manual-card"><div><div class="eyebrow">TEMPORARY MANUAL INPUT</div><h3>Add bounded leadership context</h3><p>This text remains separate from source evidence and is erased with the demo session.</p></div><textarea id="demo-manual-context" maxlength="2000" placeholder="Add fictional leadership framing or context…">${escapeHtml(demoSession.manualContext || '')}</textarea><button class="button" data-onclick="saveDemoManualContext()" ${demoBusy ? 'disabled' : ''}>Save temporarily</button></section>`;
}

function renderDemoSettings(data) {
  const sprintOptions = Array.isArray(data.workspace.settings?.sprintOptions) ? data.workspace.settings.sprintOptions : [];
  return `
    ${demoViewLead('SETTINGS · READ ONLY', 'Demo safety boundary', 'Settings are presented for orientation only. Demo Mode cannot change normal workspace configuration, persistence, or provider credentials.')}
    ${demoTryThis('Review the runtime, cleanup, and disabled-feature boundaries that keep the public demo isolated.')}
    <div class="demo-settings-grid">
      <section class="card"><div class="eyebrow">RUNTIME</div><h3>Local and isolated</h3><dl><div><dt>Network</dt><dd>127.0.0.1 only</dd></div><div><dt>Persistence</dt><dd>In-memory demo session</dd></div><div><dt>AI provider</dt><dd>Not used in Demo Mode</dd></div><div><dt>Private workspace</dt><dd>No access</dd></div></dl></section>
      <section class="card"><div class="eyebrow">SESSION</div><h3>Automatic cleanup</h3><dl><div><dt>Idle expiry</dt><dd>${escapeHtml(formatDemoExpiry(demoSession.idleExpiresAt))}</dd></div><div><dt>Absolute expiry</dt><dd>${escapeHtml(formatDemoExpiry(demoSession.absoluteExpiresAt))}</dd></div><div><dt>Reset</dt><dd>Restores the fictional fixture</dd></div><div><dt>Exit</dt><dd>Erases demo-only changes</dd></div></dl></section>
      <section class="card"><div class="eyebrow">SAMPLE CONFIGURATION</div><h3>Fictional workspace defaults</h3><dl><div><dt>Comment freshness</dt><dd>${escapeHtml(String(data.workspace.settings?.commentStaleDays || 7))} days</dd></div><div><dt>Sprints</dt><dd>${escapeHtml(sprintOptions.join(', ') || 'None')}</dd></div><div><dt>Fixture</dt><dd>${escapeHtml(data.metadata.fixtureVersion || 'demo')}</dd></div></dl></section>
      <section class="card"><div class="eyebrow">BOUNDARY</div><h3>What remains disabled</h3><ul class="demo-check-list"><li>Normal persistence APIs and workspace data</li><li>Provider-backed AI drafting</li><li>File and screenshot upload</li><li>Automatic Jira, Teams, email, or Confluence publication</li></ul></section>
    </div>`;
}

function renderDemoHelp() {
  return `
    ${demoViewLead('DEMO GUIDE · START HERE', 'A four-step tour of Priorena', 'Use this guide at any time. The demo is fictional, temporary, isolated, and separate from the normal workspace.')}
    ${demoTryThis('Follow Today → Work → Capture → Communicate, then use Reset demo if you want to restore the starting state.', 'Guide')}
    <div class="demo-help-grid">
      <section class="card demo-help-card">
        <div class="eyebrow">QUICK TOUR</div><h3>Recommended workflow</h3>
        <ol class="demo-help-steps">
          <li><button data-onclick="activateTab('overview')"><strong>Today</strong><span>Understand status and attention signals.</span></button></li>
          <li><button data-onclick="activateTab('stories')"><strong>Work</strong><span>Try a temporary status or owner change.</span></button></li>
          <li><button data-onclick="activateTab('transcripts')"><strong>Capture</strong><span>Add fictional evidence and review it.</span></button></li>
          <li><button data-onclick="activateTab('reports')"><strong>Communicate</strong><span>Compare drafts built from the same facts.</span></button></li>
        </ol>
      </section>
      <section class="card demo-help-card">
        <div class="eyebrow">DEMO SAFETY</div><h3>What is—and is not—live</h3>
        <ul class="demo-check-list">
          <li>All names, projects, work items, evidence, and dates are fictional.</li>
          <li>Temporary edits use only the isolated in-memory demo session.</li>
          <li>Nothing connects to Jira, sends a message, uploads a file, or invokes an AI provider.</li>
          <li>The normal workspace and its persistence APIs remain inaccessible until you exit.</li>
        </ul>
      </section>
      <section class="card demo-help-card">
        <div class="eyebrow">PAGE GUIDE</div><h3>Where to look</h3>
        <dl class="demo-page-guide">
          <div><dt>Today</dt><dd>Delivery overview and suggested starting point</dd></div>
          <div><dt>Work</dt><dd>Temporary status and assignee interaction</dd></div>
          <div><dt>Follow-Up / Milestones / Portfolio</dt><dd>Read-only planning examples</dd></div>
          <div><dt>Capture</dt><dd>Bounded, review-first fictional evidence</dd></div>
          <div><dt>Communicate / Teams Draft</dt><dd>Deterministic drafts that are never sent</dd></div>
          <div><dt>Settings</dt><dd>Read-only explanation of the safety boundary</dd></div>
        </dl>
      </section>
      <section class="card demo-help-card">
        <div class="eyebrow">RESET, EXIT, TROUBLESHOOT</div><h3>Know what happens next</h3>
        <ul class="demo-check-list">
          <li><strong>Reset demo</strong> erases your temporary changes and restores the original fictional fixture.</li>
          <li><strong>Exit Demo</strong> erases demo-only changes and returns to a separate normal workspace, which may be empty.</li>
          <li>If the sample does not appear, confirm <strong>PRIORENA_DEMO_MODE=1</strong> and restart the local server.</li>
          <li>If the page cannot connect, confirm the terminal is still running and open <strong>http://127.0.0.1:3000</strong>.</li>
        </ul>
        <div class="demo-help-actions"><button class="button secondary" data-onclick="resetDemoSession()">Reset demo</button><button class="button" data-onclick="activateTab('overview')">Return to Today</button></div>
      </section>
    </div>`;
}

function renderDemoView(data) {
  if (demoCurrentTab === 'stories') return renderDemoWork(data);
  if (demoCurrentTab === 'tracking') return renderDemoFollowUp(data);
  if (demoCurrentTab === 'timeline') return renderDemoMilestones(data);
  if (demoCurrentTab === 'transcripts') return renderDemoCapture(data);
  if (demoCurrentTab === 'portfolio') return renderDemoPortfolio(data);
  if (demoCurrentTab === 'reports' || demoCurrentTab === 'briefings') return renderDemoCommunicate(data);
  if (demoCurrentTab === 'teams') return renderDemoCommunicate(data, true);
  if (demoCurrentTab === 'manage') return renderDemoSettings(data);
  if (demoCurrentTab === 'help') return renderDemoHelp();
  return renderDemoOverview(data);
}

function renderDemoShell() {
  if (!demoShell || !demoSession) return;
  const data = demoViewModel();
  demoShell.innerHTML = `
    <div class="demo-banner demo-banner-compact">
      <div><div class="eyebrow">FICTIONAL · TEMPORARY · ISOLATED</div><h2>Explore Priorena without using real project data</h2><p>${escapeHtml(data.metadata.notice || 'Everything shown here is fictional and exists only in this temporary demo session.')}</p></div>
      <div class="demo-banner-actions"><button class="button secondary" data-onclick="resetDemoSession()" ${demoBusy ? 'disabled' : ''}>Reset demo</button><button class="button" data-onclick="toggleDemoSession()" ${demoBusy ? 'disabled' : ''}>Exit demo</button></div>
    </div>
    ${demoFeedback ? `<div class="notice success">${escapeHtml(demoFeedback)}</div>` : ''}
    ${demoError ? `<div class="notice warning">${escapeHtml(demoError)}</div>` : ''}
    <div class="demo-session-strip"><span>IN-MEMORY SESSION</span><strong>No private workspace access</strong><span>Idle expiry ${escapeHtml(formatDemoExpiry(demoSession.idleExpiresAt))}</span></div>
    <nav class="demo-flow-guide" aria-label="Suggested demo workflow"><span>Suggested flow</span><button data-onclick="activateTab('overview')" ${demoCurrentTab === 'overview' ? 'aria-current="step"' : ''}>1 Today</button><span>→</span><button data-onclick="activateTab('stories')" ${demoCurrentTab === 'stories' ? 'aria-current="step"' : ''}>2 Work</button><span>→</span><button data-onclick="activateTab('transcripts')" ${demoCurrentTab === 'transcripts' ? 'aria-current="step"' : ''}>3 Capture</button><span>→</span><button data-onclick="activateTab('reports')" ${demoCurrentTab === 'reports' ? 'aria-current="step"' : ''}>4 Communicate</button><button class="demo-flow-help" data-onclick="activateTab('help')" ${demoCurrentTab === 'help' ? 'aria-current="page"' : ''}>Demo guide</button></nav>
    ${renderDemoView(data)}`;
}

function setDemoExperienceActive(active) {
  appElement.classList.toggle('demo-session-active', active);
  demoShell?.classList.toggle('hidden', !active);
  viewArea?.classList.toggle('hidden', active);
  quickCaptureButton?.classList.toggle('hidden', active);
  helpButton?.classList.remove('hidden');
  if (mainNav) mainNav.inert = false;
  if (projectSelector) projectSelector.inert = active;
  if (demoModeButton) demoModeButton.textContent = active ? 'Exit Demo' : 'Try Demo';

  if (active) {
    if (brandSub) brandSub.textContent = 'FICTIONAL · TEMPORARY';
    if (footerRole) footerRole.textContent = 'Isolated demo session';
    if (aiModeEl) aiModeEl.textContent = 'no private workspace access';
    if (helpButton) {
      helpButton.textContent = 'Demo guide';
      helpButton.title = 'Open the Demo Guide';
      helpButton.setAttribute('aria-label', 'Open the Demo Guide');
      helpButton.classList.add('demo-guide-button');
    }
    renderProjectSelector();
    activateDemoTab(demoCurrentTab);
  } else {
    if (brandSub) brandSub.textContent = 'LOCAL · SINGLE-USER';
    if (footerRole) footerRole.textContent = 'PM delivery intelligence';
    if (helpButton) {
      helpButton.textContent = '?';
      helpButton.title = 'Help';
      helpButton.setAttribute('aria-label', 'Help');
      helpButton.classList.remove('demo-guide-button');
    }
    renderProjectSelector();
    updateHeader();
    fetchProjects();
  }
}

async function createDemoSession(feedback = '') {
  demoBusy = true;
  demoError = '';
  demoCurrentTab = 'overview';
  try {
    const response = await fetch('/api/demo/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    demoSession = await readDemoResponse(response, 'Unable to start Demo Mode');
    demoFeedback = feedback || 'A new isolated demo session was created.';
    setDemoExperienceActive(true);
  } catch (error) {
    demoSession = null;
    demoError = error.message;
    alert(error.message);
  } finally {
    demoBusy = false;
    if (demoSession) renderDemoShell();
  }
}

async function toggleDemoSession() {
  if (demoBusy || !demoAvailable) return;
  if (!demoSession) {
    await createDemoSession();
    return;
  }

  demoBusy = true;
  try {
    await fetch('/api/demo/session', { method: 'DELETE' });
  } finally {
    demoBusy = false;
    demoSession = null;
    demoFeedback = '';
    demoError = '';
    setDemoExperienceActive(false);
  }
}

async function resetDemoSession() {
  if (demoBusy || !demoSession) return;
  if (!confirm('Reset this temporary demo? Your demo-only changes will be erased.')) return;
  await createDemoSession('The demo was reset to its original fictional data.');
}

async function saveDemoManualContext() {
  if (demoBusy || !demoSession) return;
  const text = document.getElementById('demo-manual-context')?.value || '';
  demoBusy = true;
  demoFeedback = '';
  demoError = '';
  try {
    const response = await fetch('/api/demo/session/manual-context', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    demoSession = await readDemoResponse(response, 'Unable to save temporary demo context');
    demoFeedback = 'Temporary demo context saved.';
  } catch (error) {
    demoError = error.message;
  } finally {
    demoBusy = false;
    renderDemoShell();
  }
}

async function saveDemoWorkItem(project, storyId) {
  if (demoBusy || !demoSession) return;
  const row = Array.from(document.querySelectorAll('.demo-edit-grid')).find(candidate =>
    candidate.dataset.demoProject === project && candidate.dataset.demoStoryId === storyId
  );
  if (!row) return;
  const status = row.querySelector('[data-demo-status]')?.value || '';
  const assigneeInput = row.querySelector('[data-demo-assignee]');
  const assignee = assigneeInput?.value || '';
  const button = row.querySelector('button');
  const errorEl = row.querySelector('[data-demo-row-error]');
  if (errorEl) errorEl.textContent = '';
  if (button) button.disabled = true;
  demoBusy = true;
  demoFeedback = '';
  demoError = '';
  try {
    const response = await fetch('/api/demo/session/work-item', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, storyId, status, assignee })
    });
    demoSession = await readDemoResponse(response, 'Unable to update the temporary demo work item');
    demoFeedback = 'Temporary work-item change applied. Reset or exit to erase it.';
    renderDemoShell();
  } catch (error) {
    if (errorEl) errorEl.textContent = error.message;
    if (button) button.disabled = false;
    if (assigneeInput) assigneeInput.focus();
  } finally {
    demoBusy = false;
  }
}

async function submitDemoEvidence() {
  if (demoBusy || !demoSession) return;
  const errorEl = document.getElementById('demo-evidence-error');
  const button = document.querySelector('.demo-evidence-submit button');
  const payload = {
    project: document.getElementById('demo-evidence-project')?.value || '',
    jiraId: document.getElementById('demo-evidence-jira')?.value || '',
    category: document.getElementById('demo-evidence-category')?.value || '',
    sourceTitle: document.getElementById('demo-evidence-source-title')?.value || '',
    summary: document.getElementById('demo-evidence-summary')?.value || '',
    exactExcerpt: document.getElementById('demo-evidence-excerpt')?.value || '',
    attested: document.getElementById('demo-evidence-attested')?.checked === true
  };
  if (errorEl) errorEl.textContent = '';
  if (button) button.disabled = true;
  demoBusy = true;
  demoFeedback = '';
  demoError = '';
  try {
    const response = await fetch('/api/demo/session/evidence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    demoSession = await readDemoResponse(response, 'Unable to add temporary demo evidence');
    demoFeedback = 'Sanitized text was added as pending evidence. Review it before it becomes accepted.';
    renderDemoShell();
  } catch (error) {
    if (errorEl) errorEl.textContent = error.message;
    if (button) button.disabled = false;
  } finally {
    demoBusy = false;
  }
}

async function reviewDemoEvidence(project, findingId, reviewStatus) {
  if (demoBusy || !demoSession) return;
  demoBusy = true;
  demoFeedback = '';
  demoError = '';
  try {
    const response = await fetch('/api/demo/session/evidence/review', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, findingId, reviewStatus })
    });
    demoSession = await readDemoResponse(response, 'Unable to review temporary demo evidence');
    demoFeedback = `Temporary evidence ${reviewStatus}. No work-item field was changed.`;
  } catch (error) {
    demoError = error.message;
  } finally {
    demoBusy = false;
    renderDemoShell();
  }
}

async function fetchMeta() {
  try {
    const response = await fetch('/api/meta');
    if (response.ok) {
      const meta = await response.json();
      aiProvider = meta.provider || null;
    }
  } catch (error) {
    aiProvider = null;
  }
  if (aiModeEl) {
    aiModeEl.textContent = demoSession
      ? 'no private workspace access'
      : (aiProvider ? `${aiProvider} mode · key set` : 'heuristic mode · no AI key');
  }
}

async function fetchAiPrompts() {
  try {
    const response = await fetch('/api/ai/prompts');
    if (!response.ok) throw new Error('Unable to load AI prompts');
    aiPrompts = await response.json();
  } catch (error) {
    console.warn('Failed to fetch AI prompts:', error.message);
    aiPrompts = { dsuExtraction: '', statusReport: '' };
  }
}

async function fetchSettings() {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) throw new Error('Unable to load settings');
    settings = await response.json();
  } catch (error) {
    console.warn('Failed to fetch settings:', error.message);
    settings = { commentStaleDays: 7, sprintOptions: [] };
  }
}

async function saveAiPrompts() {
  const statusTextarea = document.getElementById('ai-prompt-status-report');
  if (!statusTextarea) return;

  const statusPromptText = statusTextarea.value;
  const response = await fetch('/api/ai/prompts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ statusReport: statusPromptText })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unable to save prompts' }));
    aiPromptStatus = `Failed to save prompts: ${error.error || 'Unknown error'}`;
  } else {
    aiPrompts = await response.json();
    aiPromptStatus = 'Prompts saved successfully.';
  }
  managePanel.innerHTML = renderManagePanel();
}

async function saveWorkspaceSettings() {
  const staleEl = document.getElementById('settings-comment-stale-days');
  const sprintEl = document.getElementById('settings-sprint-options');
  if (!staleEl || !sprintEl) return;
  const commentStaleDays = parseInt(staleEl.value, 10);
  const sprintOptions = sprintEl.value.split('\n').map(value => value.trim()).filter(Boolean);
  const response = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commentStaleDays, sprintOptions })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unable to save workspace settings' }));
    alert(error.error || 'Unable to save workspace settings');
    return;
  }
  settings = await response.json();
  renderPanels();
}

async function saveAssigneeDirectory() {
  if (!selectedProject) return;
  const input = document.getElementById('project-assignee-directory');
  if (!input) return;
  const entries = [];
  const invalid = [];
  input.value.split('\n').forEach((line, index) => {
    const value = line.trim();
    if (!value || value.startsWith('#')) return;
    const separator = value.indexOf('=');
    if (separator < 1 || !value.slice(separator + 1).trim()) { invalid.push(index + 1); return; }
    entries.push({ alias: value.slice(0, separator).trim(), name: value.slice(separator + 1).trim() });
  });
  if (invalid.length) { alert(`Use one alias = Full Name entry per line. Check line${invalid.length === 1 ? '' : 's'} ${invalid.join(', ')}.`); return; }
  const response = await fetch('/api/project/assignee-directory', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: selectedProject, entries, applyExisting: true })
  });
  const result = await response.json().catch(() => ({ error: 'Unable to save assignee directory' }));
  if (!response.ok) { alert(result.error || 'Unable to save assignee directory'); return; }
  await refreshProject();
  alert(`Assignee directory saved. ${result.updated} existing work item${result.updated === 1 ? '' : 's'} updated.`);
}

async function saveProjectStatusMappings() {
  if (!selectedProject) return;
  const input = document.getElementById('project-status-mappings');
  if (!input) return;
  const allowed = new Set(['Blocked', 'In progress', 'Active', 'Planned', 'Done', 'Not started']);
  const entries = [];
  const invalid = [];
  input.value.split('\n').forEach((line, index) => {
    const value = line.trim();
    if (!value || value.startsWith('#')) return;
    const separator = value.indexOf('=');
    const jiraStatus = value.slice(0, separator).trim();
    const operatingStatus = value.slice(separator + 1).trim();
    if (separator < 1 || !allowed.has(operatingStatus)) { invalid.push(index + 1); return; }
    entries.push({ jiraStatus, operatingStatus });
  });
  if (invalid.length) {
    alert(`Use Jira Status = one of: Blocked, In progress, Active, Planned, Done, Not started. Check line${invalid.length === 1 ? '' : 's'} ${invalid.join(', ')}.`);
    return;
  }
  const response = await fetch('/api/project/status-mappings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: selectedProject, entries, applyExisting: true })
  });
  const result = await response.json().catch(() => ({ error: 'Unable to save status mappings' }));
  if (!response.ok) { alert(result.error || 'Unable to save status mappings'); return; }
  await refreshProject();
  alert(`Status mappings saved. ${result.updated} existing work item${result.updated === 1 ? '' : 's'} updated.`);
}

async function generateStatusReport(mode = 'heuristic') {
  if (!selectedProject) {
    statusReportError = 'Select a project first to generate its status report.';
    reportsPanel.innerHTML = renderReportsPanel();
    return;
  }

  statusReportLoading = true;
  statusReportLoadingMode = mode;
  projectStatusReport = '';
  projectStatusSource = '';
  statusReportError = '';
  reportsPanel.innerHTML = renderReportsPanel();

  try {
    const response = await fetch('/api/project/status-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: selectedProject, mode })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unable to generate report' }));
      throw new Error(error.error || 'Unable to generate report');
    }
    const result = await response.json();
    projectStatusReport = result.report || '';
    projectStatusSource = result.source || 'unknown';
  } catch (error) {
    statusReportError = error.message;
  } finally {
    statusReportLoading = false;
    statusReportLoadingMode = '';
    reportsPanel.innerHTML = renderReportsPanel();
  }
}

async function refreshProject() {
  const previouslySelected = selectedProject;
  await fetchProjects();
  if (previouslySelected && projects[previouslySelected]) {
    selectProject(previouslySelected);
  } else if (Object.keys(projects).length > 0) {
    selectProject(Object.keys(projects)[0]);
  } else {
    selectedProject = null;
    renderPanels();
  }
}

// Sidebar workspace area: the stored compatibility key remains `projects`.
function renderProjectSelector() {
  if (demoSession) {
    projectSelector.innerHTML = '<select disabled aria-label="Fictional demo workspace"><option>Northstar Launch · fictional</option></select>';
    return;
  }
  const projectNames = Object.keys(projects);
  const options = projectNames.length
    ? projectNames.map(name => `<option value="${escapeHtml(name)}" ${selectedProject === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')
    : '<option value="">No PM workspaces yet</option>';

  projectSelector.innerHTML = `
    <select data-onchange="selectProject(this.value)" ${projectNames.length ? '' : 'disabled'}>${options}</select>`;
}

// Left-menu notification: the Tracking nav item shows how many tracked items have "gone
// quiet" (no comment past the threshold) across ALL projects — Tracking is cross-project.
function navBadgeCounts() {
  const counts = {};
  const quiet = allTrackedItems().filter(x => itemNeedsComment(x.story)).length;
  if (quiet) counts.stories = quiet;
  return counts;
}

function renderNavBadges() {
  const counts = navBadgeCounts();
  navButtons.forEach(btn => {
    const badge = btn.querySelector('.nav-badge');
    if (!badge) return;
    const n = counts[btn.dataset.tab];
    if (n) {
      badge.textContent = n;
      badge.title = `${n} tracked item${n === 1 ? '' : 's'} gone quiet — no recent comment`;
      badge.classList.add('show');
    } else {
      badge.textContent = '';
      badge.removeAttribute('title');
      badge.classList.remove('show');
    }
  });
}

function updateHeader() {
  const meta = SCREEN_META[currentTab] || { title: '', scope: '' };
  mainTitle.textContent = meta.title;
  mainSubtitle.textContent = meta.scope;
}

async function selectProject(name) {
  if (!name) return;
  if (selectedProject !== name) {
    teamsAssigneeFilter = 'all';
    teamsStatusFilter = 'all';
    teamsSprintFilter = 'all';
    teamsSearch = '';
    findingSelections.clear();
    findingReviewDrafts.clear();
    evidenceReviewFeedback = null;
    dsuSelections.clear();
    dsuReviewDrafts.clear();
    dsuReviewFeedback = null;
    resetExternalFeedState();
  }
  selectedProject = name;
  editingProjectDesc = false;
  renderProjectSelector();
  renderPanels();
  renderNavBadges();
}

async function addProject() {
  const nameEl = document.getElementById('new-project-name');
  const name = nameEl ? nameEl.value.trim() : '';
  if (!name) { alert('Enter a PM workspace name.'); return; }
  const descEl = document.getElementById('new-project-description');
  const description = descEl ? descEl.value.trim() : '';

  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description })
  });

  if (!response.ok) {
    const error = await response.json();
    alert(error.error || 'Unable to create project');
    return;
  }

  showNewProjectForm = false;
  selectedProject = name;
  await fetchProjects();
}

function deliveryProjectsForWorkspace(workspace = projects[selectedProject], includeArchived = false) {
  const items = Array.isArray(workspace?.deliveryProjects) ? workspace.deliveryProjects : [];
  return includeArchived ? items : items.filter(item => !item.archived);
}

function deliveryProjectForStory(workspace, story) {
  return deliveryProjectsForWorkspace(workspace, true).find(item => item.id === story?.deliveryProjectId) || null;
}

function deliveryProjectOptions(workspace, selectedId = '', includeUnassigned = true) {
  const options = deliveryProjectsForWorkspace(workspace).map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selectedId ? 'selected' : ''}>${escapeHtml(item.name)}${item.jiraEpicKey ? ` · ${escapeHtml(item.jiraEpicKey)}` : ''}</option>`).join('');
  return `${includeUnassigned ? `<option value="" ${selectedId ? '' : 'selected'}>Project not identified</option>` : ''}${options}`;
}

async function createDeliveryProjectFromForm() {
  if (!selectedProject) return;
  const value = id => document.getElementById(id)?.value.trim() || '';
  const name = value('delivery-project-name');
  if (!name) { alert('Enter a Project name.'); return; }
  const response = await fetch('/api/project/delivery-project', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace: selectedProject, name, jiraEpicKey: value('delivery-project-epic-key'),
      jiraEpicName: value('delivery-project-epic-name'), owner: value('delivery-project-owner'),
      planningTarget: value('delivery-project-target'), description: value('delivery-project-description'), workstreams: []
    })
  });
  const result = await response.json().catch(() => ({ error: 'Unable to create Project' }));
  if (!response.ok) { alert(result.error || 'Unable to create Project'); return; }
  await refreshProject();
}

async function archiveDeliveryProject(id, archived) {
  const workspace = projects[selectedProject];
  const item = deliveryProjectsForWorkspace(workspace, true).find(project => project.id === id);
  if (!item) return;
  const response = await fetch('/api/project/delivery-project', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace: selectedProject, ...item, archived: !!archived })
  });
  const result = await response.json().catch(() => ({ error: 'Unable to update Project' }));
  if (!response.ok) { alert(result.error || 'Unable to update Project'); return; }
  await refreshProject();
}

function toggleDeliveryProjectSelection(id, checked) {
  if (checked) deliveryProjectSelections.add(id); else deliveryProjectSelections.delete(id);
  managePanel.innerHTML = renderManagePanel();
}

async function assignSelectedWorkItems() {
  if (!selectedProject || !deliveryProjectSelections.size) return;
  const deliveryProjectId = document.getElementById('association-project')?.value || '';
  const response = await fetch('/api/project/story/delivery-project', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace: selectedProject, storyIds: [...deliveryProjectSelections], deliveryProjectId })
  });
  const result = await response.json().catch(() => ({ error: 'Unable to assign selected work items' }));
  if (!response.ok) { alert(result.error || 'Unable to assign selected work items'); return; }
  deliveryProjectSelections.clear();
  await refreshProject();
}

async function deleteProject(name) {
  if (!confirm(`Delete project "${name}" and all its data (stories, timeline, transcripts)? This cannot be undone.`)) return;
  const response = await fetch(`/api/project?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (!response.ok) {
    alert('Unable to delete project.');
    return;
  }
  if (selectedProject === name) selectedProject = null;
  await refreshProject();
}

function manageToggleNewProjectForm() {
  showNewProjectForm = !showNewProjectForm;
  renderPanels();
  if (showNewProjectForm) {
    setTimeout(() => {
      const el = document.getElementById('new-project-name');
      if (el) el.focus();
    }, 0);
  }
}

async function deleteUpdate(project, storyId, updateId) {
  if (!confirm('Delete this extracted update?')) return;
  await fetch(`/api/project/story/update?project=${encodeURIComponent(project)}&storyId=${encodeURIComponent(storyId)}&updateId=${encodeURIComponent(updateId)}`, { method: 'DELETE' });
  await refreshProject();
}

function renderMilestonesPanel(project) {
  const milestones = (project.timeline || []).slice().sort((a, b) => {
    return milestoneHealth(b).score - milestoneHealth(a).score || new Date(a.date || '9999-12-31') - new Date(b.date || '9999-12-31');
  });
  const overdue = milestones.filter(m => milestoneHealth(m).label === 'Overdue').length;
  const dueSoon = milestones.filter(m => milestoneHealth(m).label === 'Due soon').length;
  const noDate = milestones.filter(m => milestoneHealth(m).label === 'No date').length;
  const linked = milestones.filter(m => project.stories.some(story => story.timelineId === m.id)).length;

  const rows = milestones.length ? `
    <ul class="panel-list">
      ${milestones.map(m => {
        const linkedStories = project.stories.filter(story => story.timelineId === m.id);
        const health = milestoneHealth(m);
        return `
          <li class="card milestone-row">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">
              <div style="flex:1;min-width:240px;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
                  <h4 style="margin:0;">${escapeHtml(m.title)}</h4>
                  ${m.status ? statusBadge(m.status) : ''}
                  <span class="badge ${health.badge}">${health.label}</span>
                </div>
                <p>${escapeHtml(m.notes || 'No notes yet.')}</p>
                <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                  <span class="micro">${escapeHtml(m.date || 'No date')}</span>
                  <span class="micro">${linkedStories.length} linked work item${linkedStories.length === 1 ? '' : 's'}</span>
                </div>
                ${linkedStories.length ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">${linkedStories.slice(0, 5).map(s => `<span class="tag">${escapeHtml(s.summary)}</span>`).join('')}</div>` : ''}
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="button button-small secondary" data-onclick="startStoryFromTimeline('${m.id}')">Create work item</button>
                <button class="button button-small secondary" data-onclick="toggleLinkStoryForm('${m.id}')">Link work item</button>
                <button class="button button-small danger" data-onclick="deleteItem(${escapeHtml(JSON.stringify(selectedProject))}, 'timeline', '${m.id}')">Delete</button>
              </div>
            </div>
            <div id="link-form-${m.id}" class="link-form hidden" style="margin-top:12px;">
              <div class="form-row"><label>Select work item</label>
                <select id="timeline-story-select-${m.id}">
                  <option value="">Choose a work item</option>
                  ${project.stories.map(story => `<option value="${story.id}">${escapeHtml(story.summary)}</option>`).join('')}
                </select>
              </div>
              <button class="button" data-onclick="submitLinkStory('${m.id}')">Link work item</button>
            </div>
          </li>`;
      }).join('')}
    </ul>
  ` : '<div class="card"><p>No milestones yet. Add project checkpoints, dates, and delivery markers here.</p></div>';

  return `
    <div class="card hero-card screen-lead milestones-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Schedule control workspace</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <h3 style="margin:0 0 8px;">Milestones and delivery dates</h3>
          <p style="margin:0;">Use this page to anchor the queue to real dates. Milestones matter most when they are dated, linked to work items, and detailed enough to hold up in a readout.</p>
        </div>
      </div>
    </div>
    ${renderWorkTabs('timeline')}
    <div class="insight-strip operating-metrics milestones-metrics" style="margin-bottom:14px;">
      <div class="insight-tile">
        <div class="micro">Overdue</div>
        <div class="insight-number">${overdue}</div>
        <div class="insight-copy">Milestones that already passed without completion</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Due Soon</div>
        <div class="insight-number">${dueSoon}</div>
        <div class="insight-copy">Milestones due within the next 7 days</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Undated</div>
        <div class="insight-number">${noDate}</div>
        <div class="insight-copy">Milestones that still need dates</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Linked Coverage</div>
        <div class="insight-number">${linked}</div>
        <div class="insight-copy">${milestones.length ? `${linked} of ${milestones.length} milestones connected to work items` : 'No milestones yet'}</div>
      </div>
    </div>
    <div class="section-grid" style="margin-bottom:14px;">
      <div class="card">
        <div class="section-heading">
          <h4>Add Milestone</h4>
          <span class="micro">project checkpoint</span>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>Project</label>
            <select id="timeline-project-select">
              ${Object.keys(projects).map(name => `<option value="${escapeHtml(name)}" ${selectedProject === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-row"><label>Title</label><input id="timeline-title" /></div>
          <div class="field-row">
            <div><label>Date</label><input id="timeline-date" type="date" /></div>
            <div><label>Status</label><input id="timeline-status" /></div>
          </div>
          <div class="form-row"><label>Notes</label><textarea id="timeline-notes"></textarea></div>
          <button class="button" data-onclick="createTimeline()">Add Milestone</button>
        </div>
      </div>
      <div class="card">
        <div class="section-heading">
          <h4>Milestone Risk View</h4>
          <span class="micro">date pressure and linkage</span>
        </div>
        <p>Milestones are sorted by risk first so overdue and near-term dates rise to the top. Linking work items turns this screen into a delivery map instead of a passive date list.</p>
        <div class="note warn" style="margin-top:14px;">A milestone without a date or linked work items becomes harder to use in grounded status reporting.</div>
      </div>
    </div>
    ${rows}
  `;
}

function renderPanels() {
  if (!selectedProject) {
    overviewPanel.innerHTML = '<p>Select a project or add one to open its control center.</p>';
    portfolioPanel.innerHTML = renderPortfolioPanel();
    storiesPanel.innerHTML = '<p>Select a project to manage work items.</p>';
    trackingPanel.innerHTML = renderTrackingPanel();
    timelinePanel.innerHTML = '<p>Select a project to manage milestones.</p>';
    transcriptsPanel.innerHTML = '<p>Select a project to capture transcripts and updates.</p>';
    briefingsPanel.innerHTML = renderBriefingsPanel();
    reportsPanel.innerHTML = '<p>Select a project to draft a grounded status summary.</p>';
    teamsPanel.innerHTML = '<p>Select a project to draft a grounded Teams update.</p>';
    managePanel.innerHTML = renderManagePanel();
    helpPanel.innerHTML = renderHelpPanel(true);
    return;
  }

  const project = projects[selectedProject];
  overviewPanel.innerHTML = renderDashboard(project);
  portfolioPanel.innerHTML = renderPortfolioPanel();
  trackingPanel.innerHTML = renderTrackingPanel();
  storiesPanel.innerHTML = renderStoriesPanel(project);
  timelinePanel.innerHTML = renderMilestonesPanel(project);

  transcriptsPanel.innerHTML = renderTranscriptsPanel(project);

  briefingsPanel.innerHTML = renderBriefingsPanel();
  reportsPanel.innerHTML = renderReportsPanel();
  teamsPanel.innerHTML = renderTeamsPanel(project);
  managePanel.innerHTML = renderManagePanel();
  helpPanel.innerHTML = renderHelpPanel(false);
}

function renderHelpPanel(needsProject) {
  const aiMode = aiProvider ? `${aiProvider} is configured` : 'No AI provider is configured';
  return `
    <div class="card hero-card screen-lead help-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">How this workspace works</div>
      <h3 style="margin:0 0 8px;">A factual delivery operating system</h3>
      <p style="margin:0;">The app keeps delivery evidence, work-item context, and communication drafts together. It helps you prepare and prioritize; it does not send Jira or Teams updates on your behalf.</p>
    </div>
    ${needsProject ? `<div class="note warn" style="margin-bottom:14px;">Start by creating a project in Settings. Then add work items, capture a DSU or meeting note, and return to Today for the daily queue.</div>` : ''}
    <div class="help-grid">
      <details class="card help-section help-disclosure" open>
        <summary><span>First-time setup</span><span class="micro">start here</span></summary>
        <ol class="help-list">
          <li>Run <strong>npm install</strong>, copy <strong>.env.example</strong> to <strong>.env</strong>, and run <strong>npm start</strong>.</li>
          <li>Open <strong>http://127.0.0.1:3000</strong> and keep the terminal running. Use <strong>Ctrl+C</strong> to stop the server.</li>
          <li>With <strong>PRIORENA_DEMO_MODE=1</strong>, the fictional Northstar Launch sample opens automatically.</li>
          <li>Restart the server after changing server code or <strong>.env</strong>.</li>
        </ol>
      </details>
      <details class="card help-section help-disclosure" open>
        <summary><span>Demo versus normal workspace</span><span class="micro">separate boundaries</span></summary>
        <ul class="help-list">
          <li><strong>Demo Mode</strong> provides safe demo-only views for Today, Work, Follow-Up, Milestones, Capture, Portfolio, Communicate, Teams Draft, and Settings.</li>
          <li>Every demo view reads the same fictional in-memory session. Normal persistence-backed screens and provider integrations stay inaccessible.</li>
          <li><strong>Reset demo</strong> restores the original fictional sample. Exit, expiry, or server restart erases demo-only changes.</li>
          <li><strong>Exit Demo</strong> returns to the separate normal workspace, which starts empty and receives no demo data.</li>
          <li>To use the full application, create a PM workspace in Settings, add a Project for one Jira Epic, and add only authorized local material.</li>
        </ul>
      </details>
    </div>
    <div class="help-grid">
      <details class="card help-section help-disclosure">
        <summary><span>Daily flow</span><span class="micro">use this order</span></summary>
        <ol class="help-list">
          <li><strong>Today:</strong> review the blocked, follow-up, and quiet-thread signals.</li>
          <li><strong>Work:</strong> confirm ownership, sprint, Jira comment, and milestone linkage on the items needing action.</li>
          <li><strong>Capture:</strong> save a factual meeting note or DSU when new evidence appears.</li>
          <li><strong>Communicate:</strong> prepare a briefing from reviewed changes and context, or use the legacy status-summary and Teams-draft tools.</li>
        </ol>
      </details>
      <details class="card help-section help-disclosure">
        <summary><span>Navigation</span><span class="micro">five destinations</span></summary>
        <ul class="help-list">
          <li><strong>Today</strong> is the selected project's immediate attention view. Use Portfolio here for the all-project rollup.</li>
          <li><strong>Work</strong> contains work items, the cross-project Follow-Up queue, and milestones.</li>
          <li><strong>Capture</strong> stores structured notes and up to five uploaded sources at once; each source keeps its own type.</li>
          <li><strong>Communicate</strong> contains Briefings, the status summary, and Teams draft. Only Mark communicated advances a briefing baseline.</li>
          <li><strong>Settings</strong> manages projects, workspace rules, records, exports, and advanced prompt controls.</li>
        </ul>
      </details>
    </div>
    <div class="help-grid">
      <details class="card help-section help-disclosure">
        <summary><span>Build a normal workspace</span><span class="micro">recommended order</span></summary>
        <ol class="help-list">
          <li>Create the PM workspace and its Project in <strong>Settings</strong>.</li>
          <li>Add work items manually or preview a bounded Jira CSV import under <strong>Work</strong>.</li>
          <li>Use <strong>Capture</strong> to add authorized text evidence and explicitly review extracted findings.</li>
          <li>Review delivery attention signals in <strong>Today</strong> and <strong>Follow-Up</strong>.</li>
          <li>Prepare and finalize a briefing in <strong>Communicate</strong>; only an explicit Mark communicated action advances its baseline.</li>
        </ol>
      </details>
      <details class="card help-section help-disclosure">
        <summary><span>What Priorena does not do</span><span class="micro">important limits</span></summary>
        <ul class="help-list">
          <li>It does not connect to Jira, Teams, email, or Confluence automatically.</li>
          <li>It does not publish messages, change authoritative work items, or mark a briefing communicated without an explicit action.</li>
          <li>It does not accept original screenshots; external screenshot processing must return the strict sanitized feed described under Capture.</li>
          <li>It is not approved for LAN access, tunnels, hosted deployment, shared use, or multiple users.</li>
        </ul>
      </details>
    </div>
    <div class="help-grid">
      <details class="card help-section help-disclosure">
        <summary><span>Why work is flagged</span><span class="micro">operating rules</span></summary>
        <ul class="help-list">
          <li><strong>Blocked</strong> comes from a work item's status label and rises first in queues.</li>
          <li><strong>Needs follow-up</strong> means a tracked, open item has not been marked as contacted.</li>
          <li><strong>Quiet thread</strong> means an open tracked item has no recorded Jira comment within the configured freshness window.</li>
          <li><strong>Coverage gaps</strong> flag missing assignee, sprint, comment/note, or milestone context. They are evidence gaps, not proof that delivery is failing.</li>
          <li><strong>Delivery progress</strong> is a weighted planning signal: done work counts fully, active/in-progress work counts halfway.</li>
        </ul>
      </details>
      <details class="card help-section help-disclosure">
        <summary><span>Evidence flow</span><span class="micro">what feeds what</span></summary>
        <ol class="help-list">
          <li>A structured meeting note is stored as local evidence. It does not change work-item status on its own.</li>
          <li><strong>DSU, Sprint Planning, and Backlog Refinement</strong> create pending findings for review. Only accepted DSU progress findings create work-item updates.</li>
          <li><strong>External ChatGPT feed</strong> validates a separately generated JSON or Markdown feed and requires field-by-field reconciliation before changing work items. Original screenshots never enter this app.</li>
          <li>Extracted updates feed Today, work-item context, status summaries, and Teams drafts.</li>
          <li>Delete a source and its derived extracted updates are removed too, so the evidence trail stays honest.</li>
        </ol>
      </details>
    </div>
    <div class="help-grid">
      <details class="card help-section help-disclosure">
        <summary><span>AI and review</span><span class="micro">optional assistance</span></summary>
        <p><strong>${escapeHtml(aiMode)}.</strong> Ceremony extraction is deterministic and local. AI is optional only for status-summary and Teams drafting; templates remain available without a key.</p>
        <p>Always review generated text and the source badge before copying it. AI never silently changes a Jira work item, sends a Teams message, or becomes the source of truth.</p>
      </details>
      <details class="card help-section help-disclosure">
        <summary><span>Local data and privacy</span><span class="micro">what leaves this machine</span></summary>
        <p>Projects, work items, milestones, meeting notes, and uploads are stored locally in this workspace. The app is bound to your computer's loopback address and is not shared on the network.</p>
        <p>Only when you explicitly request an AI status or Teams draft is relevant project text sent to the configured provider. External-feed import never receives or stores screenshots; you control any separate ChatGPT upload and must follow your organization's data policy.</p>
      </details>
    </div>
    <details class="card help-section help-templates-card help-disclosure">
      <summary><span>Templates and records</span><span class="micro">consistency without extra process</span></summary>
      <p>Start new work items from the Delivery, Requirement, or Defect/Blocker template to prefill useful acceptance criteria. Templates are starting points, not generated facts: review and adapt them before saving.</p>
      <p>Use <strong>Import CSV</strong> in Work to preview a Jira export before adding it. Existing and repeated Jira keys are skipped, and imported items are not tracked for follow-up until you choose to track them.</p>
      <p>For externally transcribed screenshots, use <strong>Capture → Import ChatGPT feed</strong>. Copy the strict prompt, process screenshots only in an approved ChatGPT workspace, and bring back only the generated JSON or Markdown feed.</p>
      <button class="button button-small secondary js-copy-text" data-copy-key="${registerCopyPayload(EXTERNAL_FEED_PROMPT)}">Copy external-feed prompt</button>
      <p><strong>Workspace Data</strong> in Settings is a local records browser. It lets you filter, edit, delete, and export saved work items, milestones, transcripts, and meeting notes. It does not connect to Jira or send data anywhere.</p>
    </details>
  `;
}

function getManageItems() {
  const projectNames = Object.keys(projects);
  const allItems = [];

  projectNames.forEach(name => {
    const project = projects[name];
    if (!project) return;

    if (!manageTypeFilter || manageTypeFilter === 'story') {
      project.stories.forEach(story => {
        allItems.push({
          type: 'Story',
          project: name,
          id: story.id,
          title: story.summary,
          details: story.description || story.notes || '',
          meta: story.labels && story.labels.length ? story.labels.join(', ') : 'No labels',
          linked: story.timelineId ? (project.timeline.find(t => t.id === story.timelineId) || { title: 'Unknown' }).title : '',
          date: story.createdAt || '',
          raw: story
        });
      });
    }

    if (!manageTypeFilter || manageTypeFilter === 'timeline') {
      project.timeline.forEach(entry => {
        allItems.push({
          type: 'Timeline',
          project: name,
          id: entry.id,
          title: entry.title,
          details: entry.notes || '',
          meta: entry.status || 'No status',
          linked: project.stories.filter(s => s.timelineId === entry.id).map(s => s.summary).join(', '),
          date: entry.date || '',
          raw: entry
        });
      });
    }

    if (!manageTypeFilter || manageTypeFilter === 'transcript') {
      project.transcripts.forEach(transcript => {
        allItems.push({
          type: 'Transcript',
          project: name,
          id: transcript.id,
          title: transcript.title,
          details: transcript.notes || '',
          meta: transcript.type || 'No type',
          linked: '',
          date: transcript.date || transcript.uploadedAt || '',
          raw: transcript
        });
      });
    }

  });

  let filtered = allItems;
  if (manageProjectFilter) {
    filtered = filtered.filter(item => item.project === manageProjectFilter);
  }

  if (manageSearch.trim()) {
    const search = manageSearch.trim().toLowerCase();
    filtered = filtered.filter(item => {
      return [item.title, item.details, item.meta, item.project, item.linked]
        .some(value => value && value.toLowerCase().includes(search));
    });
  }

  const direction = manageSortDirection === 'asc' ? 1 : -1;
  filtered.sort((a, b) => {
    if (manageSortKey === 'date') {
      const aDate = a.date ? new Date(a.date).getTime() : 0;
      const bDate = b.date ? new Date(b.date).getTime() : 0;
      return (aDate - bDate) * direction;
    }
    if (manageSortKey === 'type') {
      return a.type.localeCompare(b.type) * direction;
    }
    if (manageSortKey === 'project') {
      return a.project.localeCompare(b.project) * direction;
    }
    return 0;
  });

  return filtered;
}

// Client-side mirror of the server's inferStoryStatus (kept in sync with server.js).
function inferStatusClient(story) {
  return inferStoryStatusShared(story);
}

function storyAssignee(story) {
  return String((story && (story.assignee || story.owner)) || '').trim();
}

function storySprint(story) {
  return String((story && story.sprint) || '').trim();
}

function storyLastCommentText(story) {
  return String((story && (story.lastComment || story.lastUpdate)) || '').trim();
}

function previewText(text, max = 120) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function sprintOptions() {
  const configured = Array.isArray(settings.sprintOptions) ? settings.sprintOptions : [];
  const inferred = [];
  Object.values(projects).forEach(project => {
    (project.stories || []).forEach(story => {
      const value = storySprint(story);
      if (value) inferred.push(value);
    });
  });
  return [...new Set(configured.concat(inferred).map(value => String(value || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function sprintSelectHtml(prefix, currentValue, extraAttrs = '') {
  const current = String(currentValue || '').trim();
  const options = sprintOptions();
  const values = current && !options.includes(current) ? [current, ...options] : options;
  return `
    <select id="${prefix}-sprint" ${extraAttrs}>
      <option value="">No sprint selected</option>
      ${values.map(value => `<option value="${escapeHtml(value)}" ${current === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
    </select>
    <div class="micro" style="margin-top:6px;text-transform:none;">Controlled from Settings → Sprint catalog.</div>`;
}

// --- Unified item tracking / "comment gone quiet" logic ---
// Stories and tickets are now one type: a Story that is `tracked` is the follow-up item.
// "Closed" is unified onto the inferred status: an item is closed when its status is Done.
function itemIsClosed(story) { return inferStatusClient(story) === 'Done'; }

// Whole days since an ISO timestamp; null/blank → null ("never").
function daysSince(iso) {
  return daysSinceTimestamp(iso);
}

// A tracked item "needs follow-up" when open (not Done) and its owner hasn't been contacted.
function itemNeedsFollowup(s) { return !!s.tracked && !itemIsClosed(s) && !s.contacted; }

// A tracked item "needs a comment nudge" when it's open AND its last comment is missing
// (never) or older than the configured staleness threshold. Only tracked items count.
function itemNeedsComment(s) {
  if (!s.tracked || itemIsClosed(s)) return false;
  const d = daysSince(s.lastCommentedAt);
  return d === null || d >= (settings.commentStaleDays || 7);
}

// Every tracked item across all projects → { project, story }. Tracking is cross-project.
function allTrackedItems() {
  const out = [];
  for (const name of Object.keys(projects)) {
    (projects[name].stories || []).forEach(s => { if (s.tracked) out.push({ project: name, story: s }); });
  }
  return out;
}

// Human-friendly last-comment age, e.g. "today", "3d ago", "never".
function lastCommentLabel(t) {
  const d = daysSince(t.lastCommentedAt);
  if (d === null) return 'never';
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  return `${d}d ago`;
}

function daysUntil(dateValue) {
  return daysUntilCalendarDate(dateValue);
}

function milestoneIsClosed(entry) {
  return /done|complete|completed|closed/i.test(String(entry?.status || ''));
}

function milestoneHealth(entry) {
  const until = daysUntil(entry?.date);
  if (until === null) return { label: 'No date', badge: 'notstarted', score: 1 };
  if (milestoneIsClosed(entry)) return { label: 'Complete', badge: 'done', score: 0 };
  if (until < 0) return { label: 'Overdue', badge: 'blocked', score: 4 };
  if (until <= 7) return { label: 'Due soon', badge: 'followup', score: 3 };
  if (until <= 21) return { label: 'Upcoming', badge: 'planned', score: 2 };
  return { label: 'On horizon', badge: 'count', score: 1 };
}

function statusPriority(item) {
  return (
    (inferStatusClient(item) === 'Blocked' ? 5 : 0) +
    (itemNeedsFollowup(item) ? 4 : 0) +
    (itemNeedsComment(item) ? 3 : 0) +
    (item.tracked ? 1 : 0)
  );
}

function latestStoryActivityTime(story) {
  const candidates = [
    story?.createdAt,
    story?.lastCommentedAt,
    ...(story?.updates || []).map(update => update.date)
  ].map(value => new Date(value || 0).getTime()).filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : null;
}

function latestStoryActivityLabel(story) {
  const time = latestStoryActivityTime(story);
  return time ? new Date(time).toLocaleDateString() : 'No dated activity';
}

function workItemAttentionProfile(story, project) {
  const linkedMilestone = project.timeline.find(entry => entry.id === story.timelineId);
  if (inferStatusClient(story) === 'Done') {
    return { badge: 'done', label: 'Stable', detail: 'Recorded as done' };
  }
  if (inferStatusClient(story) === 'Blocked') {
    return { badge: 'blocked', label: 'Blocked', detail: story.dependencies ? `Blocked by ${story.dependencies}` : (story.notes || 'Blocked work item') };
  }
  if (itemNeedsFollowup(story)) {
    return { badge: 'followup', label: 'Follow-up', detail: storyAssignee(story) ? `Assignee not contacted: ${storyAssignee(story)}` : 'Assignee not contacted' };
  }
  if (itemNeedsComment(story)) {
    return { badge: 'quiet', label: 'Quiet', detail: `No recent Jira comment · ${lastCommentLabel(story)}` };
  }
  if (!storyAssignee(story)) {
    return { badge: 'notstarted', label: 'Assignee gap', detail: 'No assignee recorded' };
  }
  if (!storySprint(story)) {
    return { badge: 'planned', label: 'Sprint gap', detail: 'No sprint recorded' };
  }
  if (!linkedMilestone) {
    return { badge: 'planned', label: 'Linkage gap', detail: 'Not linked to a milestone' };
  }
  if (!storyLastCommentText(story)) {
    return { badge: 'planned', label: 'Comment gap', detail: 'No last comment or PM note recorded' };
  }
  return { badge: 'inprogress', label: 'Active', detail: 'No immediate operating risk recorded' };
}

function openWorkItems(addNew = false) {
  if (!selectedProject) return;
  if (addNew) storyShowAddForm = true;
  activateTab('stories');
  storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
  if (addNew) {
    setTimeout(() => document.getElementById('story-summary')?.focus(), 40);
  }
}

function openMilestones() {
  activateTab('timeline');
}

function openFollowUp() {
  activateTab('tracking');
}

function openCapture(mode = '') {
  captureFocus = mode;
  if (mode === 'meeting') captureExpandedSections.add('meeting');
  activateTab('transcripts');
  if (mode === 'meeting') {
    setTimeout(() => document.getElementById('meeting-title')?.focus(), 40);
  }
}

function openStatusSummary() {
  activateTab('reports');
}

function openBriefings() {
  activateTab('briefings');
}

function openTeamsDraft() {
  activateTab('teams');
}

function openSettings() {
  activateTab('manage');
}

function openPortfolio() {
  activateTab('portfolio');
}

function renderSectionTabs(active, items) {
  return `<div class="section-tabs" role="navigation" aria-label="Workspace section">${items.map(item => `
    <button type="button" class="section-tab ${active === item.tab ? 'active' : ''}" data-onclick="activateTab('${item.tab}')">${escapeHtml(item.label)}</button>`).join('')}
  </div>`;
}

function renderWorkTabs(active) {
  return renderSectionTabs(active, [
    { tab: 'stories', label: 'Work items' },
    { tab: 'tracking', label: 'Follow-up' },
    { tab: 'timeline', label: 'Milestones' }
  ]);
}

function renderCommunicateTabs(active) {
  return renderSectionTabs(active, [
    { tab: 'briefings', label: 'Briefings' },
    { tab: 'reports', label: 'Legacy status summary' },
    { tab: 'teams', label: 'Legacy Teams draft' }
  ]);
}

function startEditProjectDesc() {
  editingProjectDesc = true;
  overviewPanel.innerHTML = renderDashboard(projects[selectedProject]);
}

function cancelEditProjectDesc() {
  editingProjectDesc = false;
  overviewPanel.innerHTML = renderDashboard(projects[selectedProject]);
}

async function saveProjectDesc() {
  const el = document.getElementById('edit-project-desc');
  const description = el ? el.value : '';
  await fetch('/api/project', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: selectedProject, description })
  });
  editingProjectDesc = false;
  await refreshProject();
}

function renderPortfolioPanel() {
  const names = Object.keys(projects);
  if (!names.length) return '<div class="card"><h4>Portfolio</h4><p>No projects yet. Add one from the sidebar.</p></div>';
  const totalStories = names.reduce((sum, name) => sum + ((projects[name].stories || []).length), 0);
  const totalBlocked = names.reduce((sum, name) => sum + (projects[name].stories || []).filter(s => inferStatusClient(s) === 'Blocked').length, 0);
  const totalTracked = names.reduce((sum, name) => sum + (projects[name].stories || []).filter(s => s.tracked).length, 0);
  const totalQuiet = names.reduce((sum, name) => sum + (projects[name].stories || []).filter(itemNeedsComment).length, 0);

  const cards = names.map(name => {
    const p = projects[name];
    const stories = p.stories || [];
    const tracked = stories.filter(s => s.tracked);
    const counts = {};
    stories.forEach(s => { const st = inferStatusClient(s); counts[st] = (counts[st] || 0) + 1; });
    const blocked = stories.filter(s => inferStatusClient(s) === 'Blocked').length;
    const followups = tracked.filter(itemNeedsFollowup).length;
    const quiet = tracked.filter(itemNeedsComment).length;
    const done = counts['Done'] || 0;
    const partial = (counts['In progress'] || 0) + (counts['Active'] || 0);
    const pct = stories.length ? Math.round(((done + 0.5 * partial) / stories.length) * 100) : 0;
    const barColor = pct >= 80 ? 'var(--st-done)' : 'var(--accent)';
    const healthBadge = blocked ? 'blocked' : (followups || quiet) ? 'followup' : 'done';
    const healthLabel = blocked ? 'At risk' : (followups || quiet) ? 'Needs steering' : 'On track';
    return `
      <div class="card portfolio-card" data-onclick="selectProject(${escapeHtml(JSON.stringify(name))})" title="Open ${escapeHtml(name)}">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <div style="min-width:0;">
            <h4 style="margin:0;">${escapeHtml(name)}</h4>
            <p style="margin:4px 0 0;">${escapeHtml(p.description || 'No description')}</p>
          </div>
          <span class="badge ${healthBadge}">${healthLabel}</span>
        </div>
        <div style="margin-top:14px;">
          <div style="display:flex;justify-content:space-between;" class="micro"><span>delivery progress</span><span>${pct}%</span></div>
          <div class="status-bar" style="margin-top:5px;"><span style="width:${pct}%;background:${barColor};"></span></div>
        </div>
        <div class="triage-field-strip compact" style="margin-top:12px;">
          <div class="triage-field"><span class="micro">Work Items</span><strong>${stories.length}</strong></div>
          <div class="triage-field ${blocked ? 'warn' : ''}"><span class="micro">Blocked</span><strong>${blocked}</strong></div>
          <div class="triage-field ${(followups || quiet) ? 'info' : ''}"><span class="micro">Follow-Up</span><strong>${followups + quiet}</strong></div>
          <div class="triage-field"><span class="micro">Quiet</span><strong>${quiet}</strong></div>
        </div>
      </div>`;
  }).join('');

  const attention = [];
  names.forEach(name => {
    (projects[name].stories || []).filter(s => inferStatusClient(s) === 'Blocked').forEach(s => attention.push({
      badge: 'blocked', label: s.summary, project: name, detail: s.dependencies ? `blocked · ${s.dependencies}` : (s.notes ? `blocked · ${s.notes}` : 'blocked')
    }));
    (projects[name].stories || []).filter(itemNeedsFollowup).forEach(s => attention.push({
      badge: 'followup', label: (s.jiraId ? s.jiraId + ' · ' : '') + (s.summary || ''), project: name, detail: storyAssignee(s) ? `assignee not contacted · ${storyAssignee(s)}` : 'assignee not contacted'
    }));
    (projects[name].stories || []).filter(itemNeedsComment).forEach(s => attention.push({
      badge: 'quiet', label: (s.jiraId ? s.jiraId + ' · ' : '') + (s.summary || ''), project: name, detail: `no comment · ${lastCommentLabel(s)}`
    }));
  });
  const badgeText = { blocked: 'BLOCKED', followup: 'FOLLOW-UP', quiet: 'QUIET' };
  const attentionHtml = attention.length ? attention.map((a, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 0;${i < attention.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}">
      <div style="display:flex;align-items:center;gap:10px;min-width:0;">
        <span class="badge ${a.badge}">${badgeText[a.badge]}</span>
        <strong>${escapeHtml(a.label)}</strong>
        <span class="mono" style="color:var(--muted-2);font-size:0.8rem;">${escapeHtml(a.project)}</span>
      </div>
      <span style="color:var(--muted);font-size:0.85rem;text-align:right;">${escapeHtml(a.detail)}</span>
    </div>`).join('') : '<p>Nothing flagged across projects.</p>';

  return `
    <div class="card hero-card screen-lead portfolio-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Portfolio control view</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <h3 style="margin:0 0 8px;">Cross-project operating picture</h3>
          <p style="margin:0;">Use this view to see which projects need intervention before you drill into a single queue. It favors risk and follow-up pressure over passive progress reporting.</p>
        </div>
      </div>
    </div>
    <div class="insight-strip operating-metrics portfolio-metrics" style="margin-bottom:14px;">
      <div class="insight-tile">
        <div class="micro">Projects</div>
        <div class="insight-number">${names.length}</div>
        <div class="insight-copy">${totalStories} work items across the portfolio</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Blocked</div>
        <div class="insight-number">${totalBlocked}</div>
        <div class="insight-copy">Issues already signaling delivery risk</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Tracked</div>
        <div class="insight-number">${totalTracked}</div>
        <div class="insight-copy">Items being actively watched across projects</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Quiet Threads</div>
        <div class="insight-number">${totalQuiet}</div>
        <div class="insight-copy">Follow-up threads that may need a nudge</div>
      </div>
    </div>
    <div class="portfolio-grid">${cards}</div>
    <div class="card portfolio-queue-card">
      <div class="section-heading">
        <h4>Portfolio Queue</h4>
        <span class="micro">what needs attention first</span>
      </div>
      <p style="margin:0 0 8px;">Blocked work items, tracked follow-up needs, and quiet comment threads across every project.</p>
      ${attentionHtml}
    </div>
  `;
}

const STATUS_ORDER = ['Done', 'In progress', 'Active', 'Blocked', 'Planned', 'Not started'];
const STATUS_COLOR = {
  Done: 'var(--st-done)', 'In progress': 'var(--st-inprogress)', Active: 'var(--st-inprogress)',
  Blocked: 'var(--st-blocked)', Planned: 'var(--st-planned)', 'Not started': 'var(--st-notstarted)'
};

function renderDashboard(project) {
  const stories = project.stories || [];
  const timeline = project.timeline || [];
  const transcripts = project.transcripts || [];
  const tracked = stories.filter(s => s.tracked);

  const counts = {};
  stories.forEach(s => { const st = inferStatusClient(s); counts[st] = (counts[st] || 0) + 1; });
  const total = stories.length || 1;
  const doneCount = counts['Done'] || 0;
  const partialCount = (counts['In progress'] || 0) + (counts['Active'] || 0);
  const blockedCount = counts['Blocked'] || 0;
  const pctComplete = stories.length ? Math.round(((doneCount + 0.5 * partialCount) / stories.length) * 100) : 0;

  const updates = [];
  stories.forEach(s => (s.updates || []).forEach(u => updates.push({ story: s.summary, ...u })));
  updates.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const dsuCount = transcripts.filter(t => (t.type || '').toLowerCase() === 'dsu').length;
  const followupCount = tracked.filter(itemNeedsFollowup).length;
  const quietCount = tracked.filter(itemNeedsComment).length;
  const milestoneCount = timeline.length;
  const overdueMilestones = timeline.filter(t => milestoneHealth(t).label === 'Overdue').length;
  const nearMilestones = timeline.filter(t => milestoneHealth(t).label === 'Due soon').length;
  const assigneeGapCount = stories.filter(story => inferStatusClient(story) !== 'Done' && !storyAssignee(story)).length;
  const sprintGapCount = stories.filter(story => inferStatusClient(story) !== 'Done' && !storySprint(story)).length;
  const commentGapCount = stories.filter(story => inferStatusClient(story) !== 'Done' && !storyLastCommentText(story)).length;
  const readiness = Math.min(100, Math.round(((updates.length * 12) + (milestoneCount * 7) + (doneCount * 10)) / Math.max(1, stories.length * 10) * 10));

  // Segmented status bar + legend
  const present = STATUS_ORDER.filter(st => counts[st]);
  const segBar = present.length
    ? `<div class="status-bar" style="height:22px;">${present.map(st => `<span style="width:${(counts[st] / total) * 100}%;background:${STATUS_COLOR[st]};" title="${st}: ${counts[st]}"></span>`).join('')}</div>`
    : '<p>No work items yet.</p>';
  const legend = present.map(st => `<span style="display:inline-flex;align-items:center;gap:6px;font-size:0.82rem;"><span style="width:11px;height:11px;border-radius:3px;background:${STATUS_COLOR[st]};"></span>${st} ${counts[st]}</span>`).join('');

  const milestones = timeline
    .slice()
    .sort((a, b) => milestoneHealth(b).score - milestoneHealth(a).score || new Date(a.date || '9999-12-31') - new Date(b.date || '9999-12-31'))
    .slice(0, 5);

  const recentHtml = updates.length ? updates.slice(0, 6).map((u, i) => {
    const src = (u.source || u.transcriptTitle || 'DSU').toString();
    const shortSrc = src.length > 20 ? src.slice(0, 19) + '…' : src;
    return `
    <div style="padding:11px 0;${i < Math.min(updates.length, 6) - 1 ? 'border-bottom:1px solid var(--border);' : ''}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
        <strong>${escapeHtml(u.story)}</strong>
        <span class="src-badge" title="Update source">${escapeHtml(shortSrc)}</span>
      </div>
      <p style="margin:4px 0 6px;">${escapeHtml(u.update || u.excerpt || '')}</p>
      <span class="micro">${escapeHtml(u.date || 'no date')}</span>
    </div>`;
  }).join('') : '<p>No captured updates yet. Upload a DSU or meeting transcript to populate this timeline.</p>';

  const attention = [];
  stories.filter(s => inferStatusClient(s) === 'Blocked').forEach(s => attention.push({
    kind: 'blocked',
    title: s.summary,
    detail: s.dependencies ? `Blocked by ${s.dependencies}` : (s.notes ? s.notes : 'Blocked work item')
  }));
  stories.filter(itemNeedsFollowup).forEach(s => attention.push({
    kind: 'followup',
    title: `${s.jiraId ? `${s.jiraId} · ` : ''}${s.summary}`,
    detail: storyAssignee(s) ? `Assignee not contacted: ${storyAssignee(s)}` : 'Assignee not contacted'
  }));
  stories.filter(itemNeedsComment).forEach(s => attention.push({
    kind: 'quiet',
    title: `${s.jiraId ? `${s.jiraId} · ` : ''}${s.summary}`,
    detail: `No recent Jira comment · ${lastCommentLabel(s)}`
  }));

  const attentionHtml = attention.length
    ? attention.slice(0, 6).map((item, index) => `
      <div style="padding:11px 0;${index < Math.min(attention.length, 6) - 1 ? 'border-bottom:1px solid var(--border);' : ''}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p style="margin:4px 0 0;">${escapeHtml(item.detail)}</p>
          </div>
          <span class="badge ${item.kind === 'blocked' ? 'blocked' : item.kind === 'followup' ? 'followup' : 'quiet'}">${item.kind === 'followup' ? 'FOLLOW-UP' : item.kind.toUpperCase()}</span>
        </div>
      </div>`).join('')
    : '<p>No blockers or stale follow-ups in this project.</p>';

  const milestoneHtml = milestones.length
    ? milestones.map((m, index) => `
      <div class="surface-row">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <div>
            <strong>${escapeHtml(m.title)}</strong>
            <p style="margin:4px 0 0;">${escapeHtml(m.notes || 'No notes yet.')}</p>
          </div>
          <div style="text-align:right;">
            <div class="micro">${escapeHtml(m.date || 'No date')}</div>
            ${m.status ? statusBadge(m.status) : ''}
            <div style="margin-top:6px;"><span class="badge ${milestoneHealth(m).badge}">${milestoneHealth(m).label}</span></div>
          </div>
        </div>
      </div>`).join('')
    : '<p>No milestones yet. Add project dates and checkpoints here.</p>';

  const focusItems = stories
    .slice()
    .sort((a, b) => {
      const latest = item => new Date((item.updates || [])[0]?.date || item.createdAt || 0).getTime();
      return statusPriority(b) - statusPriority(a) || latest(b) - latest(a);
    })
    .slice(0, 6);

  const focusHtml = focusItems.length
    ? focusItems.map((story, index) => `
      <div class="home-queue-card${index < focusItems.length - 1 ? ' with-divider' : ''}">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <div style="min-width:0;">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              ${story.jiraId ? `<span class="mono" style="color:var(--accent);font-size:0.78rem;">${escapeHtml(story.jiraId)}</span>` : ''}
              <strong>${escapeHtml(story.summary)}</strong>
              ${story.tracked ? '<span class="badge count">FOLLOW-UP</span>' : ''}
              ${statusBadge(inferStatusClient(story))}
            </div>
            <div class="triage-field-strip compact" style="margin-top:10px;">
              <div class="triage-field ${storyAssignee(story) ? '' : 'warn'}"><span class="micro">Assignee</span><strong>${escapeHtml(storyAssignee(story) || 'Unassigned')}</strong></div>
              <div class="triage-field ${storySprint(story) ? '' : 'warn'}"><span class="micro">Sprint</span><strong>${escapeHtml(storySprint(story) || 'Not set')}</strong></div>
              <div class="triage-field ${storyLastCommentText(story) ? '' : 'info'}"><span class="micro">Comment Date</span><strong>${escapeHtml(lastCommentLabel(story))}</strong></div>
              <div class="triage-field ${story.tracked ? '' : 'muted'}"><span class="micro">Follow-Up</span><strong>${story.tracked ? 'Tracked' : 'Optional'}</strong></div>
            </div>
            <p style="margin:10px 0 0;">${escapeHtml(previewText(storyLastCommentText(story) || story.notes || story.description || 'No notes yet.', 180))}</p>
          </div>
        </div>
      </div>`).join('')
    : '<p>No work items yet. Add the first Jira-backed work item to start using this project as your operating console.</p>';

  const todayQueueHtml = focusItems.length
    ? focusItems.slice(0, 3).map(story => `
      <div class="today-row">
        <div style="min-width:0;">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            ${story.jiraId ? `<span class="mono" style="color:var(--accent);font-size:0.76rem;">${escapeHtml(story.jiraId)}</span>` : ''}
            <strong>${escapeHtml(story.summary)}</strong>
            ${statusBadge(inferStatusClient(story))}
          </div>
          <div class="micro" style="margin-top:6px;text-transform:none;">${storyAssignee(story) ? `assignee ${escapeHtml(storyAssignee(story))} · ` : ''}${storySprint(story) ? `sprint ${escapeHtml(storySprint(story))} · ` : ''}comment ${escapeHtml(lastCommentLabel(story))}</div>
        </div>
        <span class="badge ${workItemAttentionProfile(story, project).badge}">${escapeHtml(workItemAttentionProfile(story, project).label)}</span>
      </div>`).join('')
    : '<p>No work items are queued yet.</p>';

  const descRow = editingProjectDesc ? `
    <textarea id="edit-project-desc" style="width:100%;min-height:52px;">${escapeHtml(project.description || '')}</textarea>
    <div style="margin-top:6px;display:flex;gap:8px;">
      <button class="button button-small" data-onclick="saveProjectDesc()">Save</button>
      <button class="button button-small secondary" data-onclick="cancelEditProjectDesc()">Cancel</button>
    </div>` : `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span style="color:var(--muted);">${escapeHtml(project.description || 'No description provided.')}</span>
      <button class="button button-small secondary" data-onclick="startEditProjectDesc()">Edit</button>
    </div>`;

  const topRiskSummary = attention.length
    ? `${attention.length} active project signal${attention.length === 1 ? '' : 's'}`
    : 'No immediate delivery signals';
  const nextPriority = attention[0] || (milestones[0] ? {
    kind: milestoneHealth(milestones[0]).badge,
    title: milestones[0].title,
    detail: `${milestoneHealth(milestones[0]).label}${milestones[0].date ? ` · ${milestones[0].date}` : ''}`
  } : null);
  const todayStamp = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const priorityTone = nextPriority?.kind === 'blocked' ? 'blocked' : nextPriority?.kind === 'followup' ? 'followup' : nextPriority?.kind === 'quiet' ? 'quiet' : 'planned';
  const priorityLabel = nextPriority?.kind === 'blocked' ? 'What needs you now · blocked'
    : nextPriority?.kind === 'followup' ? 'What needs you now · follow-up'
    : nextPriority?.kind === 'quiet' ? 'What needs you now · quiet thread'
    : 'What needs you now';

  return `
    <div class="dashboard-topline">
      <div>
        <div class="dashboard-project-line">${escapeHtml(selectedProject)} · example project</div>
        <h3 class="dashboard-screen-title">Today</h3>
        <div class="dashboard-screen-subtitle">What needs your attention today — ${escapeHtml(todayStamp)}</div>
      </div>
      <div class="hero-actions">
        <button class="button" data-onclick="openStatusSummary()">Open status summary</button>
        <button class="button secondary" data-onclick="openCapture()">Capture evidence</button>
        <button class="button secondary" data-onclick="openPortfolio()">Portfolio</button>
      </div>
    </div>
    <div class="attention-banner ${priorityTone}" style="margin-bottom:18px;">
      <div class="attention-banner-head">
        <div class="attention-banner-kicker">${priorityLabel}</div>
        <span class="attention-banner-count">${attention.length ? `${attention.length} active signal${attention.length === 1 ? '' : 's'}` : 'No critical items'}</span>
      </div>
      <div class="attention-banner-body">
        ${nextPriority ? `
          <div class="attention-banner-id-row">
            ${nextPriority.title.includes('·') ? `<span class="mono">${escapeHtml(nextPriority.title.split('·')[0].trim())}</span>` : ''}
            <span class="badge ${priorityTone}">${priorityTone === 'blocked' ? 'Blocked' : priorityTone === 'followup' ? 'Follow-up' : priorityTone === 'quiet' ? 'Quiet' : 'Next'}</span>
          </div>
          <h4>${escapeHtml(nextPriority.title)}</h4>
          <p>${escapeHtml(nextPriority.detail)}</p>` : '<p>No immediate blockers or stale signals are recorded.</p>'}
      </div>
    </div>
    <div class="priority-banner" style="margin-bottom:16px;">
      <div class="priority-panel">
        <div>
          <div class="micro" style="margin-bottom:8px;">Project workspace</div>
          <h3 style="margin:0 0 8px;font-size:1.7rem;letter-spacing:-0.03em;">${escapeHtml(selectedProject)}</h3>
          ${descRow}
        </div>
        <div class="priority-frame">
          <div class="today-queue">
            <div class="micro" style="margin-bottom:8px;">Today&apos;s queue</div>
            ${todayQueueHtml}
          </div>
          <div style="margin-top:12px;" class="hero-actions">
            <button class="button" data-onclick="openWorkItems()">Review queue</button>
            <button class="button secondary" data-onclick="openStatusSummary()">Draft summary</button>
            <button class="button secondary" data-onclick="openCapture()">Capture update</button>
          </div>
        </div>
      </div>
      <div class="priority-panel">
        <div class="priority-frame">
          <div class="micro" style="margin-bottom:8px;">Delivery signal</div>
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:8px;">
            <div>
              <div style="font-size:2rem;font-weight:700;line-height:1;letter-spacing:-0.04em;">${pctComplete}%</div>
              <div class="micro" style="text-transform:none;margin-top:6px;">${doneCount} done · ${partialCount} active · ${blockedCount} blocked</div>
            </div>
            <span class="badge ${blockedCount ? 'blocked' : pctComplete >= 70 ? 'done' : 'inprogress'}">${blockedCount ? 'At risk' : pctComplete >= 70 ? 'On track' : 'In motion'}</span>
          </div>
          ${segBar}
          <div style="margin-top:10px;display:flex;gap:12px;flex-wrap:wrap;">${legend}</div>
        </div>
        <div class="priority-frame">
          <div class="micro" style="margin-bottom:8px;">Draft readiness</div>
          <div style="font-size:1.55rem;font-weight:700;line-height:1;letter-spacing:-0.03em;">${readiness}%</div>
          <p style="margin-top:8px;">${updates.length} captured update${updates.length === 1 ? '' : 's'} · ${milestoneCount} milestone${milestoneCount === 1 ? '' : 's'} · ${dsuCount} DSU source${dsuCount === 1 ? '' : 's'}</p>
        </div>
      </div>
    </div>
    <div class="signal-grid">
      <div class="signal-card">
        <div class="micro">Blocked Work</div>
        <div class="signal-value">${blockedCount}</div>
        <p>Work items currently blocked and likely to slip without action.</p>
      </div>
      <div class="signal-card">
        <div class="micro">Follow-Up Risk</div>
        <div class="signal-value">${followupCount + quietCount}</div>
        <p>${followupCount} need contact · ${quietCount} quiet Jira threads.</p>
      </div>
      <div class="signal-card">
        <div class="micro">Evidence Gaps</div>
        <div class="signal-value">${assigneeGapCount + sprintGapCount + commentGapCount}</div>
        <p>${assigneeGapCount} assignee gaps · ${sprintGapCount} sprint gaps · ${commentGapCount} comment gaps.</p>
      </div>
    </div>
    <div class="section-grid" style="margin-top:14px;">
      <div class="card">
        <div class="section-heading">
          <h4>Milestone Outlook</h4>
          <span class="micro">schedule and pressure</span>
        </div>
        <p style="margin:0 0 10px;">Upcoming dates and milestone notes, with pressure surfaced before they surprise the queue.</p>
        <div class="micro" style="margin-bottom:8px;">Upcoming milestones</div>
        ${milestoneHtml}
      </div>
      <div class="card">
        <div class="section-heading">
          <h4>Attention Now</h4>
          <span class="micro">current risk signals</span>
        </div>
        <p style="margin:0 0 8px;">${escapeHtml(topRiskSummary)} across blocked work, follow-up needs, and quiet Jira threads.</p>
        ${attentionHtml}
      </div>
    </div>
    <div class="section-grid" style="margin-top:14px;">
      <div class="card">
        <div class="section-heading">
          <h4>Operating Queue</h4>
          <span class="micro">highest operational importance</span>
        </div>
        <p style="margin:0 0 8px;">These are the items most likely to shape your day, using the same field language as the queue pages.</p>
        ${focusHtml}
      </div>
      <div class="card">
        <div class="section-heading">
          <h4>Recent Changes</h4>
          <span class="micro">captured updates</span>
        </div>
        <p style="margin:0 0 8px;">The freshest recorded DSU and meeting evidence available for follow-up and reporting.</p>
        ${recentHtml}
      </div>
    </div>
    <div class="card" style="margin-top:14px;">
      <div class="micro" style="margin-bottom:8px;">Outputs</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <button class="button" data-onclick="openBriefings()">Open briefings</button>
        <button class="button secondary" data-onclick="openStatusSummary()">Open status summary</button>
        <button class="button secondary" data-onclick="openTeamsDraft()">Open Teams draft</button>
        <button class="button secondary" data-onclick="openSettings()">AI and workspace settings</button>
        <span class="micro">${updates.length} captured updates · ${dsuCount} DSU transcript${dsuCount === 1 ? '' : 's'} available for grounded drafting</span>
      </div>
    </div>
  `;
}

function teamsOwnersOf(project) {
  const stories = (project && project.stories) || [];
  return [...new Set(stories.map(s => storyAssignee(s)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function filteredTeamsStories(project) {
  const search = teamsSearch.trim().toLowerCase();
  return ((project && project.stories) || []).filter(story => {
    if (teamsAssigneeFilter !== 'all' && storyAssignee(story) !== teamsAssigneeFilter) return false;
    if (teamsStatusFilter !== 'all' && inferStatusClient(story) !== teamsStatusFilter) return false;
    if (teamsSprintFilter !== 'all' && storySprint(story) !== teamsSprintFilter) return false;
    if (!search) return true;
    return [story.jiraId, story.summary, storyAssignee(story), storySprint(story), inferStatusClient(story), storyLastCommentText(story)]
      .some(value => String(value || '').toLowerCase().includes(search));
  });
}

function renderTeamsPanel(project) {
  const stories = (project && project.stories) || [];
  const visibleStories = filteredTeamsStories(project);
  const owners = teamsOwnersOf(project);
  const sprintOptions = [...new Set(stories.map(story => storySprint(story)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const selCount = teamsSelectedStories.size;
  const trackedCount = stories.filter(s => s.tracked).length;
  const blockedCount = stories.filter(s => inferStatusClient(s) === 'Blocked').length;

  const ownerChips = owners.map((o, i) => {
    const owned = stories.filter(s => storyAssignee(s) === o);
    const active = teamsAssigneeFilter === o;
    return `<button type="button" class="button button-small ${active ? '' : 'secondary'}" style="${active ? 'background:var(--success);border-color:var(--success);color:#fff;' : ''}" data-onclick="setTeamsAssigneeFilter(${i})">${escapeHtml(o)} (${owned.length})</button>`;
  }).join(' ');

  const itemRows = visibleStories.length ? visibleStories.map(s => `
    <label class="check-row">
      <input type="checkbox" ${teamsSelectedStories.has(s.id) ? 'checked' : ''} data-onchange="toggleTeamsStory('${s.id}')" />
      <span>${s.jiraId ? `<strong class="mono" style="color:var(--accent);">${escapeHtml(s.jiraId)}</strong> ` : ''}${escapeHtml(s.summary)} <small style="color:var(--muted);">(${escapeHtml(inferStatusClient(s))}${storyAssignee(s) ? ' · ' + escapeHtml(storyAssignee(s)) : ''}${storySprint(s) ? ' · ' + escapeHtml(storySprint(s)) : ''})</small>${s.tracked ? ' <span class="badge count" style="font-size:0.6rem;">TRACKED</span>' : ''}</span>
    </label>`).join('') : '<small>No work items match the current filters.</small>';

  return `
    <div class="card hero-card screen-lead teams-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Leadership-ready message draft</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <h3 style="margin:0 0 8px;">Teams draft workspace</h3>
          <p style="margin:0;">Build a message from selected work items, then edit it before sending. This screen is meant to turn operational detail into a clean stakeholder update without losing grounding.</p>
        </div>
      </div>
    </div>
    ${renderCommunicateTabs('teams')}
    <div class="insight-strip operating-metrics" style="margin-bottom:14px;">
      <div class="insight-tile">
        <div class="micro">Selected</div>
        <div class="insight-number">${selCount}</div>
        <div class="insight-copy">Items currently included in the message</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Assignees</div>
        <div class="insight-number">${owners.length}</div>
        <div class="insight-copy">Unique assignees represented in this project</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Tracked</div>
        <div class="insight-number">${trackedCount}</div>
        <div class="insight-copy">Items already being watched in follow-up</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Blocked</div>
        <div class="insight-number">${blockedCount}</div>
        <div class="insight-copy">Items likely to shape the narrative most</div>
      </div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="section-heading">
          <h4>Compose</h4>
          <span class="micro">pick the story set</span>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>Recipient</label><input value="${escapeHtml(teamsRecipient)}" placeholder="Ana" data-oninput="setTeamsField('recipient', this.value)" /></div>
          <div class="form-row"><label>Subject / board (optional)</label><input value="${escapeHtml(teamsSubject)}" placeholder="D&amp;A Intake &amp; Triage Board" data-oninput="setTeamsField('subject', this.value)" /></div>
        </div>
        <div class="teams-filter-row">
          <select data-onchange="setTeamsFilter('status', this.value)">
            <option value="all" ${teamsStatusFilter === 'all' ? 'selected' : ''}>All statuses</option>
            ${['Blocked', 'In progress', 'Active', 'Planned', 'Done', 'Not started'].map(status => `<option value="${status}" ${teamsStatusFilter === status ? 'selected' : ''}>${status}</option>`).join('')}
          </select>
          <select data-onchange="setTeamsFilter('sprint', this.value)">
            <option value="all" ${teamsSprintFilter === 'all' ? 'selected' : ''}>All sprints</option>
            ${sprintOptions.map(sprint => `<option value="${escapeHtml(sprint)}" ${teamsSprintFilter === sprint ? 'selected' : ''}>${escapeHtml(sprint)}</option>`).join('')}
          </select>
          <input id="teams-search" value="${escapeHtml(teamsSearch)}" placeholder="Search Jira or story" data-oninput="setTeamsFilter('search', this.value)" />
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:12px 0 4px;">
          ${ownerChips}
          <button class="button button-small secondary" data-onclick="setTeamsFilter('assignee', 'all')">All assignees</button>
          <button class="button button-small secondary" data-onclick="selectAllTeams()">Select shown</button>
          <button class="button button-small secondary" data-onclick="clearTeamsSelection()">Clear</button>
          <span class="micro">${selCount} selected</span>
        </div>
        <div class="micro" style="margin:12px 0 6px;">Work items · ${visibleStories.length} shown of ${stories.length}</div>
        ${itemRows}
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <button class="button" data-onclick="generateTeamsUpdate('heuristic')" ${teamsLoading ? 'disabled' : ''}>${teamsLoading && teamsLoadingMode === 'heuristic' ? 'Generating grounded draft…' : 'Generate grounded draft'}</button>
            <button class="button secondary" data-onclick="generateTeamsUpdate('ai')" ${teamsLoading || !aiProvider ? 'disabled' : ''}>${teamsLoading && teamsLoadingMode === 'ai' ? 'Creating AI draft…' : 'Create AI draft'}</button>
            ${teamsMessage ? `<span class="src-badge ${teamsSource.startsWith('ai') ? 'ai' : ''}">source: ${escapeHtml(teamsSource)}</span>` : ''}
          </div>
          ${teamsMessage ? `<button class="button secondary" data-onclick="copyTeamsMessage()">Copy</button>` : ''}
        </div>
        ${teamsError ? `<div class="card" style="background:var(--danger-bg);color:var(--danger);border-color:var(--danger-border);margin-bottom:14px;"><strong>Error:</strong> ${escapeHtml(teamsError)}</div>` : ''}
        <div class="card">
          <div class="section-heading">
            <h4>Draft Preview</h4>
            <span class="micro">editable output</span>
          </div>
          ${teamsMessage
            ? `<textarea style="width:100%;min-height:260px;" data-oninput="setTeamsField('message', this.value)">${escapeHtml(teamsMessage)}</textarea>`
            : '<p>Select work items on the left, then click “Generate Teams draft”. The draft is grounded only in the selected items and is editable before you copy.</p>'}
        </div>
        <div class="note" style="margin-top:14px;">Grounded draft uses selected items only. AI drafts are optional, reviewable, and available only when a provider key is configured.</div>
      </div>
    </div>
  `;
}

function setTeamsField(field, value) {
  if (field === 'recipient') teamsRecipient = value;
  else if (field === 'subject') teamsSubject = value;
  else if (field === 'message') teamsMessage = value;
}

function toggleTeamsStory(id) {
  if (teamsSelectedStories.has(id)) teamsSelectedStories.delete(id); else teamsSelectedStories.add(id);
  teamsPanel.innerHTML = renderTeamsPanel(projects[selectedProject]);
}

function setTeamsAssigneeFilter(index) {
  const project = projects[selectedProject];
  const owner = teamsOwnersOf(project)[index];
  if (owner === undefined) return;
  teamsAssigneeFilter = teamsAssigneeFilter === owner ? 'all' : owner;
  teamsPanel.innerHTML = renderTeamsPanel(project);
}

function setTeamsFilter(field, value) {
  if (field === 'assignee') teamsAssigneeFilter = value;
  else if (field === 'status') teamsStatusFilter = value;
  else if (field === 'sprint') teamsSprintFilter = value;
  else if (field === 'search') teamsSearch = value;
  teamsPanel.innerHTML = renderTeamsPanel(projects[selectedProject]);
  if (field === 'search') {
    const search = document.getElementById('teams-search');
    if (search) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
  }
}

function selectAllTeams() {
  const project = projects[selectedProject];
  filteredTeamsStories(project).forEach(s => teamsSelectedStories.add(s.id));
  teamsPanel.innerHTML = renderTeamsPanel(project);
}

function clearTeamsSelection() {
  teamsSelectedStories.clear();
  teamsPanel.innerHTML = renderTeamsPanel(projects[selectedProject]);
}

async function generateTeamsUpdate(mode = 'heuristic') {
  if (!selectedProject) return;
  if (teamsSelectedStories.size === 0) {
    alert('Select at least one item.');
    return;
  }
  teamsLoading = true;
  teamsLoadingMode = mode;
  teamsError = '';
  teamsMessage = '';
  teamsPanel.innerHTML = renderTeamsPanel(projects[selectedProject]);
  try {
    const response = await fetch('/api/project/teams-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: selectedProject,
        recipient: teamsRecipient,
        subject: teamsSubject,
        storyIds: [...teamsSelectedStories],
        mode
      })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unable to generate update' }));
      throw new Error(error.error || 'Unable to generate update');
    }
    const result = await response.json();
    teamsMessage = result.message || '';
    teamsSource = result.source || '';
  } catch (error) {
    teamsError = error.message;
  } finally {
    teamsLoading = false;
    teamsLoadingMode = '';
    teamsPanel.innerHTML = renderTeamsPanel(projects[selectedProject]);
  }
}

function copyTeamsMessage() {
  if (!teamsMessage) { alert('Nothing to copy yet.'); return; }
  copyText(teamsMessage);
}

// Tracking is CROSS-PROJECT: it lists every tracked item (Story with tracked=true) across
// all projects. Items carry the former ticket fields (jiraId, owner, contacted, comment…).
function renderTrackingPanel() {
  const projectNames = Object.keys(projects);
  const threshold = settings.commentStaleDays || 7;
  const arg = v => escapeHtml(JSON.stringify(v)); // safe onclick/onchange args (double-quoted attrs)

  const items = allTrackedItems(); // [{ project, story }]
  const quiet = items.filter(x => itemNeedsComment(x.story));
  const quietCount = quiet.length;
  const quietOwners = [...new Set(quiet.map(x => storyAssignee(x.story)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const search = trackingSearch.trim().toLowerCase();

  const filtered = items.filter(x => {
    const s = x.story;
    if (trackingFilter === 'followup' && !itemNeedsFollowup(s)) return false;
    if (trackingFilter === 'needscomment' && !itemNeedsComment(s)) return false;
    if (trackingProjectFilter !== 'all' && x.project !== trackingProjectFilter) return false;
    if (search) {
      const hay = [s.jiraId, s.summary, storyAssignee(s), storySprint(s), inferStatusClient(s), storyLastCommentText(s), x.project].map(v => String(v || '').toLowerCase()).join(' ');
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  const priority = (s) => (itemNeedsFollowup(s) ? 2 : 0) + (itemNeedsComment(s) ? 1 : 0);
  const sorted = filtered.slice().sort((a, b) => priority(b.story) - priority(a.story));

  const cardHtml = (x) => {
    const s = x.story, p = x.project;
    const flag = itemNeedsFollowup(s);
    const q = itemNeedsComment(s);
    const expanded = trackingExpanded.has(`${p}::${s.id}`);
    const signal = flag ? { badge: 'followup', label: 'Needs follow-up', detail: storyAssignee(s) ? `Assignee not contacted: ${storyAssignee(s)}` : 'Assignee not contacted' }
      : q ? { badge: 'quiet', label: 'Quiet thread', detail: `No comment in ${threshold}+ days · ${lastCommentLabel(s)}` }
      : { badge: statusBadgeClass(inferStatusClient(s)), label: inferStatusClient(s), detail: storyLastCommentText(s) || 'No recent Jira comment recorded' };
    const linkedMilestone = (projects[p].timeline || []).find(entry => entry.id === s.timelineId);
    const notePreview = previewText(storyLastCommentText(s), 160) || signal.detail;
    return `
      <div class="console-row followup-row">
        <div class="console-row-top">
          <div style="min-width:0;flex:1;">
            <div class="console-row-meta">
              <span class="mono" style="font-size:0.74rem;color:var(--muted-2);">${escapeHtml(p)}</span>
              ${s.jiraId ? `<span class="mono" style="font-size:0.74rem;color:var(--accent);">${escapeHtml(s.jiraId)}</span>` : ''}
              ${statusBadge(inferStatusClient(s))}
              <span class="badge ${signal.badge}">${escapeHtml(signal.label)}</span>
            </div>
            <h4 style="margin:8px 0 4px;">${escapeHtml(s.summary || 'Untitled work item')}</h4>
            <p>${escapeHtml(signal.detail)}</p>
          </div>
          <div class="console-actions">
            <button class="button button-small secondary" data-onclick="toggleTrackingExpanded(${arg(p)}, ${arg(s.id)})">${expanded ? 'Collapse' : 'Expand'}</button>
            <button class="button button-small secondary" data-onclick="logItemComment(${arg(p)}, ${arg(s.id)})">✓ Comment today</button>
            <button class="button button-small danger" data-onclick="untrackItem(${arg(p)}, ${arg(s.id)})" title="Stop tracking (keeps the work item)">Untrack</button>
          </div>
        </div>
        <div class="triage-field-strip compact">
          <div class="triage-field ${storyAssignee(s) ? '' : 'warn'}"><span class="micro">Assignee</span><strong>${escapeHtml(storyAssignee(s) || 'Unassigned')}</strong></div>
          <div class="triage-field ${storySprint(s) ? '' : 'warn'}"><span class="micro">Sprint</span><strong>${escapeHtml(storySprint(s) || 'Not set')}</strong></div>
          <div class="triage-field ${q ? 'info' : ''}"><span class="micro">Comment Date</span><strong>${escapeHtml(lastCommentLabel(s))}</strong></div>
          <div class="triage-field ${linkedMilestone ? '' : 'info'}"><span class="micro">Milestone</span><strong>${escapeHtml(linkedMilestone ? linkedMilestone.title : 'Not linked')}</strong></div>
        </div>
        <div class="console-snippet">
          <span class="micro">Last comment / PM note</span>
          <p>${escapeHtml(notePreview)}</p>
        </div>
        ${expanded ? `
          <div class="console-expanded">
            <div class="tracking-edit-grid">
              <div><label>Assignee</label><input value="${escapeHtml(storyAssignee(s))}" data-onchange="updateItemField(${arg(p)}, ${arg(s.id)}, ${arg('assignee')}, this.value)" /></div>
              <div><label>Sprint</label>${sprintSelectHtml(`tracking-${s.id}`, storySprint(s), `data-onchange="updateItemField(${arg(p)}, ${arg(s.id)}, ${arg('sprint')}, this.value)"`)}</div>
              <div><label>Last comment / PM note</label><input value="${escapeHtml(storyLastCommentText(s))}" data-onchange="updateItemLastComment(${arg(p)}, ${arg(s.id)}, this)" /></div>
            </div>
            <div class="console-flag-row">
              <label style="display:flex;align-items:center;gap:6px;font-weight:normal;"><input type="checkbox" ${s.contacted ? 'checked' : ''} data-onchange="setItemFlag(${arg(p)}, ${arg(s.id)}, ${arg('contacted')}, this.checked)" /> Contacted</label>
              <label style="display:flex;align-items:center;gap:6px;font-weight:normal;"><input type="checkbox" ${s.commentAdded ? 'checked' : ''} data-onchange="setItemFlag(${arg(p)}, ${arg(s.id)}, ${arg('commentAdded')}, this.checked)" /> Comment logged</label>
            </div>
          </div>` : ''}
      </div>`;
  };

  const cards = sorted.length
    ? `<div class="console-list">${sorted.map(cardHtml).join('')}</div>`
    : `<div class="card"><p>${items.length ? 'No tracked items match the filter.' : 'Nothing tracked yet — use “+ New tracked item”, or flip “Track” on a work item.'}</p></div>`;

  const quietBanner = (quietCount && !trackingCommentBannerDismissed) ? `
    <div class="banner">
      <div>
        <strong style="color:var(--info);">${quietCount} tracked item${quietCount === 1 ? '' : 's'} ${quietCount === 1 ? 'has' : 'have'} gone quiet</strong> <span style="color:var(--muted);">— no comment logged in over ${threshold} days — nudge the assignee${quietCount === 1 ? '' : 's'} for a status update${quietOwners.length ? `: <strong>${escapeHtml(quietOwners.join(', '))}</strong>` : ''}.</span>
        ${trackingFilter !== 'needscomment' ? ` <a href="#" data-onclick="setTrackingFilter('needscomment');return false;">Show only these</a>` : ''}
      </div>
      <button class="button button-small secondary" data-onclick="dismissCommentBanner()">Dismiss</button>
    </div>` : '';

  // Always-on per-owner attention chips across all tracked items.
  const owners = [...new Set(items.map(x => storyAssignee(x.story)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const ownerChips = owners.map(o => {
    const its = items.filter(x => storyAssignee(x.story) === o);
    const fu = its.filter(x => itemNeedsFollowup(x.story)).length;
    const nc = its.filter(x => itemNeedsComment(x.story)).length;
    const cls = fu ? 'warn' : (nc ? 'info' : '');
    const label = fu ? `${fu} follow-up` : (nc ? `${nc} quiet` : '0');
    return `<span class="owner-chip ${cls}" style="cursor:pointer;" data-onclick="setTrackingSearch(${escapeHtml(JSON.stringify(o))})" title="Filter to ${escapeHtml(o)}">${escapeHtml(o)} · ${label}</span>`;
  }).join('');

  const pill = (val, label) => `<button class="pill ${trackingFilter === val ? 'active' : ''}" data-onclick="setTrackingFilter('${val}')">${label}</button>`;

  // Work items not yet tracked, for the "track an existing item" picker (value = JSON [project, id]).
  const untracked = [];
  projectNames.forEach(n => (projects[n].stories || []).forEach(s => { if (!s.tracked) untracked.push({ project: n, story: s }); }));

  const addForm = trackingShowAddForm ? `
      <div class="card" style="border-color:var(--accent);box-shadow:0 0 0 3px rgba(58,111,214,0.12);margin-bottom:14px;">
        <div style="margin-bottom:12px;"><strong style="color:var(--accent);">New tracked item</strong> <span class="micro" style="text-transform:none;">— a work item flagged for follow-up</span></div>
        <div class="form-grid">
          <div class="field-row">
            <div><label>Project</label><select id="new-item-project">${projectNames.map(n => `<option ${(n === (selectedProject || projectNames[0])) ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></div>
            <div><label>Work item type</label><select id="new-item-type">${itemTypeOptions('Story')}</select><div class="micro form-help">Story is the common default. Change it when this is an Epic, Feature, Task, Bug, or another type.</div></div>
          </div>
          <div class="form-row"><label>Title</label><input id="new-item-title" placeholder="Short title" /></div>
          <div class="form-row"><label>Description</label><textarea id="new-item-description"></textarea></div>
          <div class="form-row"><label>Labels (sets status: done / in-progress / blocked / planned)</label><input id="new-item-labels" /></div>
          ${trackingFieldsHtml('new-item', { tracked: true }, false)}
          <div style="display:flex;gap:8px;">
            <button class="button" data-onclick="createTrackedItem()">Add tracked item</button>
            <button class="button secondary" data-onclick="toggleAddTrackedForm()">Cancel</button>
          </div>
        </div>
      </div>` : '';

  return `
    ${quietBanner}
    <div class="card hero-card screen-lead followup-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Follow-up command queue</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <h3 style="margin:0 0 8px;">Cross-project follow-up</h3>
          <p style="margin:0;">Use this queue to manage assignee contact, stale Jira threads, and the work items most likely to go quiet if left alone.</p>
        </div>
        <div class="hero-actions">
          <button class="button" data-onclick="toggleAddTrackedForm()">+ New tracked item</button>
          <button class="button secondary" data-onclick="exportTrackingCSV()">Export CSV</button>
        </div>
      </div>
    </div>
    ${renderWorkTabs('tracking')}
    <div class="signal-grid operating-metrics followup-metrics">
      <div class="signal-card">
        <div class="micro">Tracked Items</div>
        <div class="signal-value">${items.length}</div>
        <p>${sorted.length} currently visible in this view.</p>
      </div>
      <div class="signal-card">
        <div class="micro">Needs Follow-Up</div>
        <div class="signal-value">${items.filter(x => itemNeedsFollowup(x.story)).length}</div>
        <p>Open tracked work whose assignee has not been contacted.</p>
      </div>
      <div class="signal-card">
        <div class="micro">Quiet Threads</div>
        <div class="signal-value">${quietCount}</div>
        <p>No Jira comment in at least ${threshold} days.</p>
      </div>
    </div>
    <div class="card followup-workbench">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
        <div class="pill-group">
          ${pill('all', 'All')}
          ${pill('followup', 'Needs follow-up')}
          ${pill('needscomment', 'Needs comment')}
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <span class="mono" style="font-size:0.8rem;color:var(--muted);">Quiet after <input type="number" min="1" max="365" value="${threshold}" data-onchange="setCommentStaleDays(this.value)" style="width:54px;display:inline-block;padding:5px 7px;" /> days</span>
          <span class="micro">${sorted.length} of ${items.length}</span>
        </div>
      </div>
      ${owners.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${ownerChips}</div>` : ''}
      ${addForm}
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
        <select data-onchange="setTrackingProjectFilter(this.value)" style="width:auto;">
          <option value="all" ${trackingProjectFilter === 'all' ? 'selected' : ''}>All projects</option>
          ${projectNames.map(n => `<option value="${escapeHtml(n)}" ${trackingProjectFilter === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
        </select>
        <input id="tracking-search" value="${escapeHtml(trackingSearch)}" placeholder="Search project, jira, summary, assignee, sprint…" data-oninput="setTrackingSearch(this.value)" style="flex:1;min-width:180px;" />
        ${untracked.length ? `<select data-onchange="if(this.value)trackExistingStory(this.value)" style="width:auto;max-width:260px;">
          <option value="">+ Track an existing work item…</option>
          ${untracked.map(x => `<option value="${escapeHtml(JSON.stringify([x.project, x.story.id]))}">${escapeHtml(x.project)} — ${escapeHtml(x.story.summary)}</option>`).join('')}
        </select>` : ''}
      </div>
      ${cards}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
        <div class="note warn">amber = needs follow-up · open (status ≠ Done) AND Contacted? false</div>
        <div class="note info">indigo = comment gone quiet · lastCommentedAt null / older than threshold — independent rule</div>
      </div>
    </div>
  `;
}

function toggleAddTrackedForm() {
  trackingShowAddForm = !trackingShowAddForm;
  trackingPanel.innerHTML = renderTrackingPanel();
  if (trackingShowAddForm) { const el = document.getElementById('new-item-title'); if (el) el.focus(); }
}

async function createTrackedItem() {
  const g = id => document.getElementById(id);
  const project = g('new-item-project') ? g('new-item-project').value : selectedProject;
  const title = g('new-item-title') ? g('new-item-title').value.trim() : '';
  const itemType = g('new-item-type') ? g('new-item-type').value : '';
  const tf = readTrackingFields('new-item'); // jiraId, owner, contacted, commentAdded, lastUpdate
  if (!project || !itemType) { alert('Pick a project and work item type.'); return; }
  if (!title && !tf.jiraId) { alert('Enter at least a title or a Jira id.'); return; }
  await fetch('/api/project/story', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project,
      itemType,
      summary: title || tf.jiraId,
      description: g('new-item-description') ? g('new-item-description').value.trim() : '',
      labels: g('new-item-labels') ? g('new-item-labels').value.trim() : '',
      tracked: true,
      ...tf
    })
  });
  trackingShowAddForm = false;
  await refreshProject();
}

async function trackExistingStory(value) {
  let project, id;
  try { [project, id] = JSON.parse(value); } catch (_) { return; }
  await fetch('/api/project/story', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, id, tracked: true })
  });
  await refreshProject();
}

async function untrackItem(project, id) {
  await fetch('/api/project/story', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, id, tracked: false })
  });
  await refreshProject();
}

// Text-field edits: update in-memory + PUT, no re-render (keeps typing focus).
async function updateItemField(project, id, field, value) {
  const p = projects[project];
  if (p) { const s = (p.stories || []).find(x => x.id === id); if (s) s[field] = value; }
  await fetch('/api/project/story', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, id, [field]: value })
  });
}

// Checkbox flags (contacted / commentAdded): PUT then refresh so highlights recompute.
async function setItemFlag(project, id, field, checked) {
  await fetch('/api/project/story', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, id, [field]: checked })
  });
  await refreshProject();
}

async function updateItemLastComment(project, id, el) {
  let value = el.value.trim();
  if (value && !/^\d{1,2}\/\d{1,2}/.test(value)) {
    const now = new Date();
    value = `${now.getMonth() + 1}/${now.getDate()} - ${value}`;
    el.value = value;
  }
  await updateItemField(project, id, 'lastComment', value);
}

// "✓ today" — record a comment now (server stamps lastCommentedAt, sets commentAdded).
async function logItemComment(project, id) {
  await fetch('/api/project/story', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, id, logComment: true })
  });
  await refreshProject();
}

async function setCommentStaleDays(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1 || n > 365) { alert('Enter a number of days between 1 and 365.'); return; }
  try {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentStaleDays: n })
    });
    if (!response.ok) throw new Error('save failed');
    settings = await response.json();
  } catch (error) {
    console.warn('Failed to save staleness threshold:', error.message);
  }
  trackingPanel.innerHTML = renderTrackingPanel();
  portfolioPanel.innerHTML = renderPortfolioPanel();
  renderNavBadges();
}

function dismissCommentBanner() {
  trackingCommentBannerDismissed = true;
  trackingPanel.innerHTML = renderTrackingPanel();
}

function exportTrackingCSV() {
  const items = allTrackedItems();
  if (!items.length) { alert('No tracked items to export.'); return; }
  const header = ['Project', 'Jira', 'Item Type', 'Summary', 'Status', 'Assignee', 'Sprint', 'Contacted?', 'Comment Added?', 'Comment Date', 'Needs Comment?', 'Last Comment'];
  const rows = items.map(({ project, story: s }) => [project, s.jiraId, itemTypeOrUnknown(s.itemType), s.summary, inferStatusClient(s), storyAssignee(s), storySprint(s), s.contacted ? 'Yes' : 'No', s.commentAdded ? 'Yes' : 'No', lastCommentLabel(s), itemNeedsComment(s) ? 'Yes' : 'No', storyLastCommentText(s)]);
  const csv = [header].concat(rows)
    .map(r => r.map(escapeCsvCell).join(','))
    .join('\n');
  downloadFile('tracking-all-projects.csv', csv, 'text/csv');
}

function setTrackingFilter(value) {
  trackingFilter = value;
  trackingPanel.innerHTML = renderTrackingPanel();
}

function setTrackingProjectFilter(value) {
  trackingProjectFilter = value;
  trackingPanel.innerHTML = renderTrackingPanel();
}

function setTrackingSearch(value) {
  trackingSearch = value;
  trackingPanel.innerHTML = renderTrackingPanel();
  const el = document.getElementById('tracking-search');
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

async function briefingRequest(url, options = {}) {
  const response = await fetch(url, options);
  const result = await response.json().catch(() => ({ error: 'Unable to read Briefings response' }));
  if (!response.ok) throw new Error(result.error || 'Briefings request failed');
  return result;
}

function briefingDate(value) {
  const timestamp = new Date(value || '').getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : 'Not recorded';
}

function activeBriefing() {
  return briefings.find(item => item && item.id === briefingActiveId) || null;
}

function briefingChangeText(change) {
  if (change.type === 'work_item_added') return `${change.jiraId || change.workItemId || 'Work item'} was added: ${change.after || 'No summary recorded'}.`;
  if (change.type === 'work_item_removed') return `${change.jiraId || change.workItemId || 'Work item'} was removed: ${change.before || 'No summary recorded'}.`;
  return `${change.jiraId || change.workItemId || 'Work item'} ${change.field} changed from ${change.before || 'not recorded'} to ${change.after || 'not recorded'}.`;
}

function briefingChangeCategory(change) {
  if (change.type === 'work_item_removed') return 'risk';
  if (['status', 'lastUpdate', 'lastCommentedAt'].includes(change.field) || change.type === 'work_item_added') return 'progress';
  return 'other';
}

function factInput(fact) {
  return {
    category: fact.category,
    projectName: fact.projectName,
    deliveryProjectId: fact.deliveryProjectId || '',
    deliveryProjectName: fact.deliveryProjectName || '',
    workItemId: fact.workItemId || '',
    jiraId: fact.jiraId || '',
    sourceKind: fact.sourceKind || '',
    sourceTitle: fact.sourceTitle || '',
    sourceDate: fact.sourceDate || '',
    speaker: fact.speaker || '',
    attributionRequired: !!fact.attributionRequired,
    workstream: fact.workstream || '',
    origin: fact.origin,
    sourceEvidenceIds: Array.isArray(fact.sourceEvidenceIds) ? fact.sourceEvidenceIds : [],
    detectedText: fact.detectedText || '',
    editedText: fact.editedText || '',
    included: !!fact.included
  };
}

function hydrateBriefingDraft(briefing) {
  if (!briefing || briefingHydratedId === briefing.id) return;
  briefingHydratedId = briefing.id;
  briefingChangeSelections = new Set();
  briefingChangeEdits = new Map();
  briefingEvidenceSelections = new Set();
  briefingEvidenceEdits = new Map();
  briefingEvidencePage = 0;
  briefingManualFacts = [];
  briefingPreservedFacts = [];
  const changeIds = new Set((briefing.detectedChanges || []).map(change => change.id));
  (briefing.facts || []).forEach(fact => {
    if (fact.origin === 'manual_pm_input') {
      briefingManualFacts.push({ ...factInput(fact), localId: fact.id || `manual-${Date.now()}-${briefingManualFacts.length}` });
      return;
    }
    if (fact.origin === 'evidence' && (fact.sourceEvidenceIds || []).length === 1) {
      const evidenceId = fact.sourceEvidenceIds[0];
      if (fact.included) briefingEvidenceSelections.add(evidenceId);
      briefingEvidenceEdits.set(evidenceId, { category: fact.category, editedText: fact.editedText });
      return;
    }
    const changeId = fact.origin === 'work_item_change' && (fact.sourceEvidenceIds || []).find(id => changeIds.has(id));
    if (changeId) {
      if (fact.included) briefingChangeSelections.add(changeId);
      briefingChangeEdits.set(changeId, { category: fact.category, editedText: fact.editedText });
      return;
    }
    briefingPreservedFacts.push(factInput(fact));
  });
}

async function loadBriefingEvidenceCandidates(briefing) {
  briefingEvidenceCandidates = [];
  briefingEvidenceLoadedId = '';
  if (!briefing || briefing.status !== 'draft') return;
  const briefingId = briefing.id;
  const candidates = await briefingRequest(`/api/briefings/${encodeURIComponent(briefingId)}/evidence-candidates`);
  if (activeBriefing()?.id !== briefingId) return;
  briefingEvidenceCandidates = Array.isArray(candidates) ? candidates : [];
  briefingEvidenceLoadedId = briefingId;
}

async function fetchBriefings() {
  briefingLoading = true;
  briefingError = '';
  if (briefingsPanel) briefingsPanel.innerHTML = renderBriefingsPanel();
  try {
    [briefingStreams, briefings] = await Promise.all([
      briefingRequest('/api/briefing-streams'),
      briefingRequest('/api/briefings')
    ]);
    if (!briefings.some(item => item.id === briefingActiveId)) {
      const open = briefings.find(item => item.status !== 'communicated');
      briefingActiveId = open ? open.id : '';
      briefingHydratedId = '';
    }
    hydrateBriefingDraft(activeBriefing());
    await loadBriefingEvidenceCandidates(activeBriefing());
  } catch (error) {
    briefingError = error.message;
  } finally {
    briefingLoading = false;
    if (briefingsPanel) briefingsPanel.innerHTML = renderBriefingsPanel();
  }
}

function setBriefingView(value) {
  if (!['prepare', 'drafts', 'history'].includes(value)) return;
  briefingView = value;
  briefingsPanel.innerHTML = renderBriefingsPanel();
}

async function createBriefingStreamFromForm() {
  const name = document.getElementById('briefing-stream-name')?.value.trim() || '';
  const projectNames = [...document.querySelectorAll('.briefing-stream-project:checked')].map(input => input.value);
  const deliveryProjectIds = [...document.querySelectorAll('.briefing-stream-delivery-project:checked')]
    .filter(input => projectNames.includes(input.dataset.workspace))
    .map(input => input.value);
  const preferredFormats = [...document.querySelectorAll('.briefing-stream-format:checked')].map(input => input.value);
  const defaultSections = [...document.querySelectorAll('.briefing-stream-section:checked')].map(input => input.value);
  const audienceProfile = document.getElementById('briefing-stream-audience')?.value || 'mixed';
  if (!name || !projectNames.length || !preferredFormats.length || !defaultSections.length) {
    briefingError = 'Enter a stream name and select at least one project, format, and section.';
    briefingsPanel.innerHTML = renderBriefingsPanel();
    return;
  }
  briefingLoading = true;
  briefingError = '';
  briefingsPanel.innerHTML = renderBriefingsPanel();
  try {
    await briefingRequest('/api/briefing-streams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, projectNames, deliveryProjectIds, audienceProfile, preferredFormats, defaultSections })
    });
    briefingFeedback = 'Briefing stream created.';
    await fetchBriefings();
  } catch (error) {
    briefingLoading = false;
    briefingError = error.message;
    briefingsPanel.innerHTML = renderBriefingsPanel();
  }
}

async function deleteBriefingStream(id) {
  const stream = briefingStreams.find(item => item.id === id);
  if (!stream || !confirm(`Delete briefing stream "${stream.name}"?`)) return;
  try {
    await briefingRequest(`/api/briefing-streams/${encodeURIComponent(id)}`, { method: 'DELETE' });
    briefingFeedback = 'Briefing stream deleted.';
    await fetchBriefings();
  } catch (error) {
    briefingError = error.message;
    briefingsPanel.innerHTML = renderBriefingsPanel();
  }
}

async function startBriefing(streamId) {
  briefingLoading = true;
  briefingError = '';
  briefingsPanel.innerHTML = renderBriefingsPanel();
  try {
    const briefing = await briefingRequest('/api/briefings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ streamId })
    });
    briefingActiveId = briefing.id;
    briefingHydratedId = '';
    briefingView = 'drafts';
    briefingFeedback = 'Draft briefing created from the current workspace snapshot.';
    await fetchBriefings();
  } catch (error) {
    briefingLoading = false;
    briefingError = error.message;
    briefingsPanel.innerHTML = renderBriefingsPanel();
  }
}

async function openBriefing(id) {
  const briefing = briefings.find(item => item.id === id);
  if (!briefing) return;
  briefingActiveId = id;
  briefingHydratedId = '';
  hydrateBriefingDraft(briefing);
  briefingView = briefing.status === 'communicated' ? 'history' : 'drafts';
  briefingsPanel.innerHTML = renderBriefingsPanel();
  try {
    await loadBriefingEvidenceCandidates(briefing);
    briefingsPanel.innerHTML = renderBriefingsPanel();
  } catch (error) {
    briefingError = error.message;
    briefingsPanel.innerHTML = renderBriefingsPanel();
  }
}

function setBriefingChangeIncluded(id, included) {
  if (included) briefingChangeSelections.add(id);
  else briefingChangeSelections.delete(id);
  briefingsPanel.innerHTML = renderBriefingsPanel();
}

function setBriefingChangeField(id, field, value) {
  const current = briefingChangeEdits.get(id) || {};
  briefingChangeEdits.set(id, { ...current, [field]: value });
}

function setBriefingEvidenceIncluded(id, included) {
  if (included) briefingEvidenceSelections.add(id);
  else briefingEvidenceSelections.delete(id);
  briefingsPanel.innerHTML = renderBriefingsPanel();
}

function setBriefingEvidenceField(id, field, value) {
  if (!['category', 'editedText'].includes(field)) return;
  const current = briefingEvidenceEdits.get(id) || {};
  briefingEvidenceEdits.set(id, { ...current, [field]: value });
}

function setBriefingEvidencePage(page) {
  const pageCount = Math.max(1, Math.ceil(briefingEvidenceCandidates.length / 8));
  briefingEvidencePage = Math.max(0, Math.min(Number(page) || 0, pageCount - 1));
  briefingsPanel.innerHTML = renderBriefingsPanel();
}

function addManualBriefingFact() {
  let scope = {};
  try { scope = JSON.parse(document.getElementById('briefing-manual-scope')?.value || '{}'); } catch { scope = {}; }
  const projectName = typeof scope.projectName === 'string' ? scope.projectName : '';
  const deliveryProjectId = typeof scope.deliveryProjectId === 'string' ? scope.deliveryProjectId : '';
  const briefing = activeBriefing();
  const deliveryProject = (briefing?.currentSnapshot?.projects || [])
    .find(workspace => workspace.name === projectName)?.deliveryProjects?.find(project => project.id === deliveryProjectId);
  const category = document.getElementById('briefing-manual-category')?.value || 'other';
  const editedText = document.getElementById('briefing-manual-text')?.value.trim() || '';
  if (!projectName || !editedText) {
    briefingError = 'Choose a project and enter the Manual PM input.';
    briefingsPanel.innerHTML = renderBriefingsPanel();
    return;
  }
  briefingManualFacts.push({
    localId: `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    category, projectName, deliveryProjectId, deliveryProjectName: deliveryProject?.name || '', workItemId: '', jiraId: '', origin: 'manual_pm_input',
    sourceEvidenceIds: [], detectedText: '', editedText, included: true,
    sourceKind: '', sourceTitle: '', sourceDate: '', speaker: '', attributionRequired: false, workstream: ''
  });
  briefingError = '';
  briefingsPanel.innerHTML = renderBriefingsPanel();
}

function removeBriefingManualFact(localId) {
  briefingManualFacts = briefingManualFacts.filter(fact => fact.localId !== localId);
  briefingsPanel.innerHTML = renderBriefingsPanel();
}

function draftBriefingFacts(briefing) {
  const evidenceFacts = briefingEvidenceCandidates.filter(candidate => briefingEvidenceSelections.has(candidate.id)).map(candidate => {
    const edit = briefingEvidenceEdits.get(candidate.id) || {};
    return {
      category: edit.category || candidate.category, projectName: candidate.projectName,
      deliveryProjectId: candidate.deliveryProjectId || '', deliveryProjectName: candidate.deliveryProjectName || '',
      workItemId: candidate.workItemId || '', jiraId: candidate.jiraId || '', origin: 'evidence',
      sourceEvidenceIds: [candidate.id], detectedText: candidate.exactExcerpt,
      editedText: String(edit.editedText || candidate.suggestedText || candidate.exactExcerpt).trim(), included: true,
      sourceKind: candidate.sourceKind || '', sourceTitle: candidate.sourceTitle || '', sourceDate: candidate.sourceDate || '', speaker: candidate.speaker || '', attributionRequired: !!candidate.attributionRequired, workstream: candidate.workstream || ''
    };
  });
  const changeFacts = (briefing.detectedChanges || []).filter(change => briefingChangeSelections.has(change.id)).map(change => {
    const edit = briefingChangeEdits.get(change.id) || {};
    const detectedText = briefingChangeText(change);
    return {
      category: edit.category || briefingChangeCategory(change), projectName: change.projectName,
      deliveryProjectId: change.deliveryProjectId || '', deliveryProjectName: change.deliveryProjectName || '',
      workItemId: change.workItemId || '', jiraId: change.jiraId || '', origin: 'work_item_change',
      sourceEvidenceIds: [change.id], detectedText, editedText: String(edit.editedText || detectedText).trim(), included: true,
      sourceKind: 'work_item_change', sourceTitle: 'Workspace snapshot comparison', sourceDate: briefing.currentSnapshot?.capturedAt || '', speaker: '', attributionRequired: false, workstream: ''
    };
  });
  return [...briefingPreservedFacts, ...evidenceFacts, ...changeFacts, ...briefingManualFacts.map(factInput)];
}

async function saveBriefingFacts(showFeedback = true) {
  const briefing = activeBriefing();
  if (!briefing || briefing.status !== 'draft') return false;
  try {
    const updated = await briefingRequest(`/api/briefings/${encodeURIComponent(briefing.id)}/facts`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facts: draftBriefingFacts(briefing) })
    });
    const index = briefings.findIndex(item => item.id === updated.id);
    if (index >= 0) briefings[index] = updated;
    briefingHydratedId = '';
    hydrateBriefingDraft(updated);
    if (showFeedback) briefingFeedback = 'Briefing facts saved.';
    briefingError = '';
    briefingsPanel.innerHTML = renderBriefingsPanel();
    return true;
  } catch (error) {
    briefingError = error.message;
    briefingsPanel.innerHTML = renderBriefingsPanel();
    return false;
  }
}

async function finalizeActiveBriefing() {
  const briefing = activeBriefing();
  if (!briefing || briefing.status !== 'draft') return;
  if (!draftBriefingFacts(briefing).some(fact => fact.included)) {
    briefingError = briefing.comparisonBriefingId
      ? 'Select at least one accepted evidence item or detected change, or add Manual PM input before finalizing.'
      : 'Select accepted evidence or add Manual PM input to establish the first communicated baseline.';
    briefingsPanel.innerHTML = renderBriefingsPanel();
    return;
  }
  if (!await saveBriefingFacts(false)) return;
  try {
    await briefingRequest(`/api/briefings/${encodeURIComponent(briefing.id)}/finalize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    briefingFeedback = 'Briefing finalized. Its facts and snapshot are now frozen.';
    await fetchBriefings();
  } catch (error) {
    briefingError = error.message;
    briefingsPanel.innerHTML = renderBriefingsPanel();
  }
}

async function communicateActiveBriefing() {
  const briefing = activeBriefing();
  if (!briefing || briefing.status !== 'finalized') return;
  if (!confirm('Mark this briefing communicated? This advances the comparison baseline for this stream.')) return;
  try {
    await briefingRequest(`/api/briefings/${encodeURIComponent(briefing.id)}/communicate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    briefingView = 'history';
    briefingFeedback = 'Briefing marked communicated. The stream baseline advanced.';
    await fetchBriefings();
  } catch (error) {
    briefingError = error.message;
    briefingsPanel.innerHTML = renderBriefingsPanel();
  }
}

async function generateBriefingOutputs() {
  const briefing = activeBriefing();
  if (!briefing || briefing.status !== 'finalized') return;
  try {
    await briefingRequest(`/api/briefings/${encodeURIComponent(briefing.id)}/outputs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    briefingFeedback = 'Configured communication outputs refreshed from the finalized fact set.';
    await fetchBriefings();
  } catch (error) {
    briefingError = error.message;
    briefingsPanel.innerHTML = renderBriefingsPanel();
  }
}

function briefingStatusBadge(status) {
  const css = status === 'communicated' ? 'done' : status === 'finalized' ? 'inprogress' : 'planned';
  return `<span class="badge ${css}">${escapeHtml(status)}</span>`;
}

function renderBriefingPrepare() {
  const projectNames = Object.keys(projects);
  const streamScopeLabel = stream => {
    const scopes = (stream.deliveryProjectIds || []).flatMap(id => projectNames.flatMap(name => {
      const item = deliveryProjectsForWorkspace(projects[name], true).find(project => project.id === id);
      return item ? [item.name] : [];
    }));
    return scopes.length ? scopes.join(' · ') : `${stream.projectNames.join(' · ')} · whole PM workspace`;
  };
  const cards = briefingStreams.length ? briefingStreams.map(stream => {
    const history = briefings.filter(item => item.streamId === stream.id);
    const open = history.find(item => item.status !== 'communicated');
    return `<article class="card briefing-stream-card">
      <div class="section-heading"><h4>${escapeHtml(stream.name)}</h4><span class="micro">${(stream.deliveryProjectIds || []).length > 1 || stream.projectNames.length > 1 ? 'portfolio' : 'project'} stream</span></div>
      <p>${escapeHtml(streamScopeLabel(stream))}</p>
      <div class="briefing-meta"><span>${escapeHtml(stream.audienceProfile.replace('_', ' '))}</span><span>${stream.preferredFormats.map(escapeHtml).join(', ')}</span><span>${history.length} briefing${history.length === 1 ? '' : 's'}</span></div>
      <div class="briefing-actions">
        ${open ? `<button class="button" data-onclick="openBriefing('${open.id}')">Open ${escapeHtml(open.status)}</button>` : `<button class="button" data-onclick="startBriefing('${stream.id}')">Start briefing</button>`}
        <button class="button secondary danger" data-onclick="deleteBriefingStream('${stream.id}')" ${history.length ? 'disabled title="History must be retained"' : ''}>Delete stream</button>
      </div>
    </article>`;
  }).join('') : '<div class="card"><p>No briefing streams yet. Create one to establish an audience-specific communication baseline.</p></div>';

  return `<div class="briefing-layout">
    <section class="card briefing-create-card">
      <div class="section-heading"><h4>Create briefing stream</h4><span class="micro">reusable scope + audience</span></div>
      <div class="form-grid">
        <div class="form-row"><label>Name</label><input id="briefing-stream-name" maxlength="160" placeholder="Portfolio leadership briefing" /></div>
        <div class="form-row"><label>Audience</label><select id="briefing-stream-audience"><option value="manager">Manager</option><option value="product_owner">Product owner</option><option value="mixed" selected>Mixed audience</option></select></div>
      </div>
      <fieldset class="briefing-options"><legend>PM workspaces</legend>${projectNames.map(name => `<label><input class="briefing-stream-project" type="checkbox" value="${escapeHtml(name)}" ${name === selectedProject ? 'checked' : ''} /> ${escapeHtml(name)}</label>`).join('')}</fieldset>
      <fieldset class="briefing-options"><legend>Projects / Jira Epics <span class="micro">optional; none means the whole selected PM workspace</span></legend>${projectNames.map(name => {
        const scopes = deliveryProjectsForWorkspace(projects[name]);
        return scopes.length ? `<div class="briefing-scope-group"><strong>${escapeHtml(name)}</strong>${scopes.map(item => `<label><input class="briefing-stream-delivery-project" data-workspace="${escapeHtml(name)}" type="checkbox" value="${escapeHtml(item.id)}" /> ${escapeHtml(item.name)}${item.jiraEpicKey ? ` · ${escapeHtml(item.jiraEpicKey)}` : ''}</label>`).join('')}</div>` : '';
      }).join('') || '<p class="note">No Projects have been defined yet. This stream will use the whole selected PM workspace.</p>'}</fieldset>
      <fieldset class="briefing-options"><legend>Output formats</legend>${['teams', 'email', 'confluence'].map(format => `<label><input class="briefing-stream-format" type="checkbox" value="${format}" checked /> ${escapeHtml(format)}</label>`).join('')}</fieldset>
      <fieldset class="briefing-options"><legend>Default sections</legend>${['progress', 'risk', 'blocker', 'decision', 'milestone', 'dependency', 'next_action', 'open_question'].map((section, index) => `<label><input class="briefing-stream-section" type="checkbox" value="${section}" ${index < 5 ? 'checked' : ''} /> ${escapeHtml(section.replace('_', ' '))}</label>`).join('')}</fieldset>
      <button class="button" data-onclick="createBriefingStreamFromForm()">Create stream</button>
    </section>
    <section class="briefing-stream-list">${cards}</section>
  </div>`;
}

function renderBriefingFactList(briefing) {
  const included = (briefing.facts || []).filter(fact => fact.included);
  return included.length ? `<div class="briefing-fact-list">${included.map(fact => `<div class="surface-row">
    <div class="briefing-fact-heading"><span class="badge count">${escapeHtml(fact.category)}</span><span class="micro">${escapeHtml(fact.origin === 'manual_pm_input' ? 'Manual PM input' : fact.origin.replaceAll('_', ' '))}</span></div>
    <strong>${escapeHtml(fact.deliveryProjectName || fact.projectName)}</strong><p>${escapeHtml(fact.editedText)}</p>${fact.sourceKind ? `<div class="micro">${escapeHtml(fact.sourceKind.replaceAll('_', ' '))}${fact.sourceDate ? ` · ${escapeHtml(fact.sourceDate)}` : ''}${fact.speaker ? ` · ${escapeHtml(fact.speaker)}` : ''}</div>` : ''}
  </div>`).join('')}</div>` : '<p>No included facts are saved.</p>';
}

function renderBriefingOutputs(briefing) {
  const outputs = briefing.outputs || [];
  if (!outputs.length) return '<div class="note">No outputs generated yet. Generate them from this frozen fact set before copying a communication.</div>';
  return `<div class="briefing-output-list">${outputs.map(output => {
    const copyText = output.subject ? `Subject: ${output.subject}\n\n${output.content}` : output.content;
    return `<article class="briefing-output-card"><div class="section-heading"><div><h4>${escapeHtml(output.format === 'confluence' ? 'Confluence-ready' : output.format)}</h4>${output.subject ? `<div class="micro">Subject: ${escapeHtml(output.subject)}</div>` : ''}</div><button class="button button-small secondary js-copy-text" data-copy-key="${registerCopyPayload(copyText)}" data-copy-message="Copied ${escapeHtml(output.format)} briefing.">Copy</button></div><pre>${escapeHtml(output.content)}</pre><div class="micro">${(output.sourceFactIds || []).length} finalized facts · generated ${escapeHtml(briefingDate(output.generatedAt))}</div></article>`;
  }).join('')}</div>`;
}

function renderBriefingEvidenceCandidates(briefing) {
  if (briefingEvidenceLoadedId !== briefing.id) return '<div class="note">Loading accepted evidence…</div>';
  if (!briefingEvidenceCandidates.length) return '<div class="note">No accepted evidence is available for this stream yet. Review evidence in Capture, or add clearly labeled Manual PM input.</div>';
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(briefingEvidenceCandidates.length / pageSize));
  const page = Math.min(briefingEvidencePage, pageCount - 1);
  const visible = briefingEvidenceCandidates.slice(page * pageSize, (page + 1) * pageSize);
  const categories = ['progress', 'risk', 'blocker', 'decision', 'milestone', 'dependency', 'next_action', 'open_question', 'other'];
  const rows = visible.map(candidate => {
    const selected = briefingEvidenceSelections.has(candidate.id);
    const edit = briefingEvidenceEdits.get(candidate.id) || {};
    const category = edit.category || candidate.category;
    const text = edit.editedText || candidate.suggestedText || candidate.exactExcerpt;
    const idArg = escapeHtml(JSON.stringify(candidate.id));
    return `<div class="briefing-evidence-row ${selected ? 'selected' : ''}">
      <label class="briefing-change-toggle"><input type="checkbox" ${selected ? 'checked' : ''} data-onchange="setBriefingEvidenceIncluded(${idArg}, this.checked)" /> Include</label>
      <div class="briefing-change-content">
        <div class="briefing-fact-heading"><strong>${escapeHtml(candidate.jiraId || candidate.workItemId || candidate.deliveryProjectName || candidate.projectName)}</strong><span class="badge count">${escapeHtml((candidate.sourceKind || 'accepted evidence').replaceAll('_', ' '))}</span><span class="micro">${escapeHtml(candidate.evidenceCategory.replaceAll('_', ' '))}</span></div>
        <blockquote>${escapeHtml(candidate.exactExcerpt)}</blockquote>
        <div class="micro briefing-before-after">${escapeHtml(candidate.sourceTitle)}${candidate.sourceType ? ` · ${escapeHtml(candidate.sourceType)}` : ''}${candidate.sourceDate ? ` · ${escapeHtml(candidate.sourceDate)}` : ''}${candidate.speaker ? ` · ${escapeHtml(candidate.speaker)}` : ''} · ${escapeHtml(candidate.deliveryProjectName || candidate.projectName)}</div>
        <div class="field-row"><div><label>Category</label><select data-onchange="setBriefingEvidenceField(${idArg}, 'category', this.value)">${categories.map(item => `<option value="${item}" ${item === category ? 'selected' : ''}>${escapeHtml(item.replace('_', ' '))}</option>`).join('')}</select></div></div>
        <label>Briefing language</label><textarea maxlength="2000" data-oninput="setBriefingEvidenceField(${idArg}, 'editedText', this.value)">${escapeHtml(text)}</textarea>
      </div>
    </div>`;
  }).join('');
  return `<div class="briefing-evidence-list">${rows}</div>
    <div class="briefing-evidence-pagination"><button class="button button-small secondary" data-onclick="setBriefingEvidencePage(${page - 1})" ${page === 0 ? 'disabled' : ''}>Previous</button><span class="micro">Page ${page + 1} of ${pageCount} · ${briefingEvidenceCandidates.length} accepted findings · ${briefingEvidenceSelections.size} selected</span><button class="button button-small secondary" data-onclick="setBriefingEvidencePage(${page + 1})" ${page + 1 >= pageCount ? 'disabled' : ''}>Next</button></div>`;
}

function renderBriefingDraftDetail(briefing) {
  const stream = briefingStreams.find(item => item.id === briefing.streamId);
  const isDraft = briefing.status === 'draft';
  const changes = briefing.detectedChanges || [];
  const changeRows = changes.length ? changes.map(change => {
    const selected = briefingChangeSelections.has(change.id);
    const edit = briefingChangeEdits.get(change.id) || {};
    const text = edit.editedText || briefingChangeText(change);
    const category = edit.category || briefingChangeCategory(change);
    return `<div class="briefing-change-row ${selected ? 'selected' : ''}">
      <label class="briefing-change-toggle"><input type="checkbox" ${selected ? 'checked' : ''} data-onchange="setBriefingChangeIncluded('${change.id}', this.checked)" /> Include</label>
      <div class="briefing-change-content"><div class="briefing-fact-heading"><strong>${escapeHtml(change.jiraId || change.workItemId || change.projectName)}</strong><span class="micro">${escapeHtml(change.type.replaceAll('_', ' '))}${change.field ? ` · ${escapeHtml(change.field)}` : ''}</span></div>
      <div class="field-row"><div><label>Category</label><select data-onchange="setBriefingChangeField('${change.id}', 'category', this.value)">${['progress', 'risk', 'blocker', 'decision', 'milestone', 'dependency', 'next_action', 'open_question', 'other'].map(item => `<option value="${item}" ${item === category ? 'selected' : ''}>${escapeHtml(item.replace('_', ' '))}</option>`).join('')}</select></div></div>
      <label>Briefing language</label><textarea maxlength="2000" data-oninput="setBriefingChangeField('${change.id}', 'editedText', this.value)">${escapeHtml(text)}</textarea>
      <div class="micro briefing-before-after">Before: ${escapeHtml(change.before || 'not recorded')} · After: ${escapeHtml(change.after || 'not recorded')}</div></div>
    </div>`;
  }).join('') : `<div class="note">This stream has no communicated baseline yet, so Priorena is not claiming that current inventory is a change. Select accepted evidence above or add clearly labeled Manual PM input for the first briefing.</div>`;

  const manualRows = briefingManualFacts.length ? briefingManualFacts.map(fact => `<div class="surface-row briefing-manual-row"><div><span class="badge count">Manual PM input</span> <strong>${escapeHtml(fact.deliveryProjectName || fact.projectName)}</strong><p>${escapeHtml(fact.editedText)}</p></div><button class="button button-small danger" data-onclick="removeBriefingManualFact('${fact.localId}')">Remove</button></div>`).join('') : '<p>No Manual PM input added.</p>';
  const manualScopeOptions = (briefing.currentSnapshot?.projects || []).flatMap(workspace => [
    ...((briefing.deliveryProjectIds || []).length ? [] : [`<option value="${escapeHtml(JSON.stringify({ projectName: workspace.name, deliveryProjectId: '' }))}">${escapeHtml(workspace.name)} · workspace level</option>`]),
    ...(workspace.deliveryProjects || []).map(project => `<option value="${escapeHtml(JSON.stringify({ projectName: workspace.name, deliveryProjectId: project.id }))}">${escapeHtml(project.name)}${project.jiraEpicKey ? ` · ${escapeHtml(project.jiraEpicKey)}` : ''}</option>`)
  ]).join('');
  const includedFactCount = isDraft ? draftBriefingFacts(briefing).filter(fact => fact.included).length : 0;
  const hasIncludedFacts = includedFactCount > 0;
  const firstBriefingGuide = isDraft && !briefing.comparisonBriefingId ? `<div class="briefing-baseline-guide">
    <div><span class="briefing-step done">1</span><div><strong>Snapshot captured</strong><p>Current work-item state is frozen as the starting comparison point.</p></div></div>
    <div><span class="briefing-step ${hasIncludedFacts ? 'done' : ''}">2</span><div><strong>Choose the first briefing facts</strong><p>Select reviewed evidence below, or enter a bounded statement and click Add Manual PM input.</p></div></div>
    <div><span class="briefing-step">3</span><div><strong>Finalize, generate, then communicate</strong><p>Finalization freezes the facts. Only Mark communicated establishes the baseline for future change detection.</p></div></div>
  </div>` : '';

  return `<section class="card briefing-detail-card">
    <div class="section-heading"><div><h4>${escapeHtml(stream?.name || 'Briefing')}</h4><div class="micro">Snapshot ${escapeHtml(briefingDate(briefing.currentSnapshot?.capturedAt))}</div></div>${briefingStatusBadge(briefing.status)}</div>
    <div class="briefing-meta"><span>${briefing.projectNames.map(escapeHtml).join(' · ')}</span><span>${escapeHtml(briefing.audienceProfile.replace('_', ' '))}</span><span>${briefing.comparisonBriefingId ? 'Compared with last communicated briefing' : 'First briefing · no baseline'}</span></div>
    ${isDraft ? `${firstBriefingGuide}<div class="briefing-editor-section"><div class="section-heading"><h4>Accepted evidence</h4><span class="micro">reviewed in Capture · none selected by default</span></div>${renderBriefingEvidenceCandidates(briefing)}</div><div class="briefing-editor-section"><div class="section-heading"><h4>Detected changes</h4><span class="micro">${changes.length} explainable change${changes.length === 1 ? '' : 's'} · none selected by default</span></div>${changeRows}</div>
      <div class="briefing-editor-section"><div class="section-heading"><h4>Manual PM input</h4><span class="micro">always labeled separately</span></div>${manualRows}
        <div class="briefing-manual-form"><select id="briefing-manual-scope">${manualScopeOptions}</select><select id="briefing-manual-category">${['progress', 'risk', 'blocker', 'decision', 'milestone', 'dependency', 'next_action', 'open_question', 'other'].map(item => `<option value="${item}">${escapeHtml(item.replace('_', ' '))}</option>`).join('')}</select><textarea id="briefing-manual-text" maxlength="2000" placeholder="Add bounded context or leadership framing that is not claimed as source evidence."></textarea><button class="button secondary" data-onclick="addManualBriefingFact()">Add Manual PM input</button></div>
      </div>
      <div class="briefing-actions sticky-actions"><button class="button secondary" data-onclick="saveBriefingFacts()">Save facts</button><button class="button" data-onclick="finalizeActiveBriefing()" ${hasIncludedFacts ? '' : 'disabled title="Add or select at least one fact first"'}>Finalize briefing</button><span class="micro">${hasIncludedFacts ? `${includedFactCount} fact${includedFactCount === 1 ? '' : 's'} ready to freeze` : 'Add or select at least one fact to continue'}</span></div>` : `${renderBriefingFactList(briefing)}<div class="briefing-editor-section"><div class="section-heading"><h4>Communication outputs</h4><span class="micro">same finalized fact set · deterministic</span></div>${renderBriefingOutputs(briefing)}</div>${briefing.status === 'finalized' ? `<div class="briefing-actions"><button class="button secondary" data-onclick="generateBriefingOutputs()">${(briefing.outputs || []).length ? 'Refresh outputs' : 'Generate outputs'}</button><button class="button" data-onclick="communicateActiveBriefing()">Mark communicated</button><span class="micro">Only Mark communicated advances the stream baseline.</span></div>` : ''}`}
  </section>`;
}

function renderBriefingDrafts() {
  const open = briefings.filter(item => item.status !== 'communicated').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const briefing = activeBriefing() && activeBriefing().status !== 'communicated' ? activeBriefing() : open[0];
  if (briefing && briefing.id !== briefingActiveId) {
    briefingActiveId = briefing.id;
    briefingHydratedId = '';
    hydrateBriefingDraft(briefing);
  }
  const list = open.length ? open.map(item => {
    const stream = briefingStreams.find(candidate => candidate.id === item.streamId);
    return `<button class="briefing-list-button ${briefing?.id === item.id ? 'active' : ''}" data-onclick="openBriefing('${item.id}')"><strong>${escapeHtml(stream?.name || 'Briefing')}</strong><span>${escapeHtml(item.status)} · ${escapeHtml(briefingDate(item.createdAt))}</span></button>`;
  }).join('') : '<p>No draft or finalized briefings. Start one from Prepare.</p>';
  return `<div class="briefing-workspace"><aside class="card briefing-draft-list"><div class="section-heading"><h4>Open briefings</h4><span class="micro">${open.length}</span></div>${list}</aside>${briefing ? renderBriefingDraftDetail(briefing) : '<section class="card"><p>Start a briefing from Prepare.</p></section>'}</div>`;
}

function renderBriefingHistory() {
  const history = briefings.filter(item => item.status === 'communicated').sort((a, b) => String(b.communicatedAt).localeCompare(String(a.communicatedAt)));
  if (!history.length) return '<div class="card"><p>No communicated briefing history yet. Finalization alone does not create a baseline.</p></div>';
  return `<div class="briefing-history-list">${history.slice(0, 20).map(briefing => {
    const stream = briefingStreams.find(item => item.id === briefing.streamId);
    return `<article class="card"><div class="section-heading"><div><h4>${escapeHtml(stream?.name || 'Briefing')}</h4><div class="micro">Communicated ${escapeHtml(briefingDate(briefing.communicatedAt))}</div></div>${briefingStatusBadge(briefing.status)}</div><div class="briefing-meta"><span>${briefing.projectNames.map(escapeHtml).join(' · ')}</span><span>${(briefing.facts || []).filter(fact => fact.included).length} included facts</span><span>${(briefing.detectedChanges || []).length} detected changes</span></div>${renderBriefingFactList(briefing)}${renderBriefingOutputs(briefing)}</article>`;
  }).join('')}</div>${history.length > 20 ? `<div class="note">Showing the 20 most recent of ${history.length} communicated briefings.</div>` : ''}`;
}

function renderBriefingsPanel() {
  const internalTabs = `<div class="section-tabs briefing-subtabs"><button class="section-tab ${briefingView === 'prepare' ? 'active' : ''}" data-onclick="setBriefingView('prepare')">Prepare</button><button class="section-tab ${briefingView === 'drafts' ? 'active' : ''}" data-onclick="setBriefingView('drafts')">Drafts</button><button class="section-tab ${briefingView === 'history' ? 'active' : ''}" data-onclick="setBriefingView('history')">History</button></div>`;
  return `<div class="card hero-card screen-lead briefings-lead" style="margin-bottom:14px;"><div class="micro" style="margin-bottom:8px;">Evidence-grounded communication workflow</div><h3 style="margin:0 0 8px;">Brief from what changed—not from memory</h3><p style="margin:0;">Each stream keeps its own audience, project scope, and last-communicated baseline. Drafts remain reviewable until you explicitly finalize and mark them communicated.</p></div>
    ${renderCommunicateTabs('briefings')}${internalTabs}
    ${briefingFeedback ? `<div class="note" style="margin-bottom:14px;">${escapeHtml(briefingFeedback)}</div>` : ''}
    ${briefingError ? `<div class="note warn" style="margin-bottom:14px;">${escapeHtml(briefingError)}</div>` : ''}
    ${briefingLoading ? '<div class="card"><p>Refreshing Briefings…</p></div>' : briefingView === 'prepare' ? renderBriefingPrepare() : briefingView === 'drafts' ? renderBriefingDrafts() : renderBriefingHistory()}`;
}

function renderReportsPanel() {
  if (!selectedProject) {
    return '<p>Select a project to draft a status summary.</p>';
  }

  const project = projects[selectedProject];
  const stories = (project && project.stories) || [];
  const timeline = (project && project.timeline) || [];
  const transcripts = (project && project.transcripts) || [];
  const tracked = stories.filter(story => story.tracked);
  const blocked = stories.filter(story => inferStatusClient(story) === 'Blocked');
  const followup = tracked.filter(itemNeedsFollowup);
  const quiet = tracked.filter(itemNeedsComment);
  const overdue = timeline.filter(entry => milestoneHealth(entry).label === 'Overdue');
  const dueSoon = timeline.filter(entry => milestoneHealth(entry).label === 'Due soon');
  const undated = timeline.filter(entry => milestoneHealth(entry).label === 'No date');
  const linkedMilestones = timeline.filter(entry => stories.some(story => story.timelineId === entry.id)).length;
  const storiesWithUpdates = stories.filter(story => (story.updates || []).length > 0).length;
  const assigneeGapCount = stories.filter(story => inferStatusClient(story) !== 'Done' && !storyAssignee(story)).length;
  const sprintGapCount = stories.filter(story => inferStatusClient(story) !== 'Done' && !storySprint(story)).length;
  const commentGapCount = stories.filter(story => inferStatusClient(story) !== 'Done' && !storyLastCommentText(story)).length;

  const updates = [];
  stories.forEach(story => {
    (story.updates || []).forEach(update => updates.push({
      jiraId: story.jiraId || '',
      summary: story.summary || '',
      assignee: storyAssignee(story),
      status: inferStatusClient(story),
      ...update
    }));
  });
  updates.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const latestEvidenceAt = [
    ...updates.map(update => update.date).filter(Boolean),
    ...transcripts.map(item => item.date || item.uploadedAt).filter(Boolean)
  ].map(value => new Date(value).getTime()).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const latestEvidenceLabel = latestEvidenceAt ? new Date(latestEvidenceAt).toLocaleDateString() : 'No dated evidence yet';

  const hasReport = !!projectStatusReport;
  const sourceBadge = hasReport ? `<span class="src-badge ${projectStatusSource.startsWith('ai') ? 'ai' : ''}">source: ${escapeHtml(projectStatusSource)}</span>` : '';
  const readinessNotes = [];
  if (!stories.length) readinessNotes.push('No work items have been added yet.');
  if (!updates.length) readinessNotes.push('No captured work-item updates are available yet.');
  if (!timeline.length) readinessNotes.push('No milestones are recorded yet.');
  if (timeline.length && linkedMilestones < timeline.length) readinessNotes.push(`${timeline.length - linkedMilestones} milestone${timeline.length - linkedMilestones === 1 ? '' : 's'} are not linked to work items.`);
  if (followup.length || quiet.length) readinessNotes.push(`${followup.length + quiet.length} follow-up signal${followup.length + quiet.length === 1 ? '' : 's'} could weaken the narrative unless refreshed.`);

  const riskItems = [
    ...blocked.map(story => ({
      badge: 'blocked',
      title: `${story.jiraId ? `${story.jiraId} · ` : ''}${story.summary}`,
      detail: story.dependencies ? `Blocked by ${story.dependencies}` : (story.notes || 'Blocked work item')
    })),
    ...followup.map(story => ({
      badge: 'followup',
      title: `${story.jiraId ? `${story.jiraId} · ` : ''}${story.summary}`,
      detail: storyAssignee(story) ? `Assignee not contacted: ${storyAssignee(story)}` : 'Assignee not contacted'
    })),
    ...quiet.map(story => ({
      badge: 'quiet',
      title: `${story.jiraId ? `${story.jiraId} · ` : ''}${story.summary}`,
      detail: `No recent Jira comment · ${lastCommentLabel(story)}`
    })),
    ...overdue.map(entry => ({
      badge: 'blocked',
      title: entry.title,
      detail: `Milestone overdue${entry.date ? ` · ${entry.date}` : ''}`
    })),
    ...dueSoon.map(entry => ({
      badge: 'followup',
      title: entry.title,
      detail: `Milestone due soon${entry.date ? ` · ${entry.date}` : ''}`
    }))
  ].slice(0, 8);

  const riskHtml = riskItems.length
    ? riskItems.map((item, index) => `
      <div class="surface-row"${index === riskItems.length - 1 ? ' style="padding-bottom:0;border-bottom:none;"' : ''}>
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p style="margin:4px 0 0;">${escapeHtml(item.detail)}</p>
          </div>
          <span class="badge ${item.badge}">${item.badge === 'followup' ? 'FOLLOW-UP' : item.badge === 'quiet' ? 'QUIET' : 'RISK'}</span>
        </div>
      </div>`).join('')
    : '<p>No current blockers, milestone pressure, or quiet follow-up signals are recorded.</p>';

  const evidenceHtml = updates.length
    ? updates.slice(0, 6).map((item, index) => `
      <div class="surface-row"${index === Math.min(updates.length, 6) - 1 ? ' style="padding-bottom:0;border-bottom:none;"' : ''}>
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;">
          <div style="min-width:0;flex:1;">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              ${item.jiraId ? `<span class="mono" style="color:var(--accent);font-size:0.78rem;">${escapeHtml(item.jiraId)}</span>` : ''}
              <strong>${escapeHtml(item.summary)}</strong>
              <span class="badge ${item.status === 'Blocked' ? 'blocked' : item.status === 'Done' ? 'done' : 'inprogress'}">${escapeHtml(item.status)}</span>
            </div>
            <p style="margin:4px 0 0;">${escapeHtml(item.update || item.excerpt || 'No update text available.')}</p>
            <div class="micro" style="margin-top:6px;text-transform:none;">${escapeHtml(item.date || 'No date')} · ${escapeHtml(item.source || item.transcriptTitle || 'Captured update')}</div>
          </div>
          ${item.assignee ? `<span class="owner-chip">${escapeHtml(item.assignee)}</span>` : ''}
        </div>
      </div>`).join('')
    : '<p>No captured work-item updates yet. Use Capture to bring in DSU or meeting evidence before drafting.</p>';

  const summaryPreview = hasReport
    ? `<div class="card summary-report-card"><pre class="status-report" style="background:var(--bg);border:1px solid var(--border);padding:14px;border-radius:10px;overflow-x:auto;white-space:pre-wrap;margin:0;">${escapeHtml(projectStatusReport)}</pre></div>`
    : `<div class="card summary-report-card">
        <div class="section-heading">
          <h4>Draft Preview</h4>
          <span class="micro">generated output</span>
        </div>
        <p>No summary yet. Generate a draft when the evidence and risk framing on this page look good enough to brief from.</p>
      </div>`;

  return `
    <div class="card hero-card screen-lead summary-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Executive-ready summary workspace</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <h3 style="margin:0 0 8px;">${escapeHtml(selectedProject)} status summary</h3>
          <p style="margin:0;">Grounded only in saved work items, milestones, transcripts, and extracted updates. This screen is meant to help you see whether the draft is supportable before you generate it.</p>
        </div>
        <div class="hero-actions">
          <button class="button" data-onclick="generateStatusReport('heuristic')" ${statusReportLoading ? 'disabled' : ''}>${statusReportLoading && statusReportLoadingMode === 'heuristic' ? 'Generating grounded summary…' : 'Generate grounded summary'}</button>
          <button class="button secondary" data-onclick="generateStatusReport('ai')" ${statusReportLoading || !aiProvider ? 'disabled' : ''}>${statusReportLoading && statusReportLoadingMode === 'ai' ? 'Creating AI draft…' : 'Create AI draft'}</button>
          ${hasReport ? `<button class="button secondary js-copy-text" data-copy-key="${registerCopyPayload(projectStatusReport)}" data-copy-message="Copied status summary.">Copy summary</button>` : ''}
          <button class="button secondary" data-onclick="openCapture()">Capture evidence</button>
          <button class="button secondary" data-onclick="openWorkItems()">Review work items</button>
        </div>
      </div>
    </div>
    ${renderCommunicateTabs('reports')}
    <div class="insight-strip operating-metrics summary-metrics">
      <div class="insight-tile">
        <div class="micro">Current Risk</div>
        <div class="insight-number">${blocked.length + followup.length + quiet.length}</div>
        <div class="insight-copy">${blocked.length} blocked · ${followup.length} need contact · ${quiet.length} quiet Jira threads</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Milestone Pressure</div>
        <div class="insight-number">${overdue.length + dueSoon.length}</div>
        <div class="insight-copy">${overdue.length} overdue · ${dueSoon.length} due within 7 days</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Evidence Depth</div>
        <div class="insight-number">${updates.length}</div>
        <div class="insight-copy">${updates.length} captured updates across ${storiesWithUpdates} of ${stories.length} work items</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Evidence Gaps</div>
        <div class="insight-number">${assigneeGapCount + sprintGapCount + commentGapCount}</div>
        <div class="insight-copy">${assigneeGapCount} assignee gaps · ${sprintGapCount} sprint gaps · ${commentGapCount} comment gaps</div>
      </div>
    </div>
    <div class="section-grid" style="margin-top:14px;">
      <div class="card">
        <div class="section-heading">
          <h4>Grounding Check</h4>
          <span class="micro">what the draft can rely on</span>
        </div>
        <div class="stack">
          <div class="surface-row">
            <strong>${stories.length} work item${stories.length === 1 ? '' : 's'}</strong>
            <p>Status, assignees, Jira IDs, sprint context, notes, dependencies, and captured updates can all feed the summary when present.</p>
          </div>
          <div class="surface-row">
            <strong>${timeline.length} milestone${timeline.length === 1 ? '' : 's'}</strong>
            <p>${linkedMilestones} linked to work items. ${undated.length ? `${undated.length} still need dates.` : 'All recorded milestones have dates.'}</p>
          </div>
          <div class="surface-row" style="padding-bottom:0;border-bottom:none;">
            <strong>${transcripts.length} captured source${transcripts.length === 1 ? '' : 's'}</strong>
            <p>Latest dated evidence: ${escapeHtml(latestEvidenceLabel)}. Source badge after generation will show whether the final draft came from AI or the grounded heuristic fallback.</p>
          </div>
        </div>
        ${sourceBadge ? `<div style="margin-top:14px;">${sourceBadge}</div>` : ''}
      </div>
      <div class="card">
        <div class="section-heading">
          <h4>Readiness Notes</h4>
          <span class="micro">gaps before briefing</span>
        </div>
        ${readinessNotes.length
          ? `<div class="stack">${readinessNotes.map((note, index) => `<div class="surface-row"${index === readinessNotes.length - 1 ? ' style="padding-bottom:0;border-bottom:none;"' : ''}><p>${escapeHtml(note)}</p></div>`).join('')}</div>`
          : '<p>No obvious evidence gaps are visible from the saved project data.</p>'}
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="button secondary" data-onclick="openMilestones()">Review milestones</button>
          <button class="button secondary" data-onclick="openSettings()">AI settings</button>
        </div>
      </div>
    </div>
    ${statusReportError ? `<div class="card" style="background:var(--danger-bg);color:var(--danger);border-color:var(--danger-border);margin-bottom:14px;"><strong>Error:</strong> ${escapeHtml(statusReportError)}</div>` : ''}
    <div class="section-grid" style="margin-top:14px;">
      <div class="card">
        <div class="section-heading">
          <h4>Risk Framing</h4>
          <span class="micro">what leadership will ask about</span>
        </div>
        <p style="margin:0 0 8px;">Blocked work, follow-up signals, and milestone pressure rise here first so you can challenge the draft against actual operational risk.</p>
        ${riskHtml}
      </div>
      <div class="card">
        <div class="section-heading">
          <h4>Recent Evidence</h4>
          <span class="micro">captured updates</span>
        </div>
        <p style="margin:0 0 8px;">These are the freshest recorded inputs available to the summary generator.</p>
        ${evidenceHtml}
      </div>
    </div>
    <div style="margin-top:14px;">
      ${summaryPreview}
    </div>
    <div class="note" style="margin-top:14px;">Grounded summary is the factual baseline. AI is an optional, reviewable draft and never replaces it. DSU evidence extraction remains deterministic.</div>
  `;
}

// Extracted DSU updates for a single project, shown as a card at the bottom of the
// Transcripts tab (the updates are the direct product of DSU transcript uploads, so they
// live where you manage transcripts — this replaced the standalone Updates tab).
function captureSectionHeading(section, title, subtitle, expanded, countLabel = '') {
  return `<button class="capture-section-toggle" data-onclick="toggleCaptureSection(${escapeHtml(JSON.stringify(section))})" aria-expanded="${expanded ? 'true' : 'false'}">
    <span class="capture-section-heading-copy"><span class="capture-section-name">${escapeHtml(title)}</span><span class="micro">${escapeHtml(subtitle)}</span></span>
    <span class="capture-section-heading-status">${countLabel ? `<span>${escapeHtml(countLabel)}</span>` : ''}<span class="capture-section-chevron" aria-hidden="true">${expanded ? '−' : '+'}</span></span>
  </button>`;
}

function capturePagination(list, page, totalItems, itemLabel) {
  const pageCount = Math.max(1, Math.ceil(totalItems / CAPTURE_LIST_PAGE_SIZE));
  if (pageCount <= 1) return '';
  return `<div class="capture-pagination">
    <button class="button button-small secondary" ${page <= 0 ? 'disabled' : ''} data-onclick="setCaptureListPage(${escapeHtml(JSON.stringify(list))}, ${page - 1})">Previous</button>
    <span class="micro">Page ${page + 1} of ${pageCount} · ${totalItems} ${escapeHtml(itemLabel)}</span>
    <button class="button button-small secondary" ${page >= pageCount - 1 ? 'disabled' : ''} data-onclick="setCaptureListPage(${escapeHtml(JSON.stringify(list))}, ${page + 1})">Next</button>
  </div>`;
}

function toggleCaptureSection(section) {
  const allowed = new Set(['meeting', 'upload', 'externalFeed', 'sourceLibrary', 'evidenceQueue', 'dsuUpdates']);
  if (!allowed.has(section)) return;
  if (captureExpandedSections.has(section)) captureExpandedSections.delete(section); else captureExpandedSections.add(section);
  if (selectedProject) transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}

function setCaptureListPage(list, page) {
  if (!['sources', 'findings', 'updates'].includes(list) || !Number.isInteger(page) || page < 0) return;
  captureListPages[list] = page;
  if (selectedProject) transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}

function renderTranscriptsPanel(project) {
  const transcriptCount = (project.transcripts || []).length;
  const dsuCount = (project.transcripts || []).filter(t => /dsu/i.test(t.type || '')).length;
  const findings = (project.transcripts || []).flatMap(t => (t.extractedFindings || []).map(finding => ({ transcript: t, finding })));
  const pendingCount = findings.filter(item => item.finding.reviewStatus === 'pending').length;
  const latestSourceAt = (project.transcripts || [])
    .map(t => t.date || t.uploadedAt)
    .filter(Boolean)
    .map(value => new Date(value).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  const latestSourceLabel = latestSourceAt ? new Date(latestSourceAt).toLocaleDateString() : 'No source uploaded yet';
  const badge = (type) => {
    const t = (type || '').trim();
    if (!t) return '';
    return `<span class="badge ${/dsu/i.test(t) ? 'inprogress' : 'notstarted'}" style="text-transform:uppercase;font-family:var(--mono);font-size:0.66rem;">${escapeHtml(t)}</span>`;
  };
  const sourceRows = (project.transcripts || []).map(t => {
    if (transcriptEditing === t.id) return transcriptEditRow(t);
    const extracted = Array.isArray(t.extractedFindings) ? t.extractedFindings.length : 0;
    const pending = (t.extractedFindings || []).filter(item => item.reviewStatus === 'pending').length;
    const meta = [
      t.originalName || '',
      t.date || (t.uploadedAt ? new Date(t.uploadedAt).toLocaleDateString() : ''),
      t.externalTranscription ? `external transcription · ${t.externalTranscription.importStatus || 'pending'}` : '',
      t.sourceKind === 'reference' ? 'reference only' : (extracted ? `${extracted} finding${extracted === 1 ? '' : 's'} · ${pending} pending` : 'no findings')
    ].filter(Boolean).join(' · ');
    const attachmentLinks = (t.attachments || []).map(attachment => {
      const href = `/api/project/transcript/file?project=${encodeURIComponent(selectedProject)}&id=${encodeURIComponent(t.id)}&attachmentId=${encodeURIComponent(attachment.id)}`;
      return `<a class="button button-small secondary" href="${escapeHtml(href)}">View ${escapeHtml(attachment.originalName || 'attachment')}</a>`;
    }).join('');
    return `
      <li class="card" style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
        <div style="min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong>${escapeHtml(t.title)}</strong>${badge(t.type)}
          </div>
          <div class="micro" style="margin-top:5px;text-transform:none;">${escapeHtml(meta)}</div>
          ${t.notes ? `<p style="margin-top:6px;">${escapeHtml(t.notes.slice(0, 140))}${t.notes.length > 140 ? '…' : ''}</p>` : ''}
          ${t.extractionNote ? `<p class="micro source-reference-note">${escapeHtml(t.extractionNote)}</p>` : ''}
          ${attachmentLinks ? `<div class="source-attachment-links">${attachmentLinks}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex:none;">
          ${t.externalTranscription?.importStatus === 'pending' ? `<button class="button button-small" data-onclick="resumeExternalFeed(${escapeHtml(JSON.stringify(t.id))})">Reconcile</button>` : ''}
          ${t.sourceKind !== 'external-ai-transcription' ? `<button class="button button-small secondary" data-onclick="startTranscriptEdit(${escapeHtml(JSON.stringify(t.id))})">Edit</button>` : ''}
          <button class="button button-small danger" data-onclick="deleteItem(${escapeHtml(JSON.stringify(selectedProject))}, 'transcript', ${escapeHtml(JSON.stringify(t.id))})">Delete</button>
        </div>
      </li>`;
  });
  const sourcePageCount = Math.max(1, Math.ceil(sourceRows.length / CAPTURE_LIST_PAGE_SIZE));
  const sourcePage = Math.min(captureListPages.sources, sourcePageCount - 1);
  const visibleSourceRows = sourceRows.slice(sourcePage * CAPTURE_LIST_PAGE_SIZE, (sourcePage + 1) * CAPTURE_LIST_PAGE_SIZE).join('');
  const meetingExpanded = captureExpandedSections.has('meeting');
  const uploadExpanded = captureExpandedSections.has('upload');
  const sourceLibraryExpanded = captureExpandedSections.has('sourceLibrary');

  return `
    <div class="card hero-card screen-lead capture-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Evidence capture workspace</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <h3 style="margin:0 0 8px;">Source intake and extraction</h3>
          <p style="margin:0;">Bring in DSUs, Sprint Planning, Backlog Refinement, and other source text. Extracted evidence stays pending until you review it.</p>
        </div>
      </div>
    </div>
    <div class="insight-strip operating-metrics capture-metrics" style="margin-bottom:14px;">
      <div class="insight-tile">
        <div class="micro">Sources</div>
        <div class="insight-number">${transcriptCount}</div>
        <div class="insight-copy">Transcripts and notes stored for this project</div>
      </div>
      <div class="insight-tile">
        <div class="micro">DSUs</div>
        <div class="insight-number">${dsuCount}</div>
        <div class="insight-copy">Uploads that trigger story update extraction</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Pending Review</div>
        <div class="insight-number">${pendingCount}</div>
        <div class="insight-copy">Findings that have not changed trusted state</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Latest Source</div>
        <div class="insight-number" style="font-size:1.05rem;line-height:1.2;">${escapeHtml(latestSourceLabel)}</div>
        <div class="insight-copy">Freshness of the current evidence base</div>
      </div>
    </div>
    <div class="card meeting-capture-card">
      ${captureSectionHeading('meeting', 'Structured meeting note', 'Fast capture', meetingExpanded)}
      ${meetingExpanded ? `
      <p style="margin:0 0 14px;">Record decisions, actions, and delivery changes while they are fresh. Ceremony extraction always creates reviewable findings first.</p>
      <div class="form-grid">
        <div class="field-row">
          <div><label>Meeting title</label><input id="meeting-title" placeholder="Weekly delivery sync" /></div>
          <div><label>Date</label><input id="meeting-date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
        </div>
        <div class="field-row">
          <div><label>Type</label><select id="meeting-type">${CAPTURE_SOURCE_TYPES.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('')}</select></div>
          <div><label>Attendees</label><input id="meeting-attendees" placeholder="Names or roles" /></div>
        </div>
        <div class="form-row"><label>What changed or was discussed?</label><textarea id="meeting-summary" placeholder="Factual notes only. Capture work-item updates, risks, and confirmed changes."></textarea></div>
        <div class="field-row">
          <div><label>Decisions</label><textarea id="meeting-decisions" placeholder="One decision per line"></textarea></div>
          <div><label>Actions and owners</label><textarea id="meeting-actions" placeholder="One action per line, including owner when known"></textarea></div>
        </div>
        <div><button class="button" data-onclick="saveStructuredMeeting()">Save meeting note</button></div>
      </div>` : ''}
    </div>
    <div class="card capture-intake-card">
      ${captureSectionHeading('upload', 'Upload sources', 'Intake and extraction', uploadExpanded, captureSelectedFiles.length ? `${captureSelectedFiles.length} selected` : '')}
      ${uploadExpanded ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <label class="dropzone" id="dropzone" data-onclick="document.getElementById('transcript-file').click()" data-ondragover="dzOver(event)" data-ondragleave="dzLeave(event)" data-ondrop="dzDrop(event)">
          <div class="dz-icon"></div>
          <div class="dz-main" id="dz-text">Drop up to 5 files, or browse</div>
          <div class="micro">10 MB per file</div>
        </label>
        <input id="transcript-file" type="file" multiple style="display:none;" data-onchange="dzFileChosen()" />
        <div class="form-grid">
          <div class="form-row"><input id="transcript-notes" placeholder="Batch note (optional, applies to each source)" /></div>
          <button class="button" style="width:100%;" data-onclick="uploadTranscript()">Upload sources</button>
        </div>
      </div>
      ${renderSelectedCaptureFiles()}
      <div class="note" style="margin-top:14px;">DSU, Sprint Planning, and Backlog Refinement text is extracted into a review queue. Only an accepted DSU progress finding can create a work-item update; planning and refinement findings remain evidence only.</div>
      ${captureUploadFeedback ? `<div class="capture-upload-feedback ${captureUploadFeedback.warning ? 'warning' : ''}">${escapeHtml(captureUploadFeedback.message)}</div>` : ''}
      ` : ''}
    </div>
    ${renderExternalFeedCard(project)}
    <div class="card evidence-library-card">
      ${captureSectionHeading('sourceLibrary', 'Source Library', 'Saved inputs', sourceLibraryExpanded, `${transcriptCount} source${transcriptCount === 1 ? '' : 's'}`)}
      ${sourceLibraryExpanded ? (transcriptCount ? `<ul class="panel-list">${visibleSourceRows}</ul>${capturePagination('sources', sourcePage, sourceRows.length, 'sources')}` : '<p>No transcripts yet.</p>') : ''}
    </div>
    ${renderFindingReviewQueue(project)}
    ${renderProjectUpdatesCard(selectedProject, project)}
  `;
}

const EXTERNAL_FEED_PROMPT = `You are preparing an external evidence feed for Priorena from screenshots attached to this ChatGPT conversation.

NON-NEGOTIABLE ACCURACY RULES
1. Use only facts visibly present in the screenshots. Never infer, invent, guess, complete, embellish, or use outside knowledge.
2. When text cannot be read confidently, treat it as [UNREADABLE]. Never use unreadable text to propose a work-item field.
3. Preserve Jira keys, names, statuses, dates, and verbatim quotations exactly as visibly shown.
4. Keep current information separate from historical information. Never present an older status, value, or comment as current.
5. A question, possibility, suggestion, intention, request, or proposal is not a decision. Do not convert it into a current project fact.
6. Associate evidence with a Jira item only when the screenshot explicitly shows that association. Put everything else in unlinkedEvidence.
7. Every proposed field must link to at least one readable evidence record containing a verbatim supporting excerpt.
8. Omit any proposed field that lacks readable supporting evidence.
9. Never merge work items because their titles look similar. Preserve and match exact Jira keys only.
10. Never fabricate, calculate, or reconstruct a missing timestamp.
11. lastComment may be proposed only when both the exact comment and a complete visible lastCommentedAt timestamp are available.
12. Do not convert relative or incomplete dates such as "Yesterday," "Tuesday," or a time without a complete visible date and timezone into lastCommentedAt.
13. Exclude passwords, tokens, authentication codes, private URLs, and unrelated personal information.

PARTIAL FEED REQUIREMENT
Unreadable or incomplete information must not cause the entire screenshot batch to be rejected.

When at least one valid, readable fact or evidence record can be represented under pm-external-feed/v3, create the feed and file.

For each uncertain, unsupported, truncated, or unreadable value:
- omit the proposed field
- add a concise warning describing the omission
- continue processing all remaining readable information

A partial feed is valid. A readable comment without a complete timestamp may remain evidence but cannot be proposed as lastComment or lastCommentedAt. Ask for replacements only when the entire batch has no readable Jira key, supported field, or excerpt.

OUTPUT RULES
Create exactly one valid JSON object using schemaVersion "pm-external-feed/v3". Use an ISO 8601 UTC generatedAt. sourceType must be Story Snapshot, Developer Conversation, Sprint Planning, Backlog Refinement, DSU, or Other External Evidence. Valid proposed fields are itemType, summary, description, status, assignee, sprint, labels, dependencies, environment, acceptanceCriteria, lastComment, lastCommentedAt. itemType values are Story, Epic, Feature, Task, Bug, Other, or Unknown. Most work items are Stories, but never infer itemType from meeting language or frequency. Propose itemType only when the type is explicitly readable for that exact Jira key. A missing itemType must never block partial-feed creation; Priorena collects a separate human creation-type decision. Valid categories are progress_update, blocker, dependency, question, decision, action, ownership, risk, other, sprint_commitment, carryover, capacity_constraint, scope_change, acceptance_criterion, open_question, missing_information, estimate, readiness_gap, story_split.

PROJECT / JIRA EPIC RULES
1. A Priorena Project is a Jira Epic delivery scope. A work item remains separate from its Epic.
2. Add epicAssociation only when the screenshot explicitly shows the exact Jira Epic key or exact Epic name for that same work-item Jira key.
3. epicAssociation must include jiraEpicKey and/or jiraEpicName plus at least one evidenceIds entry.
4. The supporting evidence must carry the same work-item Jira key and visibly support the Epic relationship.
5. Never infer an Epic from a similar title, nearby row, meeting topic, tab name, or the fact that most items are Stories.
6. Omit an uncertain association and add a warning. Priorena performs an exact local match and requires separate human approval before assignment.

Use this exact structure:
{
  "schemaVersion": "pm-external-feed/v3",
  "generatedAt": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "source": {
    "title": "short descriptive title",
    "sourceType": "Developer Conversation",
    "visibleDate": "YYYY-MM-DD or empty string",
    "transcriptionProvider": "ChatGPT",
    "promptVersion": "pm-external-feed-v3.0",
    "sourceDescription": "Externally transcribed from screenshots; originals not retained"
  },
  "warnings": [],
  "workItems": [
    {
      "jiraId": "ABC-123",
      "fields": { "status": "In progress" },
      "fieldEvidence": { "status": ["evidence-1"] },
      "epicAssociation": {
        "jiraEpicKey": "ABC-100",
        "jiraEpicName": "exact visible Epic name or empty string",
        "evidenceIds": ["evidence-1"]
      }
    }
  ],
  "evidence": [
    {
      "id": "evidence-1",
      "jiraId": "ABC-123",
      "category": "progress_update",
      "sourceRef": "image 1",
      "speaker": "visible speaker name or empty string",
      "visibleTimestamp": "complete visible ISO timestamp or empty string",
      "exactExcerpt": "verbatim visible quotation",
      "reviewNote": "short ambiguity note or empty string"
    }
  ],
  "unlinkedEvidence": [
    {
      "id": "unlinked-evidence-1",
      "jiraId": "",
      "category": "question",
      "sourceRef": "image 2",
      "speaker": "visible speaker name or empty string",
      "visibleTimestamp": "complete visible ISO timestamp or empty string",
      "exactExcerpt": "verbatim visible quotation",
      "reviewNote": "why this evidence could not be linked or empty string"
    }
  ]
}

Do not include example records unless the screenshots visibly support them. Arrays may be empty when no valid records of that type are available.

EVIDENCE RULES
1. IDs must be unique and every fieldEvidence or epicAssociation reference must resolve.
2. Supporting evidence must use the same exact work-item Jira key and a readable, sufficient verbatim exactExcerpt.
3. [UNREADABLE] text, proximity, or a nearby Jira key cannot support a field or association.
4. Keep questions, risks, requests, and history as evidence; do not convert them into current fields.
5. Use an empty visibleTimestamp unless a complete visible timestamp can be represented without inference.
6. Explain material omissions in warnings or reviewNote. Every unlinkedEvidence record must include a unique id, an empty jiraId, and all evidence fields.

FINAL FILE REQUIREMENT
Create a downloadable UTF-8 file named pm-external-feed.json.

The file must contain only the valid JSON object: no Markdown fences, introduction, explanation, comments, or text outside the opening and closing braces.

Before creating the file, silently verify that references resolve; support is readable, verbatim, sufficient, and uses the same Jira key; no unreadable, inferred, historical, truncated, relative-time, or unsupported value became a current field; itemType is explicit; every epicAssociation is explicit and supported; and the result is raw pm-external-feed/v3 JSON. Create the partial file before requesting replacements.

If information is uncertain, omit the proposed field, add a concise warning, and continue generating the partial feed. Never guess to complete the feed.

If no screenshots are attached, ask the user to attach them. Do not use web search, connected apps, uploaded knowledge, or outside information to fill gaps.`;

function externalFeedSelectionKey(jiraId, field) { return `${jiraId}\u0000${field}`; }

function displayExternalFeedValue(value) {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  if (Array.isArray(value)) return value.join(', ') || 'None';
  return String(value);
}

function renderExternalFeedCard(project) {
  const pendingImports = (project.transcripts || []).filter(item => item.sourceKind === 'external-ai-transcription' && item.externalTranscription?.importStatus === 'pending');
  const fileSummary = externalFeedFileName ? escapeHtml(externalFeedFileName) : 'No feed selected';
  const preview = externalFeedPreview;
  const feedExpanded = captureExpandedSections.has('externalFeed') || !!preview || !!externalFeedError;
  const previewEvidence = new Map(preview ? [...(preview.evidence || []), ...(preview.unlinkedEvidence || [])].map(item => [item.externalEvidenceId || item.id, item.exactExcerpt || item.excerpt || '']) : []);
  const previewItems = preview ? preview.items.map(item => {
    const canCreate = item.matchType !== 'new' || !!String(item.fields?.summary?.proposedValue || '').trim();
    const creationApproved = item.matchType === 'new' && externalFeedCreates.has(item.jiraId);
    const newItemFieldsEnabled = item.matchType !== 'new' || (canCreate && creationApproved);
    const creationType = externalFeedCreateTypes.get(item.jiraId) || 'Story';
    const currentItem = item.matchType === 'existing' ? (project.stories || []).find(story => story.jiraId === item.jiraId) : null;
    const proposedSummary = item.fields?.summary?.proposedValue || '';
    const displaySummary = item.matchType === 'new' ? proposedSummary : (currentItem?.summary || proposedSummary);
    const itemState = item.matchType === 'new' ? 'New work item' : 'Existing work item';
    const replaceableFields = Object.entries(item.fields || {})
      .filter(([field, comparison]) => newItemFieldsEnabled && comparison.changed && !comparison.blocked && !(item.matchType === 'new' && field === 'itemType'))
      .map(([field]) => field);
    const allReplaceableSelected = replaceableFields.length > 0 && replaceableFields.every(field => externalFeedSelections.has(externalFeedSelectionKey(item.jiraId, field)));
    let fieldRows = Object.entries(item.fields || {}).map(([field, comparison]) => {
      const key = externalFeedSelectionKey(item.jiraId, field);
      const checked = externalFeedSelections.has(key);
      const creationTypeSuggestion = item.matchType === 'new' && field === 'itemType';
      const creationGateLabel = !canCreate ? 'Creation unavailable—Summary required' : 'Approve creation first';
      const fieldDisabled = comparison.blocked || !newItemFieldsEnabled;
      return `<tr class="${comparison.blocked ? 'external-feed-blocked' : ''}">
        <td><strong>${escapeHtml(field)}</strong></td>
        <td>${escapeHtml(displayExternalFeedValue(comparison.currentValue))}</td>
        <td>${escapeHtml(displayExternalFeedValue(comparison.proposedValue))}</td>
        <td>${escapeHtml((comparison.evidenceIds || []).map(id => previewEvidence.get(id) || id).join(' · ') || 'No evidence link')}</td>
        <td>${creationTypeSuggestion
          ? '<span class="micro">Suggestion only—choose the creation type above</span>'
          : comparison.changed
          ? `<label class="external-feed-choice"><input type="checkbox" ${checked ? 'checked' : ''} ${fieldDisabled ? 'disabled' : ''} data-onchange="toggleExternalFeedField(${escapeHtml(JSON.stringify(item.jiraId))}, ${escapeHtml(JSON.stringify(field))}, this.checked)" /> ${comparison.blocked ? 'Older—blocked' : !newItemFieldsEnabled ? creationGateLabel : 'Replace current'}</label>`
          : '<span class="micro">No change</span>'}</td>
      </tr>`;
    }).join('');
    if (item.epicAssociation) {
      const association = item.epicAssociation;
      const associationKey = externalFeedSelectionKey(item.jiraId, '__project__');
      const checked = externalFeedSelections.has(associationKey);
      const disabled = association.blocked || !association.changed || !newItemFieldsEnabled;
      fieldRows += `<tr class="${association.blocked ? 'external-feed-blocked' : ''}">
        <td><strong>Project / Jira Epic</strong></td>
        <td>${escapeHtml(association.currentDeliveryProjectName || 'Unassigned')}</td>
        <td>${escapeHtml(association.proposedDeliveryProjectName || association.jiraEpicKey || association.jiraEpicName || 'No exact match')}</td>
        <td>${escapeHtml((association.evidenceIds || []).map(id => previewEvidence.get(id) || id).join(' · '))}</td>
        <td>${association.changed ? `<label class="external-feed-choice"><input type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} data-onchange="toggleExternalFeedField(${escapeHtml(JSON.stringify(item.jiraId))}, '__project__', this.checked)" /> ${association.blocked ? 'Exact Project match required' : !newItemFieldsEnabled ? 'Approve creation first' : 'Assign Project'}</label>` : `<span class="micro">${association.blocked ? 'Needs association review' : 'No change'}</span>`}</td>
      </tr>`;
    }
    return `<div class="external-feed-item">
      <div class="section-heading">
        <div class="external-feed-item-heading"><h4>${escapeHtml(item.jiraId)}${displaySummary ? ` · ${escapeHtml(displaySummary)}` : ''}</h4><span class="micro">${itemState}</span></div>
        ${item.matchType === 'new' ? `<div class="external-feed-create-controls"><label>Creation type <select data-onchange="setExternalFeedCreateType(${escapeHtml(JSON.stringify(item.jiraId))}, this.value)">${itemTypeOptions(creationType)}</select></label><label class="external-feed-choice"><input type="checkbox" ${externalFeedCreates.has(item.jiraId) ? 'checked' : ''} ${canCreate ? '' : 'disabled'} data-onchange="toggleExternalFeedCreate(${escapeHtml(JSON.stringify(item.jiraId))}, this.checked)" /> ${canCreate ? 'Approve creation' : 'Creation needs a proposed Summary'}</label></div>` : ''}
      </div>
      <div class="external-feed-table-wrap"><table class="external-feed-table"><thead><tr><th>Field</th><th>Current</th><th>Proposed</th><th>Supporting excerpt</th><th><label class="external-feed-choice external-feed-select-all"><input type="checkbox" ${allReplaceableSelected ? 'checked' : ''} ${replaceableFields.length ? '' : 'disabled'} data-onchange="toggleExternalFeedAllFields(${escapeHtml(JSON.stringify(item.jiraId))}, this.checked)" /> Replace all</label></th></tr></thead><tbody>${fieldRows}</tbody></table></div>
    </div>`;
  }).join('') : '';
  const pendingList = pendingImports.length ? `<div class="pending-import-list"><strong>Saved pending feeds</strong>${pendingImports.map(item => `<button class="button button-small secondary" data-onclick="resumeExternalFeed(${escapeHtml(JSON.stringify(item.id))})">${escapeHtml(item.title)} · resume</button>`).join('')}</div>` : '';

  return `<div class="card external-feed-card">
    ${captureSectionHeading('externalFeed', 'ChatGPT evidence feed', 'JSON or Markdown import', feedExpanded, pendingImports.length ? `${pendingImports.length} pending` : '')}
    ${feedExpanded ? `
    <div class="note warn">Use an organization-approved ChatGPT workspace. Remove secrets before uploading screenshots there. Priorena receives only the generated feed and does not independently verify the transcription.</div>
    ${pendingList}
    <ol class="help-list external-feed-steps"><li>Copy the strict prompt.</li><li>Use it with screenshots in a separate ChatGPT conversation.</li><li>Save ChatGPT's result as a .json file, or place it in exactly one fenced json block in a .md file, then select that feed here.</li></ol>
    <button class="button button-small secondary js-copy-text" data-copy-key="${registerCopyPayload(EXTERNAL_FEED_PROMPT)}">Copy ChatGPT prompt</button>
    <div class="form-grid external-feed-inputs">
      <div class="form-row">
        <label>ChatGPT feed</label>
        <div class="external-feed-file-control">
          <input id="external-feed-file" class="external-feed-file-input" type="file" accept=".json,.md,application/json,text/markdown" data-onchange="externalFeedFileChosen()" />
          <label class="button button-small secondary external-feed-file-button" for="external-feed-file">Choose feed</label>
          <span class="external-feed-file-name">${fileSummary}</span>
        </div>
        <div class="micro" style="text-transform:none;margin-top:6px;">One .json or .md file · 1 MB maximum</div>
      </div>
      <details class="external-feed-advanced"><summary>Advanced: paste feed manually</summary><textarea id="external-feed-text" rows="10" placeholder='{"schemaVersion":"pm-external-feed/v3", ...}' data-oninput="setExternalFeedText(this.value)">${escapeHtml(externalFeedText)}</textarea></details>
      <div class="external-feed-actions">
        <button class="button secondary" data-onclick="previewExternalFeed()">Preview without saving</button>
        <button class="button" data-onclick="saveExternalFeed()" ${preview && !externalFeedPendingId ? '' : 'disabled'}>Save as pending</button>
        ${externalFeedPendingId ? '<button class="button" data-onclick="applyExternalFeed()">Apply approved fields</button>' : ''}
        <button class="button secondary" data-onclick="resetExternalFeed()">${externalFeedPendingId ? 'Delete pending feed' : 'Clear'}</button>
      </div>
    </div>
    ${externalFeedCompletionFeedback ? `<div class="capture-upload-feedback">${escapeHtml(externalFeedCompletionFeedback)}</div>` : ''}
    ${externalFeedError ? `<div class="capture-upload-feedback warning">${escapeHtml(externalFeedError)}</div>` : ''}
    ${preview ? `<div class="external-feed-preview"><div class="section-heading"><h4>Reconciliation preview</h4><span class="micro">${preview.items.length} work item${preview.items.length === 1 ? '' : 's'}</span></div>${(preview.warnings || []).length ? `<div class="note warn">${escapeHtml(preview.warnings.join(' · '))}</div>` : ''}${previewItems}<p class="micro" style="text-transform:none;">All fields default to Keep current. Only checked replacements are applied. Evidence remains pending for separate review.</p></div>` : ''}
    ` : ''}
  </div>`;
}

function resetExternalFeedState() {
  externalFeedText = '';
  externalFeedFileName = '';
  externalFeedPreview = null;
  externalFeedError = '';
  externalFeedPendingId = '';
  externalFeedCompletionFeedback = '';
  externalFeedSelections = new Set();
  externalFeedCreates = new Set();
  externalFeedCreateTypes = new Map();
}

function setExternalFeedText(value) {
  externalFeedCompletionFeedback = '';
  externalFeedText = value;
  externalFeedFileName = 'manual.json';
  externalFeedPreview = null;
}

async function externalFeedFileChosen() {
  const file = document.getElementById('external-feed-file')?.files?.[0];
  externalFeedCompletionFeedback = '';
  externalFeedError = '';
  externalFeedPreview = null;
  if (!file) { externalFeedText = ''; externalFeedFileName = ''; transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]); return; }
  externalFeedText = '';
  externalFeedFileName = '';
  if (!/\.(json|md)$/i.test(file.name)) externalFeedError = 'Choose one .json or .md feed file.';
  else if (file.size > 1024 * 1024) externalFeedError = 'Feed file must be 1 MB or smaller.';
  else {
    try { externalFeedText = await file.text(); externalFeedFileName = file.name; }
    catch (_) { externalFeedError = 'The selected feed could not be read.'; }
  }
  transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}

function toggleExternalFeedField(jiraId, field, checked) {
  const item = externalFeedPreview?.items?.find(candidate => candidate.jiraId === jiraId);
  const canCreate = item?.matchType !== 'new' || !!String(item?.fields?.summary?.proposedValue || '').trim();
  if (!item || (item.matchType === 'new' && (!canCreate || !externalFeedCreates.has(jiraId)))) {
    if (selectedProject) transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
    return;
  }
  const key = externalFeedSelectionKey(jiraId, field);
  if (checked) externalFeedSelections.add(key); else externalFeedSelections.delete(key);
}

function toggleExternalFeedAllFields(jiraId, checked) {
  const item = externalFeedPreview?.items?.find(candidate => candidate.jiraId === jiraId);
  if (!item) return;
  if (item.matchType === 'new' && (!item.fields?.summary || !externalFeedCreates.has(jiraId))) {
    transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
    return;
  }
  Object.entries(item.fields || {}).forEach(([field, comparison]) => {
    if (!comparison.changed || comparison.blocked || (item.matchType === 'new' && field === 'itemType')) return;
    const key = externalFeedSelectionKey(jiraId, field);
    if (checked) externalFeedSelections.add(key); else externalFeedSelections.delete(key);
  });
  transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}

function toggleExternalFeedCreate(jiraId, checked) {
  const item = externalFeedPreview?.items?.find(candidate => candidate.jiraId === jiraId);
  if (checked && (!item || !String(item.fields?.summary?.proposedValue || '').trim())) return;
  if (checked) externalFeedCreates.add(jiraId);
  else {
    externalFeedCreates.delete(jiraId);
    const item = externalFeedPreview?.items?.find(candidate => candidate.jiraId === jiraId);
    Object.keys(item?.fields || {}).forEach(field => externalFeedSelections.delete(externalFeedSelectionKey(jiraId, field)));
  }
  if (selectedProject) transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}

function setExternalFeedCreateType(jiraId, itemType) {
  externalFeedCreateTypes.set(jiraId, itemType);
}

function resetExternalFeedCreationTypes(preview) {
  externalFeedCreateTypes = new Map((preview?.items || []).filter(item => item.matchType === 'new').map(item => [item.jiraId, 'Story']));
}

async function previewExternalFeed() {
  externalFeedCompletionFeedback = '';
  externalFeedError = '';
  if (!externalFeedText || !externalFeedFileName) { externalFeedError = 'Choose a .json or .md feed before previewing.'; transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]); return; }
  const response = await fetch('/api/project/external-feed/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: selectedProject, feedText: externalFeedText, fileName: externalFeedFileName }) });
  const result = await response.json().catch(() => ({ error: 'Unable to preview the feed.' }));
  if (!response.ok) { externalFeedError = result.error || 'Unable to preview the feed.'; externalFeedPreview = null; }
  else { externalFeedPreview = result; externalFeedSelections = new Set(); externalFeedCreates = new Set(); resetExternalFeedCreationTypes(result); }
  transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}

async function saveExternalFeed() {
  if (!externalFeedPreview) return;
  externalFeedCompletionFeedback = '';
  const response = await fetch('/api/project/external-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: selectedProject, feedText: externalFeedText, fileName: externalFeedFileName }) });
  const result = await response.json().catch(() => ({ error: 'Unable to save the pending feed.' }));
  if (!response.ok) { externalFeedError = result.error || 'Unable to save the pending feed.'; transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]); return; }
  externalFeedPendingId = result.transcript.id;
  externalFeedPreview = result.preview;
  externalFeedError = '';
  await refreshProject();
}

async function resumeExternalFeed(transcriptId) {
  const transcript = (projects[selectedProject]?.transcripts || []).find(item => item.id === transcriptId);
  if (!transcript || transcript.externalTranscription?.importStatus !== 'pending') return;
  externalFeedCompletionFeedback = '';
  externalFeedPendingId = transcript.id;
  externalFeedText = transcript.externalFeed ? JSON.stringify(transcript.externalFeed, null, 2) : '';
  externalFeedFileName = 'saved-feed.json';
  externalFeedSelections = new Set();
  externalFeedCreates = new Set();
  externalFeedCreateTypes = new Map();
  externalFeedError = '';
  if (transcript.externalFeed) {
    const response = await fetch('/api/project/external-feed/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: selectedProject, feedText: externalFeedText, fileName: externalFeedFileName }) });
    const result = await response.json().catch(() => ({ error: 'Unable to refresh reconciliation.' }));
    if (response.ok) { externalFeedPreview = result; resetExternalFeedCreationTypes(result); }
    else externalFeedError = result.error || 'Unable to refresh reconciliation.';
  } else {
    externalFeedPreview = { items: transcript.proposedWorkItemChanges || [], warnings: transcript.externalTranscription.warnings || [], evidence: transcript.extractedFindings || [], source: { title: transcript.title, sourceType: transcript.type } };
    resetExternalFeedCreationTypes(externalFeedPreview);
  }
  transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}

async function applyExternalFeed() {
  if (!externalFeedPendingId || !externalFeedPreview) return;
  const decisions = [];
  externalFeedPreview.items.forEach(item => {
    const creationApproved = item.matchType === 'new' && externalFeedCreates.has(item.jiraId);
    if (creationApproved) decisions.push({ jiraId: item.jiraId, action: 'create', itemType: externalFeedCreateTypes.get(item.jiraId) || 'Story' });
    Object.entries(item.fields || {}).forEach(([field, comparison]) => {
      if (item.matchType === 'new' && field === 'itemType') return;
      if (item.matchType === 'new' && !creationApproved) return;
      if (externalFeedSelections.has(externalFeedSelectionKey(item.jiraId, field))) {
        decisions.push({ jiraId: item.jiraId, field, decision: 'replace', expectedCurrentValue: comparison.currentValue });
      }
    });
    if (item.epicAssociation?.changed && !item.epicAssociation.blocked && externalFeedSelections.has(externalFeedSelectionKey(item.jiraId, '__project__')) && (item.matchType !== 'new' || creationApproved)) {
      decisions.push({
        jiraId: item.jiraId,
        action: 'assign_project',
        deliveryProjectId: item.epicAssociation.proposedDeliveryProjectId,
        expectedCurrentValue: item.epicAssociation.currentDeliveryProjectId
      });
    }
  });
  if (!decisions.length) { externalFeedError = 'Select at least one field or approve a new work item.'; transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]); return; }
  if (!confirm(`Apply ${decisions.filter(item => item.decision === 'replace').length} approved field change(s) and ${decisions.filter(item => item.action === 'create').length} creation(s)?`)) return;
  const response = await fetch('/api/project/external-feed/apply', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: selectedProject, transcriptId: externalFeedPendingId, decisions }) });
  const result = await response.json().catch(() => ({ error: 'Unable to apply approved changes.' }));
  if (!response.ok) { externalFeedError = result.error || 'Unable to apply approved changes.'; transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]); return; }
  const uncreatedCount = externalFeedPreview.items.filter(item => item.matchType === 'new' && !externalFeedCreates.has(item.jiraId)).length;
  resetExternalFeedState();
  externalFeedCompletionFeedback = `${result.applied} field change${result.applied === 1 ? '' : 's'} applied to ${result.updated || 0} existing work item${result.updated === 1 ? '' : 's'}; ${result.created} new work item${result.created === 1 ? '' : 's'} created${uncreatedCount ? `; ${uncreatedCount} new proposal${uncreatedCount === 1 ? '' : 's'} not created` : ''}. Reconciliation preview cleared.`;
  await refreshProject();
}

async function resetExternalFeed() {
  if (externalFeedPendingId) {
    if (!confirm('Delete this pending external feed?')) return;
    const response = await fetch(`/api/project/external-feed?project=${encodeURIComponent(selectedProject)}&transcriptId=${encodeURIComponent(externalFeedPendingId)}`, { method: 'DELETE' });
    if (!response.ok) { externalFeedError = 'Unable to delete the pending feed.'; transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]); return; }
  }
  resetExternalFeedState();
  await refreshProject();
}

function renderFindingReviewQueue(project) {
  const allItems = (project.transcripts || []).flatMap(transcript =>
    (transcript.extractedFindings || [])
      .filter(finding => !(transcript.type === 'DSU' && finding.category === 'progress_update'))
      .map(finding => ({ transcript, finding }))
  ).sort((a, b) => {
    if (a.finding.reviewStatus === 'pending' && b.finding.reviewStatus !== 'pending') return -1;
    if (b.finding.reviewStatus === 'pending' && a.finding.reviewStatus !== 'pending') return 1;
    return String(b.finding.createdAt || '').localeCompare(String(a.finding.createdAt || ''));
  });
  const pendingItems = allItems.filter(({ finding }) => (finding.reviewStatus || 'pending') === 'pending');
  const items = evidenceShowReviewed ? allItems : pendingItems;
  const pendingKeys = new Set(pendingItems
    .filter(({ finding }) => (finding.reviewStatus || 'pending') === 'pending')
    .map(({ transcript, finding }) => findingSelectionKey(transcript.id, finding.id)));
  findingSelections = new Set([...findingSelections].filter(key => pendingKeys.has(key)));
  findingReviewDrafts = new Map([...findingReviewDrafts].filter(([key]) => pendingKeys.has(key)));
  const findingPageCount = Math.max(1, Math.ceil(items.length / CAPTURE_LIST_PAGE_SIZE));
  const findingPage = Math.min(captureListPages.findings, findingPageCount - 1);
  const visibleItems = items.slice(findingPage * CAPTURE_LIST_PAGE_SIZE, (findingPage + 1) * CAPTURE_LIST_PAGE_SIZE);
  const visiblePendingItems = visibleItems.filter(({ finding }) => (finding.reviewStatus || 'pending') === 'pending');
  const pageSelectionChecked = visiblePendingItems.length > 0 && visiblePendingItems.every(({ transcript, finding }) => findingSelections.has(findingSelectionKey(transcript.id, finding.id)));
  const queueExpanded = captureExpandedSections.has('evidenceQueue');

  const rows = visibleItems.map(({ transcript, finding }) => {
    const key = encodeURIComponent(finding.id);
    const status = finding.reviewStatus || 'pending';
    const selectedStory = finding.storyId || '';
    const draft = findingReviewDrafts.get(findingSelectionKey(transcript.id, finding.id)) || {};
    const reviewedStory = draft.storyId ?? selectedStory;
    const reviewedSummary = draft.summary ?? finding.summary ?? '';
    const exactExcerpt = finding.exactExcerpt || finding.excerpt || '';
    const compactExcerpt = exactExcerpt.length > 150 ? `${exactExcerpt.slice(0, 150)}…` : exactExcerpt;
    const selectionKey = findingSelectionKey(transcript.id, finding.id);
    const selector = status === 'pending' ? `<label class="finding-select-control">
      <input class="finding-select-checkbox" type="checkbox" data-transcript-id="${escapeHtml(transcript.id)}" data-finding-id="${escapeHtml(finding.id)}" aria-label="Select ${escapeHtml(String(finding.category || 'finding').replace(/_/g, ' '))}" ${findingSelections.has(selectionKey) ? 'checked' : ''} data-onchange="toggleFindingSelection(${escapeHtml(JSON.stringify(transcript.id))}, ${escapeHtml(JSON.stringify(finding.id))}, this.checked)" />
    </label>` : '<span class="finding-select-spacer" aria-hidden="true"></span>';
    const controls = status === 'pending' ? `
      <div class="finding-review-controls">
        <select id="finding-story-${key}" aria-label="Linked work item" data-onchange="updateFindingDraft(${escapeHtml(JSON.stringify(transcript.id))}, ${escapeHtml(JSON.stringify(finding.id))}, 'storyId', this.value)">
          <option value="">No linked work item</option>
          ${(project.stories || []).map(story => `<option value="${escapeHtml(story.id)}" ${reviewedStory === story.id ? 'selected' : ''}>${escapeHtml(story.jiraId ? `${story.jiraId} · ${story.summary}` : story.summary)}</option>`).join('')}
        </select>
        <input id="finding-summary-${key}" value="${escapeHtml(reviewedSummary)}" aria-label="Reviewed summary" data-oninput="updateFindingDraft(${escapeHtml(JSON.stringify(transcript.id))}, ${escapeHtml(JSON.stringify(finding.id))}, 'summary', this.value)" />
        <button class="button button-small" data-onclick="reviewFinding(${escapeHtml(JSON.stringify(transcript.id))}, ${escapeHtml(JSON.stringify(finding.id))}, 'accepted')">Accept</button>
        <button class="button button-small danger" data-onclick="reviewFinding(${escapeHtml(JSON.stringify(transcript.id))}, ${escapeHtml(JSON.stringify(finding.id))}, 'rejected')">Reject</button>
      </div>` : `
      <button class="button button-small secondary" data-onclick="reviewFinding(${escapeHtml(JSON.stringify(transcript.id))}, ${escapeHtml(JSON.stringify(finding.id))}, 'pending')">Review again</button>`;
    return `<li class="finding-list-item">${selector}<details class="finding-card ${escapeHtml(status)}">
      <summary class="finding-card-summary">
        <span class="finding-heading"><strong>${escapeHtml(String(finding.category || 'finding').replace(/_/g, ' '))}</strong><span class="badge ${status === 'accepted' ? 'done' : status === 'rejected' ? 'blocked' : 'inprogress'}">${escapeHtml(status)}</span></span>
        <span class="finding-preview">${escapeHtml(compactExcerpt || 'No excerpt available.')}</span>
      </summary>
      <div class="finding-card-body">
        <blockquote>${escapeHtml(exactExcerpt)}</blockquote>
        <div class="micro" style="text-transform:none;">${escapeHtml(transcript.title || 'Untitled source')} · ${escapeHtml(transcript.type || '')}${finding.associationReason ? ` · ${escapeHtml(finding.associationReason)}` : ''}</div>
        ${controls}
      </div>
    </details></li>`;
  }).join('');
  const emptyMessage = evidenceShowReviewed
    ? 'No evidence findings are available.'
    : 'No pending evidence findings. Turn on Show reviewed to view the audit history.';
  return `<div class="card finding-review-card">
    ${captureSectionHeading('evidenceQueue', 'Evidence Review Queue', 'Open one finding to review', queueExpanded, `${pendingItems.length} pending`)}
    ${queueExpanded ? `<p>Pending non-DSU evidence appears here. Open a finding to verify its exact excerpt, work-item link, and summary.</p>
      ${evidenceReviewFeedback ? `<div class="capture-upload-feedback ${evidenceReviewFeedback.warning ? 'warning' : ''}">${escapeHtml(evidenceReviewFeedback.message)}</div>` : ''}
      <div class="finding-bulk-controls">
        <label class="external-feed-choice"><input id="finding-select-page" type="checkbox" ${pageSelectionChecked ? 'checked' : ''} ${visiblePendingItems.length ? '' : 'disabled'} data-onchange="toggleFindingPageSelection(this.checked)" /> Select page</label>
        <button id="finding-clear-selected" class="button button-small secondary" ${findingSelections.size ? '' : 'disabled'} data-onclick="clearFindingSelection()">Clear selection</button>
        <button id="finding-accept-selected" class="button button-small" ${findingSelections.size ? '' : 'disabled'} data-onclick="acceptSelectedFindings()">Accept selected (${findingSelections.size})</button>
        <button id="finding-reject-selected" class="button button-small danger" ${findingSelections.size ? '' : 'disabled'} data-onclick="rejectSelectedFindings()">Reject selected (${findingSelections.size})</button>
        <label class="external-feed-choice"><input type="checkbox" ${evidenceShowReviewed ? 'checked' : ''} data-onchange="toggleEvidenceShowReviewed(this.checked)" /> Show reviewed</label>
      </div>
      ${items.length ? `<ul class="finding-list">${rows}</ul>${capturePagination('findings', findingPage, items.length, 'findings')}` : `<p class="capture-empty-state">${escapeHtml(emptyMessage)}</p>`}` : ''}
  </div>`;
}

function findingSelectionKey(transcriptId, findingId) {
  return `${transcriptId}\u0000${findingId}`;
}

function updateFindingBulkControls() {
  const acceptButton = document.getElementById('finding-accept-selected');
  const rejectButton = document.getElementById('finding-reject-selected');
  const clearButton = document.getElementById('finding-clear-selected');
  if (acceptButton) {
    acceptButton.disabled = findingSelections.size === 0;
    acceptButton.textContent = `Accept selected (${findingSelections.size})`;
  }
  if (rejectButton) {
    rejectButton.disabled = findingSelections.size === 0;
    rejectButton.textContent = `Reject selected (${findingSelections.size})`;
  }
  if (clearButton) clearButton.disabled = findingSelections.size === 0;
  const visibleCheckboxes = [...document.querySelectorAll('.finding-select-checkbox')];
  const selectPage = document.getElementById('finding-select-page');
  if (selectPage) {
    const selectedCount = visibleCheckboxes.filter(input => input.checked).length;
    selectPage.checked = visibleCheckboxes.length > 0 && selectedCount === visibleCheckboxes.length;
    selectPage.indeterminate = selectedCount > 0 && selectedCount < visibleCheckboxes.length;
  }
}

function toggleFindingSelection(transcriptId, findingId, checked) {
  const key = findingSelectionKey(transcriptId, findingId);
  if (checked) findingSelections.add(key); else findingSelections.delete(key);
  updateFindingBulkControls();
}

function updateFindingDraft(transcriptId, findingId, field, value) {
  if (!['storyId', 'summary'].includes(field)) return;
  const key = findingSelectionKey(transcriptId, findingId);
  findingReviewDrafts.set(key, { ...(findingReviewDrafts.get(key) || {}), [field]: value });
}

function toggleFindingPageSelection(checked) {
  document.querySelectorAll('.finding-select-checkbox').forEach(input => {
    const key = findingSelectionKey(input.dataset.transcriptId, input.dataset.findingId);
    if (checked) findingSelections.add(key); else findingSelections.delete(key);
    input.checked = checked;
  });
  updateFindingBulkControls();
}

function clearFindingSelection() {
  findingSelections.clear();
  document.querySelectorAll('.finding-select-checkbox').forEach(input => { input.checked = false; });
  updateFindingBulkControls();
}

function toggleEvidenceShowReviewed(checked) {
  evidenceShowReviewed = Boolean(checked);
  captureListPages.findings = 0;
  if (selectedProject) transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}

async function acceptSelectedFindings() {
  await reviewSelectedFindings('accepted');
}

async function rejectSelectedFindings() {
  await reviewSelectedFindings('rejected');
}

async function reviewSelectedFindings(reviewStatus) {
  if (!['accepted', 'rejected'].includes(reviewStatus)) return;
  if (!findingSelections.size) return;
  if (findingSelections.size > 100) {
    evidenceReviewFeedback = { warning: true, message: 'Review up to 100 evidence findings at a time.' };
    transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
    return;
  }
  const decisions = (projects[selectedProject]?.transcripts || []).flatMap(transcript =>
    (transcript.extractedFindings || []).filter(finding => findingSelections.has(findingSelectionKey(transcript.id, finding.id)))
      .map(finding => {
        const key = encodeURIComponent(finding.id);
        const draft = findingReviewDrafts.get(findingSelectionKey(transcript.id, finding.id)) || {};
        return {
          transcriptId: transcript.id,
          findingId: finding.id,
          storyId: document.getElementById(`finding-story-${key}`)?.value ?? draft.storyId ?? finding.storyId ?? '',
          summary: document.getElementById(`finding-summary-${key}`)?.value ?? draft.summary ?? finding.summary ?? ''
        };
      })
  );
  const action = reviewStatus === 'accepted' ? 'Accept' : 'Reject';
  const historyNote = reviewStatus === 'rejected' ? ' Rejected findings remain in review history and can be reopened individually.' : '';
  if (!decisions.length || !confirm(`${action} ${decisions.length} selected evidence finding${decisions.length === 1 ? '' : 's'}?${historyNote}`)) return;
  const response = await fetch('/api/project/transcript/findings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: selectedProject, reviewStatus, decisions })
  });
  const result = await response.json();
  if (!response.ok) {
    evidenceReviewFeedback = { warning: true, message: result.error || 'The selected findings could not be reviewed.' };
    transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
    return;
  }
  findingSelections.clear();
  findingReviewDrafts.clear();
  const reviewedCount = result.reviewed ?? (reviewStatus === 'accepted' ? result.accepted : result.rejected) ?? decisions.length;
  evidenceReviewFeedback = { warning: false, message: `${reviewedCount} evidence finding${reviewedCount === 1 ? '' : 's'} ${reviewStatus}. Queue refreshed.` };
  await refreshProject();
}

async function reviewFinding(transcriptId, findingId, reviewStatus) {
  const key = encodeURIComponent(findingId);
  const storyId = document.getElementById(`finding-story-${key}`)?.value;
  const summary = document.getElementById(`finding-summary-${key}`)?.value;
  const response = await fetch('/api/project/transcript/finding', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: selectedProject, transcriptId, findingId, reviewStatus, storyId, summary })
  });
  const result = await response.json();
  if (!response.ok) {
    evidenceReviewFeedback = { warning: true, message: result.error || 'The finding could not be reviewed.' };
    transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
    return;
  }
  findingSelections.delete(findingSelectionKey(transcriptId, findingId));
  findingReviewDrafts.delete(findingSelectionKey(transcriptId, findingId));
  evidenceReviewFeedback = { warning: false, message: `Finding ${reviewStatus}. Queue refreshed.` };
  await refreshProject();
}

function transcriptEditRow(t) {
  const types = CAPTURE_SOURCE_TYPES;
  return `
    <li class="card" style="border-color:var(--accent);box-shadow:0 0 0 3px rgba(58,111,214,0.12);">
      <div style="margin-bottom:12px;"><strong style="color:var(--accent);">Editing transcript</strong></div>
      <div class="form-grid">
        <div class="form-row"><label>Title</label><input id="edit-transcript-title" value="${escapeHtml(t.title || '')}" /></div>
        <div class="field-row">
          <div><label>Type</label>
            <select id="edit-transcript-type">
              ${types.map(o => `<option ${((t.type || '') === o) ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
          </div>
          <div><label>Date</label><input id="edit-transcript-date" type="date" value="${escapeHtml((t.date || '').slice(0, 10))}" /></div>
        </div>
        <div class="form-row"><label>Notes</label><textarea id="edit-transcript-notes">${escapeHtml(t.notes || '')}</textarea></div>
        <div class="note">Saving source edits invalidates prior review decisions from this source and creates a fresh pending review queue.</div>
        <div style="display:flex;gap:8px;">
          <button class="button" data-onclick="saveTranscriptEdit('${t.id}')">Save</button>
          <button class="button secondary" data-onclick="cancelTranscriptEdit()">Cancel</button>
        </div>
      </div>
    </li>`;
}

function dzOver(e) { e.preventDefault(); const dz = document.getElementById('dropzone'); if (dz) dz.classList.add('dragover'); }
function dzLeave(e) { e.preventDefault(); const dz = document.getElementById('dropzone'); if (dz) dz.classList.remove('dragover'); }
function dzDrop(e) {
  e.preventDefault();
  const dz = document.getElementById('dropzone'); if (dz) dz.classList.remove('dragover');
  setSelectedCaptureFiles(Array.from((e.dataTransfer && e.dataTransfer.files) || []));
}
function dzFileChosen() {
  const input = document.getElementById('transcript-file');
  setSelectedCaptureFiles(Array.from((input && input.files) || []));
}

function setSelectedCaptureFiles(files) {
  const limited = files.slice(0, 5);
  captureSelectedFiles = limited.map(file => ({ file, title: file.name, type: 'DSU' }));
  captureUploadFeedback = files.length > 5 ? { warning: true, message: 'Only the first five files were selected.' } : null;
  if (selectedProject) transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}

function renderSelectedCaptureFiles() {
  if (!captureSelectedFiles.length) return '<div class="capture-selection-empty">Select files to set each source title and type before upload.</div>';
  return `<div class="capture-file-list">
    <div class="section-heading"><h4>Selected sources</h4><span class="micro">${captureSelectedFiles.length} of 5 ready</span></div>
    ${captureSelectedFiles.map((item, index) => `<div class="capture-file-row">
      <span class="mono">${index + 1}</span>
      <input value="${escapeHtml(item.title)}" aria-label="Title for ${escapeHtml(item.file.name)}" data-onchange="updateCaptureFile(${index}, 'title', this.value)" />
      <select aria-label="Type for ${escapeHtml(item.file.name)}" data-onchange="updateCaptureFile(${index}, 'type', this.value)">
        ${CAPTURE_SOURCE_TYPES.map(type => `<option value="${escapeHtml(type)}" ${item.type === type ? 'selected' : ''}>${escapeHtml(type)}${['DSU', 'Sprint Planning', 'Backlog Refinement'].includes(type) ? ' (review first)' : ''}</option>`).join('')}
      </select>
      <button class="button button-small secondary" data-onclick="removeCaptureFile(${index})">Remove</button>
    </div>`).join('')}
  </div>`;
}

function updateCaptureFile(index, field, value) {
  if (captureSelectedFiles[index]) captureSelectedFiles[index][field] = value;
}

function removeCaptureFile(index) {
  captureSelectedFiles.splice(index, 1);
  if (selectedProject) transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}

function startTranscriptEdit(id) {
  transcriptEditing = id;
  if (selectedProject) transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}
function cancelTranscriptEdit() {
  transcriptEditing = null;
  if (selectedProject) transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}
async function saveTranscriptEdit(id) {
  const val = i => { const el = document.getElementById(i); return el ? el.value : undefined; };
  await fetch('/api/project/transcript', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: selectedProject, id, title: val('edit-transcript-title'), type: val('edit-transcript-type'), date: val('edit-transcript-date'), notes: val('edit-transcript-notes') })
  });
  transcriptEditing = null;
  await refreshProject();
}

function renderProjectUpdatesCard(projectName, project) {
  const storyMap = new Map((project.stories || []).map(story => [story.id, story]));
  const findingItems = (project.transcripts || []).flatMap(transcript =>
    transcript.type === 'DSU'
      ? (transcript.extractedFindings || [])
        .filter(finding => finding.category === 'progress_update')
        .map(finding => ({ transcript, finding, legacy: false }))
      : []
  ).sort((a, b) => {
    if ((a.finding.reviewStatus || 'pending') === 'pending' && (b.finding.reviewStatus || 'pending') !== 'pending') return -1;
    if ((b.finding.reviewStatus || 'pending') === 'pending' && (a.finding.reviewStatus || 'pending') !== 'pending') return 1;
    return String(b.finding.createdAt || b.transcript.date || '').localeCompare(String(a.finding.createdAt || a.transcript.date || ''));
  });
  const knownFindingIds = new Set(findingItems.map(item => item.finding.id));
  const legacyItems = [];
  (project.stories || []).forEach(story => {
    (story.updates || []).forEach(update => {
      if (update.findingId && knownFindingIds.has(update.findingId)) return;
      legacyItems.push({
        legacy: true,
        story,
        update,
        transcript: { id: update.transcriptId || '', title: update.transcriptTitle || 'Legacy source', type: 'DSU' },
        finding: {
          id: update.findingId || update.id,
          storyId: story.id,
          summary: update.update || update.excerpt || '',
          exactExcerpt: update.excerpt || update.update || '',
          reviewStatus: 'accepted',
          createdAt: update.date || ''
        }
      });
    });
  });
  const pendingItems = findingItems.filter(item => (item.finding.reviewStatus || 'pending') === 'pending');
  const items = dsuShowReviewed ? [...findingItems, ...legacyItems] : pendingItems;
  const pendingKeys = new Set(pendingItems.map(({ transcript, finding }) => findingSelectionKey(transcript.id, finding.id)));
  dsuSelections = new Set([...dsuSelections].filter(key => pendingKeys.has(key)));
  dsuReviewDrafts = new Map([...dsuReviewDrafts].filter(([key]) => pendingKeys.has(key)));
  const updatePageCount = Math.max(1, Math.ceil(items.length / CAPTURE_LIST_PAGE_SIZE));
  const updatePage = Math.min(captureListPages.updates, updatePageCount - 1);
  const visibleItems = items.slice(updatePage * CAPTURE_LIST_PAGE_SIZE, (updatePage + 1) * CAPTURE_LIST_PAGE_SIZE);
  const visiblePendingItems = visibleItems.filter(item => !item.legacy && (item.finding.reviewStatus || 'pending') === 'pending');
  const pageSelectionChecked = visiblePendingItems.length > 0 && visiblePendingItems.every(({ transcript, finding }) => dsuSelections.has(findingSelectionKey(transcript.id, finding.id)));
  const updatesExpanded = captureExpandedSections.has('dsuUpdates');

  const rows = visibleItems.map(({ transcript, finding, legacy }) => {
    const status = finding.reviewStatus || 'pending';
    const selectionKey = findingSelectionKey(transcript.id, finding.id);
    const draft = dsuReviewDrafts.get(selectionKey) || {};
    const reviewedStory = draft.storyId ?? finding.storyId ?? '';
    const reviewedSummary = draft.summary ?? finding.summary ?? '';
    const story = storyMap.get(reviewedStory);
    const storyLabel = story ? (story.jiraId ? `${story.jiraId} · ${story.summary}` : story.summary) : 'No linked work item';
    const exactExcerpt = finding.exactExcerpt || finding.excerpt || '';
    const compactExcerpt = exactExcerpt.length > 150 ? `${exactExcerpt.slice(0, 150)}…` : exactExcerpt;
    const selector = status === 'pending' && !legacy ? `<label class="finding-select-control">
      <input class="dsu-select-checkbox" type="checkbox" data-transcript-id="${escapeHtml(transcript.id)}" data-finding-id="${escapeHtml(finding.id)}" aria-label="Select DSU update for ${escapeHtml(storyLabel)}" ${dsuSelections.has(selectionKey) ? 'checked' : ''} data-onchange="toggleDsuSelection(${escapeHtml(JSON.stringify(transcript.id))}, ${escapeHtml(JSON.stringify(finding.id))}, this.checked)" />
    </label>` : '<span class="finding-select-spacer" aria-hidden="true"></span>';
    const controls = status === 'pending' && !legacy ? `<div class="finding-review-controls">
      <select id="dsu-story-${escapeHtml(encodeURIComponent(finding.id))}" aria-label="Linked work item" data-onchange="updateDsuDraft(${escapeHtml(JSON.stringify(transcript.id))}, ${escapeHtml(JSON.stringify(finding.id))}, 'storyId', this.value)">
        <option value="">No linked work item</option>
        ${(project.stories || []).map(item => `<option value="${escapeHtml(item.id)}" ${reviewedStory === item.id ? 'selected' : ''}>${escapeHtml(item.jiraId ? `${item.jiraId} · ${item.summary}` : item.summary)}</option>`).join('')}
      </select>
      <input id="dsu-summary-${escapeHtml(encodeURIComponent(finding.id))}" value="${escapeHtml(reviewedSummary)}" aria-label="Reviewed DSU summary" data-oninput="updateDsuDraft(${escapeHtml(JSON.stringify(transcript.id))}, ${escapeHtml(JSON.stringify(finding.id))}, 'summary', this.value)" />
    </div>` : '';
    const historyControls = status !== 'pending' && !legacy ? `<div style="display:flex;gap:8px;margin-top:12px;">
      ${status === 'accepted' ? `<button class="button button-small secondary js-copy-text" data-copy-key="${registerCopyPayload(`Work item: ${storyLabel}\nUpdate: ${exactExcerpt || reviewedSummary || 'Follow up from DSU transcript.'}\nSource: ${transcript.title || 'Unknown'}`)}">Copy</button>` : ''}
      <button class="button button-small secondary" data-onclick="reviewDsuFindingAgain(${escapeHtml(JSON.stringify(transcript.id))}, ${escapeHtml(JSON.stringify(finding.id))})">Review again</button>
    </div>` : '';
    return `<li class="finding-list-item">${selector}<details class="finding-card ${escapeHtml(status)}">
      <summary class="finding-card-summary">
        <span class="finding-heading"><strong>${escapeHtml(storyLabel)}</strong><span class="badge ${status === 'accepted' ? 'done' : status === 'rejected' ? 'blocked' : 'inprogress'}">${escapeHtml(legacy ? 'accepted · legacy' : status)}</span></span>
        <span class="finding-preview">${escapeHtml(compactExcerpt || reviewedSummary || 'No excerpt available.')}</span>
      </summary>
      <div class="finding-card-body">
        <blockquote>${escapeHtml(exactExcerpt || reviewedSummary)}</blockquote>
        <div class="micro" style="text-transform:none;">${escapeHtml(transcript.title || 'Untitled DSU source')}${finding.associationReason ? ` · ${escapeHtml(finding.associationReason)}` : ''}</div>
        ${legacy ? '<p class="micro source-reference-note">Legacy update: no reviewable source finding is available.</p>' : ''}
        ${controls}${historyControls}
      </div>
    </details></li>`;
  }).join('');
  const emptyMessage = dsuShowReviewed
    ? 'No DSU progress findings or legacy updates are available.'
    : 'No pending DSU updates. Turn on Show reviewed to view accepted and rejected history.';

  return `
    <div class="card finding-review-card">
      ${captureSectionHeading('dsuUpdates', 'Extracted DSU updates', 'Review DSU progress excerpts', updatesExpanded, `${pendingItems.length} pending`)}
      ${updatesExpanded ? `<p style="margin:0 0 10px;">Accepting a linked DSU progress excerpt creates its work-item update. Rejection creates no update.</p>
        ${dsuReviewFeedback ? `<div class="capture-upload-feedback ${dsuReviewFeedback.warning ? 'warning' : ''}">${escapeHtml(dsuReviewFeedback.message)}</div>` : ''}
        <div class="finding-bulk-controls">
          <label class="external-feed-choice"><input id="dsu-select-page" type="checkbox" ${pageSelectionChecked ? 'checked' : ''} ${visiblePendingItems.length ? '' : 'disabled'} data-onchange="toggleDsuPageSelection(this.checked)" /> Select page</label>
          <button id="dsu-clear-selected" class="button button-small secondary" ${dsuSelections.size ? '' : 'disabled'} data-onclick="clearDsuSelection()">Clear selection</button>
          <button id="dsu-accept-selected" class="button button-small" ${dsuSelections.size ? '' : 'disabled'} data-onclick="acceptSelectedDsuUpdates()">Accept selected (${dsuSelections.size})</button>
          <button id="dsu-reject-selected" class="button button-small danger" ${dsuSelections.size ? '' : 'disabled'} data-onclick="rejectSelectedDsuUpdates()">Reject selected (${dsuSelections.size})</button>
          <label class="external-feed-choice"><input type="checkbox" ${dsuShowReviewed ? 'checked' : ''} data-onchange="toggleDsuShowReviewed(this.checked)" /> Show reviewed</label>
        </div>
        ${items.length ? `<ul class="finding-list">${rows}</ul>${capturePagination('updates', updatePage, items.length, 'updates')}` : `<p class="capture-empty-state">${escapeHtml(emptyMessage)}</p>`}` : ''}
    </div>
  `;
}

function updateDsuBulkControls() {
  const acceptButton = document.getElementById('dsu-accept-selected');
  const rejectButton = document.getElementById('dsu-reject-selected');
  const clearButton = document.getElementById('dsu-clear-selected');
  if (acceptButton) {
    acceptButton.disabled = dsuSelections.size === 0;
    acceptButton.textContent = `Accept selected (${dsuSelections.size})`;
  }
  if (rejectButton) {
    rejectButton.disabled = dsuSelections.size === 0;
    rejectButton.textContent = `Reject selected (${dsuSelections.size})`;
  }
  if (clearButton) clearButton.disabled = dsuSelections.size === 0;
  const visibleCheckboxes = [...document.querySelectorAll('.dsu-select-checkbox')];
  const selectPage = document.getElementById('dsu-select-page');
  if (selectPage) {
    const selectedCount = visibleCheckboxes.filter(input => input.checked).length;
    selectPage.checked = visibleCheckboxes.length > 0 && selectedCount === visibleCheckboxes.length;
    selectPage.indeterminate = selectedCount > 0 && selectedCount < visibleCheckboxes.length;
  }
}

function toggleDsuSelection(transcriptId, findingId, checked) {
  const key = findingSelectionKey(transcriptId, findingId);
  if (checked) dsuSelections.add(key); else dsuSelections.delete(key);
  updateDsuBulkControls();
}

function updateDsuDraft(transcriptId, findingId, field, value) {
  if (!['storyId', 'summary'].includes(field)) return;
  const key = findingSelectionKey(transcriptId, findingId);
  dsuReviewDrafts.set(key, { ...(dsuReviewDrafts.get(key) || {}), [field]: value });
}

function toggleDsuPageSelection(checked) {
  document.querySelectorAll('.dsu-select-checkbox').forEach(input => {
    const key = findingSelectionKey(input.dataset.transcriptId, input.dataset.findingId);
    if (checked) dsuSelections.add(key); else dsuSelections.delete(key);
    input.checked = checked;
  });
  updateDsuBulkControls();
}

function clearDsuSelection() {
  dsuSelections.clear();
  document.querySelectorAll('.dsu-select-checkbox').forEach(input => { input.checked = false; });
  updateDsuBulkControls();
}

function toggleDsuShowReviewed(checked) {
  dsuShowReviewed = Boolean(checked);
  captureListPages.updates = 0;
  if (selectedProject) transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}

async function acceptSelectedDsuUpdates() {
  await reviewSelectedDsuUpdates('accepted');
}

async function rejectSelectedDsuUpdates() {
  await reviewSelectedDsuUpdates('rejected');
}

async function reviewSelectedDsuUpdates(reviewStatus) {
  if (!['accepted', 'rejected'].includes(reviewStatus) || !dsuSelections.size) return;
  if (dsuSelections.size > 100) {
    dsuReviewFeedback = { warning: true, message: 'Review up to 100 DSU updates at a time.' };
    transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
    return;
  }
  const decisions = (projects[selectedProject]?.transcripts || []).flatMap(transcript =>
    transcript.type === 'DSU' ? (transcript.extractedFindings || [])
      .filter(finding => finding.category === 'progress_update' && dsuSelections.has(findingSelectionKey(transcript.id, finding.id)))
      .map(finding => {
        const key = encodeURIComponent(finding.id);
        const draft = dsuReviewDrafts.get(findingSelectionKey(transcript.id, finding.id)) || {};
        return {
          transcriptId: transcript.id,
          findingId: finding.id,
          storyId: document.getElementById(`dsu-story-${key}`)?.value ?? draft.storyId ?? finding.storyId ?? '',
          summary: document.getElementById(`dsu-summary-${key}`)?.value ?? draft.summary ?? finding.summary ?? ''
        };
      }) : []
  );
  const action = reviewStatus === 'accepted' ? 'Accept' : 'Reject';
  if (!decisions.length || !confirm(`${action} ${decisions.length} selected DSU update${decisions.length === 1 ? '' : 's'}?`)) return;
  const response = await fetch('/api/project/transcript/findings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: selectedProject, reviewStatus, decisions })
  });
  const result = await response.json().catch(() => ({ error: 'The selected DSU updates could not be reviewed.' }));
  if (!response.ok) {
    dsuReviewFeedback = { warning: true, message: result.error || 'The selected DSU updates could not be reviewed.' };
    transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
    return;
  }
  dsuSelections.clear();
  dsuReviewDrafts.clear();
  const reviewedCount = result.reviewed ?? decisions.length;
  const consequence = reviewStatus === 'accepted' ? ' Work-item updates created.' : ' No work-item updates created.';
  dsuReviewFeedback = { warning: false, message: `${reviewedCount} DSU update${reviewedCount === 1 ? '' : 's'} ${reviewStatus}.${consequence} List refreshed.` };
  await refreshProject();
}

async function reviewDsuFindingAgain(transcriptId, findingId) {
  const response = await fetch('/api/project/transcript/finding', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: selectedProject, transcriptId, findingId, reviewStatus: 'pending' })
  });
  const result = await response.json().catch(() => ({ error: 'The DSU update could not be reopened.' }));
  if (!response.ok) {
    dsuReviewFeedback = { warning: true, message: result.error || 'The DSU update could not be reopened.' };
    transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
    return;
  }
  dsuReviewFeedback = { warning: false, message: 'DSU update reopened for review. List refreshed.' };
  dsuShowReviewed = false;
  captureListPages.updates = 0;
  await refreshProject();
}

function renderManagePanel() {
  const projectNames = Object.keys(projects);
  const filteredItems = getManageItems();

  const projectManagement = `
    <div class="card">
      <h4>PM Workspace Management</h4>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
        <button class="button" data-onclick="manageToggleNewProjectForm()">+ New PM Workspace</button>
      </div>
      ${showNewProjectForm ? `
        <div style="padding:12px;background:var(--accent-soft);border-radius:8px;border:1px solid var(--accent);margin-bottom:16px;">
          <div class="form-grid">
            <div class="form-row"><label>PM workspace name</label><input id="new-project-name" placeholder="PM workspace name" /></div>
            <div class="form-row"><label>Description</label><input id="new-project-description" placeholder="Description (optional)" /></div>
          </div>
          <div style="display:flex;gap:12px;margin-top:12px;">
            <button class="button button-small" data-onclick="addProject()">Create</button>
            <button class="button button-small secondary" data-onclick="manageToggleNewProjectForm()">Cancel</button>
          </div>
        </div>
      ` : ''}
      ${projectNames.length ? `
        <div>
          <p style="margin-bottom:12px;color:var(--muted);">PM workspaces (${projectNames.length}):</p>
          <ul class="panel-list" style="gap:8px;">
            ${projectNames.map(name => `
              <li class="card" style="padding:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
                <div style="flex:1;">
                  <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(name)}</div>
                  ${projects[name].description ? `<div style="font-size:0.85rem;color:var(--muted);">${escapeHtml(projects[name].description)}</div>` : ''}
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <button class="button button-small" data-onclick="selectProject(${escapeHtml(JSON.stringify(name))})" ${selectedProject === name ? 'disabled' : ''}>
                    ${selectedProject === name ? 'Current' : 'Select'}
                  </button>
                  <button class="button button-small danger" data-onclick="deleteProject(${escapeHtml(JSON.stringify(name))})" title="Delete this project">Delete</button>
                </div>
              </li>
            `).join('')}
          </ul>
        </div>
      ` : '<p style="color:var(--muted);">No PM workspaces yet. Create one above.</p>'}
    </div>`;

  const currentWorkspace = selectedProject ? projects[selectedProject] : null;
  const deliveryProjects = deliveryProjectsForWorkspace(currentWorkspace, true);
  const unassignedStories = (currentWorkspace?.stories || []).filter(story => !story.deliveryProjectId);
  const deliveryProjectManagement = currentWorkspace ? `
    <div class="card delivery-project-management-card">
      <div class="section-heading">
        <div>
          <h4>Projects / Jira Epics</h4>
          <p>Projects are delivery scopes inside ${escapeHtml(selectedProject)}. Link each one to an exact Jira Epic key or name; Priorena never guesses associations.</p>
        </div>
        <span class="micro">${deliveryProjects.filter(item => !item.archived).length} active</span>
      </div>
      <details style="margin-bottom:16px;">
        <summary>+ Add Project / Jira Epic</summary>
        <div class="form-grid" style="margin-top:12px;">
          <div class="form-row"><label>Project name</label><input id="delivery-project-name" maxlength="160" placeholder="Display name" /></div>
          <div class="form-row"><label>Jira Epic key</label><input id="delivery-project-epic-key" maxlength="40" placeholder="ABC-123" /></div>
          <div class="form-row"><label>Exact Jira Epic name</label><input id="delivery-project-epic-name" maxlength="300" placeholder="As shown in Jira" /></div>
          <div class="form-row"><label>Owner</label><input id="delivery-project-owner" maxlength="160" placeholder="Optional" /></div>
          <div class="form-row"><label>Planning target</label><input id="delivery-project-target" maxlength="160" placeholder="Optional; not a commitment" /></div>
          <div class="form-row"><label>Description</label><textarea id="delivery-project-description" maxlength="2000" rows="3" placeholder="Optional"></textarea></div>
        </div>
        <button class="button" data-onclick="createDeliveryProjectFromForm()">Create Project</button>
      </details>
      ${deliveryProjects.length ? `<ul class="panel-list" style="gap:8px;">
        ${deliveryProjects.map(item => `<li class="card" style="padding:12px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;${item.archived ? 'opacity:.65;' : ''}">
          <div>
            <div style="font-weight:700;">${escapeHtml(item.name)} ${item.archived ? '<span class="micro">archived</span>' : ''}</div>
            <div class="micro">${escapeHtml(item.jiraEpicKey || 'No Jira Epic key')}${item.jiraEpicName ? ` · ${escapeHtml(item.jiraEpicName)}` : ''}</div>
            ${item.owner || item.planningTarget ? `<div style="margin-top:6px;color:var(--muted);font-size:.86rem;">${item.owner ? `Owner: ${escapeHtml(item.owner)}` : ''}${item.owner && item.planningTarget ? ' · ' : ''}${item.planningTarget ? `Target: ${escapeHtml(item.planningTarget)}` : ''}</div>` : ''}
          </div>
          <button class="button button-small ${item.archived ? 'secondary' : 'danger'}" data-onclick="archiveDeliveryProject('${escapeHtml(item.id)}', ${item.archived ? 'false' : 'true'})">${item.archived ? 'Restore' : 'Archive'}</button>
        </li>`).join('')}
      </ul>` : '<p class="note">No Projects have been defined in this PM workspace.</p>'}
      <div style="margin-top:18px;border-top:1px solid var(--border);padding-top:16px;">
        <h4 style="margin-bottom:4px;">Association review</h4>
        <p>Assign only the work items you select. Unassigned items stay visible here for later review.</p>
        ${unassignedStories.length && deliveryProjects.some(item => !item.archived) ? `
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
            <select id="association-project">${deliveryProjectOptions(currentWorkspace)}</select>
            <button class="button" data-onclick="assignSelectedWorkItems()" ${deliveryProjectSelections.size ? '' : 'disabled'}>Assign selected (${deliveryProjectSelections.size})</button>
          </div>
          <ul class="panel-list" style="max-height:280px;overflow:auto;">
            ${unassignedStories.map(story => `<li class="card" style="padding:10px;display:flex;gap:10px;align-items:flex-start;">
              <input type="checkbox" ${deliveryProjectSelections.has(story.id) ? 'checked' : ''} data-onchange="toggleDeliveryProjectSelection('${escapeHtml(story.id)}', this.checked)" aria-label="Select ${escapeHtml(story.jiraId || story.summary)}" />
              <div><strong>${escapeHtml(story.jiraId || 'No Jira key')}</strong> · ${escapeHtml(story.summary || 'Untitled work item')}</div>
            </li>`).join('')}
          </ul>` : `<p class="note">${unassignedStories.length ? 'Create an active Project before assigning work items.' : 'All current work items have a Project association.'}</p>`}
      </div>
    </div>` : `
    <div class="card delivery-project-management-card">
      <h4>Projects / Jira Epics</h4>
      <p>Select a PM workspace to manage its Projects and work-item associations.</p>
    </div>`;

  const promptEditor = `
    <div class="card advanced-settings-card">
      <details>
        <summary>Advanced: AI prompt templates</summary>
        <p>DSU extraction is deterministic. This optional template controls the AI status-summary draft only; most users can leave it unchanged.</p>
        <div class="form-row"><label>Status report prompt</label><textarea id="ai-prompt-status-report" rows="6">${escapeHtml(aiPrompts.statusReport)}</textarea></div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <button class="button" data-onclick="saveAiPrompts()">Save AI Prompts</button>
          <span style="color:var(--success);">${aiPromptStatus}</span>
        </div>
      </details>
    </div>`;

  const workspaceSettings = `
    <div class="card">
      <h4>Workspace Settings</h4>
      <p>Control the cross-project sprint dropdown and follow-up freshness rules used across the console.</p>
      <div class="form-grid">
        <div class="form-row">
          <label>Quiet thread threshold (days)</label>
          <input id="settings-comment-stale-days" type="number" min="1" max="365" value="${escapeHtml(settings.commentStaleDays)}" />
        </div>
        <div class="form-row">
          <label>Sprint catalog</label>
          <textarea id="settings-sprint-options" rows="6" placeholder="One sprint per line">${escapeHtml((settings.sprintOptions || []).join('\n'))}</textarea>
          <div class="micro" style="margin-top:6px;text-transform:none;">Used as the controlled dropdown everywhere Sprint appears.</div>
        </div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <button class="button" data-onclick="saveWorkspaceSettings()">Save Workspace Settings</button>
      </div>
    </div>`;

  const backupControls = `
    <div class="card workspace-backup-card">
      <h4>Workspace Backup</h4>
      <p>Download a complete JSON snapshot of all projects, work items, milestones, captured records, prompts, and workspace settings.</p>
      <div class="note">This backs up the workspace data file. Uploaded transcript files are not included.</div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:14px;">
        <button class="button" data-onclick="downloadWorkspaceBackup()">Download JSON Backup</button>
      </div>
    </div>`;

  const aiDraftingSettings = `
    <div class="card">
      <h4>AI Drafting</h4>
      <p>${aiProvider ? `Connected to ${escapeHtml(aiProvider)}. AI is available only as a reviewable draft on Status Summary and Teams Draft.` : 'Not connected. The app remains fully usable with grounded drafts. Add an OpenAI or Claude API key in web/.env, then restart the app to enable optional AI drafts.'}</p>
      <div class="note">DSU extraction always uses deterministic evidence matching. AI never automatically saves changes or sends a message.</div>
    </div>`;

  const projectDirectory = (selectedProject && projects[selectedProject]?.assigneeDirectory) || {};
  const directoryToDisplay = Object.keys(projectDirectory).length ? projectDirectory : ASSIGNEE_DIRECTORY_STARTER;
  const assigneeDirectorySettings = selectedProject ? `
    <div class="card assignee-directory-card">
      <div class="section-heading">
        <div>
          <h4>Assignee Directory</h4>
          <p>For ${escapeHtml(selectedProject)}. Map Jira usernames to the names you want to see throughout this PM workspace.</p>
        </div>
        <span class="micro">workspace-specific</span>
      </div>
      <div class="form-row">
        <label>Jira username = Full name</label>
        <textarea id="project-assignee-directory" rows="12" spellcheck="false">${escapeHtml(Object.entries(directoryToDisplay).sort(([a], [b]) => a.localeCompare(b)).map(([alias, name]) => `${alias} = ${name}`).join('\n'))}</textarea>
        <div class="micro form-help">One mapping per line. Saving also updates existing matching work items. Future CSV imports use this directory automatically.</div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <button class="button" data-onclick="saveAssigneeDirectory()">Save and update work items</button>
      </div>
    </div>` : `
    <div class="card assignee-directory-card">
      <h4>Assignee Directory</h4>
      <p>Select a PM workspace from the sidebar to manage its Jira username mappings.</p>
    </div>`;

  const savedStatusMappings = (selectedProject && projects[selectedProject]?.statusMappings) || {};
  const statusMappingsToDisplay = Object.keys(savedStatusMappings).length ? savedStatusMappings : PROJECT_STATUS_MAPPING_STARTER;
  const statusMappingSettings = selectedProject ? `
    <div class="card status-mapping-card">
      <div class="section-heading">
        <div>
          <h4>Jira Status Mapping</h4>
          <p>For ${escapeHtml(selectedProject)}. Match this PM workspace's Jira workflow names to the operational statuses used for triage and reporting.</p>
        </div>
        <span class="micro">workspace-specific</span>
      </div>
      <div class="form-row">
        <label>Jira Status = Operational Status</label>
        <textarea id="project-status-mappings" rows="12" spellcheck="false">${escapeHtml(Object.entries(statusMappingsToDisplay).map(([jiraStatus, operatingStatus]) => `${jiraStatus} = ${operatingStatus}`).join('\n'))}</textarea>
        <div class="micro form-help">Allowed operational statuses: Blocked, In progress, Active, Planned, Done, Not started. Saving also updates work items that retain an original Jira status label.</div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <button class="button" data-onclick="saveProjectStatusMappings()">Save and update work items</button>
      </div>
    </div>` : `
    <div class="card status-mapping-card">
      <h4>Jira Status Mapping</h4>
      <p>Select a PM workspace from the sidebar to manage its Jira workflow mappings.</p>
    </div>`;

  if (!projectNames.length) {
    return `
      <div class="card hero-card screen-lead settings-lead" style="margin-bottom:14px;">
        <div class="micro" style="margin-bottom:8px;">Workspace configuration</div>
        <h3 style="margin:0 0 8px;">Settings and data controls</h3>
        <p style="margin:0;">This page manages the operating system behind the app: projects, sprint catalog, AI prompt behavior, and exported workspace data.</p>
      </div>
      <div class="settings-grid">
        ${projectManagement}
        ${workspaceSettings}
        ${deliveryProjectManagement}
      </div>
      ${backupControls}
      ${aiDraftingSettings}
      ${promptEditor}
      <div class="card">
        <p>No PM workspaces available yet. Create one above to get started.</p>
      </div>
    `;
  }

  return `
    <div class="card hero-card screen-lead settings-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Workspace configuration</div>
      <h3 style="margin:0 0 8px;">Settings and data controls</h3>
      <p style="margin:0;">Use this page to manage the workspace itself: project records, sprint vocabulary, AI prompt behavior, and raw data exports.</p>
    </div>
    <div class="settings-grid">
      ${projectManagement}
      ${workspaceSettings}
      ${deliveryProjectManagement}
    </div>
    ${backupControls}
    ${aiDraftingSettings}
    <div class="settings-grid">
      ${assigneeDirectorySettings}
      ${statusMappingSettings}
    </div>
    <div class="settings-grid settings-grid-secondary">
      ${promptEditor}
      <div class="card workspace-data-card">
      <h4>Workspace Data</h4>
      <div class="form-grid">
        <div class="form-row"><label>Search</label><input id="manage-search" type="text" placeholder="Search items" value="${escapeHtml(manageSearch)}" data-oninput="setManageFilter('search', this.value)" /></div>
        <div class="form-row"><label>Project</label>
          <select id="manage-project-filter" data-onchange="setManageFilter('project', this.value)">
            <option value="">All projects</option>
            ${projectNames.map(name => `<option value="${escapeHtml(name)}" ${manageProjectFilter === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row"><label>Type</label>
          <select id="manage-type-filter" data-onchange="setManageFilter('type', this.value)">
            <option value="">All item types</option>
            <option value="story" ${manageTypeFilter === 'story' ? 'selected' : ''}>Work Items</option>
            <option value="timeline" ${manageTypeFilter === 'timeline' ? 'selected' : ''}>Milestones</option>
            <option value="transcript" ${manageTypeFilter === 'transcript' ? 'selected' : ''}>Transcripts</option>
          </select>
        </div>
        <div class="form-row"><label>Sort by</label>
          <select id="manage-sort-key" data-onchange="setManageFilter('sortKey', this.value)">
            <option value="date" ${manageSortKey === 'date' ? 'selected' : ''}>Date</option>
            <option value="type" ${manageSortKey === 'type' ? 'selected' : ''}>Type</option>
            <option value="project" ${manageSortKey === 'project' ? 'selected' : ''}>Project</option>
          </select>
        </div>
        <div class="form-row"><label>Direction</label>
          <select id="manage-sort-direction" data-onchange="setManageFilter('sortDirection', this.value)">
            <option value="desc" ${manageSortDirection === 'desc' ? 'selected' : ''}>Newest / A → Z</option>
            <option value="asc" ${manageSortDirection === 'asc' ? 'selected' : ''}>Oldest / Z → A</option>
          </select>
        </div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
        <button class="button" data-onclick="exportManageCSV()">Export CSV</button>
        <button class="button" data-onclick="exportManageMarkdown()">Export Markdown</button>
      </div>
      <p>${filteredItems.length} item(s) found</p>
      ${filteredItems.length ? `
        <ul class="panel-list">
          ${filteredItems.map(item => {
            const isEditing = manageEditing && manageEditing.project === item.project && manageEditing.type === item.type && manageEditing.id === item.id;
            if (isEditing) {
              const nameValue = manageEditData.title || item.title;
              const detailsValue = manageEditData.details || item.details;
              const metaValue = manageEditData.meta || item.meta;
              const dateValue = manageEditData.date || item.date;
              const linkedValue = manageEditData.linked || item.linked;
              const itemTypeValue = manageEditData.itemType || itemTypeOrUnknown(item.raw?.itemType);

              return `
                <li class="card">
                  <div class="form-grid">
                    <div class="form-row"><label>Title</label><input id="edit-title-${item.id}" value="${escapeHtml(nameValue)}" data-onchange="updateManageEditField('title', this.value)" /></div>
                    <div class="form-row"><label>Details</label><textarea id="edit-details-${item.id}" data-onchange="updateManageEditField('details', this.value)">${escapeHtml(detailsValue)}</textarea></div>
                    ${item.type === 'Story' ? `<div class="form-row"><label>Work item type</label><select data-onchange="updateManageEditField('itemType', this.value)">${itemTypeOptions(itemTypeValue)}</select></div>` : ''}
                    ${item.type === 'Story' ? `<div class="form-row"><label>Labels</label><input id="edit-meta-${item.id}" value="${escapeHtml(metaValue)}" data-onchange="updateManageEditField('meta', this.value)" /></div>` : ''}
                    ${item.type === 'Timeline' ? `<div class="form-row"><label>Status</label><input id="edit-meta-${item.id}" value="${escapeHtml(metaValue)}" data-onchange="updateManageEditField('meta', this.value)" /></div>` : ''}
                    ${item.type === 'Transcript' ? `<div class="form-row"><label>Type</label><input id="edit-meta-${item.id}" value="${escapeHtml(metaValue)}" data-onchange="updateManageEditField('meta', this.value)" /></div>` : ''}
                    ${item.type === 'Ticket' ? `<div class="form-row"><label>Status</label><input id="edit-meta-${item.id}" value="${escapeHtml(metaValue)}" data-onchange="updateManageEditField('meta', this.value)" /></div>` : ''}
                    <div class="form-row"><label>Date</label><input id="edit-date-${item.id}" type="date" value="${escapeHtml(dateValue)}" data-onchange="updateManageEditField('date', this.value)" /></div>
                    <div style="display:flex;gap:8px;">
                      <button class="button" data-onclick="saveManageEdit(${escapeHtml(JSON.stringify(item.project))}, ${escapeHtml(JSON.stringify(item.type.toLowerCase()))}, ${escapeHtml(JSON.stringify(item.id))})">Save</button>
                      <button class="button secondary" data-onclick="cancelManageEdit()">Cancel</button>
                    </div>
                  </div>
                </li>
              `;
            }

            return `
              <li class="card">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                  <div>
                    <h4>${escapeHtml(item.title)}</h4>
                    <p>${item.details ? escapeHtml(item.details.slice(0, 140)) + (item.details.length > 140 ? '...' : '') : 'No details'}</p>
                    <small>${escapeHtml(item.type)} · ${escapeHtml(item.project)} · ${escapeHtml(item.date || 'No date')}</small>
                    <div style="margin-top:8px;"><small>${escapeHtml(item.meta)}</small></div>
                    ${item.linked ? `<div><small>${item.linkedLabel || 'Linked'}: ${escapeHtml(item.linked)}</small></div>` : ''}
                  </div>
                  <div style="display:flex;flex-direction:column;gap:8px;">
                    <button class="button button-small secondary" data-onclick="startManageEdit(${escapeHtml(JSON.stringify(item.project))}, ${escapeHtml(JSON.stringify(item.type))}, ${escapeHtml(JSON.stringify(item.id))})">Edit</button>
                    <button class="button button-small danger" data-onclick="deleteItem(${escapeHtml(JSON.stringify(item.project))}, '${item.type.toLowerCase()}', '${item.id}')">Delete</button>
                  </div>
                </div>
              </li>
            `;
          }).join('')}
        </ul>
      ` : '<p>No items match the filter.</p>'}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[tag]));
}

function setManageFilter(name, value) {
  if (name === 'search') manageSearch = value;
  if (name === 'project') manageProjectFilter = value;
  if (name === 'type') manageTypeFilter = value;
  if (name === 'sortKey') manageSortKey = value;
  if (name === 'sortDirection') manageSortDirection = value;
  managePanel.innerHTML = renderManagePanel();
}

function copyText(text, successMessage = 'Copied text.') {
  if (!navigator.clipboard) {
    alert('Clipboard is not available in this browser.');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    alert(successMessage);
  }).catch(() => {
    alert('Unable to copy.');
  });
}

function startManageEdit(project, type, id) {
  const item = getManageItems().find(i => i.project === project && i.type === type && i.id === id);
  if (!item) return;
  manageEditing = { project, type, id };
  manageEditData = {
    title: item.title,
    details: item.details,
    meta: item.meta,
    date: item.date,
    itemType: item.type === 'Story' ? itemTypeOrUnknown(item.raw?.itemType) : ''
  };
  managePanel.innerHTML = renderManagePanel();
}

function updateManageEditField(field, value) {
  manageEditData = { ...manageEditData, [field]: value };
}

function cancelManageEdit() {
  manageEditing = null;
  manageEditData = {};
  managePanel.innerHTML = renderManagePanel();
}

async function saveManageEdit(project, type, id) {
  if (!manageEditing || manageEditing.project !== project || manageEditing.type !== type || manageEditing.id !== id) {
    return;
  }

  const payload = { project, id };
  if (manageEditData.title !== undefined) payload.title = manageEditData.title;
  if (type === 'Story' && manageEditData.itemType) payload.itemType = manageEditData.itemType;
  if (manageEditData.details !== undefined) {
    if (type === 'Ticket') payload.lastUpdate = manageEditData.details;
    else payload.notes = manageEditData.details;
  }
  if (manageEditData.date !== undefined) payload.date = manageEditData.date;
  if (manageEditData.meta !== undefined) {
    if (type === 'Story') payload.labels = manageEditData.meta.split(',').map(s => s.trim()).filter(Boolean);
    if (type === 'Timeline') payload.status = manageEditData.meta;
    if (type === 'Transcript') payload.type = manageEditData.meta;
    if (type === 'Ticket') payload.status = manageEditData.meta;
  }

  await fetch(`/api/project/${type.toLowerCase()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  manageEditing = null;
  manageEditData = {};
  await refreshProject();
}

function buildExportRows(items) {
  return items.map(item => ({
    Type: item.type,
    WorkItemType: item.type === 'Story' ? itemTypeOrUnknown(item.raw?.itemType) : '',
    Project: item.project,
    Title: item.title,
    Details: item.details,
    Meta: item.meta,
    Linked: item.linked,
    Date: item.date
  }));
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadWorkspaceBackup() {
  window.location.assign('/api/backup');
}

function exportManageCSV() {
  const items = getManageItems();
  if (!items.length) {
    alert('No items to export.');
    return;
  }

  const rows = buildExportRows(items);
  const header = Object.keys(rows[0]).map(escapeCsvCell).join(',');
  const csv = [header].concat(rows.map(row => {
    return Object.values(row).map(escapeCsvCell).join(',');
  })).join('\n');

  downloadFile('pilot-manage-export.csv', csv, 'text/csv');
}

function exportManageMarkdown() {
  const items = getManageItems();
  if (!items.length) {
    alert('No items to export.');
    return;
  }

  const rows = buildExportRows(items);
  const header = '| Type | Work Item Type | Project | Title | Details | Meta | Linked | Date |';
  const divider = '| --- | --- | --- | --- | --- | --- | --- | --- |';
  const body = rows.map(row => `| ${escapeMarkdown(row.Type)} | ${escapeMarkdown(row.WorkItemType)} | ${escapeMarkdown(row.Project)} | ${escapeMarkdown(row.Title)} | ${escapeMarkdown(row.Details)} | ${escapeMarkdown(row.Meta)} | ${escapeMarkdown(row.Linked)} | ${escapeMarkdown(row.Date)} |`).join('\n');
  const content = [header, divider, body].join('\n');

  downloadFile('pilot-manage-export.md', content, 'text/markdown');
}

function escapeMarkdown(text) {
  return escapeMarkdownCell(text);
}


async function deleteItem(project, type, itemId) {
  const confirmed = confirm(`Delete ${type} for project ${project}?`);
  if (!confirmed) return;

  await fetch(`/api/project/${type}?project=${encodeURIComponent(project)}&id=${encodeURIComponent(itemId)}`, {
    method: 'DELETE'
  });

  await refreshProject();
}

// Shared status → badge (matches the CSS .badge variants and the wireframe colors).
function statusBadgeClass(status) {
  return {
    'Done': 'done', 'In progress': 'inprogress', 'Active': 'inprogress',
    'Blocked': 'blocked', 'Planned': 'planned', 'Not started': 'notstarted'
  }[status] || 'notstarted';
}
function statusBadge(status) {
  return `<span class="badge ${statusBadgeClass(status)}">${escapeHtml(status)}</span>`;
}

function itemTypeOptions(selected = '', requireChoice = false) {
  return `${requireChoice ? '<option value="">Select a type</option>' : ''}${ITEM_TYPES.map(type => `<option value="${type}" ${selected === type ? 'selected' : ''}>${type}</option>`).join('')}`;
}

function itemTypeBadge(story) {
  return `<span class="row-signal planned">${escapeHtml(itemTypeOrUnknown(story.itemType))}</span>`;
}

function deliveryProjectBadge(story, workspace) {
  const project = deliveryProjectForStory(workspace, story);
  return project ? `<span class="row-signal planned">${escapeHtml(project.name)}</span>` : '<span class="row-signal planned">Project not identified</span>';
}

function initialsFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '??';
  return parts.slice(0, 2).map(part => part[0].toUpperCase()).join('');
}

function workItemSignalBadges(story, project) {
  const badges = [];
  if (story.tracked) badges.push('<span class="row-signal tracked">Tracked</span>');
  if (itemNeedsFollowup(story)) badges.push('<span class="row-signal followup">Needs follow-up</span>');
  if (itemNeedsComment(story)) badges.push('<span class="row-signal quiet">Quiet</span>');
  if (!storyAssignee(story)) badges.push('<span class="row-signal planned">Assignee gap</span>');
  if (!storySprint(story)) badges.push('<span class="row-signal planned">Sprint gap</span>');
  if (!project.timeline.find(entry => entry.id === story.timelineId)) badges.push('<span class="row-signal planned">No milestone</span>');
  return badges.join('');
}

function renderWorkItemListRow(project, story) {
  const linkedMilestone = project.timeline.find(entry => entry.id === story.timelineId);
  const attention = workItemAttentionProfile(story, project);
  const expanded = workItemExpanded.has(story.id);
  const assignee = storyAssignee(story);
  const summaryId = story.jiraId || story.id;
  const noteText = storyLastCommentText(story) || story.notes || story.description || 'No recent Jira comment or PM note recorded.';
  const noteLabel = storyLastCommentText(story) ? 'Last comment / PM note' : story.notes ? 'Project note' : 'Description';
  const noteMeta = storyLastCommentText(story) ? `Updated ${lastCommentLabel(story)}` : latestStoryActivityLabel(story);
  const attentionClass = attention.badge === 'followup' ? 'followup' : attention.badge === 'quiet' ? 'quiet' : attention.badge === 'blocked' ? 'blocked' : attention.badge;

  return `
    <li class="work-table-card${expanded ? ' expanded' : ''}">
      <button class="work-table-toggle" data-onclick="toggleWorkItemExpanded('${story.id}')">
        <span class="work-table-dot ${statusBadgeClass(inferStatusClient(story))}"></span>
        <span class="work-table-summary">
          <span class="work-table-title">${escapeHtml(story.summary)}</span>
          <span class="work-table-meta">
            <span class="mono">${escapeHtml(summaryId)}</span>
            ${itemTypeBadge(story)}
            ${deliveryProjectBadge(story, project)}
            ${workItemSignalBadges(story, project)}
          </span>
        </span>
        <span class="work-table-owner${assignee ? '' : ' empty'}">
          <span class="work-table-avatar">${escapeHtml(initialsFromName(assignee))}</span>
          <span>${escapeHtml(assignee || 'Unassigned')}</span>
        </span>
        <span class="work-table-sprint">${escapeHtml(storySprint(story) || 'No sprint')}</span>
        <span class="work-table-status">${statusBadge(inferStatusClient(story))}</span>
        <span class="work-table-date">${escapeHtml(lastCommentLabel(story))}</span>
        <span class="work-table-chevron${expanded ? ' open' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>
        </span>
      </button>
      ${expanded ? `
        <div class="work-table-panel">
          <div class="work-table-panel-copy">
            <div class="work-table-panel-kicker">
              <span class="row-kicker">${escapeHtml(noteLabel)}</span>
              <span class="row-meta mono">${escapeHtml(noteMeta)}</span>
            </div>
            <p>${escapeHtml(noteText)}</p>
          </div>
          <div class="work-table-panel-grid">
            <div><span class="micro">Type</span><strong>${escapeHtml(itemTypeOrUnknown(story.itemType))}</strong></div>
            <div><span class="micro">Project / Jira Epic</span><strong>${escapeHtml(deliveryProjectForStory(project, story)?.name || 'Not identified')}</strong></div>
            <div><span class="micro">Assignee</span><strong>${escapeHtml(assignee || 'Not recorded')}</strong></div>
            <div><span class="micro">Sprint</span><strong>${escapeHtml(storySprint(story) || 'Not recorded')}</strong></div>
            <div><span class="micro">Milestone</span><strong>${escapeHtml(linkedMilestone ? linkedMilestone.title : 'Not linked')}</strong></div>
            <div><span class="micro">Comment Date</span><strong>${escapeHtml(lastCommentLabel(story))}</strong></div>
          </div>
          <div class="work-table-panel-actions">
            <span class="badge ${attentionClass}">${escapeHtml(attention.label)}</span>
            ${story.tracked ? `<button class="button button-small secondary" data-onclick="logItemComment(${escapeHtml(JSON.stringify(selectedProject))}, ${escapeHtml(JSON.stringify(story.id))})">Log comment</button>` : `<button class="button button-small secondary" data-onclick="toggleStoryTracked(${escapeHtml(JSON.stringify(selectedProject))}, ${escapeHtml(JSON.stringify(story.id))}, true)">Track for follow-up</button>`}
            <button class="button button-small secondary" data-onclick="startStoryEdit('${story.id}')">Edit</button>
            ${story.tracked ? `<button class="button button-small secondary" data-onclick="toggleStoryTracked(${escapeHtml(JSON.stringify(selectedProject))}, ${escapeHtml(JSON.stringify(story.id))}, false)">Untrack</button>` : ''}
            <button class="button button-small danger" data-onclick="deleteItem(${escapeHtml(JSON.stringify(selectedProject))}, 'story', '${story.id}')">Delete</button>
          </div>
        </div>` : ''}
    </li>`;
}

// Shared follow-up ("tracking") field inputs, used in the Stories create/edit forms and the
// Tracking "+ New tracked item" form so an item's follow-up fields are editable from either.
function trackingFieldsHtml(prefix, s, showTracked) {
  s = s || {};
  return `
    ${showTracked ? `<label style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:0.9rem;margin-bottom:4px;"><input type="checkbox" id="${prefix}-tracked" ${s.tracked ? 'checked' : ''} style="width:auto;" /> Track this item (add to the follow-up Tracking list)</label>` : ''}
    <div class="field-row">
      <div><label>Ticket / Jira id</label><input id="${prefix}-jira" value="${escapeHtml(s.jiraId || '')}" placeholder="DELI-1205" /></div>
      <div><label>Assignee</label><input id="${prefix}-assignee" value="${escapeHtml(storyAssignee(s))}" placeholder="Name" /></div>
    </div>
    <div class="field-row">
      <div><label>Sprint</label>${sprintSelectHtml(prefix, storySprint(s))}</div>
      <div><label>Last comment / PM note</label><input id="${prefix}-lastcomment" value="${escapeHtml(storyLastCommentText(s))}" placeholder="Latest Jira comment or your PM follow-up note" /></div>
    </div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;">
      <label style="display:flex;align-items:center;gap:6px;font-weight:normal;"><input type="checkbox" id="${prefix}-contacted" ${s.contacted ? 'checked' : ''} style="width:auto;" /> Contacted?</label>
      <label style="display:flex;align-items:center;gap:6px;font-weight:normal;"><input type="checkbox" id="${prefix}-commentadded" ${s.commentAdded ? 'checked' : ''} style="width:auto;" /> Comment added?</label>
      ${s.lastCommentedAt !== undefined && s.id ? `<span class="micro" style="align-self:center;text-transform:none;">last comment: ${lastCommentLabel(s)}</span>` : ''}
    </div>`;
}

// Read the tracking-field inputs for a given prefix into a payload (only fields that exist).
function readTrackingFields(prefix) {
  const g = id => document.getElementById(`${prefix}-${id}`);
  const out = {};
  if (g('tracked')) out.tracked = g('tracked').checked;
  if (g('jira')) out.jiraId = g('jira').value.trim();
  if (g('assignee')) out.assignee = g('assignee').value.trim();
  if (g('sprint')) out.sprint = g('sprint').value.trim();
  if (g('contacted')) out.contacted = g('contacted').checked;
  if (g('commentadded')) out.commentAdded = g('commentadded').checked;
  if (g('lastcomment')) out.lastComment = g('lastcomment').value.trim();
  return out;
}

function renderStoriesPanel(project) {
  const stories = project.stories || [];
  const assigneeOptions = [...new Set(stories.map(story => storyAssignee(story)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sprintFilterOptions = [...new Set(stories.map(story => storySprint(story)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const search = storySearch.trim().toLowerCase();
  const filtered = stories.filter(s => {
    if (storyTypeFilter !== 'all' && itemTypeOrUnknown(s.itemType) !== storyTypeFilter) return false;
    if (storyStatusFilter !== 'all' && inferStatusClient(s) !== storyStatusFilter) return false;
    if (storyAssigneeFilter !== 'all' && storyAssignee(s) !== storyAssigneeFilter) return false;
    if (storySprintFilter !== 'all' && storySprint(s) !== storySprintFilter) return false;
    if (search) {
      const milestone = project.timeline.find(entry => entry.id === s.timelineId);
      const hay = [s.id, s.jiraId, itemTypeOrUnknown(s.itemType), s.summary, s.description, storyAssignee(s), storySprint(s), s.notes, s.dependencies, storyLastCommentText(s), inferStatusClient(s), milestone?.title, (s.labels || []).join(' ')].map(x => String(x || '').toLowerCase()).join(' ');
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  const sorted = filtered.slice().sort((a, b) => {
    return statusPriority(b) - statusPriority(a) || (latestStoryActivityTime(b) || 0) - (latestStoryActivityTime(a) || 0);
  });
  const blockedCount = stories.filter(s => inferStatusClient(s) === 'Blocked').length;
  const trackedCount = stories.filter(s => s.tracked).length;
  const followupCount = stories.filter(itemNeedsFollowup).length;
  const quietCount = stories.filter(itemNeedsComment).length;
  const openStories = stories.filter(s => inferStatusClient(s) !== 'Done');
  const assigneeGapCount = openStories.filter(s => !storyAssignee(s)).length;
  const sprintGapCount = openStories.filter(s => !storySprint(s)).length;
  const commentGapCount = openStories.filter(s => !storyLastCommentText(s)).length;
  const gapImpactCount = openStories.filter(s => {
    return !storyAssignee(s) || !storySprint(s) || !storyLastCommentText(s);
  }).length;
  const activeCount = stories.filter(s => ['In progress', 'Active'].includes(inferStatusClient(s))).length;
  const doneCount = stories.filter(s => inferStatusClient(s) === 'Done').length;
  const operatingQueue = stories.slice().sort((a, b) => statusPriority(b) - statusPriority(a) || (latestStoryActivityTime(b) || 0) - (latestStoryActivityTime(a) || 0)).slice(0, 6);
  const readinessNotes = [];
  if (assigneeGapCount) readinessNotes.push(`${assigneeGapCount} work item${assigneeGapCount === 1 ? '' : 's'} have no assignee recorded.`);
  if (sprintGapCount) readinessNotes.push(`${sprintGapCount} work item${sprintGapCount === 1 ? '' : 's'} have no sprint recorded.`);
  if (commentGapCount) readinessNotes.push(`${commentGapCount} work item${commentGapCount === 1 ? '' : 's'} have no last comment or PM note recorded.`);
  if (!blockedCount && !followupCount && !quietCount) readinessNotes.push('No active blocker or follow-up signals are currently recorded.');

  const addForm = storyShowAddForm ? `
    <div class="card" style="border-color:var(--accent);box-shadow:0 0 0 3px rgba(58,111,214,0.12);margin-bottom:14px;">
      <div style="margin-bottom:12px;"><strong style="color:var(--accent);">New work item</strong></div>
      <div class="form-grid">
        <div class="form-row"><label>Start from template</label>
          <select id="story-template" data-onchange="applyStoryTemplate(this.value)">
            <option value="">Blank work item</option>
            ${STORY_TEMPLATES.map(template => `<option value="${template.id}">${escapeHtml(template.name)}</option>`).join('')}
          </select>
          <div class="micro form-help">Templates prefill wording and acceptance criteria. Review every field before creating.</div>
        </div>
        <div class="field-row">
          <div><label>Work item type</label><select id="story-item-type">${itemTypeOptions('Story')}</select><div class="micro form-help">Story is the common default. Change it when the Jira item uses another type.</div></div>
          <div><label>Summary</label><input id="story-summary" /></div>
        </div>
        <div class="form-row"><label>Project / Jira Epic</label><select id="story-delivery-project">${deliveryProjectOptions(project)}</select><div class="micro form-help">Assign only when the Jira Epic relationship is known.</div></div>
        <div class="form-row"><label>Description</label><textarea id="story-description"></textarea></div>
        <div class="field-row">
          <div><label>Acceptance Criteria (one per line)</label><textarea id="story-criteria"></textarea></div>
          <div><label>Dependencies</label><input id="story-dependencies" /></div>
        </div>
        <div class="field-row">
          <div><label>Labels (comma separated)</label><input id="story-labels" /></div>
          <div><label>Environment</label><input id="story-environment" /></div>
        </div>
        <div class="form-row"><label>Notes</label><textarea id="story-notes"></textarea></div>
        <div class="form-row"><label>Link to timeline</label>
          <select id="story-timeline">
            <option value="">None</option>
            ${project.timeline.map(t => `<option value="${t.id}">${escapeHtml(t.title)} (${escapeHtml(t.date || 'no date')})</option>`).join('')}
          </select>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:2px;">
          <div class="micro" style="margin-bottom:8px;">Follow-up tracking (optional)</div>
          ${trackingFieldsHtml('story', {}, true)}
        </div>
        <div style="display:flex;gap:8px;">
          <button class="button" data-onclick="createStory()">Create Work Item</button>
          <button class="button secondary" data-onclick="toggleStoryAddForm()">Cancel</button>
        </div>
      </div>
    </div>` : '';

  const importPreview = storyImportPreview;
  const previewRows = importPreview?.items?.slice(0, 8) || [];
  const importForm = storyShowImportForm ? `
    <div class="card csv-import-card">
      <div class="section-heading">
        <div>
          <h4>Import work items from CSV</h4>
          <p class="csv-import-description">Preview the file first. Importing stays local, skips duplicate Jira keys, and does not turn on follow-up tracking.</p>
        </div>
        <button class="button button-small secondary" data-onclick="cancelStoryCsvImport()">Close</button>
      </div>
      ${storyImportError ? `<div class="note warn" style="margin:0 0 12px;">${escapeHtml(storyImportError)}</div>` : ''}
      ${!importPreview ? `
        <div class="csv-import-controls">
          <label class="csv-import-dropzone" id="csv-import-dropzone" data-onclick="document.getElementById('story-import-file').click()" data-ondragover="csvImportDragOver(event)" data-ondragleave="csvImportDragLeave(event)" data-ondrop="csvImportDrop(event)">
            <strong id="csv-import-file-label">Drop one CSV here, or browse</strong>
            <span class="micro">Recognized fields include Issue Type, Issue Key, Summary, Status, Assignee, Sprint, Labels, Comments, and more. Missing or unrecognized types import as Unknown.</span>
          </label>
          <input id="story-import-file" type="file" accept=".csv,text/csv" style="display:none;" data-onchange="csvImportFileChosen()" />
          <button class="button" data-onclick="previewStoryCsvImport()" ${storyImportLoading ? 'disabled' : ''}>${storyImportLoading ? 'Reading CSV...' : 'Preview import'}</button>
        </div>` : `
        <div class="csv-import-summary">
          <div><span class="micro">File</span><strong>${escapeHtml(importPreview.fileName || 'Selected CSV')}</strong></div>
          <div><span class="micro">Ready to add</span><strong>${importPreview.items.length} work item${importPreview.items.length === 1 ? '' : 's'}</strong></div>
          <div><span class="micro">Skipped</span><strong>${importPreview.skipped.length}</strong></div>
          <div><span class="micro">Recognized</span><strong>${escapeHtml((importPreview.columns || []).join(', ') || 'Summary')}</strong></div>
        </div>
        ${previewRows.length ? `<div class="csv-import-preview">
          <div class="micro" style="margin-bottom:7px;">Previewing the first ${previewRows.length} item${previewRows.length === 1 ? '' : 's'}</div>
          ${previewRows.map(item => `<div class="csv-import-row">
            <div><strong>${escapeHtml(item.summary)}</strong><div class="micro">${escapeHtml(itemTypeOrUnknown(item.itemType))} · ${item.jiraId ? escapeHtml(item.jiraId) : 'No Jira key'}${item.assignee ? ` · ${escapeHtml(item.assignee)}` : ''}${item.sprint ? ` · ${escapeHtml(item.sprint)}` : ''}</div></div>
            ${statusBadge(inferStatusClient(item))}
          </div>`).join('')}
        </div>` : '<div class="note warn" style="margin:12px 0;">No new work items were recognized in this file.</div>'}
        ${importPreview.skipped.length ? `<div class="csv-import-skipped"><strong>${importPreview.skipped.length} row${importPreview.skipped.length === 1 ? '' : 's'} skipped</strong><span>${escapeHtml(importPreview.skipped.slice(0, 4).map(item => `Row ${item.row}: ${item.reason}`).join(' | '))}${importPreview.skipped.length > 4 ? ' | More rows omitted' : ''}</span></div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">
          <button class="button" data-onclick="confirmStoryCsvImport()" ${!importPreview.items.length || storyImportLoading ? 'disabled' : ''}>${storyImportLoading ? 'Importing...' : `Import ${importPreview.items.length} work item${importPreview.items.length === 1 ? '' : 's'}`}</button>
          <button class="button secondary" data-onclick="resetStoryCsvImport()">Choose another file</button>
        </div>`}
    </div>` : '';

  const queueHtml = operatingQueue.length ? `
    <div class="stack">
      ${operatingQueue.map(story => {
        const attention = workItemAttentionProfile(story, project);
        return `
          <div class="surface-row">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
              <div style="min-width:0;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                  ${story.jiraId ? `<span class="mono" style="color:var(--accent);font-size:0.78rem;">${escapeHtml(story.jiraId)}</span>` : ''}
                  <strong>${escapeHtml(story.summary)}</strong>
                  ${statusBadge(inferStatusClient(story))}
                </div>
                <p style="margin:4px 0 0;">${escapeHtml(attention.detail)}</p>
                <div class="micro" style="margin-top:6px;text-transform:none;">${storyAssignee(story) ? `assignee ${escapeHtml(storyAssignee(story))} · ` : ''}${storySprint(story) ? `sprint ${escapeHtml(storySprint(story))} · ` : ''}last comment ${escapeHtml(lastCommentLabel(story))}</div>
              </div>
              <span class="badge ${attention.badge}">${escapeHtml(attention.label)}</span>
            </div>
          </div>`;
      }).join('')}
    </div>` : '<p>No work items yet. Add the first one to start using this project as your operating queue.</p>';

  const listBody = sorted.length ? `
    <ul class="panel-list">
      ${sorted.map(story => storyEditing === story.id ? renderStoryEditForm(project, story) : renderWorkItemListRow(project, story)).join('')}
    </ul>` : `<div class="card"><p>${stories.length ? 'No work items match the filter.' : 'No work items yet — use “+ New work item”.'}</p></div>`;

  return `
    <div class="card hero-card screen-lead work-items-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Operational work queue</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <h3 style="margin:0 0 8px;">${escapeHtml(selectedProject)} work items</h3>
          <p style="margin:0;">This screen is tuned for daily triage: blocked work, follow-up risk, ownership gaps, and evidence gaps surface first so your leadership summary stays grounded in what is actually recorded.</p>
        </div>
        <div class="hero-actions">
          <button class="button" data-onclick="toggleStoryAddForm()">+ New work item</button>
          <button class="button secondary" data-onclick="toggleStoryImportForm()">Import CSV</button>
          <button class="button secondary" data-onclick="openFollowUp()">Open follow-up</button>
          <button class="button secondary" data-onclick="openStatusSummary()">Open status summary</button>
        </div>
      </div>
    </div>
    ${renderWorkTabs('stories')}
    <div class="insight-strip operating-metrics work-items-metrics" style="margin-bottom:14px;">
      <div class="insight-tile">
        <div class="micro">Blocked</div>
        <div class="insight-number">${blockedCount}</div>
        <div class="insight-copy">${activeCount} active/in progress · ${doneCount} done</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Follow-Up Risk</div>
        <div class="insight-number">${followupCount + quietCount}</div>
        <div class="insight-copy">${followupCount} need contact · ${quietCount} quiet threads</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Coverage Gaps</div>
        <div class="insight-number">${gapImpactCount}</div>
        <div class="insight-copy">${assigneeGapCount} assignee gaps · ${sprintGapCount} sprint gaps · ${commentGapCount} comment gaps</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Current View</div>
        <div class="insight-number">${sorted.length}</div>
        <div class="insight-copy">${stories.length} total work items in this project</div>
      </div>
    </div>
    <div class="section-grid" style="margin-bottom:14px;">
      <div class="card">
        <div class="section-heading">
          <h4>Operating Queue</h4>
          <span class="micro">what needs attention first</span>
        </div>
        <p style="margin:0 0 8px;">This queue ignores optimism and sorts for operational importance first.</p>
        ${queueHtml}
      </div>
      <div class="card">
        <div class="section-heading">
          <h4>Readiness Gaps</h4>
          <span class="micro">what weakens leadership reporting</span>
        </div>
        ${readinessNotes.length
          ? `<div class="stack">${readinessNotes.map((note, index) => `<div class="surface-row"${index === readinessNotes.length - 1 ? ' style="padding-bottom:0;border-bottom:none;"' : ''}><p>${escapeHtml(note)}</p></div>`).join('')}</div>`
          : '<p>No obvious readiness gaps are visible in the saved work-item data.</p>'}
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="button secondary" data-onclick="openCapture()">Capture evidence</button>
          <button class="button secondary" data-onclick="openMilestones()">Review milestones</button>
        </div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select data-onchange="setStoryTypeFilter(this.value)" style="width:auto;">
          <option value="all">All types</option>
          ${ITEM_TYPES.map(type => `<option value="${type}" ${storyTypeFilter === type ? 'selected' : ''}>${type}</option>`).join('')}
        </select>
        <select data-onchange="setStoryFilter(this.value)" style="width:auto;">
          <option value="all" ${storyStatusFilter === 'all' ? 'selected' : ''}>All statuses</option>
          <option value="Done" ${storyStatusFilter === 'Done' ? 'selected' : ''}>Done</option>
          <option value="In progress" ${storyStatusFilter === 'In progress' ? 'selected' : ''}>In progress</option>
          <option value="Active" ${storyStatusFilter === 'Active' ? 'selected' : ''}>Active</option>
          <option value="Blocked" ${storyStatusFilter === 'Blocked' ? 'selected' : ''}>Blocked</option>
          <option value="Planned" ${storyStatusFilter === 'Planned' ? 'selected' : ''}>Planned</option>
          <option value="Not started" ${storyStatusFilter === 'Not started' ? 'selected' : ''}>Not started</option>
        </select>
        <select data-onchange="setStoryAssigneeFilter(this.value)" style="width:auto;max-width:190px;">
          <option value="all" ${storyAssigneeFilter === 'all' ? 'selected' : ''}>All assignees</option>
          ${assigneeOptions.map(value => `<option value="${escapeHtml(value)}" ${storyAssigneeFilter === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
        </select>
        <select data-onchange="setStorySprintFilter(this.value)" style="width:auto;max-width:190px;">
          <option value="all" ${storySprintFilter === 'all' ? 'selected' : ''}>All sprints</option>
          ${sprintFilterOptions.map(value => `<option value="${escapeHtml(value)}" ${storySprintFilter === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
        </select>
        <input id="story-search" value="${escapeHtml(storySearch)}" placeholder="Search jira, assignee, sprint, notes, labels…" data-oninput="setStorySearch(this.value)" style="width:260px;" />
      </div>
      <div class="micro">${sorted.length} shown · ${trackedCount} tracked for follow-up</div>
    </div>
    <div class="note warn" style="margin-bottom:14px;">Priority order: blocked work, assignee follow-up risk, quiet Jira threads, then latest recorded activity.</div>
    ${addForm}
    ${importForm}
    ${listBody}
  `;
}

function setStoryFilter(value) {
  storyStatusFilter = value;
  if (selectedProject) storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
}
function setStoryTypeFilter(value) {
  storyTypeFilter = value;
  if (selectedProject) storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
}
function setStoryAssigneeFilter(value) {
  storyAssigneeFilter = value;
  if (selectedProject) storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
}
function setStorySprintFilter(value) {
  storySprintFilter = value;
  if (selectedProject) storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
}
function setStorySearch(value) {
  storySearch = value;
  if (!selectedProject) return;
  storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
  const el = document.getElementById('story-search');
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
function toggleStoryAddForm() {
  storyShowAddForm = !storyShowAddForm;
  if (selectedProject) storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
  if (storyShowAddForm) { const el = document.getElementById('story-summary'); if (el) el.focus(); }
}

function renderStoriesAfterCsvChange() {
  if (selectedProject) storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
}

function toggleStoryImportForm() {
  storyShowImportForm = !storyShowImportForm;
  storyImportPreview = null;
  storyImportError = '';
  storyImportLoading = false;
  renderStoriesAfterCsvChange();
  if (storyShowImportForm) {
    const input = document.getElementById('story-import-file');
    if (input) input.focus();
  }
}

function resetStoryCsvImport() {
  storyImportPreview = null;
  storyImportError = '';
  storyImportLoading = false;
  renderStoriesAfterCsvChange();
}

function csvImportDragOver(event) {
  event.preventDefault();
  document.getElementById('csv-import-dropzone')?.classList.add('dragover');
}

function csvImportDragLeave(event) {
  event.preventDefault();
  document.getElementById('csv-import-dropzone')?.classList.remove('dragover');
}

function csvImportFileChosen() {
  const file = document.getElementById('story-import-file')?.files?.[0];
  const label = document.getElementById('csv-import-file-label');
  if (file && label) label.textContent = `Selected: ${file.name}`;
}

function csvImportDrop(event) {
  event.preventDefault();
  document.getElementById('csv-import-dropzone')?.classList.remove('dragover');
  if ((event.dataTransfer?.files?.length || 0) !== 1) {
    storyImportError = 'Drop one CSV file at a time.';
    renderStoriesAfterCsvChange();
    return;
  }
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  if (!/\.csv$/i.test(file.name)) {
    storyImportError = 'Drop a .csv file to import work items.';
    renderStoriesAfterCsvChange();
    return;
  }
  const input = document.getElementById('story-import-file');
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
  } catch (_) {
    storyImportError = 'Your browser could not read the dropped file. Use Browse instead.';
    renderStoriesAfterCsvChange();
    return;
  }
  csvImportFileChosen();
}

function cancelStoryCsvImport() {
  storyShowImportForm = false;
  storyImportPreview = null;
  storyImportError = '';
  storyImportLoading = false;
  renderStoriesAfterCsvChange();
}

async function previewStoryCsvImport() {
  const file = document.getElementById('story-import-file')?.files?.[0];
  if (!file) {
    storyImportError = 'Choose a CSV file to preview.';
    renderStoriesAfterCsvChange();
    return;
  }
  storyImportLoading = true;
  storyImportError = '';
  renderStoriesAfterCsvChange();
  try {
    const form = new FormData();
    form.append('project', selectedProject);
    form.append('file', file);
    const response = await fetch('/api/project/story/import/preview', { method: 'POST', body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to preview this CSV');
    storyImportPreview = result;
  } catch (error) {
    storyImportError = error.message || 'Unable to preview this CSV';
  } finally {
    storyImportLoading = false;
    renderStoriesAfterCsvChange();
  }
}

async function confirmStoryCsvImport() {
  if (!storyImportPreview?.items?.length) return;
  storyImportLoading = true;
  storyImportError = '';
  renderStoriesAfterCsvChange();
  try {
    const response = await fetch('/api/project/story/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: selectedProject, items: storyImportPreview.items })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to import this CSV');
    storyShowImportForm = false;
    storyImportPreview = null;
    await refreshProject();
    alert(`${result.created} work item${result.created === 1 ? '' : 's'} imported${result.skipped?.length ? `; ${result.skipped.length} skipped` : ''}.`);
  } catch (error) {
    storyImportError = error.message || 'Unable to import this CSV';
    storyImportLoading = false;
    renderStoriesAfterCsvChange();
  }
}

function applyStoryTemplate(templateId) {
  const template = STORY_TEMPLATES.find(item => item.id === templateId);
  if (!template) return;
  const fill = (id, value) => {
    const element = document.getElementById(id);
    if (element && !element.value.trim()) element.value = value;
  };
  fill('story-description', template.description);
  fill('story-criteria', template.acceptanceCriteria.join('\n'));
  fill('story-labels', template.labels);
  const summary = document.getElementById('story-summary');
  if (summary) summary.focus();
}

function toggleWorkItemExpanded(id) {
  if (workItemExpanded.has(id)) workItemExpanded.delete(id);
  else workItemExpanded.add(id);
  if (selectedProject) storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
}

function toggleTrackingExpanded(project, id) {
  const key = `${project}::${id}`;
  if (trackingExpanded.has(key)) trackingExpanded.delete(key);
  else trackingExpanded.add(key);
  trackingPanel.innerHTML = renderTrackingPanel();
}

// Flip a story's "tracked" flag — adds/removes it from the cross-project Tracking view.
async function toggleStoryTracked(project, id, tracked) {
  await fetch('/api/project/story', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, id, tracked: !!tracked })
  });
  await refreshProject();
}

function renderStoryEditForm(project, story) {
  const ac = Array.isArray(story.acceptanceCriteria) ? story.acceptanceCriteria.join('\n') : '';
  const labels = Array.isArray(story.labels) ? story.labels.join(', ') : '';
  return `
    <li class="card" style="border-color:var(--accent);box-shadow:0 0 0 3px rgba(58,111,214,0.12);">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:12px;">
        <span class="mono" style="color:var(--muted-2);font-size:0.8rem;">${escapeHtml(story.id)}</span>
        <strong style="color:var(--accent);">Editing · all fields</strong>
      </div>
      <div class="form-grid">
        <div class="field-row">
          <div><label>Work item type</label><select id="edit-story-item-type">${itemTypeOptions(itemTypeOrUnknown(story.itemType))}</select></div>
          <div><label>Summary</label><input id="edit-story-summary" value="${escapeHtml(story.summary || '')}" /></div>
        </div>
        <div class="form-row"><label>Project / Jira Epic</label><select id="edit-story-delivery-project">${deliveryProjectOptions(project, story.deliveryProjectId || '')}</select></div>
        <div class="form-row"><label>Description</label><textarea id="edit-story-description">${escapeHtml(story.description || '')}</textarea></div>
        <div class="field-row">
          <div><label>Acceptance Criteria (one per line)</label><textarea id="edit-story-criteria">${escapeHtml(ac)}</textarea></div>
          <div><label>Dependencies</label><input id="edit-story-dependencies" value="${escapeHtml(story.dependencies || '')}" /></div>
        </div>
        <div class="field-row">
          <div><label>Labels (comma separated)</label><input id="edit-story-labels" value="${escapeHtml(labels)}" /></div>
          <div><label>Environment</label><input id="edit-story-environment" value="${escapeHtml(story.environment || '')}" /></div>
        </div>
        <div class="form-row"><label>Notes</label><textarea id="edit-story-notes">${escapeHtml(story.notes || '')}</textarea></div>
        <div class="form-row"><label>Link to timeline</label>
          <select id="edit-story-timeline">
            <option value="">None</option>
            ${project.timeline.map(t => `<option value="${t.id}" ${story.timelineId === t.id ? 'selected' : ''}>${escapeHtml(t.title)} (${escapeHtml(t.date || 'no date')})</option>`).join('')}
          </select>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:2px;">
          <div class="micro" style="margin-bottom:8px;">Follow-up tracking</div>
          ${trackingFieldsHtml('edit-story', story, true)}
        </div>
        <div style="display:flex;gap:8px;">
          <button class="button" data-onclick="saveStoryEdit('${story.id}')">Save</button>
          <button class="button secondary" data-onclick="cancelStoryEdit()">Cancel</button>
        </div>
      </div>
    </li>`;
}

function startStoryEdit(id) {
  storyEditing = id;
  workItemExpanded.add(id);
  renderPanels();
}

function cancelStoryEdit() {
  storyEditing = null;
  renderPanels();
}

async function saveStoryEdit(id) {
  const val = elementId => { const el = document.getElementById(elementId); return el ? el.value : undefined; };
  const payload = {
    project: selectedProject,
    id,
    itemType: val('edit-story-item-type'),
    deliveryProjectId: val('edit-story-delivery-project'),
    summary: val('edit-story-summary'),
    description: val('edit-story-description'),
    acceptanceCriteria: val('edit-story-criteria'),
    dependencies: val('edit-story-dependencies'),
    labels: val('edit-story-labels'),
    environment: val('edit-story-environment'),
    notes: val('edit-story-notes'),
    timelineId: val('edit-story-timeline'),
    ...readTrackingFields('edit-story')
  };
  await fetch('/api/project/story', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  storyEditing = null;
  await refreshProject();
}

async function createStory() {
  const itemType = document.getElementById('story-item-type').value;
  const summary = document.getElementById('story-summary').value.trim();
  const description = document.getElementById('story-description').value.trim();
  const acceptanceCriteria = document.getElementById('story-criteria').value.trim().split('\n');
  const dependencies = document.getElementById('story-dependencies').value.trim();
  const labels = document.getElementById('story-labels').value.trim();
  const environment = document.getElementById('story-environment').value.trim();
  const notes = document.getElementById('story-notes').value.trim();

  if (!summary || !selectedProject || !itemType) {
    alert('Please select a project, choose a work item type, and enter a summary.');
    return;
  }

  await fetch('/api/project/story', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: selectedProject,
      itemType,
      deliveryProjectId: document.getElementById('story-delivery-project')?.value || '',
      summary,
      description,
      acceptanceCriteria,
      dependencies,
      labels,
      environment,
      notes,
      timelineId: document.getElementById('story-timeline') ? document.getElementById('story-timeline').value : '',
      ...readTrackingFields('story')
    })
  });

  storyShowAddForm = false;
  await refreshProject();
}

async function createTimeline() {
  const project = document.getElementById('timeline-project-select')?.value || selectedProject;
  const title = document.getElementById('timeline-title').value.trim();
  const date = document.getElementById('timeline-date').value;
  const status = document.getElementById('timeline-status').value.trim();
  const notes = document.getElementById('timeline-notes').value.trim();

  if (!title || !project) {
    alert('Please select a project and enter a title.');
    return;
  }

  await fetch('/api/project/timeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project,
      title,
      date,
      status,
      notes
    })
  });

  await fetchProjects();
  if (project !== selectedProject) {
    selectProject(project);
  }
}

async function saveStructuredMeeting() {
  if (!selectedProject) return;
  const value = id => document.getElementById(id)?.value.trim() || '';
  const title = value('meeting-title');
  const summary = value('meeting-summary');
  if (!title || !summary) {
    alert('Enter a meeting title and factual meeting notes before saving.');
    return;
  }

  const sections = [
    `Attendees: ${value('meeting-attendees') || 'Not recorded'}`,
    `Discussion:\n${summary}`,
    value('meeting-decisions') ? `Decisions:\n${value('meeting-decisions')}` : '',
    value('meeting-actions') ? `Actions and owners:\n${value('meeting-actions')}` : ''
  ].filter(Boolean);
  const formData = new FormData();
  formData.append('project', selectedProject);
  formData.append('title', title);
  formData.append('date', document.getElementById('meeting-date')?.value || '');
  formData.append('type', document.getElementById('meeting-type')?.value || 'Meeting');
  formData.append('notes', sections.join('\n\n'));

  const response = await fetch('/api/project/transcript', { method: 'POST', body: formData });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unable to save meeting note' }));
    alert(error.error || 'Unable to save meeting note');
    return;
  }
  captureFocus = '';
  await refreshProject();
}

async function uploadTranscript() {
  const notes = document.getElementById('transcript-notes')?.value.trim() || '';
  const fileInput = document.getElementById('transcript-file');

  if (!captureSelectedFiles.length || !selectedProject) {
    alert('Choose one to five files, then set the type for each source.');
    return;
  }
  if (captureSelectedFiles.length > 5) { alert('Upload up to five files at a time.'); return; }

  const formData = new FormData();
  formData.append('project', selectedProject);
  formData.append('notes', notes);
  formData.append('metadata', JSON.stringify(captureSelectedFiles.map(item => ({ title: item.title.trim() || item.file.name, type: item.type }))));
  captureSelectedFiles.forEach(item => formData.append('files', item.file));

  const response = await fetch('/api/project/transcript', {
    method: 'POST',
    body: formData
  });
  const result = await response.json().catch(() => ({ error: 'Unable to upload sources' }));
  if (!response.ok) { alert(result.error || 'Unable to upload sources'); return; }

  if (fileInput) fileInput.value = '';
  const warnings = result.warnings || [];
  const uploaded = result.transcripts ? result.transcripts.length : 1;
  captureSelectedFiles = [];
  captureUploadFeedback = {
    warning: warnings.length > 0,
    message: `${uploaded} source${uploaded === 1 ? '' : 's'} saved.${warnings.length ? ` ${warnings.join(' | ')}` : ''}`
  };
  await refreshProject();
}

// Activate a screen by name. Both the sidebar nav items and the header help (?) icon route
// here — Help lives on the icon, not in the nav, so no nav item matches it.
function activateDemoTab(tab) {
  demoCurrentTab = DEMO_TABS.has(tab) ? tab : 'overview';
  const primaryTab = ({ portfolio: 'overview', tracking: 'stories', timeline: 'stories', briefings: 'reports', teams: 'reports' })[demoCurrentTab] || demoCurrentTab;
  navButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === primaryTab));
  helpButton?.classList.toggle('active', demoCurrentTab === 'help');
  const meta = DEMO_SCREEN_META[demoCurrentTab] || DEMO_SCREEN_META.overview;
  mainTitle.textContent = meta.title;
  mainSubtitle.textContent = meta.scope;
  renderDemoShell();
}

function activateTab(tab) {
  if (demoSession) {
    activateDemoTab(tab);
    return;
  }
  currentTab = tab;
  const primaryTab = ({ portfolio: 'overview', tracking: 'stories', timeline: 'stories', briefings: 'reports', teams: 'reports' })[tab] || tab;
  navButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === primaryTab));
  helpButton.classList.toggle('active', tab === 'help');
  updateHeader();
  overviewPanel.classList.toggle('active-panel', tab === 'overview');
  portfolioPanel.classList.toggle('active-panel', tab === 'portfolio');
  storiesPanel.classList.toggle('active-panel', tab === 'stories');
  trackingPanel.classList.toggle('active-panel', tab === 'tracking');
  timelinePanel.classList.toggle('active-panel', tab === 'timeline');
  transcriptsPanel.classList.toggle('active-panel', tab === 'transcripts');
  briefingsPanel.classList.toggle('active-panel', tab === 'briefings');
  reportsPanel.classList.toggle('active-panel', tab === 'reports');
  teamsPanel.classList.toggle('active-panel', tab === 'teams');
  managePanel.classList.toggle('active-panel', tab === 'manage');
  helpPanel.classList.toggle('active-panel', tab === 'help');
  if (tab === 'briefings') fetchBriefings();
}

function toggleLinkStoryForm(timelineId) {
  const form = document.getElementById(`link-form-${timelineId}`);
  if (form) {
    form.classList.toggle('hidden');
  }
}

async function submitLinkStory(timelineId) {
  const storyId = document.getElementById(`timeline-story-select-${timelineId}`)?.value;
  if (!storyId) {
    alert('Select a work item to link.');
    return;
  }

  await fetch('/api/project/story/link', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: selectedProject, storyId, timelineId })
  });

  await refreshProject();
}

function startStoryFromTimeline(timelineId) {
  if (!selectedProject) {
    alert('Select a project first.');
    return;
  }

  // Open the Work Items screen with the new-item form expanded, then pre-fill from the milestone.
  storyShowAddForm = true;
  activateTab('stories');
  storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);

  setTimeout(() => {
    const storyTimeline = document.getElementById('story-timeline');
    const storySummary = document.getElementById('story-summary');
    const timelineItem = (projects[selectedProject].timeline || []).find(t => t.id === timelineId);
    if (storyTimeline) storyTimeline.value = timelineId;
    if (storySummary) {
      storySummary.value = timelineItem ? timelineItem.title : '';
      storySummary.focus();
    }
  }, 40);
}

navButtons.forEach(button => button.addEventListener('click', () => activateTab(button.dataset.tab)));
quickCaptureButton.addEventListener('click', () => openCapture('meeting'));
helpButton.addEventListener('click', () => activateTab('help'));

// Sidebar collapse/expand
function initSidebarToggle() {
  const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
  if (sidebarCollapsed) {
    appElement.classList.add('sidebar-collapsed');
    sidebarToggle.setAttribute('title', 'Expand sidebar');
    sidebarToggle.setAttribute('aria-label', 'Expand sidebar');
  }
}

function toggleSidebar() {
  appElement.classList.toggle('sidebar-collapsed');
  const isCollapsed = appElement.classList.contains('sidebar-collapsed');
  localStorage.setItem('sidebarCollapsed', isCollapsed);
  sidebarToggle.setAttribute('title', isCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
  sidebarToggle.setAttribute('aria-label', isCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
}

sidebarToggle.addEventListener('click', toggleSidebar);
document.addEventListener('click', event => {
  const button = event.target.closest('.js-copy-text');
  if (!button) return;
  const text = copyPayloads.get(button.dataset.copyKey) || '';
  copyText(text, button.dataset.copyMessage || 'Copied text.');
});
initSidebarToggle();

async function initializeApp() {
  await fetchDemoConfig();
  if (!demoSession) await fetchProjects();
}

initializeApp();
