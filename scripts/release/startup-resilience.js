'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsConstants = require('node:fs').constants;
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { isInside } = require('./safety');

const AGENT_LABEL = 'com.priorena.local';
const AGENT_FILE_NAME = `${AGENT_LABEL}.plist`;
const ROLLBACK_FILE_NAME = `${AGENT_FILE_NAME}.previous`;
const SUPPORTED_PORT = 3100;
const THROTTLE_INTERVAL_SECONDS = 30;
const MAX_PATH_CHARS = 4096;
const MAX_PLIST_BYTES = 16 * 1024;
const MAX_PACKAGE_BYTES = 64 * 1024;
const PLUTIL = '/usr/bin/plutil';
const LAUNCHCTL = '/bin/launchctl';
const MANAGED_MARKER = '<!-- Priorena startup resilience controller; use only the bounded controller. -->';
const ABSENT_SERVICE_STATUSES = new Set([3, 113]);

const ACKNOWLEDGEMENTS = Object.freeze({
  install: 'INSTALL_PRIORENA_USER_AGENT',
  replace: 'REPLACE_PRIORENA_USER_AGENT',
  rollback: 'ROLLBACK_PRIORENA_USER_AGENT',
  remove: 'REMOVE_PRIORENA_USER_AGENT'
});

const COMMON_FLAGS = Object.freeze([
  '--repository-root',
  '--node-executable',
  '--data-file',
  '--source-files-root',
  '--log-file',
  '--user-home',
  '--port'
]);

const SAFE_MESSAGES = Object.freeze({
  STARTUP_ACTION_INVALID: 'The startup-resilience action is invalid',
  STARTUP_ARGUMENTS_INVALID: 'The startup-resilience arguments are invalid or ambiguous',
  STARTUP_ACKNOWLEDGEMENT_REQUIRED: 'The exact action-specific acknowledgement is required',
  STARTUP_PLATFORM_UNSUPPORTED: 'Startup resilience requires the supported macOS user domain',
  STARTUP_PATH_INVALID: 'A required startup path is invalid or ambiguous',
  STARTUP_REPOSITORY_INVALID: 'The explicit repository root is not a valid Priorena release root',
  STARTUP_NODE_INVALID: 'The explicit Node executable is invalid',
  STARTUP_DATA_FILE_INVALID: 'The private data file failed validation',
  STARTUP_SOURCE_ROOT_INVALID: 'The private Source root failed validation',
  STARTUP_LOG_PATH_INVALID: 'The private operational log path failed validation',
  STARTUP_USER_HOME_INVALID: 'The explicit current-user home failed validation',
  STARTUP_AGENT_DIRECTORY_INVALID: 'The exact per-user LaunchAgents directory failed validation',
  STARTUP_PORT_INVALID: 'The startup port must be the supported local runtime port',
  STARTUP_DEFINITION_TOO_LARGE: 'The generated LaunchAgent definition exceeds its bounded size',
  STARTUP_PLIST_VALIDATION_FAILED: 'The LaunchAgent definition failed plist validation',
  STARTUP_MANAGED_DEFINITION_INVALID: 'The existing agent definition is not an exact managed Priorena definition',
  STARTUP_DEFINITION_READ_FAILED: 'The agent definition could not be read safely',
  STARTUP_SERVICE_INSPECTION_FAILED: 'The exact Priorena user-agent state could not be inspected',
  STARTUP_SERVICE_MUTATION_FAILED: 'The exact Priorena user-agent operation failed',
  STARTUP_ATOMIC_WRITE_FAILED: 'The same-directory atomic agent write failed',
  STARTUP_AGENT_ALREADY_EXISTS: 'An agent definition already exists at the exact managed destination',
  STARTUP_AGENT_ABSENT: 'The exact managed agent definition is absent',
  STARTUP_ROLLBACK_AMBIGUOUS: 'The retained rollback definition is ambiguous',
  STARTUP_INSTALL_FAILED: 'The agent installation failed and its effects were rolled back',
  STARTUP_INSTALL_ROLLBACK_FAILED: 'The agent installation failed and rollback could not be verified',
  STARTUP_REPLACEMENT_FAILED: 'The agent replacement failed and the prior state was restored',
  STARTUP_REPLACEMENT_ROLLBACK_FAILED: 'The agent replacement failed and prior-state restoration could not be verified',
  STARTUP_ROLLBACK_FAILED: 'The retained agent rollback failed and the active state was restored',
  STARTUP_ROLLBACK_RESTORE_FAILED: 'The retained agent rollback failed and active-state restoration could not be verified',
  STARTUP_REMOVAL_FAILED: 'The exact managed agent removal failed and the prior state was restored',
  STARTUP_REMOVAL_ROLLBACK_FAILED: 'The exact managed agent removal failed and prior-state restoration could not be verified',
  STARTUP_VERIFICATION_FAILED: 'The exact managed agent state could not be verified'
});

function startupError(code, details = undefined) {
  const error = new Error(SAFE_MESSAGES[code] || 'Startup resilience operation failed');
  error.code = code;
  if (details && typeof details === 'object') Object.assign(error, details);
  return error;
}

function preserveSafeError(error, fallbackCode) {
  if (error && SAFE_MESSAGES[error.code]) return error;
  return startupError(fallbackCode);
}

function validateBoundedText(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_PATH_CHARS
    && value === value.normalize('NFC')
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && !value.includes('://');
}

function requireAbsolutePath(value) {
  if (!validateBoundedText(value) || !path.isAbsolute(value) || path.normalize(value) !== value) {
    throw startupError('STARTUP_PATH_INVALID');
  }
  return value;
}

function requireSupportedPort(value) {
  const port = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(port) || port !== SUPPORTED_PORT || String(value) !== String(SUPPORTED_PORT)) {
    throw startupError('STARTUP_PORT_INVALID');
  }
  return port;
}

function commandRunner(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 256 * 1024,
    shell: false
  });
}

function dependencies(overrides = {}) {
  return {
    fs: overrides.fs || fs,
    constants: overrides.constants || fsConstants,
    runner: overrides.runner || commandRunner,
    platform: overrides.platform || process.platform,
    getuid: overrides.getuid || (() => process.getuid?.()),
    randomUUID: overrides.randomUUID || crypto.randomUUID,
    hooks: overrides.hooks || Object.freeze({}),
    stdout: overrides.stdout || process.stdout
  };
}

async function callHook(runtime, name, context) {
  if (typeof runtime.hooks[name] === 'function') await runtime.hooks[name](context);
}

async function existingCanonicalPath(value, runtime, code) {
  const explicit = requireAbsolutePath(value);
  try {
    const [stats, canonical] = await Promise.all([
      runtime.fs.lstat(explicit),
      runtime.fs.realpath(explicit)
    ]);
    if (stats.isSymbolicLink() || canonical !== explicit) throw startupError(code);
    return Object.freeze({ path: explicit, stats });
  } catch (error) {
    throw preserveSafeError(error, code);
  }
}

async function canonicalizeThroughExistingAncestor(value, runtime) {
  const explicit = requireAbsolutePath(value);
  const missing = [];
  let candidate = explicit;
  while (true) {
    try {
      const stats = await runtime.fs.lstat(candidate);
      if (stats.isSymbolicLink()) throw startupError('STARTUP_LOG_PATH_INVALID');
      const canonical = await runtime.fs.realpath(candidate);
      return path.join(canonical, ...missing);
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      missing.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}

async function validateRepository(repositoryRoot, runtime) {
  const repository = await existingCanonicalPath(repositoryRoot, runtime, 'STARTUP_REPOSITORY_INVALID');
  if (!repository.stats.isDirectory()) throw startupError('STARTUP_REPOSITORY_INVALID');
  const packagePath = path.join(repository.path, 'package.json');
  const startPath = path.join(repository.path, 'target-server', 'start.js');
  try {
    const [packageFile, startFile] = await Promise.all([
      existingCanonicalPath(packagePath, runtime, 'STARTUP_REPOSITORY_INVALID'),
      existingCanonicalPath(startPath, runtime, 'STARTUP_REPOSITORY_INVALID')
    ]);
    if (!packageFile.stats.isFile() || packageFile.stats.size > MAX_PACKAGE_BYTES) {
      throw startupError('STARTUP_REPOSITORY_INVALID');
    }
    if (!startFile.stats.isFile()) throw startupError('STARTUP_REPOSITORY_INVALID');
    const packageDocument = JSON.parse(await runtime.fs.readFile(packagePath, 'utf8'));
    if (packageDocument.name !== 'priorena' || packageDocument.private !== true) {
      throw startupError('STARTUP_REPOSITORY_INVALID');
    }
  } catch (error) {
    throw preserveSafeError(error, 'STARTUP_REPOSITORY_INVALID');
  }
  return Object.freeze({ root: repository.path, startPath });
}

async function validateNodeExecutable(nodeExecutable, runtime) {
  const executable = await existingCanonicalPath(nodeExecutable, runtime, 'STARTUP_NODE_INVALID');
  if (!executable.stats.isFile()
    || executable.stats.isSymbolicLink()
    || (executable.stats.mode & 0o111) === 0
    || (executable.stats.mode & 0o022) !== 0) {
    throw startupError('STARTUP_NODE_INVALID');
  }
  try {
    await runtime.fs.access(executable.path, runtime.constants.X_OK);
  } catch (_) {
    throw startupError('STARTUP_NODE_INVALID');
  }
  return executable.path;
}

async function validatePrivateDataFile(dataFile, repositoryRoot, runtime) {
  const data = await existingCanonicalPath(dataFile, runtime, 'STARTUP_DATA_FILE_INVALID');
  if (!data.stats.isFile() || data.stats.isSymbolicLink() || (data.stats.mode & 0o777) !== 0o600) {
    throw startupError('STARTUP_DATA_FILE_INVALID');
  }
  if (isInside(repositoryRoot, data.path)) throw startupError('STARTUP_DATA_FILE_INVALID');
  return data.path;
}

async function validatePrivateSourceRoot(sourceRoot, repositoryRoot, runtime) {
  const source = await existingCanonicalPath(sourceRoot, runtime, 'STARTUP_SOURCE_ROOT_INVALID');
  if (!source.stats.isDirectory() || source.stats.isSymbolicLink() || (source.stats.mode & 0o077) !== 0) {
    throw startupError('STARTUP_SOURCE_ROOT_INVALID');
  }
  if (isInside(repositoryRoot, source.path)) throw startupError('STARTUP_SOURCE_ROOT_INVALID');
  return source.path;
}

async function validatePrivateLogPath(logFile, repositoryRoot, runtime) {
  const explicit = requireAbsolutePath(logFile);
  let canonical;
  try {
    canonical = await canonicalizeThroughExistingAncestor(explicit, runtime);
    if (canonical !== explicit || isInside(repositoryRoot, canonical)) throw startupError('STARTUP_LOG_PATH_INVALID');
    try {
      const stats = await runtime.fs.lstat(explicit);
      if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600) {
        throw startupError('STARTUP_LOG_PATH_INVALID');
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  } catch (error) {
    throw preserveSafeError(error, 'STARTUP_LOG_PATH_INVALID');
  }
  return canonical;
}

async function validateAgentLocation(userHome, runtime) {
  if (runtime.platform !== 'darwin') throw startupError('STARTUP_PLATFORM_UNSUPPORTED');
  const uid = runtime.getuid();
  if (!Number.isSafeInteger(uid) || uid < 0) throw startupError('STARTUP_PLATFORM_UNSUPPORTED');
  const home = await existingCanonicalPath(userHome, runtime, 'STARTUP_USER_HOME_INVALID');
  if (!home.stats.isDirectory()
    || home.stats.isSymbolicLink()
    || home.stats.uid !== uid
    || (home.stats.mode & 0o022) !== 0) {
    throw startupError('STARTUP_USER_HOME_INVALID');
  }
  const agentDirectoryPath = path.join(home.path, 'Library', 'LaunchAgents');
  const agentDirectory = await existingCanonicalPath(agentDirectoryPath, runtime, 'STARTUP_AGENT_DIRECTORY_INVALID');
  if (!agentDirectory.stats.isDirectory()
    || agentDirectory.stats.isSymbolicLink()
    || agentDirectory.stats.uid !== uid
    || (agentDirectory.stats.mode & 0o022) !== 0) {
    throw startupError('STARTUP_AGENT_DIRECTORY_INVALID');
  }
  return Object.freeze({
    uid,
    domain: `gui/${uid}`,
    directory: agentDirectory.path,
    destination: path.join(agentDirectory.path, AGENT_FILE_NAME),
    rollback: path.join(agentDirectory.path, ROLLBACK_FILE_NAME)
  });
}

async function validateConfiguration(options, overrides = {}) {
  const runtime = dependencies(overrides);
  try {
    const repository = await validateRepository(options.repositoryRoot, runtime);
    const [nodeExecutable, dataFile, sourceFilesRoot, logFile, agent] = await Promise.all([
      validateNodeExecutable(options.nodeExecutable, runtime),
      validatePrivateDataFile(options.dataFile, repository.root, runtime),
      validatePrivateSourceRoot(options.sourceFilesRoot, repository.root, runtime),
      validatePrivateLogPath(options.logFile, repository.root, runtime),
      validateAgentLocation(options.userHome, runtime)
    ]);
    return Object.freeze({
      repositoryRoot: repository.root,
      startPath: repository.startPath,
      nodeExecutable,
      dataFile,
      sourceFilesRoot,
      logFile,
      port: requireSupportedPort(options.port),
      ...agent
    });
  } catch (error) {
    throw preserveSafeError(error, 'STARTUP_ARGUMENTS_INVALID');
  }
}

function xmlEscape(value) {
  if (!validateBoundedText(value)) throw startupError('STARTUP_ARGUMENTS_INVALID');
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function stringElement(value, indentation = '    ') {
  return `${indentation}<string>${xmlEscape(value)}</string>`;
}

function generateLaunchAgentDefinition(configuration) {
  const programArguments = [
    configuration.nodeExecutable,
    configuration.startPath,
    '--data-file', configuration.dataFile,
    '--source-files-root', configuration.sourceFilesRoot,
    '--log-file', configuration.logFile,
    '--port', String(requireSupportedPort(configuration.port))
  ];
  const text = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    MANAGED_MARKER,
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    stringElement(AGENT_LABEL, '  '),
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...programArguments.map(argument => stringElement(argument)),
    '  </array>',
    '  <key>WorkingDirectory</key>',
    stringElement(configuration.repositoryRoot, '  '),
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '  <key>ThrottleInterval</key>',
    `  <integer>${THROTTLE_INTERVAL_SECONDS}</integer>`,
    '  <key>ProcessType</key>',
    '  <string>Background</string>',
    '  <key>StandardOutPath</key>',
    '  <string>/dev/null</string>',
    '  <key>StandardErrorPath</key>',
    '  <string>/dev/null</string>',
    '</dict>',
    '</plist>',
    ''
  ].join('\n');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > MAX_PLIST_BYTES) throw startupError('STARTUP_DEFINITION_TOO_LARGE');
  return bytes;
}

function command(runtime, executable, args, options = {}) {
  try {
    return runtime.runner(executable, Object.freeze([...args]), {
      input: options.input,
      encoding: 'utf8',
      maxBuffer: 256 * 1024,
      shell: false
    });
  } catch (_) {
    return Object.freeze({ error: true, status: null, stdout: '', stderr: '' });
  }
}

async function validatePlistBytes(bytes, runtime) {
  runtime = dependencies(runtime);
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_PLIST_BYTES) {
    throw startupError('STARTUP_PLIST_VALIDATION_FAILED');
  }
  await callHook(runtime, 'beforePlistValidation', Object.freeze({ byteSize: bytes.length }));
  const result = command(runtime, PLUTIL, ['-lint', '-'], { input: bytes });
  if (result.error || result.status !== 0) throw startupError('STARTUP_PLIST_VALIDATION_FAILED');
  return true;
}

function countOccurrences(text, value) {
  return text.split(value).length - 1;
}

async function validateManagedDefinition(bytes, runtime) {
  await validatePlistBytes(bytes, runtime);
  const text = bytes.toString('utf8');
  const requiredOnce = [
    MANAGED_MARKER,
    `<string>${AGENT_LABEL}</string>`,
    '<key>ProgramArguments</key>',
    '<string>--data-file</string>',
    '<string>--source-files-root</string>',
    '<string>--log-file</string>',
    '<string>--port</string>',
    '<key>RunAtLoad</key>',
    '<key>KeepAlive</key>',
    '<key>ThrottleInterval</key>'
  ];
  if (requiredOnce.some(value => countOccurrences(text, value) !== 1)) {
    throw startupError('STARTUP_MANAGED_DEFINITION_INVALID');
  }
  return true;
}

async function serviceRegistered(context, runtime) {
  const result = command(runtime, LAUNCHCTL, ['print', `${context.domain}/${AGENT_LABEL}`]);
  if (result.error) throw startupError('STARTUP_SERVICE_INSPECTION_FAILED');
  if (result.status === 0) return true;
  if (ABSENT_SERVICE_STATUSES.has(result.status)) return false;
  throw startupError('STARTUP_SERVICE_INSPECTION_FAILED');
}

async function mutateService(context, runtime, operation) {
  const args = operation === 'bootstrap'
    ? ['bootstrap', context.domain, context.destination]
    : ['bootout', `${context.domain}/${AGENT_LABEL}`];
  await callHook(runtime, 'beforeServiceMutation', Object.freeze({ operation, args: Object.freeze([...args]) }));
  const result = command(runtime, LAUNCHCTL, args);
  if (result.error || result.status !== 0) throw startupError('STARTUP_SERVICE_MUTATION_FAILED');
}

async function syncDirectory(directory, runtime) {
  const handle = await runtime.fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeTemporary(destination, bytes, runtime, purpose) {
  const temporary = path.join(path.dirname(destination), `.${AGENT_LABEL}.${purpose}-${runtime.randomUUID()}`);
  let handle;
  try {
    await callHook(runtime, 'beforeAtomicWrite', Object.freeze({ purpose }));
    handle = await runtime.fs.open(
      temporary,
      runtime.constants.O_CREAT | runtime.constants.O_EXCL | runtime.constants.O_WRONLY | (runtime.constants.O_NOFOLLOW || 0),
      0o600
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const [stats, written] = await Promise.all([
      runtime.fs.lstat(temporary),
      runtime.fs.readFile(temporary)
    ]);
    if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600 || !written.equals(bytes)) {
      throw startupError('STARTUP_ATOMIC_WRITE_FAILED');
    }
    return temporary;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await runtime.fs.unlink(temporary).catch(() => {});
    throw preserveSafeError(error, 'STARTUP_ATOMIC_WRITE_FAILED');
  }
}

async function atomicWriteNew(destination, bytes, runtime, purpose) {
  const temporary = await writeTemporary(destination, bytes, runtime, purpose);
  let applied = false;
  try {
    await runtime.fs.link(temporary, destination);
    applied = true;
    await runtime.fs.unlink(temporary);
    await syncDirectory(path.dirname(destination), runtime);
  } catch (error) {
    await runtime.fs.unlink(temporary).catch(() => {});
    throw startupError('STARTUP_ATOMIC_WRITE_FAILED', { applied });
  }
}

async function atomicReplace(destination, bytes, runtime, purpose) {
  const temporary = await writeTemporary(destination, bytes, runtime, purpose);
  let applied = false;
  try {
    await runtime.fs.rename(temporary, destination);
    applied = true;
    await callHook(runtime, 'afterAtomicRename', Object.freeze({ purpose }));
    await syncDirectory(path.dirname(destination), runtime);
  } catch (error) {
    if (!applied) await runtime.fs.unlink(temporary).catch(() => {});
    throw startupError('STARTUP_ATOMIC_WRITE_FAILED', { applied });
  }
}

async function readDefinition(filePath, uid, runtime, required = true) {
  let handle;
  try {
    handle = await runtime.fs.open(filePath, runtime.constants.O_RDONLY | (runtime.constants.O_NOFOLLOW || 0));
    const stats = await handle.stat();
    if (!stats.isFile()
      || stats.uid !== uid
      || (stats.mode & 0o777) !== 0o600
      || stats.size < 1
      || stats.size > MAX_PLIST_BYTES) {
      throw startupError('STARTUP_DEFINITION_READ_FAILED');
    }
    return await handle.readFile();
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return null;
    throw preserveSafeError(error, 'STARTUP_DEFINITION_READ_FAILED');
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function definitionExists(filePath, runtime) {
  try {
    await runtime.fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw startupError('STARTUP_DEFINITION_READ_FAILED');
  }
}

async function verifyState(context, expectedBytes, expectedRegistration, runtime) {
  try {
    const actual = await readDefinition(context.destination, context.uid, runtime);
    if (!actual.equals(expectedBytes)) throw startupError('STARTUP_VERIFICATION_FAILED');
    if (await serviceRegistered(context, runtime) !== expectedRegistration) {
      throw startupError('STARTUP_VERIFICATION_FAILED');
    }
    return true;
  } catch (error) {
    throw preserveSafeError(error, 'STARTUP_VERIFICATION_FAILED');
  }
}

function safeSummary(action, context, bytes, fields = {}) {
  return Object.freeze({
    action,
    status: fields.status || 'validated',
    label: AGENT_LABEL,
    userDomain: 'current-gui-user',
    port: SUPPORTED_PORT,
    definitionSha256: bytes ? crypto.createHash('sha256').update(bytes).digest('hex') : undefined,
    definitionBytes: bytes?.length,
    destinationIdentity: crypto.createHash('sha256').update(context.destination).digest('hex'),
    ...fields
  });
}

async function prepare(options, overrides) {
  const runtime = dependencies(overrides);
  const context = await validateConfiguration(options, runtime);
  const bytes = generateLaunchAgentDefinition(context);
  await validatePlistBytes(bytes, runtime);
  return Object.freeze({ runtime, context, bytes });
}

function requireAcknowledgement(action, acknowledgement) {
  if (acknowledgement !== ACKNOWLEDGEMENTS[action]) {
    throw startupError('STARTUP_ACKNOWLEDGEMENT_REQUIRED');
  }
}

async function planAgent(options, overrides = {}) {
  const { context, bytes } = await prepare(options, overrides);
  return safeSummary('plan', context, bytes, {
    status: 'configuration-validated',
    runAtLoad: true,
    restartOnUnexpectedExit: true,
    throttleSeconds: THROTTLE_INTERVAL_SECONDS,
    programArgumentCount: 10
  });
}

async function inspectAgent(options, overrides = {}) {
  const { runtime, context, bytes } = await prepare(options, overrides);
  const current = await readDefinition(context.destination, context.uid, runtime, false);
  const registered = await serviceRegistered(context, runtime);
  if (current) await validateManagedDefinition(current, runtime);
  const rollback = await readDefinition(context.rollback, context.uid, runtime, false);
  if (rollback) await validateManagedDefinition(rollback, runtime);
  return safeSummary('inspect', context, bytes, {
    status: current && registered ? 'installed-and-registered' : current ? 'installed-not-registered' : registered ? 'service-without-definition' : 'absent',
    installed: Boolean(current),
    registered,
    definitionMatches: Boolean(current?.equals(bytes)),
    rollbackAvailable: Boolean(rollback),
    consistent: Boolean(current) === registered
  });
}

async function rollbackFirstInstall(context, runtime) {
  if (await serviceRegistered(context, runtime)) await mutateService(context, runtime, 'bootout');
  await runtime.fs.unlink(context.destination).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
  });
  await syncDirectory(context.directory, runtime);
  if (await definitionExists(context.destination, runtime) || await serviceRegistered(context, runtime)) {
    throw startupError('STARTUP_INSTALL_ROLLBACK_FAILED');
  }
}

async function installAgent(options, overrides = {}) {
  requireAcknowledgement('install', options.acknowledgement);
  const { runtime, context, bytes } = await prepare(options, overrides);
  if (await definitionExists(context.destination, runtime)) throw startupError('STARTUP_AGENT_ALREADY_EXISTS');
  if (await definitionExists(context.rollback, runtime)) throw startupError('STARTUP_ROLLBACK_AMBIGUOUS');
  if (await serviceRegistered(context, runtime)) throw startupError('STARTUP_MANAGED_DEFINITION_INVALID');
  let written = false;
  try {
    await atomicWriteNew(context.destination, bytes, runtime, 'install');
    written = true;
    await mutateService(context, runtime, 'bootstrap');
    await verifyState(context, bytes, true, runtime);
    return safeSummary('install', context, bytes, {
      status: 'installed-and-registered',
      installed: true,
      registered: true,
      rollbackAvailable: false
    });
  } catch (error) {
    const safe = preserveSafeError(error, 'STARTUP_INSTALL_FAILED');
    if (error?.applied) written = true;
    if (written) {
      try {
        await rollbackFirstInstall(context, runtime);
      } catch (_) {
        throw startupError('STARTUP_INSTALL_ROLLBACK_FAILED');
      }
    }
    throw safe.code === 'STARTUP_ACKNOWLEDGEMENT_REQUIRED' ? safe : startupError('STARTUP_INSTALL_FAILED');
  }
}

async function restorePriorState(context, priorBytes, shouldRegister, runtime, purpose) {
  const registered = await serviceRegistered(context, runtime);
  if (registered) await mutateService(context, runtime, 'bootout');
  await atomicReplace(context.destination, priorBytes, runtime, purpose);
  if (shouldRegister) await mutateService(context, runtime, 'bootstrap');
  await verifyState(context, priorBytes, shouldRegister, runtime);
}

async function replaceAgent(options, overrides = {}) {
  requireAcknowledgement('replace', options.acknowledgement);
  const { runtime, context, bytes } = await prepare(options, overrides);
  const priorBytes = await readDefinition(context.destination, context.uid, runtime);
  await validateManagedDefinition(priorBytes, runtime);
  if (priorBytes.equals(bytes)) {
    return safeSummary('replace', context, bytes, {
      status: 'definition-unchanged',
      installed: true,
      registered: await serviceRegistered(context, runtime),
      rollbackAvailable: Boolean(await readDefinition(context.rollback, context.uid, runtime, false))
    });
  }
  const retained = await readDefinition(context.rollback, context.uid, runtime, false);
  if (retained) {
    await validateManagedDefinition(retained, runtime);
    if (!retained.equals(priorBytes)) throw startupError('STARTUP_ROLLBACK_AMBIGUOUS');
  } else {
    await atomicWriteNew(context.rollback, priorBytes, runtime, 'preserve-prior');
  }
  const wasRegistered = await serviceRegistered(context, runtime);
  try {
    if (wasRegistered) await mutateService(context, runtime, 'bootout');
    await atomicReplace(context.destination, bytes, runtime, 'replace');
    await mutateService(context, runtime, 'bootstrap');
    await verifyState(context, bytes, true, runtime);
    return safeSummary('replace', context, bytes, {
      status: 'replaced-and-registered',
      installed: true,
      registered: true,
      rollbackAvailable: true
    });
  } catch (_) {
    try {
      await restorePriorState(context, priorBytes, wasRegistered, runtime, 'restore-prior');
    } catch (_) {
      throw startupError('STARTUP_REPLACEMENT_ROLLBACK_FAILED');
    }
    throw startupError('STARTUP_REPLACEMENT_FAILED');
  }
}

async function rollbackAgent(options, overrides = {}) {
  requireAcknowledgement('rollback', options.acknowledgement);
  const { runtime, context, bytes: expectedPriorBytes } = await prepare(options, overrides);
  const [activeBytes, priorBytes] = await Promise.all([
    readDefinition(context.destination, context.uid, runtime),
    readDefinition(context.rollback, context.uid, runtime)
  ]);
  await Promise.all([
    validateManagedDefinition(activeBytes, runtime),
    validateManagedDefinition(priorBytes, runtime)
  ]);
  if (!priorBytes.equals(expectedPriorBytes)) throw startupError('STARTUP_ROLLBACK_AMBIGUOUS');
  const wasRegistered = await serviceRegistered(context, runtime);
  if (activeBytes.equals(priorBytes)) {
    return safeSummary('rollback', context, priorBytes, {
      status: 'prior-definition-already-active',
      installed: true,
      registered: wasRegistered,
      rollbackAvailable: true
    });
  }
  try {
    if (wasRegistered) await mutateService(context, runtime, 'bootout');
    await atomicReplace(context.destination, priorBytes, runtime, 'rollback');
    if (wasRegistered) await mutateService(context, runtime, 'bootstrap');
    await verifyState(context, priorBytes, wasRegistered, runtime);
    return safeSummary('rollback', context, priorBytes, {
      status: wasRegistered ? 'prior-definition-restored-and-registered' : 'prior-definition-restored',
      installed: true,
      registered: wasRegistered,
      rollbackAvailable: true
    });
  } catch (_) {
    try {
      await restorePriorState(context, activeBytes, wasRegistered, runtime, 'restore-active');
    } catch (_) {
      throw startupError('STARTUP_ROLLBACK_RESTORE_FAILED');
    }
    throw startupError('STARTUP_ROLLBACK_FAILED');
  }
}

async function removeAgent(options, overrides = {}) {
  requireAcknowledgement('remove', options.acknowledgement);
  const runtime = dependencies(overrides);
  const context = await validateAgentLocation(options.userHome, runtime);
  const activeBytes = await readDefinition(context.destination, context.uid, runtime, false);
  const registered = await serviceRegistered(context, runtime);
  const rollback = await readDefinition(context.rollback, context.uid, runtime, false);
  if (rollback) await validateManagedDefinition(rollback, runtime);
  if (!activeBytes) {
    if (registered) throw startupError('STARTUP_MANAGED_DEFINITION_INVALID');
    return safeSummary('remove', context, undefined, {
      status: 'already-absent',
      installed: false,
      registered: false,
      rollbackAvailable: Boolean(rollback)
    });
  }
  await validateManagedDefinition(activeBytes, runtime);
  const quarantine = path.join(context.directory, `.${AGENT_LABEL}.remove-${runtime.randomUUID()}`);
  let moved = false;
  try {
    if (registered) await mutateService(context, runtime, 'bootout');
    await runtime.fs.rename(context.destination, quarantine);
    moved = true;
    await syncDirectory(context.directory, runtime);
    if (await definitionExists(context.destination, runtime) || await serviceRegistered(context, runtime)) {
      throw startupError('STARTUP_VERIFICATION_FAILED');
    }
    await callHook(runtime, 'beforePermanentRemoval', Object.freeze({ action: 'remove' }));
    await runtime.fs.unlink(quarantine);
    moved = false;
    await syncDirectory(context.directory, runtime);
    return safeSummary('remove', context, undefined, {
      status: 'removed',
      installed: false,
      registered: false,
      rollbackAvailable: Boolean(rollback)
    });
  } catch (_) {
    try {
      if (moved) await runtime.fs.rename(quarantine, context.destination);
      if (registered && !await serviceRegistered(context, runtime)) {
        await mutateService(context, runtime, 'bootstrap');
      }
      await verifyState(context, activeBytes, registered, runtime);
    } catch (_) {
      throw startupError('STARTUP_REMOVAL_ROLLBACK_FAILED');
    }
    throw startupError('STARTUP_REMOVAL_FAILED');
  }
}

function parseFlagPairs(argv, allowed, required) {
  if (!Array.isArray(argv) || argv.length % 2 !== 0) throw startupError('STARTUP_ARGUMENTS_INVALID');
  const values = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || flag in values || !validateBoundedText(value)) {
      throw startupError('STARTUP_ARGUMENTS_INVALID');
    }
    values[flag] = value;
  }
  if ([...required].some(flag => !values[flag])) throw startupError('STARTUP_ARGUMENTS_INVALID');
  return values;
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length < 1) throw startupError('STARTUP_ACTION_INVALID');
  const action = argv[0];
  if (!['plan', 'inspect', 'install', 'replace', 'rollback', 'remove'].includes(action)) {
    throw startupError('STARTUP_ACTION_INVALID');
  }
  const flags = action === 'remove' ? ['--user-home', '--acknowledgement'] : [...COMMON_FLAGS, ...(ACKNOWLEDGEMENTS[action] ? ['--acknowledgement'] : [])];
  const values = parseFlagPairs(argv.slice(1), new Set(flags), new Set(flags));
  const options = action === 'remove' ? {
    userHome: values['--user-home'],
    acknowledgement: values['--acknowledgement']
  } : {
    repositoryRoot: values['--repository-root'],
    nodeExecutable: values['--node-executable'],
    dataFile: values['--data-file'],
    sourceFilesRoot: values['--source-files-root'],
    logFile: values['--log-file'],
    userHome: values['--user-home'],
    port: values['--port'],
    acknowledgement: values['--acknowledgement']
  };
  if (ACKNOWLEDGEMENTS[action]) requireAcknowledgement(action, options.acknowledgement);
  return Object.freeze({ action, options: Object.freeze(options) });
}

async function run(argv = process.argv.slice(2), overrides = {}) {
  const parsed = parseArguments(argv);
  const operations = {
    plan: planAgent,
    inspect: inspectAgent,
    install: installAgent,
    replace: replaceAgent,
    rollback: rollbackAgent,
    remove: removeAgent
  };
  const result = await operations[parsed.action](parsed.options, overrides);
  dependencies(overrides).stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`Startup resilience failed: ${String(error?.code || 'STARTUP_ERROR')}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ACKNOWLEDGEMENTS,
  AGENT_FILE_NAME,
  AGENT_LABEL,
  COMMON_FLAGS,
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
  startupError,
  validateConfiguration,
  validateManagedDefinition,
  validatePlistBytes,
  xmlEscape
};
