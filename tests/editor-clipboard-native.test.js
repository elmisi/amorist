'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const {TauriEngine, discoverDriver} = require('./qa/lib/engine-tauri');
const {closeOwnedNative} = require('./qa/lib/close-owned-native');

async function main() {
  assert.equal(process.platform, 'linux');
  const application = process.env.AMORIST_QA_APPLICATION || path.resolve(__dirname, '../src-tauri/target/debug/amorist');
  assert.ok(fs.existsSync(application), 'Build Amorist or set AMORIST_QA_APPLICATION');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'amorist-clipboard-native-'));
  const directories = ['origin', 'destination'].map(name => path.join(scratch, name));
  directories.forEach(directory => fs.mkdirSync(directory));
  const files = ['copy λ.md', 'paste 🧪.md'].map((name,index) => path.join(directories[index], name));
  const originals = ['before **bold** after\r\n\r\n![Picture](picture%20%CE%BB.svg)\r\n', 'target: '];
  fs.writeFileSync(path.join(directories[0], 'picture λ.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="red"/></svg>');
  files.forEach((file, index) => fs.writeFileSync(file, originals[index]));
  const environment = {...process.env, XDG_DATA_HOME: path.join(scratch, 'data'), XDG_CONFIG_HOME: path.join(scratch, 'config'), XDG_CACHE_HOME: path.join(scratch, 'cache')};
  const engines = files.map(file => new TauriEngine(discoverDriver(), application, ['--', file], environment));
  async function waitFor(engine, expression) {
    const deadline = Date.now() + 8000;
    while (!await engine.evaluate(expression)) {
      assert.ok(Date.now() < deadline, 'Native clipboard timeout: ' + expression);
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
  async function focus(index) {
    const result = cp.spawnSync('python3', [path.join(__dirname, 'qa/lib/focus-x11.py'), 'amorist — ' + path.basename(files[index])], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    await waitFor(engines[index], 'document.hasFocus()');
  }
  async function source(index) {
    await engines[index].evaluate(`document.querySelector('[data-action="source"]').click()`);
    return engines[index].evaluate(`document.querySelector('.amorist-editor-source').value`);
  }
  try {
    for (const engine of engines) {
      await engine.start();
      await waitFor(engine, `!!document.querySelector('.amorist-editor-source')&&!document.getElementById('editor').inert`);
      await engine.evaluate(`(()=>{window.__nativePastes=[];document.getElementById('editor').addEventListener('paste',event=>window.__nativePastes.push({trusted:event.isTrusted,plain:event.clipboardData.getData('text/plain'),types:Array.from(event.clipboardData.types)}),true);return true;})()`);
    }
    await focus(0);
    await engines[0].evaluate(`(()=>{const bold=document.querySelector('.amorist-editor-surface strong'),range=document.createRange();range.selectNodeContents(bold);const selection=window.getSelection();document.querySelector('.amorist-editor-surface').focus();selection.removeAllRanges();selection.addRange(range);return true;})()`);
    await engines[0].sendKeys([{key:'c',ctrl:true}]);
    await focus(1);
    await engines[1].evaluate(`(()=>{const surface=document.querySelector('.amorist-editor-surface'),range=document.createRange();range.selectNodeContents(surface);range.collapse(false);surface.focus();const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return true;})()`);
    await engines[1].sendKeys([{key:'v',ctrl:true}]);
    await waitFor(engines[1], 'window.__nativePastes.length===1');
    const paste = await engines[1].evaluate('window.__nativePastes[0]');
    assert.equal(paste.trusted, true);
    assert.equal(paste.plain, '**bold**');
    assert.equal(await source(1), 'target: **bold**');
    await engines[1].evaluate(`(()=>{const source=document.querySelector('.amorist-editor-source');source.focus();source.setSelectionRange(source.value.length,source.value.length);return true;})()`);
    await engines[1].sendKeys([{key:'v',ctrl:true,shift:true}]);
    await waitFor(engines[1], 'window.__nativePastes.length===2');
    assert.equal(await engines[1].evaluate(`document.querySelector('.amorist-editor-source').value`), 'target: **bold****bold**');
    await focus(0);
    await engines[0].evaluate(`(()=>{const bold=document.querySelector('.amorist-editor-surface strong'),range=document.createRange();range.selectNodeContents(bold);document.querySelector('.amorist-editor-surface').focus();const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return true;})()`);
    await engines[0].sendKeys([{key:'x',ctrl:true}]);
    await waitFor(engines[0], `!document.querySelector('.amorist-editor-surface strong')`);
    await engines[0].sendKeys([{key:'z',ctrl:true}]);
    await waitFor(engines[0], `document.querySelector('.amorist-editor-surface strong')?.textContent==='bold'`);
    await waitFor(engines[0], `document.querySelector('.amorist-image-atom img')?.naturalWidth===32`);
    await engines[0].evaluate(`(()=>{const atom=document.querySelector('.amorist-image-atom'),range=document.createRange();range.selectNode(atom);document.querySelector('.amorist-editor-surface').focus();const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return true;})()`);
    await engines[0].sendKeys([{key:'c',ctrl:true}]);
    await focus(1);
    await engines[1].evaluate(`document.querySelector('[data-action="source"]').click()`);
    await engines[1].evaluate(`(()=>{const surface=document.querySelector('.amorist-editor-surface'),range=document.createRange();range.selectNodeContents(surface);range.collapse(false);surface.focus();const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return true;})()`);
    await engines[1].sendKeys([{key:'v',ctrl:true}]);
    await waitFor(engines[1], 'window.__nativePastes.length===3');
    await waitFor(engines[1], `document.querySelector('.amorist-image-atom img')?.naturalWidth===32`);
    assert.equal(await engines[1].evaluate('window.__nativePastes[2].trusted'), true);
    await focus(0);
    await engines[0].evaluate(`(()=>{document.addEventListener('copy',event=>event.clipboardData.clearData('application/x-amorist-markdown+json'),{once:true});const atom=document.querySelector('.amorist-image-atom'),range=document.createRange();range.selectNode(atom);document.querySelector('.amorist-editor-surface').focus();const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return true;})()`);
    await engines[0].sendKeys([{key:'c',ctrl:true}]);
    await focus(1);
    await engines[1].sendKeys([{key:'v',ctrl:true}]);
    await waitFor(engines[1], 'window.__nativePastes.length===4');
    await waitFor(engines[1], `document.querySelectorAll('.amorist-image-atom img').length===2&&Array.from(document.querySelectorAll('.amorist-image-atom img')).every(image=>image.naturalWidth===32)`);
    const fallback = await engines[1].evaluate('window.__nativePastes[3]');
    assert.equal(fallback.trusted, true);
    assert.ok(!fallback.types.includes('application/x-amorist-markdown+json'), 'Fallback must use public system clipboard formats');
    assert.ok(fallback.types.includes('text/html'));
    await focus(0);
    assert.equal(await source(0), originals[0].replace(/\r\n/g, '\n'));
    files.forEach((file,index) => assert.equal(fs.readFileSync(file,'utf8'), originals[index]));
    console.log(JSON.stringify({result:'pass',crossProcessVisualPaste:true,sourcePlainPaste:true,visualCutUndo:true,relativeImageAcrossDirectories:true,relativeImageHtmlFallback:true,trustedEvents:true,clipboardTypes:paste.types,fallbackTypes:fallback.types,originalFilesUnchanged:true}));
  } finally {
    for (const engine of engines.reverse()) await closeOwnedNative(engine);
    fs.rmSync(scratch, {recursive:true,force:true});
  }
}

main().catch(error => {console.error(error.stack);process.exitCode=1;});
