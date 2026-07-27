const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Busboy = require('busboy');
const { pipeline } = require('stream/promises');
const {
  inferOperatingStatus,
  inferStoryStatus: inferStoryStatusStrict,
  isAcceptableCommentTimestamp,
  daysSinceTimestamp,
  daysUntilCalendarDate
} = require('./public/domain-utils');
const { ITEM_TYPES, normalizeItemType, itemTypeOrUnknown } = require('./public/work-item-types');
const {
  normalizeBriefingCollections,
  createBriefingStream,
  updateBriefingStream,
  createBriefing,
  replaceDraftFacts,
  finalizeBriefing,
  generateBriefingOutputs,
  markBriefingCommunicated
} = require('./briefings/briefing-domain');
const { collectAcceptedEvidenceCandidates } = require('./briefings/briefing-evidence');
const {
  normalizeWorkspaceCollections,
  createDeliveryProject,
  updateDeliveryProject,
  assertUniqueDeliveryProject,
  findDeliveryProject
} = require('./workspaces/workspace-domain');
const {
  DEFAULT_ABSOLUTE_MS: demoAbsoluteLifetimeMs,
  DemoSessionStore
} = require('./demo/demo-session-store');
const {
  FIELD_NAMES: externalFeedFields,
  buildExternalFeedPreview,
  parseExternalFeedText,
  storyFieldValue,
  validateExternalFeed,
  valuesEqual
} = require('./external-feed');

// Lightweight .env loader (dependency-free). Loads this repository's local
// .env file into process.env
// without overriding variables already set in the real environment.
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && !(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    console.warn('Unable to read .env file:', error.message);
  }
}
loadEnvFile();

const app = express();
// Wrap async route handlers so thrown errors / rejected promises reach the error
// middleware (Express 4 doesn't auto-catch async errors — they'd otherwise hang the request).
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const localDataRoot = path.join(__dirname, '.priorena-data');
const dataFile = process.env.PMDS_DATA_FILE || path.join(localDataRoot, 'pilot-data.json');
const transcriptsDir = process.env.PMDS_UPLOADS_DIR || path.join(localDataRoot, 'uploads', 'transcripts');

if (!fs.existsSync(transcriptsDir)) {
  fs.mkdirSync(transcriptsDir, { recursive: true, mode: 0o700 });
}

const textTranscriptExtensions = new Set(['.txt', '.md', '.csv', '.json', '.log']);
const referenceTranscriptExtensions = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg']);
const allowedTranscriptExtensions = new Set([...textTranscriptExtensions, ...referenceTranscriptExtensions]);
const reservedProjectKeys = new Set(['__proto__', 'prototype', 'constructor']);
const maxRequestBytes = 20 * 1024 * 1024;
const maxExtractionBytes = 2 * 1024 * 1024;
const maxCsvRows = 1001;
const maxCsvColumns = 100;
const maxCsvCellChars = 100_000;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const makeId = prefix => `${prefix}-${crypto.randomUUID()}`;

function multipartError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode, code: 'MULTIPART_REJECTED' });
}

function createMultipartMiddleware({ fileFields, memory = false, fileSize, files, fields, fieldSize, parts, validateFile }) {
  return (req, res, next) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { fileSize, files, fields, fieldSize, fieldNameSize: 100, parts }
      });
    } catch (_) {
      return next(multipartError('A valid multipart form is required'));
    }

    req.body = Object.create(null);
    req.files = Object.create(null);
    const pending = [];
    const fieldCounts = Object.create(null);
    let firstError = null;
    let completed = false;
    const fail = error => {
      if (!firstError) firstError = error instanceof Error ? error : multipartError('The upload could not be processed');
    };

    parser.on('field', (name, value, info) => {
      if (info.nameTruncated || info.valueTruncated) {
        fail(multipartError('The upload contains an oversized field', 413));
        return;
      }
      if (hasOwn(req.body, name)) {
        fail(multipartError(`Duplicate form field: ${name}`));
        return;
      }
      req.body[name] = value;
    });

    parser.on('file', (fieldName, stream, info) => {
      fieldCounts[fieldName] = (fieldCounts[fieldName] || 0) + 1;
      if (!hasOwn(fileFields, fieldName) || fieldCounts[fieldName] > fileFields[fieldName]) {
        fail(multipartError('The upload contains an unexpected file field'));
        stream.resume();
        return;
      }

      const originalName = path.basename(String(info.filename || 'upload'));
      const validationError = validateFile && validateFile({ fieldName, originalName, mimeType: info.mimeType });
      if (validationError) {
        fail(validationError);
        stream.resume();
        return;
      }

      let size = 0;
      let limited = false;
      stream.on('data', chunk => { size += chunk.length; });
      stream.once('limit', () => {
        limited = true;
        fail(multipartError('Each uploaded file must be 10 MB or smaller', 413));
      });

      if (memory) {
        const chunks = [];
        const task = new Promise((resolve, reject) => {
          stream.on('data', chunk => chunks.push(chunk));
          stream.once('error', reject);
          stream.once('end', () => {
            if (!limited) {
              const file = {
                fieldname: fieldName,
                originalname: originalName,
                encoding: info.encoding,
                mimetype: info.mimeType,
                size,
                buffer: Buffer.concat(chunks, size)
              };
              if (!req.files[fieldName]) req.files[fieldName] = [];
              req.files[fieldName].push(file);
            }
            resolve();
          });
        }).catch(fail);
        pending.push(task);
        return;
      }

      const filename = crypto.randomBytes(18).toString('hex');
      const filePath = path.join(transcriptsDir, filename);
      const file = {
        fieldname: fieldName,
        originalname: originalName,
        encoding: info.encoding,
        mimetype: info.mimeType,
        destination: transcriptsDir,
        filename,
        path: filePath,
        size: 0
      };
      if (!req.files[fieldName]) req.files[fieldName] = [];
      req.files[fieldName].push(file);
      const output = fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
      pending.push(pipeline(stream, output).then(() => { file.size = size; }).catch(fail));
    });

    parser.once('filesLimit', () => fail(multipartError(`Upload up to ${files} files at a time`, 413)));
    parser.once('fieldsLimit', () => fail(multipartError('The upload contains too many fields', 413)));
    parser.once('partsLimit', () => fail(multipartError('The upload contains too many parts', 413)));
    parser.once('error', fail);
    parser.once('close', async () => {
      if (completed) return;
      completed = true;
      await Promise.allSettled(pending);
      if (firstError) return next(firstError);
      const singleField = Object.entries(fileFields).find(([, maximum]) => maximum === 1)?.[0];
      if (singleField && req.files[singleField]?.length === 1) req.file = req.files[singleField][0];
      next();
    });
    req.pipe(parser);
  };
}

const transcriptMultipart = createMultipartMiddleware({
  fileFields: { file: 1, files: 5 },
  fileSize: 10 * 1024 * 1024,
  files: 5,
  fields: 20,
  fieldSize: 256 * 1024,
  parts: 30,
  validateFile: ({ originalName }) => allowedTranscriptExtensions.has(path.extname(originalName).toLowerCase())
    ? null
    : multipartError('Unsupported source file type')
});

const csvMultipart = createMultipartMiddleware({
  fileFields: { file: 1 },
  memory: true,
  fileSize: 10 * 1024 * 1024,
  files: 1,
  fields: 10,
  fieldSize: 64 * 1024,
  parts: 12,
  validateFile: ({ originalName }) => /\.csv$/i.test(originalName) ? null : multipartError('Only .csv files can be imported')
});

function isLoopbackHost(host) {
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(String(host || ''));
}

function isUnsafeMethod(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method);
}

function requestProvenance(req, res, next) {
  const host = req.headers.host;
  if (!isLoopbackHost(host)) return res.status(421).json({ error: 'Local requests only' });
  if (!isUnsafeMethod(req.method)) return next();

  const origin = req.headers.origin;
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'http:' || parsed.host.toLowerCase() !== String(host).toLowerCase() || !isLoopbackHost(parsed.host)) {
        return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
      }
    } catch (_) {
      return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
    }
  }
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
    return res.status(403).json({ error: 'Cross-site requests are not allowed' });
  }
  next();
}

function enforceRequestLimit(req, res, next) {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0) {
    return res.status(400).json({ error: 'Invalid Content-Length header' });
  }
  if (declaredLength > maxRequestBytes) {
    return res.status(413).json({ error: 'Request body must be 20 MB or smaller' });
  }

  let bytesRead = 0;
  let exceeded = false;
  const onData = chunk => {
    bytesRead += chunk.length;
    if (bytesRead > maxRequestBytes && !exceeded) {
      exceeded = true;
      req.destroy(Object.assign(new Error('Request body limit exceeded'), { code: 'REQUEST_TOO_LARGE' }));
    }
  };
  req.on('data', onData);
  req.once('end', () => req.off('data', onData));
  req.once('close', () => req.off('data', onData));
  next();
}

function createRateLimiter({ windowMs, max, methods }) {
  const buckets = new Map();
  return (req, res, next) => {
    if (methods && !methods.includes(req.method)) return next();
    const now = Date.now();
    const key = req.socket.remoteAddress || 'local';
    const entries = (buckets.get(key) || []).filter(timestamp => now - timestamp < windowMs);
    if (entries.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'Too many requests; try again shortly' });
    }
    entries.push(now);
    buckets.set(key, entries);
    next();
  };
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; '));
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(requestProvenance);
app.use(enforceRequestLimit);
app.use(createRateLimiter({ windowMs: 60_000, max: 240, methods: ['POST', 'PUT', 'DELETE', 'PATCH'] }));
app.use('/api/project/transcript', createRateLimiter({ windowMs: 60_000, max: 20, methods: ['POST'] }));
app.use('/api/project/story/import/preview', createRateLimiter({ windowMs: 60_000, max: 20, methods: ['POST'] }));
app.use('/api/project/external-feed', createRateLimiter({ windowMs: 60_000, max: 30, methods: ['POST', 'PUT', 'DELETE'] }));
app.use('/api/project/status-report', createRateLimiter({ windowMs: 60_000, max: 10, methods: ['POST'] }));
app.use('/api/project/teams-update', createRateLimiter({ windowMs: 60_000, max: 10, methods: ['POST'] }));

app.use('/static', express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '2mb', strict: true }));

const demoModeEnabled = process.env.PRIORENA_DEMO_MODE === '1';
const demoSessionCookie = 'priorena_demo_session';
const demoSessionStore = new DemoSessionStore();

function cookieValue(req, name) {
  const header = String((req.headers && req.headers.cookie) || '');
  if (!header || header.length > 4096) return '';
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return '';
}

function demoCookie(id, maxAgeSeconds) {
  const secure = process.env.PRIORENA_DEMO_SECURE_COOKIE === '1' ? '; Secure' : '';
  return `${demoSessionCookie}=${id}; HttpOnly; SameSite=Strict; Path=/api/demo; Max-Age=${maxAgeSeconds}${secure}`;
}

function demoResponse(session) {
  if (!session) return null;
  const { id, ...safe } = session;
  return safe;
}

function requireDemoMode(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!demoModeEnabled) return res.status(404).json({ error: 'Demo Mode is not enabled' });
  next();
}

app.get('/api/demo/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ enabled: demoModeEnabled });
});

app.post('/api/demo/session', requireDemoMode, (req, res, next) => {
  try {
    const priorId = cookieValue(req, demoSessionCookie);
    if (priorId) demoSessionStore.destroy(priorId);
    const session = demoSessionStore.create();
    res.set('Set-Cookie', demoCookie(session.id, Math.floor(demoAbsoluteLifetimeMs / 1000)));
    res.status(201).json(demoResponse(session));
  } catch (error) {
    next(error);
  }
});

app.get('/api/demo/session', requireDemoMode, (req, res) => {
  const session = demoSessionStore.get(cookieValue(req, demoSessionCookie));
  if (!session) return res.status(401).json({ error: 'Demo session expired or unavailable' });
  res.json(demoResponse(session));
});

app.put('/api/demo/session/manual-context', requireDemoMode, (req, res, next) => {
  try {
    const session = demoSessionStore.updateManualContext(
      cookieValue(req, demoSessionCookie),
      req.body && req.body.text
    );
    if (!session) return res.status(401).json({ error: 'Demo session expired or unavailable' });
    res.json(demoResponse(session));
  } catch (error) {
    next(error);
  }
});

app.put('/api/demo/session/work-item', requireDemoMode, (req, res, next) => {
  try {
    const session = demoSessionStore.updateWorkItem(
      cookieValue(req, demoSessionCookie),
      req.body
    );
    if (!session) return res.status(401).json({ error: 'Demo session expired or unavailable' });
    res.json(demoResponse(session));
  } catch (error) {
    next(error);
  }
});

app.post('/api/demo/session/evidence', requireDemoMode, (req, res, next) => {
  try {
    const session = demoSessionStore.addEvidence(
      cookieValue(req, demoSessionCookie),
      req.body
    );
    if (!session) return res.status(401).json({ error: 'Demo session expired or unavailable' });
    res.status(201).json(demoResponse(session));
  } catch (error) {
    next(error);
  }
});

app.put('/api/demo/session/evidence/review', requireDemoMode, (req, res, next) => {
  try {
    const session = demoSessionStore.reviewEvidence(
      cookieValue(req, demoSessionCookie),
      req.body
    );
    if (!session) return res.status(401).json({ error: 'Demo session expired or unavailable' });
    res.json(demoResponse(session));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/demo/session', requireDemoMode, (req, res) => {
  demoSessionStore.destroy(cookieValue(req, demoSessionCookie));
  res.set('Set-Cookie', demoCookie('', 0));
  res.json({ success: true });
});

function readData() {
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify({ projects: {} }, null, 2), { mode: 0o600 });
  }
  const raw = fs.readFileSync(dataFile, 'utf8');
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Data root must be an object');
    if (data.projects === undefined) data.projects = Object.create(null);
    if (!data.projects || typeof data.projects !== 'object' || Array.isArray(data.projects)) throw new Error('Projects must be an object');
    Object.setPrototypeOf(data.projects, null);
    normalizeWorkspaceCollections(data);
    normalizeBriefingCollections(data);
    return data;
  } catch (error) {
    // Do NOT overwrite/reset on parse failure — that would destroy data. Surface a clear
    // error (handled by the error middleware → clean 500) so the file can be fixed/restored.
    throw new Error(`pilot-data.json is not valid JSON (${error.message}). The file was left unchanged — fix or restore it.`);
  }
}

function writeData(data) {
  // Write to a temp file then rename, so a crash or concurrent write can never
  // leave pilot-data.json half-written (rename is atomic on the same filesystem).
  const tmpFile = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, dataFile);
}

function sanitizeName(name) {
  return String(name || '').replace(/[\/\\?%*:|"<>]/g, '').trim();
}

function isSafeProjectKey(name) {
  return Boolean(name) && !reservedProjectKeys.has(String(name).toLowerCase());
}

function getProject(data, name) {
  return data && data.projects && isSafeProjectKey(name) && hasOwn(data.projects, name)
    ? data.projects[name]
    : undefined;
}

function assertBodyKeys(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Request body must be an object'), { statusCode: 400 });
  }
  const allowedKeys = new Set(allowed);
  Object.keys(body).forEach(key => {
    if (reservedProjectKeys.has(key.toLowerCase()) || !allowedKeys.has(key)) {
      throw Object.assign(new Error(`Request contains unsupported field: ${key}`), { statusCode: 400 });
    }
  });
}

function findBriefingStream(data, id) {
  return (data.briefingStreams || []).find(stream => stream && stream.id === id);
}

function findBriefing(data, id) {
  return (data.briefings || []).find(briefing => briefing && briefing.id === id);
}

function briefingEvidenceIds(data, briefing) {
  return new Set(collectAcceptedEvidenceCandidates(data.projects, briefing).map(candidate => candidate.id));
}

function assertBriefingEvidenceStillAccepted(data, briefing) {
  const acceptedIds = briefingEvidenceIds(data, briefing);
  (briefing.facts || []).filter(fact => fact && fact.included && fact.origin === 'evidence').forEach(fact => {
    (fact.sourceEvidenceIds || []).forEach(sourceId => {
      if (!acceptedIds.has(sourceId)) {
        const error = new Error(`Briefing evidence is no longer accepted or current: ${sourceId}`);
        error.statusCode = 400;
        throw error;
      }
    });
  });
}

function deliveryProjectIdsForWorkspaces(data, workspaceNames = Object.keys(data.projects || {})) {
  return workspaceNames.flatMap(name => (getProject(data, name)?.deliveryProjects || []).map(item => item.id));
}

// Remove an uploaded transcript's file from disk (basename guards against path traversal).
function deleteTranscriptFile(transcript) {
  if (!transcript) return;
  const names = [transcript.file, ...(transcript.attachments || []).map(item => item && item.file)].filter(Boolean);
  names.forEach(name => {
    try {
      const diskPath = path.join(transcriptsDir, path.basename(name));
      if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
    } catch (error) {
      console.warn('Could not delete transcript file:', error.message);
    }
  });
}

function requestUploadedFiles(req) {
  if (!req) return [];
  if (Array.isArray(req.files)) return req.files;
  const grouped = req.files && typeof req.files === 'object' ? Object.values(req.files).flat() : [];
  return [...grouped, ...(req.file ? [req.file] : [])];
}

function cleanupUploadedFiles(req) {
  requestUploadedFiles(req).forEach(file => {
    if (!file || !file.path) return;
    try {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    } catch (error) {
      console.warn('Could not remove rejected upload:', error.message);
    }
  });
}

function rejectUploadedRequest(req, res, statusCode, message) {
  cleanupUploadedFiles(req);
  return res.status(statusCode).json({ error: message });
}

function runTranscriptUpload(req, res, next) {
  transcriptMultipart(req, res, error => {
    if (error) {
      cleanupUploadedFiles(req);
      return next(error);
    }
    next();
  });
}

const wrapUpload = fn => (req, res, next) => Promise.resolve(fn(req, res, next))
  .then(() => {
    if (res.statusCode >= 400) cleanupUploadedFiles(req);
  })
  .catch(error => {
    cleanupUploadedFiles(req);
    next(error);
  });

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function getAssigneeDirectory(projectData) {
  const source = (projectData && projectData.assigneeDirectory) || {};
  const directory = Object.create(null);
  Object.entries(source).forEach(([alias, name]) => {
    const normalizedAlias = normalizeText(alias);
    const normalizedName = String(name || '').trim();
    if (normalizedAlias && normalizedName && !reservedProjectKeys.has(normalizedAlias)) {
      directory[normalizedAlias] = normalizedName;
    }
  });
  return directory;
}

function resolveProjectAssignee(projectData, assignee) {
  const recorded = String(assignee || '').trim();
  return getAssigneeDirectory(projectData)[normalizeText(recorded)] || recorded;
}

const operatingStatuses = new Set(['Blocked', 'In progress', 'Active', 'Planned', 'Done', 'Not started']);

function statusMappingKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getProjectStatusMappings(projectData) {
  const source = (projectData && projectData.statusMappings) || {};
  const mappings = Object.create(null);
  Object.entries(source).forEach(([jiraStatus, operatingStatus]) => {
    const key = statusMappingKey(jiraStatus);
    const value = String(operatingStatus || '').trim();
    if (key && operatingStatuses.has(value) && !reservedProjectKeys.has(key)) mappings[key] = value;
  });
  return mappings;
}

function mappedOperatingStatus(projectData, jiraStatus) {
  return getProjectStatusMappings(projectData)[statusMappingKey(jiraStatus)] || '';
}

function defaultOperatingStatus(jiraStatus) {
  return inferOperatingStatus(jiraStatus) || '';
}

function applyOperatingStatusLabel(labels, operatingStatus) {
  const standardLabels = new Set(['done', 'in progress', 'in-progress', 'blocked', 'active', 'planned', 'not started', 'not-started']);
  const next = (Array.isArray(labels) ? labels : []).filter(label => !standardLabels.has(normalizeText(label)));
  return operatingStatus ? [...new Set([operatingStatus.toLowerCase(), ...next])] : next;
}

function extractJsonFromText(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (_error) {
      return null;
    }
  }
  return null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');

  const finishCell = () => {
    if (row.length >= maxCsvColumns) throw new Error(`CSV is limited to ${maxCsvColumns} columns`);
    row.push(cell);
    cell = '';
  };
  const finishRow = () => {
    finishCell();
    if (rows.length >= maxCsvRows) throw new Error('CSV preview is limited to 1,000 work items');
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      finishCell();
    } else if (char === '\n') {
      finishRow();
    } else if (char !== '\r') {
      cell += char;
    }
    if (cell.length > maxCsvCellChars) throw new Error(`CSV cells are limited to ${maxCsvCellChars.toLocaleString()} characters`);
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted cell');
  if (cell || row.length) {
    finishCell();
    if (row.some(value => value.trim())) {
      if (rows.length >= maxCsvRows) throw new Error('CSV preview is limited to 1,000 work items');
      rows.push(row);
    }
  }
  return rows;
}

function csvHeaderKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const csvColumnAliases = {
  itemType: ['issue type', 'issuetype', 'item type', 'work item type', 'type'],
  jiraId: ['issue key', 'issuekey', 'jira key', 'jira id', 'key'],
  summary: ['summary', 'issue summary', 'title'],
  description: ['description', 'issue description'],
  status: ['status', 'issue status'],
  assignee: ['assignee', 'owner', 'assigned to'],
  sprint: ['sprint'],
  labels: ['labels', 'label'],
  dependencies: ['dependencies', 'dependency', 'blocks', 'blocked by'],
  environment: ['environment'],
  acceptanceCriteria: ['acceptance criteria', 'acceptance criteria text'],
  lastComment: ['last comment', 'comment', 'comments', 'pm note', 'last update'],
  lastCommentedAt: ['comment date', 'last commented', 'last comment date']
};

function csvValue(row, columns, name) {
  const index = columns[name];
  return index === undefined ? '' : String(row[index] || '').trim();
}

function labelsFromImportedStatus(projectData, status, labels) {
  const statusLabel = mappedOperatingStatus(projectData, status) || defaultOperatingStatus(status);
  const imported = String(labels || '').split(',').map(value => value.trim()).filter(Boolean);
  const originalStatusLabel = statusMappingKey(status) ? [`original-status:${statusMappingKey(status)}`] : [];
  return applyOperatingStatusLabel([...imported, ...originalStatusLabel], statusLabel);
}

function mapCsvWorkItems(csvText, projectData) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one data row');
  const headers = rows[0].map(csvHeaderKey);
  const columns = {};
  Object.entries(csvColumnAliases).forEach(([field, aliases]) => {
    const index = headers.findIndex(header => aliases.includes(header));
    if (index !== -1) columns[field] = index;
  });
  if (columns.summary === undefined) throw new Error('CSV needs a Summary, Issue Summary, or Title column');

  const existingJiraIds = new Set((projectData.stories || []).map(story => normalizeText(story.jiraId)).filter(Boolean));
  const seenJiraIds = new Set();
  const items = [];
  const skipped = [];
  rows.slice(1).forEach((row, index) => {
    const summary = csvValue(row, columns, 'summary');
    const jiraId = csvValue(row, columns, 'jiraId');
    if (!summary) { skipped.push({ row: index + 2, reason: 'Missing summary' }); return; }
    const normalizedJiraId = normalizeText(jiraId);
    if (normalizedJiraId && (existingJiraIds.has(normalizedJiraId) || seenJiraIds.has(normalizedJiraId))) {
      skipped.push({ row: index + 2, reason: `Duplicate Jira key: ${jiraId}` });
      return;
    }
    const lastCommentedAt = csvValue(row, columns, 'lastCommentedAt');
    if (lastCommentedAt && !isAcceptableCommentTimestamp(lastCommentedAt)) {
      skipped.push({ row: index + 2, reason: 'Invalid or future last-comment date' });
      return;
    }
    if (normalizedJiraId) seenJiraIds.add(normalizedJiraId);
    items.push({
      itemType: itemTypeOrUnknown(csvValue(row, columns, 'itemType')),
      summary,
      jiraId,
      description: csvValue(row, columns, 'description'),
      acceptanceCriteria: csvValue(row, columns, 'acceptanceCriteria').split(/\r?\n/).map(value => value.trim()).filter(Boolean),
      dependencies: csvValue(row, columns, 'dependencies'),
      labels: labelsFromImportedStatus(projectData, csvValue(row, columns, 'status'), csvValue(row, columns, 'labels')),
      environment: csvValue(row, columns, 'environment'),
      assignee: resolveProjectAssignee(projectData, csvValue(row, columns, 'assignee')),
      sprint: csvValue(row, columns, 'sprint'),
      lastComment: csvValue(row, columns, 'lastComment'),
      lastCommentedAt,
      sourceRow: index + 2
    });
  });
  return { columns: Object.keys(columns), items, skipped };
}

const defaultDsuExtractionPrompt = `You are given a DSU transcript and a list of active stories for a project. Extract concise update items that refer to one or more of these stories and return valid JSON only. The JSON must be an array of objects with keys: storyId, excerpt, update, source. Use only the provided storyId values. excerpt must be a phrase copied directly from the transcript (do not paraphrase it); update should be a Jira-friendly summary of that same update; source should identify the transcript title or file name. Only extract updates that are explicitly supported by the transcript text — do not infer, assume, or invent. If a story is not clearly discussed in the transcript, omit it. If the transcript contains no relevant updates, return an empty array []. You must not include any explanation outside the JSON array.\n\nProject stories:\n{{storyList}}\n\nTranscript title: {{transcriptTitle}}\nTranscript type: {{transcriptType}}\nTranscript text:\n{{transcriptText}}`;

const defaultStatusReportPrompt = `You are a delivery lead writing a concise, professional project status summary in Markdown for leadership or stakeholder readouts. Use only the information provided below. Do not invent or overstate anything: no made-up progress, risks, dates, owners, next steps, confidence, percentages, or milestone health. If the data is missing or mixed, say that explicitly. When the evidence does not support a clean green/yellow/red call, use cautious phrasing such as "mixed signals based on recorded data" rather than guessing. Preserve any date marked "(estimated)" as estimated.\n\nFormat the summary exactly with these sections:\n# {{projectName}} Status Summary\n## Overall Status\n- Status signal: <one short line grounded in the data>\n- Executive summary: <2-4 sentences, factual and scannable>\n## Delivery Highlights\n- Bullet list only from explicit completed/in-progress/active evidence\n## Risks and Blockers\n- Bullet list of explicit blockers, dependency issues, follow-up concerns, milestone pressure, or "No explicit risks recorded"\n## Milestones\n- Bullet list of milestone title, date, and recorded status/notes only\n## Work Items Needing Attention\n- Bullet list of explicit blocked, stale, unowned, or follow-up-needing items, or say none are recorded\n## Evidence Gaps\n- Bullet list of missing or weak data that limits confidence in the summary\n\nUse Jira IDs only when they are provided. Keep it factual, concise, and ready to paste into a status update.\n\nProject: {{projectName}}\n\nTimeline:\n{{timelineList}}\n\nStories:\n{{storyList}}\n\nTranscripts:\n{{transcriptList}}`;

function getAiPrompts(data) {
  if (!data.aiPrompts) {
    data.aiPrompts = {};
  }
  return {
    dsuExtraction: data.aiPrompts.dsuExtraction || defaultDsuExtractionPrompt,
    statusReport: data.aiPrompts.statusReport || defaultStatusReportPrompt
  };
}

function renderPrompt(template, context) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => context[key] || '');
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

// App-wide settings for follow-up nudges and controlled vocab like sprint names.
// Stored under data.settings; falls back to defaults when absent or invalid.
const defaultSettings = { commentStaleDays: 7, sprintOptions: [] };
function getSettings(data) {
  const s = (data && data.settings) || {};
  const n = parseInt(s.commentStaleDays, 10);
  const sprintOptions = Array.isArray(s.sprintOptions)
    ? s.sprintOptions.map(value => String(value || '').trim()).filter(Boolean)
    : [];
  return {
    commentStaleDays: Number.isFinite(n) && n > 0 ? n : defaultSettings.commentStaleDays,
    sprintOptions
  };
}

function getProvider() {
  const provider = (process.env.AI_PROVIDER || '').toLowerCase();
  if (provider === 'claude' && process.env.CLAUDE_API_KEY) return 'claude';
  if (provider === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.CLAUDE_API_KEY) return 'claude';
  return null;
}

const aiRequestTimeoutMs = 30_000;
const maxAiPromptChars = 2_000_000;
const maxConcurrentAiRequests = 2;
let activeAiRequests = 0;

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), aiRequestTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function withAiPermit(task) {
  if (activeAiRequests >= maxConcurrentAiRequests) {
    const error = new Error('AI drafting is busy; try again shortly');
    error.statusCode = 429;
    throw error;
  }
  activeAiRequests += 1;
  try {
    return await task();
  } finally {
    activeAiRequests -= 1;
  }
}

async function callOpenAIApi(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS, 10) || 2000;
  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        // Neutral system prompt: callOpenAIApi serves all features (extraction, status
        // reports, Teams updates), so it must not bias toward any one task/format.
        { role: 'system', content: 'You are a helpful project delivery operations assistant. Follow the user\'s instructions exactly and return only what they ask for, in the requested format.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: maxTokens
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`OpenAI API request failed with status ${response.status}`);
  return data?.choices?.[0]?.message?.content || '';
}

async function callClaudeApi(prompt) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('Missing CLAUDE_API_KEY');

  const apiUrl = 'https://api.anthropic.com/v1/messages';
  const response = await fetchWithTimeout(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-opus-4-8',
      max_tokens: parseInt(process.env.CLAUDE_MAX_TOKENS, 10) || 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Claude API request failed with status ${response.status}`);
  }
  // The Messages API returns a content array of typed blocks; concatenate the text blocks.
  if (Array.isArray(data?.content)) {
    return data.content.filter(block => block.type === 'text').map(block => block.text).join('');
  }
  return '';
}

async function callLlm(prompt) {
  if (String(prompt || '').length > maxAiPromptChars) {
    const error = new Error('AI draft input is too large');
    error.statusCode = 413;
    throw error;
  }
  const provider = getProvider();
  if (!provider) {
    throw new Error('No AI provider configured. Set OPENAI_API_KEY or CLAUDE_API_KEY.');
  }
  return withAiPermit(() => provider === 'openai' ? callOpenAIApi(prompt) : callClaudeApi(prompt));
}

function renderStoryListForPrompt(projectData) {
  return projectData.stories.map(story => `- id: ${story.id}\n  itemType: ${itemTypeOrUnknown(story.itemType)}\n  summary: ${story.summary.trim()}\n  description: ${story.description ? story.description.trim() : ''}`).join('\n');
}

// Richer story rendering for the status-report prompt: includes inferred status, labels,
// dependencies, notes, and the most recent updates so the report reflects real state
// (blockers, done items, DSU-derived progress) rather than just titles/descriptions.
function renderStoryListForReport(projectData) {
  return projectData.stories.map(story => {
    const labels = Array.isArray(story.labels) ? story.labels.join(', ') : String(story.labels || '');
    const recent = Array.isArray(story.updates) ? story.updates.slice(0, 3) : [];
    const linkedMilestone = story.timelineId ? (projectData.timeline.find(entry => entry.id === story.timelineId) || null) : null;
    const lines = [
      `- summary: ${story.summary.trim()}`,
      `  itemType: ${itemTypeOrUnknown(story.itemType)}`,
      `  status: ${inferStoryStatus(story)}`
    ];
    if (story.jiraId) lines.push(`  jiraId: ${story.jiraId}`);
    if (storyAssignee(story)) lines.push(`  assignee: ${storyAssignee(story)}`);
    if (storySprint(story)) lines.push(`  sprint: ${storySprint(story)}`);
    if (story.tracked) lines.push(`  tracked: yes`);
    if (typeof story.contacted === 'boolean') lines.push(`  contacted: ${story.contacted ? 'yes' : 'no'}`);
    if (story.lastCommentedAt) lines.push(`  lastCommentedAt: ${story.lastCommentedAt}`);
    if (storyLastCommentText(story)) lines.push(`  lastComment: ${storyLastCommentText(story)}`);
    if (labels) lines.push(`  labels: ${labels}`);
    if (story.description) lines.push(`  description: ${story.description.trim()}`);
    if (story.dependencies) lines.push(`  dependencies: ${story.dependencies}`);
    if (story.notes) lines.push(`  notes: ${story.notes.trim()}`);
    if (linkedMilestone) lines.push(`  linked milestone: ${linkedMilestone.title}${linkedMilestone.date ? ` (${linkedMilestone.date})` : ''}`);
    if (recent.length) {
      lines.push('  recent updates:');
      recent.forEach(update => {
        const text = (update.update || update.excerpt || '').trim();
        const source = update.source || update.transcriptTitle || '';
        lines.push(`    - ${text}${source ? ` (source: ${source})` : ''}`);
      });
    }
    return lines.join('\n');
  }).join('\n');
}

function renderTimelineListForPrompt(projectData) {
  return projectData.timeline.map(entry => `- id: ${entry.id}\n  title: ${entry.title}\n  date: ${entry.date || ''}\n  status: ${entry.status || ''}\n  notes: ${entry.notes || ''}`).join('\n');
}

function renderTranscriptListForPrompt(projectData) {
  return projectData.transcripts.map(item => {
    const accepted = (item.extractedFindings || []).filter(finding => finding.reviewStatus === 'accepted');
    const evidence = accepted.map(finding => `    - category: ${finding.category}; excerpt: ${finding.exactExcerpt || ''}; workItem: ${finding.jiraId || finding.storyId || 'unlinked'}; provenance: ${item.sourceKind === 'external-ai-transcription' ? 'external ChatGPT feed; original screenshots not retained' : 'local source'}`).join('\n');
    return `- id: ${item.id}\n  title: ${item.title}\n  type: ${item.type || ''}\n  sourceKind: ${item.sourceKind || ''}\n  date: ${item.date || item.uploadedAt || ''}\n  notes: ${item.notes || ''}\n  acceptedEvidence:\n${evidence || '    - none'}`;
  }).join('\n');
}

function inferStoryStatus(story) { return inferStoryStatusStrict(story); }

function daysSinceIso(value) {
  return daysSinceTimestamp(value);
}

function itemNeedsFollowupServer(story) {
  return !!story.tracked && inferStoryStatus(story) !== 'Done' && !story.contacted;
}

function itemNeedsCommentServer(story, settings) {
  if (!story.tracked || inferStoryStatus(story) === 'Done') return false;
  const d = daysSinceIso(story.lastCommentedAt);
  return d === null || d >= ((settings && settings.commentStaleDays) || 7);
}

function daysUntilDate(value) {
  return daysUntilCalendarDate(value);
}

function milestoneHealthLabel(entry) {
  const status = String((entry && entry.status) || '').toLowerCase();
  if (/(done|complete|completed|closed)/.test(status)) return 'Complete';
  const until = daysUntilDate(entry && entry.date);
  if (until === null) return 'No date';
  if (until < 0) return 'Overdue';
  if (until <= 7) return 'Due soon';
  if (until <= 21) return 'Upcoming';
  return 'On horizon';
}

function storyDisplay(story) {
  return story.jiraId ? `${story.jiraId} · ${story.summary}` : story.summary;
}

function generateHeuristicStatusReport(projectData, projectName, settings) {
  const timeline = [...projectData.timeline].sort((a, b) => {
    const aTime = a.date ? new Date(a.date).getTime() : 0;
    const bTime = b.date ? new Date(b.date).getTime() : 0;
    return aTime - bTime;
  });
  const stories = [...projectData.stories];
  const transcripts = [...projectData.transcripts];
  const blocked = stories.filter(story => inferStoryStatus(story) === 'Blocked');
  const active = stories.filter(story => ['In progress', 'Active'].includes(inferStoryStatus(story)));
  const done = stories.filter(story => inferStoryStatus(story) === 'Done');
  const followup = stories.filter(story => itemNeedsFollowupServer(story));
  const quiet = stories.filter(story => itemNeedsCommentServer(story, settings));
  const overdue = timeline.filter(entry => milestoneHealthLabel(entry) === 'Overdue');
  const dueSoon = timeline.filter(entry => milestoneHealthLabel(entry) === 'Due soon');
  const undated = timeline.filter(entry => milestoneHealthLabel(entry) === 'No date');
  const linkedMilestones = timeline.filter(entry => stories.some(story => story.timelineId === entry.id)).length;
  const acceptedCeremonyEvidence = transcripts.flatMap(transcript =>
    (transcript.extractedFindings || [])
      .filter(finding => finding.reviewStatus === 'accepted' && transcript.type !== 'DSU')
      .map(finding => ({ transcript, finding }))
  );
  const ceremonyRisks = acceptedCeremonyEvidence.filter(item =>
    ['risk', 'blocker', 'dependency', 'capacity_constraint', 'readiness_gap'].includes(item.finding.category)
  );
  const externalProgressEvidence = acceptedCeremonyEvidence.filter(item =>
    item.transcript.sourceKind === 'external-ai-transcription' && item.finding.category === 'progress_update'
  );
  const updates = [];
  stories.forEach(story => {
    (story.updates || []).forEach(update => updates.push({
      story,
      update
    }));
  });
  updates.sort((a, b) => new Date(b.update.date || 0) - new Date(a.update.date || 0));

  let overallSignal = 'Mixed signals based on recorded data.';
  if (blocked.length || overdue.length) {
    overallSignal = 'At risk based on recorded blockers or overdue milestones.';
  } else if (active.length && !followup.length && !quiet.length && !dueSoon.length) {
    overallSignal = 'In motion with no explicit blockers recorded.';
  } else if (!stories.length && !timeline.length && !transcripts.length) {
    overallSignal = 'Insufficient recorded data to assess status.';
  } else if (!blocked.length && !overdue.length && (followup.length || quiet.length || dueSoon.length)) {
    overallSignal = 'Mixed signals based on follow-up or milestone pressure.';
  }

  const lines = [];
  lines.push(`# ${projectName} Status Summary`);
  lines.push('');
  lines.push('## Overall Status');
  lines.push(`- Status signal: ${overallSignal}`);
  lines.push(`- Executive summary: ${stories.length} work item(s), ${timeline.length} milestone(s), and ${transcripts.length} captured source(s) are recorded. ${done.length} work item(s) are marked done, ${active.length} are active or in progress, and ${blocked.length} are blocked. ${updates.length ? `${updates.length} captured update(s) are available to support the narrative.` : 'No captured work-item updates are available yet.'}`);
  lines.push('');
  lines.push('## Delivery Highlights');
  if (done.length) {
    lines.push(`- ${done.length} work item(s) are recorded as done.`);
  }
  if (active.length) {
    lines.push(`- ${active.length} work item(s) are recorded as active or in progress.`);
  }
  if (updates.length) {
    const latest = updates[0];
    lines.push(`- Latest captured work-item evidence: ${storyDisplay(latest.story)}${latest.update.date ? ` (${latest.update.date})` : ''}.`);
  }
  externalProgressEvidence.slice(0, 5).forEach(item => {
    lines.push(`- Reviewed external ChatGPT feed evidence${item.finding.jiraId ? ` for ${item.finding.jiraId}` : ''} (original screenshots not retained): ${item.finding.exactExcerpt}`);
  });
  if (timeline.length) {
    lines.push(`- ${linkedMilestones} of ${timeline.length} milestone(s) are linked to work items.`);
  }
  if (!done.length && !active.length && !updates.length && !timeline.length) {
    lines.push('- No explicit delivery progress is recorded yet.');
  }

  lines.push('');
  lines.push('## Risks and Blockers');
  if (blocked.length || followup.length || quiet.length || overdue.length || dueSoon.length || ceremonyRisks.length) {
    blocked.slice(0, 5).forEach(story => {
      lines.push(`- ${storyDisplay(story)} is blocked${story.dependencies ? ` by ${story.dependencies}` : ''}.`);
    });
    followup.slice(0, 5).forEach(story => {
      lines.push(`- ${storyDisplay(story)} needs assignee follow-up${storyAssignee(story) ? ` (${storyAssignee(story)})` : ''}.`);
    });
    quiet.slice(0, 5).forEach(story => {
      lines.push(`- ${storyDisplay(story)} has no recent Jira comment recorded${story.lastCommentedAt ? ` since ${story.lastCommentedAt}` : ''}.`);
    });
    overdue.slice(0, 5).forEach(entry => {
      lines.push(`- Milestone "${entry.title}" is overdue${entry.date ? ` (${entry.date})` : ''}.`);
    });
    dueSoon.slice(0, 5).forEach(entry => {
      lines.push(`- Milestone "${entry.title}" is due soon${entry.date ? ` (${entry.date})` : ''}.`);
    });
  } else {
    lines.push('- No explicit risks recorded.');
  }
  ceremonyRisks.slice(0, 8)
    .forEach(item => lines.push(`- Reviewed ${item.transcript.sourceKind === 'external-ai-transcription' ? 'external ChatGPT feed' : item.transcript.type} evidence (${item.finding.category.replace(/_/g, ' ')}): ${item.finding.exactExcerpt}`));

  lines.push('');
  lines.push('## Milestones');
  if (timeline.length) {
    timeline.slice(0, 10).forEach(entry => {
      const health = milestoneHealthLabel(entry);
      const meta = [entry.date || 'No date', entry.status || health].filter(Boolean).join(' · ');
      lines.push(`- ${entry.title} — ${meta}`);
      if (entry.notes) lines.push(`  - Notes: ${entry.notes}`);
    });
  } else {
    lines.push('- No milestones recorded.');
  }

  lines.push('');
  lines.push('## Work Items Needing Attention');
  if (stories.length) {
    const attention = stories
      .map(story => ({
        story,
        status: inferStoryStatus(story),
        score:
          (inferStoryStatus(story) === 'Blocked' ? 5 : 0) +
          (itemNeedsFollowupServer(story) ? 4 : 0) +
          (itemNeedsCommentServer(story, settings) ? 3 : 0) +
          ((story.updates || []).length ? 0 : 1)
      }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    if (attention.length) {
      attention.forEach(entry => {
        const notes = [];
        if (entry.status === 'Blocked') notes.push('blocked');
        if (itemNeedsFollowupServer(entry.story)) notes.push('assignee follow-up needed');
        if (itemNeedsCommentServer(entry.story, settings)) notes.push('quiet Jira thread');
        if (!(entry.story.updates || []).length) notes.push('no captured updates');
        lines.push(`- ${storyDisplay(entry.story)}${notes.length ? ` — ${notes.join(', ')}` : ''}.`);
      });
    } else {
      lines.push('- No specific work items are currently flagged for attention.');
    }
  } else {
    lines.push('- No work items recorded.');
  }

  lines.push('');
  lines.push('## Evidence Gaps');
  if (!stories.length) lines.push('- No work items are recorded yet.');
  if (!updates.length) lines.push('- No captured work-item updates are available.');
  if (!transcripts.length) lines.push('- No transcript or DSU sources are available.');
  if (!timeline.length) lines.push('- No milestones are recorded.');
  if (undated.length) lines.push(`- ${undated.length} milestone(s) do not have dates.`);
  if (timeline.length && linkedMilestones < timeline.length) lines.push(`- ${timeline.length - linkedMilestones} milestone(s) are not linked to work items.`);
  if (transcripts.length) {
    transcripts.slice(0, 5).forEach(transcript => {
      if (transcript.notes || transcript.date || transcript.type) return;
      lines.push(`- Transcript "${transcript.title}" has limited structured metadata.`);
    });
  }
  const pendingFindings = transcripts.reduce((count, transcript) => count + (transcript.extractedFindings || []).filter(finding => finding.reviewStatus === 'pending').length, 0);
  if (pendingFindings) lines.push(`- ${pendingFindings} extracted ceremony finding(s) remain pending review and are excluded from trusted reporting.`);
  if (lines[lines.length - 1] === '## Evidence Gaps') {
    lines.push('- No obvious evidence gaps are visible from the recorded data.');
  }

  return lines.join('\n');
}

function parseUpdatesResponse(rawText) {
  const trimmed = String(rawText || '').trim();
  const parsed = extractJsonFromText(trimmed);
  if (parsed) return parsed;
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return [];
  }
}

async function runLlmExtraction(projectData, transcript, transcriptText, promptTemplate) {
  const prompt = renderPrompt(promptTemplate || defaultDsuExtractionPrompt, {
    storyList: renderStoryListForPrompt(projectData),
    transcriptTitle: transcript.title || '',
    transcriptType: transcript.type || '',
    transcriptText
  });
  const output = await callLlm(prompt);
  const items = parseUpdatesResponse(output);
  if (!Array.isArray(items)) return [];
  return items.filter(item => item && item.storyId && (item.excerpt || item.update));
}

function attachUpdatesToStories(projectData, transcript, updates) {
  const storyMap = new Map(projectData.stories.map(story => [story.id, story]));
  updates.forEach(item => {
    const story = storyMap.get(item.storyId);
    if (!story) return;
    if (!Array.isArray(story.updates)) story.updates = [];
    // A reviewed finding has stable source identity; never deduplicate on mutable display text.
    const newText = (item.update || item.excerpt || '').trim();
    const duplicate = story.updates.some(u => item.id
      ? u.transcriptId === transcript.id && u.findingId === item.id
      : (u.update || u.excerpt || '').trim() === newText && u.transcriptId === transcript.id);
    if (duplicate) return;
    story.updates.unshift({
      id: makeId('update'),
      transcriptId: transcript.id,
      findingId: item.id || '',
      transcriptTitle: transcript.title,
      excerpt: item.excerpt || '',
      update: item.update || item.excerpt || '',
      date: transcript.date || transcript.uploadedAt || new Date().toISOString(),
      source: item.source || transcript.title,
      associationReason: item.associationReason || '',
      extractorVersion: item.extractorVersion || '',
      extractionMethod: item.extractionMethod || ''
    });
    // Auto-derive lastUpdate from the most recent update's date (Option B design).
    // The lastUpdate field is now auto-populated, with optional lastUpdateNotes for manual annotation.
    if (story.updates.length > 0) {
      story.lastUpdate = story.updates[0].date;
    }
  });
}

function sourceSegments(sourceText) {
  const boundedSource = String(sourceText || '').slice(0, maxExtractionBytes);
  return boundedSource
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map(s => s.replace(/^[#>*\-\s]+/, '').trim())
    .filter(s => s.length > 15)
    .slice(0, 1000);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function segmentMentionsIdentifier(segment, identifier) {
  const token = String(identifier || '').trim();
  return !!token && new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(token)}(?=$|[^A-Za-z0-9_-])`, 'i').test(segment);
}

function findingFor(transcript, category, segment, story, associationReason) {
  const excerpt = segment.replace(/\s+/g, ' ').trim().slice(0, 500);
  return {
    id: makeId('finding'),
    sourceId: transcript.id,
    ceremonyType: transcript.type,
    category,
    storyId: story?.id || '',
    jiraId: story?.jiraId || '',
    exactExcerpt: excerpt,
    excerpt,
    summary: excerpt.slice(0, 220),
    owner: '',
    dueDate: '',
    associationReason: associationReason || '',
    extractionMethod: 'local-deterministic',
    extractorVersion: 'local-ceremony-v1',
    reviewStatus: 'pending',
    createdAt: new Date().toISOString()
  };
}

const ceremonyCategoryRules = {
  'Sprint Planning': [
    ['sprint_commitment', /\b(commit(?:ted|ment)?|sprint goal)\b/i],
    ['carryover', /\b(carry[ -]?over|rolled? over)\b/i],
    ['capacity_constraint', /\b(capacity|availability|constrained|time off|pto)\b/i],
    ['dependency', /\b(depend(?:ency|ent|s on)|blocked by|waiting for)\b/i],
    ['blocker', /\b(blocked|blocker)\b/i],
    ['risk', /\b(risk|concern|uncertain)\b/i],
    ['scope_change', /\b(scope change|out of scope|added scope|removed scope)\b/i],
    ['action', /\b(action|follow up|next step)\b/i],
    ['ownership', /\b(owner|assigned to|will take)\b/i]
  ],
  'Backlog Refinement': [
    ['acceptance_criterion', /\b(acceptance criteri(?:a|on)|given when then)\b/i],
    ['open_question', /\b(open question|question|to clarify|unknown)\b/i],
    ['missing_information', /\b(missing|need more information|needs detail)\b/i],
    ['dependency', /\b(depend(?:ency|ent|s on)|blocked by|waiting for)\b/i],
    ['risk', /\b(risk|concern|uncertain)\b/i],
    ['estimate', /\b(estimate|points?|sized?|complexity)\b/i],
    ['readiness_gap', /\b(not ready|readiness|not refined|needs refinement)\b/i],
    ['story_split', /\b(split|too large|smaller stor(?:y|ies))\b/i],
    ['action', /\b(action|follow up|next step)\b/i],
    ['ownership', /\b(owner|assigned to|will take)\b/i]
  ]
};

function extractSourceFindings(projectData, transcript, sourceText) {
  const segments = sourceSegments(sourceText);
  if (!segments.length) return [];
  const stories = (projectData.stories || []).slice(0, 1000);
  const findings = [];

  if (transcript.type === 'DSU') {
    for (const segment of segments) {
      for (const story of stories) {
        const identifier = [story.jiraId, story.id].find(value => segmentMentionsIdentifier(segment, value));
        if (!identifier) continue;
        findings.push(findingFor(transcript, 'progress_update', segment, story, `Exact identifier match: ${identifier}`));
        if (findings.length >= 200) return findings;
      }
    }
    return findings;
  }

  const rules = ceremonyCategoryRules[transcript.type] || [];
  for (const segment of segments) {
    const story = stories.find(item => [item.jiraId, item.id].some(value => segmentMentionsIdentifier(segment, value)));
    const identifier = story && (segmentMentionsIdentifier(segment, story.jiraId) ? story.jiraId : story.id);
    for (const [category, pattern] of rules) {
      if (!pattern.test(segment)) continue;
      findings.push(findingFor(transcript, category, segment, story, identifier ? `Exact identifier match: ${identifier}` : 'Unlinked ceremony evidence'));
      if (findings.length >= 200) return findings;
    }
  }
  return findings;
}

function extractDsuUpdates(projectData, transcript, sourceText) {
  return extractSourceFindings(projectData, { ...transcript, type: 'DSU' }, sourceText)
    .map(item => ({ storyId: item.storyId, excerpt: item.exactExcerpt }));
}

function recomputeStoryLastUpdate(story) {
  const latest = (story.updates || []).map(item => item.date).filter(Boolean).sort().reverse()[0];
  story.lastUpdate = latest || '';
}

function readTranscriptTextForExtraction(transcript) {
  let text = String(transcript.notes || '');
  if (!transcript.file || transcript.sourceKind === 'reference') return text;
  const diskPath = path.join(transcriptsDir, path.basename(transcript.file));
  try {
    const stat = fs.statSync(diskPath);
    if (stat.size <= maxExtractionBytes) text += `\n${fs.readFileSync(diskPath, 'utf8')}`;
  } catch (error) {
    console.warn('Unable to re-read source text:', error.message);
  }
  return text.slice(0, maxExtractionBytes);
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Download a complete, read-only snapshot of the workspace source of truth.
// readData() validates the JSON first, so corrupt data is never offered as a usable backup.
app.get('/api/backup', (req, res) => {
  const data = readData();
  const now = new Date();
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  res.set({
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="priorena-backup-${date}.json"`
  });
  res.type('application/json').send(`${JSON.stringify(data, null, 2)}\n`);
});

app.get('/api/projects', (req, res) => {
  const data = readData();
  res.json(data.projects || {});
});

app.post('/api/projects', (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Missing project name' });
  }

  const projectName = sanitizeName(name);
  if (!isSafeProjectKey(projectName)) {
    return res.status(400).json({ error: 'Invalid project name' });
  }
  if (projectName.length > 120) {
    return res.status(400).json({ error: 'Project name is too long (max 120 characters)' });
  }

  const data = readData();
  if (!data.projects) data.projects = Object.create(null);
  if (hasOwn(data.projects, projectName)) {
    return res.status(409).json({ error: 'Project already exists' });
  }

  data.projects[projectName] = {
    description: description || '',
    deliveryProjects: [],
    stories: [],
    timeline: [],
    transcripts: []
  };
  writeData(data);

  res.json({ name: projectName, project: data.projects[projectName] });
});

app.put('/api/project', (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Missing project name' });
  }
  const data = readData();
  const projectData = getProject(data, name);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  if (description !== undefined) projectData.description = description;
  writeData(data);
  res.json({ name, project: projectData });
});

app.delete('/api/project', (req, res) => {
  const name = req.query.name;
  if (!name) {
    return res.status(400).json({ error: 'Missing project name' });
  }
  const data = readData();
  const projectData = getProject(data, name);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  if ((data.briefingStreams || []).some(stream => Array.isArray(stream.projectNames) && stream.projectNames.includes(name))) {
    return res.status(409).json({ error: 'Project belongs to a briefing stream and cannot be deleted' });
  }
  const transcriptFiles = [...(projectData.transcripts || [])];
  delete data.projects[name];
  writeData(data);
  // Commit metadata first so a failed JSON write cannot orphan records whose source files are gone.
  transcriptFiles.forEach(deleteTranscriptFile);
  res.json({ success: true });
});

app.get('/api/project', (req, res) => {
  const name = req.query.name;
  if (!name) {
    return res.status(400).json({ error: 'Missing project name' });
  }

  const data = readData();
  const project = getProject(data, name);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  res.json(project);
});

app.post('/api/project/delivery-project', (req, res) => {
  assertBodyKeys(req.body, ['workspace', 'name', 'jiraEpicKey', 'jiraEpicName', 'owner', 'planningTarget', 'description', 'workstreams', 'archived']);
  const workspaceName = String(req.body.workspace || '').trim();
  if (!workspaceName) return res.status(400).json({ error: 'PM workspace is required' });
  const data = readData();
  const workspace = getProject(data, workspaceName);
  if (!workspace) return res.status(404).json({ error: 'PM workspace not found' });
  const { workspace: _workspace, ...projectInput } = req.body;
  const project = createDeliveryProject(projectInput);
  assertUniqueDeliveryProject(workspace, project);
  workspace.deliveryProjects.push(project);
  writeData(data);
  res.status(201).json(project);
});

app.put('/api/project/delivery-project', (req, res) => {
  assertBodyKeys(req.body, ['workspace', 'id', 'name', 'jiraEpicKey', 'jiraEpicName', 'owner', 'planningTarget', 'description', 'workstreams', 'archived']);
  const workspaceName = String(req.body.workspace || '').trim();
  const id = String(req.body.id || '').trim();
  if (!workspaceName || !id) return res.status(400).json({ error: 'PM workspace and Project ID are required' });
  const data = readData();
  const workspace = getProject(data, workspaceName);
  if (!workspace) return res.status(404).json({ error: 'PM workspace not found' });
  const index = workspace.deliveryProjects.findIndex(item => item && item.id === id);
  if (index === -1) return res.status(404).json({ error: 'Project not found' });
  const { workspace: _workspace, id: _id, ...projectInput } = req.body;
  const project = updateDeliveryProject(workspace.deliveryProjects[index], projectInput);
  assertUniqueDeliveryProject(workspace, project, id);
  workspace.deliveryProjects[index] = project;
  writeData(data);
  res.json(project);
});

app.put('/api/project/story/delivery-project', (req, res) => {
  assertBodyKeys(req.body, ['workspace', 'storyIds', 'deliveryProjectId']);
  const workspaceName = String(req.body.workspace || '').trim();
  const deliveryProjectId = String(req.body.deliveryProjectId || '').trim();
  if (!workspaceName || !Array.isArray(req.body.storyIds) || !req.body.storyIds.length || req.body.storyIds.length > 500) {
    return res.status(400).json({ error: 'Select between 1 and 500 work items' });
  }
  const data = readData();
  const workspace = getProject(data, workspaceName);
  if (!workspace) return res.status(404).json({ error: 'PM workspace not found' });
  if (deliveryProjectId && !findDeliveryProject(workspace, deliveryProjectId)) return res.status(400).json({ error: 'Project not found' });
  const requested = new Set(req.body.storyIds.map(value => String(value || '').trim()).filter(Boolean));
  if (requested.size !== req.body.storyIds.length) return res.status(400).json({ error: 'Work-item selection contains an invalid or duplicate ID' });
  const matches = workspace.stories.filter(story => requested.has(story.id));
  if (matches.length !== requested.size) return res.status(404).json({ error: 'One or more work items were not found' });
  matches.forEach(story => { story.deliveryProjectId = deliveryProjectId; });
  writeData(data);
  res.json({ updated: matches.length, deliveryProjectId });
});

app.get('/api/briefing-streams', (req, res) => {
  const data = readData();
  res.json(data.briefingStreams);
});

app.post('/api/briefing-streams', (req, res) => {
  assertBodyKeys(req.body, ['name', 'projectNames', 'deliveryProjectIds', 'audienceProfile', 'preferredFormats', 'defaultSections']);
  const data = readData();
  const stream = createBriefingStream(req.body, {
    projectNames: Object.keys(data.projects),
    deliveryProjectIds: deliveryProjectIdsForWorkspaces(data, req.body.projectNames)
  });
  if (data.briefingStreams.some(item => item && String(item.name).toLowerCase() === stream.name.toLowerCase())) {
    return res.status(409).json({ error: 'A briefing stream with this name already exists' });
  }
  data.briefingStreams.push(stream);
  writeData(data);
  res.status(201).json(stream);
});

app.put('/api/briefing-streams/:id', (req, res) => {
  assertBodyKeys(req.body, ['name', 'projectNames', 'deliveryProjectIds', 'audienceProfile', 'preferredFormats', 'defaultSections']);
  const data = readData();
  const index = data.briefingStreams.findIndex(stream => stream && stream.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Briefing stream not found' });
  const updated = updateBriefingStream(data.briefingStreams[index], req.body, {
    projectNames: Object.keys(data.projects),
    deliveryProjectIds: deliveryProjectIdsForWorkspaces(data, req.body.projectNames)
  });
  if (data.briefingStreams.some((item, itemIndex) => itemIndex !== index && item && String(item.name).toLowerCase() === updated.name.toLowerCase())) {
    return res.status(409).json({ error: 'A briefing stream with this name already exists' });
  }
  data.briefingStreams[index] = updated;
  writeData(data);
  res.json(updated);
});

app.delete('/api/briefing-streams/:id', (req, res) => {
  const data = readData();
  const index = data.briefingStreams.findIndex(stream => stream && stream.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Briefing stream not found' });
  if (data.briefings.some(briefing => briefing && briefing.streamId === req.params.id)) {
    return res.status(409).json({ error: 'A briefing stream with briefing history cannot be deleted' });
  }
  data.briefingStreams.splice(index, 1);
  writeData(data);
  res.json({ success: true });
});

app.get('/api/briefings', (req, res) => {
  const data = readData();
  const streamId = String(req.query.streamId || '').trim();
  if (streamId.length > 220) return res.status(400).json({ error: 'streamId is too long' });
  const briefings = streamId
    ? data.briefings.filter(briefing => briefing && briefing.streamId === streamId)
    : data.briefings;
  res.json(briefings);
});

app.get('/api/briefings/:id', (req, res) => {
  const data = readData();
  const briefing = findBriefing(data, req.params.id);
  if (!briefing) return res.status(404).json({ error: 'Briefing not found' });
  res.json(briefing);
});

app.get('/api/briefings/:id/evidence-candidates', (req, res) => {
  const data = readData();
  const briefing = findBriefing(data, req.params.id);
  if (!briefing) return res.status(404).json({ error: 'Briefing not found' });
  if (briefing.status !== 'draft') return res.status(409).json({ error: 'Evidence candidates are available only while drafting' });
  res.json(collectAcceptedEvidenceCandidates(data.projects, briefing));
});

app.post('/api/briefings', (req, res) => {
  assertBodyKeys(req.body, ['streamId']);
  const streamId = typeof req.body.streamId === 'string' ? req.body.streamId.trim() : '';
  if (!streamId) return res.status(400).json({ error: 'streamId is required' });
  const data = readData();
  const stream = findBriefingStream(data, streamId);
  if (!stream) return res.status(404).json({ error: 'Briefing stream not found' });
  if (data.briefings.some(briefing => briefing && briefing.streamId === streamId && ['draft', 'finalized'].includes(briefing.status))) {
    return res.status(409).json({ error: 'Finish or communicate the current briefing before starting another' });
  }
  const briefing = createBriefing(stream, data.projects, data.briefings, { statusForStory: inferStoryStatus });
  data.briefings.push(briefing);
  writeData(data);
  res.status(201).json(briefing);
});

app.put('/api/briefings/:id/facts', (req, res) => {
  assertBodyKeys(req.body, ['facts']);
  const data = readData();
  const index = data.briefings.findIndex(briefing => briefing && briefing.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Briefing not found' });
  const current = data.briefings[index];
  const briefing = replaceDraftFacts(current, req.body.facts, {
    allowedEvidenceIds: briefingEvidenceIds(data, current),
    allowedChangeIds: new Set((current.detectedChanges || []).map(change => change && change.id).filter(Boolean))
  });
  data.briefings[index] = briefing;
  writeData(data);
  res.json(briefing);
});

app.post('/api/briefings/:id/finalize', (req, res) => {
  assertBodyKeys(req.body, []);
  const data = readData();
  const index = data.briefings.findIndex(briefing => briefing && briefing.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Briefing not found' });
  assertBriefingEvidenceStillAccepted(data, data.briefings[index]);
  const briefing = finalizeBriefing(data.briefings[index]);
  data.briefings[index] = briefing;
  writeData(data);
  res.json(briefing);
});

app.post('/api/briefings/:id/outputs', (req, res) => {
  assertBodyKeys(req.body, []);
  const data = readData();
  const briefingIndex = data.briefings.findIndex(briefing => briefing && briefing.id === req.params.id);
  if (briefingIndex === -1) return res.status(404).json({ error: 'Briefing not found' });
  const stream = findBriefingStream(data, data.briefings[briefingIndex].streamId);
  if (!stream) return res.status(409).json({ error: 'Briefing stream is missing' });
  const briefing = generateBriefingOutputs(stream, data.briefings[briefingIndex]);
  data.briefings[briefingIndex] = briefing;
  writeData(data);
  res.json(briefing);
});

app.post('/api/briefings/:id/communicate', (req, res) => {
  assertBodyKeys(req.body, []);
  const data = readData();
  const briefingIndex = data.briefings.findIndex(briefing => briefing && briefing.id === req.params.id);
  if (briefingIndex === -1) return res.status(404).json({ error: 'Briefing not found' });
  const streamIndex = data.briefingStreams.findIndex(stream => stream && stream.id === data.briefings[briefingIndex].streamId);
  if (streamIndex === -1) return res.status(409).json({ error: 'Briefing stream is missing' });
  const communicated = markBriefingCommunicated(data.briefingStreams[streamIndex], data.briefings[briefingIndex]);
  data.briefingStreams[streamIndex] = communicated.stream;
  data.briefings[briefingIndex] = communicated.briefing;
  writeData(data);
  res.json(communicated);
});

function validateExternalFeedForProject(rawFeed, projectData) {
  return validateExternalFeed(rawFeed, {
    resolveStatus: value => mappedOperatingStatus(projectData, value) || defaultOperatingStatus(value),
    isAcceptableTimestamp: value => isAcceptableCommentTimestamp(value)
  });
}

function externalFeedFinding(transcript, raw, projectData) {
  const story = (projectData.stories || []).find(item => normalizeText(item.jiraId) === normalizeText(raw.jiraId));
  return {
    id: makeId('finding'),
    externalEvidenceId: raw.id,
    sourceId: transcript.id,
    ceremonyType: transcript.type,
    category: raw.category,
    storyId: story?.id || '',
    jiraId: raw.jiraId || '',
    exactExcerpt: raw.exactExcerpt,
    excerpt: raw.exactExcerpt,
    summary: raw.exactExcerpt.slice(0, 220),
    owner: raw.speaker || '',
    dueDate: '',
    associationReason: story ? `Exact Jira key from external transcription: ${raw.jiraId}` : 'Unlinked external transcription evidence',
    extractionMethod: 'external-ai-transcription',
    extractorVersion: transcript.externalTranscription.promptVersion,
    sourceRef: raw.sourceRef || '',
    visibleTimestamp: raw.visibleTimestamp || '',
    reviewNote: raw.reviewNote || '',
    reviewStatus: 'pending',
    createdAt: new Date().toISOString()
  };
}

function parseAndValidateExternalFeed(feedText, fileName, projectData) {
  return validateExternalFeedForProject(parseExternalFeedText(feedText, fileName), projectData);
}

function rejectLegacyScreenshotImport(_req, res) {
  return res.status(410).json({ error: 'Screenshot uploads are no longer accepted. Import a .json or .md external feed instead.' });
}

app.all('/api/project/screenshot-import', rejectLegacyScreenshotImport);
app.all('/api/project/screenshot-import/*', rejectLegacyScreenshotImport);

app.post('/api/project/external-feed/preview', (req, res) => {
  const { project, feedText, fileName } = req.body || {};
  if (!project || !feedText || !fileName) return res.status(400).json({ error: 'Missing project or feed file content' });
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });
  const validated = parseAndValidateExternalFeed(feedText, fileName, projectData);
  res.json(buildExternalFeedPreview(projectData, validated, inferStoryStatus));
});

app.post('/api/project/external-feed', (req, res) => {
  const { project, feedText, fileName } = req.body || {};
  if (!project || !feedText || !fileName) return res.status(400).json({ error: 'Missing project or feed file content' });
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });
  const validated = parseAndValidateExternalFeed(feedText, fileName, projectData);
  const preview = buildExternalFeedPreview(projectData, validated, inferStoryStatus);
  if ((projectData.transcripts || []).some(item => item.externalTranscription?.feedHash === validated.feedHash)) {
    return res.status(409).json({ error: 'This exact external feed already exists' });
  }
  const now = new Date().toISOString();
  const transcript = {
    id: makeId('transcript'),
    title: validated.sanitized.source.title,
    file: '',
    originalName: '',
    notes: 'Externally transcribed by ChatGPT. Original screenshots were not provided to or retained by Priorena.',
    date: validated.sanitized.source.visibleDate || '',
    type: validated.sanitized.source.sourceType,
    sourceKind: 'external-ai-transcription',
    extractionNote: 'External ChatGPT feed — original screenshots not retained. Priorena did not perform OCR or independently verify the transcription.',
    externalTranscription: {
      schemaVersion: validated.sanitized.schemaVersion,
      provider: validated.sanitized.source.transcriptionProvider,
      promptVersion: validated.sanitized.source.promptVersion,
      feedHash: validated.feedHash,
      originalScreenshotsRetained: false,
      importStatus: 'pending',
      importedAt: now,
      appliedAt: '',
      warnings: preview.warnings
    },
    externalFeed: validated.sanitized,
    proposedWorkItemChanges: preview.items,
    extractedFindings: [],
    uploadedAt: now
  };
  transcript.extractedFindings = [...validated.sanitized.evidence, ...validated.sanitized.unlinkedEvidence]
    .map(item => externalFeedFinding(transcript, item, projectData));
  projectData.transcripts.unshift(transcript);
  writeData(data);
  res.json({ transcript, preview });
});

function applyImportedField(story, field, value) {
  if (field === 'status') story.labels = applyOperatingStatusLabel(story.labels, value);
  else if (field === 'itemType') story.itemType = itemTypeOrUnknown(value);
  else if (field === 'assignee') { story.assignee = value; story.owner = value; }
  else if (field === 'lastComment') story.lastComment = value;
  else if (field === 'lastCommentedAt') { story.lastCommentedAt = value || null; story.commentAdded = !!value; }
  else story[field] = value;
}

function newStoryFromApprovedFields(fields) {
  const story = {
    id: makeId('story'), deliveryProjectId: '', itemType: 'Unknown', summary: '', description: '', acceptanceCriteria: [], dependencies: '', labels: [], environment: '', notes: 'Created from a reviewed external ChatGPT feed',
    timelineId: '', createdAt: new Date().toISOString(), updates: [], tracked: false, jiraId: '', assignee: '', owner: '', sprint: '', contacted: false,
    commentAdded: false, lastCommentedAt: null, lastComment: '', lastUpdate: '', lastUpdateNotes: ''
  };
  Object.entries(fields).forEach(([field, value]) => applyImportedField(story, field, value));
  return story;
}

app.put('/api/project/external-feed/apply', (req, res) => {
  const { project, transcriptId, decisions } = req.body || {};
  if (!project || !transcriptId || !Array.isArray(decisions) || decisions.length > 12000) {
    return res.status(400).json({ error: 'Missing or invalid import decisions' });
  }
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });
  const transcript = (projectData.transcripts || []).find(item => item.id === transcriptId && item.sourceKind === 'external-ai-transcription');
  if (!transcript) return res.status(404).json({ error: 'Pending external feed not found' });
  if (transcript.externalTranscription?.importStatus !== 'pending') return res.status(409).json({ error: 'This import is no longer pending' });
  const revalidated = validateExternalFeedForProject(transcript.externalFeed, projectData);
  if (revalidated.feedHash !== transcript.externalTranscription.feedHash) return res.status(409).json({ error: 'Import provenance no longer matches its validated feed' });
  const safePreview = buildExternalFeedPreview(projectData, revalidated, inferStoryStatus);
  const proposalMap = new Map(safePreview.items.map(item => [item.jiraId, item]));
  const storyMap = new Map();
  for (const story of (projectData.stories || []).filter(item => item.jiraId)) {
    const key = String(story.jiraId).trim().toUpperCase();
    if (storyMap.has(key)) return res.status(409).json({ error: `Project contains duplicate Jira key: ${key}` });
    storyMap.set(key, story);
  }
  const approvedByJira = new Map();
  const auditDecisions = [];
  const decisionKeys = new Set();
  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return res.status(400).json({ error: 'Invalid import decision' });
    const allowedKeys = new Set(['jiraId', 'field', 'decision', 'expectedCurrentValue', 'action', 'itemType', 'deliveryProjectId']);
    if (Object.keys(decision).some(key => reservedProjectKeys.has(key) || !allowedKeys.has(key))) return res.status(400).json({ error: 'Import decision contains unsupported fields' });
    if (decision.action === 'create' && Object.keys(decision).some(key => !['jiraId', 'action', 'itemType'].includes(key))) return res.status(400).json({ error: 'Creation decision contains unsupported fields' });
    if (decision.action === 'assign_project' && Object.keys(decision).some(key => !['jiraId', 'action', 'expectedCurrentValue', 'deliveryProjectId'].includes(key))) return res.status(400).json({ error: 'Project assignment decision contains unsupported fields' });
    if (decision.action !== 'create' && Object.hasOwn(decision, 'itemType')) return res.status(400).json({ error: 'itemType is only valid on a creation decision' });
    const jiraId = String(decision.jiraId || '').trim().toUpperCase();
    const proposal = proposalMap.get(jiraId);
    if (!proposal) return res.status(400).json({ error: `No proposal exists for ${jiraId}` });
    if (decision.action === 'create') {
      const decisionKey = `${jiraId}\u0000create`;
      if (decisionKeys.has(decisionKey)) return res.status(400).json({ error: 'Duplicate import decision' });
      decisionKeys.add(decisionKey);
      if (storyMap.has(jiraId)) return res.status(409).json({ error: `${jiraId} already exists` });
      const creationItemType = normalizeItemType(decision.itemType);
      if (!creationItemType) return res.status(400).json({ error: `${jiraId} creation requires a valid itemType` });
      const entry = approvedByJira.get(jiraId) || { create: false, fields: Object.create(null) };
      entry.create = true;
      entry.itemType = creationItemType;
      approvedByJira.set(jiraId, entry);
      auditDecisions.push({ jiraId, action: 'create', itemType: creationItemType });
      continue;
    }
    if (decision.action === 'assign_project') {
      const decisionKey = `${jiraId}\u0000assign_project`;
      if (decisionKeys.has(decisionKey)) return res.status(400).json({ error: 'Duplicate import decision' });
      decisionKeys.add(decisionKey);
      const association = proposal.epicAssociation;
      if (!association || association.blocked || !association.proposedDeliveryProjectId) return res.status(400).json({ error: `${jiraId} has no exact Project match` });
      if (decision.deliveryProjectId !== association.proposedDeliveryProjectId) return res.status(409).json({ error: `${jiraId} Project proposal changed after preview` });
      if (!findDeliveryProject(projectData, decision.deliveryProjectId)) return res.status(409).json({ error: `${jiraId} Project no longer exists` });
      const story = storyMap.get(jiraId);
      const currentValue = story?.deliveryProjectId || '';
      if (!valuesEqual(currentValue, decision.expectedCurrentValue)) return res.status(409).json({ error: `${jiraId} Project association changed after preview` });
      const entry = approvedByJira.get(jiraId) || { create: false, fields: Object.create(null) };
      entry.deliveryProjectId = decision.deliveryProjectId;
      approvedByJira.set(jiraId, entry);
      auditDecisions.push({ jiraId, action: 'assign_project', deliveryProjectId: decision.deliveryProjectId });
      continue;
    }
    if (!externalFeedFields.has(decision.field) || !['replace', 'keep'].includes(decision.decision)) return res.status(400).json({ error: 'Invalid field decision' });
    const decisionKey = `${jiraId}\u0000${decision.field}`;
    if (decisionKeys.has(decisionKey)) return res.status(400).json({ error: 'Duplicate import decision' });
    decisionKeys.add(decisionKey);
    const fieldProposal = proposal.fields?.[decision.field];
    if (!fieldProposal) return res.status(400).json({ error: `No ${decision.field} proposal exists for ${jiraId}` });
    if (decision.decision === 'replace' && fieldProposal.blocked) return res.status(409).json({ error: `${jiraId} ${decision.field} is blocked because the external evidence is older` });
    const story = storyMap.get(jiraId);
    if (!story && decision.field === 'itemType') return res.status(400).json({ error: `${jiraId} itemType must be selected in the creation decision` });
    const currentValue = story ? storyFieldValue(story, decision.field, inferStoryStatus) : null;
    if (!valuesEqual(currentValue, decision.expectedCurrentValue)) return res.status(409).json({ error: `${jiraId} ${decision.field} changed after preview` });
    if (decision.decision === 'replace') {
      const entry = approvedByJira.get(jiraId) || { create: false, fields: Object.create(null) };
      entry.fields[decision.field] = fieldProposal.proposedValue;
      approvedByJira.set(jiraId, entry);
    }
    auditDecisions.push({ jiraId, field: decision.field, decision: decision.decision });
  }

  if (!approvedByJira.size) return res.status(400).json({ error: 'No field changes or work-item creations were approved' });

  let applied = 0;
  let created = 0;
  let updated = 0;
  for (const [jiraId, approval] of approvedByJira.entries()) {
    let story = storyMap.get(jiraId);
    if (!story) {
      if (!approval.create) return res.status(400).json({ error: `${jiraId} requires explicit creation approval` });
      story = newStoryFromApprovedFields(approval.fields);
      story.jiraId = jiraId;
      if (!story.summary) return res.status(400).json({ error: `${jiraId} requires an approved summary` });
      story.itemType = approval.itemType;
      if (approval.deliveryProjectId) story.deliveryProjectId = approval.deliveryProjectId;
      projectData.stories.unshift(story);
      storyMap.set(jiraId, story);
      created += 1;
      applied += Object.keys(approval.fields).length + (approval.deliveryProjectId ? 1 : 0);
    } else {
      const approvedFields = Object.entries(approval.fields);
      const projectAssociationChanged = !!approval.deliveryProjectId && story.deliveryProjectId !== approval.deliveryProjectId;
      approvedFields.forEach(([field, value]) => { applyImportedField(story, field, value); applied += 1; });
      if (projectAssociationChanged) {
        story.deliveryProjectId = approval.deliveryProjectId;
        applied += 1;
      }
      if (approvedFields.length || projectAssociationChanged) updated += 1;
    }
    (transcript.extractedFindings || []).forEach(finding => {
      if (finding.jiraId === jiraId && !finding.storyId) finding.storyId = story.id;
    });
  }
  transcript.externalTranscription.importStatus = 'applied';
  transcript.externalTranscription.appliedAt = new Date().toISOString();
  transcript.externalTranscription.decisions = auditDecisions;
  writeData(data);
  res.json({ applied, created, updated, transcript });
});

app.delete('/api/project/external-feed', (req, res) => {
  const { project, transcriptId } = req.query;
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });
  const transcript = (projectData.transcripts || []).find(item => item.id === transcriptId && item.sourceKind === 'external-ai-transcription');
  if (!transcript) return res.status(404).json({ error: 'External feed not found' });
  projectData.transcripts = projectData.transcripts.filter(item => item.id !== transcriptId);
  writeData(data);
  res.json({ success: true });
});

app.get('/api/project/transcript/file', (req, res) => {
  const { project: projectName, id, attachmentId } = req.query;
  const data = readData();
  const projectData = getProject(data, projectName);
  const transcript = projectData && (projectData.transcripts || []).find(item => item.id === id);
  const attachment = transcript && attachmentId ? (transcript.attachments || []).find(item => item.id === attachmentId) : null;
  if (attachmentId && !attachment) return res.status(404).json({ error: 'Source file not found' });
  const storedName = attachment?.file || transcript?.file;
  const originalName = attachment?.originalName || transcript?.originalName;
  if (!transcript || !storedName) return res.status(404).json({ error: 'Source file not found' });

  const diskPath = path.join(transcriptsDir, path.basename(storedName));
  if (!fs.existsSync(diskPath)) return res.status(404).json({ error: 'Source file not found' });
  res.set({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.download(diskPath, path.basename(originalName || 'source-file'));
});

app.get('/api/ai/prompts', (req, res) => {
  const data = readData();
  const prompts = getAiPrompts(data);
  res.json(prompts);
});

app.put('/api/ai/prompts', (req, res) => {
  const { dsuExtraction, statusReport } = req.body;
  if (dsuExtraction === undefined && statusReport === undefined) {
    return res.status(400).json({ error: 'Missing prompt updates' });
  }

  const data = readData();
  const prompts = getAiPrompts(data);
  if (dsuExtraction !== undefined) prompts.dsuExtraction = dsuExtraction;
  if (statusReport !== undefined) prompts.statusReport = statusReport;
  data.aiPrompts = prompts;
  writeData(data);
  res.json(prompts);
});

app.get('/api/settings', (req, res) => {
  const data = readData();
  res.json(getSettings(data));
});

// Read-only environment info for the UI (e.g. the sidebar AI-mode footer). Never leaks the
// key itself — only which provider (if any) is active. null → fully heuristic mode.
app.get('/api/meta', (req, res) => {
  res.json({ provider: getProvider() });
});

app.put('/api/settings', (req, res) => {
  const { commentStaleDays, sprintOptions } = req.body;
  if (commentStaleDays === undefined && sprintOptions === undefined) {
    return res.status(400).json({ error: 'Missing settings updates' });
  }
  const data = readData();
  if (!data.settings) data.settings = {};
  if (commentStaleDays !== undefined) {
    const n = parseInt(commentStaleDays, 10);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      return res.status(400).json({ error: 'commentStaleDays must be a number between 1 and 365' });
    }
    data.settings.commentStaleDays = n;
  }
  if (sprintOptions !== undefined) {
    const nextOptions = Array.isArray(sprintOptions)
      ? sprintOptions
      : String(sprintOptions || '').split('\n');
    data.settings.sprintOptions = nextOptions.map(value => String(value || '').trim()).filter(Boolean);
  }
  writeData(data);
  res.json(getSettings(data));
});

app.post('/api/project/status-report', wrap(async (req, res) => {
  const { project, mode = 'heuristic' } = req.body;
  if (!project) {
    return res.status(400).json({ error: 'Missing project name' });
  }
  if (!['heuristic', 'ai'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid status summary mode' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const prompts = getAiPrompts(data);
  const settings = getSettings(data);
  let report = '';
  let source = 'heuristic';

  const timelineList = renderTimelineListForPrompt(projectData);
  const transcriptList = renderTranscriptListForPrompt(projectData);

  if (mode === 'heuristic') {
    report = generateHeuristicStatusReport(projectData, project, settings);
  } else {
    if (!getProvider()) {
      return res.status(400).json({ error: 'AI drafting is not configured. Add a provider key in web/.env and restart the app.' });
    }
    const prompt = renderPrompt(prompts.statusReport, {
      projectName: project,
      timelineList,
      storyList: renderStoryListForReport(projectData),
      transcriptList
    }) + '\n\nAdditional guardrails: do not use vague group claims. State current Jira status and recorded update separately if they differ.';
    report = await callLlm(prompt);
    source = 'ai-draft';
    if (!report || !report.trim()) {
      throw new Error('Empty report from AI');
    }
  }

  res.json({ report, source });
}));

app.post('/api/project/story', (req, res) => {
  const { project, summary, description, acceptanceCriteria, dependencies, labels, environment, notes,
    itemType, tracked, jiraId, owner, assignee, sprint, contacted, commentAdded, lastUpdate, lastComment, lastUpdateNotes, deliveryProjectId } = req.body;
  const timelineId = req.body.timelineId || '';
  if (!project || !summary) {
    return res.status(400).json({ error: 'Missing project or summary' });
  }
  const resolvedItemType = normalizeItemType(itemType);
  if (!resolvedItemType) return res.status(400).json({ error: `Item type is required and must be one of: ${ITEM_TYPES.join(', ')}` });

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  if (deliveryProjectId && !findDeliveryProject(projectData, deliveryProjectId)) return res.status(400).json({ error: 'Delivery Project not found' });

  const story = {
    id: makeId('story'),
    deliveryProjectId: deliveryProjectId || '',
    itemType: resolvedItemType,
    summary,
    description: description || '',
    acceptanceCriteria: Array.isArray(acceptanceCriteria) ? acceptanceCriteria : (acceptanceCriteria ? acceptanceCriteria.split('\n').map(item => item.trim()).filter(Boolean) : []),
    dependencies: dependencies || '',
    labels: Array.isArray(labels) ? labels : (labels ? labels.split(',').map(item => item.trim()).filter(Boolean) : []),
    environment: environment || '',
    notes: notes || '',
    timelineId: timelineId || '',
    createdAt: new Date().toISOString(),
    updates: [],
    // Unified item: a story may also be "tracked" (the follow-up/Jira chase list). These
    // fields are the former Ticket fields; absent/false when the item isn't tracked.
    tracked: !!tracked,
    jiraId: jiraId || '',
    assignee: assignee !== undefined ? assignee || '' : owner || '',
    owner: assignee !== undefined ? assignee || '' : owner || '',
    sprint: sprint || '',
    contacted: !!contacted,
    commentAdded: !!commentAdded,
    lastCommentedAt: commentAdded ? new Date().toISOString() : null,
    lastComment: lastComment !== undefined ? lastComment || '' : lastUpdate || '',
    lastUpdate: lastComment !== undefined ? lastComment || '' : lastUpdate || '',
    lastUpdateNotes: lastUpdateNotes || ''
  };

  projectData.stories.unshift(story);
  writeData(data);
  res.json(story);
});

app.post('/api/project/story/import/preview', csvMultipart, (req, res) => {
  const project = req.body.project;
  if (!project || !req.file) return res.status(400).json({ error: 'Choose a CSV file and project' });
  if (!/\.csv$/i.test(req.file.originalname || '')) return res.status(400).json({ error: 'Only .csv files can be imported' });
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });
  try {
    const preview = mapCsvWorkItems(req.file.buffer.toString('utf8'), projectData);
    res.json({ ...preview, fileName: req.file.originalname });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to read CSV' });
  }
});

app.post('/api/project/story/import', (req, res) => {
  const { project, items } = req.body;
  if (!project || !Array.isArray(items)) return res.status(400).json({ error: 'Missing project or imported work items' });
  if (items.length > 1000) return res.status(400).json({ error: 'Import is limited to 1,000 work items at a time' });
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });

  const existingJiraIds = new Set((projectData.stories || []).map(story => normalizeText(story.jiraId)).filter(Boolean));
  const created = [];
  const skipped = [];
  items.forEach((item, index) => {
    const summary = String(item.summary || '').trim();
    const jiraId = String(item.jiraId || '').trim();
    const normalizedJiraId = normalizeText(jiraId);
    if (!summary) { skipped.push({ row: item.sourceRow || index + 1, reason: 'Missing summary' }); return; }
    if (normalizedJiraId && existingJiraIds.has(normalizedJiraId)) {
      skipped.push({ row: item.sourceRow || index + 1, reason: `Duplicate Jira key: ${jiraId}` });
      return;
    }
    if (normalizedJiraId) existingJiraIds.add(normalizedJiraId);
    const lastCommentedAt = String(item.lastCommentedAt || '').trim();
    if (lastCommentedAt && !isAcceptableCommentTimestamp(lastCommentedAt)) {
      skipped.push({ row: item.sourceRow || index + 1, reason: 'Invalid or future last-comment date' });
      return;
    }
    const story = {
      id: makeId('story'),
      deliveryProjectId: '',
      itemType: itemTypeOrUnknown(item.itemType),
      summary,
      description: String(item.description || '').trim(),
      acceptanceCriteria: Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria.map(value => String(value || '').trim()).filter(Boolean) : [],
      dependencies: String(item.dependencies || '').trim(),
      labels: Array.isArray(item.labels) ? item.labels.map(value => String(value || '').trim()).filter(Boolean) : [],
      environment: String(item.environment || '').trim(),
      notes: 'Imported from CSV',
      timelineId: '',
      createdAt: new Date().toISOString(),
      updates: [],
      tracked: false,
      jiraId,
      assignee: resolveProjectAssignee(projectData, item.assignee),
      owner: resolveProjectAssignee(projectData, item.assignee),
      sprint: String(item.sprint || '').trim(),
      contacted: false,
      commentAdded: !!lastCommentedAt,
      lastCommentedAt: lastCommentedAt || null,
      lastComment: String(item.lastComment || '').trim(),
      lastUpdate: String(item.lastComment || '').trim(),
      lastUpdateNotes: ''
    };
    projectData.stories.unshift(story);
    created.push(story);
  });
  writeData(data);
  res.json({ created: created.length, skipped, stories: created });
});

app.put('/api/project/assignee-directory', (req, res) => {
  const { project, entries, applyExisting } = req.body;
  if (!project || !Array.isArray(entries)) return res.status(400).json({ error: 'Missing project or assignee directory entries' });
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });

  const directory = Object.create(null);
  entries.forEach(entry => {
    const alias = normalizeText(entry && entry.alias);
    const name = String(entry && entry.name || '').trim();
    if (alias && name && !reservedProjectKeys.has(alias)) directory[alias] = name;
  });
  projectData.assigneeDirectory = directory;

  let updated = 0;
  if (applyExisting) {
    (projectData.stories || []).forEach(story => {
      const current = String(story.assignee || story.owner || '').trim();
      const resolved = resolveProjectAssignee(projectData, current);
      if (resolved && resolved !== current) {
        story.assignee = resolved;
        story.owner = resolved;
        updated += 1;
      }
    });
  }
  writeData(data);
  res.json({ directory, updated });
});

app.put('/api/project/status-mappings', (req, res) => {
  const { project, entries, applyExisting } = req.body;
  if (!project || !Array.isArray(entries)) return res.status(400).json({ error: 'Missing project or status mappings' });
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });

  const mappings = Object.create(null);
  entries.forEach(entry => {
    const jiraStatus = statusMappingKey(entry && entry.jiraStatus);
    const operatingStatus = String(entry && entry.operatingStatus || '').trim();
    if (jiraStatus && operatingStatuses.has(operatingStatus) && !reservedProjectKeys.has(jiraStatus)) mappings[jiraStatus] = operatingStatus;
  });
  projectData.statusMappings = mappings;

  let updated = 0;
  if (applyExisting) {
    (projectData.stories || []).forEach(story => {
      const labels = Array.isArray(story.labels) ? story.labels : [];
      const originalStatus = labels.map(label => String(label).match(/^original-status:(.+)$/i)?.[1]).find(Boolean);
      const operatingStatus = originalStatus && mappedOperatingStatus(projectData, originalStatus);
      if (!operatingStatus) return;
      const nextLabels = applyOperatingStatusLabel(labels, operatingStatus);
      if (nextLabels.join('|') !== labels.join('|')) {
        story.labels = nextLabels;
        updated += 1;
      }
    });
  }
  writeData(data);
  res.json({ mappings, updated });
});

app.post('/api/project/timeline', (req, res) => {
  const { project, title, date, status, notes } = req.body;
  if (!project || !title) {
    return res.status(400).json({ error: 'Missing project or title' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const entry = {
    id: makeId('timeline'),
    title,
    date: date || new Date().toISOString().slice(0, 10),
    status: status || 'Planned',
    notes: notes || ''
  };

  projectData.timeline.unshift(entry);
  writeData(data);
  res.json(entry);
});

app.put('/api/project/story/link', (req, res) => {
  const { project, storyId, timelineId } = req.body;
  if (!project || !storyId || !timelineId) {
    return res.status(400).json({ error: 'Missing project, storyId, or timelineId' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const story = projectData.stories.find(s => s.id === storyId);
  if (!story) {
    return res.status(404).json({ error: 'Story not found' });
  }

  const timelineItem = projectData.timeline.find(t => t.id === timelineId);
  if (!timelineItem) {
    return res.status(404).json({ error: 'Timeline item not found' });
  }

  story.timelineId = timelineId;
  writeData(data);
  res.json(story);
});

app.put('/api/project/story', (req, res) => {
  const { project, id, title, summary, description, acceptanceCriteria, dependencies, labels, environment, notes, timelineId,
    itemType, tracked, jiraId, owner, assignee, sprint, contacted, commentAdded, lastUpdate, lastComment, lastUpdateNotes, logComment, lastCommentedAt, deliveryProjectId } = req.body;
  if (!project || !id) {
    return res.status(400).json({ error: 'Missing project or story id' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const story = projectData.stories.find(s => s.id === id);
  if (!story) {
    return res.status(404).json({ error: 'Story not found' });
  }

  if (summary !== undefined) story.summary = summary;
  if (itemType !== undefined) {
    const resolvedItemType = normalizeItemType(itemType);
    if (!resolvedItemType) return res.status(400).json({ error: `Item type must be one of: ${ITEM_TYPES.join(', ')}` });
    story.itemType = resolvedItemType;
  }
  if (title !== undefined) story.summary = title; // the Manage tab edits via `title`
  if (description !== undefined) story.description = description;
  if (acceptanceCriteria !== undefined) {
    story.acceptanceCriteria = Array.isArray(acceptanceCriteria)
      ? acceptanceCriteria
      : String(acceptanceCriteria).split('\n').map(s => s.trim()).filter(Boolean);
  }
  if (dependencies !== undefined) story.dependencies = dependencies;
  if (Array.isArray(labels)) story.labels = labels;
  else if (typeof labels === 'string') story.labels = labels.split(',').map(s => s.trim()).filter(Boolean);
  if (environment !== undefined) story.environment = environment;
  if (notes !== undefined) story.notes = notes;
  if (timelineId !== undefined) story.timelineId = timelineId; // '' unlinks from timeline
  if (deliveryProjectId !== undefined) {
    if (deliveryProjectId && !findDeliveryProject(projectData, deliveryProjectId)) return res.status(400).json({ error: 'Delivery Project not found' });
    story.deliveryProjectId = deliveryProjectId;
  }

  // --- Tracking (follow-up) fields — the former Ticket fields, now on the unified item ---
  if (tracked !== undefined) story.tracked = !!tracked;
  if (jiraId !== undefined) story.jiraId = jiraId;
  if (assignee !== undefined) {
    story.assignee = assignee;
    story.owner = assignee;
  } else if (owner !== undefined) {
    story.owner = owner;
    if (story.assignee === undefined) story.assignee = owner;
  }
  if (sprint !== undefined) story.sprint = sprint;
  if (contacted !== undefined) story.contacted = !!contacted;
  if (commentAdded !== undefined) {
    story.commentAdded = !!commentAdded;
    if (commentAdded) story.lastCommentedAt = new Date().toISOString();
  }
  if (logComment) { // "✓ today" — (re)stamp the freshness clock; the recurring nudge reset
    story.lastCommentedAt = new Date().toISOString();
    story.commentAdded = true;
  }
  if (lastCommentedAt !== undefined) {
    if (lastCommentedAt && !isAcceptableCommentTimestamp(lastCommentedAt)) {
      return res.status(400).json({ error: 'Last-comment date must be valid and cannot be in the future' });
    }
    story.lastCommentedAt = lastCommentedAt || null;
  }
  if (lastComment !== undefined) {
    story.lastComment = lastComment;
    story.lastUpdate = lastComment;
  } else if (lastUpdate !== undefined) {
    story.lastUpdate = lastUpdate;
    if (story.lastComment === undefined) story.lastComment = lastUpdate;
  }
  if (lastUpdateNotes !== undefined) story.lastUpdateNotes = lastUpdateNotes;
  writeData(data);
  res.json(story);
});

app.put('/api/project/timeline', (req, res) => {
  const { project, id, title, date, status, notes } = req.body;
  if (!project || !id) {
    return res.status(400).json({ error: 'Missing project or timeline id' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const entry = projectData.timeline.find(t => t.id === id);
  if (!entry) {
    return res.status(404).json({ error: 'Timeline entry not found' });
  }

  if (title !== undefined) entry.title = title;
  if (date !== undefined) entry.date = date;
  if (status !== undefined) entry.status = status;
  if (notes !== undefined) entry.notes = notes;
  writeData(data);
  res.json(entry);
});

app.put('/api/project/transcript', (req, res) => {
  const { project, id, title, notes, date, type } = req.body;
  if (!project || !id) {
    return res.status(400).json({ error: 'Missing project or transcript id' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const transcript = projectData.transcripts.find(t => t.id === id);
  if (!transcript) {
    return res.status(404).json({ error: 'Transcript not found' });
  }
  if (transcript.sourceKind === 'external-ai-transcription') {
    return res.status(400).json({ error: 'External transcriptions are immutable; delete and re-import to preserve provenance' });
  }

  const validTypes = new Set(['DSU', 'Sprint Planning', 'Backlog Refinement', 'Story Snapshot', 'Developer Conversation', 'Other External Evidence', 'Meeting', '1:1', 'Interview', 'Call', 'Notes', 'Other']);
  if (type !== undefined && !validTypes.has(type)) return res.status(400).json({ error: 'Invalid source type' });
  const extractionInputsChanged = [title, notes, date, type].some(value => value !== undefined);
  if (title !== undefined) transcript.title = title;
  if (notes !== undefined) transcript.notes = notes;
  if (date !== undefined) transcript.date = date;
  if (type !== undefined) transcript.type = type;
  if (extractionInputsChanged) {
    projectData.stories.forEach(story => {
      story.updates = (story.updates || []).filter(update => update.transcriptId !== transcript.id);
      recomputeStoryLastUpdate(story);
    });
    delete transcript.extractedUpdates;
    transcript.extractedFindings = ['DSU', 'Sprint Planning', 'Backlog Refinement'].includes(transcript.type) && transcript.sourceKind !== 'reference'
      ? extractSourceFindings(projectData, transcript, readTranscriptTextForExtraction(transcript))
      : [];
  }
  writeData(data);
  res.json(transcript);
});

app.put('/api/project/transcript/finding', (req, res) => {
  const { project, transcriptId, findingId, reviewStatus, storyId, summary } = req.body;
  if (!project || !transcriptId || !findingId || !['pending', 'accepted', 'rejected'].includes(reviewStatus)) {
    return res.status(400).json({ error: 'Missing or invalid finding review details' });
  }
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });
  const transcript = (projectData.transcripts || []).find(item => item.id === transcriptId);
  const finding = transcript && (transcript.extractedFindings || []).find(item => item.id === findingId);
  if (!transcript || !finding) return res.status(404).json({ error: 'Finding not found' });

  // Undo a previously accepted DSU update before applying the new review decision.
  (projectData.stories || []).forEach(story => {
    story.updates = (story.updates || []).filter(update => update.findingId !== finding.id);
    recomputeStoryLastUpdate(story);
  });

  if (storyId !== undefined) {
    if (storyId && !(projectData.stories || []).some(story => story.id === storyId)) {
      return res.status(400).json({ error: 'Selected work item does not exist' });
    }
    finding.storyId = storyId || '';
    const story = (projectData.stories || []).find(item => item.id === storyId);
    finding.jiraId = story?.jiraId || '';
    finding.associationReason = story ? 'Manually linked during review' : 'Unlinked ceremony evidence';
  }
  if (summary !== undefined) finding.summary = String(summary || '').trim().slice(0, 500);
  finding.reviewStatus = reviewStatus;
  finding.reviewedAt = reviewStatus === 'pending' ? '' : new Date().toISOString();

  if (reviewStatus === 'accepted' && transcript.type === 'DSU' && finding.category === 'progress_update') {
    if (!finding.storyId) return res.status(400).json({ error: 'Accepting a DSU update requires a linked work item' });
    attachUpdatesToStories(projectData, transcript, [finding]);
  }
  writeData(data);
  res.json({ finding, transcript });
});

app.put('/api/project/transcript/findings', (req, res) => {
  const { project, decisions } = req.body || {};
  const reviewStatus = req.body?.reviewStatus === undefined ? 'accepted' : req.body.reviewStatus;
  if (typeof project !== 'string' || !project || !Array.isArray(decisions) || decisions.length < 1 || decisions.length > 100) {
    return res.status(400).json({ error: 'Select between 1 and 100 pending findings' });
  }
  if (!['accepted', 'rejected'].includes(reviewStatus)) {
    return res.status(400).json({ error: 'Batch review status must be accepted or rejected' });
  }
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) return res.status(404).json({ error: 'Project not found' });

  const prepared = [];
  const seen = new Set();
  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object' || typeof decision.transcriptId !== 'string' || !decision.transcriptId || typeof decision.findingId !== 'string' || !decision.findingId) {
      return res.status(400).json({ error: 'Every selected finding requires a transcript and finding id' });
    }
    const selectionKey = `${decision.transcriptId}\u0000${decision.findingId}`;
    if (seen.has(selectionKey)) return res.status(400).json({ error: 'A finding cannot be selected more than once' });
    seen.add(selectionKey);

    const transcript = (projectData.transcripts || []).find(item => item.id === decision.transcriptId);
    const finding = transcript && (transcript.extractedFindings || []).find(item => item.id === decision.findingId);
    if (!transcript || !finding) return res.status(404).json({ error: 'One or more selected findings no longer exist' });
    if ((finding.reviewStatus || 'pending') !== 'pending') {
      return res.status(409).json({ error: 'Only pending findings can be accepted in a batch' });
    }

    const nextStoryId = decision.storyId !== undefined ? String(decision.storyId || '') : String(finding.storyId || '');
    const story = nextStoryId ? (projectData.stories || []).find(item => item.id === nextStoryId) : null;
    if (nextStoryId && !story) return res.status(400).json({ error: 'A selected work item no longer exists' });
    if (reviewStatus === 'accepted' && transcript.type === 'DSU' && finding.category === 'progress_update' && !nextStoryId) {
      return res.status(400).json({ error: 'Every selected DSU progress update requires a linked work item' });
    }
    prepared.push({ decision, transcript, finding, story, nextStoryId });
  }

  const reviewedAt = new Date().toISOString();
  prepared.forEach(({ decision, transcript, finding, story, nextStoryId }) => {
    (projectData.stories || []).forEach(item => {
      item.updates = (item.updates || []).filter(update => update.findingId !== finding.id);
      recomputeStoryLastUpdate(item);
    });
    if (decision.storyId !== undefined) {
      finding.storyId = nextStoryId;
      finding.jiraId = story?.jiraId || '';
      finding.associationReason = story ? 'Manually linked during review' : 'Unlinked ceremony evidence';
    }
    if (decision.summary !== undefined) finding.summary = String(decision.summary || '').trim().slice(0, 500);
    finding.reviewStatus = reviewStatus;
    finding.reviewedAt = reviewedAt;
    if (reviewStatus === 'accepted' && transcript.type === 'DSU' && finding.category === 'progress_update') {
      attachUpdatesToStories(projectData, transcript, [finding]);
    }
  });

  writeData(data);
  res.json({
    reviewed: prepared.length,
    accepted: reviewStatus === 'accepted' ? prepared.length : 0,
    rejected: reviewStatus === 'rejected' ? prepared.length : 0,
    findings: prepared.map(item => item.finding)
  });
});

app.delete('/api/project/story', (req, res) => {
  const project = req.query.project;
  const id = req.query.id;
  if (!project || !id) {
    return res.status(400).json({ error: 'Missing project or story id' });
  }
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  projectData.stories = projectData.stories.filter(s => s.id !== id);
  writeData(data);
  res.json({ success: true });
});

app.delete('/api/project/timeline', (req, res) => {
  const project = req.query.project;
  const id = req.query.id;
  if (!project || !id) {
    return res.status(400).json({ error: 'Missing project or timeline id' });
  }
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  projectData.timeline = projectData.timeline.filter(t => t.id !== id);
  projectData.stories.forEach(s => {
    if (s.timelineId === id) s.timelineId = '';
  });
  writeData(data);
  res.json({ success: true });
});

app.delete('/api/project/transcript', (req, res) => {
  const project = req.query.project;
  const id = req.query.id;
  if (!project || !id) {
    return res.status(400).json({ error: 'Missing project or transcript id' });
  }
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const transcript = projectData.transcripts.find(t => t.id === id);
  projectData.transcripts = projectData.transcripts.filter(t => t.id !== id);
  if (transcript) {
    // Drop updates that were extracted from this transcript (no orphaned updates).
    projectData.stories.forEach(s => {
      if (Array.isArray(s.updates)) s.updates = s.updates.filter(u => u.transcriptId !== id);
      recomputeStoryLastUpdate(s);
    });
  }
  writeData(data);
  if (transcript) deleteTranscriptFile(transcript);
  res.json({ success: true });
});

app.delete('/api/project/story/update', (req, res) => {
  const { project, storyId, updateId } = req.query;
  if (!project || !storyId || !updateId) {
    return res.status(400).json({ error: 'Missing project, storyId, or updateId' });
  }
  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const story = projectData.stories.find(s => s.id === storyId);
  if (!story) {
    return res.status(404).json({ error: 'Story not found' });
  }
  story.updates = (story.updates || []).filter(u => u.id !== updateId);
  recomputeStoryLastUpdate(story);
  writeData(data);
  res.json({ success: true });
});

app.post('/api/project/transcript', runTranscriptUpload, wrapUpload(async (req, res) => {
  const project = req.body.project;
  const notes = req.body.notes || '';
  const date = req.body.date || '';

  if (!project) {
    return rejectUploadedRequest(req, res, 400, 'Missing project name');
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return rejectUploadedRequest(req, res, 404, 'Project not found');
  }

  const files = [...(req.files?.file || []), ...(req.files?.files || [])];
  if (files.length > 5) return rejectUploadedRequest(req, res, 400, 'Upload up to five files at a time');
  if (!files.length && !notes.trim()) return rejectUploadedRequest(req, res, 400, 'Choose at least one file or add meeting notes');
  if (files.reduce((total, file) => total + Number(file.size || 0), 0) > maxRequestBytes) {
    return rejectUploadedRequest(req, res, 413, 'Uploaded files must total 20 MB or smaller');
  }

  let metadata = [];
  try { metadata = JSON.parse(req.body.metadata || '[]'); }
  catch (_) { return rejectUploadedRequest(req, res, 400, 'Upload details could not be read'); }
  const validTypes = new Set(['DSU', 'Sprint Planning', 'Backlog Refinement', 'Story Snapshot', 'Developer Conversation', 'Other External Evidence', 'Meeting', '1:1', 'Interview', 'Call', 'Notes', 'Other']);
  const transcripts = [];
  const warnings = [];
  const total = Math.max(files.length, 1);
  for (let index = 0; index < total; index += 1) {
    const file = files[index];
    const details = metadata[index] || {};
    const requestedType = details.type || req.body.type || 'Notes';
    const type = validTypes.has(requestedType) ? requestedType : 'Notes';
    const fileExtension = file ? path.extname(file.originalname || '').toLowerCase() : '';
    const isTextFile = !file || textTranscriptExtensions.has(fileExtension);
    const transcript = {
      id: makeId('transcript'),
      title: String(details.title || (file && file.originalname) || req.body.title || 'Meeting note').trim(),
      file: file ? file.filename : '',
      originalName: file ? file.originalname : '',
      notes,
      date: date || '',
      type,
      sourceKind: isTextFile ? 'text' : 'reference',
      extractionNote: !isTextFile ? 'Reference only: this file type is saved but is not read for DSU extraction.' : '',
      uploadedAt: new Date().toISOString()
    };
    projectData.transcripts.unshift(transcript);

    let transcriptText = notes || '';
    if (file && isTextFile) {
      try {
        if (Number(file.size || 0) > maxExtractionBytes) {
          transcript.extractionNote = 'The file was saved, but it is too large for automatic text extraction.';
          warnings.push(`${file.originalname}: saved without extraction because it exceeds 2 MB`);
        } else {
          transcriptText += '\n' + fs.readFileSync(file.path, 'utf8');
        }
      }
      catch (error) {
        transcript.extractionNote = 'The file was saved, but its text could not be read for extraction.';
        warnings.push(`${file.originalname}: text could not be read`);
        console.warn('Unable to read transcript file for DSU extraction:', error.message);
      }
    }
    if (['DSU', 'Sprint Planning', 'Backlog Refinement'].includes(type) && isTextFile && Number((file && file.size) || 0) <= maxExtractionBytes) {
      // Extraction creates review candidates only. Accepted DSU findings are attached by the review route.
      transcript.extractedFindings = extractSourceFindings(projectData, transcript, transcriptText);
    } else if (['DSU', 'Sprint Planning', 'Backlog Refinement'].includes(type) && !isTextFile) {
      warnings.push(`${file.originalname}: saved as reference only; no text extraction was run`);
      transcript.extractedFindings = [];
    }
    transcripts.push(transcript);
  }

  writeData(data);
  res.json({ transcripts, warnings });
}));

// --- Teams update message generation (from selected unified items) ---

const defaultTeamsUpdatePrompt = `You are writing a short, friendly status update for a manager to read in Microsoft Teams. Use ONLY the information provided below — do not invent IDs, statuses, names, dates, or events that are not present, and do not add a "looking ahead", speculation, or next-steps section unless it is explicitly supported by the data. Tone: warm, concise, professional. Structure: begin with "Hi {{recipient}}," then a one-line intro that references {{subject}} if it is provided, then a short bulleted summary of the selected items (note each item's status; if an item has a Jira id, bold it using **markdown**), then a brief sign-off such as "Thanks!". Keep it scannable.\n\nRecipient: {{recipient}}\nSubject/board: {{subject}}\n\nSelected items:\n{{itemList}}`;

function generateTeamsTemplate(recipient, subject, items) {
  const lines = [];
  lines.push(`Hi ${recipient || 'there'},`);
  lines.push('');
  lines.push(subject ? `Quick update on ${subject}:` : 'Quick update:');
  lines.push('');
  items.forEach(s => {
    const bits = [];
    if (s.jiraId) bits.push(`**${s.jiraId}**`);
    bits.push(`[${itemTypeOrUnknown(s.itemType)}]`);
    bits.push(s.summary);
    bits.push(`— ${inferStoryStatus(s)}`);
    let line = bits.join(' ');
    const recent = Array.isArray(s.updates) && s.updates[0] ? (s.updates[0].update || s.updates[0].excerpt || '') : '';
    if (recent) line += `. ${recent}`;
    else if (storyLastCommentText(s)) line += `. ${storyLastCommentText(s)}`;
    lines.push(`* ${line}`);
  });
  lines.push('');
  lines.push('Thanks!');
  return lines.join('\n');
}

function validateTeamsAiDraft(message, items) {
  const allowedJiraIds = new Set(items.map(item => String(item.jiraId || '').toUpperCase()).filter(Boolean));
  const mentionedJiraIds = String(message || '').match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || [];
  const unsupported = [...new Set(mentionedJiraIds.map(id => id.toUpperCase()).filter(id => !allowedJiraIds.has(id)))];
  if (unsupported.length) {
    throw new Error(`AI draft referenced unselected Jira work item${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}`);
  }
  return message;
}

app.post('/api/project/teams-update', wrap(async (req, res) => {
  // storyIds are the selected item ids; ticketIds accepted for backward-compat and merged.
  const { project, recipient, subject, storyIds, ticketIds, mode = 'heuristic' } = req.body;
  if (!project) {
    return res.status(400).json({ error: 'Missing project name' });
  }
  if (!['heuristic', 'ai'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid Teams draft mode' });
  }

  const data = readData();
  const projectData = getProject(data, project);
  if (!projectData) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const want = [...(Array.isArray(storyIds) ? storyIds : []), ...(Array.isArray(ticketIds) ? ticketIds : [])];
  const items = (projectData.stories || []).filter(s => want.includes(s.id));
  if (!items.length) {
    return res.status(400).json({ error: 'Select at least one item' });
  }

  const itemList = items.map(s => {
    const recent = Array.isArray(s.updates) && s.updates[0] ? (s.updates[0].update || s.updates[0].excerpt || '') : '';
    const parts = [];
    if (s.jiraId) parts.push(`jira: ${s.jiraId}`);
    parts.push(`item type: ${itemTypeOrUnknown(s.itemType)}`);
    parts.push(`status: ${inferStoryStatus(s)}`);
    if (storyAssignee(s)) parts.push(`assignee: ${storyAssignee(s)}`);
    if (storySprint(s)) parts.push(`sprint: ${storySprint(s)}`);
    if (s.notes) parts.push(`notes: ${s.notes}`);
    if (recent) parts.push(`recent: ${recent}`);
    else if (storyLastCommentText(s)) parts.push(`last comment: ${storyLastCommentText(s)}`);
    return `- ${s.summary} | ${parts.join(' | ')}`;
  }).join('\n') || '(none)';

  let message = '';
  let source = 'heuristic';
  if (mode === 'heuristic') {
    message = generateTeamsTemplate(recipient, subject, items);
  } else {
    if (!getProvider()) {
      return res.status(400).json({ error: 'AI drafting is not configured. Add a provider key in web/.env and restart the app.' });
    }
    const prompt = renderPrompt(defaultTeamsUpdatePrompt, {
      recipient: recipient || 'there',
      subject: subject || '',
      itemList
    }) + '\n\nAdditional guardrails: use only selected Jira IDs. State each current Jira status. If an update sounds different from the status, write both without claiming the status changed.';
    message = validateTeamsAiDraft(await callLlm(prompt), items);
    source = 'ai-draft';
    if (!message || !message.trim()) throw new Error('Empty message from AI');
  }

  res.json({ message, source });
}));

// Return a clean JSON error instead of a stack trace / hung request — e.g. when
// pilot-data.json is corrupt. Must be registered after all routes.
app.use((err, req, res, next) => {
  console.error('Request error:', err && err.message);
  if (res.headersSent) return next(err);
  if (err && err.code === 'MULTIPART_REJECTED') cleanupUploadedFiles(req);
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
  if (err && [400, 413, 429].includes(err.statusCode)) return res.status(err.statusCode).json({ error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

// Bind to loopback only so the app is reachable from this machine, not the local network.
if (require.main === module) {
  const configuredPort = Number.parseInt(process.env.PORT || '3000', 10);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535 ? configuredPort : 3000;
  app.listen(port, '127.0.0.1', () => {
    console.log(`Priorena listening on http://127.0.0.1:${port}`);
  });
}

module.exports = {
  app,
  allowedTranscriptExtensions,
  getProject,
  isLoopbackHost,
  isSafeProjectKey,
  parseCsv,
  inferStoryStatus,
  isAcceptableCommentTimestamp
};
