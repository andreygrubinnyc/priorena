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
    scope: byId('scope-indicator'),
    status: byId('target-status'),
    view: byId('target-view'),
    dialog: byId('target-dialog'),
    dialogTitle: byId('dialog-title'),
    dialogDescription: byId('dialog-description'),
    dialogCancel: byId('dialog-cancel'),
    dialogConfirm: byId('dialog-confirm')
  });

  const pageDefinitions = Object.freeze({
    portfolio: ['Portfolio', 'Organization-scoped delivery attention across PM Workspaces.'],
    today: ['Today', 'Attention-first current state for the selected PM Workspace.'],
    'work-items': ['Work Items', 'Review and update Work Items with visible Scope context.'],
    'follow-up': ['Follow-Up', 'PM attention attached to Work Items in this PM Workspace.'],
    milestones: ['Milestones', 'Workspace and Scope delivery checkpoints.'],
    'add-source': ['Add Source', 'Capture bounded local material for explicit Finding review.'],
    'source-library': ['Source Library', 'Workspace-owned Sources with safe provenance metadata.'],
    review: ['Review', 'Review Findings and Proposed changes as separate consequences.'],
    search: ['Search', 'Search only the selected PM Workspace.'],
    briefings: ['Briefings', 'Prepare, Open, and History for canonical stakeholder communication.'],
    settings: ['Settings', 'Target-safe Organization, PM Workspace, behavior, and privacy settings.']
  });

  const state = {
    initialized: false,
    organizations: [],
    context: null,
    workflow: null,
    briefings: { tab: 'prepare', definitions: [], revision: null, scopesByWorkspace: new Map(), activeDefinitionId: null, activeVersionId: null, renderGeneration: 0 },
    activeView: 'portfolio',
    scopeFilter: 'all',
    featureFilter: 'all',
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
    state.briefings = { tab: 'prepare', definitions: [], revision: null, scopesByWorkspace: new Map(), activeDefinitionId: null, activeVersionId: null, renderGeneration: 0 };
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

  function scopeName(scopeId) {
    if (scopeId === null) return 'Unassigned';
    return state.workflow?.scopes?.find(item => item.id === scopeId)?.name || 'Scope unavailable';
  }

  function featureName(featureId) {
    if (featureId === null) return 'No Feature';
    return state.workflow?.features?.find(item => item.id === featureId)?.name || 'Feature unavailable';
  }

  function featureOptionLabel(feature) {
    return `${feature.name} · ${feature.id}`;
  }

  function clearOperationalUi(message = 'Select a valid context to continue.') {
    state.workflow = null;
    state.scopeFilter = 'all';
    state.featureFilter = 'all';
    state.itemTypeFilter = 'all';
    state.selectedWorkItemIds.clear();
    elements.view.replaceChildren(empty(message));
    elements.scope.textContent = 'All scopes';
    updateBreadcrumb();
  }

  function updateBreadcrumb() {
    const organization = selectedOrganization();
    const workspace = selectedWorkspace();
    const organizationScoped = ['portfolio', 'briefings'].includes(state.activeView);
    if (organizationScoped) {
      elements.breadcrumb.textContent = organization?.name || 'Organization required';
      elements.scope.textContent = 'Organization scope';
      elements.scope.hidden = true;
      return;
    }
    const scope = state.scopeFilter === 'all'
      ? 'All scopes'
      : (state.scopeFilter === 'unassigned' ? 'Unassigned' : scopeName(state.scopeFilter));
    elements.breadcrumb.textContent = [organization?.name || 'Organization required', workspace?.name, scope]
      .filter(Boolean)
      .join(' · ');
    elements.scope.textContent = scope;
    elements.scope.hidden = false;
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
    if (!organizationId || !workspaceId) throw new Error('A PM Workspace is required');
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
        node('h2', { text: 'PM Workspaces' }),
        recordList(portfolio.workspaces, workspace => [
          node('div', { className: 'row-head' }, [node('strong', { text: workspace.name }), badge(`${workspace.counts.workItems} Work Items`)]),
          node('p', { className: 'meta', text: `${workspace.counts.openFollowUps} open Follow-Ups · ${workspace.counts.findingsToReview} Findings to review · ${workspace.counts.unassignedWorkItems} Unassigned` })
        ], 'This Organization has no PM Workspaces.')
      ])
    );
  }

  async function renderToday() {
    const organizationId = state.context?.activeOrganizationId;
    const workspaceId = state.context?.activeWorkspaceId;
    const generation = state.generation;
    if (!workspaceId) {
      elements.view.replaceChildren(empty('Select a PM Workspace to open Today.'));
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
            node('div', { className: 'row-head' }, [node('strong', { text: item.summary }), badge(item.scope?.name || 'Unassigned')]),
            node('p', { className: 'risk', text: item.canonicalStatus }),
            node('p', { className: 'meta', text: `Current-state provenance: ${item.currentStateProvenance}` })
          ], 'No blocked or at-risk Work Items in this PM Workspace.')
        ]),
        node('section', { className: 'card' }, [
          node('h2', { text: 'Follow-Up' }),
          recordList(today.attention.followUps, item => [
            node('div', { className: 'row-head' }, [node('strong', { text: item.summary }), badge(item.scope?.name || 'Unassigned')]),
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
          ], 'No Milestones require attention in this PM Workspace.')
        ]),
        node('section', { className: 'card' }, [
          node('h2', { text: 'Findings to review' }),
          node('p', { className: 'meta', text: 'Findings are unreviewed and are not Evidence.' }),
          recordList(today.attention.findingsToReview, finding => [
            node('blockquote', { text: finding.exactExcerpt }),
            node('p', { className: 'meta', text: `Source ${finding.sourceId} · ${finding.proposedScopeId ? `Scope ${finding.proposedScopeId}` : 'Scope not selected'} · ${finding.proposedWorkItemId ? `Work Item ${finding.proposedWorkItemId}` : 'Work Item not selected'}` })
          ], 'No Findings are awaiting review in this PM Workspace.')
        ])
      ])
    );
  }

  function visibleWorkItems() {
    const items = state.workflow?.workItems || [];
    return items.filter(item => {
      const scopeMatches = state.scopeFilter === 'all' ||
        (state.scopeFilter === 'unassigned' ? item.scopeId === null : item.scopeId === state.scopeFilter);
      const featureMatches = state.featureFilter === 'all' ||
        (state.featureFilter === 'none' ? item.featureId === null : item.featureId === state.featureFilter);
      const typeMatches = state.itemTypeFilter === 'all' || item.itemType === state.itemTypeFilter;
      return scopeMatches && featureMatches && typeMatches;
    });
  }

  function scopeFilterControl(renderFilteredView = renderWorkItems) {
    const select = node('select', {
      id: 'scope-filter',
      on: { change: event => {
        state.scopeFilter = event.target.value;
        if (state.scopeFilter === 'unassigned' || (state.featureFilter !== 'all' && state.featureFilter !== 'none' &&
          state.workflow?.features?.find(feature => feature.id === state.featureFilter)?.scopeId !== state.scopeFilter && state.scopeFilter !== 'all')) {
          state.featureFilter = 'all';
        }
        state.selectedWorkItemIds.clear();
        updateBreadcrumb();
        renderFilteredView();
      } }
    }, [
      option('all', 'All scopes', state.scopeFilter === 'all'),
      option('unassigned', 'Unassigned', state.scopeFilter === 'unassigned'),
      ...(state.workflow?.scopes || []).filter(scope => !scope.archived).map(scope => option(scope.id, scope.name, state.scopeFilter === scope.id))
    ]);
    return node('label', {}, [node('span', { text: 'Scope' }), select]);
  }

  function featureFilterControl() {
    const features = (state.workflow?.features || []).filter(feature => state.scopeFilter === 'all' || feature.scopeId === state.scopeFilter);
    const select = node('select', {
      id: 'feature-filter',
      on: { change: event => {
        state.featureFilter = event.target.value;
        state.selectedWorkItemIds.clear();
        renderWorkItems();
      } }
    }, [
      option('all', 'All Features', state.featureFilter === 'all'),
      option('none', 'No Feature', state.featureFilter === 'none'),
      ...features.map(feature => option(feature.id, featureOptionLabel(feature), state.featureFilter === feature.id))
    ]);
    return node('label', {}, [node('span', { text: 'Feature' }), select]);
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

  async function previewScopeAssignment(scopeId, featureId = 'none') {
    if (!state.selectedWorkItemIds.size) {
      setStatus('Select at least one Work Item.', 'error');
      return;
    }
    const token = workspaceOperationToken();
    const selectedWorkItemIds = [...state.selectedWorkItemIds];
    const action = {
      type: 'assign-scope',
      scopeId: scopeId === 'unassigned' ? null : scopeId,
      featureId: featureId === 'none' || scopeId === 'unassigned' ? null : featureId
    };
    setStatus('Preparing exact Scope changes…');
    try {
      const result = await workflowApi.previewBulkWorkItems(token.organizationId, token.workspaceId, {
        workItemIds: selectedWorkItemIds,
        action
      });
      if (!workspaceOperationCurrent(token)) return;
      const rows = result.preview.rows.map(row => node('p', {
        text: `${row.workItemId}: ${row.before === null ? 'Unassigned' : scopeName(row.before)} → ${row.after === null ? 'Unassigned' : scopeName(row.after)}; Feature ${featureName(row.featureChange?.beforeFeatureId || null)} → ${featureName(row.featureChange?.afterFeatureId || null)} (${row.featureChange?.effect || 'unchanged'})`
      }));
      const approved = await confirmAction(
        'Confirm Scope and Feature assignment',
        [node('p', { text: 'The server reconstructed these exact current values. No change is applied until confirmation.' }), ...rows],
        'Assign Scope and Feature'
      );
      if (!approved || !workspaceOperationCurrent(token)) {
        if (!workspaceOperationCurrent(token)) return;
        setStatus('No Scope assignment was applied.');
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
      setStatus('Scope assignment applied and refreshed.', 'success');
    } catch (error) {
      if (!workspaceOperationCurrent(token)) return;
      setStatus(error.code === 'REVISION_CONFLICT' || error.code === 'PREVIEW_CONFLICT'
        ? 'The target data changed. Refresh and review the action again.'
        : error.message, 'error');
    }
  }

  function renderWorkItems() {
    const assignment = node('select', { id: 'scope-assignment' }, [
      option('unassigned', 'Unassigned'),
      ...(state.workflow?.scopes || []).filter(scope => !scope.archived).map(scope => option(scope.id, scope.name))
    ]);
    const featureAssignment = node('select', { id: 'feature-assignment' });
    const refreshFeatureAssignment = () => {
      const scopeId = assignment.value;
      featureAssignment.replaceChildren(
        option('none', 'No Feature'),
        ...(state.workflow?.features || []).filter(feature => feature.scopeId === scopeId).map(feature => option(feature.id, featureOptionLabel(feature)))
      );
      featureAssignment.disabled = scopeId === 'unassigned';
    };
    assignment.addEventListener('change', refreshFeatureAssignment);
    refreshFeatureAssignment();
    const items = visibleWorkItems();
    elements.view.replaceChildren(
      node('div', { className: 'filters' }, [
        scopeFilterControl(),
        featureFilterControl(),
        itemTypeFilterControl(),
        node('label', {}, [node('span', { text: 'Assign selected Scope' }), assignment]),
        node('label', {}, [node('span', { text: 'Assign selected Feature' }), featureAssignment]),
        node('button', { className: 'button primary', type: 'button', text: 'Preview Scope and Feature assignment', on: { click: () => previewScopeAssignment(assignment.value, featureAssignment.value) } })
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
          node('div', { className: 'row-head' }, [node('span', {}, [checkbox, ' ', node('strong', { text: item.summary })]), node('span', {}, [badge(item.scope?.name || 'Unassigned'), ' ', badge(item.feature?.name || 'No Feature')])]),
          node('p', { className: 'meta', text: `${item.itemType} · ${item.canonicalStatus} · ${item.assignee || 'No assignee captured'} · Feature: ${item.feature?.name || 'No Feature'}` }),
          node('p', { className: 'meta', text: `Current-state provenance: ${item.currentStateProvenance}` })
        ];
      }, 'No Work Items match this Scope filter.')
    );
  }

  function renderFollowUp() {
    const items = (state.workflow?.workItems || []).filter(item => ['open', 'waiting'].includes(item.followUp.state));
    elements.view.replaceChildren(
      node('div', { className: 'actions' }, [scopeFilterControl(renderFollowUp), node('button', { className: 'button secondary', type: 'button', text: 'Add follow-up', disabled: true, attrs: { title: 'Open a Work Item to add Follow-Up details.' } })]),
      recordList(items.filter(item => state.scopeFilter === 'all' || (state.scopeFilter === 'unassigned' ? item.scopeId === null : item.scopeId === state.scopeFilter)), item => [
        node('div', { className: 'row-head' }, [node('strong', { text: item.summary }), badge(item.scope?.name || 'Unassigned')]),
        node('p', { text: item.followUp.nextAction || 'Follow-Up needs a next action.' }),
        node('p', { className: 'meta', text: `${item.followUp.state} · ${workflowModule.commentCaptureLabel(item.followUp.lastCapturedCommentAt)}` })
      ], 'No open Follow-Ups match this Scope filter.')
    );
  }

  function renderMilestones() {
    elements.view.replaceChildren(recordList(state.workflow?.milestones || [], milestone => [
      node('div', { className: 'row-head' }, [node('strong', { text: milestone.title }), badge(milestone.status)]),
      node('p', { text: `Applies to: ${milestone.applicability.label}` }),
      node('p', { className: milestone.timing.pressure === 'overdue' ? 'risk' : (milestone.timing.pressure === 'due-soon' ? 'warning' : 'meta'), text: `${milestone.date} · ${milestone.timing.pressure} · ${milestone.linkedWorkItemIds.length} linked Work Items` })
    ], 'No Milestones exist in this PM Workspace.'));
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
      ], 'No Sources have been added to this PM Workspace.')
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
          node('p', { className: 'meta', text: `Source ${finding.sourceId} · Work Item ${finding.proposedWorkItemId || 'not selected'} · ${finding.proposedScopeId ? `Scope ${finding.proposedScopeId}` : 'Scope not selected'}` }),
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
    const input = node('input', { attrs: { minlength: '2', maxlength: '200', 'aria-label': 'Search selected PM Workspace' }, placeholder: 'Search Work Items, Sources, Evidence, Milestones, or Scopes' });
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
          node('p', { className: 'meta', text: result.scopeName || (result.scopeId === null ? 'Unassigned or Workspace-level' : `Scope ${result.scopeId}`) })
        ], 'No matching records in this PM Workspace.'));
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
    const scopeResults = await Promise.all((state.context.workspaces || []).map(async workspace => {
      const result = await requestJson(`/api/v2/organizations/${encoded(organizationId)}/workspaces/${encoded(workspace.id)}/scopes`);
      return { workspaceId: workspace.id, scopes: result.body.scopes || [], revision: result.revision };
    }));
    if (generation !== state.generation) return false;
    if (scopeResults.some(result => result.revision !== listed.revision)) throw new Error('Target data changed while Briefings were loading. Refresh and try again.');
    state.briefings.definitions = listed.body.briefings;
    state.briefings.revision = listed.revision;
    state.briefings.scopesByWorkspace = new Map(scopeResults.map(result => [result.workspaceId, result.scopes]));
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
    const selectedScopes = new Set(existing?.scopes.map(scope => scope.id) || []);
    const workspaceControls = node('div', { className: 'selection-grid' }, (state.context.workspaces || []).map(workspace => {
      const workspaceControl = node('input', { type: 'checkbox', name: 'briefing-workspace', value: workspace.id, checked: selectedWorkspaces.has(workspace.id) });
      const scopes = state.briefings.scopesByWorkspace.get(workspace.id) || [];
      return node('fieldset', { className: 'choice-group' }, [
        node('legend', {}, [node('label', { className: 'choice' }, [workspaceControl, node('strong', { text: workspace.name })])]),
        node('p', { className: 'meta', text: 'No Scope selected means Entire workspace.' }),
        ...scopes.filter(scope => !scope.archived).map(scope => node('label', { className: 'choice' }, [
          node('input', { type: 'checkbox', name: 'briefing-scope', value: scope.id, checked: selectedScopes.has(scope.id), attrs: { 'data-workspace-id': workspace.id } }),
          node('span', { text: scope.name })
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
      node('h3', { text: 'PM Workspace and Scope selection' }),
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
      const scopeIds = checkedValues(form, '[name="briefing-scope"]').filter(scopeId => {
        const control = form.querySelector(`[name="briefing-scope"][value="${CSS.escape(scopeId)}"]`);
        return enabledWorkspaces.has(control.dataset.workspaceId);
      });
      const preferredFormats = checkedValues(form, '[name="briefing-format"]');
      const defaultSections = checkedValues(form, '[name="briefing-section"]');
      if (!workspaceIds.length || !preferredFormats.length || !defaultSections.length) {
        setStatus('Choose at least one PM Workspace, output format, and section.', 'error');
        return;
      }
      const definition = {
        name: name.value.trim(), workspaceIds, scopeIds, audienceProfile: audience.value.trim(),
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

  function definitionScopeLabel(definition) {
    return definition.workspaces.map(workspace => {
      const scopes = definition.scopes.filter(scope => scope.workspaceId === workspace.id);
      return `${workspace.name}: ${scopes.length ? scopes.map(scope => scope.name).join(', ') : 'Entire workspace'}`;
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
      node('p', { className: 'meta', text: definitionScopeLabel(definition) }),
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
        node('p', { text: 'Briefing definitions are Organization-owned. Scope selection is preserved with stable IDs, and an empty Scope selection means Entire workspace for each selected PM Workspace.' }),
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

  async function createFeatureFromSettings(scopeId, name, description) {
    const token = workspaceOperationToken();
    if (!name.trim()) {
      setStatus('Feature name is required.', 'error');
      return;
    }
    try {
      await requestJson(`/api/v2/organizations/${encoded(token.organizationId)}/workspaces/${encoded(token.workspaceId)}/scopes/${encoded(scopeId)}/features`, mutationOptions({
        expectedRevision: state.workflow.revision,
        actor: 'local-target-ui',
        feature: { name: name.trim(), description: description.trim() }
      }));
      if (!workspaceOperationCurrent(token)) return;
      state.workflow = null;
      await loadWorkflow();
      if (!workspaceOperationCurrent(token)) return;
      renderSettings();
      setStatus('Feature created under the selected Scope. No Jira mapping was created.', 'success');
    } catch (error) {
      if (workspaceOperationCurrent(token)) setStatus(error.message, 'error');
    }
  }

  function featureSettingsCard(scopes, features) {
    const scopeSelect = node('select', {}, scopes.filter(scope => !scope.archived).map(scope => option(scope.id, scope.name)));
    const name = node('input', { attrs: { maxlength: '200', 'aria-label': 'New Feature name' }, placeholder: 'Feature name' });
    const description = node('input', { attrs: { maxlength: '4000', 'aria-label': 'New Feature description' }, placeholder: 'Optional Feature description' });
    const rows = recordList(features, feature => {
      const route = `/api/v2/organizations/${encoded(state.context.activeOrganizationId)}/workspaces/${encoded(state.context.activeWorkspaceId)}`;
      const featureRoute = `${route}/scopes/${encoded(feature.scopeId)}/features/${encoded(feature.id)}`;
      return [
        node('strong', { text: feature.name }),
        node('p', { className: 'meta', text: `Stable ID: ${feature.id} · Scope: ${scopeName(feature.scopeId)} · ${feature.description || 'No description'}` }),
        renameControl('Feature', feature.name, featureRoute, body => {
          const current = state.workflow.features.find(item => item.id === feature.id);
          if (current) current.name = body.feature.name;
        })
      ];
    }, 'No Features configured. Jira Epic mappings remain a separate Scope integration.');
    return node('section', { className: 'card' }, [
      node('h2', { text: 'Features' }),
      node('p', { className: 'meta', text: 'Features are internal Scope children. Creating or renaming one does not call Jira or change Jira Epic mappings.' }),
      node('div', { className: 'field-group' }, [
        node('label', { className: 'field' }, [node('span', { text: 'Parent Scope' }), scopeSelect]),
        node('label', { className: 'field' }, [node('span', { text: 'Feature name' }), name]),
        node('label', { className: 'field' }, [node('span', { text: 'Description' }), description])
      ]),
      node('button', { className: 'button primary', type: 'button', text: 'Create Feature', disabled: scopes.length === 0, on: { click: () => createFeatureFromSettings(scopeSelect.value, name.value, description.value) } }),
      rows
    ]);
  }

  function renderSettings() {
    const scopes = state.workflow?.scopes || [];
    const features = state.workflow?.features || [];
    const organization = selectedOrganization();
    const workspace = selectedWorkspace();
    const organizationRoute = `/api/v2/organizations/${encoded(organization.id)}`;
    const workspaceRoute = `${organizationRoute}/workspaces/${encoded(workspace.id)}`;
    elements.view.replaceChildren(node('div', { className: 'card-grid' }, [
      node('section', { className: 'card' }, [node('h2', { text: 'User preferences' }), node('p', { text: 'Active Organization and PM Workspace preferences use stable IDs and are revalidated before use.' })]),
      node('section', { className: 'card' }, [node('h2', { text: 'Organization' }), node('p', { text: organization?.name || 'Organization required' }), node('p', { className: 'meta', text: 'Only truly Organization-wide settings belong here.' }), renameControl('Organization', organization.name, organizationRoute, body => { organization.name = body.organization.name; })]),
      node('section', { className: 'card' }, [node('h2', { text: 'Workspace' }), node('p', { text: workspace?.name || 'PM Workspace required' }), node('p', { className: 'meta', text: 'Sprint vocabulary, behavior thresholds, and drafting guidance remain Workspace-owned.' }), renameControl('PM Workspace', workspace.name, workspaceRoute, body => { workspace.name = body.workspace.name; })]),
      node('section', { className: 'card' }, [node('h2', { text: 'Scopes & Jira mappings' }), node('p', { className: 'meta', text: 'Scope names are managed here. Jira Epic mappings are independent integration records.' }), recordList(scopes, scope => [
        node('strong', { text: scope.name }),
        node('p', { className: 'meta', text: scope.archived ? 'Archived Scope' : 'Active Scope' }),
        renameControl('Scope', scope.name, `${workspaceRoute}/scopes/${encoded(scope.id)}`, body => { scope.name = body.scope.name; })
      ], 'No Scopes configured.')]),
      featureSettingsCard(scopes, features),
      node('section', { className: 'card' }, [node('h2', { text: 'Behavior' }), node('p', { text: 'Deterministic status and milestone logic is system-defined unless a schema-supported Workspace threshold is explicitly edited.' })]),
      node('section', { className: 'card' }, [node('h2', { text: 'AI — Advanced' }), node('p', { text: 'Optional AI enhancement is disabled in the target UI. Deterministic Briefings remain fully available without it.' })]),
      node('section', { className: 'card' }, [node('h2', { text: 'Data & Privacy' }), node('p', { text: 'Target data stays in the explicitly selected local schema-v3 file. There is no analytics, telemetry, automatic publishing, or cross-Organization view.' })])
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
    setStatus('Validating Organization and PM Workspace context…');
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
    clearOperationalUi('Loading the selected PM Workspace…');
    setStatus('Validating PM Workspace context…');
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
    state.scopeFilter = 'all';
    state.featureFilter = 'all';
    state.itemTypeFilter = 'all';
    state.selectedWorkItemIds.clear();
    renderActiveView();
  });
  elements.dialogCancel.addEventListener('click', () => { elements.dialog.returnValue = 'cancel'; });
  elements.dialogConfirm.addEventListener('click', () => { elements.dialog.returnValue = 'confirm'; });
}());
