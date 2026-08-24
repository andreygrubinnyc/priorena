'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULE_PATH = path.resolve(__dirname, '../scripts/security/workflow-policy-check.js');

function loadChecker() {
  return require(MODULE_PATH);
}

function createTemporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'priorena-workflow-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createFoundationFixture(t) {
  const root = createTemporaryRoot(t);
  const { FOUNDATION_FILES } = loadChecker();
  for (const specification of FOUNDATION_FILES) {
    const destination = path.join(root, specification.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const content = [
      '# Fictional workflow policy fixture',
      ...specification.markers.map(requiredMarker => requiredMarker.value)
    ].join('\n');
    fs.writeFileSync(destination, `${content}\n`, 'utf8');
  }
  return root;
}

function specificationFor(relativePath) {
  const specification = loadChecker().FOUNDATION_FILES.find(candidate => candidate.path === relativePath);
  assert.ok(specification, `Missing test specification for ${relativePath}`);
  return specification;
}

function markerFor(specification, label) {
  const requiredMarker = specification.markers.find(candidate => candidate.label === label);
  assert.ok(requiredMarker, `Missing test marker ${label}`);
  return requiredMarker;
}

test('importing the checker does not execute it or write files', t => {
  const temporaryRoot = createTemporaryRoot(t);
  const previousDirectory = process.cwd();
  const previousExitCode = process.exitCode;
  const output = [];
  const originalLog = console.log;
  const originalError = console.error;
  let imported;
  let observedExitCode;

  delete require.cache[require.resolve(MODULE_PATH)];
  try {
    process.chdir(temporaryRoot);
    console.log = (...values) => output.push(values.join(' '));
    console.error = (...values) => output.push(values.join(' '));
    imported = require(MODULE_PATH);
    observedExitCode = process.exitCode;
  } finally {
    process.chdir(previousDirectory);
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = previousExitCode;
  }

  assert.equal(typeof imported.checkWorkflowPolicy, 'function');
  assert.equal(observedExitCode, previousExitCode);
  assert.deepEqual(output, []);
  assert.deepEqual(fs.readdirSync(temporaryRoot), []);
});

test('the real repository workflow foundation passes', () => {
  const result = loadChecker().checkWorkflowPolicy();
  assert.equal(result.ok, true, loadChecker().formatResult(result));
  assert.equal(result.checkedFiles, 4);
  assert.deepEqual(result.findings, []);
});

test('a missing required file fails closed', t => {
  const root = createFoundationFixture(t);
  fs.rmSync(path.join(root, 'AGENTS.md'));
  const result = loadChecker().checkWorkflowPolicy(root);
  assert.equal(result.ok, false);
  assert.match(loadChecker().formatResult(result), /AGENTS\.md: required readable regular non-symlink file is unavailable/);
});

test('a directory in place of a required file fails closed', t => {
  const root = createFoundationFixture(t);
  const target = path.join(root, 'AGENTS.md');
  fs.rmSync(target);
  fs.mkdirSync(target);
  const result = loadChecker().checkWorkflowPolicy(root);
  assert.equal(result.ok, false);
  assert.match(loadChecker().formatResult(result), /AGENTS\.md: required readable regular non-symlink file is unavailable/);
});

test('a symlink in place of a required file fails closed', t => {
  const root = createFoundationFixture(t);
  const target = path.join(root, 'AGENTS.md');
  fs.rmSync(target);
  fs.writeFileSync(path.join(root, 'fictional-target.md'), '# Fictional target\n', 'utf8');
  fs.symlinkSync('fictional-target.md', target);
  const result = loadChecker().checkWorkflowPolicy(root);
  assert.equal(result.ok, false);
  assert.match(loadChecker().formatResult(result), /AGENTS\.md: required readable regular non-symlink file is unavailable/);
});

test('a missing required marker fails closed', t => {
  const root = createFoundationFixture(t);
  const specification = specificationFor('AGENTS.md');
  const requiredMarker = markerFor(specification, 'workflow lifecycle');
  const target = path.join(root, specification.path);
  const content = fs.readFileSync(target, 'utf8').replace(requiredMarker.value, 'fictional workflow reference');
  fs.writeFileSync(target, content, 'utf8');
  const result = loadChecker().checkWorkflowPolicy(root);
  assert.equal(result.ok, false);
  assert.match(loadChecker().formatResult(result), /AGENTS\.md: missing required marker "workflow lifecycle"/);
});

test('the direct-coordination marker is required', t => {
  const root = createFoundationFixture(t);
  const specification = specificationFor('docs/development/CODEX_WORKFLOW.md');
  const requiredMarker = markerFor(specification, 'direct coordination');
  const target = path.join(root, specification.path);
  const content = fs.readFileSync(target, 'utf8').replace(requiredMarker.value, 'The coordinator reviews fictional summaries.');
  fs.writeFileSync(target, content, 'utf8');
  const result = loadChecker().checkWorkflowPolicy(root);
  assert.equal(result.ok, false);
  assert.match(loadChecker().formatResult(result), /CODEX_WORKFLOW\.md: missing required marker "direct coordination"/);
});

test('the separate merge and release authority marker is required', t => {
  const root = createFoundationFixture(t);
  const specification = specificationFor('docs/development/CODEX_WORKFLOW.md');
  const requiredMarker = markerFor(specification, 'separate merge and release authority');
  const target = path.join(root, specification.path);
  const content = fs.readFileSync(target, 'utf8').replace(requiredMarker.value, 'A fictional later phase follows review.');
  fs.writeFileSync(target, content, 'utf8');
  const result = loadChecker().checkWorkflowPolicy(root);
  assert.equal(result.ok, false);
  assert.match(loadChecker().formatResult(result), /CODEX_WORKFLOW\.md: missing required marker "separate merge and release authority"/);
});

test('failure output does not disclose arbitrary file content', t => {
  const root = createFoundationFixture(t);
  const specification = specificationFor('docs/development/CODEX_WORKFLOW.md');
  const requiredMarker = markerFor(specification, 'direct coordination');
  const target = path.join(root, specification.path);
  const arbitraryContent = 'FICTIONAL-SENSITIVE-CONTENT-MUST-STAY-HIDDEN';
  const content = fs.readFileSync(target, 'utf8')
    .replace(requiredMarker.value, 'The coordinator reviews fictional summaries.')
    .concat(`${arbitraryContent}\n`);
  fs.writeFileSync(target, content, 'utf8');
  const result = loadChecker().checkWorkflowPolicy(root);
  const output = loadChecker().formatResult(result);
  assert.equal(result.ok, false);
  assert.doesNotMatch(output, new RegExp(arbitraryContent));
  assert.doesNotMatch(output, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
