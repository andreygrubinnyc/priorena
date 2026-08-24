'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ACKNOWLEDGEMENTS,
  AGENT_FILE_NAME,
  AGENT_LABEL,
  LAUNCHCTL,
  MANAGED_MARKER,
  MAX_PATH_CHARS,
  MAX_PLIST_BYTES,
  PLUTIL,
  ROLLBACK_FILE_NAME,
  SUPPORTED_PORT,
  THROTTLE_INTERVAL_SECONDS,
  generateLaunchAgentDefinition,
  inspectAgent,
  installAgent,
  parseArguments,
  planAgent,
  removeAgent,
  replaceAgent,
  rollbackAgent,
  run,
  validateConfiguration,
  validateManagedDefinition,
  xmlEscape
} = require('../scripts/release/startup-resilience');

function createRunner(overrides = {}) {
  const state = {
    registered: Boolean(overrides.registered),
    calls: [],
    counts: { bootstrap: 0, bootout: 0, print: 0, plutil: 0 },
    bootstrapFailures: new Set(overrides.bootstrapFailures || []),
    bootstrapNoRegister: new Set(overrides.bootstrapNoRegister || []),
    bootoutFailures: new Set(overrides.bootoutFailures || []),
    printFailures: new Set(overrides.printFailures || []),
    plutilFailures: new Set(overrides.plutilFailures || [])
  };
  state.runner = (command, args, options = {}) => {
    state.calls.push({ command, args: [...args], options });
    if (command === PLUTIL) {
      state.counts.plutil += 1;
      return state.plutilFailures.has(state.counts.plutil)
        ? { status: 1, stdout: '/fictional/private/plist-bytes', stderr: '/fictional/private/plutil-error' }
        : { status: 0, stdout: '-', stderr: '' };
    }
    assert.equal(command, LAUNCHCTL);
    const action = args[0];
    state.counts[action] += 1;
    if (action === 'print') {
      if (state.printFailures.has(state.counts.print)) {
        return { status: 5, stdout: '/fictional/private/child-output', stderr: '/fictional/private/launchctl-error' };
      }
      return state.registered
        ? { status: 0, stdout: '/fictional/private/service-state', stderr: '' }
        : { status: 113, stdout: '', stderr: '/fictional/private/not-found' };
    }
    if (action === 'bootstrap') {
      if (state.bootstrapFailures.has(state.counts.bootstrap)) {
        return { status: 5, stdout: '/fictional/private/bootstrap-output', stderr: '/fictional/private/bootstrap-error' };
      }
      if (!state.bootstrapNoRegister.has(state.counts.bootstrap)) state.registered = true;
      return { status: 0, stdout: '/fictional/private/bootstrap-output', stderr: '' };
    }
    if (action === 'bootout') {
      if (state.bootoutFailures.has(state.counts.bootout)) {
        return { status: 5, stdout: '/fictional/private/bootout-output', stderr: '/fictional/private/bootout-error' };
      }
      state.registered = false;
      return { status: 0, stdout: '/fictional/private/bootout-output', stderr: '' };
    }
    throw new Error('Unexpected injected command');
  };
  return state;
}

async function harness(t, runnerOptions = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'priorena-startup-resilience-')));
  const repositoryRoot = path.join(root, 'fictional-release');
  const targetServer = path.join(repositoryRoot, 'target-server');
  const privateRoot = path.join(root, 'fictional-private-state');
  const sourceFilesRoot = path.join(privateRoot, 'Source Library');
  const dataFile = path.join(privateRoot, 'target-v5.json');
  const logFile = path.join(privateRoot, 'logs', 'priorena.log');
  const nodeExecutable = path.join(root, 'fictional-runtime', 'node');
  const userHome = path.join(root, 'fictional-user-home');
  const launchAgentsDirectory = path.join(userHome, 'Library', 'LaunchAgents');
  await Promise.all([
    fs.mkdir(targetServer, { recursive: true, mode: 0o700 }),
    fs.mkdir(sourceFilesRoot, { recursive: true, mode: 0o700 }),
    fs.mkdir(path.dirname(logFile), { recursive: true, mode: 0o700 }),
    fs.mkdir(path.dirname(nodeExecutable), { recursive: true, mode: 0o700 }),
    fs.mkdir(launchAgentsDirectory, { recursive: true, mode: 0o700 })
  ]);
  await Promise.all([
    fs.writeFile(path.join(repositoryRoot, 'package.json'), '{"name":"priorena","private":true}\n', { mode: 0o600 }),
    fs.writeFile(path.join(targetServer, 'start.js'), "'use strict';\n", { mode: 0o600 }),
    fs.writeFile(dataFile, '{"schemaVersion":5,"fictional":true}\n', { mode: 0o600 }),
    fs.writeFile(nodeExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  ]);
  await fs.chmod(sourceFilesRoot, 0o700);
  await fs.chmod(launchAgentsDirectory, 0o700);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const launchd = createRunner(runnerOptions);
  const output = [];
  const dependencies = {
    platform: 'darwin',
    getuid: () => process.getuid(),
    runner: launchd.runner,
    stdout: { write: value => output.push(value) }
  };
  const options = {
    repositoryRoot,
    nodeExecutable,
    dataFile,
    sourceFilesRoot,
    logFile,
    userHome,
    port: String(SUPPORTED_PORT)
  };
  return {
    root,
    repositoryRoot,
    privateRoot,
    sourceFilesRoot,
    dataFile,
    logFile,
    nodeExecutable,
    userHome,
    launchAgentsDirectory,
    destination: path.join(launchAgentsDirectory, AGENT_FILE_NAME),
    rollback: path.join(launchAgentsDirectory, ROLLBACK_FILE_NAME),
    launchd,
    output,
    dependencies,
    options
  };
}

function cliArguments(action, context, acknowledgement) {
  const values = [
    action,
    '--repository-root', context.repositoryRoot,
    '--node-executable', context.nodeExecutable,
    '--data-file', context.dataFile,
    '--source-files-root', context.sourceFilesRoot,
    '--log-file', context.logFile,
    '--user-home', context.userHome,
    '--port', String(SUPPORTED_PORT)
  ];
  if (acknowledgement) values.push('--acknowledgement', acknowledgement);
  return values;
}

async function install(context, options = context.options) {
  return installAgent({ ...options, acknowledgement: ACKNOWLEDGEMENTS.install }, context.dependencies);
}

function assertOnlyExactCommands(context) {
  const domain = `gui/${process.getuid()}`;
  for (const call of context.launchd.calls) {
    assert.ok([PLUTIL, LAUNCHCTL].includes(call.command));
    assert.equal(call.options.shell, false);
    if (call.command === PLUTIL) {
      assert.deepEqual(call.args, ['-lint', '-']);
      assert.ok(Buffer.isBuffer(call.options.input));
      continue;
    }
    if (call.args[0] === 'print' || call.args[0] === 'bootout') {
      assert.deepEqual(call.args, [call.args[0], `${domain}/${AGENT_LABEL}`]);
    } else {
      assert.deepEqual(call.args, ['bootstrap', domain, context.destination]);
    }
  }
}

test('definition generation is deterministic, direct, bounded, and XML-safe', () => {
  const configuration = {
    repositoryRoot: '/fictional/Release & Review',
    nodeExecutable: '/fictional/Runtime/node<exact>',
    startPath: '/fictional/Release & Review/target-server/start.js',
    dataFile: '/fictional/Private/data & state.json',
    sourceFilesRoot: '/fictional/Private/Source <Library>',
    logFile: '/fictional/Private/logs/operation > current.log',
    port: SUPPORTED_PORT
  };
  const first = generateLaunchAgentDefinition(configuration);
  const second = generateLaunchAgentDefinition(structuredClone(configuration));
  assert.deepEqual(first, second);
  assert.ok(first.length < MAX_PLIST_BYTES);
  const text = first.toString('utf8');
  assert.match(text, new RegExp(`<string>${AGENT_LABEL.replaceAll('.', '\\.')}<\\/string>`));
  assert.match(text, /<key>RunAtLoad<\/key>\n  <true\/>/);
  assert.match(text, /<key>KeepAlive<\/key>[\s\S]+<key>SuccessfulExit<\/key>\n    <false\/>/);
  assert.match(text, new RegExp(`<key>ThrottleInterval<\\/key>\\n  <integer>${THROTTLE_INTERVAL_SECONDS}<\\/integer>`));
  assert.match(text, /<key>WorkingDirectory<\/key>/);
  assert.match(text, /<string>\/dev\/null<\/string>/);
  assert.doesNotMatch(text, /EnvironmentVariables|<key>Program<\/key>|Shell|<key>PATH<\/key>|https?:|ftp:|credential|token/i);
  assert.match(text, /Release &amp; Review/);
  assert.match(text, /node&lt;exact&gt;/);
  assert.doesNotMatch(text, /node<exact>|Source <Library>/);
  const expectedArguments = [
    configuration.nodeExecutable,
    configuration.startPath,
    '--data-file', configuration.dataFile,
    '--source-files-root', configuration.sourceFilesRoot,
    '--log-file', configuration.logFile,
    '--port', String(SUPPORTED_PORT)
  ];
  let argumentPosition = -1;
  for (const argument of expectedArguments) {
    const nextPosition = text.indexOf(`<string>${xmlEscape(argument)}</string>`, argumentPosition + 1);
    assert.ok(nextPosition > argumentPosition);
    argumentPosition = nextPosition;
  }
  assert.throws(() => xmlEscape('/fictional/control\nvalue'), error => error.code === 'STARTUP_ARGUMENTS_INVALID');
  const huge = `/${'a'.repeat(MAX_PATH_CHARS - 1)}`;
  assert.throws(() => generateLaunchAgentDefinition({
    repositoryRoot: huge,
    nodeExecutable: huge,
    startPath: huge,
    dataFile: huge,
    sourceFilesRoot: huge,
    logFile: huge,
    port: SUPPORTED_PORT
  }), error => error.code === 'STARTUP_DEFINITION_TOO_LARGE');
});

test('strict CLI parsing rejects duplicates, unsupported flags, malformed values, and wrong acknowledgements', async t => {
  const context = await harness(t);
  const parsed = parseArguments(cliArguments('plan', context));
  assert.equal(parsed.action, 'plan');
  assert.equal(parsed.options.repositoryRoot, context.repositoryRoot);
  assert.throws(() => parseArguments(['unknown']), error => error.code === 'STARTUP_ACTION_INVALID');
  assert.throws(() => parseArguments([...cliArguments('plan', context), '--port', '3100']), error => error.code === 'STARTUP_ARGUMENTS_INVALID');
  assert.throws(() => parseArguments([...cliArguments('plan', context), '--host', '127.0.0.1']), error => error.code === 'STARTUP_ARGUMENTS_INVALID');
  assert.throws(() => parseArguments([...cliArguments('plan', context), '--log-file']), error => error.code === 'STARTUP_ARGUMENTS_INVALID');
  assert.throws(() => parseArguments(cliArguments('install', context, 'YES')), error => error.code === 'STARTUP_ACKNOWLEDGEMENT_REQUIRED');
  assert.throws(() => parseArguments(cliArguments('plan', context).map(value => value === context.logFile ? `${value}\n` : value)), error => error.code === 'STARTUP_ARGUMENTS_INVALID');
  assert.equal(parseArguments(cliArguments('install', context, ACKNOWLEDGEMENTS.install)).options.acknowledgement, ACKNOWLEDGEMENTS.install);
});

test('configuration validation accepts exact private paths and rejects every ambiguous trust boundary', async t => {
  await t.test('accepted exact configuration', async t => {
    const context = await harness(t);
    const result = await validateConfiguration(context.options, context.dependencies);
    assert.equal(result.repositoryRoot, context.repositoryRoot);
    assert.equal(result.nodeExecutable, context.nodeExecutable);
    assert.equal(result.destination, context.destination);
    assert.equal(result.domain, `gui/${process.getuid()}`);
    assert.equal(result.port, SUPPORTED_PORT);
  });

  const cases = [
    ['relative repository', async context => ({ ...context.options, repositoryRoot: 'relative/release' }), 'STARTUP_PATH_INVALID'],
    ['unsupported port', async context => ({ ...context.options, port: '3101' }), 'STARTUP_PORT_INVALID'],
    ['permissive data mode', async context => { await fs.chmod(context.dataFile, 0o644); return context.options; }, 'STARTUP_DATA_FILE_INVALID'],
    ['permissive Source mode', async context => { await fs.chmod(context.sourceFilesRoot, 0o755); return context.options; }, 'STARTUP_SOURCE_ROOT_INVALID'],
    ['permissive existing log mode', async context => { await fs.writeFile(context.logFile, 'fictional\n', { mode: 0o644 }); return context.options; }, 'STARTUP_LOG_PATH_INVALID'],
    ['repository-contained log', async context => ({ ...context.options, logFile: path.join(context.repositoryRoot, 'private.log') }), 'STARTUP_LOG_PATH_INVALID'],
    ['non-executable Node file', async context => { await fs.chmod(context.nodeExecutable, 0o600); return context.options; }, 'STARTUP_NODE_INVALID'],
    ['group-writable Node executable', async context => { await fs.chmod(context.nodeExecutable, 0o720); return context.options; }, 'STARTUP_NODE_INVALID'],
    ['unsupported platform', async context => context.options, 'STARTUP_PLATFORM_UNSUPPORTED', { platform: 'linux' }]
  ];
  for (const [name, arrange, code, dependencyChange] of cases) {
    await t.test(name, async t => {
      const context = await harness(t);
      const options = await arrange(context);
      await assert.rejects(validateConfiguration(options, { ...context.dependencies, ...dependencyChange }), error => error.code === code);
    });
  }

  await t.test('symlinked data endpoint', async t => {
    const context = await harness(t);
    const link = path.join(context.privateRoot, 'linked-data.json');
    await fs.symlink(context.dataFile, link);
    await assert.rejects(validateConfiguration({ ...context.options, dataFile: link }, context.dependencies), error => error.code === 'STARTUP_DATA_FILE_INVALID');
  });

  await t.test('symlinked Node executable', async t => {
    const context = await harness(t);
    const link = path.join(context.root, 'fictional-runtime', 'linked-node');
    await fs.symlink(context.nodeExecutable, link);
    await assert.rejects(validateConfiguration({ ...context.options, nodeExecutable: link }, context.dependencies), error => error.code === 'STARTUP_NODE_INVALID');
  });

  await t.test('symlinked Source root', async t => {
    const context = await harness(t);
    const link = path.join(context.privateRoot, 'linked-sources');
    await fs.symlink(context.sourceFilesRoot, link, 'dir');
    await assert.rejects(validateConfiguration({ ...context.options, sourceFilesRoot: link }, context.dependencies), error => error.code === 'STARTUP_SOURCE_ROOT_INVALID');
  });

  await t.test('log ancestor redirecting into repository', async t => {
    const context = await harness(t);
    const alias = path.join(context.privateRoot, 'outside-looking-log-root');
    await fs.symlink(context.repositoryRoot, alias, 'dir');
    await assert.rejects(validateConfiguration({ ...context.options, logFile: path.join(alias, 'private.log') }, context.dependencies), error => error.code === 'STARTUP_LOG_PATH_INVALID');
  });

  await t.test('ambiguous LaunchAgents destination through a symlink', async t => {
    const context = await harness(t);
    const actual = path.join(context.root, 'actual-launch-agents');
    await fs.mkdir(actual, { mode: 0o700 });
    await fs.rm(context.launchAgentsDirectory, { recursive: true });
    await fs.symlink(actual, context.launchAgentsDirectory, 'dir');
    await assert.rejects(validateConfiguration(context.options, context.dependencies), error => error.code === 'STARTUP_AGENT_DIRECTORY_INVALID');
  });

  await t.test('startup entrypoint reached through a symlinked directory', async t => {
    const context = await harness(t);
    const targetServer = path.join(context.repositoryRoot, 'target-server');
    const redirected = path.join(context.root, 'redirected-target-server');
    await fs.rename(targetServer, redirected);
    await fs.symlink(redirected, targetServer, 'dir');
    await assert.rejects(validateConfiguration(context.options, context.dependencies), error => error.code === 'STARTUP_REPOSITORY_INVALID');
  });

  await t.test('group-writable explicit user home', async t => {
    const context = await harness(t);
    await fs.chmod(context.userHome, 0o770);
    await assert.rejects(validateConfiguration(context.options, context.dependencies), error => error.code === 'STARTUP_USER_HOME_INVALID');
  });
});

test('plan and inspect are read-only, bounded, and target only the current GUI user and fixed label', async t => {
  const context = await harness(t);
  const before = await fs.readdir(context.launchAgentsDirectory);
  const planned = await planAgent(context.options, context.dependencies);
  assert.equal(planned.status, 'configuration-validated');
  assert.equal(planned.runAtLoad, true);
  assert.equal(planned.restartOnUnexpectedExit, true);
  assert.equal(planned.programArgumentCount, 10);
  assert.deepEqual(await fs.readdir(context.launchAgentsDirectory), before);
  assert.equal(context.launchd.calls.some(call => call.command === LAUNCHCTL), false);

  const inspected = await inspectAgent(context.options, context.dependencies);
  assert.equal(inspected.status, 'absent');
  assert.equal(inspected.installed, false);
  assert.equal(inspected.registered, false);
  assert.deepEqual(await fs.readdir(context.launchAgentsDirectory), before);
  const serviceCalls = context.launchd.calls.filter(call => call.command === LAUNCHCTL);
  assert.deepEqual(serviceCalls.map(call => call.args), [['print', `gui/${process.getuid()}/${AGENT_LABEL}`]]);
  assertOnlyExactCommands(context);
});

test('transactional first install writes private deterministic bytes and verifies exact registration', async t => {
  const context = await harness(t);
  const expected = generateLaunchAgentDefinition(await validateConfiguration(context.options, context.dependencies));
  const result = await install(context);
  assert.equal(result.status, 'installed-and-registered');
  assert.equal(result.registered, true);
  assert.deepEqual(await fs.readFile(context.destination), expected);
  assert.equal((await fs.stat(context.destination)).mode & 0o777, 0o600);
  assert.equal(context.launchd.registered, true);
  assert.equal(await fs.stat(context.rollback).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)), false);
  assertOnlyExactCommands(context);
});

test('install validation, write, bootstrap, and verification failures leave no definition or registration', async t => {
  const cases = [
    ['plist validation', { plutilFailures: [1] }, {}],
    ['atomic write', {}, { beforeAtomicWrite: () => { throw new Error('/fictional/private/write-failure'); } }],
    ['bootstrap', { bootstrapFailures: [1] }, {}],
    ['registration verification', { bootstrapNoRegister: [1] }, {}]
  ];
  for (const [name, runnerOptions, hooks] of cases) {
    await t.test(name, async t => {
      const context = await harness(t, runnerOptions);
      const dependencies = { ...context.dependencies, hooks };
      await assert.rejects(installAgent({ ...context.options, acknowledgement: ACKNOWLEDGEMENTS.install }, dependencies), error => {
        assert.ok(['STARTUP_INSTALL_FAILED', 'STARTUP_PLIST_VALIDATION_FAILED'].includes(error.code));
        assert.doesNotMatch(error.message, new RegExp(context.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        return true;
      });
      assert.equal(await fs.stat(context.destination).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)), false);
      assert.equal(context.launchd.registered, false);
      assertOnlyExactCommands(context);
    });
  }
});

test('an atomic publication followed by a directory-sync failure is rolled back completely', async t => {
  const context = await harness(t);
  let directorySyncs = 0;
  const injectedFs = {
    ...fs,
    open: async (filePath, ...args) => {
      const handle = await fs.open(filePath, ...args);
      if (filePath !== context.launchAgentsDirectory || args[0] !== 'r') return handle;
      directorySyncs += 1;
      if (directorySyncs !== 1) return handle;
      return {
        sync: async () => { throw new Error('/fictional/private/directory-sync'); },
        close: () => handle.close()
      };
    }
  };
  await assert.rejects(installAgent(
    { ...context.options, acknowledgement: ACKNOWLEDGEMENTS.install },
    { ...context.dependencies, fs: injectedFs }
  ), error => error.code === 'STARTUP_INSTALL_FAILED');
  await assert.rejects(fs.stat(context.destination), { code: 'ENOENT' });
  assert.equal(context.launchd.registered, false);
  assert.equal(directorySyncs, 2);
  assertOnlyExactCommands(context);
});

test('first install refuses an already-registered fixed label when no managed definition exists', async t => {
  const context = await harness(t, { registered: true });
  await assert.rejects(install(context), error => error.code === 'STARTUP_MANAGED_DEFINITION_INVALID');
  await assert.rejects(fs.stat(context.destination), { code: 'ENOENT' });
  assert.equal(context.launchd.registered, true);
  assert.deepEqual(context.launchd.calls.filter(call => call.command === LAUNCHCTL).map(call => call.args), [
    ['print', `gui/${process.getuid()}/${AGENT_LABEL}`]
  ]);
});

test('replacement preserves prior bytes, uses exact bootout/bootstrap targeting, and verifies the new state', async t => {
  const context = await harness(t);
  await install(context);
  const prior = await fs.readFile(context.destination);
  const replacementOptions = { ...context.options, logFile: path.join(context.privateRoot, 'logs', 'replacement.log') };
  const expected = generateLaunchAgentDefinition(await validateConfiguration(replacementOptions, context.dependencies));
  const result = await replaceAgent({ ...replacementOptions, acknowledgement: ACKNOWLEDGEMENTS.replace }, context.dependencies);
  assert.equal(result.status, 'replaced-and-registered');
  assert.equal(result.rollbackAvailable, true);
  assert.deepEqual(await fs.readFile(context.destination), expected);
  assert.deepEqual(await fs.readFile(context.rollback), prior);
  assert.equal((await fs.stat(context.rollback)).mode & 0o777, 0o600);
  assert.equal(context.launchd.counts.bootout, 1);
  assert.equal(context.launchd.counts.bootstrap, 2);
  assertOnlyExactCommands(context);
});

test('replacement write, bootstrap, and verification failures restore prior bytes and registration', async t => {
  const cases = [
    ['replacement write', {}, { beforeAtomicWrite: ({ purpose }) => { if (purpose === 'replace') throw new Error('/fictional/private/replace-write'); } }],
    ['replacement bootout', { bootoutFailures: [1] }, {}],
    ['replacement bootstrap', { bootstrapFailures: [2] }, {}],
    ['replacement verification', { bootstrapNoRegister: [2] }, {}],
    ['post-rename verification', {}, { afterAtomicRename: ({ purpose }) => { if (purpose === 'replace') throw new Error('/fictional/private/post-rename'); } }]
  ];
  for (const [name, runnerOptions, hooks] of cases) {
    await t.test(name, async t => {
      const context = await harness(t, runnerOptions);
      await install(context);
      const prior = await fs.readFile(context.destination);
      const replacementOptions = { ...context.options, logFile: path.join(context.privateRoot, 'logs', `${name.replaceAll(' ', '-')}.log`) };
      await assert.rejects(replaceAgent(
        { ...replacementOptions, acknowledgement: ACKNOWLEDGEMENTS.replace },
        { ...context.dependencies, hooks }
      ), error => error.code === 'STARTUP_REPLACEMENT_FAILED');
      assert.deepEqual(await fs.readFile(context.destination), prior);
      assert.deepEqual(await fs.readFile(context.rollback), prior);
      assert.equal(context.launchd.registered, true);
      assertOnlyExactCommands(context);
    });
  }
});

test('a failed replacement restoration is reported without leaking child output and preserves prior definition bytes', async t => {
  const context = await harness(t, { bootstrapFailures: [2, 3] });
  await install(context);
  const prior = await fs.readFile(context.destination);
  const replacementOptions = { ...context.options, logFile: path.join(context.privateRoot, 'logs', 'failed-replacement.log') };
  await assert.rejects(replaceAgent(
    { ...replacementOptions, acknowledgement: ACKNOWLEDGEMENTS.replace },
    context.dependencies
  ), error => {
    assert.equal(error.code, 'STARTUP_REPLACEMENT_ROLLBACK_FAILED');
    assert.doesNotMatch(`${error.code} ${error.message}`, /fictional-private|bootstrap-output|bootstrap-error|\.plist/);
    return true;
  });
  assert.deepEqual(await fs.readFile(context.destination), prior);
  assertOnlyExactCommands(context);
});

test('rollback restores only the retained exact definition and preserves action idempotence', async t => {
  const context = await harness(t);
  await install(context);
  const prior = await fs.readFile(context.destination);
  const replacementOptions = { ...context.options, logFile: path.join(context.privateRoot, 'logs', 'new-active.log') };
  await replaceAgent({ ...replacementOptions, acknowledgement: ACKNOWLEDGEMENTS.replace }, context.dependencies);
  const result = await rollbackAgent({ ...context.options, acknowledgement: ACKNOWLEDGEMENTS.rollback }, context.dependencies);
  assert.equal(result.status, 'prior-definition-restored-and-registered');
  assert.deepEqual(await fs.readFile(context.destination), prior);
  assert.equal(context.launchd.registered, true);
  const repeated = await rollbackAgent({ ...context.options, acknowledgement: ACKNOWLEDGEMENTS.rollback }, context.dependencies);
  assert.equal(repeated.status, 'prior-definition-already-active');
  assertOnlyExactCommands(context);
});

test('rollback activation failure restores the formerly active definition and exact registration state', async t => {
  const context = await harness(t, { bootstrapFailures: [3] });
  await install(context);
  const replacementOptions = { ...context.options, logFile: path.join(context.privateRoot, 'logs', 'active-before-rollback.log') };
  await replaceAgent({ ...replacementOptions, acknowledgement: ACKNOWLEDGEMENTS.replace }, context.dependencies);
  const activeBefore = await fs.readFile(context.destination);
  await assert.rejects(
    rollbackAgent({ ...context.options, acknowledgement: ACKNOWLEDGEMENTS.rollback }, context.dependencies),
    error => error.code === 'STARTUP_ROLLBACK_FAILED'
  );
  assert.deepEqual(await fs.readFile(context.destination), activeBefore);
  assert.equal(context.launchd.registered, true);
  assertOnlyExactCommands(context);
});

test('removal targets only the exact managed service, is safely idempotent, and retains prior rollback bytes', async t => {
  const context = await harness(t);
  await install(context);
  const replacementOptions = { ...context.options, logFile: path.join(context.privateRoot, 'logs', 'remove-active.log') };
  await replaceAgent({ ...replacementOptions, acknowledgement: ACKNOWLEDGEMENTS.replace }, context.dependencies);
  const retained = await fs.readFile(context.rollback);
  const result = await removeAgent({ userHome: context.userHome, acknowledgement: ACKNOWLEDGEMENTS.remove }, context.dependencies);
  assert.equal(result.status, 'removed');
  assert.equal(result.rollbackAvailable, true);
  await assert.rejects(fs.stat(context.destination), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(context.rollback), retained);
  assert.equal(context.launchd.registered, false);
  const repeated = await removeAgent({ userHome: context.userHome, acknowledgement: ACKNOWLEDGEMENTS.remove }, context.dependencies);
  assert.equal(repeated.status, 'already-absent');
  assert.equal(repeated.rollbackAvailable, true);
  assertOnlyExactCommands(context);
});

test('removal failure restores the exact active definition and prior registration', async t => {
  const context = await harness(t);
  await install(context);
  const active = await fs.readFile(context.destination);
  await assert.rejects(removeAgent(
    { userHome: context.userHome, acknowledgement: ACKNOWLEDGEMENTS.remove },
    {
      ...context.dependencies,
      hooks: { beforePermanentRemoval: () => { throw new Error('/fictional/private/remove-failure'); } }
    }
  ), error => error.code === 'STARTUP_REMOVAL_FAILED');
  assert.deepEqual(await fs.readFile(context.destination), active);
  assert.equal(context.launchd.registered, true);
  assertOnlyExactCommands(context);
});

test('managed-definition validation and results never expose private paths, plist bytes, UID, or child output', async t => {
  const context = await harness(t);
  const planned = await planAgent(context.options, context.dependencies);
  const serialized = JSON.stringify(planned);
  for (const privateValue of [
    context.root,
    context.repositoryRoot,
    context.nodeExecutable,
    context.dataFile,
    context.sourceFilesRoot,
    context.logFile,
    context.userHome,
    String(process.getuid()),
    'service-state',
    'plist-bytes'
  ]) assert.doesNotMatch(serialized, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(planned.userDomain, 'current-gui-user');

  const expected = generateLaunchAgentDefinition(await validateConfiguration(context.options, context.dependencies));
  await validateManagedDefinition(expected, context.dependencies);
  const tampered = Buffer.from(expected.toString('utf8').replace(MANAGED_MARKER, '<!-- unrelated -->'));
  await assert.rejects(validateManagedDefinition(tampered, context.dependencies), error => error.code === 'STARTUP_MANAGED_DEFINITION_INVALID');

  const outputResult = await run(cliArguments('plan', context), context.dependencies);
  assert.equal(outputResult.status, 'configuration-validated');
  assert.equal(context.output.length, 1);
  assert.doesNotMatch(context.output[0], new RegExp(context.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const failing = await harness(t, { printFailures: [1] });
  await assert.rejects(inspectAgent(failing.options, failing.dependencies), error => {
    const safe = `${error.code} ${error.message}`;
    assert.equal(error.code, 'STARTUP_SERVICE_INSPECTION_FAILED');
    assert.doesNotMatch(safe, /fictional-private|child-output|launchctl-error|\.plist/);
    return true;
  });
});

test('unsupported acknowledgements cannot write, replace, register, boot out, roll back, or remove', async t => {
  const context = await harness(t);
  const calls = [
    () => installAgent({ ...context.options, acknowledgement: 'NO' }, context.dependencies),
    () => replaceAgent({ ...context.options, acknowledgement: 'NO' }, context.dependencies),
    () => rollbackAgent({ ...context.options, acknowledgement: 'NO' }, context.dependencies),
    () => removeAgent({ userHome: context.userHome, acknowledgement: 'NO' }, context.dependencies)
  ];
  for (const operation of calls) {
    await assert.rejects(operation(), error => error.code === 'STARTUP_ACKNOWLEDGEMENT_REQUIRED');
  }
  assert.deepEqual(await fs.readdir(context.launchAgentsDirectory), []);
  assert.equal(context.launchd.calls.length, 0);
});

test('the focused tests never invoke real launchctl or inspect the real user LaunchAgents directory', () => {
  assert.equal(fsSync.existsSync(path.join(__dirname, '..', 'scripts', 'release', 'startup-resilience.js')), true);
  assert.equal(LAUNCHCTL, '/bin/launchctl');
  assert.equal(PLUTIL, '/usr/bin/plutil');
  assert.equal(AGENT_LABEL, 'com.priorena.local');
});
