const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough, Readable } = require('node:stream');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmds-security-'));
process.env.PMDS_DATA_FILE = path.join(tempRoot, 'pilot-data.json');
process.env.PMDS_UPLOADS_DIR = path.join(tempRoot, 'uploads');
process.env.PMDS_RECOVERY_DIR = path.join(tempRoot, 'backups');
process.env.PRIORENA_DEMO_MODE = '1';
fs.writeFileSync(process.env.PMDS_DATA_FILE, JSON.stringify({ projects: {} }), { mode: 0o600 });

const {
  app,
  inferStoryStatus,
  isAcceptableCommentTimestamp,
  isLoopbackHost,
  isSafeProjectKey,
  parseCsv
} = require('../server');
const { storyFieldValue, validateExternalFeed } = require('../external-feed');
const { itemTypeOrUnknown, normalizeItemType } = require('../public/work-item-types');
const { escapeCsvCell, escapeMarkdownCell } = require('../public/security-utils');

function requestApp({ method = 'GET', url = '/', headers = {}, body = Buffer.alloc(0) }) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    let pushed = false;
    const req = new Readable({
      read() {
        if (pushed) return;
        pushed = true;
        if (payload.length) this.push(payload);
        this.push(null);
      }
    });
    req.method = method;
    req.url = url;
    req.headers = { host: '127.0.0.1:3000', ...headers };
    req.rawHeaders = Object.entries(req.headers).flat();
    req.socket = new PassThrough();
    Object.defineProperty(req.socket, 'remoteAddress', { value: '127.0.0.1' });
    req.connection = req.socket;
    req.on('error', reject);

    const responseHeaders = Object.create(null);
    const chunks = [];
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headersSent = false;
    res.destroyed = false;
    res.setHeader = (name, value) => { responseHeaders[String(name).toLowerCase()] = value; };
    res.getHeader = name => responseHeaders[String(name).toLowerCase()];
    res.getHeaders = () => ({ ...responseHeaders });
    res.removeHeader = name => { delete responseHeaders[String(name).toLowerCase()]; };
    res.write = (chunk, encoding, callback) => {
      res.headersSent = true;
      if (chunk) chunks.push(Buffer.from(chunk));
      if (typeof encoding === 'function') encoding();
      if (callback) callback();
      return true;
    };
    res.end = (chunk, encoding, callback) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      res.headersSent = true;
      res.finished = true;
      if (typeof encoding === 'function') encoding();
      if (callback) callback();
      res.emit('finish');
      resolve({
        status: res.statusCode,
        headers: responseHeaders,
        body: Buffer.concat(chunks).toString('utf8'),
        json() { return JSON.parse(this.body); }
      });
    };
    res.destroy = error => {
      res.destroyed = true;
      if (error) reject(error);
      res.emit('close');
    };
    res.writeHead = (statusCode, nextHeaders) => {
      res.statusCode = statusCode;
      if (nextHeaders) Object.entries(nextHeaders).forEach(([name, value]) => res.setHeader(name, value));
      res.headersSent = true;
      return res;
    };

    app.handle(req, res, reject);
  });
}

function jsonRequest(method, url, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  return requestApp({
    method,
    url,
    headers: { 'content-type': 'application/json', 'content-length': String(body.length), ...headers },
    body
  });
}

function multipartRequest(fields, files) {
  const boundary = `----pmds-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  const append = value => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  Object.entries(fields).forEach(([name, value]) => {
    append(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  });
  files.forEach(file => {
    append(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field || 'file'}"; filename="${file.name}"\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`);
    append(file.content);
    append('\r\n');
  });
  append(`--${boundary}--\r\n`);
  const body = Buffer.concat(chunks);
  return {
    body,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) }
  };
}

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

test('loopback and reserved-key helpers enforce the local project boundary', () => {
  assert.equal(isLoopbackHost('127.0.0.1:3000'), true);
  assert.equal(isLoopbackHost('localhost:3000'), true);
  assert.equal(isLoopbackHost('attacker.example:3000'), false);
  assert.equal(isSafeProjectKey('Fictional Program'), true);
  assert.equal(isSafeProjectKey('__proto__'), false);
  assert.equal(isSafeProjectKey('constructor'), false);
});

test('demo API creates isolated temporary sessions without exposing the session token', async () => {
  let response = await jsonRequest('POST', '/api/demo/session', {});
  assert.equal(response.status, 201);
  assert.equal(response.json().workspace.demoMetadata.fictional, true);
  assert.equal(response.json().id, undefined);
  assert.match(response.headers['set-cookie'], /^priorena_demo_session=[a-f0-9]{64};/);
  assert.match(response.headers['set-cookie'], /HttpOnly/);
  assert.match(response.headers['set-cookie'], /SameSite=Strict/);
  const firstCookie = response.headers['set-cookie'].split(';')[0];

  response = await jsonRequest('POST', '/api/demo/session', {});
  assert.equal(response.status, 201);
  const secondCookie = response.headers['set-cookie'].split(';')[0];
  assert.notEqual(firstCookie, secondCookie);

  response = await jsonRequest('PUT', '/api/demo/session/manual-context', {
    text: 'A temporary fictional note for leadership.'
  }, { cookie: firstCookie });
  assert.equal(response.status, 200);
  assert.equal(response.json().manualContext, 'A temporary fictional note for leadership.');

  response = await jsonRequest('PUT', '/api/demo/session/work-item', {
    project: 'Northstar Launch',
    storyId: 'demo-story-101',
    status: 'Done',
    assignee: 'Jordan Rivera'
  }, { cookie: firstCookie });
  assert.equal(response.status, 200);
  assert.equal(response.json().workspace.projects['Northstar Launch'].stories[0].status, 'Done');
  assert.equal(response.json().workspace.projects['Northstar Launch'].stories[0].assignee, 'Jordan Rivera');

  response = await jsonRequest('POST', '/api/demo/session/evidence', {
    project: 'Northstar Launch',
    jiraId: 'DEMO-101',
    category: 'progress_update',
    sourceTitle: 'Fictional readiness note',
    summary: 'Checklist review is underway.',
    exactExcerpt: 'DEMO-101 checklist review is underway in the fictional launch exercise.',
    attested: true
  }, { cookie: firstCookie });
  assert.equal(response.status, 201);
  const submittedSource = response.json().workspace.projects['Northstar Launch'].transcripts.at(-1);
  const submittedFinding = submittedSource.extractedFindings[0];
  assert.equal(submittedSource.sourceKind, 'demo-sanitized-manual');
  assert.equal(submittedFinding.reviewStatus, 'pending');

  response = await jsonRequest('PUT', '/api/demo/session/evidence/review', {
    project: 'Northstar Launch',
    findingId: submittedFinding.id,
    reviewStatus: 'accepted'
  }, { cookie: firstCookie });
  assert.equal(response.status, 200);
  assert.equal(response.json().workspace.projects['Northstar Launch'].transcripts.at(-1).extractedFindings[0].reviewStatus, 'accepted');

  response = await requestApp({ url: '/api/demo/session', headers: { cookie: secondCookie } });
  assert.equal(response.status, 200);
  assert.equal(response.json().manualContext, '');
  assert.equal(response.json().workspace.projects['Northstar Launch'].stories[0].status, 'In progress');
  assert.equal(response.json().workspace.projects['Northstar Launch'].transcripts.length, 1);

  response = await jsonRequest('POST', '/api/demo/session/evidence', {
    project: 'Northstar Launch',
    jiraId: 'DEMO-101',
    category: 'other',
    sourceTitle: 'Fictional note',
    summary: 'Secret-like content should be rejected.',
    exactExcerpt: 'api key: not-safe-for-demo',
    attested: true
  }, { cookie: firstCookie });
  assert.equal(response.status, 400);

  response = await jsonRequest('PUT', '/api/demo/session/work-item', {
    project: 'Northstar Launch',
    storyId: 'demo-story-101',
    status: 'Done',
    assignee: 'Jordan Rivera',
    summary: 'Unsupported mutation'
  }, { cookie: firstCookie });
  assert.equal(response.status, 400);

  response = await jsonRequest('PUT', '/api/demo/session/manual-context', {
    text: 'x'.repeat(2001)
  }, { cookie: firstCookie });
  assert.equal(response.status, 400);

  response = await requestApp({ method: 'DELETE', url: '/api/demo/session', headers: { cookie: firstCookie } });
  assert.equal(response.status, 200);
  response = await requestApp({ url: '/api/demo/session', headers: { cookie: firstCookie } });
  assert.equal(response.status, 401);
});

test('generated controls contain no executable inline handlers', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const stylesSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const packageMetadata = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.doesNotMatch(source, /\son(?:click|change|input|dragover|dragleave|drop)=/);
  assert.match(serverSource, /process\.env\.PRIORENA_DEMO_MODE === '1'/);
  assert.match(indexSource, /id="demo-mode-button"/);
  assert.match(indexSource, /id="demo-shell"/);
  assert.match(source, /function fetchDemoConfig\(\)/);
  assert.match(source, /function setDemoExperienceActive\(active\)/);
  assert.match(source, /function activateDemoTab\(tab\)/);
  assert.match(source, /if \(demoSession\) \{\s*activateDemoTab\(tab\);\s*return;/);
  assert.match(source, /mainNav\.inert = false/);
  assert.match(source, /projectSelector\.inert = active/);
  assert.match(source, /viewArea\?\.classList\.toggle\('hidden', active\)/);
  assert.match(source, /function renderDemoOverview\(data\)/);
  assert.match(source, /function renderDemoWork\(data\)/);
  assert.match(source, /function renderDemoFollowUp\(data\)/);
  assert.match(source, /function renderDemoMilestones\(data\)/);
  assert.match(source, /function renderDemoCapture\(data\)/);
  assert.match(source, /function renderDemoCommunicate\(data, teamsOnly = false\)/);
  assert.match(source, /function renderDemoSettings\(data\)/);
  assert.match(source, /function renderDemoHelp\(\)/);
  assert.match(source, /function demoTryThis\(instruction, interaction = 'Read-only example'\)/);
  assert.match(source, /Suggested demo workflow/);
  assert.match(source, /helpButton\?\.classList\.remove\('hidden'\)/);
  assert.match(source, /helpButton\.textContent = 'Demo guide'/);
  assert.match(source, /<details class="card help-section help-disclosure"/);
  assert.match(stylesSource, /\.help-disclosure summary/);
  assert.match(stylesSource, /\.demo-flow-guide/);
  assert.match(source, /async function initializeApp\(\) \{\s*await fetchDemoConfig\(\);\s*if \(!demoSession\) await fetchProjects\(\);/);
  const demoRenderers = source.slice(source.indexOf('function demoViewModel()'), source.indexOf('function setDemoExperienceActive(active)'));
  assert.doesNotMatch(demoRenderers, /\bfetch\s*\(/);
  const demoRuntime = source.slice(source.indexOf('async function fetchDemoConfig()'), source.indexOf('async function fetchMeta()'));
  const demoFetchPaths = [...demoRuntime.matchAll(/\bfetch\('([^']+)'/g)].map(match => match[1]);
  assert.ok(demoFetchPaths.length >= 7);
  assert.equal(demoFetchPaths.every(value => value.startsWith('/api/demo/')), true);
  assert.match(source, /FICTIONAL · TEMPORARY/);
  assert.match(source, /no private workspace access/);
  assert.match(source, /saveDemoWorkItem/);
  assert.match(source, /\/api\/demo\/session\/work-item/);
  assert.match(source, /submitDemoEvidence/);
  assert.match(source, /reviewDemoEvidence/);
  assert.match(source, /SANITIZED TEXT ONLY · REVIEW FIRST/);
  assert.match(source, /\/api\/demo\/session\/evidence\/review/);
  assert.match(source, /A fictional starter project was loaded automatically/);
  assert.match(source, /START HERE/);
  assert.match(source, /Demo versus normal workspace/);
  assert.match(source, /What Priorena does not do/);
  assert.doesNotMatch(source, /\beval\s*\(|new Function\s*\(/);
  assert.match(source, /DECLARATIVE_ACTIONS/);
  assert.match(source, /js-copy-text/);
  assert.doesNotMatch(source, /data-onclick=['"]copyText\(/);
  assert.match(source, /id="external-feed-file"[^>]+accept="\.json,\.md/);
  assert.match(source, /for="external-feed-file">Choose feed<\/label>/);
  assert.match(source, /class="external-feed-file-name">\$\{fileSummary\}/);
  assert.match(source, /PARTIAL FEED REQUIREMENT/);
  assert.match(indexSource, /<title>Priorena<\/title>/);
  assert.match(indexSource, /<h1>Priorena<\/h1>/);
  assert.match(indexSource, /PM delivery intelligence/);
  assert.match(indexSource, /id="briefings-panel"/);
  assert.doesNotMatch(indexSource, /PM Delivery Steward|Delivery PM/);
  assert.match(source, /external evidence feed for Priorena/);
  assert.doesNotMatch(source, /PM Delivery Steward/);
  assert.match(serverSource, /filename="priorena-backup-\$\{date\}\.json"/);
  assert.match(serverSource, /Priorena listening on http:\/\/127\.0\.0\.1/);
  assert.equal(packageMetadata.name, 'priorena');
  assert.match(serverSource, /process\.env\.PMDS_DATA_FILE/);
  assert.match(serverSource, /process\.env\.PMDS_UPLOADS_DIR/);
  assert.match(source, /schemaVersion "pm-external-feed\/v3"/);
  assert.match(source, /pm-external-feed\.json/);
  assert.match(source, /promptVersion": "pm-external-feed-v3\.0"/);
  assert.match(source, /Never infer an Epic from a similar title/);
  assert.match(source, /missing itemType must never block partial-feed creation/i);
  assert.match(source, /id="story-item-type">\$\{itemTypeOptions\('Story'\)\}/);
  assert.match(source, /id="new-item-type">\$\{itemTypeOptions\('Story'\)\}/);
  assert.match(source, /const displaySummary = item\.matchType === 'new' \? proposedSummary : \(currentItem\?\.summary \|\| proposedSummary\)/);
  assert.match(source, /external-feed-item-heading/);
  assert.match(source, /toggleExternalFeedAllFields/);
  assert.match(source, /> Replace all<\/label>/);
  assert.match(source, /Creation unavailable—Summary required/);
  assert.match(source, /Approve creation first/);
  assert.match(source, /item\.matchType === 'new' && !creationApproved/);
  assert.match(source, /Reconciliation preview cleared\./);
  assert.match(source, /function renderBriefingsPanel\(\)/);
  assert.match(source, /Brief from what changed—not from memory/);
  assert.match(source, /none selected by default/);
  assert.match(source, /Manual PM input/);
  assert.match(source, /Mark communicated/);
  assert.match(source, /Generate outputs/);
  assert.match(source, /same finalized fact set · deterministic/);
  assert.match(source, /function renderBriefingOutputs\(briefing\)/);
  assert.match(source, /function renderBriefingEvidenceCandidates\(briefing\)/);
  assert.match(source, /Accepted evidence/);
  assert.match(source, /reviewed in Capture · none selected by default/);
  assert.match(source, /This advances the comparison baseline for this stream/);
  assert.match(source, /Snapshot captured/);
  assert.match(source, /Choose the first briefing facts/);
  assert.match(source, /Add or select at least one fact to continue/);
  assert.match(source, /disabled title="Add or select at least one fact first"/);
  assert.match(source, /briefings: 'reports'/);
  assert.match(source, /const CAPTURE_LIST_PAGE_SIZE = 5/);
  assert.match(source, /toggleCaptureSection/);
  assert.match(source, /setCaptureListPage/);
  assert.match(source, /ChatGPT evidence feed/);
  assert.match(source, /Open one finding to review/);
  assert.match(source, /Pending non-DSU evidence appears here/);
  assert.match(source, /No pending evidence findings\. Turn on Show reviewed/);
  assert.match(source, /toggleEvidenceShowReviewed/);
  assert.match(source, /id="dsu-select-page"/);
  assert.match(source, /data-onclick="clearDsuSelection\(\)"/);
  assert.match(source, /data-onclick="acceptSelectedDsuUpdates\(\)"/);
  assert.match(source, /data-onclick="rejectSelectedDsuUpdates\(\)"/);
  assert.match(source, /toggleDsuShowReviewed/);
  assert.match(source, /reviewDsuFindingAgain/);
  assert.match(source, /No pending DSU updates\. Turn on Show reviewed/);
  assert.match(source, /Work-item updates created\./);
  assert.match(source, /No work-item updates created\./);
  assert.match(source, /Queue refreshed\./);
  assert.match(source, /List refreshed\./);
  assert.match(source, /capturePagination\('sources'/);
  assert.match(source, /capturePagination\('findings'/);
  assert.match(source, /capturePagination\('updates'/);
  assert.match(source, /"id": "unlinked-evidence-1"/);
  assert.match(source, /Every unlinkedEvidence record must include a unique id/);
  assert.match(source, /partial feed/);
  const externalFeedPrompt = source.match(/const EXTERNAL_FEED_PROMPT = `([\s\S]*?)`;\n\nfunction externalFeedSelectionKey/);
  assert.ok(externalFeedPrompt);
  assert.ok(externalFeedPrompt[1].length <= 8000, `Custom GPT instructions exceed 8,000 characters: ${externalFeedPrompt[1].length}`);
  assert.doesNotMatch(source, /id="screenshot-import-files"|accept="[^"]*image\//);
  const actionBlock = source.match(/const DECLARATIVE_ACTIONS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(actionBlock);
  const allowed = new Set([...actionBlock[1].matchAll(/'([A-Za-z_$][\w$]*)'/g)].map(match => match[1]));
  const used = [...source.matchAll(/data-on(?:click|change|input|dragover|dragleave|drop)=["'](?:if\(this\.value\))?([A-Za-z_$][\w$]*)\(/g)].map(match => match[1]);
  assert.deepEqual([...new Set(used.filter(name => !allowed.has(name)))], []);
});

test('public source and documentation are English-only', () => {
  const files = [
    'README.md',
    'SECURITY.md',
    'PRIVACY.md',
    'SECURITY_REVIEW_SUMMARY.md',
    'EXTERNAL_FEED_SCHEMA.md',
    'demo/demo-fixture.js',
    'public/app.js',
    'public/index.html'
  ];
  files.forEach(file => {
    const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(content, /[\u0400-\u04ff]/, `${file} should contain English-language text only`);
  });
});

test('management UI exposes bounded bulk work, source, and milestone controls', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(source, /Select all matching filters/);
  assert.match(source, /Review selected work items/);
  assert.match(source, /master\.indeterminate = selectedVisible > 0/);
  assert.match(source, /Local Priorena change only — this does not update Jira/);
  assert.match(source, /Protected delete/);
  assert.match(source, /private recovery snapshot/);
  assert.match(source, /Reconcile existing Jira keys/);
  assert.match(styles, /\.bulk-work-toolbar/);
  assert.match(styles, /\.work-table-card\.selected/);

  assert.match(source, /id="source-select-page"/);
  assert.match(source, /data-onclick="clearSourceSelection\(\)"/);
  assert.match(source, /data-onclick="deleteSelectedSources\(\)"/);
  assert.match(source, /extracted findings and any DSU work-item updates derived from them/);
  assert.match(styles, /\.source-library-main/);

  assert.match(source, /const MILESTONE_STATUS_VALUES = \['Planned', 'In progress', 'At risk', 'Blocked', 'Completed', 'Cancelled'\]/);
  assert.match(source, /data-onclick="startTimelineEdit/);
  assert.match(source, /data-onclick="saveTimelineEdit/);
  assert.match(source, /Milestone changes are local to Priorena and do not update Jira/);
  assert.match(serverSource, /Milestone status must be one of/);
  assert.match(styles, /\.milestone-row-editing/);
});

test('milestones use canonical statuses and support validated edits', async () => {
  let response = await jsonRequest('POST', '/api/projects', { name: 'Milestone Status Project' });
  assert.equal(response.status, 200);

  response = await jsonRequest('POST', '/api/project/timeline', {
    project: 'Milestone Status Project', title: 'Fictional planned checkpoint',
    date: '2026-08-15', status: 'Almost finished', notes: 'Fictional test only'
  });
  assert.equal(response.status, 400);
  assert.match(response.json().error, /Milestone status must be one of/);

  response = await jsonRequest('POST', '/api/project/timeline', {
    project: 'Milestone Status Project', title: 'Fictional planned checkpoint',
    date: '2026-08-15', notes: 'Fictional test only'
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().status, 'Planned');
  const milestoneId = response.json().id;

  response = await jsonRequest('PUT', '/api/project/timeline', {
    project: 'Milestone Status Project', id: milestoneId, status: 'Nearly done'
  });
  assert.equal(response.status, 400);

  response = await jsonRequest('PUT', '/api/project/timeline', {
    project: 'Milestone Status Project', id: milestoneId,
    title: 'Fictional completed checkpoint', date: '2026-08-16',
    status: 'Completed', notes: 'Reviewed locally'
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().status, 'Completed');
  assert.equal(response.json().title, 'Fictional completed checkpoint');
  fs.writeFileSync(process.env.PMDS_DATA_FILE, JSON.stringify({ projects: {} }), { mode: 0o600 });
});

test('bulk source deletion is atomic and removes derived updates', async () => {
  let response = await jsonRequest('POST', '/api/projects', { name: 'Source Deletion Project' });
  assert.equal(response.status, 200);
  response = await jsonRequest('POST', '/api/project/story', {
    project: 'Source Deletion Project', itemType: 'Story', summary: 'Validate fictional source deletion',
    jiraId: 'SAFE-101', assignee: 'Taylor'
  });
  assert.equal(response.status, 200);
  const storyId = response.json().id;

  const uploadSource = async (title, notes) => {
    const form = multipartRequest({ project: 'Source Deletion Project', title, type: 'DSU', notes }, []);
    const uploadResponse = await requestApp({ method: 'POST', url: '/api/project/transcript', ...form });
    assert.equal(uploadResponse.status, 200);
    return uploadResponse.json().transcripts[0];
  };
  const first = await uploadSource('Fictional source one', 'SAFE-101 is moving through fictional validation.');
  const second = await uploadSource('Fictional source two', 'SAFE-101 completed another fictional review step.');
  const firstFinding = first.extractedFindings.find(finding => finding.category === 'progress_update');
  assert.ok(firstFinding);
  response = await jsonRequest('PUT', '/api/project/transcript/finding', {
    project: 'Source Deletion Project', transcriptId: first.id, findingId: firstFinding.id,
    reviewStatus: 'accepted', storyId
  });
  assert.equal(response.status, 200);

  response = await jsonRequest('DELETE', '/api/project/transcripts', {
    project: 'Source Deletion Project', transcriptIds: [first.id, 'missing-source']
  });
  assert.equal(response.status, 404);
  response = await requestApp({ url: '/api/project?name=Source%20Deletion%20Project' });
  assert.equal(response.json().transcripts.length, 2);
  assert.equal(response.json().stories[0].updates.length, 1);

  response = await jsonRequest('DELETE', '/api/project/transcripts', {
    project: 'Source Deletion Project', transcriptIds: [first.id, second.id]
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().deleted, 2);
  assert.match(response.json().recoverySnapshot, /^priorena-pre-source-delete-/);
  assert.ok(fs.existsSync(path.join(process.env.PMDS_RECOVERY_DIR, response.json().recoverySnapshot)));

  response = await requestApp({ url: '/api/project?name=Source%20Deletion%20Project' });
  assert.equal(response.json().transcripts.length, 0);
  assert.equal(response.json().stories[0].updates.length, 0);
  fs.writeFileSync(process.env.PMDS_DATA_FILE, JSON.stringify({ projects: {} }), { mode: 0o600 });
});

test('workspace backup uses the Priorena download name', async () => {
  const response = await requestApp({ url: '/api/backup' });
  assert.equal(response.status, 200);
  assert.match(response.headers['content-disposition'], /^attachment; filename="priorena-backup-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.deepEqual(response.json(), { projects: {}, briefingStreams: [], briefings: [] });
});

test('briefing routes enforce the draft-finalize-communicate lifecycle and independent baseline', async () => {
  let response = await jsonRequest('POST', '/api/projects', { name: 'Fictional Briefing Project' });
  assert.equal(response.status, 200);

  response = await jsonRequest('POST', '/api/project/story', {
    project: 'Fictional Briefing Project', itemType: 'Story', summary: 'Prepare fictional rollout',
    jiraId: 'DEMO-1', assignee: 'Taylor'
  });
  assert.equal(response.status, 200);
  const story = response.json();

  const evidenceForm = multipartRequest({
    project: 'Fictional Briefing Project', title: 'Fictional briefing DSU', type: 'DSU',
    notes: 'DEMO-1 is blocked while a fictional review completes.'
  }, []);
  response = await requestApp({ method: 'POST', url: '/api/project/transcript', ...evidenceForm });
  assert.equal(response.status, 200);
  const evidenceTranscript = response.json().transcripts[0];
  const acceptedFinding = evidenceTranscript.extractedFindings[0];
  response = await jsonRequest('PUT', '/api/project/transcript/finding', {
    project: 'Fictional Briefing Project', transcriptId: evidenceTranscript.id,
    findingId: acceptedFinding.id, reviewStatus: 'accepted'
  });
  assert.equal(response.status, 200);

  response = await jsonRequest('POST', '/api/briefing-streams', {
    name: 'Fictional leadership briefing',
    projectNames: ['Fictional Briefing Project'],
    audienceProfile: 'manager',
    preferredFormats: ['teams', 'email'],
    defaultSections: ['progress', 'risk']
  });
  assert.equal(response.status, 201);
  const stream = response.json();

  response = await jsonRequest('POST', '/api/briefing-streams', {
    name: 'Fictional leadership briefing',
    projectNames: ['Fictional Briefing Project'],
    audienceProfile: 'manager', preferredFormats: ['teams'], defaultSections: ['progress']
  });
  assert.equal(response.status, 409);

  response = await jsonRequest('POST', '/api/briefings', { streamId: stream.id });
  assert.equal(response.status, 201);
  const first = response.json();
  assert.equal(first.status, 'draft');
  assert.equal(first.comparisonBriefingId, null);
  assert.deepEqual(first.detectedChanges, []);

  response = await requestApp({ url: `/api/briefings/${encodeURIComponent(first.id)}/evidence-candidates` });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json().map(item => item.id), [acceptedFinding.id]);

  response = await jsonRequest('POST', `/api/briefings/${encodeURIComponent(first.id)}/finalize`, {});
  assert.equal(response.status, 400);
  assert.match(response.json().error, /included fact/);

  response = await jsonRequest('PUT', `/api/briefings/${encodeURIComponent(first.id)}/facts`, {
    facts: [{
      category: 'progress', projectName: 'Fictional Briefing Project', origin: 'evidence',
      sourceEvidenceIds: ['invented-evidence'], detectedText: 'Invented support',
      editedText: 'Invented support', included: true
    }]
  });
  assert.equal(response.status, 400);
  assert.match(response.json().error, /unknown supporting source/);

  response = await jsonRequest('PUT', `/api/briefings/${encodeURIComponent(first.id)}/facts`, {
    facts: [{
      category: 'blocker', projectName: 'Fictional Briefing Project', workItemId: story.id,
      jiraId: 'DEMO-1', origin: 'evidence', sourceEvidenceIds: [acceptedFinding.id],
      detectedText: acceptedFinding.exactExcerpt, editedText: acceptedFinding.summary, included: true
    }]
  });
  assert.equal(response.status, 200);

  response = await jsonRequest('PUT', '/api/project/transcript/finding', {
    project: 'Fictional Briefing Project', transcriptId: evidenceTranscript.id,
    findingId: acceptedFinding.id, reviewStatus: 'pending'
  });
  assert.equal(response.status, 200);
  response = await jsonRequest('POST', `/api/briefings/${encodeURIComponent(first.id)}/finalize`, {});
  assert.equal(response.status, 400);
  assert.match(response.json().error, /no longer accepted/);

  response = await jsonRequest('PUT', '/api/project/transcript/finding', {
    project: 'Fictional Briefing Project', transcriptId: evidenceTranscript.id,
    findingId: acceptedFinding.id, reviewStatus: 'accepted'
  });
  assert.equal(response.status, 200);

  response = await jsonRequest('POST', `/api/briefings/${encodeURIComponent(first.id)}/finalize`, {});
  assert.equal(response.status, 200);
  assert.equal(response.json().status, 'finalized');
  assert.equal(response.json().facts[0].origin, 'evidence');
  response = await jsonRequest('PUT', `/api/briefings/${encodeURIComponent(first.id)}/facts`, { facts: [] });
  assert.equal(response.status, 400);
  assert.match(response.json().error, /draft briefing/);

  response = await jsonRequest('POST', `/api/briefings/${encodeURIComponent(first.id)}/outputs`, {});
  assert.equal(response.status, 200);
  assert.deepEqual(response.json().outputs.map(output => output.format), ['teams', 'email']);
  assert.ok(response.json().outputs.every(output => output.sourceFactIds.length === 1));
  assert.ok(response.json().outputs.every(output => !output.content.includes('[Manual PM input]')));

  response = await jsonRequest('POST', `/api/briefings/${encodeURIComponent(first.id)}/communicate`, {});
  assert.equal(response.status, 200);
  assert.equal(response.json().stream.lastCommunicatedBriefingId, first.id);
  assert.equal(response.json().briefing.status, 'communicated');
  assert.equal(response.json().briefing.outputs.length, 2);

  response = await jsonRequest('POST', `/api/briefings/${encodeURIComponent(first.id)}/outputs`, {});
  assert.equal(response.status, 400);
  assert.match(response.json().error, /only for a finalized briefing/);

  response = await jsonRequest('PUT', '/api/project/story', {
    project: 'Fictional Briefing Project', id: story.id, assignee: 'Morgan'
  });
  assert.equal(response.status, 200);

  response = await jsonRequest('POST', '/api/briefings', { streamId: stream.id });
  assert.equal(response.status, 201);
  const second = response.json();
  assert.equal(second.comparisonBriefingId, first.id);
  const ownerChange = second.detectedChanges.find(change => change.field === 'owner');
  assert.ok(ownerChange);
  assert.equal(ownerChange.before, 'Taylor');
  assert.equal(ownerChange.after, 'Morgan');

  response = await jsonRequest('PUT', `/api/briefings/${encodeURIComponent(second.id)}/facts`, {
    facts: [{
      category: 'progress', projectName: 'Fictional Briefing Project', workItemId: story.id,
      jiraId: 'DEMO-1', origin: 'work_item_change', sourceEvidenceIds: [ownerChange.id],
      detectedText: 'Owner changed from Taylor to Morgan.',
      editedText: 'DEMO-1 ownership changed from Taylor to Morgan.', included: true
    }]
  });
  assert.equal(response.status, 200);

  response = await jsonRequest('POST', `/api/briefings/${encodeURIComponent(second.id)}/finalize`, {});
  assert.equal(response.status, 200);
  assert.equal(response.json().status, 'finalized');
  response = await jsonRequest('POST', `/api/briefings/${encodeURIComponent(second.id)}/outputs`, {});
  assert.equal(response.status, 200);
  assert.ok(response.json().outputs.every(output => output.content.includes('DEMO-1 ownership changed from Taylor to Morgan.')));
  response = await jsonRequest('POST', `/api/briefings/${encodeURIComponent(second.id)}/communicate`, {});
  assert.equal(response.status, 200);
  assert.equal(response.json().stream.lastCommunicatedBriefingId, second.id);

  response = await requestApp({ url: `/api/briefings?streamId=${encodeURIComponent(stream.id)}` });
  assert.equal(response.status, 200);
  assert.equal(response.json().length, 2);

  response = await jsonRequest('DELETE', `/api/briefing-streams/${encodeURIComponent(stream.id)}`, {});
  assert.equal(response.status, 409);
  response = await jsonRequest('DELETE', '/api/project?name=Fictional%20Briefing%20Project', {});
  assert.equal(response.status, 409);
});

test('CSV and Markdown exports neutralize active content and delimiters', () => {
  assert.equal(escapeCsvCell('=HYPERLINK("https://example.test")'), '"\'=HYPERLINK(""https://example.test"")"');
  assert.equal(escapeCsvCell('  +1+1'), '"\'  +1+1"');
  assert.equal(escapeCsvCell('ordinary text'), '"ordinary text"');
  assert.equal(escapeMarkdownCell('a\\b|c\nd'), 'a\\\\b\\|c<br>d');
  assert.equal(escapeMarkdownCell('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('status and freshness parsing reject semantic substring and future-date traps', () => {
  assert.equal(inferStoryStatus({ labels: ['done'] }), 'Done');
  assert.equal(inferStoryStatus({ labels: ['not done'] }), 'Not started');
  assert.equal(inferStoryStatus({ labels: ['inactive'] }), 'Not started');
  assert.equal(inferStoryStatus({ labels: ['in-progress'] }), 'In progress');
  assert.equal(isAcceptableCommentTimestamp('2026-07-15T12:00:00.000Z', Date.parse('2026-07-16T12:00:00.000Z')), true);
  assert.equal(isAcceptableCommentTimestamp('2027-07-16T12:00:00.000Z', Date.parse('2026-07-16T12:00:00.000Z')), false);
  assert.equal(isAcceptableCommentTimestamp('not-a-date', Date.parse('2026-07-16T12:00:00.000Z')), false);
});

test('settings search is escaped before it is rendered into an attribute', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(source, /value="\$\{escapeHtml\(manageSearch\)\}"/);
});

test('CSV preview rejects row and cell amplification', () => {
  const tooManyRows = ['Summary', ...Array.from({ length: 1001 }, (_, index) => `Item ${index}`)].join('\n');
  assert.throws(() => parseCsv(tooManyRows), /limited to 1,000 work items/);
  assert.throws(() => parseCsv(`Summary\n${'x'.repeat(100001)}`), /cells are limited/);
  assert.deepEqual(parseCsv('Summary,Jira\nA,PM-1'), [['Summary', 'Jira'], ['A', 'PM-1']]);
});

test('responses enforce a strict script policy and security headers', async () => {
  const response = await requestApp({ url: '/api/projects' });
  assert.equal(response.status, 200);
  const policy = response.headers['content-security-policy'];
  assert.match(policy, /script-src 'self'/);
  assert.doesNotMatch(policy, /script-src[^;]*(?:unsafe-inline|unsafe-eval)/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
});

test('Host, Origin, and Fetch Metadata checks reject hostile mutation requests', async () => {
  const wrongHost = await jsonRequest('POST', '/api/projects', { name: 'Blocked' }, { host: 'attacker.example' });
  assert.equal(wrongHost.status, 421);

  const crossOrigin = await jsonRequest('POST', '/api/project/transcript', { project: 'Anything', notes: 'notes-only request' }, {
    origin: 'https://attacker.example',
    'sec-fetch-site': 'cross-site'
  });
  assert.equal(crossOrigin.status, 403);
});

test('declared requests above the aggregate limit are rejected before parsing', async () => {
  const response = await requestApp({
    method: 'POST',
    url: '/api/projects',
    headers: { 'content-type': 'application/json', 'content-length': String(20 * 1024 * 1024 + 1) }
  });
  assert.equal(response.status, 413);
  assert.deepEqual(response.json(), { error: 'Request body must be 20 MB or smaller' });
});

test('unsupported and rejected uploads leave no files behind', async () => {
  let response = await jsonRequest('POST', '/api/projects', { name: 'Demo Project' });
  assert.equal(response.status, 200);

  let form = multipartRequest({ project: 'Demo Project' }, [
    { name: 'payload.html', type: 'text/html', content: '<script>alert(1)</script>' }
  ]);
  response = await requestApp({ method: 'POST', url: '/api/project/transcript', ...form });
  assert.equal(response.status, 400);
  assert.deepEqual(fs.readdirSync(process.env.PMDS_UPLOADS_DIR), []);

  form = multipartRequest({ project: 'Missing Project' }, [
    { name: 'note.txt', type: 'text/plain', content: 'ordinary text' }
  ]);
  response = await requestApp({ method: 'POST', url: '/api/project/transcript', ...form });
  assert.equal(response.status, 404);
  assert.deepEqual(fs.readdirSync(process.env.PMDS_UPLOADS_DIR), []);
});

test('valid local upload and reserved project rejection remain supported', async () => {
  const reserved = await jsonRequest('POST', '/api/projects', { name: 'constructor' });
  assert.equal(reserved.status, 400);

  const notesOnly = multipartRequest({ project: 'Demo Project', title: 'Planning note', type: 'Meeting', notes: 'A factual local note.' }, []);
  let response = await requestApp({ method: 'POST', url: '/api/project/transcript', ...notesOnly });
  assert.equal(response.status, 200);
  assert.equal(response.json().transcripts.length, 1);
  assert.equal(fs.readdirSync(process.env.PMDS_UPLOADS_DIR).length, 0);

  const form = multipartRequest({ project: 'Demo Project', type: 'Notes' }, [
    { name: 'note.txt', type: 'text/plain', content: 'A fictional delivery note.' }
  ]);
  response = await requestApp({ method: 'POST', url: '/api/project/transcript', ...form });
  assert.equal(response.status, 200);
  assert.equal(response.json().transcripts.length, 1);
  assert.equal(fs.readdirSync(process.env.PMDS_UPLOADS_DIR).length, 1);
});

test('DSU and ceremony extraction create bounded review findings before trusted state', async () => {
  let response = await jsonRequest('POST', '/api/projects', { name: 'Ceremony Project' });
  assert.equal(response.status, 200);

  response = await jsonRequest('POST', '/api/project/story', {
    project: 'Ceremony Project',
    itemType: 'Story',
    summary: 'Database migration',
    jiraId: 'PM-101',
    labels: ['planned']
  });
  assert.equal(response.status, 200);
  assert.match(response.json().id, /^story-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  let form = multipartRequest({
    project: 'Ceremony Project',
    title: 'Unrelated DSU',
    type: 'DSU',
    notes: 'The database backup and office migration are complete.'
  }, []);
  response = await requestApp({ method: 'POST', url: '/api/project/transcript', ...form });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json().transcripts[0].extractedFindings, []);

  form = multipartRequest({
    project: 'Ceremony Project',
    title: 'Explicit DSU',
    type: 'DSU',
    notes: 'PM-101 is blocked while the test environment is restored.'
  }, []);
  response = await requestApp({ method: 'POST', url: '/api/project/transcript', ...form });
  assert.equal(response.status, 200);
  const dsuTranscript = response.json().transcripts[0];
  assert.equal(dsuTranscript.extractedFindings.length, 1);
  assert.equal(dsuTranscript.extractedFindings[0].reviewStatus, 'pending');

  response = await requestApp({ url: '/api/project?name=Ceremony%20Project' });
  assert.equal(response.json().stories[0].updates.length, 0);

  response = await jsonRequest('PUT', '/api/project/transcript/finding', {
    project: 'Ceremony Project',
    transcriptId: dsuTranscript.id,
    findingId: dsuTranscript.extractedFindings[0].id,
    reviewStatus: 'accepted'
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().finding.reviewStatus, 'accepted');

  response = await requestApp({ url: '/api/project?name=Ceremony%20Project' });
  assert.equal(response.json().stories[0].updates.length, 1);

  form = multipartRequest({
    project: 'Ceremony Project',
    title: 'Sprint planning',
    type: 'Sprint Planning',
    notes: 'PM-101 is committed to this sprint. Capacity is constrained by one day.'
  }, []);
  response = await requestApp({ method: 'POST', url: '/api/project/transcript', ...form });
  assert.equal(response.status, 200);
  const planningTranscript = response.json().transcripts[0];
  assert.equal(planningTranscript.type, 'Sprint Planning');
  assert.ok(planningTranscript.extractedFindings.some(item => item.category === 'sprint_commitment'));
  assert.ok(planningTranscript.extractedFindings.every(item => item.reviewStatus === 'pending'));

  response = await jsonRequest('PUT', '/api/project/transcript/finding', {
    project: 'Ceremony Project',
    transcriptId: planningTranscript.id,
    findingId: planningTranscript.extractedFindings[0].id,
    reviewStatus: 'accepted'
  });
  assert.equal(response.status, 200);

  response = await requestApp({ url: '/api/project?name=Ceremony%20Project' });
  assert.equal(response.json().stories[0].updates.length, 1, 'accepted planning evidence must not become a DSU update');

  form = multipartRequest({
    project: 'Ceremony Project',
    title: 'Backlog refinement',
    type: 'Backlog Refinement',
    notes: 'PM-101 is missing acceptance criteria and needs an estimate before it is ready.'
  }, []);
  response = await requestApp({ method: 'POST', url: '/api/project/transcript', ...form });
  assert.equal(response.status, 200);
  const refinementTranscript = response.json().transcripts[0];
  assert.ok(refinementTranscript.extractedFindings.some(item => item.category === 'acceptance_criterion'));
  assert.ok(refinementTranscript.extractedFindings.some(item => item.category === 'estimate'));

  const batchFindings = refinementTranscript.extractedFindings.slice(0, 2);
  response = await jsonRequest('PUT', '/api/project/transcript/findings', {
    project: 'Ceremony Project',
    reviewStatus: 'accepted',
    decisions: [
      { transcriptId: refinementTranscript.id, findingId: batchFindings[0].id },
      { transcriptId: refinementTranscript.id, findingId: 'missing-finding' }
    ]
  });
  assert.equal(response.status, 404);
  response = await requestApp({ url: '/api/project?name=Ceremony%20Project' });
  let storedRefinement = response.json().transcripts.find(item => item.id === refinementTranscript.id);
  assert.equal(storedRefinement.extractedFindings.find(item => item.id === batchFindings[0].id).reviewStatus, 'pending', 'invalid batches must be atomic');

  response = await jsonRequest('PUT', '/api/project/transcript/findings', {
    project: 'Ceremony Project',
    reviewStatus: 'accepted',
    decisions: batchFindings.map(finding => ({ transcriptId: refinementTranscript.id, findingId: finding.id }))
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().accepted, 2);
  assert.ok(response.json().findings.every(finding => finding.reviewStatus === 'accepted'));
  response = await requestApp({ url: '/api/project?name=Ceremony%20Project' });
  storedRefinement = response.json().transcripts.find(item => item.id === refinementTranscript.id);
  assert.ok(batchFindings.every(finding => storedRefinement.extractedFindings.find(item => item.id === finding.id).reviewStatus === 'accepted'));

  for (const finding of batchFindings) {
    response = await jsonRequest('PUT', '/api/project/transcript/finding', {
      project: 'Ceremony Project',
      transcriptId: refinementTranscript.id,
      findingId: finding.id,
      reviewStatus: 'pending'
    });
    assert.equal(response.status, 200);
  }
  response = await jsonRequest('PUT', '/api/project/transcript/findings', {
    project: 'Ceremony Project',
    reviewStatus: 'rejected',
    decisions: batchFindings.map(finding => ({ transcriptId: refinementTranscript.id, findingId: finding.id }))
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().rejected, 2);
  assert.ok(response.json().findings.every(finding => finding.reviewStatus === 'rejected'));

  response = await jsonRequest('PUT', '/api/project/transcript', {
    project: 'Ceremony Project',
    id: dsuTranscript.id,
    notes: 'PM-101 is now moving after the environment was restored.'
  });
  assert.equal(response.status, 200);
  assert.ok(response.json().extractedFindings.every(item => item.reviewStatus === 'pending'));
  const refreshedDsuFinding = response.json().extractedFindings[0];
  response = await jsonRequest('PUT', '/api/project/transcript/findings', {
    project: 'Ceremony Project',
    reviewStatus: 'accepted',
    decisions: [{ transcriptId: dsuTranscript.id, findingId: refreshedDsuFinding.id, storyId: '' }]
  });
  assert.equal(response.status, 400);
  assert.match(response.json().error, /linked work item/i);
  response = await jsonRequest('PUT', '/api/project/transcript/findings', {
    project: 'Ceremony Project',
    reviewStatus: 'rejected',
    decisions: [{ transcriptId: dsuTranscript.id, findingId: refreshedDsuFinding.id, storyId: '' }]
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().rejected, 1);
  assert.equal(response.json().findings[0].reviewStatus, 'rejected');
  response = await requestApp({ url: '/api/project?name=Ceremony%20Project' });
  assert.equal(response.json().stories[0].updates.length, 0, 'editing source evidence invalidates its accepted update');
  assert.equal(response.json().transcripts.find(item => item.id === dsuTranscript.id).extractedFindings[0].reviewStatus, 'rejected');
});

test('future comment timestamps are skipped at the final import boundary', async () => {
  const response = await jsonRequest('POST', '/api/project/story/import', {
    project: 'Ceremony Project',
    items: [{ summary: 'Future dated item', jiraId: 'PM-202', lastCommentedAt: '2999-01-01T00:00:00.000Z' }]
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().created, 0);
  assert.match(response.json().skipped[0].reason, /future|date/i);
});

function makeExternalFeed({ jiraId = 'PM-101', fields, fieldEvidence, evidence, title = 'Fictional external feed' } = {}) {
  return {
    schemaVersion: 'pm-external-feed/v1',
    generatedAt: '2026-07-16T12:00:00.000Z',
    source: {
      title,
      sourceType: 'Developer Conversation',
      visibleDate: '2026-07-16',
      transcriptionProvider: 'ChatGPT',
      promptVersion: 'pm-external-feed-v1.4',
      sourceDescription: 'Externally transcribed; originals not retained'
    },
    warnings: [],
    workItems: [{
      jiraId,
      fields: fields || { status: 'In progress' },
      fieldEvidence: fieldEvidence || { status: ['evidence-1'] }
    }],
    evidence: evidence || [{
      id: 'evidence-1', jiraId, category: 'progress_update', sourceRef: 'image 1', speaker: 'Developer',
      visibleTimestamp: '2026-07-16T11:00:00.000Z', exactExcerpt: `${jiraId} is moving again.`, reviewNote: ''
    }],
    unlinkedEvidence: []
  };
}

function feedRequest(feed, fileName = 'feed.json') {
  return { project: 'Ceremony Project', feedText: JSON.stringify(feed), fileName };
}

test('partial external feeds may retain sanitized evidence without proposing fields', () => {
  const feed = makeExternalFeed();
  feed.warnings = ['A fictional timestamp was incomplete, so no current field was proposed.'];
  feed.workItems = [];
  feed.evidence = [{
    id: 'evidence-partial-1', jiraId: 'PM-101', category: 'question', sourceRef: 'image 1', speaker: 'Fictional Developer',
    visibleTimestamp: '', exactExcerpt: 'PM-101: Is the fictional review complete?', reviewNote: 'Question only; not a current fact.'
  }];
  const validated = validateExternalFeed(feed, {
    isAcceptableTimestamp: isAcceptableCommentTimestamp,
    resolveStatus: value => value
  });
  assert.equal(validated.sanitized.workItems.length, 0);
  assert.equal(validated.sanitized.evidence.length, 1);
  assert.match(validated.sanitized.warnings[0], /no current field was proposed/i);
});

test('external ChatGPT feed remains pending until field-level approval and stores no source file', async () => {
  const feed = makeExternalFeed({
    fields: { status: 'In progress', lastComment: 'The fictional migration is moving again.', lastCommentedAt: '2026-07-16T11:00:00.000Z' },
    fieldEvidence: { status: ['evidence-1'], lastComment: ['evidence-1'], lastCommentedAt: ['evidence-1'] }
  });
  let response = await jsonRequest('POST', '/api/project/external-feed/preview', feedRequest(feed));
  assert.equal(response.status, 200);
  assert.equal(response.json().items[0].matchType, 'existing');
  assert.equal(response.json().items[0].fields.status.currentValue, 'Planned');

  response = await requestApp({ url: '/api/project?name=Ceremony%20Project' });
  assert.equal(inferStoryStatus(response.json().stories[0]), 'Planned', 'preview must not write');
  const filesBeforeImport = fs.readdirSync(process.env.PMDS_UPLOADS_DIR).length;

  response = await jsonRequest('POST', '/api/project/external-feed', feedRequest(feed));
  assert.equal(response.status, 200);
  const pending = response.json().transcript;
  assert.equal(pending.externalTranscription.importStatus, 'pending');
  assert.equal(pending.externalTranscription.originalScreenshotsRetained, false);
  assert.equal(pending.attachments, undefined);
  assert.equal(pending.file, '');
  assert.match(pending.externalTranscription.feedHash, /^[0-9a-f]{64}$/);
  assert.ok(pending.extractedFindings.every(item => item.reviewStatus === 'pending'));
  assert.equal(fs.readdirSync(process.env.PMDS_UPLOADS_DIR).length, filesBeforeImport);

  response = await jsonRequest('POST', '/api/project/external-feed', feedRequest(feed));
  assert.equal(response.status, 409, 'the same normalized feed cannot be saved twice');

  response = await jsonRequest('PUT', '/api/project/external-feed/apply', {
    project: 'Ceremony Project', transcriptId: pending.id,
    decisions: [
      { jiraId: 'PM-101', field: 'status', decision: 'replace', expectedCurrentValue: 'Planned' },
      { jiraId: 'PM-101', field: 'lastComment', decision: 'replace', expectedCurrentValue: '' },
      { jiraId: 'PM-101', field: 'lastCommentedAt', decision: 'replace', expectedCurrentValue: null }
    ]
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().applied, 3);
  assert.equal(response.json().updated, 1);
  assert.equal(response.json().created, 0);
  response = await requestApp({ url: '/api/project?name=Ceremony%20Project' });
  assert.equal(inferStoryStatus(response.json().stories[0]), 'In progress');

  response = await requestApp({ method: 'DELETE', url: `/api/project/external-feed?project=Ceremony%20Project&transcriptId=${encodeURIComponent(pending.id)}` });
  assert.equal(response.status, 200);
  assert.equal(fs.readdirSync(process.env.PMDS_UPLOADS_DIR).length, filesBeforeImport);
});

test('JSON and single-block Markdown feeds parse while ambiguous or oversized feeds are rejected', async () => {
  const feed = makeExternalFeed();
  let response = await jsonRequest('POST', '/api/project/external-feed/preview', {
    project: 'Ceremony Project', fileName: 'feed.md', feedText: `Review notes\n\n\`\`\`json\n${JSON.stringify(feed)}\n\`\`\``
  });
  assert.equal(response.status, 200);

  response = await jsonRequest('POST', '/api/project/external-feed/preview', { project: 'Ceremony Project', fileName: 'feed.md', feedText: JSON.stringify(feed) });
  assert.equal(response.status, 400);
  response = await jsonRequest('POST', '/api/project/external-feed/preview', {
    project: 'Ceremony Project', fileName: 'feed.md', feedText: `\`\`\`json\n${JSON.stringify(feed)}\n\`\`\`\n\`\`\`json\n${JSON.stringify(feed)}\n\`\`\``
  });
  assert.equal(response.status, 400);
  response = await jsonRequest('POST', '/api/project/external-feed/preview', { project: 'Ceremony Project', fileName: 'feed.txt', feedText: JSON.stringify(feed) });
  assert.equal(response.status, 400);
  response = await jsonRequest('POST', '/api/project/external-feed/preview', { project: 'Ceremony Project', fileName: 'feed.json', feedText: 'x'.repeat(1024 * 1024 + 1) });
  assert.equal(response.status, 400);
});

test('external feed rejects unknown fields, unreadable support, screenshot uploads, and stale reconciliation', async () => {
  const invalid = makeExternalFeed();
  invalid.constructor = 'unexpected';
  let response = await jsonRequest('POST', '/api/project/external-feed/preview', feedRequest(invalid));
  assert.equal(response.status, 400);

  const unreadable = makeExternalFeed();
  unreadable.evidence[0].exactExcerpt = '[UNREADABLE]';
  response = await jsonRequest('POST', '/api/project/external-feed/preview', feedRequest(unreadable));
  assert.equal(response.status, 400);

  const incompleteTimestamp = makeExternalFeed();
  incompleteTimestamp.evidence[0].visibleTimestamp = '2026-07-16';
  response = await jsonRequest('POST', '/api/project/external-feed/preview', feedRequest(incompleteTimestamp));
  assert.equal(response.status, 400);

  const wronglyLinked = makeExternalFeed();
  wronglyLinked.unlinkedEvidence = [{ ...wronglyLinked.evidence[0], jiraId: '' }];
  wronglyLinked.evidence = [];
  response = await jsonRequest('POST', '/api/project/external-feed/preview', feedRequest(wronglyLinked));
  assert.equal(response.status, 400, 'unlinked evidence cannot support a work-item field');

  const filesBefore = fs.readdirSync(process.env.PMDS_UPLOADS_DIR).length;
  const legacyForm = multipartRequest({ project: 'Ceremony Project' }, [
    { field: 'screenshots', name: 'legacy.png', type: 'image/png', content: Buffer.from('legacy') }
  ]);
  response = await requestApp({ method: 'POST', url: '/api/project/screenshot-import', ...legacyForm });
  assert.equal(response.status, 410);
  assert.equal(fs.readdirSync(process.env.PMDS_UPLOADS_DIR).length, filesBefore);

  const staleFeed = makeExternalFeed({ fields: { status: 'Done' }, fieldEvidence: { status: ['evidence-1'] } });
  response = await jsonRequest('POST', '/api/project/external-feed', feedRequest(staleFeed));
  assert.equal(response.status, 200);
  const transcriptId = response.json().transcript.id;
  response = await requestApp({ url: '/api/project?name=Ceremony%20Project' });
  const storyId = response.json().stories[0].id;
  response = await jsonRequest('PUT', '/api/project/story', { project: 'Ceremony Project', id: storyId, labels: ['blocked'] });
  assert.equal(response.status, 200);
  response = await jsonRequest('PUT', '/api/project/external-feed/apply', {
    project: 'Ceremony Project', transcriptId,
    decisions: [{ jiraId: 'PM-101', field: 'status', decision: 'replace', expectedCurrentValue: 'In progress' }]
  });
  assert.equal(response.status, 409);
  response = await requestApp({ method: 'DELETE', url: `/api/project/external-feed?project=Ceremony%20Project&transcriptId=${encodeURIComponent(transcriptId)}` });
  assert.equal(response.status, 200);
});

test('new external-feed work items require explicit creation and field approvals', async () => {
  const feed = makeExternalFeed({
    jiraId: 'PM-202',
    title: 'New fictional story',
    fields: { itemType: 'Feature', summary: 'Fictional new story', status: 'Planned' },
    fieldEvidence: { itemType: ['evidence-1'], summary: ['evidence-1'], status: ['evidence-1'] }
  });
  feed.schemaVersion = 'pm-external-feed/v2';
  feed.source.promptVersion = 'pm-external-feed-v2.0';
  let response = await jsonRequest('POST', '/api/project/external-feed', feedRequest(feed));
  assert.equal(response.status, 200);
  const transcriptId = response.json().transcript.id;
  response = await jsonRequest('PUT', '/api/project/external-feed/apply', {
    project: 'Ceremony Project', transcriptId,
    decisions: [{ jiraId: 'PM-202', field: 'summary', decision: 'replace', expectedCurrentValue: null }]
  });
  assert.equal(response.status, 400, 'a new work item cannot be created without separate creation approval');
  response = await jsonRequest('PUT', '/api/project/external-feed/apply', {
    project: 'Ceremony Project', transcriptId,
    decisions: [
      { jiraId: 'PM-202', action: 'create' },
      { jiraId: 'PM-202', field: 'summary', decision: 'replace', expectedCurrentValue: null },
    ]
  });
  assert.equal(response.status, 400, 'a creation decision must include a reviewer-selected item type');
  response = await jsonRequest('PUT', '/api/project/external-feed/apply', {
    project: 'Ceremony Project', transcriptId,
    decisions: [
      { jiraId: 'PM-202', action: 'create', itemType: 'Feature' },
      { jiraId: 'PM-202', field: 'summary', decision: 'replace', expectedCurrentValue: null },
      { jiraId: 'PM-202', field: 'status', decision: 'replace', expectedCurrentValue: null }
    ]
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().created, 1);
  response = await requestApp({ url: '/api/project?name=Ceremony%20Project' });
  const created = response.json().stories.find(item => item.jiraId === 'PM-202');
  assert.equal(created.summary, 'Fictional new story');
  assert.equal(created.itemType, 'Feature');
  assert.equal(inferStoryStatus(created), 'Planned');
});

test('a v2 feed without type evidence can create a reviewer-typed Story', async () => {
  const feed = makeExternalFeed({
    jiraId: 'PM-204',
    title: 'New fictional item without visible type',
    fields: { summary: 'Fictional reviewer-typed item' },
    fieldEvidence: { summary: ['evidence-1'] }
  });
  feed.schemaVersion = 'pm-external-feed/v2';
  feed.source.promptVersion = 'pm-external-feed-v2.0';
  let response = await jsonRequest('POST', '/api/project/external-feed', feedRequest(feed));
  assert.equal(response.status, 200);
  const transcriptId = response.json().transcript.id;
  assert.equal(response.json().preview.items[0].fields.itemType, undefined);
  response = await jsonRequest('PUT', '/api/project/external-feed/apply', {
    project: 'Ceremony Project', transcriptId,
    decisions: [
      { jiraId: 'PM-204', action: 'create', itemType: 'Story' },
      { jiraId: 'PM-204', field: 'summary', decision: 'replace', expectedCurrentValue: null }
    ]
  });
  assert.equal(response.status, 200);
  response = await requestApp({ url: '/api/project?name=Ceremony%20Project' });
  const created = response.json().stories.find(item => item.jiraId === 'PM-204');
  assert.equal(created.itemType, 'Story');
});

test('work item types are explicit, canonical, and legacy-safe', async () => {
  assert.equal(itemTypeOrUnknown(undefined), 'Unknown');
  assert.equal(normalizeItemType('user story'), 'Story');
  assert.equal(normalizeItemType('feature request'), '', 'titles and substrings must not imply a type');
  assert.equal(storyFieldValue({ summary: 'Legacy record' }, 'itemType', inferStoryStatus), 'Unknown');

  let response = await jsonRequest('POST', '/api/project/story', { project: 'Ceremony Project', summary: 'Missing type' });
  assert.equal(response.status, 400);
  response = await jsonRequest('POST', '/api/project/story', { project: 'Ceremony Project', itemType: 'Epic', summary: 'Fictional epic', jiraId: 'PM-303' });
  assert.equal(response.status, 200);
  assert.equal(response.json().itemType, 'Epic');

  const invalidV2 = makeExternalFeed({ fields: { itemType: 'Feature request' }, fieldEvidence: { itemType: ['evidence-1'] } });
  invalidV2.schemaVersion = 'pm-external-feed/v2';
  invalidV2.source.promptVersion = 'pm-external-feed-v2.0';
  assert.throws(() => validateExternalFeed(invalidV2, {
    isAcceptableTimestamp: isAcceptableCommentTimestamp,
    resolveStatus: value => value
  }), /Unsupported itemType/);
});

test('the vulnerable Multer dependency is absent', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const lock = fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8');
  assert.equal(manifest.dependencies.multer, undefined);
  assert.doesNotMatch(lock, /node_modules\/multer/);
});

test('AI drafting routes are throttled while grounded drafting remains functional', async () => {
  for (let index = 0; index < 10; index += 1) {
    const response = await jsonRequest('POST', '/api/project/status-report', { project: 'Demo Project', mode: 'heuristic' });
    assert.equal(response.status, 200);
    assert.match(response.json().report, /# Demo Project Status Summary/);
  }
  const limited = await jsonRequest('POST', '/api/project/status-report', { project: 'Demo Project', mode: 'heuristic' });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['retry-after'], '60');
});

test('unexpected errors do not disclose filesystem details', async () => {
  fs.writeFileSync(process.env.PMDS_DATA_FILE, '{ invalid json');
  const response = await requestApp({ url: '/api/projects' });
  assert.equal(response.status, 500);
  assert.deepEqual(response.json(), { error: 'Internal server error' });
});
