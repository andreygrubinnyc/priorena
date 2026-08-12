'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ACTIVE_PREFIXES = Object.freeze([
  'target-model/',
  'target-server/',
  'public/',
  'scripts/release/',
  'scripts/security/',
  'test/',
  'test-support/'
]);
const ACTIVE_ROOT_FILES = new Set(['package.json']);
const SCANNED_EXTENSIONS = new Set(['.js', '.json', '.html', '.css']);
const SELF = 'scripts/release/legacy-scan.js';

const RULES = Object.freeze([
  {
    label: 'combined Project/Epic terminology',
    pattern: /Project\s*\/\s*Jira Epic|Project\/Epic/i,
    allowedLines: { 'test/target-phase4-shell.test.js': [/^\s*'Project \/ Jira Epic', 'Project\/Epic', 'All projects', 'whole PM workspace', 'Project stream',$/] }
  },
  {
    label: 'catch-all Scope',
    pattern: /Miscellaneous\s*\/\s*No Epic/i,
    allowedLines: {
      'target-model/schema.js': [/^const FORBIDDEN_SCOPE_NAMES = new Set\(\['unassigned', 'miscellaneous \/ no epic', 'miscellaneous\/no epic', 'no epic'\]\);$/],
      'target-server/capture-services.js': [/^\s*if \(\['unassigned', 'miscellaneous \/ no epic', 'miscellaneous\/no epic', 'no epic'\]\.includes\(name\.trim\(\)\.toLowerCase\(\)\)\) throw invalidRequest\(\);$/],
      'test/target-model-schema.test.js': [
        /^\s*assert\.doesNotMatch\(JSON\.stringify\(seed\), \/Miscellaneous \\\/ No Epic\|No Epic\|catch-all\/i\);$/,
        /^\s*for \(const forbiddenName of \['Unassigned', 'Miscellaneous \/ No Epic', 'No Epic'\]\) \{$/
      ],
      'test/target-phase4-shell.test.js': [/^\s*'Briefing stream', 'Project not identified', 'Miscellaneous \/ No Epic', 'Evidence pending',$/]
    }
  },
  {
    label: 'legacy delivery-project collection',
    pattern: /\bdeliveryProjects\b/,
    allowedLines: { 'test/target-model-schema.test.js': [/^\s*assert\.equal\('deliveryProjects' in seed, false\);$/] }
  },
  {
    label: 'legacy delivery-project relationship',
    pattern: /\bdeliveryProjectId\b/,
    allowedLines: {
      'test/target-model-schema.test.js': [
        /^\s*legacyRelationship\.workItems\[0\]\.deliveryProjectId = 'legacy-project';$/,
        /^\s*assertInvalid\(legacyRelationship, \/unsupported field "deliveryProjectId"\/\);$/
      ]
    }
  },
  {
    label: 'legacy root collection',
    pattern: /(?:["']projects["']|\bprojects)\s*:/i,
    allowedLines: {
      'scripts/release/rehearse.js': [/^\s*const legacyBytes = Buffer\.from\('\{"projects": \{\}\}\\n'\);$/],
      'test/target-phase5-hardening.test.js': [/^\s*Buffer\.from\('\{"projects":\{\}\}'\),$/]
    }
  },
  { label: 'mutable legacy lookup', pattern: /\bgetProject\s*\(/ },
  { label: 'legacy projects map', pattern: /\bprojects\s+map\b/i },
  { label: 'legacy DSU-only copy', pattern: /Extracted DSU updates/i, allowedLines: { 'test/target-phase4-shell.test.js': [/^\s*'Extracted DSU updates', 'Teams Draft', 'Status Summary'$/] } },
  { label: 'legacy status communication', pattern: /Legacy Status Summary|Legacy Teams Draft/i },
  { label: 'legacy Briefing ownership', pattern: /\bbriefing stream\b/i, allowedLines: { 'test/target-phase4-shell.test.js': [/^\s*'Briefing stream', 'Project not identified', 'Miscellaneous \/ No Epic', 'Evidence pending',$/] } },
  { label: 'legacy Workspace wording', pattern: /\bthis project\b|\bwhole PM workspace\b/i, allowedLines: { 'test/target-phase4-shell.test.js': [/^\s*'Project \/ Jira Epic', 'Project\/Epic', 'All projects', 'whole PM workspace', 'Project stream',$/] } },
  {
    label: 'direct legacy runtime selection',
    pattern: /\bPMDS_DATA_FILE\b|\bPMDS_UPLOADS_DIR\b|\bpilot-data\.json\b/,
    allowedLines: {
      'scripts/security/repository-scan.js': [/^\s*'pilot-data\.json',$/],
      'test/target-model-persistence.test.js': [/^\s*assert\.doesNotMatch\(source, \/PMDS_DATA_FILE\|pilot-data\\\.json\|\\\.priorena-data\|server\\\.js\/\);$/],
      'test/target-server-api.test.js': [/^\s*assert\.doesNotMatch\(source, \/PMDS_DATA_FILE\|PMDS_UPLOADS_DIR\|\\\.priorena-data\|pilot-data\\\.json\/\);$/]
    }
  },
  { label: 'native blocking popup', pattern: /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/ },
  { label: 'automatic external action', pattern: /\b(?:sendBriefing|sendMessage|autoPublish|writeToJira|updateJiraIssue)\s*\(/i }
]);

function activeFile(file) {
  if (file === SELF) return false;
  if (ACTIVE_ROOT_FILES.has(file)) return true;
  return ACTIVE_PREFIXES.some(prefix => file.startsWith(prefix)) && SCANNED_EXTENSIONS.has(path.extname(file));
}

function scanText(file, text) {
  const findings = [];
  for (const rule of RULES) {
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
    const pattern = new RegExp(rule.pattern.source, flags);
    for (const match of text.matchAll(pattern)) {
      const lineStart = text.lastIndexOf('\n', match.index - 1) + 1;
      const lineEnd = text.indexOf('\n', match.index);
      const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      const allowed = rule.allowedLines?.[file]?.some(exception => exception.test(lineText));
      if (allowed) continue;
      const line = text.slice(0, match.index).split('\n').length;
      findings.push(`${rule.label}: ${file}:${line}`);
    }
  }
  return findings;
}

function repositoryFiles(repositoryRoot = process.cwd()) {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  return output.split('\0').filter(Boolean).filter(activeFile).filter(file => fs.existsSync(path.join(repositoryRoot, file)));
}

function run(repositoryRoot = process.cwd()) {
  const findings = [];
  const files = repositoryFiles(repositoryRoot);
  for (const file of files) findings.push(...scanText(file, fs.readFileSync(path.join(repositoryRoot, file), 'utf8')));
  if (findings.length) {
    const error = new Error(`Legacy regression scan failed:\n${findings.map(item => `- ${item}`).join('\n')}`);
    error.findings = findings;
    throw error;
  }
  process.stdout.write(`Legacy regression scan passed (${files.length} active files).\n`);
  return files;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ACTIVE_PREFIXES,
  RULES,
  activeFile,
  repositoryFiles,
  run,
  scanText
};
