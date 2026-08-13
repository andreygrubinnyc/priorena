'use strict';

const WORKFLOW_COLLECTIONS = Object.freeze([
  'scopes', 'features', 'jiraEpicMappings', 'workItems', 'milestones', 'sources', 'findings', 'evidence', 'proposedChanges'
]);

function stableId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new TypeError('Target workflow state requires stable opaque IDs');
  }
  return value;
}

function encodedId(value) {
  return encodeURIComponent(stableId(value));
}

function emptyWorkflowData() {
  return {
    revision: null,
    scopes: [],
    features: [],
    jiraEpicMappings: [],
    workItems: [],
    milestones: [],
    sources: [],
    findings: [],
    evidence: [],
    proposedChanges: [],
    selectedWorkItemIds: [],
    filters: { scopeId: 'all', featureId: 'all', jiraEpicMappingId: 'all', itemType: 'all', search: '' },
    preview: null,
    confirmation: null,
    status: { kind: 'idle', message: '' },
    conflict: false
  };
}

function createTargetWorkflowState() {
  return {
    activeOrganizationId: null,
    activeWorkspaceId: null,
    loading: false,
    error: null,
    ...emptyWorkflowData()
  };
}

function clearWorkflowData(state) {
  Object.assign(state, emptyWorkflowData());
}

function responseRevision(response) {
  if (!response || !response.headers) return null;
  if (typeof response.headers.get === 'function') return response.headers.get('x-priorena-target-revision');
  return response.headers['x-priorena-target-revision'] || null;
}

async function responseJson(response) {
  if (response && typeof response.json === 'function') {
    const body = await response.json();
    if (response.ok === false) {
      const error = new Error(body?.error?.message || 'Target workflow request failed');
      error.code = body?.error?.code || 'REQUEST_FAILED';
      throw error;
    }
    return { body, revision: responseRevision(response) };
  }
  return { body: response, revision: response?.revision || null };
}

function createTargetWorkflowApiClient(options = {}) {
  if (typeof options.request !== 'function') throw new TypeError('Target workflow API client requires an injected request function');
  const request = options.request;
  const base = (organizationId, workspaceId) =>
    `/api/v2/organizations/${encodedId(organizationId)}/workspaces/${encodedId(workspaceId)}`;
  const read = async url => responseJson(await request(url, { method: 'GET' }));
  const write = async (url, value) => responseJson(await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value)
  }));

  return Object.freeze({
    async loadWorkspace(organizationId, workspaceId) {
      const root = base(organizationId, workspaceId);
      const routes = {
        scopes: `${root}/scopes`,
        features: `${root}/features`,
        jiraEpicMappings: `${root}/jira-epic-mappings`,
        workItems: `${root}/work-items`,
        milestones: `${root}/milestones`,
        sources: `${root}/sources`,
        findings: `${root}/findings?page=1&pageSize=100`,
        evidence: `${root}/evidence`,
        proposedChanges: `${root}/proposed-changes`
      };
      const entries = await Promise.all(Object.entries(routes).map(async ([key, url]) => [key, await read(url)]));
      const revisions = new Set(entries.map(([, result]) => result.revision).filter(Boolean));
      if (revisions.size > 1) {
        const error = new Error('Target data changed while the workflow view was loading');
        error.code = 'REVISION_CONFLICT';
        throw error;
      }
      const values = Object.fromEntries(entries.map(([key, result]) => {
        const collection = key === 'findings' ? result.body.findings : result.body[key];
        return [key, collection || []];
      }));
      return { ...values, revision: [...revisions][0] || null };
    },
    previewBulkWorkItems(organizationId, workspaceId, value) {
      return write(`${base(organizationId, workspaceId)}/work-items/bulk/preview`, value).then(result => result.body);
    },
    applyBulkWorkItems(organizationId, workspaceId, value) {
      return write(`${base(organizationId, workspaceId)}/work-items/bulk/apply`, value)
        .then(result => ({ ...result.body, revision: result.revision || result.body.revision }));
    },
    createScope(organizationId, workspaceId, value) {
      return write(`${base(organizationId, workspaceId)}/scopes`, value).then(result => result.body);
    },
    createWorkItem(organizationId, workspaceId, value) {
      return write(`${base(organizationId, workspaceId)}/work-items`, value).then(result => result.body);
    },
    previewWorkItemAction(organizationId, workspaceId, workItemId, value) {
      return write(`${base(organizationId, workspaceId)}/work-items/${encodedId(workItemId)}/preview`, value).then(result => result.body);
    },
    applyWorkItemAction(organizationId, workspaceId, workItemId, value) {
      return write(`${base(organizationId, workspaceId)}/work-items/${encodedId(workItemId)}/apply`, value).then(result => result.body);
    },
    createMilestone(organizationId, workspaceId, value) {
      return write(`${base(organizationId, workspaceId)}/milestones`, value).then(result => result.body);
    },
    captureSource(organizationId, workspaceId, value) {
      return write(`${base(organizationId, workspaceId)}/sources`, value).then(result => result.body);
    },
    previewImport(organizationId, workspaceId, value) {
      return write(`${base(organizationId, workspaceId)}/imports/preview`, value).then(result => result.body);
    },
    applyImport(organizationId, workspaceId, value) {
      return write(`${base(organizationId, workspaceId)}/imports/apply`, value).then(result => result.body);
    },
    reviewFinding(organizationId, workspaceId, findingId, value) {
      return write(`${base(organizationId, workspaceId)}/findings/${encodedId(findingId)}/review`, value).then(result => result.body);
    },
    previewProposedChange(organizationId, workspaceId, value) {
      return write(`${base(organizationId, workspaceId)}/proposed-changes/preview`, value).then(result => result.body);
    },
    createProposedChange(organizationId, workspaceId, value) {
      return write(`${base(organizationId, workspaceId)}/proposed-changes`, value).then(result => result.body);
    },
    reviewProposedChange(organizationId, workspaceId, proposedChangeId, value) {
      return write(`${base(organizationId, workspaceId)}/proposed-changes/${encodedId(proposedChangeId)}/review`, value).then(result => result.body);
    },
    applyProposedChange(organizationId, workspaceId, proposedChangeId, value) {
      return write(`${base(organizationId, workspaceId)}/proposed-changes/${encodedId(proposedChangeId)}/apply`, value).then(result => result.body);
    }
  });
}

function validateWorkspacePayload(payload, organizationId, workspaceId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Target workflow response is invalid');
  WORKFLOW_COLLECTIONS.forEach(collection => {
    if (!Array.isArray(payload[collection])) throw new Error('Target workflow response is incomplete');
    payload[collection].forEach(record => {
      if (!record || record.organizationId !== organizationId || record.workspaceId !== workspaceId) {
        throw new Error('Target workflow response crossed its validated parent context');
      }
    });
  });
  if (payload.revision !== null && (typeof payload.revision !== 'string' || !/^[a-f0-9]{64}$/.test(payload.revision))) {
    throw new Error('Target workflow response revision is invalid');
  }
}

function filterWorkItems(workItems, filters) {
  const search = String(filters.search || '').trim().toLocaleLowerCase('en-US');
  return workItems.filter(item => {
    const scopeMatch = filters.scopeId === 'all' ||
      (filters.scopeId === 'unassigned' ? item.scopeId === null : item.scopeId === filters.scopeId);
    const featureMatch = !filters.featureId || filters.featureId === 'all' ||
      (filters.featureId === 'none' ? item.featureId === null : item.featureId === filters.featureId);
    const jiraEpicMatch = !filters.jiraEpicMappingId || filters.jiraEpicMappingId === 'all' ||
      (filters.jiraEpicMappingId === 'none'
        ? item.jiraEpicMappingId === null
        : item.jiraEpicMappingId === filters.jiraEpicMappingId);
    const typeMatch = !filters.itemType || filters.itemType === 'all' || item.itemType === filters.itemType;
    const searchMatch = !search || [
      item.summary,
      item.jiraKey,
      item.canonicalStatus,
      item.assignee,
      item.sprint,
      item.feature?.name,
      item.jiraEpic?.jiraEpicKey,
      item.jiraEpic?.jiraEpicName
    ]
      .some(value => String(value || '').toLocaleLowerCase('en-US').includes(search));
    return scopeMatch && featureMatch && jiraEpicMatch && typeMatch && searchMatch;
  });
}

function commentCaptureLabel(timestamp) {
  return timestamp === null || timestamp === undefined ? 'No comment date captured' : timestamp;
}

function createTargetWorkflowController(api) {
  const requiredMethods = ['loadWorkspace', 'previewBulkWorkItems', 'applyBulkWorkItems'];
  if (!api || requiredMethods.some(method => typeof api[method] !== 'function')) {
    throw new TypeError('Target workflow controller requires scoped load, preview, and apply API functions');
  }
  const state = createTargetWorkflowState();
  let generation = 0;
  let contextNonce = Object.freeze({});

  function snapshot() {
    return structuredClone(state);
  }

  function token() {
    return Object.freeze({
      generation,
      nonce: contextNonce,
      organizationId: state.activeOrganizationId,
      workspaceId: state.activeWorkspaceId
    });
  }

  function isCurrent(value) {
    return value && value.generation === generation && value.nonce === contextNonce &&
      value.organizationId === state.activeOrganizationId && value.workspaceId === state.activeWorkspaceId;
  }

  function setContext(organizationId, workspaceId) {
    stableId(organizationId);
    stableId(workspaceId);
    generation += 1;
    contextNonce = Object.freeze({});
    clearWorkflowData(state);
    state.activeOrganizationId = organizationId;
    state.activeWorkspaceId = workspaceId;
    state.loading = false;
    state.error = null;
    return snapshot();
  }

  function failClosed(requestToken, error) {
    if (!isCurrent(requestToken)) return;
    clearWorkflowData(state);
    state.loading = false;
    state.error = error instanceof Error ? error.message : 'Unable to load target workflow data';
    state.conflict = ['REVISION_CONFLICT', 'PREVIEW_CONFLICT'].includes(error?.code);
    state.status = {
      kind: state.conflict ? 'conflict' : 'error',
      message: state.conflict ? 'The target data changed. Refresh before continuing.' : state.error
    };
  }

  async function load() {
    if (state.activeOrganizationId === null || state.activeWorkspaceId === null) throw new Error('Target workflow load requires a validated context');
    const requestToken = token();
    state.loading = true;
    state.error = null;
    try {
      const payload = await api.loadWorkspace(requestToken.organizationId, requestToken.workspaceId);
      if (!isCurrent(requestToken)) return snapshot();
      validateWorkspacePayload(payload, requestToken.organizationId, requestToken.workspaceId);
      WORKFLOW_COLLECTIONS.forEach(collection => { state[collection] = structuredClone(payload[collection]); });
      state.revision = payload.revision;
      state.loading = false;
      state.status = { kind: 'ready', message: 'Workflow data loaded.' };
      return snapshot();
    } catch (error) {
      failClosed(requestToken, error);
      return snapshot();
    }
  }

  function setScopeFilter(scopeId) {
    if (!['all', 'unassigned'].includes(scopeId)) stableId(scopeId);
    state.filters.scopeId = scopeId;
    state.selectedWorkItemIds = [];
    state.preview = null;
    state.confirmation = null;
    return snapshot();
  }

  function setSearch(value) {
    if (typeof value !== 'string' || value.length > 200) throw new TypeError('Target workflow search is invalid');
    state.filters.search = value;
    return snapshot();
  }

  function visibleWorkItems() {
    return structuredClone(filterWorkItems(state.workItems, state.filters));
  }

  function selectWorkItems(workItemIds) {
    if (!Array.isArray(workItemIds) || workItemIds.length > 100 || new Set(workItemIds).size !== workItemIds.length) {
      throw new TypeError('Target workflow selection is invalid');
    }
    const available = new Set(state.workItems.map(item => item.id));
    workItemIds.forEach(id => {
      stableId(id);
      if (!available.has(id)) throw new TypeError('Target workflow selection contains an unavailable Work Item');
    });
    state.selectedWorkItemIds = [...workItemIds];
    state.preview = null;
    state.confirmation = null;
    return snapshot();
  }

  async function previewBulk(action) {
    if (state.selectedWorkItemIds.length === 0) throw new Error('Select at least one Work Item');
    const requestToken = token();
    const selectedWorkItemIds = [...state.selectedWorkItemIds];
    state.status = { kind: 'loading', message: 'Preparing exact changes.' };
    state.conflict = false;
    try {
      const result = await api.previewBulkWorkItems(requestToken.organizationId, requestToken.workspaceId, {
        workItemIds: selectedWorkItemIds,
        action: structuredClone(action)
      });
      if (!isCurrent(requestToken)) return snapshot();
      if (!result?.preview || result.preview.expectedRevision !== state.revision) {
        const error = new Error('The preview does not match the loaded target revision');
        error.code = 'REVISION_CONFLICT';
        throw error;
      }
      state.preview = { ...structuredClone(result.preview), action: structuredClone(action), workItemIds: selectedWorkItemIds };
      state.confirmation = {
        open: true,
        role: 'dialog',
        ariaModal: true,
        label: 'Confirm approved Work Item changes',
        description: `${result.preview.rows.length} Work Item change${result.preview.rows.length === 1 ? '' : 's'} ready for confirmation.`
      };
      state.status = { kind: 'preview', message: 'Review the exact before and after values.' };
      return snapshot();
    } catch (error) {
      failClosed(requestToken, error);
      return snapshot();
    }
  }

  function cancelConfirmation() {
    state.preview = null;
    state.confirmation = null;
    state.status = { kind: 'ready', message: 'No changes were applied.' };
    return snapshot();
  }

  async function confirmBulk(actor = 'local-workflow-session') {
    if (!state.preview || !state.confirmation?.open) throw new Error('No approved preview is awaiting confirmation');
    const requestToken = token();
    const approved = structuredClone(state.preview);
    state.confirmation.open = false;
    state.status = { kind: 'loading', message: 'Applying approved changes.' };
    try {
      const result = await api.applyBulkWorkItems(requestToken.organizationId, requestToken.workspaceId, {
        expectedRevision: approved.expectedRevision,
        actor,
        workItemIds: approved.workItemIds,
        action: approved.action,
        previewHash: approved.previewHash
      });
      if (!isCurrent(requestToken)) return snapshot();
      state.revision = result.revision;
      state.preview = null;
      state.confirmation = null;
      const refreshed = await api.loadWorkspace(requestToken.organizationId, requestToken.workspaceId);
      if (!isCurrent(requestToken)) return snapshot();
      validateWorkspacePayload(refreshed, requestToken.organizationId, requestToken.workspaceId);
      WORKFLOW_COLLECTIONS.forEach(collection => { state[collection] = structuredClone(refreshed[collection]); });
      state.revision = refreshed.revision;
      state.selectedWorkItemIds = [];
      state.status = { kind: 'success', message: `${result.changedCount} Work Item change${result.changedCount === 1 ? '' : 's'} applied.` };
      return snapshot();
    } catch (error) {
      failClosed(requestToken, error);
      return snapshot();
    }
  }

  return Object.freeze({
    cancelConfirmation,
    confirmBulk,
    load,
    previewBulk,
    selectWorkItems,
    setContext,
    setScopeFilter,
    setSearch,
    snapshot,
    visibleWorkItems
  });
}

const targetWorkflowApi = {
  WORKFLOW_COLLECTIONS,
  clearWorkflowData,
  commentCaptureLabel,
  createTargetWorkflowApiClient,
  createTargetWorkflowController,
  createTargetWorkflowState,
  emptyWorkflowData,
  filterWorkItems,
  validateWorkspacePayload
};

if (typeof module !== 'undefined' && module.exports) module.exports = targetWorkflowApi;
if (typeof window !== 'undefined') window.PriorenaTargetWorkflow = Object.freeze(targetWorkflowApi);
