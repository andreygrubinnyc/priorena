'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { validateTargetData } = require('../target-model/schema');
const { buildCandidateFacts } = require('../target-server/briefing-services');
const { createPhase4BriefingFixture } = require('../test-support/target-v2-fixtures');

test('Phase 4 fixture is deterministic, valid, fictional, and covers every Briefing lifecycle placement', () => {
  const first = createPhase4BriefingFixture();
  const second = createPhase4BriefingFixture();
  assert.deepEqual(first, second);
  assert.equal(validateTargetData(first), first);
  const alphaVersions = first.briefingVersions.filter(version => version.organizationId === 'org-fixture-alpha');
  assert.deepEqual(new Set(alphaVersions.map(version => version.status)), new Set(['draft', 'finalized', 'communicated']));
  assert.ok(alphaVersions.some(version => version.facts.some(fact => fact.title === 'Manual PM input')));
  assert.ok(alphaVersions.filter(version => version.status !== 'draft').every(version => version.outputs.length > 0));
  assert.ok(alphaVersions.filter(version => version.status !== 'draft').every(version => (
    version.outputs.every(output => output.text.includes('<img src=x onerror=fictional()>'))
  )));
  assert.ok(alphaVersions.find(version => version.status === 'communicated').communication);
  const selections = first.briefings.filter(item => item.organizationId === 'org-fixture-alpha').map(item => ({
    workspaces: item.workspaceIds.length,
    scopes: item.scopeIds.length
  }));
  assert.ok(selections.some(item => item.workspaces === 1 && item.scopes === 0));
  assert.ok(selections.some(item => item.workspaces === 1 && item.scopes === 1));
  assert.ok(selections.some(item => item.workspaces === 1 && item.scopes > 1));
  assert.ok(selections.some(item => item.workspaces > 1));
  assert.equal(first.organizations[0].name, first.organizations[1].name);
  assert.match(JSON.stringify(first), /Fictional/);
  assert.match(JSON.stringify(first), /<img src=x onerror=fictional\(\)>/);
});

test('Phase 4 candidate fixture keeps unreviewed prompt-like Source text inert and outside Briefing facts', () => {
  const document = createPhase4BriefingFixture();
  const briefing = document.briefings.find(item => item.id === 'briefing-alpha');
  const candidates = buildCandidateFacts(document, {
    organizationId: briefing.organizationId,
    workspaceIds: briefing.workspaceIds,
    scopeIds: briefing.scopeIds,
    defaultSections: briefing.defaultSections
  });
  const serialized = JSON.stringify(candidates);
  assert.doesNotMatch(serialized, /IGNORE PRIOR INSTRUCTIONS/);
  assert.doesNotMatch(serialized, /obsolete statement/i);
  assert.doesNotMatch(serialized, /BETA (?:SENTINEL|PROMPT|GUIDANCE|BRIEFING|MILESTONE)/i);
  assert.ok(candidates.some(candidate => candidate.provenance.type === 'accepted-evidence'));
  assert.ok(candidates.some(candidate => candidate.provenance.type === 'direct-work-item-state'));
});
