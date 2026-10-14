'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { TauriEngine, discoverDriver } = require('./qa/lib/engine-tauri');

async function main() {
  assert.equal(process.platform, 'linux');
  const root = path.resolve(__dirname, '..');
  const build = cp.spawnSync('cargo', ['build', '--manifest-path', path.join(root, 'src-tauri/Cargo.toml')], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'amorist-changed-base-'));
  const file = path.join(scratch, 'changed λ.md');
  const disk = 'Externally updated document\r\n';
  fs.writeFileSync(file, disk);
  const sessionId = 's-changed-base-fixture';
  const directory = path.join(scratch, 'data', 'amorist', 'recovery-sessions', sessionId);
  fs.mkdirSync(directory, { recursive: true });
  const recordPath = path.join(directory, 'record.json');
  const record = JSON.stringify({ schemaVersion: 1, sessionId, path: file,
    savedSource: 'Original document\r\n', unsavedSource: 'Original document with unsaved work\r\n',
    revision: 1, boundaryState: null, legacyImport: false });
  fs.writeFileSync(recordPath, record);
  const engine = new TauriEngine(discoverDriver(), path.join(root, 'src-tauri/target/debug/amorist'),
    ['--', file], { ...process.env, XDG_DATA_HOME: path.join(scratch, 'data') });
  try {
    await engine.start();
    const deadline = Date.now() + 8000;
    let ready;
    do {
      ready = await engine.evaluate(`({dialog:!!document.querySelector('#recovery-dialog[open]'),loaded:!!document.querySelector('.amorist-source-line')})`);
      if (ready.dialog || ready.loaded) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    assert.equal(fs.readFileSync(file, 'utf8'), disk, 'Opening must preserve the externally updated file');
    assert.equal(fs.readFileSync(recordPath, 'utf8'), record, 'The old recovery copy must remain intact');
    assert.equal(ready.dialog, true, 'A recovery copy with a changed saved base must be offered explicitly instead of silently ignored');
    assert.match(await engine.evaluate(`document.querySelector('#recovery-dialog p').textContent`), /saved file changed.*does not merge/i);
    await engine.evaluate(`document.getElementById('recover-selected').click()`);
    const adoptedDeadline = Date.now() + 5000;
    while (!await engine.evaluate(`!!document.querySelector('.amorist-source-line')`)) {
      assert.ok(Date.now() < adoptedDeadline, 'Chosen recovery must be adopted');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(await engine.evaluate(`document.querySelector('.amorist-editor-surface').textContent`), /Original document with unsaved work/);
    assert.match(await engine.evaluate(`document.getElementById('notice').textContent`), /saved file changed/i);
    assert.equal(fs.readFileSync(file, 'utf8'), disk, 'Recovery must not overwrite the external changes');
    console.log('Changed-base startup recovery: explicit choice, warning, exact recovered text and unchanged file passed');
  } finally {
    await engine.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
