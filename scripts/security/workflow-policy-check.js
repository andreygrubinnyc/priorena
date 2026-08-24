'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const MAX_POLICY_FILE_BYTES = 512 * 1024;

function marker(label, value) {
  return Object.freeze({ label, value });
}

const FOUNDATION_FILES = Object.freeze([
  Object.freeze({
    path: 'AGENTS.md',
    markers: Object.freeze([
      marker('workflow lifecycle', 'docs/development/CODEX_WORKFLOW.md'),
      marker('phase and authority boundary', 'current lifecycle phase and exact authority boundary'),
      marker('direct evidence', 'direct task and pull-request evidence'),
      marker('separate merge and release authority', 'Merge and live release require separate explicit authority.'),
      marker('scope mismatch stop rule', 'STOP on scope or authority mismatch'),
      marker('handoff phase result', 'PHASE_RESULT:'),
      marker('handoff next authority', 'NEXT_AUTHORITY:')
    ])
  }),
  Object.freeze({
    path: '.github/pull_request_template.md',
    markers: Object.freeze([
      marker('authority and scope section', '## Authority and scope'),
      marker('effects and trust boundaries section', '## Effects and trust boundaries'),
      marker('commit gate', '`npm run verify:commit`'),
      marker('registry audit', '`npm audit --audit-level=moderate`'),
      marker('push gate', '`npm run verify:push`'),
      marker('separate merge authority', 'Merge requires separate explicit authority.'),
      marker('separate release authority', 'Live release requires separate explicit authority.'),
      marker('handoff phase result', 'PHASE_RESULT:'),
      marker('handoff next authority', 'NEXT_AUTHORITY:')
    ])
  }),
  Object.freeze({
    path: 'docs/development/CODEX_WORKFLOW.md',
    markers: Object.freeze([
      marker('roles section', '## Roles'),
      marker('lifecycle states section', '## Lifecycle states'),
      marker('draft PR state', '`DRAFT_PR`'),
      marker('merge authority state', '`MERGE_AUTH_REQUIRED`'),
      marker('release authority state', '`RELEASE_AUTH_REQUIRED`'),
      marker('blocked state', '`BLOCKED`'),
      marker('draft PR boundary', 'A draft pull request is a source handoff point, not merge authority.'),
      marker('direct coordination', 'The coordinator reads implementation-task and GitHub evidence directly.'),
      marker('no report relay', 'The product owner does not copy full reports between tasks.'),
      marker('separate merge and release authority', 'Merge and live release require separate explicit authority.'),
      marker('handoff phase result', 'PHASE_RESULT:'),
      marker('handoff next authority', 'NEXT_AUTHORITY:')
    ])
  }),
  Object.freeze({
    path: 'docs/development/AUTHORITY_TEMPLATE.md',
    markers: Object.freeze([
      marker('authority status section', '## Authority status'),
      marker('fixed identity section', '## Fixed identity'),
      marker('path scope section', '## Path scope'),
      marker('preconditions section', '## Exact read-only preconditions'),
      marker('verification gates section', '## Tests and verification gates'),
      marker('universal stop rules section', '## Universal stop rules'),
      marker('prohibited operations section', '## Prohibited operations'),
      marker('separate protected boundaries section', '## Separate protected boundaries'),
      marker('merge authority placeholder', 'Merge authority: `<not-granted-or-exact-separate-authority>`'),
      marker('release authority placeholder', 'Release authority: `<not-granted-or-exact-source-only-authority>`'),
      marker('live-data authority placeholder', 'Live-data authority: `<not-granted-or-exact-mutation-restoration-migration-authority>`'),
      marker('handoff phase result', 'PHASE_RESULT:'),
      marker('handoff next authority', 'NEXT_AUTHORITY:')
    ])
  })
]);

function unavailableFinding(specification) {
  return {
    path: specification.path,
    message: 'required readable regular non-symlink file is unavailable'
  };
}

function readExpectedFile(repositoryRoot, specification) {
  const parts = specification.path.split('/');
  let currentPath = repositoryRoot;

  try {
    const rootStats = fs.lstatSync(currentPath);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) return { finding: unavailableFinding(specification) };

    for (const part of parts.slice(0, -1)) {
      currentPath = path.join(currentPath, part);
      const directoryStats = fs.lstatSync(currentPath);
      if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
        return { finding: unavailableFinding(specification) };
      }
    }

    currentPath = path.join(currentPath, parts.at(-1));
    const pathStats = fs.lstatSync(currentPath);
    if (!pathStats.isFile() || pathStats.isSymbolicLink()) return { finding: unavailableFinding(specification) };

    const descriptor = fs.openSync(currentPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const descriptorStats = fs.fstatSync(descriptor);
      if (!descriptorStats.isFile()) return { finding: unavailableFinding(specification) };
      if (descriptorStats.size > MAX_POLICY_FILE_BYTES) {
        return { finding: { path: specification.path, message: 'required file exceeds the policy review limit' } };
      }
      return { content: fs.readFileSync(descriptor, 'utf8') };
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return { finding: unavailableFinding(specification) };
  }
}

function checkWorkflowPolicy(repositoryRoot = REPOSITORY_ROOT) {
  const resolvedRoot = path.resolve(repositoryRoot);
  const findings = [];

  for (const specification of FOUNDATION_FILES) {
    const result = readExpectedFile(resolvedRoot, specification);
    if (result.finding) {
      findings.push(result.finding);
      continue;
    }

    for (const requiredMarker of specification.markers) {
      if (!result.content.includes(requiredMarker.value)) {
        findings.push({
          path: specification.path,
          message: `missing required marker "${requiredMarker.label}"`
        });
      }
    }
  }

  return Object.freeze({
    ok: findings.length === 0,
    checkedFiles: FOUNDATION_FILES.length,
    findings: Object.freeze(findings)
  });
}

function formatResult(result) {
  if (result.ok) return `Workflow policy check passed (${result.checkedFiles} files).`;
  return ['Workflow policy check failed:', ...result.findings.map(finding => `- ${finding.path}: ${finding.message}`)].join('\n');
}

function run() {
  const result = checkWorkflowPolicy(REPOSITORY_ROOT);
  const output = formatResult(result);
  if (result.ok) console.log(output);
  else {
    console.error(output);
    process.exitCode = 1;
  }
  return result;
}

if (require.main === module) run();

module.exports = {
  FOUNDATION_FILES,
  REPOSITORY_ROOT,
  checkWorkflowPolicy,
  formatResult,
  run
};
