'use strict';

(function targetApplication() {
  const contextModule = window.PriorenaTargetContext;
  const workflowModule = window.PriorenaTargetWorkflow;
  const briefingModule = window.PriorenaTargetBriefing;
  if (!contextModule || !workflowModule || !briefingModule) throw new Error('Target state modules are unavailable');

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
    'add-source': ['Add Source', 'Capture bounded local material for explicit Finding review.'],
    'source-library': ['Source Library', 'Workspace-owned Sources with safe provenance metadata.'],
    review: ['Review', 'Review Findings and Proposed changes as separate consequences.'],
    search: ['Search', 'Search only the selected Workspace.'],
    briefings: ['Briefings', 'Prepare, Open, and History for canonical stakeholder communication.'],
    settings: ['Settings', 'Target-safe Organization, Workspace, behavior, and privacy settings.']
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
    generation: 0
  };

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

  function showLoading(message = 'Loading validated target data…') {
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
    state.workflow = null;
    state.initiativeFilter = 'all';
    state.workstreamFilter = 'all';
    state.jiraEpicFilter = 'all';
    state.itemTypeFilter = 'all';
    state.selectedWorkItemIds.clear();
    elements.view.replaceChildren(empty(message));
    elements.initiative.textContent = 'All initiatives';
    updateBreadcrumb();
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
            node('p', { className: 'meta', text: `Current-state provenance: ${item.currentStateProvenance}` })
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
      ...(state.workflow?.initiatives || []).filter(initiative => !initiative.archived).map(initiative => option(initiative.id, initiative.name, state.initiativeFilter === initiative.id))
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
        ? 'The target data changed. Refresh and review the action again.'
        : error.message, 'error');
    }
  }

  function renderWorkItems() {
    const assignment = node('select', { id: 'initiative-assignment' }, [
      option('unassigned', 'Unassigned'),
      ...(state.workflow?.initiatives || []).filter(initiative => !initiative.archived).map(initiative => option(initiative.id, initiative.name))
    ]);
    const workstreamAssignment = node('select', { id: 'workstream-assignment' });
    const jiraEpicAssignment = node('select', { id: 'jira-epic-assignment' });
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
      workstreamAssignment.disabled = initiativeId === 'unassigned';
      jiraEpicAssignment.disabled = initiativeId === 'unassigned';
    };
    assignment.addEventListener('change', refreshRelationshipAssignments);
    refreshRelationshipAssignments();
    const items = visibleWorkItems();
    elements.view.replaceChildren(
      node('div', { className: 'filters' }, [
        initiativeFilterControl(),
        workstreamFilterControl(),
        jiraEpicFilterControl(),
        itemTypeFilterControl(),
        node('label', {}, [node('span', { text: 'Assign selected Initiative' }), assignment]),
        node('label', {}, [node('span', { text: 'Assign selected Workstream' }), workstreamAssignment]),
        node('label', {}, [node('span', { text: 'Assign selected Jira Epic' }), jiraEpicAssignment]),
        node('button', { className: 'button primary', type: 'button', text: 'Preview association changes', on: { click: () => previewInitiativeAssignment(assignment.value, workstreamAssignment.value, jiraEpicAssignment.value) } })
      ]),
      recordList(items, item => {
        const checkbox = node('input', {
          type: 'checkbox',
          checked: state.selectedWorkItemIds.has(item.id),
          attrs: { 'aria-label': `Select Work Item ${item.summary}` },
          on: { change: event => {
            if (event.target.checked) state.selectedWorkItemIds.add(item.id);
            else state.selectedWorkItemIds.delete(item.id);
          } }
        });
        return [
          node('div', { className: 'row-head' }, [node('span', {}, [checkbox, ' ', node('strong', { text: item.summary })]), node('span', {}, [badge(item.initiative?.name || 'Unassigned'), ' ', badge(item.workstream?.name || 'No Workstream'), ' ', badge(item.jiraEpic ? `${item.jiraEpic.jiraEpicKey} · ${item.jiraEpic.mappingStatus}` : 'No Jira Epic')])]),
          node('p', { className: 'meta', text: `${item.itemType} · ${item.canonicalStatus} · ${item.assignee || 'No assignee captured'} · Workstream: ${item.workstream?.name || 'No Workstream'} · Jira Epic: ${item.jiraEpic ? `${item.jiraEpic.jiraEpicKey} — ${item.jiraEpic.jiraEpicName} (${item.jiraEpic.mappingStatus})` : 'No Jira Epic'} · Work Item Jira key: ${item.workItemJiraKey || 'None'}` }),
          node('p', { className: 'meta', text: `Current-state provenance: ${item.currentStateProvenance}` })
        ];
      }, 'No Work Items match this Initiative filter.')
    );
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
    const provenance = node('input', { name: 'provenance', value: 'Explicit local target UI capture', attrs: { maxlength: '4000', required: 'required' } });
    const content = node('textarea', { name: 'content', attrs: { maxlength: '524288', required: 'required' } });
    form.append(
      node('h2', { text: 'Capture a Workspace-owned Source' }),
      node('p', { className: 'notice', text: 'Source content is untrusted. Capture does not change Work Item current state; extracted Findings require separate review.' }),
      node('div', { className: 'field-group' }, [
        node('label', { className: 'field' }, [node('span', { text: 'Source title' }), title]),
        node('label', { className: 'field' }, [node('span', { text: 'Source date' }), date]),
        node('label', { className: 'field' }, [node('span', { text: 'Provenance' }), provenance])
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

  function renderSourceLibrary() {
    elements.view.replaceChildren(
      node('p', { className: 'notice', text: 'Source lists show safe metadata only. Full Source content is returned only for an explicitly selected Source.' }),
      recordList(state.workflow?.sources || [], source => [
        node('div', { className: 'row-head' }, [node('strong', { text: source.title }), badge(source.processingState)]),
        node('p', { className: 'meta', text: `${source.type} · ${source.date}` }),
        node('p', { text: source.provenance })
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
    if (initiativeResults.some(result => result.revision !== listed.revision)) throw new Error('Target data changed while Briefings were loading. Refresh and try again.');
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
    const guidance = node('textarea', { value: existing?.draftingGuidance || '', attrs: { maxlength: '4000', rows: '4' }, placeholder: 'Optional deterministic drafting guidance' });
    const selectedWorkspaces = new Set(existing?.workspaces.map(workspace => workspace.id) || [state.context.activeWorkspaceId]);
    const selectedInitiatives = new Set(existing?.initiatives.map(initiative => initiative.id) || []);
    const workspaceControls = node('div', { className: 'selection-grid' }, (state.context.workspaces || []).map(workspace => {
      const workspaceControl = node('input', { type: 'checkbox', name: 'briefing-workspace', value: workspace.id, checked: selectedWorkspaces.has(workspace.id) });
      const initiatives = state.briefings.initiativesByWorkspace.get(workspace.id) || [];
      return node('fieldset', { className: 'choice-group' }, [
        node('legend', {}, [node('label', { className: 'choice' }, [workspaceControl, node('strong', { text: workspace.name })])]),
        node('p', { className: 'meta', text: 'No Initiative selected means Entire workspace.' }),
        ...initiatives.filter(initiative => !initiative.archived).map(initiative => node('label', { className: 'choice' }, [
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
        node('small', { text: `${candidate.kind} · ${candidate.section} · ${candidate.provenance.type}${candidate.truncated ? ' · bounded preview' : ''}` })
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
            setStatus('Deterministic outputs previewed. Draft lifecycle is unchanged.', 'success');
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
    if (placements.some(placement => placement.revision !== state.briefings.revision)) throw new Error('Target data changed while Briefing Versions were loading. Refresh and try again.');
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
      node('p', { className: 'notice', text: 'Priorena creates deterministic outputs for explicit copy. It never sends Briefing content; communication state changes only after explicit confirmation.' })
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
        ? 'The target data changed. Refresh and preview the rename again.'
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
    const initiativeSelect = node('select', {}, initiatives.filter(initiative => !initiative.archived).map(initiative => option(initiative.id, initiative.name)));
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
    }, 'No Workstreams configured. Jira Epic mappings remain a separate Initiative integration.');
    return node('section', { className: 'card' }, [
      node('h2', { text: 'Workstreams' }),
      node('p', { className: 'meta', text: 'Workstreams are internal Initiative children. Creating or renaming one does not call Jira or change Jira Epic mappings.' }),
      node('div', { className: 'field-group' }, [
        node('label', { className: 'field' }, [node('span', { text: 'Parent Initiative' }), initiativeSelect]),
        node('label', { className: 'field' }, [node('span', { text: 'Workstream name' }), name]),
        node('label', { className: 'field' }, [node('span', { text: 'Description' }), description])
      ]),
      node('button', { className: 'button primary', type: 'button', text: 'Create Workstream', disabled: initiatives.length === 0, on: { click: () => createWorkstreamFromSettings(initiativeSelect.value, name.value, description.value) } }),
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
      setStatus('Parent Initiative, Jira keys, Jira Epic name, and provenance are required.', 'error');
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
      setStatus('Jira keys, Jira Epic name, and provenance are required.', 'error');
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
      provenance: node('input', { value: mapping?.provenance || '', attrs: { maxlength: '2000', 'aria-label': 'Mapping provenance' }, placeholder: 'How this local mapping was reviewed' })
    };
  }

  function jiraMappingFields(controls) {
    return node('div', { className: 'field-group' }, [
      node('label', { className: 'field' }, [node('span', { text: 'Jira project key' }), controls.projectKey]),
      node('label', { className: 'field' }, [node('span', { text: 'Jira Epic key' }), controls.epicKey]),
      node('label', { className: 'field' }, [node('span', { text: 'Jira Epic name' }), controls.epicName]),
      node('label', { className: 'field' }, [node('span', { text: 'Mapping status' }), controls.status]),
      node('label', { className: 'field' }, [node('span', { text: 'Provenance' }), controls.provenance])
    ]);
  }

  function jiraEpicSettingsCard(initiatives, mappings) {
    const activeInitiatives = initiatives.filter(initiative => !initiative.archived);
    const initiativeSelect = node('select', {}, activeInitiatives.map(initiative => option(initiative.id, initiative.name)));
    const createControls = jiraMappingControls();
    return node('section', { className: 'card' }, [
      node('h2', { text: 'Jira Epic mappings' }),
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
      ], 'No Jira Epic mappings configured.')
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
    elements.view.replaceChildren(node('div', { className: 'card-grid' }, [
      node('section', { className: 'card' }, [node('h2', { text: 'User preferences' }), node('p', { text: 'Active Organization and Workspace preferences use stable IDs and are revalidated before use.' })]),
      node('section', { className: 'card' }, [node('h2', { text: 'Organization' }), node('p', { text: organization?.name || 'Organization required' }), node('p', { className: 'meta', text: 'Only truly Organization-wide settings belong here.' }), renameControl('Organization', organization.name, organizationRoute, body => { organization.name = body.organization.name; })]),
      node('section', { className: 'card' }, [node('h2', { text: 'Workspace' }), node('p', { text: workspace?.name || 'Workspace required' }), node('p', { className: 'meta', text: 'Sprint vocabulary, behavior thresholds, and drafting guidance remain Workspace-owned.' }), renameControl('Workspace', workspace.name, workspaceRoute, body => { workspace.name = body.workspace.name; })]),
      node('section', { className: 'card' }, [node('h2', { text: 'Initiatives' }), node('p', { className: 'meta', text: 'Initiative names are managed independently from Workstreams and Jira Epic mappings.' }), recordList(initiatives, initiative => [
        node('strong', { text: initiative.name }),
        node('p', { className: 'meta', text: initiative.archived ? 'Archived Initiative' : 'Active Initiative' }),
        renameControl('Initiative', initiative.name, `${workspaceRoute}/initiatives/${encoded(initiative.id)}`, body => { initiative.name = body.initiative.name; })
      ], 'No Initiatives configured.')]),
      workstreamSettingsCard(initiatives, workstreams),
      jiraEpicSettingsCard(initiatives, jiraEpicMappings),
      node('section', { className: 'card' }, [node('h2', { text: 'Behavior' }), node('p', { text: 'Deterministic status and milestone logic is system-defined unless a schema-supported Workspace threshold is explicitly edited.' })]),
      node('section', { className: 'card' }, [node('h2', { text: 'AI — Advanced' }), node('p', { text: 'Optional AI enhancement is disabled in the target UI. Deterministic Briefings remain fully available without it.' })]),
      node('section', { className: 'card' }, [node('h2', { text: 'Data & Privacy' }), node('p', { text: 'Target data stays in the explicitly selected local schema-v5 file. There is no analytics, telemetry, automatic publishing, or cross-Organization view.' })])
    ]));
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
        if (state.activeView === 'source-library') renderSourceLibrary();
        if (state.activeView === 'review') renderReview();
        if (state.activeView === 'settings') renderSettings();
      }
      if (generation === state.generation) setStatus(`${pageDefinitions[state.activeView][0]} loaded.`, 'success');
    } catch (error) {
      if (generation !== state.generation) return;
      clearOperationalUi('The requested target page could not be loaded.');
      setStatus(error.message, 'error');
    }
  }

  async function selectOrganization(organizationId) {
    stableId(organizationId);
    const generation = ++state.generation;
    cancelOpenConfirmation();
    state.context = null;
    state.workflow = null;
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
    elements.initialize.textContent = 'Initializing…';
    try {
      const result = await requestJson('/api/v2/organizations');
      state.organizations = result.body.organizations || [];
      elements.start.hidden = true;
      elements.shell.hidden = false;
      fillOrganizations();
      if (!state.organizations.length) {
        clearOperationalUi('No Organizations exist in this target store.');
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
      elements.initialize.textContent = 'Retry initialization';
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
    state.activeView = button.dataset.view;
    state.initiativeFilter = 'all';
    state.workstreamFilter = 'all';
    state.jiraEpicFilter = 'all';
    state.itemTypeFilter = 'all';
    state.selectedWorkItemIds.clear();
    renderActiveView();
  });
  elements.dialogCancel.addEventListener('click', () => { elements.dialog.returnValue = 'cancel'; });
  elements.dialogConfirm.addEventListener('click', () => { elements.dialog.returnValue = 'confirm'; });
}());
