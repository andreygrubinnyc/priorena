const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createCleanSeed } = require('../target-model/clean-seed');
const {
  EXPECT_TARGET_ABSENT,
  MAX_TARGET_READ_BYTES,
  MAX_TARGET_WRITE_BYTES,
  SIMULATED_FAILURE_STAGE,
  TargetPersistenceError,
  TargetRevisionRequiredError,
  TargetStaleRevisionError,
  TargetTransitionValidationError,
  parseTargetData,
  readTargetData,
  readTargetDataWithRevision,
  serializeTargetData,
  validateTargetTransition,
  writeTargetData
} = require('../target-model/persistence');
const {
  AUDIT_ACTIONS,
  MAX_ROOT_COLLECTION_RECORDS,
  TargetResourceLimitError,
  TargetSchemaVersionError,
  TargetValidationError
} = require('../target-model/schema');
const {
  createInvalidCrossOrganizationFixture,
  createMultiOrganizationFixture,
  workItem
} = require('../test-support/target-v3-fixtures');

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'priorena-target-v4-test-'));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function bytes(filePath) {
  return fs.readFile(filePath);
}

async function checksum(filePath) {
  return crypto.createHash('sha256').update(await bytes(filePath)).digest('hex');
}

async function temporaryFilesFor(filePath) {
  const temporaryPrefix = `.${path.basename(filePath)}.`;
  return (await fs.readdir(path.dirname(filePath)))
    .filter(name => name.startsWith(temporaryPrefix) && name.endsWith('.tmp'));
}

async function createTarget(filePath, document, options = {}) {
  return writeTargetData(filePath, document, { ...options, expectedRevision: EXPECT_TARGET_ABSENT });
}

async function updateTarget(filePath, document, options = {}) {
  const { revision } = await readTargetDataWithRevision(filePath);
  return writeTargetData(filePath, document, { ...options, expectedRevision: revision });
}

async function assertRejectedWritePreservesFile(filePath, candidate, expectedError) {
  const originalBytes = await bytes(filePath);
  const originalChecksum = await checksum(filePath);

  await assert.rejects(updateTarget(filePath, candidate), expectedError);

  assert.deepEqual(await bytes(filePath), originalBytes);
  assert.equal(await checksum(filePath), originalChecksum);
  assert.deepEqual(await temporaryFilesFor(filePath), []);
}

async function assertStaleWritePreservesFile(filePath, candidate, expectedRevision) {
  const originalBytes = await bytes(filePath);
  const originalChecksum = await checksum(filePath);

  await assert.rejects(
    writeTargetData(filePath, candidate, { expectedRevision }),
    error => error instanceof TargetStaleRevisionError && error.code === 'TARGET_STALE_REVISION'
  );

  assert.deepEqual(await bytes(filePath), originalBytes);
  assert.equal(await checksum(filePath), originalChecksum);
  assert.deepEqual(await temporaryFilesFor(filePath), []);
}

function documentWithSerializedByteLength(targetByteLength) {
  const document = createCleanSeed();
  document.globalTechnicalSettings = { padding: '' };
  const emptyPaddingLength = Buffer.byteLength(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
  assert.equal(targetByteLength >= emptyPaddingLength, true);
  document.globalTechnicalSettings.padding = 'x'.repeat(targetByteLength - emptyPaddingLength);
  assert.equal(Buffer.byteLength(`${JSON.stringify(document, null, 2)}\n`, 'utf8'), targetByteLength);
  return document;
}

function validTargetBytesOfLength(targetByteLength) {
  const serialized = Buffer.from(`${JSON.stringify(createCleanSeed(), null, 2)}\n`, 'utf8');
  assert.equal(targetByteLength >= serialized.length, true);
  return Buffer.concat([serialized, Buffer.alloc(targetByteLength - serialized.length, 0x20)]);
}

function createUncommunicatedFixture() {
  const document = createMultiOrganizationFixture();
  const alphaVersion = document.briefingVersions.find(item => item.id === 'briefing-version-alpha-communicated');
  alphaVersion.status = 'finalized';
  alphaVersion.communicatedAt = null;
  document.briefings.find(item => item.id === 'briefing-alpha').lastCommunicatedVersionId = null;
  return document;
}

function createFinalizedFixture() {
  const document = createUncommunicatedFixture();
  const version = document.briefingVersions.find(item => item.id === 'briefing-version-beta-draft');
  version.status = 'finalized';
  version.finalizedAt = '2026-08-07T16:00:00.000Z';
  version.frozenSnapshot = { fixture: 'BETA FINALIZED SENTINEL' };
  version.facts = [{ text: 'Fictional finalized fact.' }];
  version.outputs = [{ format: 'teams', content: 'Fictional finalized output.' }];
  return document;
}

function communicationAuditEvent(version, options = {}) {
  return {
    id: options.id || `audit-event-${version.id}-communicated`,
    organizationId: options.organizationId || version.organizationId,
    workspaceId: options.workspaceId === undefined ? version.workspaceIds[0] : options.workspaceId,
    entityType: 'briefingVersion',
    entityId: options.entityId || version.id,
    action: options.action || AUDIT_ACTIONS.BRIEFING_VERSION_COMMUNICATED,
    actor: 'local-review-session',
    timestamp: options.timestamp || version.communicatedAt,
    beforeHash: null,
    afterHash: null
  };
}

function communicationCandidate(existing, versionId, communicatedAt = '2026-08-07T17:00:00.000Z') {
  const candidate = structuredClone(existing);
  const version = candidate.briefingVersions.find(item => item.id === versionId);
  version.status = 'communicated';
  version.communicatedAt = communicatedAt;
  const briefing = candidate.briefings.find(item => item.id === version.briefingId);
  briefing.lastCommunicatedVersionId = version.id;
  briefing.updatedAt = communicatedAt;
  candidate.auditEvents.push(communicationAuditEvent(version));
  return candidate;
}

function addFinalizedVersion(document, briefingId, versionId, finalizedAt = '2026-08-07T16:00:00.000Z') {
  const briefing = document.briefings.find(item => item.id === briefingId);
  const sourceVersion = document.briefingVersions.find(item => item.briefingId === briefingId);
  const version = structuredClone(sourceVersion);
  version.id = versionId;
  version.status = 'finalized';
  version.comparisonVersionId = briefing.lastCommunicatedVersionId;
  version.frozenSnapshot = { fixture: `${versionId} FICTIONAL FINALIZED SENTINEL` };
  version.facts = [{ text: 'Fictional finalized fact for transition coverage.' }];
  version.outputs = [{ format: 'teams', content: 'Fictional deterministic output.' }];
  version.finalizedAt = finalizedAt;
  version.communicatedAt = null;
  document.briefingVersions.push(version);
  return version;
}

async function writeFixtureWithCommunicatedAlpha(filePath) {
  const initial = createUncommunicatedFixture();
  await createTarget(filePath, initial);
  const communicated = communicationCandidate(
    initial,
    'briefing-version-alpha-communicated',
    '2026-08-07T14:00:00.000Z'
  );
  await updateTarget(filePath, communicated);
  return communicated;
}

function organizationAuditEvent(id = 'audit-event-alpha-organization') {
  return {
    id,
    organizationId: 'org-fixture-alpha',
    workspaceId: null,
    entityType: 'organization',
    entityId: 'org-fixture-alpha',
    action: 'reviewed',
    actor: 'local-review-session',
    timestamp: '2026-08-07T15:00:00.000Z',
    beforeHash: null,
    afterHash: null
  };
}

test('target persistence requires an explicitly supplied data-file path', async () => {
  await assert.rejects(readTargetData(), /explicit target data-file path/);
  await assert.rejects(writeTargetData(undefined, createCleanSeed()), /explicit target data-file path/);
});

test('semantic round-trip persistence validates and reloads the clean seed', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const seed = createCleanSeed();

  const result = await createTarget(filePath, seed);
  const reloaded = await readTargetDataWithRevision(filePath);

  assert.equal(result.filePath, filePath);
  assert.equal(result.byteLength, (await bytes(filePath)).length);
  assert.equal(result.revision, await checksum(filePath));
  assert.equal(reloaded.revision, result.revision);
  assert.deepEqual(reloaded.document, seed);
  assert.notEqual(reloaded.document, seed);
});

test('explicit expect-absent creation succeeds once and returns the exact persisted revision', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const seed = createCleanSeed();

  const created = await createTarget(filePath, seed);
  assert.equal(created.revision, await checksum(filePath));
  await assertStaleWritePreservesFile(filePath, createCleanSeed(), EXPECT_TARGET_ABSENT);

  const absentPath = path.join(directory, 'still-absent.json');
  await assert.rejects(
    writeTargetData(absentPath, seed, { expectedRevision: created.revision }),
    error => error instanceof TargetStaleRevisionError && error.code === 'TARGET_STALE_REVISION'
  );
  await assert.rejects(fs.stat(absentPath), error => error.code === 'ENOENT');
  assert.deepEqual(await temporaryFilesFor(absentPath), []);
});

test('two concurrent expect-absent creates allow exactly one destination', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const firstCandidate = createCleanSeed();
  firstCandidate.organizations[0].description = 'Fictional first concurrent creation.';
  const secondCandidate = createCleanSeed();
  secondCandidate.organizations[0].description = 'Fictional second concurrent creation.';

  const results = await Promise.allSettled([
    createTarget(filePath, firstCandidate),
    createTarget(filePath, secondCandidate)
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(
    results.some(result => result.status === 'rejected' && result.reason instanceof TargetStaleRevisionError),
    true
  );

  const acceptedCandidate = results[0].status === 'fulfilled' ? firstCandidate : secondCandidate;
  const persisted = await readTargetDataWithRevision(filePath);
  assert.deepEqual(persisted.document, acceptedCandidate);
  assert.equal(persisted.revision, await checksum(filePath));
  assert.deepEqual(await temporaryFilesFor(filePath), []);
});

test('replacement requires the exact latest revision and returns a reusable new revision', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  await createTarget(filePath, createCleanSeed());
  const base = await readTargetDataWithRevision(filePath);

  const acceptedCandidate = structuredClone(base.document);
  acceptedCandidate.organizations[0].description = 'Fictional revision-aware update.';
  acceptedCandidate.organizations[0].updatedAt = '2026-08-07T18:00:00.000Z';
  const accepted = await writeTargetData(filePath, acceptedCandidate, { expectedRevision: base.revision });
  assert.notEqual(accepted.revision, base.revision);
  assert.equal(accepted.revision, await checksum(filePath));

  const staleCandidate = structuredClone(base.document);
  staleCandidate.globalTechnicalSettings = { staleCandidate: true };
  await assertStaleWritePreservesFile(filePath, staleCandidate, base.revision);

  const latest = await readTargetDataWithRevision(filePath);
  const arbitraryCandidate = structuredClone(latest.document);
  arbitraryCandidate.globalTechnicalSettings = { arbitraryRevision: true };
  const unknownRevision = latest.revision === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
  await assertStaleWritePreservesFile(filePath, arbitraryCandidate, unknownRevision);

  const beforeMissingRevision = await bytes(filePath);
  const beforeMissingChecksum = await checksum(filePath);
  await assert.rejects(
    writeTargetData(filePath, arbitraryCandidate),
    error => error instanceof TargetRevisionRequiredError && error.code === 'TARGET_EXPECTED_REVISION_REQUIRED'
  );
  assert.deepEqual(await bytes(filePath), beforeMissingRevision);
  assert.equal(await checksum(filePath), beforeMissingChecksum);
  assert.deepEqual(await temporaryFilesFor(filePath), []);

  await assertStaleWritePreservesFile(filePath, {}, base.revision);

  const retryBase = await readTargetDataWithRevision(filePath);
  const retryCandidate = structuredClone(retryBase.document);
  retryCandidate.globalTechnicalSettings = { retriedAfterStaleFailure: true };
  const retried = await writeTargetData(filePath, retryCandidate, { expectedRevision: retryBase.revision });
  assert.equal(retried.revision, (await readTargetDataWithRevision(filePath)).revision);
  assert.equal(retried.revision, await checksum(filePath));
});

test('deterministic reload and rewrite produce identical bytes', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const fixture = createUncommunicatedFixture();

  await createTarget(filePath, fixture);
  const firstBytes = await bytes(filePath);
  const reloaded = await readTargetData(filePath);
  await updateTarget(filePath, reloaded);
  const secondBytes = await bytes(filePath);

  assert.deepEqual(secondBytes, firstBytes);
  assert.deepEqual(await readTargetData(filePath), fixture);
});

test('successful writes use private file permissions and leave no temporary files', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  await createTarget(filePath, createCleanSeed());

  const entries = await fs.readdir(directory);
  const stat = await fs.stat(filePath);
  assert.deepEqual(entries, ['target-data.json']);
  assert.equal(stat.mode & 0o777, 0o600);
});

test('atomic replacement writes the complete new valid document', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const original = createCleanSeed();
  const replacement = structuredClone(original);
  replacement.organizations[0].description = 'Updated fictional Organization description.';
  replacement.organizations[0].updatedAt = '2026-08-07T18:00:00.000Z';

  await createTarget(filePath, original);
  await updateTarget(filePath, replacement);

  assert.deepEqual(await readTargetData(filePath), replacement);
  assert.deepEqual(await fs.readdir(directory), ['target-data.json']);
});

test('the deterministic simulated write failure preserves original bytes', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  await createTarget(filePath, createCleanSeed());
  const originalBytes = await bytes(filePath);
  const candidate = createCleanSeed();
  candidate.organizations[0].description = 'Fictional description that must not be persisted after failure.';
  candidate.organizations[0].updatedAt = '2026-08-07T18:00:00.000Z';

  await assert.rejects(
    updateTarget(filePath, candidate, { simulateFailureAt: SIMULATED_FAILURE_STAGE }),
    error => error instanceof TargetPersistenceError && error.code === 'SIMULATED_TARGET_WRITE_FAILURE'
  );

  assert.deepEqual(await bytes(filePath), originalBytes);
  assert.deepEqual(await fs.readdir(directory), ['target-data.json']);
});

test('simulated failure for a new target cleans the temporary file and creates no destination', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');

  await assert.rejects(
    createTarget(filePath, createCleanSeed(), { simulateFailureAt: SIMULATED_FAILURE_STAGE }),
    /Simulated target write failure/
  );

  assert.deepEqual(await fs.readdir(directory), []);
  await assert.rejects(fs.stat(filePath), error => error.code === 'ENOENT');
});

test('a failed write releases its path queue so a later valid write succeeds', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const existing = createUncommunicatedFixture();
  await createTarget(filePath, existing);

  const failedCandidate = structuredClone(existing);
  failedCandidate.auditEvents.push(organizationAuditEvent('audit-event-simulated-failure'));
  await assert.rejects(
    updateTarget(filePath, failedCandidate, { simulateFailureAt: SIMULATED_FAILURE_STAGE }),
    error => error instanceof TargetPersistenceError && error.code === 'SIMULATED_TARGET_WRITE_FAILURE'
  );
  assert.deepEqual(await temporaryFilesFor(filePath), []);

  const validCandidate = structuredClone(existing);
  validCandidate.auditEvents.push(organizationAuditEvent('audit-event-after-failed-write'));
  await updateTarget(filePath, validCandidate);
  assert.deepEqual((await readTargetData(filePath)).auditEvents, validCandidate.auditEvents);
  assert.deepEqual(await temporaryFilesFor(filePath), []);
});

test('writes to different target paths are not held behind one repository-wide queue', { timeout: 5_000 }, async t => {
  const directory = await temporaryDirectory(t);
  const firstPath = path.join(directory, 'first-target.json');
  const secondPath = path.join(directory, 'second-target.json');
  const originalRename = fs.rename;
  let releaseFirstRename;
  let signalFirstRename;
  let signalSecondRename;
  const firstRenameReached = new Promise(resolve => {
    signalFirstRename = resolve;
  });
  const secondRenameReached = new Promise(resolve => {
    signalSecondRename = resolve;
  });
  const firstRenameMayContinue = new Promise(resolve => {
    releaseFirstRename = resolve;
  });
  let firstWrite;
  let secondWrite;

  fs.rename = async (temporaryPath, destinationPath) => {
    if (destinationPath === firstPath) {
      signalFirstRename();
      await firstRenameMayContinue;
    }
    if (destinationPath === secondPath) signalSecondRename();
    return originalRename(temporaryPath, destinationPath);
  };

  try {
    firstWrite = createTarget(firstPath, createCleanSeed());
    await firstRenameReached;
    secondWrite = createTarget(secondPath, createCleanSeed());
    let timeout;
    try {
      await Promise.race([
        secondRenameReached,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('the second target path was blocked behind the first path')), 2_000);
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
    await secondWrite;
    releaseFirstRename();
    await firstWrite;
  } finally {
    releaseFirstRename();
    fs.rename = originalRename;
    await Promise.allSettled([firstWrite, secondWrite].filter(Boolean));
  }

  assert.deepEqual(await readTargetData(firstPath), createCleanSeed());
  assert.deepEqual(await readTargetData(secondPath), createCleanSeed());
  assert.deepEqual(await fs.readdir(directory), ['first-target.json', 'second-target.json']);
});

test('corrupt existing input is not overwritten or repaired', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const corruptBytes = Buffer.from('{"schemaVersion":2,"organizations":[');
  await fs.writeFile(filePath, corruptBytes, { mode: 0o600 });

  await assert.rejects(
    readTargetDataWithRevision(filePath),
    error => error instanceof TargetPersistenceError && error.code === 'INVALID_TARGET_JSON'
  );
  await assert.rejects(
    writeTargetData(filePath, createCleanSeed(), { expectedRevision: '0'.repeat(64) }),
    TargetStaleRevisionError
  );

  assert.deepEqual(await bytes(filePath), corruptBytes);
  assert.deepEqual(await fs.readdir(directory), ['target-data.json']);
});

test('unsupported-version existing input is not overwritten', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const unknownVersion = createCleanSeed();
  unknownVersion.schemaVersion = 99;
  const originalBytes = Buffer.from(`${JSON.stringify(unknownVersion)}\n`);
  await fs.writeFile(filePath, originalBytes, { mode: 0o600 });

  await assert.rejects(readTargetDataWithRevision(filePath), TargetSchemaVersionError);
  await assert.rejects(
    writeTargetData(filePath, createCleanSeed(), { expectedRevision: '0'.repeat(64) }),
    TargetStaleRevisionError
  );

  assert.deepEqual(await bytes(filePath), originalBytes);
  assert.deepEqual(await fs.readdir(directory), ['target-data.json']);
});

test('candidate validation failure leaves the original file byte-for-byte unchanged', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  await createTarget(filePath, createCleanSeed());
  const originalBytes = await bytes(filePath);

  await assert.rejects(updateTarget(filePath, createInvalidCrossOrganizationFixture()), TargetValidationError);

  assert.deepEqual(await bytes(filePath), originalBytes);
  assert.deepEqual(await fs.readdir(directory), ['target-data.json']);
});

test('Workspace Organization movement between valid documents is rejected without changing stored bytes', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const existing = createUncommunicatedFixture();
  existing.workspaces.push({
    ...structuredClone(existing.workspaces[0]),
    id: 'workspace-transition-empty',
    name: 'Fictional Transition Workspace'
  });
  const candidate = structuredClone(existing);
  candidate.workspaces.find(item => item.id === 'workspace-transition-empty').organizationId = 'org-fixture-beta';
  serializeTargetData(existing);
  serializeTargetData(candidate);

  await createTarget(filePath, existing);
  const originalBytes = await bytes(filePath);
  await assert.rejects(updateTarget(filePath, candidate), error => {
    assert.equal(error instanceof TargetTransitionValidationError, true);
    assert.equal(error.code, 'INVALID_TARGET_TRANSITION');
    assert.match(error.message, /cannot move to another Organization/);
    return true;
  });

  assert.deepEqual(await bytes(filePath), originalBytes);
  assert.deepEqual(await fs.readdir(directory), ['target-data.json']);
});

test('Workspace deletion and delete-then-recreate ownership transfer are rejected without changing stored bytes', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const existing = createUncommunicatedFixture();
  existing.workspaces.push({
    ...structuredClone(existing.workspaces[0]),
    id: 'workspace-transition-preserved',
    name: 'Fictional Preserved Workspace'
  });
  await createTarget(filePath, existing);

  const deleted = structuredClone(existing);
  deleted.workspaces = deleted.workspaces.filter(item => item.id !== 'workspace-transition-preserved');
  serializeTargetData(deleted);
  await assertRejectedWritePreservesFile(filePath, deleted, error => {
    assert.equal(error instanceof TargetTransitionValidationError, true);
    assert.match(error.message, /Workspace cannot be removed/);
    return true;
  });

  const transferred = structuredClone(deleted);
  transferred.workspaces.push({
    ...structuredClone(existing.workspaces.find(item => item.id === 'workspace-transition-preserved')),
    organizationId: 'org-fixture-beta'
  });
  serializeTargetData(transferred);
  await assertRejectedWritePreservesFile(filePath, transferred, /cannot move to another Organization/);
});

test('Workspace names and settings remain editable within the same Organization', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const existing = createUncommunicatedFixture();
  await createTarget(filePath, existing);

  const candidate = structuredClone(existing);
  const workspace = candidate.workspaces.find(item => item.id === 'workspace-alpha-shared');
  workspace.name = 'Renamed Fictional Delivery Workspace';
  workspace.settings = { commentFreshnessDays: 5 };
  workspace.updatedAt = '2026-08-07T18:00:00.000Z';

  await updateTarget(filePath, candidate);
  const persisted = await readTargetData(filePath);
  assert.equal(persisted.workspaces.find(item => item.id === workspace.id).name, workspace.name);
  assert.deepEqual(persisted.workspaces.find(item => item.id === workspace.id).settings, workspace.settings);
});

test('a new stable Workspace ID may be added but an existing ID cannot be reused', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const existing = createUncommunicatedFixture();
  await createTarget(filePath, existing);

  const added = structuredClone(existing);
  added.workspaces.push({
    ...structuredClone(existing.workspaces[0]),
    id: 'workspace-alpha-new-stable-id',
    name: 'New Fictional Workspace'
  });
  await updateTarget(filePath, added);
  assert.equal((await readTargetData(filePath)).workspaces.some(item => item.id === 'workspace-alpha-new-stable-id'), true);

  const reused = structuredClone(added);
  reused.workspaces.push({
    ...structuredClone(added.workspaces[0]),
    name: 'Duplicate Stable ID Workspace'
  });
  await assertRejectedWritePreservesFile(filePath, reused, /duplicates another ID in workspaces/);
});

test('Draft Briefing Versions may be edited and finalized content may not be mutated', async t => {
  const directory = await temporaryDirectory(t);
  const draftPath = path.join(directory, 'draft-target.json');
  const draft = createUncommunicatedFixture();
  await createTarget(draftPath, draft);
  const editedDraft = structuredClone(draft);
  editedDraft.briefingVersions.find(item => item.id === 'briefing-version-beta-draft').facts = [
    { text: 'Fictional editable Draft fact.' }
  ];
  await updateTarget(draftPath, editedDraft);
  assert.deepEqual(await readTargetData(draftPath), editedDraft);

  const finalizedPath = path.join(directory, 'finalized-target.json');
  const finalized = createFinalizedFixture();
  await createTarget(finalizedPath, finalized);
  const mutated = structuredClone(finalized);
  mutated.briefingVersions.find(item => item.id === 'briefing-version-beta-draft').frozenSnapshot.fixture = 'MUTATED FINALIZED SENTINEL';
  serializeTargetData(mutated);

  assert.throws(() => validateTargetTransition(finalized, mutated), /finalized Briefing content is immutable/);
  await assertRejectedWritePreservesFile(finalizedPath, mutated, error => {
    assert.equal(error instanceof TargetTransitionValidationError, true);
    assert.match(error.message, /finalized Briefing content is immutable/);
    return true;
  });
});

test('Finalized to Communicated requires its baseline, matching Audit Event, and unchanged frozen content', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const finalized = createFinalizedFixture();
  await createTarget(filePath, finalized);

  const communicated = communicationCandidate(finalized, 'briefing-version-beta-draft');
  const version = communicated.briefingVersions.find(item => item.id === 'briefing-version-beta-draft');

  const withoutBaseline = structuredClone(communicated);
  withoutBaseline.briefings.find(item => item.id === 'briefing-beta').lastCommunicatedVersionId = null;
  await assertRejectedWritePreservesFile(filePath, withoutBaseline, /must advance to the Briefing Version/);

  const withoutAuditEvent = structuredClone(communicated);
  withoutAuditEvent.auditEvents.pop();
  await assertRejectedWritePreservesFile(filePath, withoutAuditEvent, /requires exactly one newly appended matching/);

  const changedContent = structuredClone(communicated);
  changedContent.briefingVersions.find(item => item.id === version.id).facts.push({ text: 'Late fictional rewrite.' });
  serializeTargetData(changedContent);
  assert.throws(() => validateTargetTransition(finalized, changedContent), /finalized Briefing content is immutable/);
  await assertRejectedWritePreservesFile(filePath, changedContent, /finalized Briefing content is immutable/);

  validateTargetTransition(finalized, communicated);
  await updateTarget(filePath, communicated);
  const persisted = await readTargetData(filePath);
  assert.equal(persisted.briefingVersions.find(item => item.id === version.id).status, 'communicated');
  assert.equal(persisted.briefings.find(item => item.id === 'briefing-beta').lastCommunicatedVersionId, version.id);
  assert.equal(persisted.auditEvents.at(-1).action, AUDIT_ACTIONS.BRIEFING_VERSION_COMMUNICATED);
});

test('communication requires one newly appended matching Audit Event', async t => {
  const directory = await temporaryDirectory(t);
  const cases = [
    {
      name: 'unrelated-event',
      replace(candidate) {
        candidate.auditEvents[candidate.auditEvents.length - 1] = organizationAuditEvent('audit-event-unrelated-communication');
      }
    },
    {
      name: 'other-version',
      replace(candidate) {
        const otherVersion = candidate.briefingVersions.find(item => item.id === 'briefing-version-alpha-communicated');
        candidate.auditEvents[candidate.auditEvents.length - 1] = communicationAuditEvent(otherVersion, {
          id: 'audit-event-other-version-communication'
        });
      }
    },
    {
      name: 'wrong-action',
      replace(candidate) {
        candidate.auditEvents.at(-1).action = 'reviewed';
      }
    },
    {
      name: 'wrong-timestamp',
      replace(candidate) {
        candidate.auditEvents.at(-1).timestamp = '2026-08-07T17:30:00.000Z';
      }
    },
    {
      name: 'wrong-organization',
      replace(candidate) {
        candidate.auditEvents.at(-1).organizationId = 'org-fixture-alpha';
        candidate.auditEvents.at(-1).workspaceId = 'workspace-alpha-shared';
      }
    },
    {
      name: 'wrong-workspace',
      replace(candidate) {
        candidate.auditEvents.at(-1).workspaceId = 'workspace-alpha-shared';
      }
    }
  ];

  for (const auditCase of cases) {
    const filePath = path.join(directory, `${auditCase.name}.json`);
    const finalized = createFinalizedFixture();
    await createTarget(filePath, finalized);
    const candidate = communicationCandidate(finalized, 'briefing-version-beta-draft');
    auditCase.replace(candidate);
    await assertRejectedWritePreservesFile(filePath, candidate, TargetValidationError);
  }
});

test('communication Audit Events without a matching lifecycle transition are rejected', async t => {
  const directory = await temporaryDirectory(t);
  const cases = [
    {
      name: 'draft-target-null-baseline',
      existing: createUncommunicatedFixture(),
      versionId: 'briefing-version-beta-draft'
    },
    {
      name: 'finalized-target-no-transition',
      existing: createFinalizedFixture(),
      versionId: 'briefing-version-beta-draft'
    },
    {
      name: 'nonexistent-target',
      existing: createUncommunicatedFixture(),
      versionId: 'briefing-version-missing'
    }
  ];

  for (const auditCase of cases) {
    const filePath = path.join(directory, `${auditCase.name}.json`);
    await createTarget(filePath, auditCase.existing);
    const candidate = structuredClone(auditCase.existing);
    const version = candidate.briefingVersions.find(item => item.id === 'briefing-version-beta-draft');
    candidate.auditEvents.push(communicationAuditEvent(version, {
      id: `audit-event-${auditCase.name}`,
      entityId: auditCase.versionId,
      timestamp: '2026-08-07T17:00:00.000Z'
    }));
    await assertRejectedWritePreservesFile(filePath, candidate, TargetValidationError);
  }
});

test('an already Communicated Version cannot receive another communication Audit Event', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'already-communicated.json');
  const existing = await writeFixtureWithCommunicatedAlpha(filePath);
  const candidate = structuredClone(existing);
  const version = candidate.briefingVersions.find(item => item.id === 'briefing-version-alpha-communicated');
  candidate.auditEvents.push(communicationAuditEvent(version, {
    id: 'audit-event-alpha-duplicate-communication'
  }));

  await assertRejectedWritePreservesFile(filePath, candidate, error => {
    assert.equal(error instanceof TargetTransitionValidationError, true);
    assert.match(error.message, /requires exactly one matching Finalized to Communicated transition/);
    return true;
  });
});

test('communication transitions and appended Audit Events are one-to-one in both directions', async t => {
  const directory = await temporaryDirectory(t);

  const duplicateEventPath = path.join(directory, 'duplicate-events.json');
  const oneFinalized = createFinalizedFixture();
  await createTarget(duplicateEventPath, oneFinalized);
  const duplicateEvents = communicationCandidate(oneFinalized, 'briefing-version-beta-draft');
  const communicatedVersion = duplicateEvents.briefingVersions.find(item => item.id === 'briefing-version-beta-draft');
  duplicateEvents.auditEvents.push(communicationAuditEvent(communicatedVersion, {
    id: 'audit-event-beta-second-communication'
  }));
  await assertRejectedWritePreservesFile(duplicateEventPath, duplicateEvents, /exactly one newly appended matching/);

  const twoTransitionsPath = path.join(directory, 'two-transitions-one-event.json');
  const twoFinalized = createFinalizedFixture();
  await createTarget(twoTransitionsPath, twoFinalized);
  const oneEventForTwoTransitions = communicationCandidate(twoFinalized, 'briefing-version-beta-draft');
  const alphaVersion = oneEventForTwoTransitions.briefingVersions
    .find(item => item.id === 'briefing-version-alpha-communicated');
  alphaVersion.status = 'communicated';
  alphaVersion.communicatedAt = '2026-08-07T17:05:00.000Z';
  const alphaBriefing = oneEventForTwoTransitions.briefings.find(item => item.id === 'briefing-alpha');
  alphaBriefing.lastCommunicatedVersionId = alphaVersion.id;
  alphaBriefing.updatedAt = alphaVersion.communicatedAt;
  await assertRejectedWritePreservesFile(twoTransitionsPath, oneEventForTwoTransitions, /exactly one newly appended matching/);
});

test('removing the lifecycle transition from an otherwise complete communication candidate is rejected', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'missing-lifecycle-transition.json');
  const finalized = createFinalizedFixture();
  await createTarget(filePath, finalized);
  const candidate = communicationCandidate(finalized, 'briefing-version-beta-draft');
  const version = candidate.briefingVersions.find(item => item.id === 'briefing-version-beta-draft');
  version.status = 'finalized';
  version.communicatedAt = null;

  await assertRejectedWritePreservesFile(filePath, candidate, TargetValidationError);
});

test('communication timestamps are mandatory, valid, and chronological through persistence', async t => {
  const directory = await temporaryDirectory(t);
  const cases = [
    {
      name: 'missing',
      mutate(candidate) {
        candidate.briefingVersions.find(item => item.id === 'briefing-version-beta-draft').communicatedAt = null;
      }
    },
    {
      name: 'malformed',
      mutate(candidate) {
        candidate.briefingVersions.find(item => item.id === 'briefing-version-beta-draft').communicatedAt = 'not-a-timestamp';
      }
    },
    {
      name: 'earlier-than-finalized',
      mutate(candidate) {
        const timestamp = '2026-08-07T15:59:59.999Z';
        candidate.briefingVersions.find(item => item.id === 'briefing-version-beta-draft').communicatedAt = timestamp;
        candidate.auditEvents.at(-1).timestamp = timestamp;
      }
    }
  ];

  for (const timestampCase of cases) {
    const filePath = path.join(directory, `${timestampCase.name}.json`);
    const finalized = createFinalizedFixture();
    await createTarget(filePath, finalized);
    const candidate = communicationCandidate(finalized, 'briefing-version-beta-draft');
    timestampCase.mutate(candidate);
    await assertRejectedWritePreservesFile(filePath, candidate, TargetValidationError);
  }
});

test('new Communicated Versions and Draft to Communicated transitions are rejected through persistence', async t => {
  const directory = await temporaryDirectory(t);

  const initialDirectPath = path.join(directory, 'initial-communicated-version.json');
  await assert.rejects(
    createTarget(initialDirectPath, createMultiOrganizationFixture()),
    /must transition from an existing Finalized Version/
  );
  await assert.rejects(fs.stat(initialDirectPath), error => error.code === 'ENOENT');
  assert.deepEqual(
    (await fs.readdir(directory)).filter(name => name.startsWith('.initial-communicated-version.json.') && name.endsWith('.tmp')),
    []
  );

  const newVersionPath = path.join(directory, 'new-communicated-version.json');
  const finalized = createFinalizedFixture();
  await createTarget(newVersionPath, finalized);
  const directCreation = structuredClone(finalized);
  const newVersion = structuredClone(directCreation.briefingVersions.find(item => item.id === 'briefing-version-beta-draft'));
  newVersion.id = 'briefing-version-beta-direct-communicated';
  newVersion.status = 'communicated';
  newVersion.comparisonVersionId = 'briefing-version-beta-draft';
  newVersion.communicatedAt = '2026-08-07T17:00:00.000Z';
  directCreation.briefingVersions.push(newVersion);
  directCreation.briefings.find(item => item.id === 'briefing-beta').lastCommunicatedVersionId = newVersion.id;
  directCreation.auditEvents.push(communicationAuditEvent(newVersion));
  await assertRejectedWritePreservesFile(newVersionPath, directCreation, /must transition from an existing Finalized Version/);

  const draftPath = path.join(directory, 'draft-to-communicated.json');
  const draft = createUncommunicatedFixture();
  await createTarget(draftPath, draft);
  const skipped = communicationCandidate(draft, 'briefing-version-beta-draft');
  skipped.briefingVersions.find(item => item.id === 'briefing-version-beta-draft').finalizedAt = '2026-08-07T16:00:00.000Z';
  await assertRejectedWritePreservesFile(draftPath, skipped, /Draft Briefing Version cannot skip directly/);
});

test('two Versions of one Briefing cannot become Communicated in one write', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const existing = createFinalizedFixture();
  addFinalizedVersion(existing, 'briefing-beta', 'briefing-version-beta-second-finalized');
  await createTarget(filePath, existing);

  const candidate = communicationCandidate(existing, 'briefing-version-beta-draft');
  const secondVersion = candidate.briefingVersions.find(item => item.id === 'briefing-version-beta-second-finalized');
  secondVersion.status = 'communicated';
  secondVersion.communicatedAt = '2026-08-07T17:05:00.000Z';
  candidate.briefings.find(item => item.id === 'briefing-beta').lastCommunicatedVersionId = secondVersion.id;
  candidate.auditEvents.push(communicationAuditEvent(secondVersion));

  await assertRejectedWritePreservesFile(filePath, candidate, /only one Briefing Version may become Communicated/);
});

test('Briefing baselines cannot regress or be reassigned without a new communication', async t => {
  const directory = await temporaryDirectory(t);

  const nullPath = path.join(directory, 'baseline-null.json');
  const established = await writeFixtureWithCommunicatedAlpha(nullPath);
  const removedBaseline = structuredClone(established);
  removedBaseline.briefings.find(item => item.id === 'briefing-alpha').lastCommunicatedVersionId = null;
  await assertRejectedWritePreservesFile(nullPath, removedBaseline, /may change only when/);

  const regressionPath = path.join(directory, 'baseline-regression.json');
  const olderHistory = await writeFixtureWithCommunicatedAlpha(regressionPath);
  const finalizedHistory = structuredClone(olderHistory);
  const newerVersion = addFinalizedVersion(
    finalizedHistory,
    'briefing-alpha',
    'briefing-version-alpha-newer-communicated',
    '2026-08-07T14:30:00.000Z'
  );
  await updateTarget(regressionPath, finalizedHistory);
  const history = communicationCandidate(finalizedHistory, newerVersion.id, '2026-08-07T15:00:00.000Z');
  await updateTarget(regressionPath, history);
  const regressed = structuredClone(history);
  regressed.briefings.find(item => item.id === 'briefing-alpha').lastCommunicatedVersionId = 'briefing-version-alpha-communicated';
  await assertRejectedWritePreservesFile(regressionPath, regressed, /may change only when/);
});

test('a Briefing baseline cannot point to another Briefing Version', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const finalized = createFinalizedFixture();
  await createTarget(filePath, finalized);
  const alphaCommunicated = communicationCandidate(
    finalized,
    'briefing-version-alpha-communicated',
    '2026-08-07T14:00:00.000Z'
  );
  await updateTarget(filePath, alphaCommunicated);
  const existing = communicationCandidate(alphaCommunicated, 'briefing-version-beta-draft');
  await updateTarget(filePath, existing);
  const betaVersion = existing.briefingVersions.find(item => item.id === 'briefing-version-beta-draft');

  const candidate = structuredClone(existing);
  candidate.briefings.find(item => item.id === 'briefing-alpha').lastCommunicatedVersionId = betaVersion.id;
  await assertRejectedWritePreservesFile(filePath, candidate, /communicated Version of this Briefing/);
});

test('a valid communication advances an older communicated baseline', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const existing = await writeFixtureWithCommunicatedAlpha(filePath);
  const newVersion = addFinalizedVersion(existing, 'briefing-alpha', 'briefing-version-alpha-next-finalized');
  await updateTarget(filePath, existing);

  const candidate = communicationCandidate(existing, newVersion.id, '2026-08-07T17:00:00.000Z');
  const staleBaseline = structuredClone(candidate);
  staleBaseline.briefings.find(item => item.id === 'briefing-alpha').lastCommunicatedVersionId = 'briefing-version-alpha-communicated';
  await assertRejectedWritePreservesFile(filePath, staleBaseline, /must advance to the Briefing Version/);

  await updateTarget(filePath, candidate);
  assert.equal(
    (await readTargetData(filePath)).briefings.find(item => item.id === 'briefing-alpha').lastCommunicatedVersionId,
    newVersion.id
  );
});

test('Communicated Briefing Versions cannot be mutated or deleted through persistence', async t => {
  const directory = await temporaryDirectory(t);
  const directExisting = createMultiOrganizationFixture();
  const directMutation = structuredClone(directExisting);
  directMutation.briefingVersions.find(item => item.id === 'briefing-version-alpha-communicated').outputs.push({
    format: 'email',
    content: 'Rewritten fictional output.'
  });
  assert.throws(() => validateTargetTransition(directExisting, directMutation), /Communicated Briefing Versions are immutable/);
  const directDeletion = structuredClone(directExisting);
  directDeletion.briefingVersions = directDeletion.briefingVersions.filter(item => item.id !== 'briefing-version-alpha-communicated');
  directDeletion.briefings.find(item => item.id === 'briefing-alpha').lastCommunicatedVersionId = null;
  assert.throws(() => validateTargetTransition(directExisting, directDeletion), /Briefing Versions cannot be deleted/);

  const cases = [
    {
      name: 'mutated',
      candidate(existing) {
        const candidate = structuredClone(existing);
        candidate.briefingVersions.find(item => item.id === 'briefing-version-alpha-communicated').outputs.push({
          format: 'email',
          content: 'Rewritten fictional output.'
        });
        return candidate;
      },
      expectedError: /Communicated Briefing Versions are immutable/
    },
    {
      name: 'deleted',
      candidate(existing) {
        const candidate = structuredClone(existing);
        candidate.briefingVersions = candidate.briefingVersions.filter(item => item.id !== 'briefing-version-alpha-communicated');
        candidate.briefings.find(item => item.id === 'briefing-alpha').lastCommunicatedVersionId = null;
        return candidate;
      },
      expectedError: TargetValidationError
    }
  ];

  for (const communicatedCase of cases) {
    const filePath = path.join(directory, `${communicatedCase.name}.json`);
    const existing = await writeFixtureWithCommunicatedAlpha(filePath);
    const candidate = communicatedCase.candidate(existing);
    await assertRejectedWritePreservesFile(filePath, candidate, communicatedCase.expectedError);
  }
});

test('existing Audit Events cannot be mutated, deleted, or reordered through persistence', async t => {
  const directory = await temporaryDirectory(t);
  const cases = [
    {
      name: 'mutated',
      candidate(existing) {
        const candidate = structuredClone(existing);
        candidate.auditEvents[0].action = 'rewritten';
        return candidate;
      },
      pattern: /append-only, ordered, and immutable/
    },
    {
      name: 'deleted',
      candidate(existing) {
        const candidate = structuredClone(existing);
        candidate.auditEvents.pop();
        return candidate;
      },
      pattern: /cannot be deleted/
    },
    {
      name: 'reordered',
      candidate(existing) {
        const candidate = structuredClone(existing);
        candidate.auditEvents.reverse();
        return candidate;
      },
      pattern: /append-only, ordered, and immutable/
    }
  ];

  for (const auditCase of cases) {
    const filePath = path.join(directory, `${auditCase.name}.json`);
    const existing = createUncommunicatedFixture();
    existing.auditEvents.push(organizationAuditEvent());
    await createTarget(filePath, existing);
    const candidate = auditCase.candidate(existing);
    serializeTargetData(candidate);
    assert.throws(() => validateTargetTransition(existing, candidate), auditCase.pattern);
    await assertRejectedWritePreservesFile(filePath, candidate, auditCase.pattern);
  }
});

test('appending a valid Audit Event succeeds', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const existing = createUncommunicatedFixture();
  await createTarget(filePath, existing);
  const candidate = structuredClone(existing);
  candidate.auditEvents.push(organizationAuditEvent());

  await updateTarget(filePath, candidate);
  assert.deepEqual((await readTargetData(filePath)).auditEvents, candidate.auditEvents);
});

test('same-base concurrent Work Item additions reject one stale candidate and preserve every accepted record', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'concurrent-work-items.json');
  const original = createUncommunicatedFixture();
  await createTarget(filePath, original);
  const [callerA, callerB] = await Promise.all([
    readTargetDataWithRevision(filePath),
    readTargetDataWithRevision(filePath)
  ]);
  assert.equal(callerA.revision, callerB.revision);

  const firstWorkItem = workItem(
    'work-item-concurrent-first',
    'org-fixture-alpha',
    'workspace-alpha-shared',
    null,
    'FICTIONAL FIRST CONCURRENT WORK ITEM'
  );
  const secondWorkItem = workItem(
    'work-item-concurrent-second',
    'org-fixture-alpha',
    'workspace-alpha-shared',
    null,
    'FICTIONAL SECOND CONCURRENT WORK ITEM'
  );
  callerA.document.workItems.push(firstWorkItem);
  callerB.document.workItems.push(secondWorkItem);

  const results = await Promise.allSettled([
    writeTargetData(filePath, callerA.document, { expectedRevision: callerA.revision }),
    writeTargetData(filePath, callerB.document, { expectedRevision: callerB.revision })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(
    results.some(result =>
      result.status === 'rejected' &&
      result.reason instanceof TargetStaleRevisionError &&
      result.reason.code === 'TARGET_STALE_REVISION'
    ),
    true
  );

  const acceptedWorkItem = results[0].status === 'fulfilled' ? firstWorkItem : secondWorkItem;
  const rejectedWorkItem = results[0].status === 'fulfilled' ? secondWorkItem : firstWorkItem;
  const acceptedResult = results.find(result => result.status === 'fulfilled').value;
  const afterRace = await readTargetDataWithRevision(filePath);
  const afterRaceIds = new Set(afterRace.document.workItems.map(item => item.id));
  original.workItems.forEach(item => {
    assert.deepEqual(afterRace.document.workItems.find(persisted => persisted.id === item.id), item);
  });
  assert.deepEqual(afterRace.document.auditEvents, original.auditEvents);
  assert.equal(afterRaceIds.has(acceptedWorkItem.id), true);
  assert.equal(afterRaceIds.has(rejectedWorkItem.id), false);
  assert.equal(acceptedResult.revision, afterRace.revision);
  assert.equal(afterRace.revision, await checksum(filePath));
  assert.deepEqual(await temporaryFilesFor(filePath), []);

  const retryCandidate = structuredClone(afterRace.document);
  retryCandidate.workItems.push(rejectedWorkItem);
  const retryResult = await writeTargetData(filePath, retryCandidate, { expectedRevision: afterRace.revision });
  const afterRetry = await readTargetDataWithRevision(filePath);
  const afterRetryIds = new Set(afterRetry.document.workItems.map(item => item.id));
  assert.equal(afterRetryIds.has(firstWorkItem.id), true);
  assert.equal(afterRetryIds.has(secondWorkItem.id), true);
  assert.deepEqual(afterRetry.document.auditEvents, original.auditEvents);
  assert.equal(retryResult.revision, afterRetry.revision);
  assert.deepEqual(await temporaryFilesFor(filePath), []);
});

test('stale full-document replacements reject valid changes across target collections', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'cross-collection-stale.json');
  await createTarget(filePath, createFinalizedFixture());
  const base = await readTargetDataWithRevision(filePath);

  const acceptedCandidate = structuredClone(base.document);
  const acceptedWorkItem = workItem(
    'work-item-cross-collection-accepted',
    'org-fixture-alpha',
    'workspace-alpha-shared',
    null,
    'FICTIONAL ACCEPTED CROSS-COLLECTION WORK ITEM'
  );
  acceptedCandidate.workItems.push(acceptedWorkItem);
  await writeTargetData(filePath, acceptedCandidate, { expectedRevision: base.revision });

  const staleWorkItem = structuredClone(base.document);
  staleWorkItem.workItems.push(workItem(
    'work-item-cross-collection-stale',
    'org-fixture-alpha',
    'workspace-alpha-shared',
    null,
    'FICTIONAL STALE CROSS-COLLECTION WORK ITEM'
  ));
  const staleScope = structuredClone(base.document);
  staleScope.scopes.find(item => item.id === 'scope-alpha-zero-mapping').name = 'Fictional Renamed Stale Scope';
  const staleMilestone = structuredClone(base.document);
  staleMilestone.milestones.find(item => item.id === 'milestone-alpha-workspace').title = 'Fictional Stale Milestone';
  const staleAudit = structuredClone(base.document);
  staleAudit.auditEvents.push(organizationAuditEvent('audit-event-cross-collection-stale'));
  const staleCommunication = communicationCandidate(base.document, 'briefing-version-beta-draft');

  for (const candidate of [staleWorkItem, staleScope, staleMilestone, staleAudit, staleCommunication]) {
    validateTargetTransition(base.document, candidate);
    await assertStaleWritePreservesFile(filePath, candidate, base.revision);
  }

  const persisted = await readTargetData(filePath);
  assert.equal(persisted.workItems.some(item => item.id === acceptedWorkItem.id), true);
  assert.equal(persisted.workItems.some(item => item.id === 'work-item-cross-collection-stale'), false);
  assert.deepEqual(await temporaryFilesFor(filePath), []);
});

test('same-base concurrent Audit appends reject one stale candidate without losing history', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'concurrent-target.json');
  const existing = createUncommunicatedFixture();
  await createTarget(filePath, existing);
  const base = await readTargetDataWithRevision(filePath);

  const firstEvent = organizationAuditEvent('audit-event-concurrent-first');
  const secondEvent = {
    ...organizationAuditEvent('audit-event-concurrent-second'),
    timestamp: '2026-08-07T15:01:00.000Z'
  };
  const firstCandidate = structuredClone(base.document);
  const secondCandidate = structuredClone(base.document);
  firstCandidate.auditEvents.push(firstEvent);
  secondCandidate.auditEvents.push(secondEvent);

  const results = await Promise.allSettled([
    writeTargetData(filePath, firstCandidate, { expectedRevision: base.revision }),
    writeTargetData(filePath, secondCandidate, { expectedRevision: base.revision })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(
    results.some(result => result.status === 'rejected' && result.reason instanceof TargetStaleRevisionError),
    true
  );

  const afterRace = await readTargetDataWithRevision(filePath);
  assert.deepEqual(afterRace.document.auditEvents.slice(0, existing.auditEvents.length), existing.auditEvents);
  assert.equal(afterRace.document.auditEvents.length, existing.auditEvents.length + 1);
  const retainedIds = new Set(afterRace.document.auditEvents.map(event => event.id));
  assert.equal(retainedIds.has(firstEvent.id) || retainedIds.has(secondEvent.id), true);
  assert.equal(retainedIds.has(firstEvent.id) && retainedIds.has(secondEvent.id), false);
  assert.deepEqual(await temporaryFilesFor(filePath), []);

  const retry = structuredClone(afterRace.document);
  retry.auditEvents.push(retainedIds.has(firstEvent.id) ? secondEvent : firstEvent);
  await writeTargetData(filePath, retry, { expectedRevision: afterRace.revision });
  const afterRetry = await readTargetData(filePath);
  assert.deepEqual(afterRetry.auditEvents.slice(0, existing.auditEvents.length), existing.auditEvents);
  assert.equal(afterRetry.auditEvents.some(event => event.id === firstEvent.id), true);
  assert.equal(afterRetry.auditEvents.some(event => event.id === secondEvent.id), true);
  assert.deepEqual(await temporaryFilesFor(filePath), []);
});

test('legitimate Work Item Scope assignment transitions remain valid', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const existing = createUncommunicatedFixture();
  await createTarget(filePath, existing);
  const candidate = structuredClone(existing);
  candidate.workItems.find(item => item.id === 'work-item-alpha-unassigned').scopeId = 'scope-alpha-zero-mapping';

  await updateTarget(filePath, candidate);
  assert.equal(
    (await readTargetData(filePath)).workItems.find(item => item.id === 'work-item-alpha-unassigned').scopeId,
    'scope-alpha-zero-mapping'
  );
});

test('existing Jira Epic mapping IDs cannot be deleted or moved while metadata remains editable', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const existing = createUncommunicatedFixture();
  await createTarget(filePath, existing);

  const removed = structuredClone(existing);
  removed.jiraEpicMappings = removed.jiraEpicMappings.filter(mapping => mapping.id !== 'jira-mapping-alpha-one');
  removed.workItems.find(item => item.id === 'work-item-alpha-assigned').jiraEpicMappingId = 'jira-mapping-alpha-two';
  await assertRejectedWritePreservesFile(filePath, removed, /existing Jira Epic mapping cannot be removed/);

  const moved = structuredClone(existing);
  const movedMapping = moved.jiraEpicMappings.find(mapping => mapping.id === 'jira-mapping-alpha-one');
  movedMapping.scopeId = 'scope-alpha-zero-mapping';
  moved.workItems.find(item => item.id === 'work-item-alpha-assigned').jiraEpicMappingId = 'jira-mapping-alpha-two';
  await assertRejectedWritePreservesFile(filePath, moved, /existing Jira Epic mapping cannot move to another parent/);

  const edited = structuredClone(existing);
  const editedMapping = edited.jiraEpicMappings.find(mapping => mapping.id === 'jira-mapping-alpha-one');
  editedMapping.jiraEpicName = 'Renamed Fictional Epic';
  editedMapping.mappingStatus = 'inactive';
  await updateTarget(filePath, edited);
  const stored = await readTargetData(filePath);
  assert.equal(stored.workItems.find(item => item.id === 'work-item-alpha-assigned').jiraEpicMappingId, 'jira-mapping-alpha-one');
  assert.equal(stored.jiraEpicMappings.find(mapping => mapping.id === 'jira-mapping-alpha-one').mappingStatus, 'inactive');
});

test('invalid candidate data never creates a new target or temporary file', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const invalid = createCleanSeed();
  delete invalid.schemaVersion;

  await assert.rejects(createTarget(filePath, invalid), TargetValidationError);

  assert.deepEqual(await fs.readdir(directory), []);
});

test('target reads enforce the exported byte limit at minus one, exactly, and plus one', async t => {
  const directory = await temporaryDirectory(t);
  for (const byteLength of [MAX_TARGET_READ_BYTES - 1, MAX_TARGET_READ_BYTES]) {
    const filePath = path.join(directory, `read-${byteLength}.json`);
    await fs.writeFile(filePath, validTargetBytesOfLength(byteLength), { mode: 0o600 });
    assert.deepEqual(await readTargetData(filePath), createCleanSeed());
    assert.equal((await fs.stat(filePath)).size, byteLength);
  }

  const oversizedPath = path.join(directory, 'read-oversized.json');
  const oversizedBytes = validTargetBytesOfLength(MAX_TARGET_READ_BYTES + 1);
  await fs.writeFile(oversizedPath, oversizedBytes, { mode: 0o600 });
  await assert.rejects(readTargetData(oversizedPath), error => {
    assert.equal(error instanceof TargetResourceLimitError, true);
    assert.equal(error.code, 'TARGET_RESOURCE_LIMIT_EXCEEDED');
    assert.match(error.message, new RegExp(`${MAX_TARGET_READ_BYTES}-byte read limit`));
    return true;
  });
  assert.deepEqual(await bytes(oversizedPath), oversizedBytes);
});

test('an oversized existing target is never parsed, overwritten, or accompanied by a temporary file', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'oversized-existing.json');
  const originalBytes = validTargetBytesOfLength(MAX_TARGET_READ_BYTES + 1);
  await fs.writeFile(filePath, originalBytes, { mode: 0o600 });

  await assertRejectedWritePreservesFile(filePath, createCleanSeed(), error => {
    assert.equal(error instanceof TargetResourceLimitError, true);
    assert.equal(error.code, 'TARGET_RESOURCE_LIMIT_EXCEEDED');
    return true;
  });
});

test('serialized writes enforce the exported byte limit at minus one, exactly, and plus one', async t => {
  const directory = await temporaryDirectory(t);
  for (const byteLength of [MAX_TARGET_WRITE_BYTES - 1, MAX_TARGET_WRITE_BYTES]) {
    const filePath = path.join(directory, `write-${byteLength}.json`);
    const candidate = documentWithSerializedByteLength(byteLength);
    const result = await createTarget(filePath, candidate);
    assert.equal(result.byteLength, byteLength);
    assert.equal((await fs.stat(filePath)).size, byteLength);
    assert.deepEqual(await readTargetData(filePath), candidate);
    assert.deepEqual(await temporaryFilesFor(filePath), []);
  }

  const oversizedPath = path.join(directory, 'write-oversized-new.json');
  const oversized = documentWithSerializedByteLength(MAX_TARGET_WRITE_BYTES + 1);
  await assert.rejects(createTarget(oversizedPath, oversized), error => {
    assert.equal(error instanceof TargetResourceLimitError, true);
    assert.match(error.message, new RegExp(`${MAX_TARGET_WRITE_BYTES}-byte write limit`));
    return true;
  });
  await assert.rejects(fs.stat(oversizedPath), error => error.code === 'ENOENT');
  assert.deepEqual(await temporaryFilesFor(oversizedPath), []);
});

test('oversized serialized output preserves an existing destination byte for byte', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'write-oversized-existing.json');
  await createTarget(filePath, createCleanSeed());
  const oversized = documentWithSerializedByteLength(MAX_TARGET_WRITE_BYTES + 1);

  await assertRejectedWritePreservesFile(filePath, oversized, error => {
    assert.equal(error instanceof TargetResourceLimitError, true);
    assert.equal(error.code, 'TARGET_RESOURCE_LIMIT_EXCEEDED');
    return true;
  });
});

test('oversized root collections fail before filesystem mutation', async t => {
  const directory = await temporaryDirectory(t);
  const newPath = path.join(directory, 'oversized-collection-new.json');
  const oversized = createCleanSeed();
  oversized.organizations = Array(MAX_ROOT_COLLECTION_RECORDS + 1).fill(null);

  await assert.rejects(
    createTarget(newPath, oversized),
    error => error instanceof TargetResourceLimitError && error.path === 'organizations'
  );
  await assert.rejects(fs.stat(newPath), error => error.code === 'ENOENT');
  assert.deepEqual(await temporaryFilesFor(newPath), []);

  const existingPath = path.join(directory, 'oversized-collection-existing.json');
  await createTarget(existingPath, createCleanSeed());
  await assertRejectedWritePreservesFile(
    existingPath,
    oversized,
    error => error instanceof TargetResourceLimitError && error.path === 'organizations'
  );
});

test('corrupt reads fail without rewriting the supplied file', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const originalBytes = Buffer.from('not-json');
  await fs.writeFile(filePath, originalBytes, { mode: 0o600 });

  await assert.rejects(readTargetData(filePath), error => {
    assert.equal(error instanceof TargetPersistenceError, true);
    assert.equal(error.code, 'INVALID_TARGET_JSON');
    return true;
  });

  assert.deepEqual(await bytes(filePath), originalBytes);
});

test('unsupported-version reads fail without rewriting the supplied file', async t => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, 'target-data.json');
  const document = createCleanSeed();
  document.schemaVersion = 5;
  const originalBytes = Buffer.from(JSON.stringify(document));
  await fs.writeFile(filePath, originalBytes, { mode: 0o600 });

  await assert.rejects(readTargetData(filePath), TargetSchemaVersionError);

  assert.deepEqual(await bytes(filePath), originalBytes);
});

test('serialization validates first and does not normalize the input object', () => {
  const document = createMultiOrganizationFixture();
  const before = structuredClone(document);
  const text = serializeTargetData(document);
  assert.deepEqual(JSON.parse(text), before);
  assert.deepEqual(document, before);

  const parsed = parseTargetData(text);
  assert.deepEqual(parsed, before);
});

test('the target persistence module contains no live-runtime default or production server wiring', async () => {
  const source = await fs.readFile(require.resolve('../target-model/persistence'), 'utf8');
  assert.doesNotMatch(source, /PMDS_DATA_FILE|pilot-data\.json|\.priorena-data|server\.js/);
});
