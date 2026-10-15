'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const {createRequire} = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const {WebDriverEngine} = require('./qa/lib/engine-webdriver');

test('an unresponsive WebDriver fails with the request endpoint', async () => {
  const server = http.createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const engine = new WebDriverEngine('unused');
    engine.port = server.address().port;
    engine.requestTimeoutMs = 30;
    await assert.rejects(engine.request('POST', '/session'), /POST \/session timed out/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('macOS CDP shortcuts include editing commands without extra key presses', async () => {
  const filename = path.resolve(__dirname, 'qa/lib/engine-chromium.js');
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: createRequire(filename), module, exports: module.exports,
    process: {platform: 'darwin', env: {}}, Buffer, setTimeout, clearTimeout,
  }, {filename});
  const engine = new module.exports.ChromiumEngine('unused');
  const events = [];
  engine.socket = {send: async (method, event) => events.push({method, ...event})};
  for (const [key, shift, command] of [['a',false,'selectAll'], ['c',false,'copy'], ['v',false,'paste'], ['v',true,'pasteAndMatchStyle']]) {
    events.length = 0;
    await engine.sendKeys([{key, meta:true, shift}]);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'rawKeyDown');
    assert.equal(events[0].commands[0], command);
    assert.equal(events[1].type, 'keyUp');
  }
});

test('Shift chords send the resulting uppercase character to WebDriver', async () => {
  const engine=new WebDriverEngine('unused');engine.sessionId='test';
  let sent;engine.request=async (method,endpoint,body)=>{sent=body;};
  await engine.sendKeys([{key:'v',shift:true,meta:true,alt:true}]);
  const letters=sent.actions[0].actions.filter(action=>action.value==='V');
  assert.deepEqual(letters.map(action=>action.type),['keyDown','keyUp']);
});
