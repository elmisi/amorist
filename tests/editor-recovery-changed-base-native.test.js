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
  let engine = new TauriEngine(discoverDriver(), path.join(root, 'src-tauri/target/debug/amorist'),
    ['--', file], { ...process.env, XDG_DATA_HOME: path.join(scratch, 'data') });
  async function waitFor(expression) {
    const deadline = Date.now() + 6000;
    while (!await engine.evaluate(expression)) {
      assert.ok(Date.now() < deadline, 'Timed out: ' + expression);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  async function restartAtFile() {
    await engine.close();
    engine = new TauriEngine(discoverDriver(), path.join(root, 'src-tauri/target/debug/amorist'),
      ['--', file], { ...process.env, XDG_DATA_HOME: path.join(scratch, 'data') });
    await engine.start();
    await waitFor(`!!document.querySelector('#recovery-dialog[open]')`);
  }
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
    await engine.evaluate(`document.getElementById('recovery-dialog').dispatchEvent(new Event('cancel',{cancelable:true}))`);
    await waitFor(`!document.getElementById('editor').inert && !!document.querySelector('.amorist-source-line')`);
    assert.match(await engine.evaluate(`document.querySelector('.amorist-editor-surface').textContent`), /Externally updated document/);
    assert.equal(fs.readFileSync(file, 'utf8'), disk);
    assert.equal(fs.readFileSync(recordPath, 'utf8'), record);
    await restartAtFile();
    fs.writeFileSync(file, 'Changed during startup choice\r\n');
    await engine.evaluate(`document.getElementById('recover-selected').click()`);
    await waitFor(`document.getElementById('notice').textContent.includes('saved file changed')`);
    assert.equal(fs.readFileSync(file, 'utf8'), 'Changed during startup choice\r\n');
    assert.equal(fs.readFileSync(recordPath, 'utf8'), record);
    fs.writeFileSync(file, disk);
    await restartAtFile();
    console.log('Changed-base startup recovery: cancel preserves disk and copy; a new external change refuses recovery');
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
    await engine.close();
    engine = new TauriEngine(discoverDriver(), path.join(root, 'src-tauri/target/debug/amorist'),
      ['--new-document'], { ...process.env, XDG_DATA_HOME: path.join(scratch, 'data') });
    await engine.start();
    await waitFor(`!document.getElementById('editor').inert && !!document.querySelector('.amorist-editor-surface')`);
    await engine.evaluate(`window.__previousRecoveryEditor=document.querySelector('.amorist-editor-surface')`);
    async function openChoice() {
      await engine.evaluate(`(()=>{window.__TAURI__.dialog.open=()=>Promise.resolve(${JSON.stringify(file)});document.querySelector('[data-file-action="open"]').click();return true;})()`);
      await waitFor(`!!document.querySelector('#recovery-dialog[open]')`);
    }
    await openChoice();
    await engine.evaluate(`document.getElementById('recovery-cancel').click()`);
    await waitFor(`!document.querySelector('#recovery-dialog') && !document.getElementById('editor').inert`);
    assert.equal(await engine.evaluate(`document.querySelector('.amorist-editor-surface')===window.__previousRecoveryEditor`), true);
    assert.equal(fs.readFileSync(file, 'utf8'), disk);
    await openChoice();
    fs.writeFileSync(file, 'Changed again during selection\r\n');
    await engine.evaluate(`document.getElementById('recover-selected').click()`);
    await waitFor(`document.getElementById('notice').textContent.includes('changed during recovery selection')`);
    assert.equal(await engine.evaluate(`document.querySelector('.amorist-editor-surface')===window.__previousRecoveryEditor`), true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'Changed again during selection\r\n');
    assert.equal(fs.readFileSync(recordPath, 'utf8'), record);
    fs.writeFileSync(file, disk);
    await openChoice();
    await engine.evaluate(`document.getElementById('recover-selected').click()`);
    await waitFor(`document.querySelector('.amorist-editor-surface').textContent.includes('Original document with unsaved work')`);
    assert.equal(fs.readFileSync(file, 'utf8'), disk);
    console.log('Changed-base Open recovery: cancel, external race refusal and explicit recovery passed');
    await engine.evaluate(`document.getElementById('save-button').click()`);
    const recoveredText = 'Original document with unsaved work\r\n';
    const saveDeadline = Date.now() + 6000;
    while (fs.readFileSync(file, 'utf8') !== recoveredText || fs.existsSync(recordPath)) {
      assert.ok(Date.now() < saveDeadline, 'Explicit Save must commit recovery and remove only its record');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await waitFor(`!document.getElementById('reload-button').disabled`);
    await engine.close();
    engine = new TauriEngine(discoverDriver(), path.join(root, 'src-tauri/target/debug/amorist'),
      ['--', file], { ...process.env, XDG_DATA_HOME: path.join(scratch, 'data') });
    await engine.start();
    await waitFor(`!document.getElementById('editor').inert && !!document.querySelector('.amorist-source-line')`);
    assert.match(await engine.evaluate(`document.querySelector('.amorist-editor-surface').textContent`), /Original document with unsaved work/);
    assert.equal(await engine.evaluate(`document.getElementById('notice').hidden`), true);
    assert.equal(fs.readFileSync(file, 'utf8'), recoveredText);
    console.log('Changed-base recovery: explicit Save preserves CRLF and restart opens the saved version without recovery');
  } finally {
    await engine.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
