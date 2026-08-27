'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  BRIEFING_PRESETS,
  briefingCandidateReview,
  briefingPreset
} = require('../public/target-briefing-state');

const ALLOWED_TYPES = new Set(['status-update', 'delivery-status', 'general']);
const ALLOWED_FORMATS = new Set(['teams', 'email', 'confluence']);
const ALLOWED_SECTIONS = new Set(['summary', 'progress', 'risk', 'milestones', 'follow-up', 'evidence', 'next-actions']);

function candidate(id, section, kind, provenance) {
  return {
    id,
    section,
    kind,
    title: `Fictional ${id}`,
    text: `Grounded candidate ${id}`,
    provenance: { type: provenance }
  };
}

function snapshot(comparison) {
  return {
    definition: { defaultSections: ['risk', 'progress', 'evidence'] },
    selectedFactIds: ['fact:evidence:1'],
    comparison,
    candidates: [
      candidate('fact:current:1', 'progress', 'current-state', 'direct-work-item-state'),
      candidate('fact:evidence:1', 'evidence', 'accepted-evidence', 'accepted-evidence'),
      candidate('fact:follow-up:1', 'follow-up', 'follow-up', 'direct-follow-up-state'),
      candidate('fact:milestone:1', 'risk', 'milestone', 'direct-milestone-state')
    ]
  };
}

test('Briefing presets are frozen deterministic schema-v5 definition starting points', () => {
  assert.equal(Object.isFrozen(BRIEFING_PRESETS), true);
  assert.deepEqual(BRIEFING_PRESETS.map(item => item.id), [
    'weekly-delivery',
    'executive-snapshot',
    'team-coordination'
  ]);
  BRIEFING_PRESETS.forEach(preset => {
    assert.equal(Object.isFrozen(preset), true);
    assert.equal(Object.isFrozen(preset.preferredFormats), true);
    assert.equal(Object.isFrozen(preset.defaultSections), true);
    assert.equal(ALLOWED_TYPES.has(preset.briefingType), true);
    assert.equal(preset.preferredFormats.every(format => ALLOWED_FORMATS.has(format)), true);
    assert.equal(preset.defaultSections.every(section => ALLOWED_SECTIONS.has(section)), true);
    assert.ok(preset.name.length <= 300);
    assert.ok(preset.audienceProfile.length <= 500);
    assert.ok(preset.draftingGuidance.length <= 4_000);
  });
  assert.equal(briefingPreset('weekly-delivery').name, 'Weekly Delivery Update');
  assert.throws(() => briefingPreset('missing-preset'), /unavailable/);
  assert.doesNotMatch(JSON.stringify(BRIEFING_PRESETS), /recipient|https?:|private|source content|jira/i);
});

test('Candidate review keeps no-baseline facts available and separates provenance counts', () => {
  const review = briefingCandidateReview(snapshot({
    baselineVersionId: null,
    addedFactIds: ['fact:current:1', 'fact:evidence:1', 'fact:follow-up:1', 'fact:milestone:1'],
    changedFactIds: [],
    removedFactIds: []
  }));

  assert.equal(review.hasBaseline, false);
  assert.deepEqual(review.counts, {
    total: 4,
    selected: 1,
    currentState: 1,
    acceptedEvidence: 1,
    added: 0,
    changed: 0,
    removed: 0
  });
  assert.deepEqual(review.groups.map(group => group.section), ['risk', 'progress', 'evidence', 'follow-up']);
  assert.ok(review.groups.flatMap(group => group.items).every(item => item.baselineState === 'available'));
  assert.deepEqual(review.actionableCandidateIds, []);
  assert.equal(review.groups.find(group => group.section === 'evidence').items[0].selected, true);
});

test('Candidate review classifies communicated-baseline differences without selecting removed facts', () => {
  const review = briefingCandidateReview(snapshot({
    baselineVersionId: 'briefing-version-fixture-communicated',
    addedFactIds: ['fact:follow-up:1'],
    changedFactIds: ['fact:current:1'],
    removedFactIds: ['fact:removed:1']
  }));

  assert.equal(review.hasBaseline, true);
  assert.equal(review.baselineVersionId, 'briefing-version-fixture-communicated');
  assert.deepEqual(review.actionableCandidateIds, ['fact:current:1', 'fact:follow-up:1']);
  assert.deepEqual(review.counts, {
    total: 4,
    selected: 1,
    currentState: 1,
    acceptedEvidence: 1,
    added: 1,
    changed: 1,
    removed: 1
  });
  const states = new Map(review.groups.flatMap(group => group.items.map(item => [item.candidate.id, item.baselineState])));
  assert.equal(states.get('fact:current:1'), 'changed');
  assert.equal(states.get('fact:follow-up:1'), 'added');
  assert.equal(states.get('fact:evidence:1'), 'unchanged');
  assert.equal(states.has('fact:removed:1'), false);
});

test('Candidate review fails closed on malformed snapshots and candidates', () => {
  assert.throws(() => briefingCandidateReview(null), /snapshot is invalid/);
  assert.throws(() => briefingCandidateReview({ definition: {}, selectedFactIds: [], candidates: [{}] }), /candidate is invalid/);
  assert.throws(() => briefingCandidateReview({
    definition: {},
    selectedFactIds: [],
    candidates: [],
    comparison: { addedFactIds: 'not-an-array', changedFactIds: [], removedFactIds: [] }
  }), /array of strings/);
});

test('Briefing activation UI keeps presets and candidate selection explicit and no-send', () => {
  const client = fs.readFileSync(require.resolve('../public/target/app.js'), 'utf8');
  const styles = fs.readFileSync(require.resolve('../public/target/styles.css'), 'utf8');

  assert.match(client, /Apply preset to form/);
  assert.match(client, /Nothing has been saved/);
  assert.match(client, /selectedFactIds: \[\]/);
  assert.match(client, /Select all candidates/);
  assert.match(client, /Clear selection/);
  assert.match(client, /Select added and changed/);
  assert.match(client, /Selection changes remain local to this form until Save Draft/);
  assert.match(client, /Direct current state/);
  assert.match(client, /Accepted Evidence/);
  assert.match(client, /not a risk score and do not change current state/);
  assert.match(client, /Priorena does not send/);
  assert.doesNotMatch(client, /autoSelect|autoFinalize|sendBriefing|sendOutput/);
  assert.match(styles, /\.briefing-preset-picker/);
  assert.match(styles, /\.candidate-groups/);
  assert.match(styles, /\.candidate-selection-summary/);
});
