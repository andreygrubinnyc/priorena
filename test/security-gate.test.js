'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { isBinary, scanBuffer, scanPath, scanText } = require('../scripts/security/repository-scan');

test('secure commit gate rejects private runtime paths and sensitive file types', () => {
  assert.ok(scanPath('.env').length);
  assert.ok(scanPath('uploads/private.txt').length);
  assert.ok(scanPath('backups/recovery.json').length);
  assert.ok(scanPath('keys/service.pem').length);
  assert.deepEqual(scanPath('.env.example'), []);
  assert.deepEqual(scanPath('public/app.js'), []);
});

test('secure commit gate detects credentials and private workspace markers', () => {
  const providerCredential = 'OPENAI_API_' + 'KEY=live-value-that-must-not-ship';
  const privatePath = '/' + 'Users/example/private/workspace';
  const operationalTicket = 'DE' + 'LI-1234 operational ticket';
  const operationalProgram = 'Operational program FE' + 'RC760';
  const nonEnglishText = String.fromCodePoint(0x421, 0x435, 0x43a, 0x440, 0x435, 0x442);
  assert.ok(scanText('fixture.txt', providerCredential).length);
  assert.ok(scanText('fixture.txt', privatePath).length);
  assert.ok(scanText('fixture.txt', operationalTicket).length);
  assert.ok(scanText('fixture.txt', operationalProgram).length);
  assert.ok(scanText('fixture.txt', nonEnglishText).length);
  const emptyExampleKey = ['OPENAI_API_' + 'KEY=', 'OPENAI_MODEL=example'].join('\n');
  assert.deepEqual(scanText('.env.example', emptyExampleKey), []);
  assert.deepEqual(scanText('fixture.txt', 'Fictional DEMO-101 example'), []);
});

test('secure commit gate distinguishes approved assets from unknown binary files', () => {
  const binary = Buffer.from([0, 1, 2, 3]);
  assert.equal(isBinary(binary), true);
  assert.deepEqual(scanBuffer('showcase/example.png', binary), []);
  assert.ok(scanBuffer('showcase/example.bin', binary).some(value => value.includes('unapproved binary')));
});
