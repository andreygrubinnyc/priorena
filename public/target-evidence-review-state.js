'use strict';

const FINDING_PAGE_SIZE = 25;
const MAX_EXCERPT_CHARACTERS = 50_000;
const FINDING_CURRENTNESS = Object.freeze(['current', 'historical', 'contradicted', 'unknown']);
const PROPOSED_CHANGE_FIELDS = Object.freeze([
  'canonicalStatus',
  'sourceStatus',
  'assignee',
  'sprint',
  'currentStateConfidence',
  'currentStateProvenance',
  'lastCapturedCommentAt'
]);

function evidenceReviewStableId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new TypeError('Evidence review requires stable opaque IDs');
  }
  return value;
}

function encodedId(value) {
  return encodeURIComponent(evidenceReviewStableId(value));
}

function responseRevision(response) {
  if (!response?.headers) return null;
  if (typeof response.headers.get === 'function') return response.headers.get('x-priorena-target-revision');
  return response.headers['x-priorena-target-revision'] || null;
}

async function responseJson(response) {
  if (response && typeof response.json === 'function') {
    const body = await response.json();
    if (response.ok === false) {
      const error = new Error(body?.error?.message || 'Evidence review request failed');
      error.code = body?.error?.code || 'REQUEST_FAILED';
      throw error;
    }
    return { body, revision: responseRevision(response) };
  }
  return { body: response, revision: response?.revision || null };
}

function createTargetEvidenceReviewApiClient(options = {}) {
  if (typeof options.request !== 'function') throw new TypeError('Evidence review API client requires an injected request function');
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
    openSource(organizationId, workspaceId, sourceId) {
      return read(`${base(organizationId, workspaceId)}/sources/${encodedId(sourceId)}`);
    },
    listFindings(organizationId, workspaceId, page = 1) {
      if (!Number.isInteger(page) || page < 1) throw new TypeError('Finding page must be a positive integer');
      return read(`${base(organizationId, workspaceId)}/findings?status=pending&page=${page}&pageSize=${FINDING_PAGE_SIZE}`);
    },
    createSourceFinding(organizationId, workspaceId, sourceId, value) {
      return write(`${base(organizationId, workspaceId)}/sources/${encodedId(sourceId)}/findings`, value);
    },
    reviewFinding(organizationId, workspaceId, findingId, value) {
      return write(`${base(organizationId, workspaceId)}/findings/${encodedId(findingId)}/review`, value);
    },
    previewProposedChange(organizationId, workspaceId, value) {
      return write(`${base(organizationId, workspaceId)}/proposed-changes/preview`, value);
    },
    createProposedChange(organizationId, workspaceId, value) {
      return write(`${base(organizationId, workspaceId)}/proposed-changes`, value);
    },
    reviewProposedChange(organizationId, workspaceId, proposedChangeId, value) {
      return write(`${base(organizationId, workspaceId)}/proposed-changes/${encodedId(proposedChangeId)}/review`, value);
    },
    applyProposedChange(organizationId, workspaceId, proposedChangeId, value) {
      return write(`${base(organizationId, workspaceId)}/proposed-changes/${encodedId(proposedChangeId)}/apply`, value);
    }
  });
}

function newEvidenceReviewState() {
  return {
    sourceDetail: null,
    sourceRevision: null,
    excerptSelection: null,
    lastCreatedFindingId: null,
    findingPage: { page: 1, pageSize: FINDING_PAGE_SIZE, total: 0, findings: [], revision: null },
    proposedDraft: null,
    proposedPreview: null,
    staleProposedChangeIds: new Set()
  };
}

function clearEvidenceReviewState(state) {
  Object.assign(state, newEvidenceReviewState());
  return state;
}

function validateSourceDetail(result, organizationId, workspaceId, sourceId, expectedRevision) {
  const source = result?.body?.source;
  if (!source || source.id !== sourceId || source.organizationId !== organizationId || source.workspaceId !== workspaceId || typeof source.content !== 'string') {
    throw new Error('Selected Source response crossed its validated parent context');
  }
  if (typeof result.revision !== 'string' || !/^[a-f0-9]{64}$/.test(result.revision) || result.revision !== expectedRevision) {
    const error = new Error('Priorena data changed while the Source was opening');
    error.code = 'REVISION_CONFLICT';
    throw error;
  }
  return source;
}

function exactExcerptSelection(content, startOffset, endOffset) {
  if (typeof content !== 'string' || !Number.isInteger(startOffset) || !Number.isInteger(endOffset) ||
    startOffset < 0 || endOffset <= startOffset || endOffset > content.length) {
    throw new TypeError('Select a non-empty exact excerpt from this Source');
  }
  const exactExcerpt = content.slice(startOffset, endOffset);
  if (!exactExcerpt.trim() || exactExcerpt.length > MAX_EXCERPT_CHARACTERS) {
    throw new TypeError('Selected excerpt must contain text and use 50,000 characters or fewer');
  }
  return Object.freeze({ startOffset, endOffset, exactExcerpt });
}

function explicitFindingAssociation(workItem, initiativeId) {
  const normalizedInitiativeId = initiativeId === null ? null : evidenceReviewStableId(initiativeId);
  if (workItem === null) return { workItemId: null, initiativeId: normalizedInitiativeId };
  evidenceReviewStableId(workItem?.id);
  if (workItem.initiativeId !== normalizedInitiativeId) throw new TypeError('Finding Initiative must exactly match the selected Work Item');
  return { workItemId: workItem.id, initiativeId: normalizedInitiativeId };
}

function findingAcceptance(currentness, workItem, initiativeId) {
  if (!FINDING_CURRENTNESS.includes(currentness)) throw new TypeError('Choose the reviewed Finding currentness');
  return { currentness, ...explicitFindingAssociation(workItem, initiativeId) };
}

function evidenceCompatibleWithWorkItem(evidence, workItem) {
  if (!evidence || !workItem || evidence.organizationId !== workItem.organizationId || evidence.workspaceId !== workItem.workspaceId) return false;
  if (evidence.workItemId !== null && evidence.workItemId !== workItem.id) return false;
  return evidence.initiativeId === null || evidence.initiativeId === workItem.initiativeId;
}

function proposedValue(field, rawValue) {
  if (!PROPOSED_CHANGE_FIELDS.includes(field)) throw new TypeError('Choose a supported current-state field');
  const value = typeof rawValue === 'string' ? rawValue : '';
  if (field === 'currentStateConfidence') {
    if (!['confirmed', 'inferred', 'unknown'].includes(value)) throw new TypeError('Choose a current-state confidence');
    return value;
  }
  if (field === 'lastCapturedCommentAt') {
    if (value === '') return null;
    if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new TypeError('Use an exact ISO timestamp or leave the value empty');
    return value;
  }
  if (['sourceStatus', 'assignee', 'sprint'].includes(field) && value === '') return null;
  const maximum = field === 'currentStateProvenance' ? 500 : (['assignee', 'sprint'].includes(field) ? 300 : 200);
  if (!value.trim() || value.length > maximum) throw new TypeError(`Enter a proposed ${field} value within its supported limit`);
  return value;
}

function buildProposedChange(findingId, evidenceIds, workItem, field, rawValue, evidence) {
  evidenceReviewStableId(findingId);
  evidenceReviewStableId(workItem?.id);
  if (!Array.isArray(evidenceIds) || evidenceIds.length === 0 || new Set(evidenceIds).size !== evidenceIds.length) {
    throw new TypeError('Select at least one unique compatible Evidence record');
  }
  evidenceIds.forEach(evidenceReviewStableId);
  const selected = evidenceIds.map(id => evidence.find(item => item.id === id));
  if (selected.some(item => !item || !evidenceCompatibleWithWorkItem(item, workItem))) {
    throw new TypeError('Every selected Evidence record must be compatible with the Work Item');
  }
  if (!selected.some(item => item.findingId === findingId)) throw new TypeError('Selected Evidence must include the accepted Finding');
  return {
    findingId,
    evidenceIds: [...evidenceIds],
    workItemId: workItem.id,
    field,
    proposedValue: proposedValue(field, rawValue)
  };
}

function valueLabel(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

const targetEvidenceReviewApi = {
  FINDING_CURRENTNESS,
  FINDING_PAGE_SIZE,
  MAX_EXCERPT_CHARACTERS,
  PROPOSED_CHANGE_FIELDS,
  buildProposedChange,
  clearEvidenceReviewState,
  createTargetEvidenceReviewApiClient,
  evidenceCompatibleWithWorkItem,
  evidenceReviewStableId,
  exactExcerptSelection,
  explicitFindingAssociation,
  findingAcceptance,
  newEvidenceReviewState,
  proposedValue,
  validateSourceDetail,
  valueLabel
};

if (typeof module !== 'undefined' && module.exports) module.exports = targetEvidenceReviewApi;
if (typeof window !== 'undefined') window.PriorenaTargetEvidenceReview = Object.freeze(targetEvidenceReviewApi);
