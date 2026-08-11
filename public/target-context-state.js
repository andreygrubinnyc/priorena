'use strict';

function emptyOperationalState() {
  return {
    activeWorkspaceId: null,
    workspaceRecords: [],
    portfolio: null,
    today: null,
    pendingSelections: [],
    searchResults: [],
    counts: {},
    sources: [],
    evidence: [],
    briefings: [],
    renderedOutput: ''
  };
}

function createTargetContextState() {
  return {
    activeOrganizationId: null,
    workspaces: [],
    ...emptyOperationalState(),
    loading: false,
    error: null
  };
}

function clearOperationalState(state) {
  Object.assign(state, emptyOperationalState());
}

function assertApi(api) {
  const methods = ['listWorkspaces', 'resolveContext', 'loadPortfolio', 'loadToday'];
  if (!api || methods.some(method => typeof api[method] !== 'function')) {
    throw new TypeError('Target context requires scoped Workspace, context, Portfolio, and Today API functions');
  }
}

function clientStableId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new TypeError('Target client context requires a stable opaque ID');
  }
  return encodeURIComponent(value);
}

function createTargetApiClient(options = {}) {
  if (typeof options.request !== 'function') throw new TypeError('Target API client requires an injected request function');
  const request = options.request;
  const read = async url => {
    const response = await request(url);
    if (response && typeof response.json === 'function') {
      if (response.ok === false) throw new Error('Scoped target request failed');
      return response.json();
    }
    return response;
  };
  return Object.freeze({
    listWorkspaces(organizationId) {
      return read(`/api/v2/organizations/${clientStableId(organizationId)}/workspaces`);
    },
    resolveContext(organizationId, workspaceId = null) {
      clientStableId(organizationId);
      if (workspaceId) clientStableId(workspaceId);
      const query = new URLSearchParams({ organizationId });
      if (workspaceId) query.set('workspaceId', workspaceId);
      return read(`/api/v2/context?${query.toString()}`);
    },
    loadPortfolio(organizationId) {
      return read(`/api/v2/organizations/${clientStableId(organizationId)}/portfolio`);
    },
    loadToday(organizationId, workspaceId) {
      return read(`/api/v2/organizations/${clientStableId(organizationId)}/workspaces/${clientStableId(workspaceId)}/today`);
    }
  });
}

function createTargetContextController(api) {
  assertApi(api);
  const state = createTargetContextState();
  let requestGeneration = 0;
  let activeRequestNonce = Object.freeze({});

  function snapshot() {
    return structuredClone(state);
  }

  function beginOrganizationSwitch(organizationId) {
    requestGeneration += 1;
    activeRequestNonce = Object.freeze({});
    state.activeOrganizationId = organizationId;
    state.workspaces = [];
    clearOperationalState(state);
    state.loading = true;
    state.error = null;
    return requestGeneration;
  }

  function failClosed(generation, error) {
    if (generation !== requestGeneration) return;
    state.workspaces = [];
    clearOperationalState(state);
    state.loading = false;
    state.error = error instanceof Error ? error.message : 'Unable to load target context';
  }

  async function selectOrganization(organizationId, options = {}) {
    const generation = beginOrganizationSwitch(organizationId);
    try {
      const savedWorkspaceId = options.savedWorkspaceId || null;
      const [workspaceResponse, context, portfolio] = await Promise.all([
        api.listWorkspaces(organizationId),
        api.resolveContext(organizationId, savedWorkspaceId),
        api.loadPortfolio(organizationId)
      ]);
      if (generation !== requestGeneration) return snapshot();
      if (context.organization.id !== organizationId) throw new Error('Target context Organization validation failed');
      const workspaceIds = new Set(workspaceResponse.workspaces.map(workspace => workspace.id));
      if (context.workspace && !workspaceIds.has(context.workspace.id)) throw new Error('Target context Workspace validation failed');

      state.workspaces = structuredClone(workspaceResponse.workspaces);
      state.portfolio = structuredClone(portfolio);
      state.activeWorkspaceId = context.workspace ? context.workspace.id : null;
      if (context.workspace) {
        const today = await api.loadToday(organizationId, context.workspace.id);
        if (generation !== requestGeneration) return snapshot();
        state.today = structuredClone(today);
        state.workspaceRecords = structuredClone(today.workItems || []);
        state.counts = structuredClone(today.counts || {});
      }
      state.loading = false;
      return snapshot();
    } catch (error) {
      failClosed(generation, error);
      return snapshot();
    }
  }

  async function selectWorkspace(workspaceId) {
    const organizationId = state.activeOrganizationId;
    requestGeneration += 1;
    activeRequestNonce = Object.freeze({});
    const generation = requestGeneration;
    clearOperationalState(state);
    state.loading = true;
    state.error = null;
    try {
      const context = await api.resolveContext(organizationId, workspaceId);
      if (generation !== requestGeneration) return snapshot();
      if (!context.workspace || context.organization.id !== organizationId || context.workspace.id !== workspaceId) {
        throw new Error('Target context Workspace validation failed');
      }
      const [portfolio, today] = await Promise.all([
        api.loadPortfolio(organizationId),
        api.loadToday(organizationId, workspaceId)
      ]);
      if (generation !== requestGeneration) return snapshot();
      state.activeWorkspaceId = workspaceId;
      state.portfolio = structuredClone(portfolio);
      state.today = structuredClone(today);
      state.workspaceRecords = structuredClone(today.workItems || []);
      state.counts = structuredClone(today.counts || {});
      state.loading = false;
      return snapshot();
    } catch (error) {
      failClosed(generation, error);
      return snapshot();
    }
  }

  function captureWorkspaceRequestToken() {
    if (state.loading || state.activeOrganizationId === null || state.activeWorkspaceId === null) {
      throw new Error('Target Workspace requests require a fully validated active context');
    }
    return Object.freeze({
      nonce: activeRequestNonce,
      generation: requestGeneration,
      organizationId: state.activeOrganizationId,
      workspaceId: state.activeWorkspaceId
    });
  }

  function isCurrentWorkspaceRequestToken(token) {
    return Boolean(token)
      && token.nonce === activeRequestNonce
      && token.generation === requestGeneration
      && token.organizationId === state.activeOrganizationId
      && token.workspaceId === state.activeWorkspaceId
      && state.loading === false;
  }

  function replaceWorkspaceData(token, values = {}) {
    if (!isCurrentWorkspaceRequestToken(token)) return snapshot();
    const keys = ['pendingSelections', 'searchResults', 'sources', 'evidence', 'briefings', 'renderedOutput'];
    keys.forEach(key => {
      if (Object.hasOwn(values, key)) state[key] = structuredClone(values[key]);
    });
    return snapshot();
  }

  return Object.freeze({
    beginOrganizationSwitch,
    captureWorkspaceRequestToken,
    replaceWorkspaceData,
    selectOrganization,
    selectWorkspace,
    snapshot
  });
}

const targetContextApi = {
  createTargetApiClient,
  clearOperationalState,
  createTargetContextController,
  createTargetContextState,
  emptyOperationalState
};

if (typeof module !== 'undefined' && module.exports) module.exports = targetContextApi;
if (typeof window !== 'undefined') window.PriorenaTargetContext = Object.freeze(targetContextApi);
