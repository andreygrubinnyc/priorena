'use strict';

const assert = require('node:assert/strict');

const { startTargetServer } = require('../../target-server/start');
const { parseFlagPairs } = require('./safety');

async function fetchJson(origin, route) {
  const response = await fetch(`${origin}${route}`);
  assert.equal(response.status, 200, `${route} must return 200`);
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'none'/);
  return response.json();
}

async function smokeStartedTarget(started) {
  const origin = `http://127.0.0.1:${started.server.address().port}`;
  const root = await fetch(origin, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/target/');
  const ui = await fetch(`${origin}/target/`);
  assert.equal(ui.status, 200);
  const markup = await ui.text();
  for (const label of ['Organization', 'Workspace', 'Portfolio', 'Today', 'Briefings', 'Settings']) assert.match(markup, new RegExp(label));
  const clientResponse = await fetch(`${origin}/target/app.js`);
  assert.equal(clientResponse.status, 200);
  assert.match(await clientResponse.text(), /Data & Privacy/);
  const cssResponse = await fetch(`${origin}/target/styles.css`);
  assert.equal(cssResponse.status, 200);
  const css = await cssResponse.text();
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
  const organizations = await fetchJson(origin, '/api/v2/organizations');
  let workspaceCount = 0;
  for (const organization of organizations.organizations) {
    await fetchJson(origin, `/api/v2/organizations/${organization.id}/portfolio`);
    const workspaces = await fetchJson(origin, `/api/v2/organizations/${organization.id}/workspaces`);
    workspaceCount += workspaces.workspaces.length;
    for (const workspace of workspaces.workspaces) {
      await fetchJson(origin, `/api/v2/organizations/${organization.id}/workspaces/${workspace.id}/today`);
    }
  }
  return Object.freeze({
    status: 'passed',
    host: '127.0.0.1',
    organizationCount: organizations.organizations.length,
    workspaceCount,
    desktopTabletMobileCss: 'present',
    writesPerformed: 0
  });
}

async function stopStartedTarget(started, outcome) {
  await new Promise((resolve, reject) => started.server.close(error => error ? reject(error) : resolve()));
  try {
    started.logger.info('smoke', { status: outcome });
  } finally {
    started.logger.close();
  }
}

async function smokeTarget(options) {
  const started = await startTargetServer({
    targetDataFile: options.targetDataFile,
    sourceFilesRoot: options.sourceFilesRoot,
    logFile: options.logFile,
    port: 0,
    repositoryRoot: options.repositoryRoot
  });
  let outcome = 'failure';
  try {
    const result = await smokeStartedTarget(started);
    outcome = 'success';
    return result;
  } finally {
    await stopStartedTarget(started, outcome);
  }
}

async function run(argv = process.argv.slice(2)) {
  const args = parseFlagPairs(argv, new Set(['--data-file', '--source-files-root', '--log-file']));
  const result = await smokeTarget({
    targetDataFile: args['--data-file'],
    sourceFilesRoot: args['--source-files-root'],
    logFile: args['--log-file']
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`Target smoke failed: ${String(error?.code || error?.name || 'SMOKE_ERROR')}\n`);
    process.exitCode = 1;
  });
}

module.exports = { fetchJson, run, smokeStartedTarget, smokeTarget, stopStartedTarget };
