'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough, Readable } = require('node:stream');

const { createTargetApiApp } = require('../target-server/app');
const { EXPECT_TARGET_ABSENT, readTargetDataWithRevision, writeTargetData } = require('../target-model/persistence');
const { validateTargetData } = require('../target-model/schema');
const { createMultiOrganizationFixture } = require('./target-v5-fixtures');

const ALPHA = Object.freeze({ organizationId: 'org-fixture-alpha', workspaceId: 'workspace-alpha-shared' });
const BETA = Object.freeze({ organizationId: 'org-fixture-beta', workspaceId: 'workspace-beta-shared' });

function requestApp(app, { method = 'GET', url = '/', headers = {}, body = Buffer.alloc(0) } = {}) {
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
      const bytes = Buffer.concat(chunks);
      res.emit('finish');
      resolve({
        status: res.statusCode,
        headers: responseHeaders,
        bytes,
        body: bytes.toString('utf8'),
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

function prepareWritableFixture(factory = createMultiOrganizationFixture) {
  const document = factory();
  const communicated = document.briefingVersions.find(version => version.status === 'communicated');
  communicated.status = 'finalized';
  communicated.communicatedAt = null;
  document.briefings.find(briefing => briefing.id === communicated.briefingId).lastCommunicatedVersionId = null;
  return document;
}

async function createTargetApiHarness(t, mutate = () => {}, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'priorena-phase3-api-'));
  const sourceFilesRoot = path.join(root, 'source-files');
  const targetDataFile = path.join(root, 'target-v5.json');
  await fs.mkdir(sourceFilesRoot, { mode: 0o700 });
  const document = prepareWritableFixture(options.fixtureFactory || createMultiOrganizationFixture);
  await mutate({ document, root, sourceFilesRoot, targetDataFile });
  validateTargetData(document);
  await writeTargetData(targetDataFile, document, { expectedRevision: EXPECT_TARGET_ABSENT });
  const { fixtureFactory, ...appOptions } = options;
  const { app, services } = createTargetApiApp({ targetDataFile, sourceFilesRoot, ...appOptions });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { app, document, root, services, sourceFilesRoot, targetDataFile };
}

async function jsonRequest(app, method, url, value) {
  const body = JSON.stringify(value);
  return requestApp(app, {
    method,
    url,
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      origin: 'http://127.0.0.1:3000',
      'sec-fetch-site': 'same-origin'
    },
    body
  });
}

async function persisted(targetDataFile) {
  return readTargetDataWithRevision(targetDataFile);
}

function workspaceBase(context) {
  return `/api/v2/organizations/${context.organizationId}/workspaces/${context.workspaceId}`;
}

module.exports = {
  ALPHA,
  BETA,
  createTargetApiHarness,
  jsonRequest,
  persisted,
  prepareWritableFixture,
  requestApp,
  workspaceBase
};
