'use strict';

(function targetApplication() {
  const contextModule = window.PriorenaTargetContext;
  const workflowModule = window.PriorenaTargetWorkflow;
  const triageModule = window.PriorenaTargetTriage;
  const importFeedModule = window.PriorenaTargetImportFeed;
  const evidenceReviewModule = window.PriorenaTargetEvidenceReview;
  const briefingModule = window.PriorenaTargetBriefing;
  if (!contextModule || !workflowModule || !triageModule || !importFeedModule || !evidenceReviewModule || !briefingModule) throw new Error('Target state modules are unavailable');

  const byId = id => document.getElementById(id);
  const elements = Object.freeze({
    start: byId('target-start'),
    initialize: byId('initialize-target'),
    shell: byId('target-shell'),
    organization: byId('organization-select'),
    workspace: byId('workspace-select'),
    navigation: byId('target-navigation'),
    main: byId('target-main'),
    breadcrumb: byId('context-breadcrumb'),
    title: byId('page-title'),
    description: byId('page-description'),
    initiative: byId('initiative-indicator'),
    status: byId('target-status'),
    view: byId('target-view'),
    dialog: byId('target-dialog'),
    dialogTitle: byId('dialog-title'),
    dialogDescription: byId('dialog-description'),
    dialogCancel: byId('dialog-cancel'),
    dialogConfirm: byId('dialog-confirm')
  });

  const pageDefinitions = Object.freeze({
    portfolio: ['Portfolio', 'Organization-scoped delivery attention across Workspaces.'],
    today: ['Today', 'Attention-first current state for the selected Workspace.'],
    'work-items': ['Work Items', 'Review what Priorena knows, where it came from, and what explicit action to take next.'],
    'follow-up': ['Follow-Up', 'PM attention attached to Work Items in this Workspace.'],
    milestones: ['Milestones', 'Workspace and Initiative delivery checkpoints.'],
    'add-source': ['Add Source', 'Add local material for separate Finding review.'],
    'import-feed': ['Import Feed', 'Validate, review, map, and explicitly apply a local target-v4 feed.'],
    'source-library': ['Source Library', 'Workspace Sources and how each one was added.'],
    review: ['Review', 'Review Findings and Proposed changes as separate consequences.'],
    search: ['Search', 'Search only the selected Workspace.'],
    briefings: ['Briefings', 'Prepare, Open, and History for canonical stakeholder communication.'],
    settings: ['Settings', 'Manage your Organization, Workspace, Initiatives, and delivery settings.']
  });

  const state = {
    initialized: false,
    organizations: [],
    context: null,
    workflow: null,
    briefings: { tab: 'prepare', definitions: [], revision: null, initiativesByWorkspace: new Map(), activeDefinitionId: null, activeVersionId: null, renderGeneration: 0 },
    activeView: 'portfolio',
    initiativeFilter: 'all',
    workstreamFilter: 'all',
    jiraEpicFilter: 'all',
    itemTypeFilter: 'all',
    selectedWorkItemIds: new Set(),
    triage: triageModule.createTriageState(),
    importFeed: importFeedModule.createImportFeedState(),
    evidenceReview: evidenceReviewModule.newEvidenceReviewState(),
    generation: 0
  };

  function clearImportFeedData() {
    state.importFeed = importFeedModule.createImportFeedState();
  }

  function clearTriageData() {
    state.triage = triageModule.createTriageState();
  }

  function clearEvidenceReviewData() {
    state.evidenceReview = evidenceReviewModule.newEvidenceReviewState();
  }

  function invalidateTriageData() {
    state.triage.collection = null;
    state.triage.detail = null;
    state.triage.sourceDetail = null;
    state.triage.revision = null;
    state.triage.returnFocusWorkItemId = null;
  }

  function node(tag, options = {}, children = []) {
    const value = document.createElement(tag);
    if (options.className) value.className = options.className;
    if (options.text !== undefined) value.textContent = String(options.text);
    if (options.type) value.type = options.type;
    if (options.id) value.id = options.id;
    if (options.name) value.name = options.name;
    if (options.value !== undefined) value.value = String(options.value);
    if (options.checked !== undefined) value.checked = Boolean(options.checked);
    if (options.disabled !== undefined) value.disabled = Boolean(options.disabled);
    if (options.placeholder) value.placeholder = options.placeholder;
    if (options.attrs) Object.entries(options.attrs).forEach(([name, setting]) => value.setAttribute(name, String(setting)));
    if (options.on) Object.entries(options.on).forEach(([event, listener]) => value.addEventListener(event, listener));
    const childValues = Array.isArray(children) ? children : [children];
    childValues.filter(child => child !== null && child !== undefined).forEach(child => {
      value.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return value;
  }

  function option(value, label, selected = false) {
    return node('option', { value, text: label, attrs: selected ? { selected: 'selected' } : {} });
  }

  function setStatus(message, kind = '') {
    elements.status.textContent = message || '';
    elements.status.className = `status${kind ? ` ${kind}` : ''}`;
  }

  function empty(message) {
    return node('div', { className: 'empty', text: message });
  }

  function showLoading(message = 'Loading workspace data…') {
    elements.view.replaceChildren(empty(message));
    setStatus(message);
  }

  function stableId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
      throw new Error('A stable target ID is required');
    }
    return value;
  }

  function encoded(value) {
    return encodeURIComponent(stableId(value));
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body?.error?.message || 'The target request failed');
      error.code = body?.error?.code || 'REQUEST_FAILED';
      throw error;
    }
    return {
      body,
      revision: response.headers.get('x-priorena-target-revision')
    };
  }

  function mutationOptions(value, method = 'POST') {
    return {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value)
    };
  }

  const contextApi = contextModule.createTargetApiClient({ request: url => fetch(url) });
  const contextController = contextModule.createTargetContextController(contextApi);
  const workflowApi = workflowModule.createTargetWorkflowApiClient({ request: (url, options) => fetch(url, options) });
  const triageApi = triageModule.createTargetTriageApiClient({ request: (url, options) => fetch(url, options) });
  const evidenceReviewApi = evidenceReviewModule.createTargetEvidenceReviewApiClient({ request: (url, options) => fetch(url, options) });
  const briefingApi = briefingModule.createTargetBriefingApiClient({ request: (url, options) => fetch(url, options) });

  function clearBriefingData() {
    state.briefings = { tab: 'prepare', definitions: [], revision: null, initiativesByWorkspace: new Map(), activeDefinitionId: null, activeVersionId: null, renderGeneration: 0 };
  }

  function briefingOperationToken() {
    return { generation: state.generation, organizationId: state.context?.activeOrganizationId };
  }

  function briefingOperationCurrent(token) {
    return token.generation === state.generation && token.organizationId === state.context?.activeOrganizationId;
  }

  function workspaceOperationToken() {
    return {
      generation: state.generation,
      organizationId: state.context?.activeOrganizationId,
      workspaceId: state.context?.activeWorkspaceId
    };
  }

  function workspaceOperationCurrent(token) {
    return token.generation === state.generation && token.organizationId === state.context?.activeOrganizationId &&
      token.workspaceId === state.context?.activeWorkspaceId;
  }

  function cancelOpenConfirmation() {
    if (!elements.dialog.open) return;
    elements.dialog.returnValue = 'cancel';
    elements.dialog.close('cancel');
  }

  function selectedOrganization() {
    return state.organizations.find(item => item.id === state.context?.activeOrganizationId) || null;
  }

  function selectedWorkspace() {
    return state.context?.workspaces?.find(item => item.id === state.context.activeWorkspaceId) || null;
  }

  function initiativeName(initiativeId) {
    if (initiativeId === null) return 'Unassigned';
    return state.workflow?.initiatives?.find(item => item.id === initiativeId)?.name || 'Initiative unavailable';
  }

  function workstreamName(workstreamId) {
    if (workstreamId === null) return 'No Workstream';
    return state.workflow?.workstreams?.find(item => item.id === workstreamId)?.name || 'Workstream unavailable';
  }

  function workstreamOptionLabel(workstream) {
    return `${workstream.name} · ${workstream.id}`;
  }

  function jiraEpicName(mappingId) {
    if (mappingId === null) return 'No Jira Epic';
    const mapping = state.workflow?.jiraEpicMappings?.find(item => item.id === mappingId);
    return mapping ? `${mapping.jiraEpicKey} — ${mapping.jiraEpicName}` : 'Jira Epic unavailable';
  }

  function jiraEpicOptionLabel(mapping) {
    return `${mapping.jiraEpicKey} — ${mapping.jiraEpicName} · ${mapping.mappingStatus} · ${mapping.id}`;
  }

  function clearOperationalUi(message = 'Select a valid context to continue.') {
    const reset = workflowModule.defaultWorkItemUiState();
    state.workflow = null;
    invalidateTriageData();
    state.initiativeFilter = reset.filters.initiativeId;
    state.workstreamFilter = reset.filters.workstreamId;
    state.jiraEpicFilter = reset.filters.jiraEpicMappingId;
    state.itemTypeFilter = reset.filters.itemType;
    state.selectedWorkItemIds.clear();
    elements.view.replaceChildren(empty(message));
    elements.initiative.textContent = 'All initiatives';
    updateBreadcrumb();
  }

  function activateView(view) {
    const reset = workflowModule.defaultWorkItemUiState();
    state.activeView = view;
    state.initiativeFilter = reset.filters.initiativeId;
    state.workstreamFilter = reset.filters.workstreamId;
    state.jiraEpicFilter = reset.filters.jiraEpicMappingId;
    state.itemTypeFilter = reset.filters.itemType;
    state.selectedWorkItemIds.clear();
    renderActiveView();
  }

  function updateBreadcrumb() {
    const organization = selectedOrganization();
    const workspace = selectedWorkspace();
    const organizationScoped = ['portfolio', 'briefings'].includes(state.activeView);
    if (organizationScoped) {
      elements.breadcrumb.textContent = organization?.name || 'Organization required';
      elements.initiative.textContent = 'Organization';
      elements.initiative.hidden = true;
      return;
    }
    const initiative = state.initiativeFilter === 'all'
      ? 'All initiatives'
      : (state.initiativeFilter === 'unassigned' ? 'Unassigned' : initiativeName(state.initiativeFilter));
    elements.breadcrumb.textContent = [organization?.name || 'Organization required', workspace?.name, initiative]
      .filter(Boolean)
      .join(' · ');
    elements.initiative.textContent = initiative;
    elements.initiative.hidden = false;
  }

  function setPageHeader() {
    const definition = pageDefinitions[state.activeView];
    elements.title.textContent = definition[0];
    elements.description.textContent = definition[1];
    elements.navigation.querySelectorAll('[data-view]').forEach(button => {
      if (button.dataset.view === state.activeView) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    updateBreadcrumb();
  }

  function fillOrganizations() {
    elements.organization.replaceChildren(...state.organizations.map(item => option(item.id, item.name, item.id === state.context?.activeOrganizationId)));
    elements.organization.disabled = state.organizations.length === 0;
  }

  function fillWorkspaces() {
    const workspaces = state.context?.workspaces || [];
    elements.workspace.replaceChildren(...workspaces.map(item => option(item.id, item.name, item.id === state.context?.activeWorkspaceId)));
    elements.workspace.disabled = workspaces.length === 0;
  }

  function metric(label, value) {
    return node('article', { className: 'card metric' }, [
      node('span', { className: 'meta', text: label }),
      node('strong', { text: value })
    ]);
  }

  function badge(text, className = '') {
    return node('span', { className: `badge${className ? ` ${className}` : ''}`, text });
  }

  function recordList(records, renderer, emptyMessage) {
    if (!records.length) return empty(emptyMessage);
    return node('ul', { className: 'list' }, records.map(record => node('li', { className: 'list-item' }, renderer(record))));
  }

  async function loadWorkflow(includeWorkItems = true) {
    const organizationId = state.context?.activeOrganizationId;
    const workspaceId = state.context?.activeWorkspaceId;
    if (!organizationId || !workspaceId) throw new Error('A Workspace is required');
    const generation = state.generation;
    const payload = await workflowApi.loadWorkspace(organizationId, workspaceId, { includeWorkItems });
    if (generation !== state.generation) return null;
    workflowModule.validateWorkspacePayload(payload, organizationId, workspaceId);
    state.workflow = payload;
    return payload;
  }

  async function ensureWorkflow(includeWorkItems = true) {
    if (state.workflow && (!includeWorkItems || state.workflow.workItemsLoaded !== false)) return state.workflow;
    return loadWorkflow(includeWorkItems);
  }

  async function loadTriageCollection() {
    const token = workspaceOperationToken();
    if (!token.organizationId || !token.workspaceId) throw new Error('A Workspace is required');
    const requestId = ++state.triage.requestId;
    state.triage.loading = true;
    try {
      const result = await triageApi.list(token.organizationId, token.workspaceId, state.triage.query);
      if (!workspaceOperationCurrent(token) || requestId !== state.triage.requestId) return null;
      state.triage.collection = result.body;
      state.triage.query = triageModule.updateTriageQuery(
        state.triage.query,
        { page: result.body.pagination.page },
        { resetPage: false }
      );
      state.triage.revision = result.revision;
      state.triage.loading = false;
      return result.body;
    } catch (error) {
      if (workspaceOperationCurrent(token) && requestId === state.triage.requestId) state.triage.loading = false;
      throw error;
    }
  }

  async function refreshTriageCollection(message = 'Triage results refreshed.') {
    showLoading('Loading bounded Work Item results…');
    state.selectedWorkItemIds.clear();
    state.triage.detail = null;
    state.triage.sourceDetail = null;
    await loadTriageCollection();
    renderWorkItems();
    setStatus(message, 'success');
  }

  async function changeTriageQuery(changes, message) {
    state.triage.query = triageModule.updateTriageQuery(state.triage.query, changes);
    state.initiativeFilter = state.triage.query.initiativeId;
    updateBreadcrumb();
    try {
      await refreshTriageCollection(message);
    } catch (error) {
      setStatus(error.message, 'error');
      renderWorkItems();
    }
  }

  async function openTriageDetail(workItemId) {
    const token = workspaceOperationToken();
    const requestId = ++state.triage.detailRequestId;
    state.triage.returnFocusWorkItemId = triageModule.triageStableId(workItemId);
    setStatus('Loading Work Item detail…');
    try {
      const result = await triageApi.detail(token.organizationId, token.workspaceId, workItemId);
      if (!workspaceOperationCurrent(token) || requestId !== state.triage.detailRequestId) return;
      state.triage.detail = result.body;
      state.triage.sourceDetail = null;
      state.triage.revision = result.revision;
      renderWorkItems();
      const panel = document.getElementById('triage-detail-panel');
      panel?.focus();
      setStatus(`Opened ${result.body.workItem.externalKey || result.body.workItem.summary}.`, 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token) || requestId !== state.triage.detailRequestId) return;
      setStatus(error.message, 'error');
    }
  }

  function closeTriageDetail() {
    const returnId = state.triage.returnFocusWorkItemId;
    state.triage.detail = null;
    state.triage.sourceDetail = null;
    state.triage.returnFocusWorkItemId = null;
    renderWorkItems();
    if (returnId) document.querySelector(`[data-open-work-item="${returnId}"]`)?.focus();
    setStatus('Work Item detail closed. Triage context preserved.', 'success');
  }

  async function viewTriageSourceMatch(workItemId, match) {
    const token = workspaceOperationToken();
    const requestId = ++state.triage.detailRequestId;
    setStatus('Loading the explicit Source match…');
    try {
      const result = await triageApi.sourceMatch(
        token.organizationId,
        token.workspaceId,
        workItemId,
        match.source.id,
        match.recordIndex
      );
      if (!workspaceOperationCurrent(token) || requestId !== state.triage.detailRequestId) return;
      state.triage.sourceDetail = result.body;
      state.triage.revision = result.revision;
      renderWorkItems();
      document.getElementById('triage-source-detail')?.focus();
      setStatus('Source match opened. Viewing it did not create Evidence or change current state.', 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token) || requestId !== state.triage.detailRequestId) return;
      setStatus(error.message, 'error');
    }
  }

  async function renderPortfolio() {
    const organizationId = state.context?.activeOrganizationId;
    const generation = state.generation;
    if (!organizationId) {
      elements.view.replaceChildren(empty('Select an Organization to open Portfolio.'));
      return;
    }
    const result = await requestJson(`/api/v2/organizations/${encoded(organizationId)}/portfolio`);
    if (generation !== state.generation || organizationId !== state.context?.activeOrganizationId) return;
    const portfolio = result.body;
    const counts = portfolio.counts;
    elements.view.replaceChildren(
      node('div', { className: 'metric-grid' }, [
        metric('Workspaces', counts.workspaces),
        metric('Work Items', counts.workItems),
        metric('Findings to review', counts.findingsToReview),
        metric('Open Follow-Ups', counts.openFollowUps),
        metric('Milestones', counts.milestones),
        metric('Briefings', counts.briefings)
      ]),
      node('section', { className: 'panel' }, [
        node('h2', { text: 'Workspaces' }),
        recordList(portfolio.workspaces, workspace => [
          node('div', { className: 'row-head' }, [node('strong', { text: workspace.name }), badge(`${workspace.counts.workItems} Work Items`)]),
          node('p', { className: 'meta', text: `${workspace.counts.openFollowUps} open Follow-Ups · ${workspace.counts.findingsToReview} Findings to review · ${workspace.counts.unassignedWorkItems} Unassigned` })
        ], 'This Organization has no Workspaces.')
      ])
    );
  }

  async function renderToday() {
    const organizationId = state.context?.activeOrganizationId;
    const workspaceId = state.context?.activeWorkspaceId;
    const generation = state.generation;
    if (!workspaceId) {
      elements.view.replaceChildren(empty('Select a Workspace to open Today.'));
      return;
    }
    const result = await requestJson(`/api/v2/organizations/${encoded(organizationId)}/workspaces/${encoded(workspaceId)}/today`);
    if (generation !== state.generation || organizationId !== state.context?.activeOrganizationId || workspaceId !== state.context?.activeWorkspaceId) return;
    const today = result.body;
    elements.view.replaceChildren(
      node('div', { className: 'metric-grid' }, [
        metric('Blocked or at risk', today.counts.blockedWorkItems),
        metric('Open Follow-Ups', today.counts.openFollowUps),
        metric('Milestones', today.counts.milestones),
        metric('Findings to review', today.counts.findingsToReview),
        metric('Unassigned', today.counts.unassignedWorkItems)
      ]),
      node('div', { className: 'card-grid' }, [
        node('section', { className: 'card' }, [
          node('h2', { text: 'Delivery attention' }),
          recordList(today.attention.blockedWorkItems, item => [
            node('div', { className: 'row-head' }, [node('strong', { text: item.summary }), badge(item.initiative?.name || 'Unassigned')]),
            node('p', { className: 'risk', text: item.canonicalStatus }),
            node('p', { className: 'meta', text: `How this status was confirmed: ${item.currentStateProvenance}` })
          ], 'No blocked or at-risk Work Items in this Workspace.')
        ]),
        node('section', { className: 'card' }, [
          node('h2', { text: 'Follow-Up' }),
          recordList(today.attention.followUps, item => [
            node('div', { className: 'row-head' }, [node('strong', { text: item.summary }), badge(item.initiative?.name || 'Unassigned')]),
            node('p', { text: item.followUp.nextAction || 'Add follow-up details.' }),
            node('p', { className: 'meta', text: workflowModule.commentCaptureLabel(item.followUp.lastCapturedCommentAt) })
          ], 'No open Follow-Ups.')
        ]),
        node('section', { className: 'card' }, [
          node('h2', { text: 'Milestone pressure' }),
          recordList(today.attention.milestones, milestone => [
            node('div', { className: 'row-head' }, [node('strong', { text: milestone.title }), badge(milestone.applicability.label)]),
            node('p', { text: `Applies to: ${milestone.applicability.label}` }),
            node('p', { className: milestone.timing.pressure === 'overdue' ? 'risk' : (milestone.timing.pressure === 'due-soon' ? 'warning' : 'meta'), text: `${milestone.date} · ${milestone.timing.pressure}` })
          ], 'No Milestones require attention in this Workspace.')
        ]),
        node('section', { className: 'card' }, [
          node('h2', { text: 'Findings to review' }),
          node('p', { className: 'meta', text: 'Findings are unreviewed and are not Evidence.' }),
          recordList(today.attention.findingsToReview, finding => [
            node('blockquote', { text: finding.exactExcerpt }),
            node('p', { className: 'meta', text: `Source ${finding.sourceId} · ${finding.proposedInitiativeId ? `Initiative ${finding.proposedInitiativeId}` : 'Initiative not selected'} · ${finding.proposedWorkItemId ? `Work Item ${finding.proposedWorkItemId}` : 'Work Item not selected'}` })
          ], 'No Findings are awaiting review in this Workspace.')
        ])
      ])
    );
  }

  function triageInitiativeFilterControl() {
    const current = state.triage.query.initiativeId;
    const select = node('select', {
      id: 'initiative-filter',
      attrs: { 'aria-label': 'Filter by Initiative' },
      on: { change: event => {
        const initiativeId = event.target.value;
        const changes = { initiativeId };
        const selectedWorkstream = state.workflow?.workstreams?.find(item => item.id === state.triage.query.workstreamId);
        const selectedMapping = state.workflow?.jiraEpicMappings?.find(item => item.id === state.triage.query.jiraEpicMappingId);
        if (initiativeId === 'unassigned' || (initiativeId !== 'all' && selectedWorkstream?.initiativeId !== initiativeId)) changes.workstreamId = 'all';
        if (initiativeId === 'unassigned' || (initiativeId !== 'all' && selectedMapping?.initiativeId !== initiativeId)) changes.jiraEpicMappingId = 'all';
        changeTriageQuery(changes, 'Initiative filter applied.');
      } }
    }, [
      option('all', 'All initiatives', current === 'all'),
      option('unassigned', 'Unassigned', current === 'unassigned'),
      ...workflowModule.initiativeChoices(state.workflow?.initiatives || [], 'work-item-filter')
        .map(initiative => option(initiative.id, initiative.name, current === initiative.id))
    ]);
    return node('label', {}, [node('span', { text: 'Initiative' }), select]);
  }

  function triageWorkstreamFilterControl() {
    const current = state.triage.query.workstreamId;
    const initiativeId = state.triage.query.initiativeId;
    const workstreams = (state.workflow?.workstreams || []).filter(item => initiativeId === 'all' || item.initiativeId === initiativeId);
    const select = node('select', {
      id: 'workstream-filter',
      attrs: { 'aria-label': 'Filter by Workstream' },
      on: { change: event => changeTriageQuery({ workstreamId: event.target.value }, 'Workstream filter applied.') }
    }, [
      option('all', 'All Workstreams', current === 'all'),
      option('none', 'No Workstream', current === 'none'),
      ...workstreams.map(item => option(item.id, workstreamOptionLabel(item), current === item.id))
    ]);
    return node('label', {}, [node('span', { text: 'Workstream' }), select]);
  }

  function triageJiraEpicFilterControl() {
    const current = state.triage.query.jiraEpicMappingId;
    const initiativeId = state.triage.query.initiativeId;
    const mappings = (state.workflow?.jiraEpicMappings || []).filter(item => initiativeId === 'all' || item.initiativeId === initiativeId);
    const select = node('select', {
      id: 'jira-epic-filter',
      attrs: { 'aria-label': 'Filter by Jira Epic mapping' },
      on: { change: event => changeTriageQuery({ jiraEpicMappingId: event.target.value }, 'Jira Epic filter applied.') }
    }, [
      option('all', 'All Jira Epics', current === 'all'),
      option('none', 'No Jira Epic', current === 'none'),
      ...mappings.map(item => option(item.id, jiraEpicOptionLabel(item), current === item.id))
    ]);
    return node('label', {}, [node('span', { text: 'Jira Epic' }), select]);
  }

  async function previewInitiativeAssignment(initiativeId, workstreamId = 'keep', jiraEpicMappingId = 'keep') {
    if (!state.selectedWorkItemIds.size) {
      setStatus('Select at least one Work Item.', 'error');
      return;
    }
    const token = workspaceOperationToken();
    const selectedWorkItemIds = [...state.selectedWorkItemIds];
    const action = {
      type: 'assign-initiative',
      initiativeId: initiativeId === 'unassigned' ? null : initiativeId
    };
    if (initiativeId === 'unassigned' || workstreamId !== 'keep') {
      action.workstreamId = workstreamId === 'none' || initiativeId === 'unassigned' ? null : workstreamId;
    }
    if (initiativeId === 'unassigned' || jiraEpicMappingId !== 'keep') {
      action.jiraEpicMappingId = jiraEpicMappingId === 'none' || initiativeId === 'unassigned' ? null : jiraEpicMappingId;
    }
    setStatus('Preparing exact Initiative changes…');
    try {
      const result = await workflowApi.previewBulkWorkItems(token.organizationId, token.workspaceId, {
        workItemIds: selectedWorkItemIds,
        action
      });
      if (!workspaceOperationCurrent(token)) return;
      const rows = result.preview.rows.map(row => node('p', {
        text: `${row.workItemId}: Initiative ${row.before === null ? 'Unassigned' : initiativeName(row.before)} → ${row.after === null ? 'Unassigned' : initiativeName(row.after)}; Workstream ${workstreamName(row.workstreamChange?.beforeWorkstreamId || null)} → ${workstreamName(row.workstreamChange?.afterWorkstreamId || null)} (${row.workstreamChange?.effect || 'unchanged'}); Jira Epic ${jiraEpicName(row.jiraEpicChange?.beforeJiraEpicMappingId || null)} → ${jiraEpicName(row.jiraEpicChange?.afterJiraEpicMappingId || null)} (${row.jiraEpicChange?.effect || 'unchanged'})`
      }));
      const approved = await confirmAction(
        'Confirm Initiative, Workstream, and Jira Epic assignment',
        [node('p', { text: 'The server reconstructed these exact current values. No change is applied until confirmation.' }), ...rows],
        'Apply associations'
      );
      if (!approved || !workspaceOperationCurrent(token)) {
        if (!workspaceOperationCurrent(token)) return;
        setStatus('No Initiative assignment was applied.');
        return;
      }
      await workflowApi.applyBulkWorkItems(token.organizationId, token.workspaceId, {
        expectedRevision: result.preview.expectedRevision,
        actor: 'local-target-ui',
        workItemIds: selectedWorkItemIds,
        action,
        previewHash: result.preview.previewHash
      });
      if (!workspaceOperationCurrent(token)) return;
      state.workflow = null;
      state.selectedWorkItemIds.clear();
      state.triage.detail = null;
      state.triage.sourceDetail = null;
      await loadWorkflow(false);
      await loadTriageCollection();
      if (!workspaceOperationCurrent(token)) return;
      renderWorkItems();
      setStatus('Initiative assignment applied and refreshed.', 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      setStatus(error.code === 'REVISION_CONFLICT' || error.code === 'PREVIEW_CONFLICT'
        ? 'The workspace changed. Refresh and review the action again.'
        : error.message, 'error');
    }
  }

  function workItemFiltersActive() {
    const query = state.triage.query;
    return query.search !== '' || query.itemType !== 'all' || query.canonicalStatus !== 'all' ||
      query.initiativeId !== 'all' || query.workstreamId !== 'all' || query.jiraEpicMappingId !== 'all' ||
      query.sourceId !== 'all' || query.signal !== 'all';
  }

  async function clearWorkItemFilters() {
    state.triage.query = triageModule.clearTriageFilters(state.triage.query);
    state.initiativeFilter = 'all';
    updateBreadcrumb();
    try {
      await refreshTriageCollection('Work Item filters cleared.');
    } catch (error) {
      setStatus(error.message, 'error');
      renderWorkItems();
    }
  }

  function triageSummaryPanel(collection) {
    const summary = collection.summary;
    return node('section', { className: 'panel triage-summary', attrs: { 'aria-labelledby': 'triage-summary-title' } }, [
      node('div', { className: 'row-head' }, [
        node('h2', { id: 'triage-summary-title', text: 'Triage summary' }),
        node('span', { className: 'meta', text: 'Workspace-wide · derived from canonical state and exact Source matches' })
      ]),
      node('div', { className: 'triage-metrics' }, [
        metric('Total Work Items', summary.totalWorkItems),
        metric('Type unresolved', summary.typeUnresolved),
        metric('Status suggestion needs evidence', summary.statusSuggestionNeedsEvidence),
        metric('Initiative unassigned', summary.initiativeUnassigned),
        metric('Source trace available', summary.sourceTraceAvailable),
        metric('No Source trace', summary.noSourceTrace)
      ])
    ]);
  }

  function triageToolbar(collection) {
    const query = state.triage.query;
    const searchInput = node('input', {
      value: query.search,
      placeholder: 'Search Jira key or summary',
      attrs: { maxlength: '200', 'aria-label': 'Search Work Items by Jira key or summary' }
    });
    const searchForm = node('form', { className: 'triage-search' }, [
      node('label', { className: 'field' }, [node('span', { text: 'Search' }), searchInput]),
      node('button', { className: 'button secondary', type: 'submit', text: 'Search' })
    ]);
    searchForm.addEventListener('submit', event => {
      event.preventDefault();
      changeTriageQuery({ search: searchInput.value.trim() }, 'Search applied.');
    });
    const sort = node('select', {
      attrs: { 'aria-label': 'Sort Work Items' },
      on: { change: event => changeTriageQuery({ sort: event.target.value }, 'Sort applied.') }
    }, [
      ['triage-signals', 'Triage signals'],
      ['jira-key', 'Jira key'],
      ['summary', 'Summary'],
      ['item-type', 'Canonical type'],
      ['canonical-status', 'Canonical status'],
      ['initiative', 'Initiative'],
      ['created-at', 'Import / creation time']
    ].map(([value, label]) => option(value, label, query.sort === value)));
    const direction = node('select', {
      attrs: { 'aria-label': 'Sort direction' },
      on: { change: event => changeTriageQuery({ direction: event.target.value }, 'Sort direction applied.') }
    }, [option('asc', 'Ascending', query.direction === 'asc'), option('desc', 'Descending', query.direction === 'desc')]);
    const pageSize = node('select', {
      attrs: { 'aria-label': 'Work Items per page' },
      on: { change: event => changeTriageQuery({ pageSize: Number(event.target.value) }, 'Page size applied.') }
    }, [25, 50].map(value => option(value, `${value} per page`, query.pageSize === value)));
    return node('section', { className: 'panel triage-toolbar', attrs: { 'aria-label': 'Work Item search and sort' } }, [
      searchForm,
      node('div', { className: 'triage-toolbar-controls' }, [
        node('p', { className: 'triage-result-count', text: `${collection.filteredTotal} matching Work Item${collection.filteredTotal === 1 ? '' : 's'}` }),
        node('label', { className: 'field' }, [node('span', { text: 'Sort' }), sort]),
        node('label', { className: 'field' }, [node('span', { text: 'Direction' }), direction]),
        node('label', { className: 'field' }, [node('span', { text: 'Page size' }), pageSize])
      ])
    ]);
  }

  function triageFiltersPanel(collection) {
    const query = state.triage.query;
    const type = node('select', {
      attrs: { 'aria-label': 'Filter by canonical Work Item type' },
      on: { change: event => changeTriageQuery({ itemType: event.target.value }, 'Type filter applied.') }
    }, ['all', ...triageModule.TRIAGE_ITEM_TYPES].map(value => option(value, value === 'all' ? 'All Work Item types' : value, query.itemType === value)));
    const status = node('select', {
      attrs: { 'aria-label': 'Filter by canonical Work Item status' },
      on: { change: event => changeTriageQuery({ canonicalStatus: event.target.value }, 'Status filter applied.') }
    }, [option('all', 'All canonical statuses', query.canonicalStatus === 'all'),
      ...collection.filterOptions.canonicalStatuses.map(value => option(value, value, query.canonicalStatus === value))]);
    const source = node('select', {
      attrs: { 'aria-label': 'Filter by exact Source' },
      on: { change: event => changeTriageQuery({ sourceId: event.target.value }, 'Exact Source filter applied.') }
    }, [option('all', 'All Sources', query.sourceId === 'all'),
      ...collection.filterOptions.sources.map(item => option(item.id, item.title, query.sourceId === item.id))]);
    const signal = node('select', {
      attrs: { 'aria-label': 'Filter by triage signal' },
      on: { change: event => changeTriageQuery({ signal: event.target.value }, 'Triage signal filter applied.') }
    }, [
      ['all', 'All triage signals'],
      ['type-unresolved', 'Type unresolved'],
      ['status-suggestion-needs-evidence', 'Status suggestion needs evidence'],
      ['initiative-unassigned', 'Initiative unassigned'],
      ['source-trace-available', 'Source trace available'],
      ['no-source-trace', 'No Source trace']
    ].map(([value, label]) => option(value, label, query.signal === value)));
    return node('fieldset', { className: 'control-group filters-group' }, [
      node('legend', { text: 'Filters' }),
      node('div', { className: 'control-grid' }, [
        node('label', {}, [node('span', { text: 'Type' }), type]),
        node('label', {}, [node('span', { text: 'Canonical status' }), status]),
        triageInitiativeFilterControl(),
        triageWorkstreamFilterControl(),
        triageJiraEpicFilterControl(),
        node('label', {}, [node('span', { text: 'Exact Source' }), source]),
        node('label', {}, [node('span', { text: 'Triage signal' }), signal])
      ]),
      node('button', { className: 'button secondary', type: 'button', text: 'Clear filters', disabled: !workItemFiltersActive(), on: { click: clearWorkItemFilters } })
    ]);
  }

  function triageStructureAssignment() {
    const assignment = node('select', { id: 'initiative-assignment' }, [
      option('unassigned', 'Unassigned'),
      ...workflowModule.initiativeChoices(state.workflow?.initiatives || [], 'bulk-assignment').map(initiative => option(initiative.id, initiative.name))
    ]);
    const workstreamAssignment = node('select', { id: 'workstream-assignment' });
    const jiraEpicAssignment = node('select', { id: 'jira-epic-assignment' });
    const selectedCount = node('strong', { className: 'selected-count', attrs: { id: 'selected-work-item-count' } });
    const helper = node('p', { className: 'meta bulk-helper', text: 'Select one or more Work Items to change their associations.', attrs: { id: 'bulk-assignment-help' } });
    const previewButton = node('button', {
      className: 'button primary', type: 'button', text: 'Preview changes', attrs: { 'aria-describedby': 'bulk-assignment-help' },
      on: { click: () => previewInitiativeAssignment(assignment.value, workstreamAssignment.value, jiraEpicAssignment.value) }
    });
    const refresh = () => {
      const controls = workflowModule.workItemControlState([...state.selectedWorkItemIds], assignment.value);
      selectedCount.textContent = controls.selectedCountLabel;
      assignment.disabled = controls.initiativeDisabled;
      workstreamAssignment.disabled = controls.workstreamDisabled;
      jiraEpicAssignment.disabled = controls.jiraEpicDisabled;
      previewButton.disabled = controls.previewDisabled;
      helper.hidden = !controls.helperVisible;
    };
    const refreshRelationships = () => {
      const initiativeId = assignment.value;
      workstreamAssignment.replaceChildren(
        option(initiativeId === 'unassigned' ? 'none' : 'keep', initiativeId === 'unassigned' ? 'No Workstream' : 'Keep compatible Workstream'),
        ...(initiativeId === 'unassigned' ? [] : [option('none', 'No Workstream')]),
        ...(state.workflow?.workstreams || []).filter(item => item.initiativeId === initiativeId).map(item => option(item.id, workstreamOptionLabel(item)))
      );
      jiraEpicAssignment.replaceChildren(
        option(initiativeId === 'unassigned' ? 'none' : 'keep', initiativeId === 'unassigned' ? 'No Jira Epic' : 'Keep compatible Jira Epic'),
        ...(initiativeId === 'unassigned' ? [] : [option('none', 'No Jira Epic')]),
        ...(state.workflow?.jiraEpicMappings || []).filter(item => item.initiativeId === initiativeId).map(item => option(item.id, jiraEpicOptionLabel(item)))
      );
      refresh();
    };
    assignment.addEventListener('change', refreshRelationships);
    refreshRelationships();
    const element = node('fieldset', { id: 'triage-structure-assignment', className: 'control-group bulk-assignment-group', attrs: { 'aria-describedby': 'bulk-assignment-help', tabindex: '-1' } }, [
      node('legend', { text: 'Assign structure' }),
      selectedCount,
      helper,
      node('div', { className: 'control-grid' }, [
        node('label', {}, [node('span', { text: 'Initiative' }), assignment]),
        node('label', {}, [node('span', { text: 'Workstream' }), workstreamAssignment]),
        node('label', {}, [node('span', { text: 'Jira Epic' }), jiraEpicAssignment])
      ]),
      previewButton
    ]);
    return { element, refresh };
  }

  function triagePagination(collection) {
    const pagination = collection.pagination;
    return node('nav', { className: 'triage-pagination', attrs: { 'aria-label': 'Work Item pages' } }, [
      node('button', { className: 'button secondary', type: 'button', text: 'Previous page', disabled: !pagination.hasPreviousPage, attrs: { 'aria-label': 'Previous Work Item page' }, on: { click: () => changeTriageQuery({ page: pagination.page - 1 }, 'Previous page loaded.') } }),
      node('span', { text: `Page ${pagination.page} of ${pagination.totalPages}` }),
      node('button', { className: 'button secondary', type: 'button', text: 'Next page', disabled: !pagination.hasNextPage, attrs: { 'aria-label': 'Next Work Item page' }, on: { click: () => changeTriageQuery({ page: pagination.page + 1 }, 'Next page loaded.') } })
    ]);
  }

  function triageRows(collection, refreshBulkAvailability) {
    if (collection.summary.totalWorkItems === 0) {
      return node('section', { className: 'empty empty-state', attrs: { 'aria-labelledby': 'no-work-items-title' } }, [
        node('h2', { id: 'no-work-items-title', text: 'No Work Items have been added to this Workspace yet.' }),
        node('p', { text: 'Add and review source material to begin building the delivery view.' }),
        node('div', { className: 'empty-actions' }, [node('button', { className: 'button primary', type: 'button', text: 'Add Source', on: { click: () => activateView('add-source') } })])
      ]);
    }
    if (collection.filteredTotal === 0) {
      return node('section', { className: 'empty empty-state', attrs: { 'aria-labelledby': 'filtered-work-items-title' } }, [
        node('h2', { id: 'filtered-work-items-title', text: 'No Work Items match the current search and filters.' }),
        node('p', { text: 'The Triage Summary still describes the entire Workspace.' }),
        node('div', { className: 'empty-actions' }, [node('button', { className: 'button secondary', type: 'button', text: 'Clear filters', on: { click: clearWorkItemFilters } })])
      ]);
    }
    return node('section', { className: 'panel triage-results', attrs: { 'aria-labelledby': 'triage-results-title' } }, [
      node('div', { className: 'row-head' }, [node('h2', { id: 'triage-results-title', text: 'Review queue' }), node('span', { className: 'meta', text: `${collection.items.length} shown of ${collection.filteredTotal} matching` })]),
      recordList(collection.items, item => {
        const checkbox = node('input', {
          type: 'checkbox', checked: state.selectedWorkItemIds.has(item.id),
          attrs: { 'aria-label': `Select Work Item ${item.externalKey || item.summary} for structure assignment` },
          on: { change: event => {
            if (event.target.checked) state.selectedWorkItemIds.add(item.id);
            else state.selectedWorkItemIds.delete(item.id);
            refreshBulkAvailability();
          } }
        });
        const signalLabels = triageModule.activeSignalLabels(item.triageSignals);
        const open = node('button', {
          className: 'button secondary', type: 'button', text: 'Open detail',
          attrs: { 'data-open-work-item': item.id, 'aria-label': `Open detail for ${item.externalKey || item.summary}` },
          on: { click: () => openTriageDetail(item.id) }
        });
        return [
          node('div', { className: 'row-head' }, [
            node('span', { className: 'triage-row-title' }, [checkbox, node('span', {}, [node('strong', { text: item.externalKey || 'No external key' }), node('span', { text: ` — ${item.summary}` })])]),
            open
          ]),
          node('p', { className: 'meta', text: `${item.itemType} · Canonical status: ${item.canonicalStatus} · Initiative: ${item.initiative?.name || 'Unassigned'} · Workstream: ${item.workstream?.name || 'No Workstream'} · Jira Epic: ${item.jiraEpic ? `${item.jiraEpic.jiraEpicKey} — ${item.jiraEpic.jiraEpicName}` : 'No Jira Epic'}` }),
          node('div', { className: 'triage-signal-list', attrs: { 'aria-label': `Triage signals for ${item.externalKey || item.summary}` } }, signalLabels.map(label => badge(label, label === 'Source trace available' ? 'muted-badge' : 'risk-badge'))),
          node('p', { className: 'meta', text: `${item.sourceMatchCount} exact Source match${item.sourceMatchCount === 1 ? '' : 'es'} · ${item.triageSignalCount} derived signal${item.triageSignalCount === 1 ? '' : 's'}` })
        ];
      }, 'No Work Items are available.'),
      triagePagination(collection)
    ]);
  }

  function metadataList(entries) {
    return node('dl', { className: 'metadata-list' }, entries.flatMap(([label, value]) => [
      node('dt', { text: label }),
      node('dd', { text: value === null || value === '' ? 'Not captured' : value })
    ]));
  }

  function renderTriageSourceDetail(detail) {
    const row = detail.match.row;
    return node('section', { id: 'triage-source-detail', className: 'triage-source-detail', attrs: { tabindex: '-1', 'aria-labelledby': 'triage-source-detail-title' } }, [
      node('div', { className: 'row-head' }, [
        node('h4', { id: 'triage-source-detail-title', text: `Source match: ${detail.source.title}` }),
        node('button', { className: 'button secondary', type: 'button', text: 'Hide Source match', attrs: { 'aria-label': 'Hide explicit Source match detail' }, on: { click: () => {
          state.triage.sourceDetail = null;
          renderWorkItems();
        } } })
      ]),
      node('p', { className: 'warning', text: detail.match.trustLabel }),
      metadataList([
        ['Source ID', detail.source.id],
        ['Source date', detail.source.date],
        ['Imported / captured', detail.source.createdAt],
        ['How this Source was added', detail.source.provenance],
        ['Exact external key', row.externalKey],
        ['Type suggestion', row.itemTypeSuggestion || row.externalItemTypeSuggestion],
        ['Summary suggestion', row.summarySuggestion],
        ['Description suggestion', row.descriptionSuggestion],
        ['Jira Epic suggestion', row.jiraEpicKeySuggestion],
        ['Initiative wording', row.initiativeNameSuggestion],
        ['Status suggestion', row.canonicalStatusSuggestion],
        ['Category', row.category]
      ]),
      row.evidenceExcerptSuggestion ? node('blockquote', { text: row.evidenceExcerptSuggestion }) : null,
      node('p', { className: 'meta', text: 'Viewing this normalized row did not create a Finding, Evidence, Proposed Change, or canonical-state update.' })
    ]);
  }

  async function saveTriageItemType(itemType) {
    const detail = state.triage.detail;
    if (!detail) return;
    const token = workspaceOperationToken();
    setStatus('Saving the explicit canonical type…');
    try {
      const result = await triageApi.updateItemType(token.organizationId, token.workspaceId, detail.workItem.id, {
        expectedRevision: state.triage.revision,
        actor: 'local-target-ui',
        itemType
      });
      if (!workspaceOperationCurrent(token)) return;
      if (state.workflow) state.workflow.revision = result.revision;
      await loadTriageCollection();
      if (!workspaceOperationCurrent(token)) return;
      const remainsVisible = state.triage.collection.items.some(item => item.id === detail.workItem.id);
      if (!remainsVisible) {
        state.triage.detail = null;
        state.triage.sourceDetail = null;
        renderWorkItems();
        setStatus('Type updated. This Work Item no longer matches the active filter or current page.', 'success');
        return;
      }
      const refreshed = await triageApi.detail(token.organizationId, token.workspaceId, detail.workItem.id);
      if (!workspaceOperationCurrent(token)) return;
      state.triage.detail = refreshed.body;
      state.triage.sourceDetail = null;
      state.triage.revision = refreshed.revision;
      renderWorkItems();
      document.getElementById('triage-detail-panel')?.focus();
      setStatus('Canonical Work Item type updated. Status, structure, Sources, and evidence records were preserved.', 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      setStatus(['REVISION_CONFLICT', 'PREVIEW_CONFLICT'].includes(error.code)
        ? 'The Work Item changed. Refresh the detail before saving the type again.'
        : error.message, 'error');
    }
  }

  function reviewTriageStructure(workItemId) {
    state.selectedWorkItemIds = new Set([workItemId]);
    renderWorkItems();
    document.getElementById('triage-structure-assignment')?.focus();
    setStatus('Work Item selected. Review the existing write-free structure preview before applying anything.', 'success');
  }

  function triageDetailPanel(detail) {
    const item = detail.workItem;
    const type = node('select', { attrs: { 'aria-label': `Canonical Work Item type for ${item.externalKey || item.summary}` } },
      triageModule.TRIAGE_ITEM_TYPES.map(value => option(value, value, value === item.itemType)));
    const save = node('button', { className: 'button primary', type: 'button', text: 'Save canonical type', disabled: true, attrs: { 'aria-label': `Save canonical type for ${item.externalKey || item.summary}` } });
    const typeState = node('p', { className: 'meta', text: 'No type change selected.' });
    type.addEventListener('change', () => {
      save.disabled = type.value === item.itemType;
      typeState.textContent = save.disabled ? 'No type change selected.' : `Selected ${type.value}. This is not saved yet.`;
    });
    save.addEventListener('click', () => saveTriageItemType(type.value));
    const sourceItems = detail.sourceMatches.length
      ? node('ul', { className: 'list' }, detail.sourceMatches.map(match => node('li', { className: 'list-item' }, [
          node('strong', { text: match.source.title }),
          node('p', { className: 'meta', text: `${match.source.date} · exact key ${match.matchedExternalKey} · Source ID ${match.source.id}` }),
          match.statusSuggestion === null
            ? node('p', { className: 'meta', text: 'No status suggestion in this exact row.' })
            : node('p', { className: 'warning', text: `${match.trustLabel}: ${match.statusSuggestion}` }),
          node('button', { className: 'button secondary', type: 'button', text: 'View Source match', attrs: { 'aria-label': `View exact Source match from ${match.source.title}` }, on: { click: () => viewTriageSourceMatch(item.id, match) } })
        ])))
      : node('p', { className: 'meta', text: 'No exact-key Source trace is available. Priorena did not use title or fuzzy matching.' });
    const auditItems = detail.auditEvents.length
      ? node('ul', { className: 'list' }, detail.auditEvents.map(event => node('li', { className: 'list-item' }, [
          node('strong', { text: event.action }),
          node('p', { className: 'meta', text: `${event.timestamp} · ${event.actor} · ${event.entityType} ${event.entityId}` }),
          node('p', { className: 'meta', text: `Before hash: ${event.beforeHash || 'None'} · After hash: ${event.afterHash || 'None'}` })
        ])))
      : node('p', { className: 'meta', text: 'No item-scoped Audit Events are available.' });
    const panel = node('aside', {
      id: 'triage-detail-panel',
      className: 'panel triage-detail',
      attrs: { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'triage-detail-title', tabindex: '-1' }
    }, [
      node('div', { className: 'row-head' }, [
        node('h2', { id: 'triage-detail-title', text: item.externalKey || 'Work Item detail' }),
        node('button', { className: 'button secondary', type: 'button', text: 'Close detail', attrs: { 'aria-label': `Close detail for ${item.externalKey || item.summary}` }, on: { click: closeTriageDetail } })
      ]),
      node('h3', { text: item.summary }),
      metadataList([
        ['Canonical type', item.itemType],
        ['Canonical status', item.canonicalStatus],
        ['Initiative', item.initiative?.name || 'Unassigned'],
        ['Workstream', item.workstream?.name || 'No Workstream'],
        ['Jira Epic', item.jiraEpic ? `${item.jiraEpic.jiraEpicKey} — ${item.jiraEpic.jiraEpicName} (${item.jiraEpic.mappingStatus})` : 'No Jira Epic'],
        ['Assignee', item.assignee],
        ['Sprint', item.sprint],
        ['Created', item.createdAt],
        ['Updated', item.updatedAt]
      ]),
      item.description ? node('section', {}, [node('h3', { text: 'Description' }), node('p', { className: 'long-text', text: item.description })]) : null,
      node('section', { className: 'triage-trust-note' }, [
        node('h3', { text: 'Canonical status and confidence' }),
        node('p', { text: `Canonical current status: ${item.canonicalStatus}. Confidence metadata: ${item.currentStateConfidence}.` }),
        node('p', { className: 'meta', text: item.canonicalStatus === 'Unknown'
          ? 'Current status remains unknown. Confidence metadata does not make an unknown status known.'
          : `Current-state provenance: ${item.currentStateProvenance}` })
      ]),
      node('section', {}, [
        node('h3', { text: 'Derived triage signals' }),
        node('ul', {}, triageModule.activeSignalLabels(detail.triageSignals).map(label => node('li', { text: label })))
      ]),
      node('section', { className: 'triage-type-review' }, [
        node('h3', { text: 'Review canonical type' }),
        node('p', { className: 'meta', text: 'Priorena does not infer a type. Choosing a value makes no change until Save canonical type is pressed.' }),
        node('label', { className: 'field' }, [node('span', { text: 'Canonical Work Item type' }), type]),
        typeState,
        save
      ]),
      node('section', {}, [
        node('h3', { text: 'Structure assignment' }),
        node('p', { className: 'meta', text: 'Use the existing write-free preview and explicit Apply workflow. Workstream and Jira Epic remain optional.' }),
        node('button', { className: 'button secondary', type: 'button', text: 'Review structure', attrs: { 'aria-label': `Review structure assignment for ${item.externalKey || item.summary}` }, on: { click: () => reviewTriageStructure(item.id) } })
      ]),
      node('section', {}, [node('h3', { text: `Exact Source trace (${detail.sourceMatches.length})` }), sourceItems]),
      state.triage.sourceDetail ? renderTriageSourceDetail(state.triage.sourceDetail) : null,
      node('section', { className: 'triage-trust-note' }, [
        node('h3', { text: 'Evidence boundary' }),
        node('p', { text: 'Canonical status remains authoritative. Source suggestions are untrusted and require accepted Evidence before a current-state change.' }),
        node('p', { className: 'meta', text: 'The Evidence review workflow for these status suggestions is not available in this triage release.' })
      ]),
      node('section', {}, [node('h3', { text: 'Work Item Audit Events' }), auditItems])
    ]);
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeTriageDetail();
      }
    });
    return panel;
  }

  function renderWorkItems() {
    const collection = state.triage.collection;
    if (!collection) {
      elements.view.replaceChildren(empty('Bounded triage results are not loaded yet.'));
      return;
    }
    const structure = triageStructureAssignment();
    const results = triageRows(collection, structure.refresh);
    const workspace = node('div', { className: `triage-workspace${state.triage.detail ? ' detail-open' : ''}` }, [
      node('div', { className: 'triage-list-column' }, [results]),
      state.triage.detail ? triageDetailPanel(state.triage.detail) : null
    ]);
    elements.view.replaceChildren(triageSummaryPanel(collection), triageToolbar(collection), triageFiltersPanel(collection), structure.element, workspace);
    structure.refresh();
  }

  function initiativeFilterControl(renderFilteredView) {
    const select = node('select', {
      attrs: { 'aria-label': 'Filter by Initiative' },
      on: { change: event => {
        state.initiativeFilter = event.target.value;
        updateBreadcrumb();
        renderFilteredView();
      } }
    }, [
      option('all', 'All initiatives', state.initiativeFilter === 'all'),
      option('unassigned', 'Unassigned', state.initiativeFilter === 'unassigned'),
      ...workflowModule.initiativeChoices(state.workflow?.initiatives || [], 'work-item-filter').map(item => option(item.id, item.name, state.initiativeFilter === item.id))
    ]);
    return node('label', {}, [node('span', { text: 'Initiative' }), select]);
  }

  function renderFollowUp() {
    const items = (state.workflow?.workItems || []).filter(item => ['open', 'waiting'].includes(item.followUp.state));
    elements.view.replaceChildren(
      node('div', { className: 'actions' }, [initiativeFilterControl(renderFollowUp), node('button', { className: 'button secondary', type: 'button', text: 'Add follow-up', disabled: true, attrs: { title: 'Open a Work Item to add Follow-Up details.' } })]),
      recordList(items.filter(item => state.initiativeFilter === 'all' || (state.initiativeFilter === 'unassigned' ? item.initiativeId === null : item.initiativeId === state.initiativeFilter)), item => [
        node('div', { className: 'row-head' }, [node('strong', { text: item.summary }), badge(item.initiative?.name || 'Unassigned')]),
        node('p', { text: item.followUp.nextAction || 'Follow-Up needs a next action.' }),
        node('p', { className: 'meta', text: `${item.followUp.state} · ${workflowModule.commentCaptureLabel(item.followUp.lastCapturedCommentAt)}` })
      ], 'No open Follow-Ups match this Initiative filter.')
    );
  }

  function renderMilestones() {
    elements.view.replaceChildren(recordList(state.workflow?.milestones || [], milestone => [
      node('div', { className: 'row-head' }, [node('strong', { text: milestone.title }), badge(milestone.status)]),
      node('p', { text: `Applies to: ${milestone.applicability.label}` }),
      node('p', { className: milestone.timing.pressure === 'overdue' ? 'risk' : (milestone.timing.pressure === 'due-soon' ? 'warning' : 'meta'), text: `${milestone.date} · ${milestone.timing.pressure} · ${milestone.linkedWorkItemIds.length} linked Work Items` })
    ], 'No Milestones exist in this Workspace.'));
  }

  function sourceForm() {
    const form = node('form', { className: 'panel', attrs: { novalidate: 'novalidate' } });
    const title = node('input', { name: 'title', attrs: { maxlength: '500', required: 'required' } });
    const date = node('input', { name: 'date', type: 'date', value: new Date().toISOString().slice(0, 10), attrs: { required: 'required' } });
    const provenance = node('input', { name: 'provenance', value: 'Added directly in Priorena', attrs: { maxlength: '4000', required: 'required' } });
    const content = node('textarea', { name: 'content', attrs: { maxlength: '524288', required: 'required' } });
    form.append(
      node('h2', { text: 'Capture a Workspace-owned Source' }),
      node('p', { className: 'notice', text: 'Source content is untrusted. Capture does not change Work Item current state; extracted Findings require separate review.' }),
      node('div', { className: 'field-group' }, [
        node('label', { className: 'field' }, [node('span', { text: 'Source title' }), title]),
        node('label', { className: 'field' }, [node('span', { text: 'Source date' }), date]),
        node('label', { className: 'field' }, [node('span', { text: 'How this Source was added' }), provenance])
      ]),
      node('label', { className: 'field' }, [node('span', { text: 'Source content' }), content]),
      node('button', { className: 'button primary', type: 'submit', text: 'Add Source' })
    );
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!title.value.trim() || !content.value.trim()) {
        setStatus('Source title and content are required.', 'error');
        return;
      }
      const token = workspaceOperationToken();
      const revision = state.workflow.revision;
      try {
        await requestJson(`/api/v2/organizations/${encoded(token.organizationId)}/workspaces/${encoded(token.workspaceId)}/sources`, mutationOptions({
          expectedRevision: revision,
          actor: 'local-target-ui',
          source: {
            title: title.value,
            type: 'generic',
            sourceKind: 'structured-note',
            date: date.value,
            provenance: provenance.value,
            content: content.value
          },
          findings: []
        }));
        if (!workspaceOperationCurrent(token)) return;
        state.workflow = null;
        invalidateTriageData();
        await loadWorkflow();
        if (!workspaceOperationCurrent(token) || !form.isConnected) return;
        form.reset();
        setStatus('Source added. Review any Findings separately before using them as Evidence.', 'success');
      } catch (error) {
        if (!workspaceOperationCurrent(token)) return;
        setStatus(error.message, 'error');
      }
    });
    return form;
  }

  function importInputValue() {
    const feed = state.importFeed;
    const source = importFeedModule.sourceDescriptor(feed.format, {
      title: feed.sourceTitle,
      date: feed.sourceDate,
      provenance: feed.provenance
    });
    if (!feed.content.trim()) throw new Error('Choose a non-empty .json or .csv file, or paste non-empty feed text.');
    if (importFeedModule.utf8ByteLength(feed.content) > importFeedModule.MAX_IMPORT_BYTES) throw new Error('Feed content must be 512 KiB or smaller.');
    if (!source.title) throw new Error('Source title is required.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source.date)) throw new Error('Choose a valid Source date.');
    if (!source.provenance) throw new Error('Explain how this feed was prepared.');
    return { format: feed.format, content: feed.content, source };
  }

  function invalidateImportValidation() {
    state.importFeed.validationPreview = null;
    state.importFeed.rowDrafts = new Map();
    state.importFeed.includeSource = false;
    state.importFeed.finalPreview = null;
    state.importFeed.acknowledgedPreviewHash = null;
    state.importFeed.outcome = null;
    state.importFeed.applying = false;
    elements.view.querySelectorAll('.import-review-panel, .import-final-panel').forEach(element => element.remove());
  }

  function invalidateImportFinalPreview() {
    state.importFeed.finalPreview = null;
    state.importFeed.acknowledgedPreviewHash = null;
    state.importFeed.applying = false;
    elements.view.querySelector('.import-final-panel')?.remove();
  }

  function downloadLocalText(filename, text, mediaType) {
    const url = URL.createObjectURL(new Blob([text], { type: mediaType }));
    const link = node('a', { attrs: { href: url, download: filename } });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function importPromptPanel() {
    const prompt = importFeedModule.buildExtractionPrompt();
    const copy = node('button', { className: 'button secondary', type: 'button', text: 'Copy extraction prompt' });
    copy.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable. Download the prompt instead.');
        await navigator.clipboard.writeText(prompt);
        setStatus('Extraction prompt copied locally. Priorena sent nothing to ChatGPT.', 'success');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
    return node('section', { className: 'panel import-prompt-panel' }, [
      node('p', { className: 'eyebrow', text: 'Optional preparation' }),
      node('h2', { text: 'Prepare a feed with ChatGPT' }),
      node('p', { text: 'Use the generated instructions in a separate ChatGPT conversation where you upload screenshots. Screenshots remain there; Priorena receives only the feed file you later choose.' }),
      node('p', { className: 'notice', text: 'The prompt and template are generated on this computer. Priorena does not send the prompt, screenshots, or Workspace data to ChatGPT.' }),
      node('div', { className: 'actions' }, [
        copy,
        node('button', { className: 'button secondary', type: 'button', text: 'Download extraction prompt', on: { click: () => {
          downloadLocalText('priorena-target-v4-extraction-prompt.md', prompt, 'text/markdown;charset=utf-8');
          setStatus('Extraction prompt downloaded locally.', 'success');
        } } }),
        node('button', { className: 'button secondary', type: 'button', text: 'Download target-v4 JSON template', on: { click: () => {
          downloadLocalText('priorena-target-v4-template.json', importFeedModule.TARGET_V4_TEMPLATE, 'application/json;charset=utf-8');
          setStatus('Empty target-v4 JSON template downloaded locally.', 'success');
        } } })
      ]),
      node('details', {}, [
        node('summary', { text: 'Safe JSON example' }),
        node('pre', { className: 'output-preview', text: '{\n  "version": "target-v4",\n  "records": [\n    {\n      "externalKey": "DEMO-123",\n      "itemType": "Task",\n      "summary": "Fictional visible task",\n      "evidenceExcerpt": "Fictional readable excerpt.",\n      "category": "note"\n    }\n  ]\n}' })
      ])
    ]);
  }

  function importPreparePanel() {
    const feed = state.importFeed;
    const limits = feed.capabilities?.limits || { maxBytes: 524288, maxRecords: 100, maxCellCharacters: 4000 };
    const uploadButton = node('button', {
      className: `button ${feed.inputMethod === 'upload' ? 'primary' : 'secondary'}`,
      type: 'button',
      text: 'Upload file',
      attrs: { 'aria-pressed': String(feed.inputMethod === 'upload') },
      on: { click: () => {
        feed.inputMethod = 'upload';
        invalidateImportValidation();
        renderImportFeed().catch(error => setStatus(error.message, 'error'));
      } }
    });
    const pasteButton = node('button', {
      className: `button ${feed.inputMethod === 'paste' ? 'primary' : 'secondary'}`,
      type: 'button',
      text: 'Paste feed',
      attrs: { 'aria-pressed': String(feed.inputMethod === 'paste') },
      on: { click: () => {
        feed.inputMethod = 'paste';
        feed.filename = null;
        invalidateImportValidation();
        renderImportFeed().catch(error => setStatus(error.message, 'error'));
      } }
    });
    const contentControl = feed.inputMethod === 'upload'
      ? importFileControl()
      : importPasteControl();
    const title = node('input', { value: feed.sourceTitle, attrs: { maxlength: '500', required: 'required' } });
    const date = node('input', { value: feed.sourceDate, type: 'date', attrs: { required: 'required' } });
    const provenance = node('input', { value: feed.provenance, attrs: { maxlength: '4000', required: 'required' } });
    [[title, 'sourceTitle'], [date, 'sourceDate'], [provenance, 'provenance']].forEach(([control, key]) => {
      control.addEventListener('input', () => {
        feed[key] = control.value;
        invalidateImportValidation();
      });
    });
    return node('section', { className: 'panel import-prepare-panel' }, [
      node('p', { className: 'eyebrow', text: 'Stage 1 · Prepare' }),
      node('h2', { text: 'Choose a local feed' }),
      node('div', { className: 'actions', attrs: { role: 'group', 'aria-label': 'Feed input method' } }, [uploadButton, pasteButton]),
      node('p', { className: 'notice', text: `Accepted input: strict target-v4 JSON, allowlisted CSV, or Structured text paste. Limits: ${limits.maxBytes.toLocaleString('en-US')} bytes, ${limits.maxRecords} records, and ${limits.maxCellCharacters.toLocaleString('en-US')} characters per bounded cell.` }),
      contentControl,
      node('div', { className: 'field-group' }, [
        node('label', { className: 'field' }, [node('span', { text: 'Source title' }), title]),
        node('label', { className: 'field' }, [node('span', { text: 'Source date' }), date]),
        node('label', { className: 'field' }, [node('span', { text: 'How this feed was prepared' }), provenance])
      ]),
      node('p', { className: 'meta', text: `${importFeedModule.utf8ByteLength(feed.content)} of 524,288 bytes selected. The original normalized feed text will be retained in the local Source only after explicit apply.` }),
      node('div', { className: 'actions' }, [
        node('button', { className: 'button primary', type: 'button', text: 'Validate and preview', on: { click: validateImportFeed } }),
        node('button', { className: 'button secondary', type: 'button', text: 'Clear prepared feed', on: { click: () => {
          clearImportFeedData();
          renderImportFeed().catch(error => setStatus(error.message, 'error'));
        } } })
      ])
    ]);
  }

  function importFileControl() {
    const feed = state.importFeed;
    const input = node('input', { type: 'file', attrs: { accept: '.json,.csv,application/json,text/csv,text/plain', 'aria-label': 'Choose JSON or CSV feed' } });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const readToken = ++feed.fileReadToken;
      try {
        const format = importFeedModule.formatForFilename(file.name);
        if (file.size === 0) throw new Error('The selected feed file is empty.');
        if (file.size > importFeedModule.MAX_IMPORT_BYTES) throw new Error('The selected feed file exceeds 512 KiB.');
        const content = await file.text();
        if (readToken !== feed.fileReadToken || feed !== state.importFeed) return;
        if (!content.trim()) throw new Error('The selected feed file contains no reviewable text.');
        if (importFeedModule.utf8ByteLength(content) > importFeedModule.MAX_IMPORT_BYTES) throw new Error('The selected feed file exceeds 512 KiB.');
        feed.filename = file.name;
        feed.format = format;
        feed.content = content;
        if (!feed.sourceTitle) feed.sourceTitle = file.name.replace(/\.(?:json|csv)$/i, '');
        invalidateImportValidation();
        await renderImportFeed();
        setStatus(`${file.name} read locally. Validate to continue.`, 'success');
      } catch (error) {
        if (readToken !== feed.fileReadToken || feed !== state.importFeed) return;
        feed.filename = null;
        feed.content = '';
        invalidateImportValidation();
        await renderImportFeed();
        setStatus(error.message, 'error');
      }
    });
    return node('div', { className: 'import-input-box' }, [
      node('label', { className: 'field' }, [node('span', { text: 'JSON or CSV text file' }), input]),
      node('p', { className: 'meta', text: feed.filename ? `Selected file: ${feed.filename} · ${feed.format}` : 'No file selected. Only .json and .csv text files are accepted.' })
    ]);
  }

  function importPasteControl() {
    const feed = state.importFeed;
    const format = node('select', { attrs: { 'aria-label': 'Pasted feed format' } }, [
      option('target-json', 'JSON', feed.format === 'target-json'),
      option('target-csv', 'CSV', feed.format === 'target-csv'),
      option('structured-text', 'Structured text', feed.format === 'structured-text')
    ]);
    const content = node('textarea', { value: feed.content, attrs: { maxlength: '524288', rows: '12', 'aria-label': 'Paste feed content' } });
    format.addEventListener('change', () => {
      feed.format = format.value;
      invalidateImportValidation();
    });
    content.addEventListener('input', () => {
      feed.content = content.value;
      invalidateImportValidation();
    });
    return node('div', { className: 'import-input-box' }, [
      node('label', { className: 'field' }, [node('span', { text: 'Paste format' }), format]),
      node('label', { className: 'field' }, [node('span', { text: 'Feed text' }), content])
    ]);
  }

  function initializeImportDrafts(preview) {
    state.importFeed.rowDrafts = importFeedModule.createReviewDrafts(preview);
  }

  async function validateImportFeed() {
    const token = workspaceOperationToken();
    try {
      const input = importInputValue();
      setStatus('Validating the feed without changing Priorena data…');
      const result = await workflowApi.previewImport(token.organizationId, token.workspaceId, { input });
      if (!workspaceOperationCurrent(token)) return;
      state.importFeed.validationPreview = result.preview;
      state.importFeed.finalPreview = null;
      state.importFeed.outcome = null;
      state.importFeed.includeSource = false;
      initializeImportDrafts(result.preview);
      await renderImportFeed();
      setStatus(`${result.preview.reviewRows.length} record${result.preview.reviewRows.length === 1 ? '' : 's'} validated. Validation and preview have not changed Priorena data.`, 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      invalidateImportValidation();
      await renderImportFeed();
      setStatus(`Validation failed: ${importFeedModule.importValidationMessage(error)}`, 'error');
    }
  }

  function importReviewCounts(preview) {
    return importFeedModule.reviewReadiness(preview, state.importFeed.rowDrafts);
  }

  function importNameFor(collection, id, emptyLabel) {
    if (!id) return emptyLabel;
    const item = state.importFeed.capabilities?.[collection]?.find(candidate => candidate.id === id);
    if (!item) return 'Unavailable';
    if (collection === 'jiraEpicMappings') return `${item.jiraEpicKey} — ${item.jiraEpicName}`;
    return item.name;
  }

  function reviewRowState(readiness) {
    return ({
      ready: 'Ready',
      'needs-action': 'Needs action',
      blocked: 'Blocked',
      excluded: 'Excluded'
    })[readiness.state];
  }

  function importReviewRow(row, readiness) {
    const draft = state.importFeed.rowDrafts.get(row.recordIndex);
    const capabilities = state.importFeed.capabilities;
    const include = node('input', {
      type: 'checkbox',
      checked: draft.includeRecord,
      disabled: !row.supportedForApply,
      attrs: { 'aria-label': `Include record ${row.recordIndex + 1}`, 'data-import-focus': 'include' }
    });
    const create = node('input', {
      type: 'checkbox',
      checked: draft.createWorkItem,
      disabled: !draft.includeRecord || row.match !== null,
      attrs: { 'aria-label': `Create Work Item for record ${row.recordIndex + 1}`, 'data-import-focus': 'create' }
    });
    const itemType = node('select', { disabled: !draft.includeRecord || !draft.createWorkItem, attrs: { 'aria-label': `Work Item type for record ${row.recordIndex + 1}` } },
      [option('', 'Select a Work Item type', !draft.approvedItemType), ...capabilities.itemTypes.map(value => option(value, value, value === draft.approvedItemType))]);
    itemType.setAttribute('data-import-focus', 'item-type');
    const summary = node('input', { value: draft.approvedSummary, disabled: !draft.includeRecord || !draft.createWorkItem, attrs: { maxlength: '1000', 'aria-label': `Approved summary for record ${row.recordIndex + 1}`, 'data-import-focus': 'summary' } });
    const description = node('textarea', { value: draft.approvedDescription, disabled: !draft.includeRecord || !draft.createWorkItem, attrs: { maxlength: '4000', rows: '3', 'aria-label': `Approved description for record ${row.recordIndex + 1}`, 'data-import-focus': 'description' } });
    const canRelate = draft.includeRecord && (row.match !== null || draft.createWorkItem);
    const initiative = node('select', { disabled: !canRelate, attrs: { 'aria-label': `Initiative for record ${row.recordIndex + 1}` } }, [
      option('', 'No Initiative / Unassigned', !draft.initiativeId),
      ...capabilities.initiatives.map(item => option(item.id, `${item.name} · ${item.id}`, item.id === draft.initiativeId))
    ]);
    const workstreams = capabilities.workstreams.filter(item => item.initiativeId === draft.initiativeId);
    const workstream = node('select', { disabled: !canRelate || !draft.initiativeId, attrs: { 'aria-label': `Workstream for record ${row.recordIndex + 1}` } }, [
      option('', 'No Workstream', !draft.workstreamId),
      ...workstreams.map(item => option(item.id, `${item.name} · ${item.id}`, item.id === draft.workstreamId))
    ]);
    const mappings = capabilities.jiraEpicMappings.filter(item => item.initiativeId === draft.initiativeId);
    const jiraEpic = node('select', { disabled: !canRelate || !draft.initiativeId, attrs: { 'aria-label': `Jira Epic for record ${row.recordIndex + 1}` } }, [
      option('', 'No Jira Epic', !draft.jiraEpicMappingId),
      ...mappings.map(item => option(item.id, `${item.jiraEpicKey} — ${item.jiraEpicName} · ${item.mappingStatus}`, item.id === draft.jiraEpicMappingId))
    ]);
    const finding = node('input', {
      type: 'checkbox',
      checked: draft.includeFinding,
      disabled: !draft.includeRecord || !row.findingAvailable,
      attrs: { 'aria-label': `Include pending Finding for record ${row.recordIndex + 1}` }
    });

    include.addEventListener('change', () => {
      draft.includeRecord = include.checked;
      if (!include.checked) {
        draft.createWorkItem = false;
        draft.includeFinding = false;
      }
      invalidateImportFinalPreview();
      renderImportFeed().catch(error => setStatus(error.message, 'error'));
    });
    create.addEventListener('change', () => {
      draft.createWorkItem = create.checked;
      if (!create.checked && row.match === null) {
        draft.initiativeId = '';
        draft.workstreamId = '';
        draft.jiraEpicMappingId = '';
      }
      invalidateImportFinalPreview();
      renderImportFeed().catch(error => setStatus(error.message, 'error'));
    });
    itemType.addEventListener('change', () => {
      draft.approvedItemType = itemType.value || null;
      invalidateImportFinalPreview();
      renderImportFeed().catch(error => setStatus(error.message, 'error'));
    });
    [[summary, 'approvedSummary'], [description, 'approvedDescription']].forEach(([control, key]) => {
      control.addEventListener('input', () => {
        invalidateImportFinalPreview();
        const previewButton = elements.view.querySelector('[data-import-final-preview]');
        if (previewButton) previewButton.disabled = true;
      });
      control.addEventListener('change', () => {
        draft[key] = control.value;
        renderImportFeed().catch(error => setStatus(error.message, 'error'));
      });
    });
    initiative.addEventListener('change', () => {
      draft.initiativeId = initiative.value;
      if (!capabilities.workstreams.some(item => item.id === draft.workstreamId && item.initiativeId === draft.initiativeId)) draft.workstreamId = '';
      if (!capabilities.jiraEpicMappings.some(item => item.id === draft.jiraEpicMappingId && item.initiativeId === draft.initiativeId)) draft.jiraEpicMappingId = '';
      invalidateImportFinalPreview();
      renderImportFeed().catch(error => setStatus(error.message, 'error'));
    });
    workstream.addEventListener('change', () => { draft.workstreamId = workstream.value; invalidateImportFinalPreview(); });
    jiraEpic.addEventListener('change', () => { draft.jiraEpicMappingId = jiraEpic.value; invalidateImportFinalPreview(); });
    finding.addEventListener('change', () => {
      draft.includeFinding = finding.checked;
      invalidateImportFinalPreview();
      renderImportFeed().catch(error => setStatus(error.message, 'error'));
    });

    const warnings = [];
    if (row.externalKey === null) warnings.push('No external key: this row can never match a local Work Item by title.');
    row.duplicateReasons.forEach(reason => warnings.push(reason === 'duplicate-external-key-in-feed'
      ? 'Duplicate external key in this feed. Include at most one conflicting row.'
      : (reason === 'multiple-feed-rows-for-local-work-item'
          ? 'Another feed row resolves to this exact local Work Item. Include at most one of them.'
          : 'Multiple local exact matches block this row.')));
    if (!row.supportedForApply) warnings.push(row.reviewState === 'unsupported-item-type'
      ? 'Unsupported external hierarchy type. Preserve it only inside an explicitly selected Source.'
      : 'This record is blocked.');
    if (row.sourceInitiativeName) warnings.push(`Feed Initiative wording is source text only: ${row.sourceInitiativeName}`);
    if (row.requestedInitiativeId) warnings.push(`Feed Initiative ID suggestion requires explicit review: ${row.requestedInitiativeId}`);
    if (row.suggestedExactMapping) warnings.push(`Exact local Jira Epic suggestion: ${importNameFor('jiraEpicMappings', row.suggestedExactMapping.jiraEpicMappingId, 'No Jira Epic')}. It is not selected automatically.`);
    if (row.jiraMappingReviewState === 'unresolved') warnings.push(`No exact active local Jira Epic mapping exists for ${row.sourceJiraProjectKey} / ${row.sourceJiraEpicKey}. Choose No Jira Epic or create a mapping in Settings and validate again.`);
    if (row.proposedCurrentStateChange) warnings.push(`Status suggestion ${row.proposedCurrentStateChange.beforeValue} → ${row.proposedCurrentStateChange.proposedValue} will remain deferred for Evidence and Proposed Change review.`);

    const readinessGuidance = readiness.state === 'needs-action' || readiness.state === 'blocked'
      ? node('div', { className: `import-row-readiness ${readiness.state === 'blocked' ? 'risk' : 'warning'}` }, [
        node('strong', { text: `${reviewRowState(readiness)}:` }),
        node('ul', {}, readiness.messages.map(message => node('li', { text: message })))
      ])
      : (readiness.state === 'ready' ? node('p', { className: 'success', text: 'Ready for Final Preview.' }) : null);

    return node('li', { className: 'list-item import-review-row', attrs: { 'data-import-record': row.recordIndex, tabindex: '-1' } }, [
      node('div', { className: 'row-head' }, [
        node('span', {}, [include, ' ', node('strong', { text: `Record ${row.recordIndex + 1} · ${row.externalKey || 'No external key'}` })]),
        badge(reviewRowState(readiness), readiness.state === 'blocked' ? 'risk-badge' : (readiness.state === 'excluded' ? 'muted-badge' : ''))
      ]),
      node('div', { className: 'import-current-grid' }, [
        node('section', {}, [
          node('h3', { text: 'Feed suggestion' }),
          node('p', { text: row.sourceSummary || 'No summary supplied' }),
          node('p', { className: 'meta', text: `${row.sourceItemType ? `Feed suggestion: ${row.sourceItemType}` : 'No Work Item type supplied by feed.'} · Status suggestion: ${row.sourceCanonicalStatus || 'None'} · Jira Epic suggestion: ${row.noEpic === true ? 'Explicitly no Epic' : (row.sourceJiraEpicKey ? `${row.sourceJiraProjectKey} / ${row.sourceJiraEpicKey}` : 'None')}` }),
          row.evidenceExcerpt ? node('blockquote', { text: row.evidenceExcerpt }) : node('p', { className: 'meta', text: 'No pending Finding excerpt supplied.' })
        ]),
        node('section', {}, [
          node('h3', { text: row.match ? 'Current exact local match' : 'New Work Item candidate' }),
          row.match
            ? node('p', { text: `${row.match.summary} · ${row.match.itemType} · ${row.match.canonicalStatus}` })
            : node('p', { text: draft.createWorkItem
              ? (draft.approvedItemType
                  ? `New ${draft.approvedItemType} creation is selected with the reviewed summary below.`
                  : 'New Work Item creation is selected. Choose a canonical Work Item type below.')
              : 'No exact external-identity match. Creation remains unselected.' }),
          node('p', { className: 'meta', text: row.match
            ? `Initiative: ${importNameFor('initiatives', row.match.initiativeId, 'Unassigned')} · Workstream: ${importNameFor('workstreams', row.match.workstreamId, 'No Workstream')} · Jira Epic: ${importNameFor('jiraEpicMappings', row.match.jiraEpicMappingId, 'No Jira Epic')}`
            : 'No title or proximity matching was attempted.' })
        ])
      ]),
      ...warnings.map(text => node('p', { className: 'warning', text })),
      readinessGuidance,
      row.match === null ? node('fieldset', { className: 'control-group' }, [
        node('legend', { text: 'Human creation decision' }),
        node('label', {}, [create, ' Create a new Work Item']),
        node('div', { className: 'field-group' }, [
          node('label', { className: 'field' }, [node('span', { text: 'Canonical Work Item type' }), itemType]),
          node('label', { className: 'field' }, [node('span', { text: 'Approved summary' }), summary])
        ]),
        node('label', { className: 'field' }, [node('span', { text: 'Approved description' }), description])
      ]) : null,
      node('fieldset', { className: 'control-group' }, [
        node('legend', { text: 'Explicit local relationships' }),
        node('div', { className: 'field-group' }, [
          node('label', { className: 'field' }, [node('span', { text: 'Initiative' }), initiative]),
          node('label', { className: 'field' }, [node('span', { text: 'Workstream' }), workstream]),
          node('label', { className: 'field' }, [node('span', { text: 'Jira Epic' }), jiraEpic])
        ])
      ]),
      node('label', {}, [finding, ' Create one pending Finding from the exact excerpt'])
    ]);
  }

  function applyBulkToImportDrafts(action) {
    const preview = state.importFeed.validationPreview;
    preview.reviewRows.forEach(row => action(row, state.importFeed.rowDrafts.get(row.recordIndex)));
    invalidateImportFinalPreview();
    renderImportFeed().catch(error => setStatus(error.message, 'error'));
  }

  function importBulkReview() {
    const capabilities = state.importFeed.capabilities;
    const type = node('select', { attrs: { 'aria-label': 'Bulk creation type' } }, [
      option('', 'Choose a Work Item type', true),
      ...capabilities.itemTypes.map(value => option(value, value))
    ]);
    const initiative = node('select', { attrs: { 'aria-label': 'Bulk Initiative' } }, [
      option('', 'No Initiative / Unassigned', true),
      ...capabilities.initiatives.map(item => option(item.id, `${item.name} · ${item.id}`))
    ]);
    const workstream = node('select', { attrs: { 'aria-label': 'Bulk Workstream' } }, [
      option('', 'No Workstream', true),
      ...capabilities.workstreams.map(item => option(item.id, `${item.name} · ${item.id}`))
    ]);
    const jiraEpic = node('select', { attrs: { 'aria-label': 'Bulk Jira Epic' } }, [
      option('', 'No Jira Epic', true),
      ...capabilities.jiraEpicMappings.map(item => option(item.id, `${item.jiraEpicKey} — ${item.jiraEpicName} · ${item.mappingStatus}`))
    ]);
    const setCreationType = node('button', {
      className: 'button secondary',
      type: 'button',
      text: 'Set selected creation type',
      disabled: true,
      on: { click: () => applyBulkToImportDrafts((row, draft) => {
        if (draft.includeRecord && row.match === null && draft.createWorkItem) draft.approvedItemType = type.value || null;
      }) }
    });
    type.addEventListener('change', () => { setCreationType.disabled = !type.value; });
    return node('fieldset', { className: 'control-group import-bulk-controls' }, [
      node('legend', { text: 'Bounded bulk review' }),
      node('p', { className: 'meta', text: 'Bulk actions affect at most the 100 validated rows and remain reversible before final preview.' }),
      node('div', { className: 'actions' }, [
        node('button', { className: 'button secondary', type: 'button', text: 'Select eligible new Work Items', on: { click: () => applyBulkToImportDrafts((row, draft) => {
          if (!row.supportedForApply || row.match !== null || row.duplicateReasons.length > 0) return;
          draft.includeRecord = true;
          draft.createWorkItem = true;
        }) } }),
        type,
        setCreationType
      ]),
      node('div', { className: 'actions' }, [
        initiative,
        node('button', { className: 'button secondary', type: 'button', text: 'Set selected Initiative', on: { click: () => applyBulkToImportDrafts((row, draft) => {
          if (!draft.includeRecord || (row.match === null && !draft.createWorkItem)) return;
          draft.initiativeId = initiative.value;
          draft.workstreamId = '';
          draft.jiraEpicMappingId = '';
        }) } }),
        workstream,
        node('button', { className: 'button secondary', type: 'button', text: 'Set selected Workstream', on: { click: () => applyBulkToImportDrafts((row, draft) => {
          if (!draft.includeRecord || (row.match === null && !draft.createWorkItem)) return;
          const selected = capabilities.workstreams.find(item => item.id === workstream.value);
          draft.workstreamId = selected?.id || '';
          if (selected) draft.initiativeId = selected.initiativeId;
          if (!capabilities.jiraEpicMappings.some(item => item.id === draft.jiraEpicMappingId && item.initiativeId === draft.initiativeId)) draft.jiraEpicMappingId = '';
        }) } }),
        jiraEpic,
        node('button', { className: 'button secondary', type: 'button', text: 'Set selected Jira Epic', on: { click: () => applyBulkToImportDrafts((row, draft) => {
          if (!draft.includeRecord || (row.match === null && !draft.createWorkItem)) return;
          const selected = capabilities.jiraEpicMappings.find(item => item.id === jiraEpic.value);
          draft.jiraEpicMappingId = selected?.id || '';
          if (selected) draft.initiativeId = selected.initiativeId;
          if (!capabilities.workstreams.some(item => item.id === draft.workstreamId && item.initiativeId === draft.initiativeId)) draft.workstreamId = '';
        }) } })
      ]),
      node('div', { className: 'actions' }, [
        node('button', { className: 'button secondary', type: 'button', text: 'Include selected pending Findings', on: { click: () => applyBulkToImportDrafts((row, draft) => {
          if (draft.includeRecord && row.findingAvailable) draft.includeFinding = true;
        }) } }),
        node('button', { className: 'button secondary', type: 'button', text: 'Exclude selected rows', on: { click: () => applyBulkToImportDrafts((row, draft) => {
          if (!draft.includeRecord) return;
          draft.includeRecord = false;
          draft.createWorkItem = false;
          draft.includeFinding = false;
        }) } }),
        node('button', { className: 'button secondary', type: 'button', text: 'Clear selection', on: { click: () => applyBulkToImportDrafts((row, draft) => {
          draft.includeRecord = false;
          draft.createWorkItem = false;
          draft.includeFinding = false;
        }) } })
      ])
    ]);
  }

  async function goToFirstIncompleteRecord() {
    const readiness = importReviewCounts(state.importFeed.validationPreview);
    const incomplete = readiness.firstIncomplete;
    if (!incomplete) return;
    state.importFeed.rowFilter = 'all';
    await renderImportFeed();
    const row = elements.view.querySelector(`[data-import-record="${incomplete.recordIndex}"]`);
    if (!row) return;
    const control = incomplete.focusTarget && incomplete.focusTarget !== 'row'
      ? row.querySelector(`[data-import-focus="${incomplete.focusTarget}"]`)
      : null;
    const focusTarget = control && !control.disabled ? control : row;
    row.scrollIntoView({ block: 'center' });
    focusTarget.focus({ preventScroll: true });
  }

  function importReviewPanel() {
    const preview = state.importFeed.validationPreview;
    const counts = importReviewCounts(preview);
    const readinessByRecord = new Map(counts.rows.map(readiness => [readiness.recordIndex, readiness]));
    const canPreview = importFeedModule.canRunFinalPreview(counts, state.importFeed.includeSource);
    const rowFilter = node('select', { attrs: { 'aria-label': 'Filter import review rows' } }, [
      option('all', 'All records', state.importFeed.rowFilter === 'all'),
      option('eligible', 'Eligible without duplicate warnings', state.importFeed.rowFilter === 'eligible'),
      option('needs-action', 'Needs action', state.importFeed.rowFilter === 'needs-action'),
      option('blocked', 'Blocked', state.importFeed.rowFilter === 'blocked'),
      option('selected', 'Selected', state.importFeed.rowFilter === 'selected'),
      option('excluded', 'Excluded', state.importFeed.rowFilter === 'excluded')
    ]);
    rowFilter.addEventListener('change', () => {
      state.importFeed.rowFilter = rowFilter.value;
      renderImportFeed().catch(error => setStatus(error.message, 'error'));
    });
    const visibleRows = preview.reviewRows.filter(row => {
      const draft = state.importFeed.rowDrafts.get(row.recordIndex);
      const rowState = readinessByRecord.get(row.recordIndex).state;
      if (state.importFeed.rowFilter === 'all') return true;
      if (state.importFeed.rowFilter === 'eligible') return row.supportedForApply && row.duplicateReasons.length === 0;
      if (state.importFeed.rowFilter === 'needs-action') return rowState === 'needs-action';
      if (state.importFeed.rowFilter === 'blocked') return rowState === 'blocked';
      if (state.importFeed.rowFilter === 'selected') return draft.includeRecord;
      return rowState === 'excluded';
    });
    const includeSource = node('input', { type: 'checkbox', checked: state.importFeed.includeSource, attrs: { 'aria-label': 'Create local Source from reviewed feed' } });
    includeSource.addEventListener('change', () => {
      state.importFeed.includeSource = includeSource.checked;
      invalidateImportFinalPreview();
      renderImportFeed().catch(error => setStatus(error.message, 'error'));
    });
    const readinessSummary = node('aside', { className: 'import-readiness-summary', attrs: { 'aria-label': 'Import review readiness' } }, [
      node('strong', { text: 'Review readiness' }),
      node('p', {
        className: 'import-readiness-counts',
        text: `${counts.valid} valid · ${counts.selected} selected · ${counts.ready} ready · ${counts.needsAction} need action · ${counts.blocked} blocked`,
        attrs: { 'aria-live': 'polite' }
      }),
      counts.firstIncomplete
        ? node('button', { className: 'button secondary', type: 'button', text: 'Go to first incomplete record', on: { click: goToFirstIncompleteRecord } })
        : node('span', { className: 'success', text: 'All selected records are ready.' })
    ]);
    const previewHelp = !state.importFeed.includeSource
      ? 'Select Source creation to make Final Preview available.'
      : (counts.firstIncomplete
          ? 'Complete or exclude every selected record that needs action or is blocked before Final Preview.'
          : 'Final Preview is available. It remains write-free.');
    return node('section', { className: 'panel import-review-panel' }, [
      node('p', { className: 'eyebrow', text: 'Stages 2–3 · Validate and review' }),
      node('h2', { text: 'Review every record and local relationship' }),
      node('p', { className: 'notice', text: 'Validation and preview have not changed Priorena data.' }),
      node('p', { text: `Input: ${state.importFeed.filename || 'Paste'} · ${preview.format} · ${preview.source.contentBytes} bytes · ${preview.reviewRows.length} records · contract target-v4.` }),
      node('p', { className: 'meta', text: `Workspace: ${selectedWorkspace()?.name || preview.workspaceId} · persisted revision ${preview.expectedRevision}` }),
      readinessSummary,
      node('label', { className: 'source-selection' }, [includeSource, ' Create one local Source containing the normalized feed text']),
      importBulkReview(),
      node('div', { className: 'filters' }, [node('label', {}, [node('span', { text: 'Record filter' }), rowFilter])]),
      visibleRows.length
        ? node('ul', { className: 'list import-review-list' }, visibleRows.map(row => importReviewRow(row, readinessByRecord.get(row.recordIndex))))
        : empty('No import records match this review filter.'),
      node('p', { className: 'meta', text: previewHelp, attrs: { id: 'import-final-preview-help' } }),
      node('div', { className: 'actions' }, [
        node('button', { className: 'button primary', type: 'button', text: 'Run final write-free preview', disabled: !canPreview, attrs: { 'aria-describedby': 'import-final-preview-help', 'data-import-final-preview': 'true' }, on: { click: previewReviewedImport } }),
        node('button', { className: 'button secondary', type: 'button', text: 'Start over', on: { click: () => {
          clearImportFeedData();
          renderImportFeed().catch(error => setStatus(error.message, 'error'));
        } } })
      ])
    ]);
  }

  function importReviewDecisions() {
    return state.importFeed.validationPreview.reviewRows.map(row =>
      importFeedModule.decisionForRow(row, state.importFeed.rowDrafts.get(row.recordIndex)));
  }

  function validateFinalImportSelection(decisions) {
    if (!state.importFeed.includeSource) throw new Error('Select Source creation before previewing any import action.');
    const readiness = importReviewCounts(state.importFeed.validationPreview);
    if (!importFeedModule.canRunFinalPreview(readiness, state.importFeed.includeSource)) {
      const first = readiness.firstIncomplete;
      throw new Error(first?.messages[0] || 'Complete every selected record decision before Final Preview.');
    }
    const selectedKeys = new Set();
    const selectedWorkItemIds = new Set();
    state.importFeed.validationPreview.reviewRows.forEach((row, index) => {
      const decision = decisions[index];
      if (!decision.includeRecord) return;
      if (!row.supportedForApply) throw new Error(`Record ${row.recordIndex + 1} is blocked and cannot be included.`);
      if (row.externalKey && selectedKeys.has(row.externalKey)) throw new Error(`External key ${row.externalKey} is selected more than once. Exclude all but one conflicting row.`);
      if (row.externalKey) selectedKeys.add(row.externalKey);
      if (row.match && selectedWorkItemIds.has(row.match.workItemId)) throw new Error(`Record ${row.recordIndex + 1} resolves to a local Work Item already selected by another row.`);
      if (row.match) selectedWorkItemIds.add(row.match.workItemId);
      if (decision.createWorkItem && (!decision.approvedSummary?.trim() || !decision.approvedItemType || decision.approvedDescription === null)) {
        throw new Error(`Record ${row.recordIndex + 1} needs an approved type, summary, and description.`);
      }
      if (row.match === null && !decision.createWorkItem && !decision.includeFinding) {
        throw new Error(`Record ${row.recordIndex + 1} has no selected action. Exclude it or select creation or a pending Finding.`);
      }
    });
  }

  async function previewReviewedImport() {
    const token = workspaceOperationToken();
    try {
      const decisions = importReviewDecisions();
      validateFinalImportSelection(decisions);
      const input = importInputValue();
      setStatus('Rebuilding the exact final preview without writing…');
      const result = await workflowApi.previewImport(token.organizationId, token.workspaceId, {
        input,
        includeSource: state.importFeed.includeSource,
        reviewDecisions: decisions
      });
      if (!workspaceOperationCurrent(token)) return;
      if (result.preview.expectedRevision !== state.importFeed.validationPreview.expectedRevision) {
        invalidateImportValidation();
        await renderImportFeed();
        throw new Error('Priorena data changed after validation. Validate and review the feed again.');
      }
      state.importFeed.finalPreview = result.preview;
      state.importFeed.acknowledgedPreviewHash = null;
      await renderImportFeed();
      setStatus('Final preview is ready. No Priorena data has changed.', 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      state.importFeed.finalPreview = null;
      state.importFeed.acknowledgedPreviewHash = null;
      await renderImportFeed();
      setStatus(importFeedModule.importValidationMessage(error), 'error');
    }
  }

  function importProposalEffect(proposal) {
    if (proposal.type !== 'work-item-assign') return `Dependencies: ${proposal.dependencies.join(', ') || 'none'}`;
    const payload = proposal.payload;
    const target = payload.workItemId || `new Work Item from ${payload.workItemProposalId}`;
    const relationship = change => `${change.effect}: ${change.beforeInitiativeId ?? change.beforeWorkstreamId ?? change.beforeJiraEpicMappingId ?? 'none'} → ${change.afterInitiativeId ?? change.afterWorkstreamId ?? change.afterJiraEpicMappingId ?? 'none'}`;
    return `${target} · Initiative ${relationship(payload.initiativeChange)} · Workstream ${relationship(payload.workstreamChange)} · Jira Epic ${relationship(payload.jiraEpicChange)} · ${payload.evidenceChanges.length} Evidence reassociation${payload.evidenceChanges.length === 1 ? '' : 's'}`;
  }

  function importFinalPreviewPanel() {
    const preview = state.importFeed.finalPreview;
    if (!preview) return null;
    const summary = importFeedModule.summarizeFinalPreview(preview);
    const applyLabel = importFeedModule.formatLiveApplyLabel(summary);
    const acknowledged = state.importFeed.acknowledgedPreviewHash === preview.previewHash;
    const acknowledgement = node('input', {
      id: 'import-live-apply-acknowledgement',
      type: 'checkbox',
      checked: acknowledged,
      disabled: state.importFeed.applying
    });
    const applyHelp = node('p', {
      id: 'import-live-apply-help',
      className: 'meta',
      text: acknowledged
        ? 'Acknowledged. Apply is available while every existing preview safeguard remains satisfied.'
        : 'Check the acknowledgement to enable live Apply.'
    });
    const applyButton = node('button', {
      className: 'button danger',
      type: 'button',
      text: state.importFeed.applying ? 'Applying reviewed import…' : applyLabel,
      disabled: state.importFeed.applying || !acknowledged,
      attrs: { 'aria-describedby': 'import-live-apply-help' },
      on: { click: applyReviewedImport }
    });
    acknowledgement.addEventListener('change', () => {
      state.importFeed.acknowledgedPreviewHash = acknowledgement.checked ? preview.previewHash : null;
      applyButton.disabled = state.importFeed.applying || !acknowledgement.checked;
      applyHelp.textContent = acknowledgement.checked
        ? 'Acknowledged. Apply is available while every existing preview safeguard remains satisfied.'
        : 'Check the acknowledgement to enable live Apply.';
    });
    return node('section', { className: 'panel import-final-panel' }, [
      node('p', { className: 'eyebrow', text: 'Stage 4 · Write-free Final Preview' }),
      node('h2', { text: 'Final Preview' }),
      node('aside', { className: 'import-safe-stop' }, [
        node('strong', { text: 'Dry run complete. Priorena has not been changed.' }),
        node('p', { text: 'Stop here to leave your live Priorena data unchanged.' })
      ]),
      node('p', { className: 'notice', text: 'This exact preview is write-free. Any Apply attempt will rebuild it against the same revision and fail closed if anything differs.' }),
      node('div', { className: 'metric-grid import-metrics' }, [
        metric('Sources', summary.sources), metric('New Work Items', summary.newWorkItems),
        metric('Relationship changes', summary.relationshipChanges), metric('Evidence reassociations', summary.evidenceReassociations),
        metric('Pending Findings', summary.pendingFindings),
        metric('Deferred state changes', summary.deferredCurrentStateChanges), metric('Excluded rows', summary.excludedRows),
        metric('Blocked rows', summary.blockedRows)
      ]),
      node('p', { className: 'meta', text: `Revision ${preview.expectedRevision} · preview hash ${preview.previewHash}` }),
      node('p', { className: 'notice', text: 'Apply creates only the listed local records and relationships. Findings remain pending. Priorena does not update Jira, communicate, or send anything externally.' }),
      summary.evidenceReassociations > 0
        ? node('section', { className: 'import-evidence-effects' }, [
          node('h3', { text: 'Evidence records that will change Initiative association' }),
          node('ul', { className: 'list' }, preview.proposals
            .filter(proposal => proposal.type === 'work-item-assign')
            .flatMap(proposal => proposal.payload.evidenceChanges.map(change => node('li', { className: 'list-item', text: `${change.evidenceId}: ${change.beforeInitiativeId || 'Unassigned'} → ${change.afterInitiativeId || 'Unassigned'}` }))))
        ])
        : node('p', { className: 'meta', text: 'No existing Evidence records will change association.' }),
      node('details', {}, [
        node('summary', { text: 'Advanced proposal details' }),
        node('ul', { className: 'list' }, preview.proposals.map(proposal => node('li', { className: 'list-item' }, [
          node('strong', { text: proposal.type }),
          node('p', { className: 'meta', text: `Record ${proposal.index < 0 ? 'Source' : proposal.index + 1} · ${proposal.id}` }),
          node('p', { className: 'meta', text: importProposalEffect(proposal) })
        ])))
      ]),
      node('section', { className: 'import-live-apply', attrs: { 'aria-labelledby': 'import-live-apply-title' } }, [
        node('h3', { id: 'import-live-apply-title', text: 'Apply to live Priorena' }),
        node('p', { className: 'risk', text: 'This will change your live Priorena data. This is no longer a preview.' }),
        node('label', { className: 'import-apply-acknowledgement', attrs: { for: 'import-live-apply-acknowledgement' } }, [
          acknowledgement,
          node('span', { text: 'I reviewed these changes and understand they will be saved to live Priorena.' })
        ]),
        applyHelp,
        applyButton
      ])
    ]);
  }

  async function applyReviewedImport() {
    const token = workspaceOperationToken();
    const preview = state.importFeed.finalPreview;
    if (!preview || state.importFeed.applying) return;
    if (state.importFeed.acknowledgedPreviewHash !== preview.previewHash) {
      setStatus('Acknowledge the live Priorena write before applying.', 'error');
      return;
    }
    const summary = importFeedModule.summarizeFinalPreview(preview);
    const applyLabel = importFeedModule.formatLiveApplyLabel(summary);
    const approved = await confirmAction('Apply to live Priorena', [
      node('p', { text: `${summary.sources} Source · ${summary.newWorkItems} new Work Items · ${summary.relationshipChanges} existing or new relationship changes` }),
      node('p', { text: `${summary.pendingFindings} pending Findings · ${summary.deferredCurrentStateChanges} deferred current-state changes · ${summary.excludedRows} excluded rows · ${summary.blockedRows} blocked rows` }),
      node('p', { text: `${summary.evidenceReassociations} existing Evidence association${summary.evidenceReassociations === 1 ? '' : 's'} will change.` }),
      ...preview.proposals.filter(proposal => proposal.type === 'work-item-assign').flatMap(proposal =>
        proposal.payload.evidenceChanges.map(change => node('p', { className: 'meta', text: `${change.evidenceId}: ${change.beforeInitiativeId || 'Unassigned'} → ${change.afterInitiativeId || 'Unassigned'}` }))),
      node('p', { className: 'notice', text: 'This is one atomic local write. Findings remain pending. Nothing is written to Jira and nothing is communicated.' })
    ], applyLabel);
    if (!approved || !workspaceOperationCurrent(token)) return;
    state.importFeed.applying = true;
    try {
      await renderImportFeed();
      const input = importInputValue();
      const result = await workflowApi.applyImport(token.organizationId, token.workspaceId, {
        expectedRevision: preview.expectedRevision,
        actor: 'local-target-ui',
        input,
        includeSource: preview.includeSource,
        reviewDecisions: preview.reviewDecisions,
        previewHash: preview.previewHash,
        approvedProposalIds: preview.approvableProposalIds
      });
      if (!workspaceOperationCurrent(token)) return;
      const outcome = {
        summary,
        sources: result.outcome.sources.length,
        workItems: result.outcome.workItems.length,
        assignments: result.outcome.assignments.length,
        findings: result.outcome.findings.length,
        deferred: result.outcome.deferredCurrentStateChanges.length
      };
      clearImportFeedData();
      state.importFeed.outcome = outcome;
      state.workflow = null;
      invalidateTriageData();
      await loadWorkflow();
      if (!workspaceOperationCurrent(token)) return;
      await renderImportFeed();
      setStatus('Reviewed import applied atomically. Pending Findings still require separate review.', 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      state.importFeed.finalPreview = null;
      state.importFeed.acknowledgedPreviewHash = null;
      state.importFeed.applying = false;
      await renderImportFeed();
      setStatus(error.code === 'REVISION_CONFLICT' || error.code === 'PREVIEW_CONFLICT'
        ? 'Priorena data changed. Validate and preview the feed again before applying.'
        : importFeedModule.importValidationMessage(error), 'error');
    }
  }

  function importOutcomePanel() {
    const outcome = state.importFeed.outcome;
    return node('section', { className: 'panel import-outcome-panel' }, [
      node('p', { className: 'eyebrow', text: 'Stage 5 · Outcome' }),
      node('h2', { text: 'Reviewed import applied' }),
      node('div', { className: 'metric-grid import-metrics' }, [
        metric('Sources created', outcome.sources), metric('Work Items created', outcome.workItems),
        metric('Relationships changed', outcome.assignments), metric('Pending Findings created', outcome.findings),
        metric('Current-state changes deferred', outcome.deferred), metric('Rows excluded', outcome.summary.excludedRows),
        metric('Rows blocked', outcome.summary.blockedRows)
      ]),
      node('p', { className: 'notice', text: 'Pending Findings are not Evidence and still require separate review. Current-state suggestions were not applied. Priorena sent nothing and did not write to Jira.' }),
      node('div', { className: 'actions' }, [
        node('button', { className: 'button primary', type: 'button', text: 'Import another feed', on: { click: () => {
          clearImportFeedData();
          renderImportFeed().catch(error => setStatus(error.message, 'error'));
        } } }),
        node('button', { className: 'button secondary', type: 'button', text: 'Open Work Items', on: { click: () => activateView('work-items') } }),
        node('button', { className: 'button secondary', type: 'button', text: 'Open Review', on: { click: () => activateView('review') } }),
        node('button', { className: 'button secondary', type: 'button', text: 'Open Source Library', on: { click: () => activateView('source-library') } })
      ])
    ]);
  }

  async function renderImportFeed() {
    const token = workspaceOperationToken();
    if (!state.importFeed.capabilities || state.importFeed.capabilitiesRevision !== state.workflow?.revision) {
      const result = await workflowApi.importCapabilities(token.organizationId, token.workspaceId);
      if (!workspaceOperationCurrent(token)) return;
      state.importFeed.capabilities = result.capabilities;
      state.importFeed.capabilitiesRevision = result.revision || state.workflow?.revision || null;
    }
    if (state.importFeed.outcome) {
      elements.view.replaceChildren(
        node('p', { className: 'notice', text: 'Priorena reads selected feeds locally and sends them only to the Priorena server running on this computer. It does not upload screenshots, contact ChatGPT, write to Jira, or send messages.' }),
        importOutcomePanel()
      );
      return;
    }
    const content = [
      node('p', { className: 'notice', text: 'Priorena reads the selected feed locally and sends it only to the Priorena server running on this computer. Priorena does not upload screenshots, contact ChatGPT, write to Jira, or send messages.' }),
      importPromptPanel(),
      importPreparePanel()
    ];
    if (state.importFeed.validationPreview) content.push(importReviewPanel());
    if (state.importFeed.finalPreview) content.push(importFinalPreviewPanel());
    elements.view.replaceChildren(...content);
  }

  function sourceMetadata(sourceId) {
    return (state.workflow?.sources || []).find(source => source.id === sourceId) || null;
  }

  function selectedReviewWorkItem(workItemId) {
    return workItemId ? (state.workflow?.workItems || []).find(item => item.id === workItemId) || null : null;
  }

  function associationControls(initialWorkItemId = null, initialInitiativeId = null) {
    const workItem = node('select', {}, [
      option('', 'No Work Item', initialWorkItemId === null),
      ...(state.workflow?.workItems || []).map(item => option(item.id, `${item.summary} · ${item.id}`, item.id === initialWorkItemId))
    ]);
    const initiative = node('select', {}, [
      option('', 'Unassigned / no Initiative', initialInitiativeId === null),
      ...(state.workflow?.initiatives || [])
        .map(item => option(item.id, `${item.name}${item.archived ? ' · archived' : ''} · ${item.id}`, item.id === initialInitiativeId))
    ]);
    const sync = () => {
      const selected = selectedReviewWorkItem(workItem.value);
      if (selected) {
        initiative.value = selected.initiativeId || '';
        initiative.disabled = true;
      } else {
        initiative.disabled = false;
      }
    };
    workItem.addEventListener('change', sync);
    sync();
    return {
      workItem,
      initiative,
      element: node('div', { className: 'field-group' }, [
        node('label', { className: 'field' }, [node('span', { text: 'Work Item association' }), workItem]),
        node('label', { className: 'field' }, [node('span', { text: 'Initiative association' }), initiative])
      ])
    };
  }

  async function openSourceDetail(source) {
    const token = workspaceOperationToken();
    setStatus('Opening the explicitly selected Source…');
    try {
      const result = await evidenceReviewApi.openSource(token.organizationId, token.workspaceId, source.id);
      if (!workspaceOperationCurrent(token)) return;
      state.evidenceReview.sourceDetail = evidenceReviewModule.validateSourceDetail(
        result,
        token.organizationId,
        token.workspaceId,
        source.id,
        state.workflow.revision
      );
      state.evidenceReview.sourceRevision = result.revision;
      state.evidenceReview.excerptSelection = null;
      state.evidenceReview.lastCreatedFindingId = null;
      renderSourceLibrary();
      document.getElementById('source-detail-panel')?.focus();
      setStatus('Source opened for read-only exact-excerpt selection. No Finding or Evidence was created.', 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      state.evidenceReview.sourceDetail = null;
      state.evidenceReview.sourceRevision = null;
      state.evidenceReview.excerptSelection = null;
      if (error.code === 'REVISION_CONFLICT') {
        try {
          state.workflow = null;
          await loadWorkflow();
          if (workspaceOperationCurrent(token)) renderSourceLibrary();
        } catch (refreshError) {
          if (workspaceOperationCurrent(token)) setStatus(refreshError.message, 'error');
          return;
        }
      }
      if (workspaceOperationCurrent(token)) setStatus(error.message, 'error');
    }
  }

  async function submitSourceExcerpt(controls) {
    const token = workspaceOperationToken();
    const source = state.evidenceReview.sourceDetail;
    const selection = state.evidenceReview.excerptSelection;
    if (!source || !selection) {
      setStatus('Select an exact Source excerpt first.', 'error');
      return;
    }
    const workItem = selectedReviewWorkItem(controls.associations.workItem.value);
    const initiativeId = controls.associations.initiative.value || null;
    let association;
    try {
      association = evidenceReviewModule.explicitFindingAssociation(workItem, initiativeId);
      if (!controls.category.value.trim()) throw new Error('Finding category is required.');
    } catch (error) {
      setStatus(error.message, 'error');
      return;
    }
    const approved = await confirmAction('Create pending Finding from exact excerpt', [
      node('blockquote', { className: 'long-text', text: selection.exactExcerpt }),
      node('p', { text: `Category: ${controls.category.value.trim()} · Currentness: ${controls.currentness.value}` }),
      node('p', { text: `Work Item: ${association.workItemId || 'none'} · Initiative: ${association.initiativeId || 'Unassigned'}` }),
      node('p', { className: 'notice', text: 'This creates a pending Finding only. It does not accept Evidence or change Work Item current state.' })
    ], 'Create pending Finding');
    if (!approved || !workspaceOperationCurrent(token)) return;
    try {
      const result = await evidenceReviewApi.createSourceFinding(token.organizationId, token.workspaceId, source.id, {
        expectedRevision: state.evidenceReview.sourceRevision,
        actor: 'local-target-ui',
        finding: {
          ...selection,
          category: controls.category.value.trim(),
          currentness: controls.currentness.value,
          proposedWorkItemId: association.workItemId,
          proposedInitiativeId: association.initiativeId
        }
      });
      if (!workspaceOperationCurrent(token)) return;
      state.workflow = null;
      invalidateTriageData();
      state.evidenceReview.sourceDetail = null;
      state.evidenceReview.sourceRevision = null;
      state.evidenceReview.excerptSelection = null;
      await loadWorkflow();
      if (!workspaceOperationCurrent(token)) return;
      state.evidenceReview.lastCreatedFindingId = result.body.finding.id;
      renderSourceLibrary();
      setStatus('Pending Finding created and Workspace state refreshed. Evidence and current state remain unchanged.', 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      if (['REVISION_CONFLICT', 'PREVIEW_CONFLICT'].includes(error.code)) {
        state.evidenceReview.sourceDetail = null;
        state.evidenceReview.sourceRevision = null;
        state.evidenceReview.excerptSelection = null;
        state.workflow = null;
        await loadWorkflow();
        if (workspaceOperationCurrent(token)) renderSourceLibrary();
      }
      setStatus(error.message, 'error');
    }
  }

  function sourceDetailPanel() {
    const source = state.evidenceReview.sourceDetail;
    if (!source) return null;
    const content = node('textarea', {
      value: source.content,
      attrs: { readonly: 'readonly', rows: '18', 'aria-label': `Read-only Source content for ${source.title}` }
    });
    const category = node('input', { value: 'status', attrs: { maxlength: '100', required: 'required' } });
    const currentness = node('select', {}, evidenceReviewModule.FINDING_CURRENTNESS.map(value => option(value, value, value === 'unknown')));
    const associations = associationControls(null, null);
    const selection = state.evidenceReview.excerptSelection;
    const controls = { category, currentness, associations };
    const panel = node('section', { id: 'source-detail-panel', className: 'panel source-detail-panel', attrs: { tabindex: '-1' } }, [
      node('div', { className: 'row-head' }, [node('h2', { text: source.title }), badge('Untrusted Source claim', 'muted-badge')]),
      node('p', { className: 'meta', text: `${source.type} · ${source.date} · ${source.id}` }),
      node('p', { text: `How this Source was added: ${source.provenance}` }),
      node('p', { className: 'notice', text: 'Source text is untrusted. Select only the exact excerpt that should become a pending Finding.' }),
      node('label', { className: 'field source-content-field' }, [node('span', { text: 'Read-only Source content' }), content]),
      node('div', { className: 'actions' }, [
        node('button', { className: 'button secondary', type: 'button', text: 'Use selected exact excerpt', disabled: source.content.length === 0, on: { click: () => {
          try {
            state.evidenceReview.excerptSelection = evidenceReviewModule.exactExcerptSelection(source.content, content.selectionStart, content.selectionEnd);
            renderSourceLibrary();
            setStatus('Exact excerpt selected. Review the pending Finding details before creating it.', 'success');
          } catch (error) {
            setStatus(error.message, 'error');
          }
        } } }),
        node('button', { className: 'button secondary', type: 'button', text: 'Close Source', on: { click: () => {
          state.evidenceReview.sourceDetail = null;
          state.evidenceReview.sourceRevision = null;
          state.evidenceReview.excerptSelection = null;
          renderSourceLibrary();
        } } })
      ]),
      selection ? node('section', { className: 'excerpt-review' }, [
        node('h3', { text: 'Pending Finding review' }),
        node('blockquote', { className: 'long-text', text: selection.exactExcerpt }),
        node('p', { className: 'meta', text: `UTF-16 offsets ${selection.startOffset}–${selection.endOffset}` }),
        node('div', { className: 'field-group' }, [
          node('label', { className: 'field' }, [node('span', { text: 'Category' }), category]),
          node('label', { className: 'field' }, [node('span', { text: 'Source claim currentness' }), currentness])
        ]),
        associations.element,
        node('p', { className: 'notice', text: 'Creates a pending Finding only. Evidence acceptance and current-state changes are separate reviews.' }),
        node('button', { className: 'button primary', type: 'button', text: 'Review pending Finding creation', on: { click: () => submitSourceExcerpt(controls) } })
      ]) : empty(source.content.length === 0 ? 'This Source has no selectable content.' : 'Select text in the read-only Source content, then use the exact excerpt button.')
    ]);
    return panel;
  }

  function renderSourceLibrary() {
    const outcome = state.evidenceReview.lastCreatedFindingId
      ? node('section', { className: 'panel evidence-outcome-panel' }, [
        node('p', { text: `Pending Finding created: ${state.evidenceReview.lastCreatedFindingId}` }),
        node('button', { className: 'button primary', type: 'button', text: 'Open Review', on: { click: () => activateView('review') } })
      ])
      : null;
    elements.view.replaceChildren(...[
      node('p', { className: 'notice', text: 'Source lists show safe metadata only. Full Source content is returned only after you explicitly open one Source.' }),
      outcome,
      node('div', { className: `source-library-layout${state.evidenceReview.sourceDetail ? ' detail-open' : ''}` }, [
        recordList(state.workflow?.sources || [], source => [
          node('div', { className: 'row-head' }, [node('strong', { text: source.title }), badge(source.processingState)]),
          node('p', { className: 'meta', text: `${source.type} · ${source.date} · ${source.id}` }),
          node('p', { text: `How this Source was added: ${source.provenance}` }),
          node('button', { className: 'button secondary', type: 'button', text: 'Open Source', on: { click: () => openSourceDetail(source) } })
        ], 'No Sources have been added to this Workspace.'),
        sourceDetailPanel()
      ])
    ].filter(Boolean));
  }

  async function loadPendingFindingPage(page = state.evidenceReview.findingPage.page) {
    const token = workspaceOperationToken();
    const result = await evidenceReviewApi.listFindings(token.organizationId, token.workspaceId, page);
    if (!workspaceOperationCurrent(token)) return false;
    if (result.revision !== state.workflow.revision) {
      const error = new Error('Priorena data changed while the Finding review queue was loading');
      error.code = 'REVISION_CONFLICT';
      throw error;
    }
    const body = result.body;
    if (!Array.isArray(body.findings) || body.findings.some(finding => finding.organizationId !== token.organizationId || finding.workspaceId !== token.workspaceId)) {
      throw new Error('Finding review response crossed its validated parent context');
    }
    state.evidenceReview.findingPage = { ...body, revision: result.revision };
    return true;
  }

  async function refreshEvidenceReview(token, message) {
    state.workflow = null;
    invalidateTriageData();
    state.evidenceReview.sourceDetail = null;
    state.evidenceReview.sourceRevision = null;
    state.evidenceReview.excerptSelection = null;
    state.evidenceReview.proposedDraft = null;
    state.evidenceReview.proposedPreview = null;
    await loadWorkflow();
    if (!workspaceOperationCurrent(token)) return;
    let page = state.evidenceReview.findingPage.page;
    await loadPendingFindingPage(page);
    if (page > 1 && state.evidenceReview.findingPage.findings.length === 0) {
      page -= 1;
      await loadPendingFindingPage(page);
    }
    if (!workspaceOperationCurrent(token)) return;
    await renderReview();
    setStatus(message, 'success');
  }

  async function reviewFinding(finding, decision, controls = null) {
    const token = workspaceOperationToken();
    let reviewed = null;
    if (decision === 'accept') {
      try {
        const workItem = selectedReviewWorkItem(controls.associations.workItem.value);
        reviewed = evidenceReviewModule.findingAcceptance(
          controls.currentness.value,
          workItem,
          controls.associations.initiative.value || null
        );
      } catch (error) {
        setStatus(error.message, 'error');
        return;
      }
    }
    const source = sourceMetadata(finding.sourceId);
    const approved = await confirmAction(
      decision === 'accept' ? 'Accept Finding as Evidence' : 'Reject Finding',
      [
        node('p', { text: `${source?.title || 'Selected Source'} · ${source?.date || 'date unavailable'} · ${source?.type || 'type unavailable'}` }),
        node('blockquote', { className: 'long-text', text: finding.exactExcerpt }),
        reviewed ? node('p', { text: `Reviewed currentness: ${reviewed.currentness} · Work Item: ${reviewed.workItemId || 'none'} · Initiative: ${reviewed.initiativeId || 'Unassigned'}` }) : null,
        node('p', { className: 'notice', text: decision === 'accept'
          ? 'Acceptance creates attributable Evidence. It does not modify Work Item current state or create a Proposed Change.'
          : 'Rejection creates no Evidence and does not modify Work Item current state.' })
      ].filter(Boolean),
      decision === 'accept' ? 'Accept as Evidence' : 'Reject Finding'
    );
    if (!approved || !workspaceOperationCurrent(token)) return;
    try {
      await evidenceReviewApi.reviewFinding(token.organizationId, token.workspaceId, finding.id, {
        expectedRevision: state.workflow.revision,
        actor: 'local-target-ui',
        decision,
        ...(reviewed || {})
      });
      if (!workspaceOperationCurrent(token)) return;
      await refreshEvidenceReview(token, `Finding ${decision === 'accept' ? 'accepted as Evidence' : 'rejected'} and Workspace state refreshed.`);
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      if (['REVISION_CONFLICT', 'PREVIEW_CONFLICT'].includes(error.code)) {
        state.evidenceReview.proposedPreview = null;
        state.workflow = null;
        await loadWorkflow();
        if (workspaceOperationCurrent(token)) await renderReview();
      }
      setStatus(error.message, 'error');
    }
  }

  function pendingFindingCard(finding) {
    const source = sourceMetadata(finding.sourceId);
    const associations = associationControls(finding.proposedWorkItemId, finding.proposedInitiativeId);
    const currentness = node('select', {}, evidenceReviewModule.FINDING_CURRENTNESS.map(value => option(value, value, value === finding.currentness)));
    const controls = { associations, currentness };
    return [
      node('div', { className: 'row-head' }, [node('strong', { text: source?.title || 'Source unavailable' }), badge('Pending Finding', 'muted-badge')]),
      node('p', { className: 'meta', text: `${source?.date || 'Date unavailable'} · ${source?.type || 'Type unavailable'} · Source ${finding.sourceId} · Finding ${finding.id}` }),
      node('p', { text: `Source provenance: ${source?.provenance || 'Unavailable'}` }),
      node('blockquote', { className: 'long-text', text: finding.exactExcerpt }),
      node('p', { className: 'meta', text: `Category: ${finding.category} · Source claim currentness: ${finding.currentness} · Proposed Work Item: ${finding.proposedWorkItemId || 'none'} · Proposed Initiative: ${finding.proposedInitiativeId || 'Unassigned'}` }),
      node('label', { className: 'field' }, [node('span', { text: 'Reviewed currentness' }), currentness]),
      associations.element,
      node('p', { className: 'notice', text: 'Acceptance creates Evidence only. A separate Proposed Change review is required before canonical current state can change.' }),
      node('div', { className: 'actions' }, [
        node('button', { className: 'button primary', type: 'button', text: 'Review Evidence acceptance', on: { click: () => reviewFinding(finding, 'accept', controls) } }),
        node('button', { className: 'button secondary', type: 'button', text: 'Reject Finding', on: { click: () => reviewFinding(finding, 'reject') } })
      ])
    ];
  }

  function startProposedChange(evidence) {
    state.evidenceReview.proposedDraft = {
      findingId: evidence.findingId,
      evidenceIds: [evidence.id],
      workItemId: evidence.workItemId || '',
      field: 'canonicalStatus',
      rawValue: ''
    };
    state.evidenceReview.proposedPreview = null;
    renderReview().then(() => document.getElementById('proposed-change-composer')?.focus())
      .catch(error => setStatus(error.message, 'error'));
  }

  function invalidateProposedPreview() {
    state.evidenceReview.proposedPreview = null;
    elements.view.querySelector('.proposed-preview-panel')?.remove();
  }

  function proposedFieldLabel(field) {
    return field.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase());
  }

  async function previewProposedChange() {
    const token = workspaceOperationToken();
    const draft = state.evidenceReview.proposedDraft;
    try {
      const workItem = selectedReviewWorkItem(draft.workItemId);
      const change = evidenceReviewModule.buildProposedChange(
        draft.findingId,
        draft.evidenceIds,
        workItem,
        draft.field,
        draft.rawValue,
        state.workflow.evidence
      );
      const result = await evidenceReviewApi.previewProposedChange(token.organizationId, token.workspaceId, { change });
      if (!workspaceOperationCurrent(token)) return;
      if (result.body.preview.expectedRevision !== state.workflow.revision) throw new Error('Priorena data changed before Proposed Change preview');
      state.evidenceReview.proposedPreview = result.body.preview;
      await renderReview();
      setStatus('Write-free Proposed Change preview ready. No current state changed.', 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      state.evidenceReview.proposedPreview = null;
      setStatus(error.message, 'error');
    }
  }

  async function createProposedChangeFromPreview() {
    const token = workspaceOperationToken();
    const preview = state.evidenceReview.proposedPreview;
    if (!preview) return;
    const approved = await confirmAction('Create pending Proposed Change', [
      node('p', { text: `Work Item ${preview.workItemId} · ${proposedFieldLabel(preview.field)}` }),
      node('p', { text: `Current: ${evidenceReviewModule.valueLabel(preview.beforeValue)}` }),
      node('p', { text: `Proposed: ${evidenceReviewModule.valueLabel(preview.proposedValue)}` }),
      node('p', { className: 'meta', text: `Evidence: ${preview.evidenceIds.join(', ')} · Preview hash: ${preview.previewHash}` }),
      node('p', { className: 'notice', text: 'This creates a pending Proposed Change only. It does not approve or apply the change.' })
    ], 'Create pending Proposed Change');
    if (!approved || !workspaceOperationCurrent(token)) return;
    try {
      const draft = state.evidenceReview.proposedDraft;
      const workItem = selectedReviewWorkItem(draft.workItemId);
      const change = evidenceReviewModule.buildProposedChange(
        draft.findingId,
        draft.evidenceIds,
        workItem,
        draft.field,
        draft.rawValue,
        state.workflow.evidence
      );
      await evidenceReviewApi.createProposedChange(token.organizationId, token.workspaceId, {
        expectedRevision: preview.expectedRevision,
        actor: 'local-target-ui',
        change,
        previewHash: preview.previewHash
      });
      if (!workspaceOperationCurrent(token)) return;
      await refreshEvidenceReview(token, 'Pending Proposed Change created. Approval and application remain separate.');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      state.evidenceReview.proposedPreview = null;
      if (['REVISION_CONFLICT', 'PREVIEW_CONFLICT'].includes(error.code)) {
        state.evidenceReview.proposedDraft = null;
        state.workflow = null;
        await loadWorkflow();
        if (workspaceOperationCurrent(token)) await renderReview();
      }
      setStatus(error.message, 'error');
    }
  }

  function proposedChangeComposer() {
    const draft = state.evidenceReview.proposedDraft;
    if (!draft) return null;
    const workItemSelect = node('select', {}, [
      option('', 'Choose a Work Item', !draft.workItemId),
      ...(state.workflow?.workItems || []).map(item => option(item.id, `${item.summary} · ${item.id}`, item.id === draft.workItemId))
    ]);
    workItemSelect.addEventListener('change', () => {
      draft.workItemId = workItemSelect.value;
      const selected = selectedReviewWorkItem(draft.workItemId);
      draft.evidenceIds = draft.evidenceIds.filter(id => {
        const evidence = state.workflow.evidence.find(item => item.id === id);
        return selected && evidenceReviewModule.evidenceCompatibleWithWorkItem(evidence, selected);
      });
      state.evidenceReview.proposedPreview = null;
      renderReview().catch(error => setStatus(error.message, 'error'));
    });
    const selectedWorkItem = selectedReviewWorkItem(draft.workItemId);
    const evidenceChoices = selectedWorkItem
      ? state.workflow.evidence.filter(item => evidenceReviewModule.evidenceCompatibleWithWorkItem(item, selectedWorkItem))
      : [];
    const field = node('select', {}, evidenceReviewModule.PROPOSED_CHANGE_FIELDS.map(value => option(value, proposedFieldLabel(value), value === draft.field)));
    field.addEventListener('change', () => {
      draft.field = field.value;
      draft.rawValue = field.value === 'currentStateConfidence' ? 'unknown' : '';
      state.evidenceReview.proposedPreview = null;
      renderReview().catch(error => setStatus(error.message, 'error'));
    });
    const maximum = draft.field === 'currentStateProvenance' ? 500 : (['assignee', 'sprint'].includes(draft.field) ? 300 : 200);
    const value = draft.field === 'currentStateConfidence'
      ? node('select', {}, ['confirmed', 'inferred', 'unknown'].map(item => option(item, item, item === draft.rawValue)))
      : node('input', { value: draft.rawValue, attrs: { maxlength: String(maximum), placeholder: draft.field === 'lastCapturedCommentAt' ? '2026-08-26T12:00:00.000Z or empty' : 'Proposed value' } });
    value.addEventListener('input', () => {
      draft.rawValue = value.value;
      invalidateProposedPreview();
    });
    const preview = state.evidenceReview.proposedPreview;
    return node('section', { id: 'proposed-change-composer', className: 'panel proposed-change-composer', attrs: { tabindex: '-1' } }, [
      node('div', { className: 'row-head' }, [node('h2', { text: 'Create Proposed Change' }), badge('Separate current-state review')]),
      node('p', { className: 'notice', text: 'Accepted Evidence remains historical. Preview, create, approve, and apply are distinct actions.' }),
      node('label', { className: 'field' }, [node('span', { text: 'Exact Work Item' }), workItemSelect]),
      node('fieldset', { className: 'choice-group' }, [
        node('legend', { text: 'Compatible accepted Evidence' }),
        evidenceChoices.length ? node('div', { className: 'candidate-list' }, evidenceChoices.map(item => {
          const source = sourceMetadata(item.sourceId);
          const checkbox = node('input', { type: 'checkbox', checked: draft.evidenceIds.includes(item.id) });
          checkbox.addEventListener('change', () => {
            if (checkbox.checked && !draft.evidenceIds.includes(item.id)) draft.evidenceIds.push(item.id);
            if (!checkbox.checked) draft.evidenceIds = draft.evidenceIds.filter(id => id !== item.id);
            invalidateProposedPreview();
          });
          return node('label', { className: 'candidate' }, [checkbox, node('span', {}, [
            node('strong', { text: `${source?.title || 'Source'} · ${item.id}` }),
            node('span', { className: 'long-text', text: item.exactExcerpt }),
            node('small', { text: `Finding ${item.findingId} · ${item.currentness} · accepted ${dateLabel(item.acceptedAt)} by ${item.acceptedBy}` })
          ])]);
        })) : empty('Choose a Work Item to see compatible Evidence.')
      ]),
      node('div', { className: 'field-group' }, [
        node('label', { className: 'field' }, [node('span', { text: 'Current-state field' }), field]),
        node('label', { className: 'field' }, [node('span', { text: 'Typed proposed value' }), value])
      ]),
      node('button', { className: 'button secondary', type: 'button', text: 'Preview without writing', disabled: !selectedWorkItem, on: { click: previewProposedChange } }),
      preview ? node('section', { className: 'proposed-preview-panel' }, [
        node('h3', { text: 'Write-free preview' }),
        node('p', { text: `Current: ${evidenceReviewModule.valueLabel(preview.beforeValue)}` }),
        node('p', { text: `Proposed: ${evidenceReviewModule.valueLabel(preview.proposedValue)}` }),
        node('p', { className: 'meta', text: `Revision ${preview.expectedRevision} · SHA-256 ${preview.previewHash}` }),
        node('p', { className: 'meta', text: `Evidence provenance: ${preview.evidenceIds.join(', ')}` }),
        node('button', { className: 'button primary', type: 'button', text: 'Review pending Proposed Change creation', on: { click: createProposedChangeFromPreview } })
      ]) : null
    ]);
  }

  async function reviewProposedChange(change, decision) {
    const token = workspaceOperationToken();
    const approved = await confirmAction(`${decision === 'approve' ? 'Approve' : 'Reject'} Proposed Change`, [
      node('p', { text: `Work Item ${change.workItemId} · ${proposedFieldLabel(change.field)}` }),
      node('p', { text: `Current snapshot: ${evidenceReviewModule.valueLabel(change.beforeValue)}` }),
      node('p', { text: `Proposed: ${evidenceReviewModule.valueLabel(change.proposedValue)}` }),
      node('p', { className: 'notice', text: decision === 'approve'
        ? 'Approval does not apply the change. Application remains a separate revision-bound action.'
        : 'Rejection leaves Work Item current state and Evidence unchanged.' })
    ], decision === 'approve' ? 'Approve only' : 'Reject Proposed Change');
    if (!approved || !workspaceOperationCurrent(token)) return;
    try {
      await evidenceReviewApi.reviewProposedChange(token.organizationId, token.workspaceId, change.id, {
        expectedRevision: state.workflow.revision,
        actor: 'local-target-ui',
        decision
      });
      if (!workspaceOperationCurrent(token)) return;
      await refreshEvidenceReview(token, `Proposed Change ${decision === 'approve' ? 'approved but not applied' : 'rejected'}.`);
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      state.evidenceReview.proposedPreview = null;
      setStatus(error.message, 'error');
    }
  }

  async function applyProposedChange(change) {
    const token = workspaceOperationToken();
    const approved = await confirmAction('Apply approved Proposed Change', [
      node('p', { text: `Work Item ${change.workItemId} · ${proposedFieldLabel(change.field)}` }),
      node('p', { text: `Exact current snapshot: ${evidenceReviewModule.valueLabel(change.beforeValue)}` }),
      node('p', { text: `Exact applied value: ${evidenceReviewModule.valueLabel(change.proposedValue)}` }),
      node('p', { className: 'meta', text: `Evidence preserved unchanged: ${change.evidenceIds.join(', ')}` }),
      node('p', { className: 'notice', text: 'Apply changes exactly one canonical Work Item field. Evidence content, provenance, acceptance, and currentness remain unchanged.' })
    ], 'Apply exact current-state change');
    if (!approved || !workspaceOperationCurrent(token)) return;
    try {
      await evidenceReviewApi.applyProposedChange(token.organizationId, token.workspaceId, change.id, {
        expectedRevision: state.workflow.revision,
        actor: 'local-target-ui',
        previewHash: change.snapshotHash
      });
      if (!workspaceOperationCurrent(token)) return;
      await refreshEvidenceReview(token, 'Approved Proposed Change applied to exactly one Work Item field; Evidence remained unchanged.');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      state.evidenceReview.proposedPreview = null;
      state.evidenceReview.proposedDraft = null;
      if (error.code === 'PREVIEW_CONFLICT') state.evidenceReview.staleProposedChangeIds.add(change.id);
      if (['REVISION_CONFLICT', 'PREVIEW_CONFLICT'].includes(error.code)) {
        state.workflow = null;
        await loadWorkflow();
        if (workspaceOperationCurrent(token)) await renderReview();
      }
      setStatus(error.code === 'PREVIEW_CONFLICT'
        ? 'The Proposed Change is stale. Review current state and create a fresh write-free preview.'
        : error.message, 'error');
    }
  }

  function proposedChangeCard(change) {
    const workItem = selectedReviewWorkItem(change.workItemId);
    const stale = state.evidenceReview.staleProposedChangeIds.has(change.id);
    return [
      node('div', { className: 'row-head' }, [
        node('strong', { text: `${proposedFieldLabel(change.field)} · ${workItem?.summary || change.workItemId}` }),
        badge(stale ? 'stale' : change.reviewStatus, stale || change.reviewStatus === 'rejected' ? 'risk-badge' : '')
      ]),
      node('p', { text: `Current snapshot: ${evidenceReviewModule.valueLabel(change.beforeValue)}` }),
      node('p', { text: `Proposed value: ${evidenceReviewModule.valueLabel(change.proposedValue)}` }),
      node('p', { className: 'meta', text: `Proposed Change ${change.id} · Finding ${change.findingId} · Evidence ${change.evidenceIds.join(', ')}` }),
      change.reviewStatus === 'pending' ? node('div', { className: 'actions' }, [
        node('button', { className: 'button primary', type: 'button', text: 'Approve only', on: { click: () => reviewProposedChange(change, 'approve') } }),
        node('button', { className: 'button secondary', type: 'button', text: 'Reject', on: { click: () => reviewProposedChange(change, 'reject') } })
      ]) : null,
      change.reviewStatus === 'approved' && !stale
        ? node('button', { className: 'button primary', type: 'button', text: 'Review exact apply', on: { click: () => applyProposedChange(change) } })
        : null,
      ['applied', 'rejected'].includes(change.reviewStatus) || stale
        ? node('p', { className: 'meta', text: stale ? 'This stale record is read-only. Create a fresh preview to propose current state again.' : 'This completed review record is read-only.' })
        : null
    ];
  }

  function acceptedEvidenceCard(evidence) {
    const source = sourceMetadata(evidence.sourceId);
    return [
      node('div', { className: 'row-head' }, [node('strong', { text: source?.title || 'Source unavailable' }), badge('Accepted Evidence')]),
      node('p', { className: 'meta', text: `${source?.date || evidence.sourceDate} · ${source?.type || 'Type unavailable'} · Source ${evidence.sourceId} · Finding ${evidence.findingId} · Evidence ${evidence.id}` }),
      node('blockquote', { className: 'long-text', text: evidence.exactExcerpt }),
      node('p', { text: `Source provenance: ${source?.provenance || 'Unavailable'}` }),
      node('p', { className: 'meta', text: `Accepted ${dateLabel(evidence.acceptedAt)} by ${evidence.acceptedBy} · Currentness: ${evidence.currentness} · Work Item: ${evidence.workItemId || 'none'} · Initiative: ${evidence.initiativeId || 'Unassigned'}` }),
      node('button', { className: 'button secondary', type: 'button', text: 'Start Proposed Change', on: { click: () => startProposedChange(evidence) } })
    ];
  }

  async function renderReview() {
    const token = workspaceOperationToken();
    if (state.evidenceReview.findingPage.revision !== state.workflow?.revision) {
      const loaded = await loadPendingFindingPage(state.evidenceReview.findingPage.page);
      if (!loaded || !workspaceOperationCurrent(token) || state.activeView !== 'review') return;
    }
    const page = state.evidenceReview.findingPage;
    const pageCount = Math.max(1, Math.ceil(page.total / page.pageSize));
    const findingSection = node('section', { className: 'panel finding-review-panel' }, [
      node('div', { className: 'row-head' }, [node('h2', { text: 'Pending Findings' }), badge(`${page.total} pending`)]),
      node('p', { className: 'notice', text: 'Findings remain untrusted until you explicitly review currentness and final associations. Acceptance creates Evidence only.' }),
      recordList(page.findings, pendingFindingCard, 'No pending Findings on this page.'),
      node('nav', { className: 'review-pagination', attrs: { 'aria-label': 'Pending Finding pages' } }, [
        node('button', { className: 'button secondary', type: 'button', text: 'Previous', disabled: page.page <= 1, on: { click: async () => {
          try {
            const loaded = await loadPendingFindingPage(page.page - 1);
            if (!loaded) return;
            await renderReview();
            setStatus(`Pending Finding page ${state.evidenceReview.findingPage.page} loaded.`, 'success');
          } catch (error) { setStatus(error.message, 'error'); }
        } } }),
        node('span', { text: `Page ${page.page} of ${pageCount} · ${page.pageSize} per page` }),
        node('button', { className: 'button secondary', type: 'button', text: 'Next', disabled: page.page >= pageCount, on: { click: async () => {
          try {
            const loaded = await loadPendingFindingPage(page.page + 1);
            if (!loaded) return;
            await renderReview();
            setStatus(`Pending Finding page ${state.evidenceReview.findingPage.page} loaded.`, 'success');
          } catch (error) { setStatus(error.message, 'error'); }
        } } })
      ])
    ]);
    const evidenceSection = node('section', { className: 'panel evidence-review-panel' }, [
      node('h2', { text: 'Accepted Evidence' }),
      node('p', { className: 'meta', text: 'Evidence preserves exact Source and Finding provenance. It does not assert or update canonical current state by itself.' }),
      recordList(state.workflow?.evidence || [], acceptedEvidenceCard, 'No accepted Evidence exists in this Workspace.')
    ]);
    const proposedSection = node('section', { className: 'panel proposed-change-review-panel' }, [
      node('h2', { text: 'Proposed Changes' }),
      node('p', { className: 'notice', text: 'Preview, pending creation, approval or rejection, and application are separate revision-aware actions.' }),
      recordList(state.workflow?.proposedChanges || [], proposedChangeCard, 'No Proposed Changes exist in this Workspace.')
    ]);
    if (!workspaceOperationCurrent(token) || state.activeView !== 'review') return;
    elements.view.replaceChildren(...[findingSection, evidenceSection, proposedChangeComposer(), proposedSection].filter(Boolean));
  }

  function renderSearch() {
    const input = node('input', { attrs: { minlength: '2', maxlength: '200', 'aria-label': 'Search selected Workspace' }, placeholder: 'Search Work Items, Workstreams, Jira Epics, Sources, Evidence, Milestones, or Initiatives' });
    const results = node('div');
    const form = node('form', { className: 'filters' }, [input, node('button', { className: 'button primary', type: 'submit', text: 'Search' })]);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const query = input.value.trim();
      if (query.length < 2) {
        setStatus('Enter at least two characters.', 'error');
        return;
      }
      const token = workspaceOperationToken();
      try {
        const response = await requestJson(`/api/v2/organizations/${encoded(token.organizationId)}/workspaces/${encoded(token.workspaceId)}/search?q=${encodeURIComponent(query)}`);
        if (!workspaceOperationCurrent(token) || !results.isConnected) return;
        results.replaceChildren(recordList(response.body.results, result => [
          node('div', { className: 'row-head' }, [node('strong', { text: result.title }), badge(result.kind)]),
          node('p', { className: 'meta', text: result.initiativeName || (result.initiativeId === null ? 'Unassigned or Workspace-level' : `Initiative ${result.initiativeId}`) }),
          result.kind === 'workItem' ? node('p', {
            className: 'meta',
            text: `Workstream: ${result.workstreamName || 'No Workstream'} · Jira Epic: ${result.jiraEpicKey ? `${result.jiraEpicKey} — ${result.jiraEpicName} (${result.jiraEpicMappingStatus})` : 'No Jira Epic'} · Work Item Jira key: ${result.workItemJiraKey || 'None'}`
          }) : null
        ], 'No matching records in this Workspace.'));
        setStatus(`${response.body.results.length} search result${response.body.results.length === 1 ? '' : 's'}.`, 'success');
      } catch (error) {
        if (!workspaceOperationCurrent(token)) return;
        setStatus(error.message, 'error');
      }
    });
    elements.view.replaceChildren(form, results);
  }

  function dateLabel(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Unavailable' : parsed.toLocaleString();
  }

  const briefingFormatLabels = Object.freeze({ teams: 'Teams-style', email: 'Email-style', confluence: 'Confluence-style' });
  const briefingTypeLabels = Object.freeze({ 'status-update': 'Status Update', 'delivery-status': 'Delivery Status', general: 'General' });
  const lifecycleLabels = Object.freeze({ draft: 'Draft', finalized: 'Finalized', communicated: 'Communicated' });

  function briefingFormatLabel(value) {
    return briefingFormatLabels[value] || 'Unavailable format';
  }

  function briefingTypeLabel(value) {
    return briefingTypeLabels[value] || 'Briefing';
  }

  function lifecycleLabel(value) {
    return lifecycleLabels[value] || 'Unavailable state';
  }

  function checkedValues(container, selector) {
    return [...container.querySelectorAll(selector)].filter(control => control.checked).map(control => control.value);
  }

  async function loadBriefingDefinitions() {
    const organizationId = state.context?.activeOrganizationId;
    if (!organizationId) throw new Error('An Organization is required');
    const generation = state.generation;
    const listed = await briefingApi.listBriefings(organizationId);
    briefingModule.validateBriefingResponse(listed.body, organizationId);
    const initiativeResults = await Promise.all((state.context.workspaces || []).map(async workspace => {
      const result = await requestJson(`/api/v2/organizations/${encoded(organizationId)}/workspaces/${encoded(workspace.id)}/initiatives`);
      return { workspaceId: workspace.id, initiatives: result.body.initiatives || [], revision: result.revision };
    }));
    if (generation !== state.generation) return false;
    if (initiativeResults.some(result => result.revision !== listed.revision)) throw new Error('Workspace data changed while Briefings were loading. Refresh and try again.');
    state.briefings.definitions = listed.body.briefings;
    state.briefings.revision = listed.revision;
    state.briefings.initiativesByWorkspace = new Map(initiativeResults.map(result => [result.workspaceId, result.initiatives]));
    return true;
  }

  function briefingDefinitionForm(existing = null) {
    const form = node('form', { className: 'briefing-form' });
    const name = node('input', { value: existing?.name || '', attrs: { required: 'required', maxlength: '300' } });
    const audience = node('input', { value: existing?.audienceProfile || '', attrs: { required: 'required', maxlength: '500' } });
    const type = node('select', {}, [
      option('status-update', 'Status Update', (existing?.briefingType || 'status-update') === 'status-update'),
      option('delivery-status', 'Delivery Status', existing?.briefingType === 'delivery-status'),
      option('general', 'General', existing?.briefingType === 'general')
    ]);
    const guidance = node('textarea', { value: existing?.draftingGuidance || '', attrs: { maxlength: '4000', rows: '4' }, placeholder: 'Optional drafting guidance' });
    const selectedWorkspaces = new Set(existing?.workspaces.map(workspace => workspace.id) || [state.context.activeWorkspaceId]);
    const selectedInitiatives = new Set(existing?.initiatives.map(initiative => initiative.id) || []);
    const workspaceControls = node('div', { className: 'selection-grid' }, (state.context.workspaces || []).map(workspace => {
      const workspaceControl = node('input', { type: 'checkbox', name: 'briefing-workspace', value: workspace.id, checked: selectedWorkspaces.has(workspace.id) });
      const initiatives = state.briefings.initiativesByWorkspace.get(workspace.id) || [];
      return node('fieldset', { className: 'choice-group' }, [
        node('legend', {}, [node('label', { className: 'choice' }, [workspaceControl, node('strong', { text: workspace.name })])]),
        node('p', { className: 'meta', text: 'No Initiative selected means Entire workspace.' }),
        ...workflowModule.initiativeChoices(initiatives, 'briefing').map(initiative => node('label', { className: 'choice' }, [
          node('input', { type: 'checkbox', name: 'briefing-initiative', value: initiative.id, checked: selectedInitiatives.has(initiative.id), attrs: { 'data-workspace-id': workspace.id } }),
          node('span', { text: initiative.name })
        ]))
      ]);
    }));
    const formatNames = briefingFormatLabels;
    const formatControls = node('div', { className: 'check-row' }, Object.entries(formatNames).map(([format, label]) => node('label', { className: 'choice' }, [
      node('input', { type: 'checkbox', name: 'briefing-format', value: format, checked: existing ? existing.preferredFormats.includes(format) : true }),
      node('span', { text: label })
    ])));
    const sectionNames = {
      summary: 'Summary', progress: 'Progress', risk: 'Risk', milestones: 'Milestones',
      'follow-up': 'Follow-Up', evidence: 'Evidence', 'next-actions': 'Next actions'
    };
    const defaultSections = new Set(existing?.defaultSections || ['progress', 'risk', 'milestones', 'follow-up', 'evidence']);
    const sectionControls = node('div', { className: 'check-row' }, Object.entries(sectionNames).map(([section, label]) => node('label', { className: 'choice' }, [
      node('input', { type: 'checkbox', name: 'briefing-section', value: section, checked: defaultSections.has(section) }),
      node('span', { text: label })
    ])));
    form.append(
      node('div', { className: 'field-group' }, [
        node('label', { className: 'field' }, [node('span', { text: 'Name' }), name]),
        node('label', { className: 'field' }, [node('span', { text: 'Audience profile' }), audience]),
        node('label', { className: 'field' }, [node('span', { text: 'Briefing type' }), type])
      ]),
      node('h3', { text: 'Workspace and Initiative selection' }),
      workspaceControls,
      node('h3', { text: 'Output formats' }),
      formatControls,
      node('h3', { text: 'Sections' }),
      sectionControls,
      node('label', { className: 'field' }, [node('span', { text: 'Drafting guidance' }), guidance]),
      node('div', { className: 'actions' }, [node('button', { className: 'button primary', type: 'submit', text: existing ? 'Save definition' : 'Create definition' })])
    );
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const workspaceIds = checkedValues(form, '[name="briefing-workspace"]');
      const enabledWorkspaces = new Set(workspaceIds);
      const initiativeIds = checkedValues(form, '[name="briefing-initiative"]').filter(initiativeId => {
        const control = form.querySelector(`[name="briefing-initiative"][value="${CSS.escape(initiativeId)}"]`);
        return enabledWorkspaces.has(control.dataset.workspaceId);
      });
      const preferredFormats = checkedValues(form, '[name="briefing-format"]');
      const defaultSections = checkedValues(form, '[name="briefing-section"]');
      if (!workspaceIds.length || !preferredFormats.length || !defaultSections.length) {
        setStatus('Choose at least one Workspace, output format, and section.', 'error');
        return;
      }
      const definition = {
        name: name.value.trim(), workspaceIds, initiativeIds, audienceProfile: audience.value.trim(),
        briefingType: type.value, preferredFormats, defaultSections, draftingGuidance: guidance.value.trim()
      };
      const token = briefingOperationToken();
      try {
        const result = existing
          ? await briefingApi.updateBriefing(state.context.activeOrganizationId, existing.id, { expectedRevision: state.briefings.revision, actor: 'local-target-ui', changes: definition })
          : await briefingApi.createBriefing(state.context.activeOrganizationId, { expectedRevision: state.briefings.revision, actor: 'local-target-ui', briefing: definition });
        if (!briefingOperationCurrent(token)) return;
        state.briefings.revision = result.revision;
        setStatus(existing ? 'Briefing definition updated.' : 'Briefing definition created.', 'success');
        await renderBriefings();
      } catch (error) {
        if (!briefingOperationCurrent(token)) return;
        setStatus(error.message, 'error');
      }
    });
    return form;
  }

  function definitionInitiativeLabel(definition) {
    return definition.workspaces.map(workspace => {
      const initiatives = definition.initiatives.filter(initiative => initiative.workspaceId === workspace.id);
      return `${workspace.name}: ${initiatives.length ? initiatives.map(initiative => initiative.name).join(', ') : 'Entire workspace'}`;
    }).join(' · ');
  }

  async function createBriefingDraft(definition) {
    const organizationId = state.context.activeOrganizationId;
    const token = briefingOperationToken();
    try {
      const prepared = await briefingApi.prepareCandidates(organizationId, definition.id);
      if (!briefingOperationCurrent(token)) return;
      const created = await briefingApi.createDraft(organizationId, definition.id, {
        expectedRevision: prepared.revision,
        actor: 'local-target-ui',
        selectedFactIds: [],
        manualInputs: []
      });
      if (!briefingOperationCurrent(token)) return;
      state.briefings.revision = created.revision;
      state.briefings.tab = 'open';
      state.briefings.activeDefinitionId = definition.id;
      state.briefings.activeVersionId = created.body.version.id;
      setStatus(`Draft created with ${prepared.body.candidates.length} reviewable candidate facts.`, 'success');
      await renderBriefings();
    } catch (error) {
      if (!briefingOperationCurrent(token)) return;
      setStatus(error.message, 'error');
    }
  }

  function renderPrepareBriefings() {
    const cards = state.briefings.definitions.map(definition => node('article', { className: 'card' }, [
      node('div', { className: 'row-head' }, [node('h2', { text: definition.name }), badge(briefingTypeLabel(definition.briefingType))]),
      node('p', { text: definition.audienceProfile }),
      node('p', { className: 'meta', text: definitionInitiativeLabel(definition) }),
      node('p', { className: 'meta', text: `Formats: ${definition.preferredFormats.map(briefingFormatLabel).join(', ')} · Sections: ${definition.defaultSections.join(', ')}` }),
      node('div', { className: 'actions' }, [
        node('button', { className: 'button primary', type: 'button', text: 'Create Draft', on: { click: () => createBriefingDraft(definition) } }),
        node('details', { className: 'inline-editor' }, [
          node('summary', { className: 'button secondary', text: 'Edit definition' }),
          briefingDefinitionForm(definition)
        ])
      ])
    ]));
    elements.view.append(
      node('section', { className: 'panel' }, [
        node('h2', { text: 'Prepare a Briefing' }),
        node('p', { text: 'Briefing definitions are Organization-owned. Initiative selection is preserved with stable IDs, and an empty Initiative selection means Entire workspace for each selected Workspace.' }),
        briefingDefinitionForm()
      ]),
      node('div', { className: 'card-grid briefing-cards' }, cards.length ? cards : [empty('No Briefing definitions exist yet.')])
    );
  }

  async function copyBriefingText(text) {
    const token = briefingOperationToken();
    try {
      await navigator.clipboard.writeText(text);
      if (!briefingOperationCurrent(token)) return;
      setStatus('Output copied. No communication status was changed.', 'success');
    } catch (_) {
      if (!briefingOperationCurrent(token)) return;
      setStatus('Clipboard access was unavailable. Select the visible output and copy it manually.', 'error');
    }
  }

  function outputCards(outputs) {
    return node('div', { className: 'output-grid' }, outputs.map(output => node('section', { className: 'card' }, [
      node('div', { className: 'row-head' }, [node('h3', { text: `${briefingFormatLabel(output.format)} output` }), badge(`${output.text.length} characters`)]),
      node('pre', { className: 'output-preview', text: output.text, attrs: { tabindex: '0' } }),
      node('button', { className: 'button secondary', type: 'button', text: 'Copy output', on: { click: () => copyBriefingText(output.text) } })
    ])));
  }

  async function loadFrozenOutputs(definition, version, destination) {
    const generation = state.generation;
    const renderGeneration = state.briefings.renderGeneration;
    try {
      const results = await Promise.all(version.outputMetadata.filter(item => item.format).map(item => briefingApi.getOutput(
        state.context.activeOrganizationId, definition.id, version.id, item.format
      )));
      if (generation !== state.generation || renderGeneration !== state.briefings.renderGeneration || !destination.isConnected) return;
      destination.replaceChildren(outputCards(results.map(result => result.body.output)));
    } catch (error) {
      if (generation !== state.generation || renderGeneration !== state.briefings.renderGeneration || !destination.isConnected) return;
      destination.replaceChildren(empty('Frozen output could not be loaded.'));
      setStatus(error.message, 'error');
    }
  }

  function comparisonSummary(version) {
    const comparison = version.frozenSnapshot?.comparison;
    if (!comparison) return null;
    return node('p', { className: 'notice', text: comparison.baselineVersionId
      ? `Compared with communicated baseline: ${comparison.addedFactIds.length} added, ${comparison.changedFactIds.length} changed, ${comparison.removedFactIds.length} removed.`
      : `${comparison.addedFactIds.length} available facts; no communicated baseline exists yet.` });
  }

  function renderDraftEditor(definition, version) {
    const snapshot = version.frozenSnapshot;
    const selected = new Set(snapshot.selectedFactIds);
    const form = node('form', { className: 'briefing-editor' });
    const candidateControls = node('div', { className: 'candidate-list' }, snapshot.candidates.map(candidate => node('label', { className: 'candidate' }, [
      node('input', { type: 'checkbox', name: 'candidate-fact', value: candidate.id, checked: selected.has(candidate.id) }),
      node('span', {}, [
        node('strong', { text: candidate.title }),
        node('span', { text: candidate.text }),
        node('small', { text: `${candidate.kind} · ${candidate.section} · ${candidate.provenance.type}${candidate.truncated ? ' · shortened preview' : ''}` })
      ])
    ])));
    const manualRows = snapshot.manualInputs.map(input => {
      const textarea = node('textarea', { value: input.text, attrs: { maxlength: '4000', rows: '3', 'data-manual-id': input.id } });
      const section = node('select', { attrs: { 'data-manual-section': input.id } }, snapshot.definition.defaultSections.map(value => option(value, value, value === input.section)));
      return node('div', { className: 'field-group manual-row' }, [
        node('label', { className: 'field' }, [node('span', { text: 'Section' }), section]),
        node('label', { className: 'field' }, [node('span', { text: 'Manual PM input' }), textarea])
      ]);
    });
    const newManualSection = node('select', {}, snapshot.definition.defaultSections.map(value => option(value, value)));
    const newManual = node('textarea', { attrs: { maxlength: '4000', rows: '3' }, placeholder: 'Optional new Manual PM input' });
    const previewArea = node('div', { className: 'output-region', attrs: { 'aria-live': 'polite' } });
    form.append(
      comparisonSummary(version),
      node('h3', { text: 'Grounded candidate facts' }),
      node('p', { className: 'meta', text: 'Current Work Item state and accepted Evidence are labeled separately. Select only facts that belong in this Draft.' }),
      candidateControls,
      node('h3', { text: 'Manual PM input' }),
      node('p', { className: 'meta', text: 'Manual PM input is explicitly labeled and is never presented as Evidence.' }),
      ...manualRows,
      node('div', { className: 'field-group manual-row' }, [
        node('label', { className: 'field' }, [node('span', { text: 'Section' }), newManualSection]),
        node('label', { className: 'field' }, [node('span', { text: 'New Manual PM input' }), newManual])
      ]),
      node('div', { className: 'actions' }, [
        node('button', { className: 'button primary', type: 'submit', text: 'Save Draft' }),
        node('button', { className: 'button secondary', type: 'button', text: 'Refresh candidates', on: { click: async () => {
          const token = briefingOperationToken();
          try {
            const result = await briefingApi.refreshDraft(state.context.activeOrganizationId, definition.id, version.id, { expectedRevision: state.briefings.revision, actor: 'local-target-ui' });
            if (!briefingOperationCurrent(token)) return;
            state.briefings.revision = result.revision;
            const summary = result.body.reconciliation;
            setStatus(`Draft refreshed: ${summary.addedCandidateFactIds.length} added and ${summary.removedSelectedFactIds.length} selected facts removed. Manual PM input was preserved.`, 'success');
            await renderBriefings();
          } catch (error) { if (briefingOperationCurrent(token)) setStatus(error.message, 'error'); }
        } } }),
        node('button', { className: 'button secondary', type: 'button', text: 'Preview outputs', on: { click: async () => {
          const token = briefingOperationToken();
          try {
            const result = await briefingApi.previewOutputs(state.context.activeOrganizationId, definition.id, version.id);
            if (!briefingOperationCurrent(token) || !previewArea.isConnected) return;
            previewArea.replaceChildren(outputCards(result.body.outputs));
            setStatus('Draft outputs previewed. Nothing has been finalized or sent.', 'success');
          } catch (error) { if (briefingOperationCurrent(token)) setStatus(error.message, 'error'); }
        } } }),
        node('button', { className: 'button secondary', type: 'button', text: 'Preview and finalize', on: { click: async () => {
          const token = briefingOperationToken();
          try {
            const preview = await briefingApi.previewFinalize(state.context.activeOrganizationId, definition.id, version.id);
            if (!briefingOperationCurrent(token)) return;
            const approved = await confirmAction('Finalize this Briefing Version?', [
              node('p', { text: `${preview.body.briefing.name} for ${selectedOrganization()?.name || 'the selected Organization'}` }),
              node('p', { text: `Audience: ${preview.body.audienceProfile}` }),
              node('p', { text: `Applies to: ${preview.body.workspaces.map(workspace => `${workspace.name}: ${workspace.selection.label}`).join(' · ')}` }),
              node('p', { text: `Sections: ${preview.body.sections.join(', ')} · Formats: ${preview.body.outputs.map(output => briefingFormatLabel(output.format)).join(', ')}` }),
              node('p', { text: `${preview.body.selectedFacts.length} facts, including ${preview.body.manualInputs.length} Manual PM input item(s), will be frozen.` }),
              node('p', { className: 'meta', text: `Snapshot prepared ${dateLabel(preview.body.snapshotBasis.preparedAt)} · revision ${preview.body.expectedRevision} · Draft state ${preview.body.draftStateHash}` }),
              node('p', { className: 'notice', text: 'Finalizing keeps this Version in Open and does not communicate or advance the baseline.' })
            ], 'Finalize Version');
            if (!approved || !briefingOperationCurrent(token)) return;
            const finalized = await briefingApi.finalize(state.context.activeOrganizationId, definition.id, version.id, {
              expectedRevision: preview.body.expectedRevision, actor: 'local-target-ui', draftStateHash: preview.body.draftStateHash
            });
            if (!briefingOperationCurrent(token)) return;
            state.briefings.revision = finalized.revision;
            setStatus('Briefing Version finalized. It remains Open and has not been communicated.', 'success');
            await renderBriefings();
          } catch (error) { if (briefingOperationCurrent(token)) setStatus(error.message, 'error'); }
        } } })
      ]),
      previewArea
    );
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const token = briefingOperationToken();
      const manualInputs = snapshot.manualInputs.map(input => {
        const textControl = form.querySelector(`[data-manual-id="${CSS.escape(input.id)}"]`);
        const sectionControl = form.querySelector(`[data-manual-section="${CSS.escape(input.id)}"]`);
        return { id: input.id, section: sectionControl.value, text: textControl.value.trim() };
      }).filter(input => input.text);
      if (newManual.value.trim()) manualInputs.push({ section: newManualSection.value, text: newManual.value.trim() });
      try {
        const result = await briefingApi.editDraft(state.context.activeOrganizationId, definition.id, version.id, {
          expectedRevision: state.briefings.revision,
          actor: 'local-target-ui',
          selectedFactIds: checkedValues(form, '[name="candidate-fact"]'),
          manualInputs
        });
        if (!briefingOperationCurrent(token)) return;
        state.briefings.revision = result.revision;
        setStatus('Draft saved.', 'success');
        await renderBriefings();
      } catch (error) { if (briefingOperationCurrent(token)) setStatus(error.message, 'error'); }
    });
    return form;
  }

  function renderFinalizedEditor(definition, version) {
    const outputs = node('div', { className: 'output-region' }, [empty('Loading frozen output…')]);
    loadFrozenOutputs(definition, version, outputs);
    const format = node('select', {}, version.outputMetadata.filter(item => item.format).map(item => option(item.format, briefingFormatLabel(item.format))));
    const channel = node('select', {}, [
      option('teams', 'Teams'),
      option('email', 'Email'),
      option('confluence', 'Confluence'),
      option('other', 'Other')
    ]);
    const reference = node('textarea', { attrs: { maxlength: '2000', rows: '3' }, placeholder: 'Optional external reference note' });
    const form = node('form', { className: 'communication-form' }, [
      node('h3', { text: 'Mark as communicated' }),
      node('p', { className: 'notice', text: 'This records an external action. Priorena does not send the output.' }),
      node('div', { className: 'field-group' }, [
        node('label', { className: 'field' }, [node('span', { text: 'Copied output format' }), format]),
        node('label', { className: 'field' }, [node('span', { text: 'External communication channel' }), channel]),
        node('label', { className: 'field' }, [node('span', { text: 'External reference note' }), reference])
      ]),
      node('button', { className: 'button primary', type: 'submit', text: 'Review communication record' })
    ]);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const token = briefingOperationToken();
      try {
        const preview = await briefingApi.previewCommunicate(state.context.activeOrganizationId, definition.id, version.id, format.value);
        if (!briefingOperationCurrent(token)) return;
        const communicatedAt = new Date().toISOString();
        const approved = await confirmAction('Mark as communicated?', [
          node('p', { text: preview.body.statement }),
          node('p', { text: `${definition.name} · Version ${version.id}` }),
          node('p', { text: `Channel: ${channel.options[channel.selectedIndex].text} · Output: ${briefingFormatLabel(format.value)} · ${preview.body.output.byteLength} bytes · timestamp ${communicatedAt}` }),
          node('p', { text: `External reference: ${reference.value.trim() || 'No external reference note'}` }),
          node('p', { className: 'notice', text: 'This advances the comparison baseline and moves the immutable Version to History.' })
        ], 'Mark as communicated');
        if (!approved || !briefingOperationCurrent(token)) return;
        const result = await briefingApi.markCommunicated(state.context.activeOrganizationId, definition.id, version.id, {
          expectedRevision: preview.body.expectedRevision,
          actor: 'local-target-ui',
          outputFormat: format.value,
          channel: channel.value,
          referenceNote: reference.value.trim(),
          communicatedAt,
          versionContentHash: preview.body.versionContentHash
        });
        if (!briefingOperationCurrent(token)) return;
        state.briefings.revision = result.revision;
        state.briefings.tab = 'history';
        setStatus('External communication recorded. Priorena sent nothing.', 'success');
        await renderBriefings();
      } catch (error) { if (briefingOperationCurrent(token)) setStatus(error.message, 'error'); }
    });
    return node('div', {}, [outputs, form]);
  }

  function renderCommunicatedEditor(definition, version) {
    const outputs = node('div', { className: 'output-region' }, [empty('Loading immutable output…')]);
    loadFrozenOutputs(definition, version, outputs);
    return node('div', {}, [
      node('p', { className: 'notice', text: 'This immutable Version is in History. Copying output does not change its lifecycle.' }),
      node('dl', { className: 'metadata-list' }, [
        node('dt', { text: 'Communicated' }), node('dd', { text: dateLabel(version.communicatedAt) }),
        node('dt', { text: 'Channel' }), node('dd', { text: version.communication?.channel ? version.communication.channel[0].toUpperCase() + version.communication.channel.slice(1) : 'Unavailable' }),
        node('dt', { text: 'Format' }), node('dd', { text: version.communication?.outputFormat ? briefingFormatLabel(version.communication.outputFormat) : 'Unavailable' }),
        node('dt', { text: 'Reference' }), node('dd', { text: version.communication?.referenceNote || 'No external reference note' })
      ]),
      outputs
    ]);
  }

  async function renderVersionDetail(definition, summary, history, renderGeneration) {
    const generation = state.generation;
    const destination = node('section', { className: 'panel version-detail' }, [empty('Loading Briefing Version…')]);
    elements.view.append(destination);
    const result = await briefingApi.getVersion(state.context.activeOrganizationId, definition.id, summary.id);
    if (generation !== state.generation || renderGeneration !== state.briefings.renderGeneration || !destination.isConnected) return;
    state.briefings.revision = result.revision;
    const version = result.body.version;
    destination.replaceChildren(
      node('div', { className: 'row-head' }, [node('h2', { text: definition.name }), badge(lifecycleLabel(version.status))]),
      node('p', { className: 'meta', text: `Version ${version.id} · created ${dateLabel(version.createdAt)}` }),
      history ? renderCommunicatedEditor(definition, version)
        : (version.status === 'draft' ? renderDraftEditor(definition, version) : renderFinalizedEditor(definition, version))
    );
  }

  async function renderVersionPlacement(history, renderGeneration) {
    const organizationId = state.context.activeOrganizationId;
    const generation = state.generation;
    const placements = await Promise.all(state.briefings.definitions.map(async definition => {
      const result = history
        ? await briefingApi.listHistory(organizationId, definition.id)
        : await briefingApi.listOpen(organizationId, definition.id);
      return { definition, versions: result.body.versions, revision: result.revision };
    }));
    if (generation !== state.generation || renderGeneration !== state.briefings.renderGeneration) return;
    if (placements.some(placement => placement.revision !== state.briefings.revision)) throw new Error('Workspace data changed while Briefing Versions were loading. Refresh and try again.');
    const versions = placements.flatMap(placement => placement.versions.map(version => ({ definition: placement.definition, version })));
    if (placements[0]) state.briefings.revision = placements[0].revision;
    const list = recordList(versions, item => [
      node('button', { className: 'version-button', type: 'button', on: { click: async () => {
        const token = briefingOperationToken();
        state.briefings.activeDefinitionId = item.definition.id;
        state.briefings.activeVersionId = item.version.id;
        try { await renderBriefings(); } catch (error) { if (briefingOperationCurrent(token)) setStatus(error.message, 'error'); }
      } } }, [
        node('span', {}, [node('strong', { text: item.definition.name }), node('span', { className: 'meta', text: `Version ${item.version.id}` })]),
        node('span', {}, [badge(lifecycleLabel(item.version.status)), node('span', { className: 'meta', text: dateLabel(item.version.communicatedAt || item.version.finalizedAt || item.version.createdAt) })])
      ])
    ], history ? 'No communicated Briefing Versions are in History.' : 'No Draft or Finalized Briefing Versions are Open.');
    elements.view.append(node('section', { className: 'panel' }, [
      node('h2', { text: history ? 'Communicated History' : 'Open Briefing Versions' }),
      node('p', { className: 'meta', text: history ? 'History contains communicated immutable Versions only.' : 'Open contains Draft and Finalized Versions. Finalized does not mean communicated.' }),
      list
    ]));
    if (state.briefings.activeVersionId) {
      const active = versions.find(item => item.version.id === state.briefings.activeVersionId && item.definition.id === state.briefings.activeDefinitionId);
      if (active) await renderVersionDetail(active.definition, active.version, history, renderGeneration);
    }
  }

  async function renderBriefings() {
    if (!state.context?.activeOrganizationId) {
      elements.view.replaceChildren(empty('Select an Organization to open Briefings.'));
      return;
    }
    const generation = state.generation;
    const renderGeneration = ++state.briefings.renderGeneration;
    elements.view.replaceChildren();
    if (!(await loadBriefingDefinitions()) || generation !== state.generation || renderGeneration !== state.briefings.renderGeneration) return;
    const tabs = node('div', { className: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Briefing lifecycle' } }, ['prepare', 'open', 'history'].map(tab => node('button', {
      className: `button ${state.briefings.tab === tab ? 'primary' : 'secondary'}`,
      type: 'button', text: tab[0].toUpperCase() + tab.slice(1),
      attrs: { role: 'tab', 'aria-selected': String(state.briefings.tab === tab) },
      on: { click: async () => {
        const token = briefingOperationToken();
        state.briefings.tab = tab;
        state.briefings.activeDefinitionId = null;
        state.briefings.activeVersionId = null;
        try { await renderBriefings(); } catch (error) { if (briefingOperationCurrent(token)) setStatus(error.message, 'error'); }
      } }
    })));
    elements.view.append(
      tabs,
      node('p', { className: 'notice', text: 'Priorena creates drafts for you to review and copy. It never sends them automatically; communication state changes only after your confirmation.' })
    );
    if (state.briefings.tab === 'prepare') renderPrepareBriefings();
    else await renderVersionPlacement(state.briefings.tab === 'history', renderGeneration);
  }

  async function controlledRename(route, entityLabel, currentName, nextName, onApplied) {
    const name = nextName.trim();
    if (!name || name === currentName) {
      setStatus(`Enter a different ${entityLabel} name.`, 'error');
      return;
    }
    const token = workspaceOperationToken();
    try {
      const preview = await requestJson(`${route}/rename/preview`, mutationOptions({ name }));
      if (!workspaceOperationCurrent(token)) return;
      const approved = await confirmAction(
        `Rename ${entityLabel}`,
        [node('p', { text: `${preview.body.preview.oldName} → ${preview.body.preview.newName}` }), node('p', { className: 'notice', text: 'Stable IDs and relationships are preserved. Existing frozen Briefing snapshots are not rewritten.' })],
        `Rename ${entityLabel}`
      );
      if (!approved || !workspaceOperationCurrent(token)) return;
      const result = await requestJson(`${route}/rename/apply`, mutationOptions({
        expectedRevision: preview.body.preview.expectedRevision,
        actor: 'local-target-ui',
        name,
        previewHash: preview.body.preview.previewHash
      }));
      if (!workspaceOperationCurrent(token)) return;
      onApplied(result.body);
      state.workflow = null;
      invalidateTriageData();
      await loadWorkflow();
      if (!workspaceOperationCurrent(token)) return;
      fillOrganizations();
      fillWorkspaces();
      renderSettings();
      setStatus(`${entityLabel} renamed. Stable IDs and frozen Briefing history were preserved.`, 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      setStatus(error.code === 'PREVIEW_CONFLICT' || error.code === 'REVISION_CONFLICT'
        ? 'The workspace changed. Refresh and preview the rename again.'
        : error.message, 'error');
    }
  }

  function renameControl(entityLabel, currentName, route, onApplied) {
    const input = node('input', { value: currentName, attrs: { maxlength: '200', 'aria-label': `${entityLabel} name` } });
    return node('div', { className: 'actions' }, [
      input,
      node('button', { className: 'button secondary', type: 'button', text: `Preview ${entityLabel} rename`, on: { click: () => controlledRename(route, entityLabel, currentName, input.value, onApplied) } })
    ]);
  }

  async function createInitiativeFromSettings(controls) {
    const token = workspaceOperationToken();
    const name = controls.name.value.trim();
    if (!name) {
      setStatus('Initiative name is required.', 'error');
      controls.name.focus();
      return;
    }
    try {
      await requestJson(`/api/v2/organizations/${encoded(token.organizationId)}/workspaces/${encoded(token.workspaceId)}/initiatives`, mutationOptions({
        expectedRevision: state.workflow.revision,
        actor: 'local-target-ui',
        initiative: {
          name,
          description: controls.description.value.trim(),
          owner: controls.owner.value.trim() || null
        }
      }));
      if (!workspaceOperationCurrent(token)) return;
      state.workflow = null;
      invalidateTriageData();
      await loadWorkflow();
      if (!workspaceOperationCurrent(token)) return;
      renderSettings();
      setStatus(`Initiative “${name}” created and available in current selectors.`, 'success');
    } catch (error) {
      if (workspaceOperationCurrent(token)) setStatus(error.message, 'error');
    }
  }

  function initiativeRelationshipCounts(initiativeId) {
    return {
      workstreams: (state.workflow?.workstreams || []).filter(item => item.initiativeId === initiativeId).length,
      jiraEpicMappings: (state.workflow?.jiraEpicMappings || []).filter(item => item.initiativeId === initiativeId).length,
      workItems: (state.workflow?.workItems || []).filter(item => item.initiativeId === initiativeId).length,
      milestones: (state.workflow?.milestones || []).filter(item => item.initiativeId === initiativeId).length
    };
  }

  function countLabel(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  async function setInitiativeArchivedFromSettings(initiative, archived) {
    const token = workspaceOperationToken();
    const revision = state.workflow.revision;
    const counts = initiativeRelationshipCounts(initiative.id);
    const approved = await confirmAction(
      archived ? 'Archive Initiative' : 'Restore Initiative',
      archived ? [
        node('p', { text: `Archive “${initiative.name}”?` }),
        node('p', { className: 'notice', text: 'Archive is reversible. The stable ID and existing records are preserved; nothing is deleted.' }),
        node('p', { text: 'Archived Initiatives are removed from ordinary new-assignment and parent choices until restored.' }),
        node('p', { className: 'meta', text: `Current related records: ${countLabel(counts.workstreams, 'Workstream')} · ${countLabel(counts.jiraEpicMappings, 'Jira Epic mapping')} · ${countLabel(counts.workItems, 'Work Item')} · ${countLabel(counts.milestones, 'Milestone')}. Existing Briefing history is preserved.` })
      ] : [
        node('p', { text: `Restore “${initiative.name}”?` }),
        node('p', { className: 'notice', text: `The same stable ID (${initiative.id}) will return to ordinary Initiative selectors.` })
      ],
      archived ? 'Archive Initiative' : 'Restore Initiative'
    );
    if (!approved || !workspaceOperationCurrent(token)) return;
    try {
      await requestJson(`/api/v2/organizations/${encoded(token.organizationId)}/workspaces/${encoded(token.workspaceId)}/initiatives/${encoded(initiative.id)}/archive`, mutationOptions({
        expectedRevision: revision,
        actor: 'local-target-ui',
        archived
      }));
      if (!workspaceOperationCurrent(token)) return;
      state.workflow = null;
      invalidateTriageData();
      await loadWorkflow();
      if (!workspaceOperationCurrent(token)) return;
      renderSettings();
      setStatus(`Initiative ${archived ? 'archived' : 'restored'}. Stable ID and existing relationships were preserved.`, 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      setStatus(error.code === 'REVISION_CONFLICT'
        ? 'The workspace changed. Review the Initiative and try again.'
        : error.message, 'error');
    }
  }

  function initiativeSettingsCard(initiatives, workspaceRoute, workspace) {
    const settingsInitiatives = workflowModule.initiativeChoices(initiatives, 'settings');
    const controls = {
      name: node('input', { attrs: { maxlength: '200', required: 'required', 'aria-label': 'Initiative name' }, placeholder: 'Initiative name' }),
      description: node('textarea', { attrs: { maxlength: '4000', rows: '3', 'aria-label': 'Initiative description' }, placeholder: 'Optional description' }),
      owner: node('input', { attrs: { maxlength: '300', 'aria-label': 'Initiative owner' }, placeholder: 'Optional owner' })
    };
    const form = node('form', { className: 'initiative-create-form', attrs: { novalidate: 'novalidate', id: 'create-initiative' } }, [
      node('h4', { text: 'Create Initiative' }),
      node('p', { className: 'meta', text: `Parent Workspace: ${workspace.name}` }),
      node('div', { className: 'field-group' }, [
        node('label', { className: 'field' }, [node('span', { text: 'Initiative name' }), controls.name]),
        node('label', { className: 'field' }, [node('span', { text: 'Optional owner' }), controls.owner])
      ]),
      node('label', { className: 'field' }, [node('span', { text: 'Optional description' }), controls.description]),
      node('button', { className: 'button primary', type: 'submit', text: 'Create Initiative' })
    ]);
    form.addEventListener('submit', event => {
      event.preventDefault();
      createInitiativeFromSettings(controls);
    });
    let records;
    if (settingsInitiatives.length === 0) {
      records = node('div', { className: 'empty empty-state' }, [
        node('p', { text: 'No Initiatives exist in this Workspace yet.' }),
        node('button', { className: 'button primary', type: 'button', text: 'Create Initiative', on: { click: () => controls.name.focus() } })
      ]);
    } else {
      records = recordList(settingsInitiatives, initiative => {
        const counts = initiativeRelationshipCounts(initiative.id);
        return [
          node('div', { className: 'row-head' }, [
            node('strong', { text: initiative.name }),
            badge(initiative.archived ? 'Archived' : 'Active', initiative.archived ? 'muted-badge' : '')
          ]),
          node('p', { className: 'meta', text: `Stable ID: ${initiative.id} · ${initiative.description || 'No description'} · Owner: ${initiative.owner || 'Not set'}` }),
          node('p', { className: 'meta', text: `${countLabel(counts.workstreams, 'Workstream')} · ${countLabel(counts.jiraEpicMappings, 'Jira Epic mapping')} · ${countLabel(counts.workItems, 'Work Item')} · ${countLabel(counts.milestones, 'Milestone')}` }),
          renameControl('Initiative', initiative.name, `${workspaceRoute}/initiatives/${encoded(initiative.id)}`, body => { initiative.name = body.initiative.name; }),
          node('div', { className: 'actions status-actions' }, [
            node('button', {
              className: `button ${initiative.archived ? 'secondary' : 'danger'}`,
              type: 'button',
              text: initiative.archived ? 'Restore Initiative' : 'Archive Initiative',
              on: { click: () => setInitiativeArchivedFromSettings(initiative, !initiative.archived) }
            })
          ])
        ];
      }, 'No Initiatives configured.');
    }
    return node('section', { className: 'card settings-card' }, [
      node('h3', { text: 'Initiatives' }),
      node('p', { className: 'meta', text: 'Create and manage Initiatives independently from optional Workstreams and Jira Epic mappings.' }),
      form,
      node('h4', { text: 'Existing Initiatives' }),
      records
    ]);
  }

  async function createWorkstreamFromSettings(initiativeId, name, description) {
    const token = workspaceOperationToken();
    if (!name.trim()) {
      setStatus('Workstream name is required.', 'error');
      return;
    }
    try {
      await requestJson(`/api/v2/organizations/${encoded(token.organizationId)}/workspaces/${encoded(token.workspaceId)}/initiatives/${encoded(initiativeId)}/workstreams`, mutationOptions({
        expectedRevision: state.workflow.revision,
        actor: 'local-target-ui',
        workstream: { name: name.trim(), description: description.trim() }
      }));
      if (!workspaceOperationCurrent(token)) return;
      state.workflow = null;
      invalidateTriageData();
      await loadWorkflow();
      if (!workspaceOperationCurrent(token)) return;
      renderSettings();
      setStatus('Workstream created under the selected Initiative. No Jira mapping was created.', 'success');
    } catch (error) {
      if (workspaceOperationCurrent(token)) setStatus(error.message, 'error');
    }
  }

  function workstreamSettingsCard(initiatives, workstreams) {
    const activeInitiatives = workflowModule.initiativeChoices(initiatives, 'workstream-parent');
    const initiativeSelect = node('select', {}, activeInitiatives.map(initiative => option(initiative.id, initiative.name)));
    const name = node('input', { attrs: { maxlength: '200', 'aria-label': 'New Workstream name' }, placeholder: 'Workstream name' });
    const description = node('input', { attrs: { maxlength: '4000', 'aria-label': 'New Workstream description' }, placeholder: 'Optional Workstream description' });
    const rows = recordList(workstreams, workstream => {
      const route = `/api/v2/organizations/${encoded(state.context.activeOrganizationId)}/workspaces/${encoded(state.context.activeWorkspaceId)}`;
      const workstreamRoute = `${route}/initiatives/${encoded(workstream.initiativeId)}/workstreams/${encoded(workstream.id)}`;
      return [
        node('strong', { text: workstream.name }),
        node('p', { className: 'meta', text: `Stable ID: ${workstream.id} · Initiative: ${initiativeName(workstream.initiativeId)} · ${workstream.description || 'No description'}` }),
        renameControl('Workstream', workstream.name, workstreamRoute, body => {
          const current = state.workflow.workstreams.find(item => item.id === workstream.id);
          if (current) current.name = body.workstream.name;
        })
      ];
    }, 'No Workstreams have been added. Workstreams are optional and belong to an Initiative.');
    return node('section', { className: 'card settings-card' }, [
      node('h3', { text: 'Workstreams' }),
      node('p', { className: 'meta', text: 'Workstreams are optional Initiative children. Creating or renaming one does not call Jira or change Jira Epic mappings.' }),
      node('div', { className: 'field-group' }, [
        node('label', { className: 'field' }, [node('span', { text: 'Parent Initiative' }), initiativeSelect]),
        node('label', { className: 'field' }, [node('span', { text: 'Workstream name' }), name]),
        node('label', { className: 'field' }, [node('span', { text: 'Description' }), description])
      ]),
      node('button', { className: 'button primary', type: 'button', text: 'Create Workstream', disabled: activeInitiatives.length === 0, on: { click: () => createWorkstreamFromSettings(initiativeSelect.value, name.value, description.value) } }),
      rows
    ]);
  }

  async function createJiraMappingFromSettings(initiativeId, controls) {
    const token = workspaceOperationToken();
    const mapping = {
      jiraProjectKey: controls.projectKey.value.trim().toUpperCase(),
      jiraEpicKey: controls.epicKey.value.trim().toUpperCase(),
      jiraEpicName: controls.epicName.value.trim(),
      mappingStatus: controls.status.value,
      provenance: controls.provenance.value.trim()
    };
    if (!initiativeId || !mapping.jiraProjectKey || !mapping.jiraEpicKey || !mapping.jiraEpicName || !mapping.provenance) {
      setStatus('Parent Initiative, Jira keys, Jira Epic name, and how the mapping was confirmed are required.', 'error');
      return;
    }
    try {
      await requestJson(`/api/v2/organizations/${encoded(token.organizationId)}/workspaces/${encoded(token.workspaceId)}/initiatives/${encoded(initiativeId)}/jira-epic-mappings`, mutationOptions({
        expectedRevision: state.workflow.revision,
        actor: 'local-target-ui',
        mapping
      }));
      if (!workspaceOperationCurrent(token)) return;
      state.workflow = null;
      invalidateTriageData();
      await loadWorkflow();
      if (!workspaceOperationCurrent(token)) return;
      renderSettings();
      setStatus('Jira Epic mapping created locally. Nothing was written to Jira.', 'success');
    } catch (error) {
      if (workspaceOperationCurrent(token)) setStatus(error.message, 'error');
    }
  }

  async function updateJiraMappingFromSettings(mapping, controls) {
    const token = workspaceOperationToken();
    const changes = {
      jiraProjectKey: controls.projectKey.value.trim().toUpperCase(),
      jiraEpicKey: controls.epicKey.value.trim().toUpperCase(),
      jiraEpicName: controls.epicName.value.trim(),
      mappingStatus: controls.status.value,
      provenance: controls.provenance.value.trim(),
      verifiedAt: controls.status.value === 'verified' ? (mapping.verifiedAt || new Date().toISOString()) : null
    };
    if (!changes.jiraProjectKey || !changes.jiraEpicKey || !changes.jiraEpicName || !changes.provenance) {
      setStatus('Jira keys, Jira Epic name, and how the mapping was confirmed are required.', 'error');
      return;
    }
    try {
      await requestJson(`/api/v2/organizations/${encoded(token.organizationId)}/workspaces/${encoded(token.workspaceId)}/initiatives/${encoded(mapping.initiativeId)}/jira-epic-mappings/${encoded(mapping.id)}`, mutationOptions({
        expectedRevision: state.workflow.revision,
        actor: 'local-target-ui',
        changes
      }, 'PATCH'));
      if (!workspaceOperationCurrent(token)) return;
      state.workflow = null;
      invalidateTriageData();
      await loadWorkflow();
      if (!workspaceOperationCurrent(token)) return;
      renderSettings();
      setStatus('Jira Epic mapping updated locally. Nothing was written to Jira.', 'success');
    } catch (error) {
      if (workspaceOperationCurrent(token)) setStatus(error.message, 'error');
    }
  }

  function jiraMappingControls(mapping = null) {
    return {
      projectKey: node('input', { value: mapping?.jiraProjectKey || '', attrs: { maxlength: '100', 'aria-label': 'Jira project key' }, placeholder: 'EXAMPLE' }),
      epicKey: node('input', { value: mapping?.jiraEpicKey || '', attrs: { maxlength: '100', 'aria-label': 'Jira Epic key' }, placeholder: 'EXAMPLE-100' }),
      epicName: node('input', { value: mapping?.jiraEpicName || '', attrs: { maxlength: '500', 'aria-label': 'Jira Epic name' }, placeholder: 'Jira Epic name' }),
      status: node('select', {}, [
        option('pending', 'Pending', (mapping?.mappingStatus || 'pending') === 'pending'),
        option('verified', 'Verified', mapping?.mappingStatus === 'verified'),
        option('inactive', 'Inactive', mapping?.mappingStatus === 'inactive')
      ]),
      provenance: node('input', { value: mapping?.provenance || '', attrs: { maxlength: '2000', 'aria-label': 'How this mapping was confirmed' }, placeholder: 'How this local mapping was reviewed' })
    };
  }

  function jiraMappingFields(controls) {
    return node('div', { className: 'field-group' }, [
      node('label', { className: 'field' }, [node('span', { text: 'Jira project key' }), controls.projectKey]),
      node('label', { className: 'field' }, [node('span', { text: 'Jira Epic key' }), controls.epicKey]),
      node('label', { className: 'field' }, [node('span', { text: 'Jira Epic name' }), controls.epicName]),
      node('label', { className: 'field' }, [node('span', { text: 'Mapping status' }), controls.status]),
      node('label', { className: 'field' }, [node('span', { text: 'How this mapping was confirmed' }), controls.provenance])
    ]);
  }

  function jiraEpicSettingsCard(initiatives, mappings) {
    const activeInitiatives = workflowModule.initiativeChoices(initiatives, 'jira-epic-parent');
    const initiativeSelect = node('select', {}, activeInitiatives.map(initiative => option(initiative.id, initiative.name)));
    const createControls = jiraMappingControls();
    return node('section', { className: 'card settings-card' }, [
      node('h3', { text: 'Jira Epic mappings' }),
      node('p', { className: 'notice', text: 'This creates or updates a Priorena mapping only. It does not create or modify anything in Jira.' }),
      node('p', { className: 'meta', text: 'Jira Epic mappings are independent integration records. Metadata and status never rename an Initiative or Workstream.' }),
      node('label', { className: 'field' }, [node('span', { text: 'Parent Initiative' }), initiativeSelect]),
      jiraMappingFields(createControls),
      node('button', { className: 'button primary', type: 'button', text: 'Create Jira Epic mapping', disabled: activeInitiatives.length === 0, on: { click: () => createJiraMappingFromSettings(initiativeSelect.value, createControls) } }),
      recordList(mappings, mapping => [
        node('strong', { text: `${mapping.jiraEpicKey} — ${mapping.jiraEpicName}` }),
        node('p', { className: 'meta', text: `Stable ID: ${mapping.id} · Initiative: ${initiativeName(mapping.initiativeId)} · Project: ${mapping.jiraProjectKey} · Status: ${mapping.mappingStatus} · Verified: ${mapping.verifiedAt || 'Not verified'}` }),
        node('details', { className: 'inline-editor' }, [
          node('summary', { className: 'button secondary', text: 'Edit mapping' }),
          (() => {
            const controls = jiraMappingControls(mapping);
            return node('div', {}, [
              jiraMappingFields(controls),
              node('button', { className: 'button secondary', type: 'button', text: 'Save mapping', on: { click: () => updateJiraMappingFromSettings(mapping, controls) } })
            ]);
          })()
        ])
      ], 'No Jira Epic mappings have been added. Mappings are optional local references and do not create anything in Jira.')
    ]);
  }

  function settingsGroup(id, title, description, children) {
    const headingId = `${id}-title`;
    return node('section', { className: 'settings-group', attrs: { id, 'aria-labelledby': headingId } }, [
      node('div', { className: 'settings-group-heading' }, [
        node('h2', { id: headingId, text: title }),
        node('p', { text: description })
      ]),
      node('div', { className: 'settings-card-grid' }, children)
    ]);
  }

  function renderSettings() {
    const initiatives = state.workflow?.initiatives || [];
    const workstreams = state.workflow?.workstreams || [];
    const jiraEpicMappings = state.workflow?.jiraEpicMappings || [];
    const organization = selectedOrganization();
    const workspace = selectedWorkspace();
    const organizationRoute = `/api/v2/organizations/${encoded(organization.id)}`;
    const workspaceRoute = `${organizationRoute}/workspaces/${encoded(workspace.id)}`;
    const settingsNavigation = node('nav', { className: 'settings-navigation', attrs: { 'aria-label': 'Settings sections' } }, [
      node('a', { text: 'Structure', attrs: { href: '#settings-structure' } }),
      node('a', { text: 'Behavior and drafting', attrs: { href: '#settings-behavior-drafting' } }),
      node('a', { text: 'Data and privacy', attrs: { href: '#settings-data-privacy' } })
    ]);
    const firstUseGuide = node('aside', { className: 'panel first-use-guide', attrs: { 'aria-labelledby': 'structure-guide-title' } }, [
      node('h2', { id: 'structure-guide-title', text: 'Set up your delivery structure' }),
      node('ol', {}, [
        node('li', { text: 'Name your Organization and Workspace.' }),
        node('li', { text: 'Create or rename Initiatives.' }),
        node('li', { text: 'Add optional Workstreams.' }),
        node('li', { text: 'Add local Jira Epic mappings when needed.' })
      ]),
      node('p', { className: 'notice', text: 'Workstreams and Jira Epic mappings are optional and independent. A Work Item may use either, both, or neither under an Initiative.' })
    ]);
    const structure = settingsGroup(
      'settings-structure',
      'Structure',
      'Manage the Organization, Workspace, Initiatives, and optional delivery groupings used in this Workspace.',
      [
        node('section', { className: 'card settings-card' }, [
          node('h3', { text: 'Current context' }),
          node('p', { text: `${organization.name} · ${workspace.name}` }),
          node('p', { className: 'meta', text: 'Priorena remembers this selection and checks that the Workspace still belongs to the Organization.' })
        ]),
        node('section', { className: 'card settings-card' }, [
          node('h3', { text: 'Organization' }),
          node('p', { text: organization?.name || 'Organization required' }),
          node('p', { className: 'meta', text: 'Only Organization-wide settings belong here.' }),
          renameControl('Organization', organization.name, organizationRoute, body => { organization.name = body.organization.name; })
        ]),
        node('section', { className: 'card settings-card' }, [
          node('h3', { text: 'Workspace' }),
          node('p', { text: workspace?.name || 'Workspace required' }),
          node('p', { className: 'meta', text: 'Sprint terms, behavior thresholds, and drafting guidance stay with this Workspace.' }),
          renameControl('Workspace', workspace.name, workspaceRoute, body => { workspace.name = body.workspace.name; })
        ]),
        initiativeSettingsCard(initiatives, workspaceRoute, workspace),
        workstreamSettingsCard(initiatives, workstreams),
        jiraEpicSettingsCard(initiatives, jiraEpicMappings)
      ]
    );
    const behaviorAndDrafting = settingsGroup(
      'settings-behavior-drafting',
      'Behavior and drafting',
      'Review Workspace behavior and optional drafting assistance.',
      [
        node('section', { className: 'card settings-card' }, [
          node('h3', { text: 'Behavior' }),
          node('p', { text: 'Status and milestone rules are consistent across this Workspace. Supported thresholds remain Workspace-specific.' })
        ]),
        node('section', { className: 'card settings-card' }, [
          node('h3', { text: 'AI — Advanced' }),
          node('p', { text: 'AI drafting is off. You can still prepare, review, and copy Briefings without it.' })
        ])
      ]
    );
    const dataAndPrivacy = settingsGroup(
      'settings-data-privacy',
      'Data and privacy',
      'Review where Priorena data stays and what the application does not send.',
      [
        node('section', { className: 'card settings-card' }, [
          node('h3', { text: 'Data & Privacy' }),
          node('p', { text: 'Your Priorena data stays in the selected local data file. Priorena does not send analytics or telemetry.' }),
          node('p', { className: 'meta', text: 'Priorena runs only on this computer, keeps Organizations separate, and never publishes or communicates automatically.' })
        ])
      ]
    );
    elements.view.replaceChildren(settingsNavigation, firstUseGuide, structure, behaviorAndDrafting, dataAndPrivacy);
  }

  async function renderActiveView() {
    const generation = ++state.generation;
    setPageHeader();
    showLoading();
    try {
      if (state.activeView === 'portfolio') await renderPortfolio();
      else if (state.activeView === 'today') await renderToday();
      else if (state.activeView === 'search') renderSearch();
      else if (state.activeView === 'briefings') await renderBriefings();
      else {
        if (state.activeView === 'work-items') {
          await ensureWorkflow(false);
          if (generation !== state.generation) return;
          if (!state.triage.collection) await loadTriageCollection();
          if (generation !== state.generation) return;
          state.initiativeFilter = state.triage.query.initiativeId;
          renderWorkItems();
        } else {
          await ensureWorkflow();
          if (generation !== state.generation) return;
          if (state.activeView === 'follow-up') renderFollowUp();
          if (state.activeView === 'milestones') renderMilestones();
          if (state.activeView === 'add-source') elements.view.replaceChildren(sourceForm());
          if (state.activeView === 'import-feed') await renderImportFeed();
          if (state.activeView === 'source-library') renderSourceLibrary();
          if (state.activeView === 'review') await renderReview();
          if (state.activeView === 'settings') renderSettings();
        }
      }
      if (generation === state.generation) setStatus(`${pageDefinitions[state.activeView][0]} loaded.`, 'success');
    } catch (error) {
      if (generation !== state.generation) return;
      clearOperationalUi('The requested page could not be loaded.');
      setStatus(error.message, 'error');
    }
  }

  async function selectOrganization(organizationId) {
    stableId(organizationId);
    const generation = ++state.generation;
    cancelOpenConfirmation();
    state.context = null;
    state.workflow = null;
    clearTriageData();
    clearImportFeedData();
    clearEvidenceReviewData();
    clearBriefingData();
    elements.workspace.disabled = true;
    clearOperationalUi('Loading the selected Organization…');
    setStatus('Validating Organization and Workspace context…');
    const savedWorkspaceId = localStorage.getItem(`priorena.target.workspace.${organizationId}`);
    let snapshot;
    try {
      snapshot = await contextController.selectOrganization(organizationId, { savedWorkspaceId });
    } catch (error) {
      if (generation !== state.generation) return;
      throw error;
    }
    if (generation !== state.generation) return;
    if (snapshot.error && savedWorkspaceId) {
      localStorage.removeItem(`priorena.target.workspace.${organizationId}`);
      try {
        snapshot = await contextController.selectOrganization(organizationId);
      } catch (error) {
        if (generation !== state.generation) return;
        throw error;
      }
      if (generation !== state.generation) return;
    }
    if (!snapshot.activeWorkspaceId && snapshot.workspaces.length) {
      try {
        snapshot = await contextController.selectWorkspace(snapshot.workspaces[0].id);
      } catch (error) {
        if (generation !== state.generation) return;
        throw error;
      }
      if (generation !== state.generation) return;
    }
    state.context = snapshot;
    fillOrganizations();
    fillWorkspaces();
    if (snapshot.error) throw new Error(snapshot.error);
    localStorage.setItem('priorena.target.organization', organizationId);
    if (snapshot.activeWorkspaceId) localStorage.setItem(`priorena.target.workspace.${organizationId}`, snapshot.activeWorkspaceId);
    await renderActiveView();
  }

  async function selectWorkspace(workspaceId) {
    stableId(workspaceId);
    const generation = ++state.generation;
    cancelOpenConfirmation();
    state.workflow = null;
    clearTriageData();
    clearImportFeedData();
    clearEvidenceReviewData();
    clearBriefingData();
    state.selectedWorkItemIds.clear();
    clearOperationalUi('Loading the selected Workspace…');
    setStatus('Validating Workspace context…');
    let snapshot;
    try {
      snapshot = await contextController.selectWorkspace(workspaceId);
    } catch (error) {
      if (generation !== state.generation) return;
      throw error;
    }
    if (generation !== state.generation) return;
    state.context = snapshot;
    fillWorkspaces();
    if (snapshot.error) throw new Error(snapshot.error);
    localStorage.setItem(`priorena.target.workspace.${snapshot.activeOrganizationId}`, workspaceId);
    await renderActiveView();
  }

  function confirmAction(title, content, confirmLabel) {
    const returnFocus = document.activeElement;
    elements.dialogTitle.textContent = title;
    elements.dialogDescription.replaceChildren(...content);
    elements.dialogConfirm.textContent = confirmLabel;
    elements.dialog.returnValue = 'cancel';
    elements.dialog.showModal();
    elements.dialogConfirm.focus();
    return new Promise(resolve => {
      elements.dialog.addEventListener('close', () => {
        if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
        resolve(elements.dialog.returnValue === 'confirm');
      }, { once: true });
    });
  }

  async function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    elements.initialize.disabled = true;
    elements.initialize.textContent = 'Opening…';
    try {
      const result = await requestJson('/api/v2/organizations');
      state.organizations = result.body.organizations || [];
      elements.start.hidden = true;
      elements.shell.hidden = false;
      fillOrganizations();
      if (!state.organizations.length) {
        clearOperationalUi('No Organizations are available in this local data file.');
        setStatus('No Organization context is available.', 'error');
        return;
      }
      const savedOrganizationId = localStorage.getItem('priorena.target.organization');
      const organizationId = state.organizations.some(item => item.id === savedOrganizationId)
        ? savedOrganizationId
        : state.organizations[0].id;
      await selectOrganization(organizationId);
      elements.main.focus();
    } catch (error) {
      state.initialized = false;
      elements.initialize.disabled = false;
      elements.initialize.textContent = 'Try opening again';
      const message = node('p', { className: 'risk', text: error.message });
      elements.start.querySelector('.start-card').append(message);
    }
  }

  elements.initialize.addEventListener('click', initialize);
  elements.organization.addEventListener('change', event => selectOrganization(event.target.value).catch(error => setStatus(error.message, 'error')));
  elements.workspace.addEventListener('change', event => selectWorkspace(event.target.value).catch(error => setStatus(error.message, 'error')));
  elements.navigation.addEventListener('click', event => {
    const button = event.target.closest('button[data-view]');
    if (!button) return;
    activateView(button.dataset.view);
  });
  elements.dialogCancel.addEventListener('click', () => { elements.dialog.returnValue = 'cancel'; });
  elements.dialogConfirm.addEventListener('click', () => { elements.dialog.returnValue = 'confirm'; });
}());
