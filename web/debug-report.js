(function () {
  function snapshot(state) {
    const editor = state.editor;
    const pane = editor.mode === "source" ? editor.source : editor.surface;
    const bounds = pane.getBoundingClientRect();
    const style = window.getComputedStyle(pane);
    const blocks = editor.mode === "source" ? [] : Array.from(pane.children).filter(function (node) {
      const rect = node.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right;
    }).map(function (node) {
      const rect = node.getBoundingClientRect();
      return { text: node.innerText, html: node.outerHTML, sourceLine: node.dataset.line, top: rect.top, left: rect.left,
        width: rect.width, height: rect.height, scrollLeft: node.scrollLeft, scrollWidth: node.scrollWidth };
    });
    const selection = editor.selectionRaw();
    return {
      schemaVersion: 1, capturedAt: new Date().toISOString(), mode: editor.mode,
      settings: {...(editor.settings || window.AmoristSettings?.defaults || {highlightCurrentLine:false,highlightColor:"#eef1f4",baseFontSize:16,tableScale:.875,codeScale:1})},
      markdown: editor.getValue(), savedMarkdown: state.savedMarkdown, dirty: state.dirty,
      selection: selection, selectedMarkdown: editor.getValue().slice(selection.start, selection.end),
      renderedHtml: editor.surface.innerHTML, visibleBlocks: blocks,
      sourceDisplayText: editor.mode === "source" ? editor.source.value : null,
      viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio,
        editor: { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height },
        scrollTop: pane.scrollTop, scrollLeft: pane.scrollLeft, scrollHeight: pane.scrollHeight, scrollWidth: pane.scrollWidth },
      userAgent: navigator.userAgent,
      editorStyle: { fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight,
        paddingTop: style.paddingTop, paddingLeft: style.paddingLeft, whiteSpace: style.whiteSpace },
      notice: document.getElementById("notice").textContent,
    };
  }

  async function init(getState) {
    const invoke = window.__TAURI__.core.invoke;
    const button = document.getElementById("report-button");
    try {
      if (!(await invoke("debug_enabled"))) return;
    } catch (error) { console.error("Problem reporting unavailable:", error); return; }
    button.hidden = false;
    const dialog = document.getElementById("report-dialog");
    const note = document.getElementById("report-note");
    const submit = document.getElementById("report-submit");
    const cancel = document.getElementById("report-cancel");
    const errorLabel = document.getElementById("report-error");
    let report = null;
    let pending = null;
    button.addEventListener("pointerdown", function () {
      pending = getState().editor ? snapshot(getState()) : null;
    });
    button.addEventListener("click", function () {
      if (!getState().editor) return;
      report = pending || snapshot(getState());
      pending = null;
      note.value = "";
      errorLabel.textContent = "";
      dialog.showModal();
      note.focus();
    });
    cancel.addEventListener("click", function () { dialog.close(); });
    document.getElementById("report-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!note.value.trim()) { note.focus(); return; }
      submit.disabled = true;
      cancel.disabled = true;
      try {
        const path = await invoke("report_problem", { report: Object.assign({}, report, { note: note.value.trim() }) });
        dialog.close();
        document.getElementById("status").textContent = "Segnalazione salvata: " + path;
      } catch (error) {
        errorLabel.textContent = typeof error === "string" ? error : error.message;
      } finally { submit.disabled = false; cancel.disabled = false; }
    });
    dialog.addEventListener("cancel", function (event) { if (submit.disabled) event.preventDefault(); });
  }
  window.AmoristDebugReport = { init: init };
})();
