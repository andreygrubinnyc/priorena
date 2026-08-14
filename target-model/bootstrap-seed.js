'use strict';

const { createCleanSeed } = require('./clean-seed');
const { validateTargetData } = require('./schema');

const BOOTSTRAP_TIMESTAMP = '2026-08-11T00:00:00.000Z';
const MAX_BOOTSTRAP_INITIATIVES = 100;
const GENERIC_BOOTSTRAP_NAMES = Object.freeze({
  organization: 'Organization 1',
  workspace: 'Workspace 1',
  initiatives: Object.freeze(['Initiative 1', 'Initiative 2', 'Initiative 3', 'Initiative 4'])
});

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter(key => !allowed.has(key));
  if (unexpected.length) throw new TypeError(`${label} contains unsupported fields`);
}

function boundedText(value, label, { optional = false, maximum = 300 } = {}) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} must be bounded, trimmed text`);
  }
  return value;
}

function normalizeBootstrapDefinition(input) {
  const root = plainObject(input, 'Bootstrap input');
  exactKeys(root, new Set(['organization', 'workspace', 'initiatives']), 'Bootstrap input');
  const organization = plainObject(root.organization, 'Organization');
  const workspace = plainObject(root.workspace, 'Workspace');
  exactKeys(organization, new Set(['name', 'description']), 'Organization');
  exactKeys(workspace, new Set(['name', 'description']), 'Workspace');
  if (!Array.isArray(root.initiatives) || root.initiatives.length > MAX_BOOTSTRAP_INITIATIVES) {
    throw new TypeError(`Initiatives must be an array with at most ${MAX_BOOTSTRAP_INITIATIVES} entries`);
  }
  const initiatives = root.initiatives.map((value, index) => {
    const initiative = plainObject(value, `Initiative ${index + 1}`);
    exactKeys(initiative, new Set(['name', 'description', 'owner']), `Initiative ${index + 1}`);
    return {
      name: boundedText(initiative.name, `Initiative ${index + 1} name`),
      description: boundedText(initiative.description, `Initiative ${index + 1} description`, { optional: true, maximum: 2_000 }),
      owner: initiative.owner === undefined || initiative.owner === null
        ? null
        : boundedText(initiative.owner, `Initiative ${index + 1} owner`)
    };
  });
  const names = initiatives.map(initiative => initiative.name.toLocaleLowerCase('en-US'));
  if (new Set(names).size !== names.length) throw new TypeError('Initiative names must be unique within the bootstrap Workspace');
  return {
    organization: {
      name: boundedText(organization.name, 'Organization name'),
      description: boundedText(organization.description, 'Organization description', { optional: true, maximum: 2_000 })
    },
    workspace: {
      name: boundedText(workspace.name, 'Workspace name'),
      description: boundedText(workspace.description, 'Workspace description', { optional: true, maximum: 2_000 })
    },
    initiatives
  };
}

function createBootstrapSeed(input) {
  const normalized = normalizeBootstrapDefinition(input);
  const names = normalized.initiatives.map(initiative => initiative.name);
  if (normalized.organization.name !== GENERIC_BOOTSTRAP_NAMES.organization ||
      normalized.workspace.name !== GENERIC_BOOTSTRAP_NAMES.workspace ||
      JSON.stringify(names) !== JSON.stringify(GENERIC_BOOTSTRAP_NAMES.initiatives)) {
    throw new TypeError('Bootstrap input must describe the exact authorized generic Organization, Workspace, and four Initiatives');
  }
  if (normalized.initiatives.some(initiative => initiative.owner !== null)) {
    throw new TypeError('The authorized generic bootstrap Initiatives must not have owners');
  }
  const document = createCleanSeed();
  validateTargetData(document);
  return document;
}

module.exports = {
  BOOTSTRAP_TIMESTAMP,
  GENERIC_BOOTSTRAP_NAMES,
  MAX_BOOTSTRAP_INITIATIVES,
  createBootstrapSeed,
  normalizeBootstrapDefinition
};
