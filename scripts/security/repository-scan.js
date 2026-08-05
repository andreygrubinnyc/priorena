'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_BINARY_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.woff2']);
const FORBIDDEN_BASENAMES = new Set([
  '.env',
  'pilot-data.json',
  'cookies.txt',
  'credentials.json',
  'id_rsa',
  'id_ed25519'
]);
const FORBIDDEN_PATH_SEGMENTS = new Set(['uploads', 'backups', '.priorena-data']);
const FORBIDDEN_EXTENSIONS = new Set([
  '.7z', '.bak', '.db', '.dump', '.key', '.p12', '.pem', '.pfx', '.sqlite', '.sqlite3', '.tar', '.tgz', '.zip'
]);

const SECRET_PATTERNS = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['provider credential assignment', /\b(?:OPENAI|ANTHROPIC|CLAUDE|GITHUB|AWS)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[ \t]*=[ \t]*[^\s#][^\r\n]*/i],
  ['credential-like literal', /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)[ \t]*[:=][ \t]*['"][^'"\r\n]{16,}['"]/i]
];

const PRIVATE_MARKER_PATTERNS = [
  ['macOS user path', /\/Users\/[A-Za-z0-9._-]+\//],
  ['Linux user path', /\/home\/[A-Za-z0-9._-]+\//],
  ['Windows user path', /[A-Za-z]:\\Users\\[^\\\r\n]+\\/],
  ['operational program marker', new RegExp('FE' + 'RC' + '760', 'i')],
  ['operational ticket identifier', /\bDELI-\d+\b/i],
  ['non-English Cyrillic text', /[\u0400-\u04ff]/]
];

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: options.cwd || process.cwd(),
    encoding: options.encoding === undefined ? 'utf8' : options.encoding,
    maxBuffer: 20 * 1024 * 1024,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe']
  });
}

function splitNull(value) {
  return String(value || '').split('\0').filter(Boolean);
}

function stagedFiles() {
  return splitNull(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']));
}

function headFiles() {
  return splitNull(git(['ls-tree', '-r', '--name-only', '-z', 'HEAD']));
}

function stagedContent(file) {
  return git(['show', `:${file}`], { encoding: null });
}

function headContent(file) {
  return git(['show', `HEAD:${file}`], { encoding: null });
}

function scanPath(file) {
  const normalized = file.replaceAll('\\', '/');
  const parts = normalized.split('/');
  const basename = parts.at(-1).toLowerCase();
  const extension = path.extname(basename).toLowerCase();
  const findings = [];

  if (FORBIDDEN_BASENAMES.has(basename) && basename !== '.env.example') {
    findings.push(`forbidden private filename: ${file}`);
  }
  if (parts.some(part => FORBIDDEN_PATH_SEGMENTS.has(part.toLowerCase()))) {
    findings.push(`forbidden private directory: ${file}`);
  }
  if (FORBIDDEN_EXTENSIONS.has(extension)) {
    findings.push(`forbidden archive, database, backup, or key file: ${file}`);
  }
  return findings;
}

function isBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function scanText(file, text) {
  const findings = [];
  for (const [label, pattern] of [...SECRET_PATTERNS, ...PRIVATE_MARKER_PATTERNS]) {
    const match = pattern.exec(text);
    if (match) findings.push(`${label}: ${file}:${lineNumberAt(text, match.index)}`);
  }
  if (/^(?:<{7}|={7}|>{7})(?![=<>])/m.test(text)) {
    findings.push(`merge-conflict marker: ${file}`);
  }
  return findings;
}

function scanBuffer(file, buffer) {
  const findings = scanPath(file);
  if (buffer.length > MAX_FILE_BYTES) findings.push(`file exceeds 2 MiB review limit: ${file}`);

  if (isBinary(buffer)) {
    const extension = path.extname(file).toLowerCase();
    if (!ALLOWED_BINARY_EXTENSIONS.has(extension)) findings.push(`unapproved binary file: ${file}`);
    return findings;
  }

  return findings.concat(scanText(file, buffer.toString('utf8')));
}

function run(mode) {
  git(['rev-parse', '--show-toplevel']);
  const staged = mode === '--staged';
  if (!staged && mode !== '--head') throw new Error('Usage: repository-scan.js --staged|--head');

  if (staged) git(['diff', '--cached', '--check'], { stdio: 'inherit' });
  const files = staged ? stagedFiles() : headFiles();
  if (staged && files.length === 0) {
    console.log('Secure staged-file scan: no added or modified files.');
    return;
  }

  const findings = [];
  for (const file of files) {
    let buffer;
    try {
      buffer = staged ? stagedContent(file) : headContent(file);
    } catch (error) {
      findings.push(`unable to inspect ${file}: ${error.message}`);
      continue;
    }
    findings.push(...scanBuffer(file, buffer));
  }

  if (findings.length) {
    console.error('Secure repository scan failed:');
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Secure ${staged ? 'staged-file' : 'committed-tree'} scan passed (${files.length} files).`);
}

if (require.main === module) {
  try {
    run(process.argv[2]);
  } catch (error) {
    console.error(`Secure repository scan could not complete: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { isBinary, scanBuffer, scanPath, scanText };
