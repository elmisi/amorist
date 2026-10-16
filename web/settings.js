(function () {
  "use strict";
  const defaults = Object.freeze({highlightCurrentLine:false, highlightColor:'#eef1f4', baseFontSize:16, tableScale:0.875, codeScale:1});
  const colors = [['Gray','#eef1f4'],['Blue','#e8f2ff'],['Green','#e9f5ed'],['Yellow','#fff6d8'],['Pink','#faedf2']];
  const scales = [0.75,0.875,1,1.125,1.25,1.5];
  function valid(value) {
    return value && typeof value.highlightCurrentLine === 'boolean'
      && colors.some(([,color])=>color===value.highlightColor)
      && Number.isInteger(value.baseFontSize) && value.baseFontSize>=12 && value.baseFontSize<=24
      && scales.includes(value.tableScale) && scales.includes(value.codeScale);
  }
  function create({invoke, getEditor, warning}) {
    let current = {...defaults}, generation = 0, saving = false, preview = null;
    const button = document.getElementById('settings-button');
    const dialog = document.createElement('dialog');
    dialog.id = 'settings-dialog'; dialog.setAttribute('aria-labelledby','settings-title');
    dialog.innerHTML = `<form id="settings-form"><h2 id="settings-title">Settings</h2>
      <label><input name="highlightCurrentLine" type="checkbox"> Highlight current line</label>
      <label>Color <select name="highlightColor">${colors.map(([name,color])=>`<option value="${color}">${name}</option>`).join('')}</select></label>
      <label>Text size <input name="baseFontSize" type="number" min="12" max="24" step="1" required></label>
      <label>Tables <select name="tableScale">${scales.map(value=>`<option value="${value}">${value*100}%</option>`).join('')}</select></label>
      <label>Code <select name="codeScale">${scales.map(value=>`<option value="${value}">${value*100}%</option>`).join('')}</select></label>
      <div id="settings-line-preview" aria-label="Active line preview">Active line preview</div><div id="settings-preview" aria-label="Preview"></div><p id="settings-error" role="alert"></p>
      <div class="actions"><button type="button" data-settings="defaults">Defaults</button><button type="button" data-settings="cancel">Cancel</button><button type="submit">Save</button></div></form>`;
    document.body.append(dialog);
    const form = dialog.querySelector('form'), error = dialog.querySelector('#settings-error');
    const read = () => ({highlightCurrentLine:form.elements.highlightCurrentLine.checked,
      highlightColor:form.elements.highlightColor.value, baseFontSize:Number(form.elements.baseFontSize.value),
      tableScale:Number(form.elements.tableScale.value), codeScale:Number(form.elements.codeScale.value)});
    function updatePreview(value) {
      const line=dialog.querySelector('#settings-line-preview');
      line.style.backgroundColor=value.highlightCurrentLine?value.highlightColor:'transparent';
      line.style.fontSize=value.baseFontSize+'px';
      if(preview) preview.applySettings(value);
    }
    function fill(value) {
      form.elements.highlightCurrentLine.checked = value.highlightCurrentLine;
      for (const name of ['highlightColor','baseFontSize','tableScale','codeScale']) form.elements[name].value = value[name];
      updatePreview(value);
    }
    function apply(value) {
      if (!valid(value)) throw new Error('Invalid settings.');
      current = {...value};
      const editor = getEditor(); if (editor) editor.applySettings(current);
    }
    async function refresh() {
      if (saving || dialog.open) return;
      const token = ++generation;
      try {
        const loaded = await invoke('load_settings');
        if (token !== generation || saving || dialog.open) return;
        if (JSON.stringify(current)!==JSON.stringify(loaded.settings)) apply(loaded.settings);
        else { const editor=getEditor(); if(editor) editor.applySettings(current); }
        if (loaded.warning) warning(loaded.warning);
      } catch (e) { if (token===generation) warning(String(e.message||e)); }
    }
    button.hidden = false;
    button.addEventListener('click',()=> {
      if (saving || dialog.open) return;
      generation++; error.textContent=''; dialog.showModal();
      preview = window.AmoristEditor.create(dialog.querySelector('#settings-preview'), {
        value:'# Heading\nExample text\n\n| Item | Note |\n| --- | --- |\n| A | B |\n\n```\nexample code\n```', spellcheck:false});
      preview.toolbar.hidden=true; preview.surface.contentEditable='false'; preview.source.readOnly=true;
      fill(current);
    });
    form.addEventListener('input',()=> { const value=read(); if(valid(value)) updatePreview(value); });
    dialog.querySelector('[data-settings="defaults"]').addEventListener('click',()=>fill(defaults));
    dialog.querySelector('[data-settings="cancel"]').addEventListener('click',()=> { if(!saving) dialog.close(); });
    dialog.addEventListener('cancel',event=> { if(saving) event.preventDefault(); });
    dialog.addEventListener('close',()=> { if(preview) preview.destroy(); preview=null; refresh(); });
    form.addEventListener('submit',async event=> {
      event.preventDefault(); if(saving) return;
      const value=read(); if(!valid(value)) { error.textContent='Choose valid settings.'; return; }
      saving=true; generation++; error.textContent='';
      Array.from(form.elements).forEach(element=>element.disabled=true);
      try { const saved=await invoke('save_settings',{settings:value}); apply(saved); dialog.close(); }
      catch(e) { error.textContent=String(e.message||e); }
      finally { saving=false; Array.from(form.elements).forEach(element=>element.disabled=false); }
    });
    window.addEventListener('focus',refresh);
    refresh();
    return {refresh, applyTo:editor=>editor.applySettings(current), effective:()=>({...current})};
  }
  window.AmoristSettings = {create, defaults, valid};
})();
