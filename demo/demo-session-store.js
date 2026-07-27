const crypto = require('node:crypto');
const { createDemoWorkspace } = require('./demo-fixture');

const DEFAULT_IDLE_MS = 60 * 60 * 1000;
const DEFAULT_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 500;
const MAX_MANUAL_CONTEXT_CHARS = 2_000;
const MAX_DEMO_ASSIGNEE_CHARS = 80;
const DEMO_STATUS_VALUES = Object.freeze(['Not started', 'Planned', 'In progress', 'Blocked', 'Done']);
const DEMO_WORK_ITEM_FIELDS = Object.freeze(['assignee', 'project', 'status', 'storyId']);
const DEMO_EVIDENCE_CATEGORIES = Object.freeze(['progress_update', 'blocker', 'dependency', 'risk', 'decision', 'action', 'question', 'other']);
const DEMO_EVIDENCE_FIELDS = Object.freeze(['attested', 'category', 'exactExcerpt', 'jiraId', 'project', 'sourceTitle', 'summary']);
const DEMO_EVIDENCE_REVIEW_FIELDS = Object.freeze(['findingId', 'project', 'reviewStatus']);
const DEMO_EVIDENCE_REVIEW_VALUES = Object.freeze(['accepted', 'rejected']);
const MAX_DEMO_EVIDENCE_RECORDS = 25;
const MAX_DEMO_SOURCE_TITLE_CHARS = 120;
const MAX_DEMO_EVIDENCE_SUMMARY_CHARS = 240;
const MAX_DEMO_EVIDENCE_EXCERPT_CHARS = 1_000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function isBoundedIdentifier(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && /^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(value);
}

function exactFields(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = Object.keys(value).sort();
  return fields.length === expected.length && fields.every((field, index) => field === expected[index]);
}

function boundedText(value, label, maxLength, options = {}) {
  if (typeof value !== 'string') throw validationError(`${label} must be text`);
  const text = value.trim();
  if (!text || text.length > maxLength) throw validationError(`${label} must be 1 to ${maxLength} characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) || (options.singleLine && /[\r\n]/.test(text))) {
    throw validationError(`${label} contains unsupported control characters`);
  }
  return text;
}

function containsSensitivePattern(text) {
  return /(?:https?:\/\/|www\.)/i.test(text)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)
    || /\b(?:password|passwd|api[_ -]?key|access[_ -]?token|secret)\s*[:=]/i.test(text)
    || /\b(?:sk|ghp|xox[baprs])[-_][A-Za-z0-9-]{12,}\b/i.test(text);
}

function sessionView(session) {
  return {
    id: session.id,
    createdAt: new Date(session.createdAtMs).toISOString(),
    lastActiveAt: new Date(session.lastActiveAtMs).toISOString(),
    idleExpiresAt: new Date(session.lastActiveAtMs + session.idleMs).toISOString(),
    absoluteExpiresAt: new Date(session.absoluteExpiresAtMs).toISOString(),
    manualContext: session.manualContext,
    workspace: clone(session.workspace)
  };
}

class DemoSessionStore {
  constructor(options = {}) {
    this.clock = options.clock || (() => Date.now());
    this.seedFactory = options.seedFactory || createDemoWorkspace;
    this.idleMs = options.idleMs || DEFAULT_IDLE_MS;
    this.absoluteMs = options.absoluteMs || DEFAULT_ABSOLUTE_MS;
    this.maxSessions = options.maxSessions || DEFAULT_MAX_SESSIONS;
    this.sessions = new Map();
  }

  isExpired(session, now = this.clock()) {
    return now >= session.absoluteExpiresAtMs || now - session.lastActiveAtMs >= session.idleMs;
  }

  sweepExpired(now = this.clock()) {
    for (const [id, session] of this.sessions) {
      if (this.isExpired(session, now)) this.sessions.delete(id);
    }
  }

  create() {
    const now = this.clock();
    this.sweepExpired(now);
    if (this.sessions.size >= this.maxSessions) {
      const error = new Error('The demo is at capacity; try again later');
      error.statusCode = 429;
      throw error;
    }
    const id = crypto.randomBytes(32).toString('hex');
    const session = {
      id,
      createdAtMs: now,
      lastActiveAtMs: now,
      absoluteExpiresAtMs: now + this.absoluteMs,
      idleMs: this.idleMs,
      manualContext: '',
      workspace: clone(this.seedFactory())
    };
    this.sessions.set(id, session);
    return sessionView(session);
  }

  get(id, options = {}) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    const now = this.clock();
    if (this.isExpired(session, now)) {
      this.sessions.delete(id);
      return null;
    }
    if (options.touch !== false) session.lastActiveAtMs = now;
    return sessionView(session);
  }

  updateManualContext(id, text) {
    if (typeof text !== 'string') {
      const error = new Error('Manual demo context must be text');
      error.statusCode = 400;
      throw error;
    }
    const value = text.trim();
    if (value.length > MAX_MANUAL_CONTEXT_CHARS) {
      const error = new Error(`Manual demo context must be ${MAX_MANUAL_CONTEXT_CHARS} characters or fewer`);
      error.statusCode = 400;
      throw error;
    }
    const session = this.sessions.get(id);
    if (!session || this.isExpired(session)) {
      if (session) this.sessions.delete(id);
      return null;
    }
    session.manualContext = value;
    session.lastActiveAtMs = this.clock();
    return sessionView(session);
  }

  updateWorkItem(id, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw validationError('Demo work-item update must be an object');
    }
    const fields = Object.keys(payload).sort();
    if (fields.length !== DEMO_WORK_ITEM_FIELDS.length || fields.some((field, index) => field !== DEMO_WORK_ITEM_FIELDS[index])) {
      throw validationError('Demo work-item update contains unsupported or missing fields');
    }
    if (!isBoundedIdentifier(payload.project, 120)) throw validationError('Demo project is invalid');
    if (!isBoundedIdentifier(payload.storyId, 100)) throw validationError('Demo work-item ID is invalid');
    if (!DEMO_STATUS_VALUES.includes(payload.status)) throw validationError('Demo status is invalid');
    if (typeof payload.assignee !== 'string') throw validationError('Demo assignee must be text');
    const assignee = payload.assignee.trim();
    if (!assignee || assignee.length > MAX_DEMO_ASSIGNEE_CHARS || /[\r\n\u0000-\u001f\u007f]/.test(assignee)) {
      throw validationError(`Demo assignee must be 1 to ${MAX_DEMO_ASSIGNEE_CHARS} visible characters`);
    }

    const session = this.sessions.get(id);
    if (!session || this.isExpired(session)) {
      if (session) this.sessions.delete(id);
      return null;
    }
    if (!Object.prototype.hasOwnProperty.call(session.workspace.projects, payload.project)) {
      throw validationError('Demo project was not found');
    }
    const project = session.workspace.projects[payload.project];
    const story = Array.isArray(project.stories)
      ? project.stories.find(candidate => candidate && candidate.id === payload.storyId)
      : null;
    if (!story) throw validationError('Demo work item was not found');

    story.status = payload.status;
    story.assignee = assignee;
    story.owner = assignee;
    session.lastActiveAtMs = this.clock();
    return sessionView(session);
  }

  addEvidence(id, payload) {
    if (!exactFields(payload, DEMO_EVIDENCE_FIELDS)) {
      throw validationError('Demo evidence contains unsupported or missing fields');
    }
    if (payload.attested !== true) throw validationError('Confirm that the evidence is fictional or sanitized');
    if (!isBoundedIdentifier(payload.project, 120)) throw validationError('Demo project is invalid');
    if (typeof payload.jiraId !== 'string' || !/^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,9}$/.test(payload.jiraId)) {
      throw validationError('Demo Jira key is invalid');
    }
    if (!DEMO_EVIDENCE_CATEGORIES.includes(payload.category)) throw validationError('Demo evidence category is invalid');
    const sourceTitle = boundedText(payload.sourceTitle, 'Demo source title', MAX_DEMO_SOURCE_TITLE_CHARS, { singleLine: true });
    const summary = boundedText(payload.summary, 'Demo evidence summary', MAX_DEMO_EVIDENCE_SUMMARY_CHARS, { singleLine: true });
    const exactExcerpt = boundedText(payload.exactExcerpt, 'Demo exact excerpt', MAX_DEMO_EVIDENCE_EXCERPT_CHARS);
    if (containsSensitivePattern(`${sourceTitle}\n${summary}\n${exactExcerpt}`)) {
      throw validationError('Demo evidence appears to contain a URL, email address, or secret-like value; sanitize it before continuing');
    }

    const session = this.sessions.get(id);
    if (!session || this.isExpired(session)) {
      if (session) this.sessions.delete(id);
      return null;
    }
    if (!Object.prototype.hasOwnProperty.call(session.workspace.projects, payload.project)) {
      throw validationError('Demo project was not found');
    }
    const project = session.workspace.projects[payload.project];
    const story = Array.isArray(project.stories)
      ? project.stories.find(candidate => candidate && candidate.jiraId === payload.jiraId)
      : null;
    if (!story) throw validationError('Demo Jira key was not found in this fictional project');
    const userEvidenceCount = (project.transcripts || []).filter(source => source && source.sourceKind === 'demo-sanitized-manual').length;
    if (userEvidenceCount >= MAX_DEMO_EVIDENCE_RECORDS) throw validationError('This demo session has reached its temporary evidence limit');

    const now = new Date(this.clock()).toISOString();
    const sourceId = `demo-source-${crypto.randomUUID()}`;
    const findingId = `demo-finding-${crypto.randomUUID()}`;
    if (!Array.isArray(project.transcripts)) project.transcripts = [];
    project.transcripts.push({
      id: sourceId,
      title: sourceTitle,
      type: 'Other External Evidence',
      sourceKind: 'demo-sanitized-manual',
      date: now.slice(0, 10),
      createdAt: now,
      sanitizedAttested: true,
      extractedFindings: [{
        id: findingId,
        sourceId,
        storyId: story.id,
        jiraId: story.jiraId,
        category: payload.category,
        exactExcerpt,
        summary,
        associationReason: `Exact Jira key ${story.jiraId} supplied by the demo user`,
        extractionMethod: 'manual-sanitized-demo',
        extractorVersion: 'priorena-demo-manual-v1',
        reviewStatus: 'pending',
        createdAt: now
      }]
    });
    session.lastActiveAtMs = this.clock();
    return sessionView(session);
  }

  reviewEvidence(id, payload) {
    if (!exactFields(payload, DEMO_EVIDENCE_REVIEW_FIELDS)) {
      throw validationError('Demo evidence review contains unsupported or missing fields');
    }
    if (!isBoundedIdentifier(payload.project, 120)) throw validationError('Demo project is invalid');
    if (typeof payload.findingId !== 'string' || !/^demo-finding-[a-f0-9-]{36}$/.test(payload.findingId)) {
      throw validationError('Demo finding ID is invalid');
    }
    if (!DEMO_EVIDENCE_REVIEW_VALUES.includes(payload.reviewStatus)) throw validationError('Demo evidence review decision is invalid');

    const session = this.sessions.get(id);
    if (!session || this.isExpired(session)) {
      if (session) this.sessions.delete(id);
      return null;
    }
    if (!Object.prototype.hasOwnProperty.call(session.workspace.projects, payload.project)) {
      throw validationError('Demo project was not found');
    }
    const project = session.workspace.projects[payload.project];
    let finding = null;
    for (const source of project.transcripts || []) {
      if (!source || source.sourceKind !== 'demo-sanitized-manual') continue;
      const candidate = (source.extractedFindings || []).find(item => item && item.id === payload.findingId);
      if (candidate) { finding = candidate; break; }
    }
    if (!finding) throw validationError('Demo evidence was not found');
    if (finding.reviewStatus !== 'pending') throw validationError('Demo evidence has already been reviewed');
    finding.reviewStatus = payload.reviewStatus;
    finding.reviewedAt = new Date(this.clock()).toISOString();
    session.lastActiveAtMs = this.clock();
    return sessionView(session);
  }

  destroy(id) {
    return typeof id === 'string' && this.sessions.delete(id);
  }
}

module.exports = {
  DEFAULT_ABSOLUTE_MS,
  DEFAULT_IDLE_MS,
  DEFAULT_MAX_SESSIONS,
  DEMO_EVIDENCE_CATEGORIES,
  MAX_DEMO_EVIDENCE_RECORDS,
  DEMO_STATUS_VALUES,
  MAX_DEMO_ASSIGNEE_CHARS,
  MAX_MANUAL_CONTEXT_CHARS,
  DemoSessionStore
};
