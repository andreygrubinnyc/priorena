'use strict';

(function targetApplication() {
  const contextModule = window.PriorenaTargetContext;
  const workflowModule = window.PriorenaTargetWorkflow;
  const importFeedModule = window.PriorenaTargetImportFeed;
  const briefingModule = window.PriorenaTargetBriefing;
  if (!contextModule || !workflowModule || !importFeedModule || !briefingModule) throw new Error('Target state modules are unavailable');

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
    'work-items': ['Work Items', 'Review independent Initiative, Workstream, and Jira Epic associations.'],
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
    importFeed: importFeedModule.createImportFeedState(),
    generation: 0
  };

  function clearImportFeedData() {
    state.importFeed = importFeedModule.createImportFeedState();
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

  async function loadWorkflow() {
    const organizationId = state.context?.activeOrganizationId;
    const workspaceId = state.context?.activeWorkspaceId;
    if (!organizationId || !workspaceId) throw new Error('A Workspace is required');
    const generation = state.generation;
    const payload = await workflowApi.loadWorkspace(organizationId, workspaceId);
    if (generation !== state.generation) return null;
    workflowModule.validateWorkspacePayload(payload, organizationId, workspaceId);
    state.workflow = payload;
    return payload;
  }

  async function ensureWorkflow() {
    return state.workflow || loadWorkflow();
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

  function visibleWorkItems() {
    const items = state.workflow?.workItems || [];
    return items.filter(item => {
      const initiativeMatches = state.initiativeFilter === 'all' ||
        (state.initiativeFilter === 'unassigned' ? item.initiativeId === null : item.initiativeId === state.initiativeFilter);
      const workstreamMatches = state.workstreamFilter === 'all' ||
        (state.workstreamFilter === 'none' ? item.workstreamId === null : item.workstreamId === state.workstreamFilter);
      const jiraEpicMatches = state.jiraEpicFilter === 'all' ||
        (state.jiraEpicFilter === 'none'
          ? item.jiraEpicMappingId === null
          : item.jiraEpicMappingId === state.jiraEpicFilter);
      const typeMatches = state.itemTypeFilter === 'all' || item.itemType === state.itemTypeFilter;
      return initiativeMatches && workstreamMatches && jiraEpicMatches && typeMatches;
    });
  }

  function initiativeFilterControl(renderFilteredView = renderWorkItems) {
    const select = node('select', {
      id: 'initiative-filter',
      on: { change: event => {
        state.initiativeFilter = event.target.value;
        if (state.initiativeFilter === 'unassigned' || (state.workstreamFilter !== 'all' && state.workstreamFilter !== 'none' &&
          state.workflow?.workstreams?.find(workstream => workstream.id === state.workstreamFilter)?.initiativeId !== state.initiativeFilter && state.initiativeFilter !== 'all')) {
          state.workstreamFilter = 'all';
        }
        if (state.initiativeFilter === 'unassigned' || (state.jiraEpicFilter !== 'all' && state.jiraEpicFilter !== 'none' &&
          state.workflow?.jiraEpicMappings?.find(mapping => mapping.id === state.jiraEpicFilter)?.initiativeId !== state.initiativeFilter && state.initiativeFilter !== 'all')) {
          state.jiraEpicFilter = 'all';
        }
        state.selectedWorkItemIds.clear();
        updateBreadcrumb();
        renderFilteredView();
      } }
    }, [
      option('all', 'All initiatives', state.initiativeFilter === 'all'),
      option('unassigned', 'Unassigned', state.initiativeFilter === 'unassigned'),
      ...workflowModule.initiativeChoices(state.workflow?.initiatives || [], 'work-item-filter')
        .map(initiative => option(initiative.id, initiative.name, state.initiativeFilter === initiative.id))
    ]);
    return node('label', {}, [node('span', { text: 'Initiative' }), select]);
  }

  function workstreamFilterControl() {
    const workstreams = (state.workflow?.workstreams || []).filter(workstream => state.initiativeFilter === 'all' || workstream.initiativeId === state.initiativeFilter);
    const select = node('select', {
      id: 'workstream-filter',
      on: { change: event => {
        state.workstreamFilter = event.target.value;
        state.selectedWorkItemIds.clear();
        renderWorkItems();
      } }
    }, [
      option('all', 'All Workstreams', state.workstreamFilter === 'all'),
      option('none', 'No Workstream', state.workstreamFilter === 'none'),
      ...workstreams.map(workstream => option(workstream.id, workstreamOptionLabel(workstream), state.workstreamFilter === workstream.id))
    ]);
    return node('label', {}, [node('span', { text: 'Workstream' }), select]);
  }

  function jiraEpicFilterControl() {
    const mappings = (state.workflow?.jiraEpicMappings || [])
      .filter(mapping => state.initiativeFilter === 'all' || mapping.initiativeId === state.initiativeFilter);
    const select = node('select', {
      id: 'jira-epic-filter',
      on: { change: event => {
        state.jiraEpicFilter = event.target.value;
        state.selectedWorkItemIds.clear();
        renderWorkItems();
      } }
    }, [
      option('all', 'All Jira Epics', state.jiraEpicFilter === 'all'),
      option('none', 'No Jira Epic', state.jiraEpicFilter === 'none'),
      ...mappings.map(mapping => option(mapping.id, jiraEpicOptionLabel(mapping), state.jiraEpicFilter === mapping.id))
    ]);
    return node('label', {}, [node('span', { text: 'Jira Epic' }), select]);
  }

  function itemTypeFilterControl() {
    const select = node('select', {
      id: 'item-type-filter',
      on: { change: event => {
        state.itemTypeFilter = event.target.value;
        state.selectedWorkItemIds.clear();
        renderWorkItems();
      } }
    }, ['all', 'Story', 'Task', 'Bug', 'Other', 'Unknown'].map(value => option(value, value === 'all' ? 'All Work Item types' : value, state.itemTypeFilter === value)));
    return node('label', {}, [node('span', { text: 'Type' }), select]);
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
      await loadWorkflow();
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
    return state.initiativeFilter !== 'all' || state.workstreamFilter !== 'all' ||
      state.jiraEpicFilter !== 'all' || state.itemTypeFilter !== 'all';
  }

  function clearWorkItemFilters() {
    const reset = workflowModule.defaultWorkItemUiState();
    state.initiativeFilter = reset.filters.initiativeId;
    state.workstreamFilter = reset.filters.workstreamId;
    state.jiraEpicFilter = reset.filters.jiraEpicMappingId;
    state.itemTypeFilter = reset.filters.itemType;
    state.selectedWorkItemIds.clear();
    updateBreadcrumb();
    renderWorkItems();
    setStatus('Work Item filters cleared.', 'success');
  }

  function renderWorkItems() {
    const assignment = node('select', { id: 'initiative-assignment' }, [
      option('unassigned', 'Unassigned'),
      ...workflowModule.initiativeChoices(state.workflow?.initiatives || [], 'bulk-assignment')
        .map(initiative => option(initiative.id, initiative.name))
    ]);
    const workstreamAssignment = node('select', { id: 'workstream-assignment' });
    const jiraEpicAssignment = node('select', { id: 'jira-epic-assignment' });
    const selectedCount = node('strong', { className: 'selected-count', attrs: { id: 'selected-work-item-count' } });
    const helper = node('p', {
      className: 'meta bulk-helper',
      text: 'Select one or more Work Items to change their associations.',
      attrs: { id: 'bulk-assignment-help' }
    });
    const previewButton = node('button', {
      className: 'button primary',
      type: 'button',
      text: 'Preview changes',
      attrs: { 'aria-describedby': 'bulk-assignment-help' },
      on: { click: () => previewInitiativeAssignment(assignment.value, workstreamAssignment.value, jiraEpicAssignment.value) }
    });
    const refreshBulkAvailability = () => {
      const controls = workflowModule.workItemControlState([...state.selectedWorkItemIds], assignment.value);
      selectedCount.textContent = controls.selectedCountLabel;
      assignment.disabled = controls.initiativeDisabled;
      workstreamAssignment.disabled = controls.workstreamDisabled;
      jiraEpicAssignment.disabled = controls.jiraEpicDisabled;
      previewButton.disabled = controls.previewDisabled;
      helper.hidden = !controls.helperVisible;
    };
    const refreshRelationshipAssignments = () => {
      const initiativeId = assignment.value;
      workstreamAssignment.replaceChildren(
        option(initiativeId === 'unassigned' ? 'none' : 'keep', initiativeId === 'unassigned' ? 'No Workstream' : 'Keep compatible Workstream'),
        ...(initiativeId === 'unassigned' ? [] : [option('none', 'No Workstream')]),
        ...(state.workflow?.workstreams || []).filter(workstream => workstream.initiativeId === initiativeId).map(workstream => option(workstream.id, workstreamOptionLabel(workstream)))
      );
      jiraEpicAssignment.replaceChildren(
        option(initiativeId === 'unassigned' ? 'none' : 'keep', initiativeId === 'unassigned' ? 'No Jira Epic' : 'Keep compatible Jira Epic'),
        ...(initiativeId === 'unassigned' ? [] : [option('none', 'No Jira Epic')]),
        ...(state.workflow?.jiraEpicMappings || [])
          .filter(mapping => mapping.initiativeId === initiativeId)
          .map(mapping => option(mapping.id, jiraEpicOptionLabel(mapping)))
      );
      refreshBulkAvailability();
    };
    assignment.addEventListener('change', refreshRelationshipAssignments);
    refreshRelationshipAssignments();
    const items = visibleWorkItems();
    const totalWorkItems = state.workflow?.workItems?.length || 0;
    const emptyState = workflowModule.workItemEmptyState(totalWorkItems, items.length);
    const filterGroup = node('fieldset', { className: 'control-group filters-group' }, [
      node('legend', { text: 'Filters' }),
      node('div', { className: 'control-grid' }, [
        initiativeFilterControl(),
        workstreamFilterControl(),
        jiraEpicFilterControl(),
        itemTypeFilterControl()
      ]),
      node('button', {
        className: 'button secondary',
        type: 'button',
        text: 'Clear filters',
        disabled: !workItemFiltersActive(),
        on: { click: clearWorkItemFilters }
      })
    ]);
    const bulkGroup = node('fieldset', { className: 'control-group bulk-assignment-group', attrs: { 'aria-describedby': 'bulk-assignment-help' } }, [
      node('legend', { text: 'Bulk assignment' }),
      selectedCount,
      helper,
      node('div', { className: 'control-grid' }, [
        node('label', {}, [node('span', { text: 'Initiative' }), assignment]),
        node('label', {}, [node('span', { text: 'Workstream' }), workstreamAssignment]),
        node('label', {}, [node('span', { text: 'Jira Epic' }), jiraEpicAssignment])
      ]),
      previewButton
    ]);
    let resultContent;
    if (emptyState === 'no-data') {
      resultContent = node('section', { className: 'empty empty-state', attrs: { 'aria-labelledby': 'no-work-items-title' } }, [
        node('h2', { id: 'no-work-items-title', text: 'No Work Items have been added to this Workspace yet.' }),
        node('p', { text: 'Add and review source material to begin building the delivery view.' }),
        node('div', { className: 'empty-actions' }, [
          node('button', { className: 'button primary', type: 'button', text: 'Add Source', on: { click: () => activateView('add-source') } })
        ])
      ]);
    } else if (emptyState === 'filtered-no-results') {
      resultContent = node('section', { className: 'empty empty-state', attrs: { 'aria-labelledby': 'filtered-work-items-title' } }, [
        node('h2', { id: 'filtered-work-items-title', text: 'No Work Items match the current filters.' }),
        node('p', { text: 'Clear or change the filters to see more work.' }),
        node('div', { className: 'empty-actions' }, [
          node('button', { className: 'button secondary', type: 'button', text: 'Clear filters', on: { click: clearWorkItemFilters } })
        ])
      ]);
    } else {
      resultContent = recordList(items, item => {
        const checkbox = node('input', {
          type: 'checkbox',
          checked: state.selectedWorkItemIds.has(item.id),
          attrs: { 'aria-label': `Select Work Item ${item.summary}` },
          on: { change: event => {
            if (event.target.checked) state.selectedWorkItemIds.add(item.id);
            else state.selectedWorkItemIds.delete(item.id);
            refreshBulkAvailability();
          } }
        });
        return [
          node('div', { className: 'row-head' }, [node('span', {}, [checkbox, ' ', node('strong', { text: item.summary })]), node('span', {}, [badge(item.initiative?.name || 'Unassigned'), ' ', badge(item.workstream?.name || 'No Workstream'), ' ', badge(item.jiraEpic ? `${item.jiraEpic.jiraEpicKey} · ${item.jiraEpic.mappingStatus}` : 'No Jira Epic')])]),
          node('p', { className: 'meta', text: `${item.itemType} · ${item.canonicalStatus} · ${item.assignee || 'No assignee captured'} · Workstream: ${item.workstream?.name || 'No Workstream'} · Jira Epic: ${item.jiraEpic ? `${item.jiraEpic.jiraEpicKey} — ${item.jiraEpic.jiraEpicName} (${item.jiraEpic.mappingStatus})` : 'No Jira Epic'} · Work Item Jira key: ${item.workItemJiraKey || 'None'}` }),
          node('p', { className: 'meta', text: `How this status was confirmed: ${item.currentStateProvenance}` })
        ];
      }, 'No Work Items are available.');
    }
    elements.view.replaceChildren(filterGroup, bulkGroup, resultContent);
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
    state.importFeed.outcome = null;
    state.importFeed.applying = false;
    elements.view.querySelectorAll('.import-review-panel, .import-final-panel').forEach(element => element.remove());
  }

  function invalidateImportFinalPreview() {
    state.importFeed.finalPreview = null;
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
    state.importFeed.rowDrafts = new Map(preview.reviewRows.map(row => [row.recordIndex, {
      includeRecord: false,
      createWorkItem: false,
      approvedItemType: 'Story',
      approvedSummary: row.sourceSummary || '',
      approvedDescription: row.sourceDescription || '',
      initiativeId: row.match?.initiativeId || '',
      workstreamId: row.match?.workstreamId || '',
      jiraEpicMappingId: row.match?.jiraEpicMappingId || '',
      includeFinding: false
    }]));
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
    const drafts = state.importFeed.rowDrafts;
    const duplicate = preview.reviewRows.filter(row => row.duplicateReasons.length > 0).length;
    const blocked = preview.reviewRows.filter(row => !row.supportedForApply).length;
    const selected = preview.reviewRows.filter(row => drafts.get(row.recordIndex)?.includeRecord).length;
    return { valid: preview.reviewRows.length - blocked, duplicate, blocked, selected, unselected: preview.reviewRows.length - selected };
  }

  function importNameFor(collection, id, emptyLabel) {
    if (!id) return emptyLabel;
    const item = state.importFeed.capabilities?.[collection]?.find(candidate => candidate.id === id);
    if (!item) return 'Unavailable';
    if (collection === 'jiraEpicMappings') return `${item.jiraEpicKey} — ${item.jiraEpicName}`;
    return item.name;
  }

  function reviewRowState(row, draft) {
    if (!row.supportedForApply) return 'blocked';
    if (!draft.includeRecord) return row.duplicateReasons.length ? 'needs review' : 'excluded';
    if (row.match === null && !draft.createWorkItem && !(draft.includeFinding && row.findingAvailable)) return 'needs review';
    return 'approved for final preview';
  }

  function importReviewRow(row) {
    const draft = state.importFeed.rowDrafts.get(row.recordIndex);
    const capabilities = state.importFeed.capabilities;
    const include = node('input', {
      type: 'checkbox',
      checked: draft.includeRecord,
      disabled: !row.supportedForApply,
      attrs: { 'aria-label': `Include record ${row.recordIndex + 1}` }
    });
    const create = node('input', {
      type: 'checkbox',
      checked: draft.createWorkItem,
      disabled: !draft.includeRecord || row.match !== null,
      attrs: { 'aria-label': `Create Work Item for record ${row.recordIndex + 1}` }
    });
    const itemType = node('select', { disabled: !draft.includeRecord || !draft.createWorkItem, attrs: { 'aria-label': `Work Item type for record ${row.recordIndex + 1}` } },
      capabilities.itemTypes.map(value => option(value, value, value === draft.approvedItemType)));
    const summary = node('input', { value: draft.approvedSummary, disabled: !draft.includeRecord || !draft.createWorkItem, attrs: { maxlength: '1000', 'aria-label': `Approved summary for record ${row.recordIndex + 1}` } });
    const description = node('textarea', { value: draft.approvedDescription, disabled: !draft.includeRecord || !draft.createWorkItem, attrs: { maxlength: '4000', rows: '3', 'aria-label': `Approved description for record ${row.recordIndex + 1}` } });
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
    [[itemType, 'approvedItemType'], [summary, 'approvedSummary'], [description, 'approvedDescription']].forEach(([control, key]) => {
      control.addEventListener('input', () => { draft[key] = control.value; invalidateImportFinalPreview(); });
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
    finding.addEventListener('change', () => { draft.includeFinding = finding.checked; invalidateImportFinalPreview(); });

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

    return node('li', { className: 'list-item import-review-row' }, [
      node('div', { className: 'row-head' }, [
        node('span', {}, [include, ' ', node('strong', { text: `Record ${row.recordIndex + 1} · ${row.externalKey || 'No external key'}` })]),
        badge(reviewRowState(row, draft), row.supportedForApply ? '' : 'risk-badge')
      ]),
      node('div', { className: 'import-current-grid' }, [
        node('section', {}, [
          node('h3', { text: 'Feed suggestion' }),
          node('p', { text: row.sourceSummary || 'No summary supplied' }),
          node('p', { className: 'meta', text: `Type suggestion: ${row.sourceItemType} · Status suggestion: ${row.sourceCanonicalStatus || 'None'} · Jira Epic suggestion: ${row.noEpic === true ? 'Explicitly no Epic' : (row.sourceJiraEpicKey ? `${row.sourceJiraProjectKey} / ${row.sourceJiraEpicKey}` : 'None')}` }),
          row.evidenceExcerpt ? node('blockquote', { text: row.evidenceExcerpt }) : node('p', { className: 'meta', text: 'No pending Finding excerpt supplied.' })
        ]),
        node('section', {}, [
          node('h3', { text: row.match ? 'Current exact local match' : 'New Work Item candidate' }),
          row.match
            ? node('p', { text: `${row.match.summary} · ${row.match.itemType} · ${row.match.canonicalStatus}` })
            : node('p', { text: draft.createWorkItem
              ? `New ${draft.approvedItemType} creation is selected with the reviewed summary below.`
              : 'No exact external-identity match. Creation remains unselected.' }),
          node('p', { className: 'meta', text: row.match
            ? `Initiative: ${importNameFor('initiatives', row.match.initiativeId, 'Unassigned')} · Workstream: ${importNameFor('workstreams', row.match.workstreamId, 'No Workstream')} · Jira Epic: ${importNameFor('jiraEpicMappings', row.match.jiraEpicMappingId, 'No Jira Epic')}`
            : 'No title or proximity matching was attempted.' })
        ])
      ]),
      ...warnings.map(text => node('p', { className: 'warning', text })),
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
    const type = node('select', { attrs: { 'aria-label': 'Bulk creation type' } }, capabilities.itemTypes.map(value => option(value, value, value === 'Story')));
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
    return node('fieldset', { className: 'control-group import-bulk-controls' }, [
      node('legend', { text: 'Bounded bulk review' }),
      node('p', { className: 'meta', text: 'Bulk actions affect at most the 100 validated rows and remain reversible before final preview.' }),
      node('div', { className: 'actions' }, [
        node('button', { className: 'button secondary', type: 'button', text: 'Select eligible new Work Items', on: { click: () => applyBulkToImportDrafts((row, draft) => {
          if (!row.supportedForApply || row.match !== null || row.duplicateReasons.length > 0) return;
          draft.includeRecord = true;
          draft.createWorkItem = true;
          draft.approvedItemType = type.value;
        }) } }),
        type,
        node('button', { className: 'button secondary', type: 'button', text: 'Set selected creation type', on: { click: () => applyBulkToImportDrafts((row, draft) => {
          if (draft.includeRecord && row.match === null && draft.createWorkItem) draft.approvedItemType = type.value;
        }) } })
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

  function importReviewPanel() {
    const preview = state.importFeed.validationPreview;
    const counts = importReviewCounts(preview);
    const rowFilter = node('select', { attrs: { 'aria-label': 'Filter import review rows' } }, [
      option('all', 'All records', state.importFeed.rowFilter === 'all'),
      option('eligible', 'Eligible without duplicate warnings', state.importFeed.rowFilter === 'eligible'),
      option('needs-review', 'Needs review', state.importFeed.rowFilter === 'needs-review'),
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
      const rowState = reviewRowState(row, draft);
      if (state.importFeed.rowFilter === 'all') return true;
      if (state.importFeed.rowFilter === 'eligible') return row.supportedForApply && row.duplicateReasons.length === 0;
      if (state.importFeed.rowFilter === 'needs-review') return rowState === 'needs review';
      if (state.importFeed.rowFilter === 'blocked') return rowState === 'blocked';
      if (state.importFeed.rowFilter === 'selected') return draft.includeRecord;
      return rowState === 'excluded';
    });
    const includeSource = node('input', { type: 'checkbox', checked: state.importFeed.includeSource, attrs: { 'aria-label': 'Create local Source from reviewed feed' } });
    includeSource.addEventListener('change', () => {
      state.importFeed.includeSource = includeSource.checked;
      invalidateImportFinalPreview();
    });
    return node('section', { className: 'panel import-review-panel' }, [
      node('p', { className: 'eyebrow', text: 'Stages 2–3 · Validate and review' }),
      node('h2', { text: 'Review every record and local relationship' }),
      node('p', { className: 'notice', text: 'Validation and preview have not changed Priorena data.' }),
      node('p', { text: `Input: ${state.importFeed.filename || 'Paste'} · ${preview.format} · ${preview.source.contentBytes} bytes · ${preview.reviewRows.length} records · contract target-v4.` }),
      node('p', { className: 'meta', text: `Workspace: ${selectedWorkspace()?.name || preview.workspaceId} · persisted revision ${preview.expectedRevision}` }),
      node('div', { className: 'metric-grid import-metrics' }, [
        metric('Valid', counts.valid), metric('Duplicate review', counts.duplicate), metric('Blocked', counts.blocked), metric('Selected', counts.selected), metric('Unselected', counts.unselected)
      ]),
      node('label', { className: 'source-selection' }, [includeSource, ' Create one local Source containing the normalized feed text']),
      importBulkReview(),
      node('div', { className: 'filters' }, [node('label', {}, [node('span', { text: 'Record filter' }), rowFilter])]),
      visibleRows.length
        ? node('ul', { className: 'list import-review-list' }, visibleRows.map(importReviewRow))
        : empty('No import records match this review filter.'),
      node('div', { className: 'actions' }, [
        node('button', { className: 'button primary', type: 'button', text: 'Run final write-free preview', on: { click: previewReviewedImport } }),
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
      await renderImportFeed();
      setStatus('Final preview is ready. No Priorena data has changed.', 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      state.importFeed.finalPreview = null;
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
    return node('section', { className: 'panel import-final-panel' }, [
      node('p', { className: 'eyebrow', text: 'Stage 4 · Confirm and apply' }),
      node('h2', { text: 'Final server preview' }),
      node('p', { className: 'notice', text: 'This exact preview is still write-free. Apply will rebuild it against the same revision and fail closed if anything differs.' }),
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
      node('button', { className: 'button primary', type: 'button', text: state.importFeed.applying ? 'Applying reviewed import…' : 'Apply reviewed import', disabled: state.importFeed.applying, on: { click: applyReviewedImport } })
    ]);
  }

  async function applyReviewedImport() {
    const token = workspaceOperationToken();
    const preview = state.importFeed.finalPreview;
    if (!preview || state.importFeed.applying) return;
    const summary = importFeedModule.summarizeFinalPreview(preview);
    const approved = await confirmAction('Apply reviewed import', [
      node('p', { text: `${summary.sources} Source · ${summary.newWorkItems} new Work Items · ${summary.relationshipChanges} existing or new relationship changes` }),
      node('p', { text: `${summary.pendingFindings} pending Findings · ${summary.deferredCurrentStateChanges} deferred current-state changes · ${summary.excludedRows} excluded rows · ${summary.blockedRows} blocked rows` }),
      node('p', { text: `${summary.evidenceReassociations} existing Evidence association${summary.evidenceReassociations === 1 ? '' : 's'} will change.` }),
      ...preview.proposals.filter(proposal => proposal.type === 'work-item-assign').flatMap(proposal =>
        proposal.payload.evidenceChanges.map(change => node('p', { className: 'meta', text: `${change.evidenceId}: ${change.beforeInitiativeId || 'Unassigned'} → ${change.afterInitiativeId || 'Unassigned'}` }))),
      node('p', { className: 'notice', text: 'This is one atomic local write. Findings remain pending. Nothing is written to Jira and nothing is communicated.' })
    ], 'Apply reviewed import');
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
      await loadWorkflow();
      if (!workspaceOperationCurrent(token)) return;
      await renderImportFeed();
      setStatus('Reviewed import applied atomically. Pending Findings still require separate review.', 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      state.importFeed.finalPreview = null;
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

  function renderSourceLibrary() {
    elements.view.replaceChildren(
      node('p', { className: 'notice', text: 'Source lists show safe metadata only. Full Source content is returned only for an explicitly selected Source.' }),
      recordList(state.workflow?.sources || [], source => [
        node('div', { className: 'row-head' }, [node('strong', { text: source.title }), badge(source.processingState)]),
        node('p', { className: 'meta', text: `${source.type} · ${source.date}` }),
        node('p', { text: `How this Source was added: ${source.provenance}` })
      ], 'No Sources have been added to this Workspace.')
    );
  }

  async function reviewFinding(finding, decision) {
    const token = workspaceOperationToken();
    const revision = state.workflow.revision;
    const approved = await confirmAction(
      `${decision === 'accept' ? 'Accept Finding as Evidence' : 'Reject Finding'}`,
      [
        node('p', { text: finding.exactExcerpt }),
        node('p', { className: 'notice', text: decision === 'accept'
          ? 'Acceptance creates historical Evidence. It does not modify Work Item current state.'
          : 'Rejection creates no Evidence and does not modify Work Item current state.' })
      ],
      decision === 'accept' ? 'Accept Finding' : 'Reject Finding'
    );
    if (!approved || !workspaceOperationCurrent(token)) return;
    try {
      await requestJson(`/api/v2/organizations/${encoded(token.organizationId)}/workspaces/${encoded(token.workspaceId)}/findings/${encoded(finding.id)}/review`, mutationOptions({
        expectedRevision: revision,
        actor: 'local-target-ui',
        decision
      }));
      if (!workspaceOperationCurrent(token)) return;
      state.workflow = null;
      await loadWorkflow();
      if (!workspaceOperationCurrent(token)) return;
      renderReview();
      setStatus(`Finding ${decision === 'accept' ? 'accepted as Evidence' : 'rejected'} and refreshed.`, 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      setStatus(error.message, 'error');
    }
  }

  function renderReview() {
    const findings = (state.workflow?.findings || []).filter(item => item.reviewStatus === 'pending');
    const changes = (state.workflow?.proposedChanges || []).filter(item => item.reviewStatus === 'pending');
    elements.view.replaceChildren(node('div', { className: 'card-grid' }, [
      node('section', { className: 'card' }, [
        node('h2', { text: 'Findings' }),
        node('p', { className: 'meta', text: 'Findings to review are not Evidence until accepted.' }),
        recordList(findings, finding => [
          node('blockquote', { text: finding.exactExcerpt }),
          node('p', { className: 'meta', text: `Source ${finding.sourceId} · Work Item ${finding.proposedWorkItemId || 'not selected'} · ${finding.proposedInitiativeId ? `Initiative ${finding.proposedInitiativeId}` : 'Initiative not selected'}` }),
          node('div', { className: 'actions' }, [
            node('button', { className: 'button primary', type: 'button', text: 'Accept as Evidence', on: { click: () => reviewFinding(finding, 'accept') } }),
            node('button', { className: 'button secondary', type: 'button', text: 'Reject', on: { click: () => reviewFinding(finding, 'reject') } })
          ])
        ], 'No Findings to review.')
      ]),
      node('section', { className: 'card' }, [
        node('h2', { text: 'Proposed changes' }),
        node('p', { className: 'meta', text: 'A Proposed Change requires its own review and stale-state check before it can modify local current state.' }),
        recordList(changes, change => [
          node('strong', { text: change.field }),
          node('p', { text: `Work Item ${change.workItemId}` }),
          node('p', { className: 'meta', text: 'Open the Work Item workflow to preview exact current and proposed values.' })
        ], 'No Proposed changes are awaiting review.')
      ])
    ]));
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
        await ensureWorkflow();
        if (generation !== state.generation) return;
        if (state.activeView === 'work-items') renderWorkItems();
        if (state.activeView === 'follow-up') renderFollowUp();
        if (state.activeView === 'milestones') renderMilestones();
        if (state.activeView === 'add-source') elements.view.replaceChildren(sourceForm());
        if (state.activeView === 'import-feed') await renderImportFeed();
        if (state.activeView === 'source-library') renderSourceLibrary();
        if (state.activeView === 'review') renderReview();
        if (state.activeView === 'settings') renderSettings();
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
    clearImportFeedData();
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
    clearImportFeedData();
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
