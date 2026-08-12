'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function requireExplicitPath(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} requires an explicit path`);
  return path.resolve(value);
}

function canonicalizeThroughExistingAncestor(candidate) {
  const resolved = path.resolve(candidate);
  const missingSegments = [];
  let existing = resolved;
  while (true) {
    try {
      fs.lstatSync(existing);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      missingSegments.unshift(path.basename(existing));
      existing = parent;
    }
  }
  return path.join(fs.realpathSync.native(existing), ...missingSegments);
}

function assertOutsideRepository(candidate, repositoryRoot = process.cwd(), label = 'Operational artifact') {
  const resolved = requireExplicitPath(candidate, label);
  try {
    if (fs.lstatSync(resolved).isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }
  const canonicalRepository = fs.realpathSync.native(requireExplicitPath(repositoryRoot, 'Repository root'));
  const canonicalCandidate = canonicalizeThroughExistingAncestor(resolved);
  if (isInside(canonicalRepository, canonicalCandidate)) throw new Error(`${label} must remain outside the repository`);
  return canonicalCandidate;
}

function parseFlagPairs(argv, allowed, required = allowed) {
  const values = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || value === undefined || flag in values) throw new Error('Invalid or duplicate release command flag');
    values[flag] = value;
  }
  for (const flag of required) if (!values[flag]) throw new Error(`Missing required release command flag: ${flag}`);
  return values;
}

module.exports = {
  assertOutsideRepository,
  canonicalizeThroughExistingAncestor,
  isInside,
  parseFlagPairs,
  requireExplicitPath
};
