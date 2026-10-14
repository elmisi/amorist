(function () {
  function snapshot(state, capturedSelection) {
    const editor = state.editor;
    const pane = editor.mode === "source" ? editor.source : editor.surface;
    let scroller=pane;
    if(editor.mode!=="source") {
      let node=pane;
      while(node) {const overflow=getComputedStyle(node).overflowY;if(/auto|scroll/.test(overflow) && node.scrollHeight>node.clientHeight){scroller=node;break;}node=node.parentElement;}
    }
    const paneBounds=pane.getBoundingClientRect(),clip=scroller.getBoundingClientRect();
    const bounds={top:Math.max(paneBounds.top,clip.top,0),left:Math.max(paneBounds.left,clip.left,0),
      bottom:Math.min(paneBounds.bottom,clip.bottom,window.innerHeight),right:Math.min(paneBounds.right,clip.right,window.innerWidth)};
    bounds.width=Math.max(0,bounds.right-bounds.left);bounds.height=Math.max(0,bounds.bottom-bounds.top);
    const style = window.getComputedStyle(pane);
    const blocks = editor.mode === "source" ? [] : Array.from(pane.children).filter(function (node) {
      const rect = node.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right;
    }).map(function (node) {
      const rect = node.getBoundingClientRect();
      const rows=node.matches('.amorist-source-line')?[node]:Array.from(node.querySelectorAll('.amorist-source-line'));
      const spans=rows.map(row=>editor.lineDescriptors[Number(row.dataset.line)]).filter(Boolean);
      return {rawStart:spans.length?Math.min(...spans.map(line=>line.start)):null,rawEnd:spans.length?Math.max(...spans.map(line=>line.end)):null, text: node.innerText, html: node.outerHTML, sourceLine: node.dataset.line, top: rect.top, left: rect.left,
        width: rect.width, height: rect.height, scrollLeft: node.scrollLeft, scrollWidth: node.scrollWidth };
    });
    const selection = capturedSelection || {...editor.selectionRaw(),direction:editor.selectionDirection()};
    return {
      schemaVersion: 2, filePath:state.documentPath || null, contextId:state.contextId, boundaryState:editor.model.boundaryState(), capturedAt: new Date().toISOString(), mode: editor.mode,
      settings: {...(editor.settings || window.AmoristSettings?.defaults || {highlightCurrentLine:false,highlightColor:"#eef1f4",baseFontSize:16,tableScale:.875,codeScale:1})},
      markdown: editor.getValue(), savedMarkdown: state.savedMarkdown, dirty: state.dirty,
      selection: selection, selectedMarkdown: editor.getValue().slice(selection.start, selection.end),
      renderedHtml: editor.surface.innerHTML, visibleBlocks: blocks,
      sourceDisplayText: editor.mode === "source" ? editor.source.value : null,
      viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio,
        editor: { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height },
        scrollTop: scroller.scrollTop, scrollLeft: scroller.scrollLeft, scrollHeight: scroller.scrollHeight, scrollWidth: scroller.scrollWidth },
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
    const logPath = await invoke("get_report_path");
    document.getElementById("report-log-path").textContent="Report log: "+logPath;
    button.hidden = false;
    const dialog = document.getElementById("report-dialog");
    const note = document.getElementById("report-note");
    const submit = document.getElementById("report-submit");
    const cancel = document.getElementById("report-cancel");
    const errorLabel = document.getElementById("report-error");
    let report = null;
    let pending = null;
    let lastSelection = null;
    document.addEventListener("selectionchange",function() {
      const state=getState(),selection=window.getSelection();
      if(state.editor && (state.editor.mode==="source" && document.activeElement===state.editor.source
        || selection?.rangeCount && state.editor.surface.contains(selection.anchorNode) && state.editor.surface.contains(selection.focusNode))) {
        lastSelection={editor:state.editor,value:{...state.editor.selectionRaw(),direction:state.editor.selectionDirection()}};
      }
    });
    document.addEventListener("keydown",function(event) {
      const state=getState();
      if(event.key==="Tab" && state.editor?.root.contains(document.activeElement)) pending=snapshot(state,lastSelection?.editor===state.editor?lastSelection.value:null);
    },true);
    button.addEventListener("pointerdown", function () {
      pending = getState().editor ? snapshot(getState()) : null;
    });
    document.addEventListener("focusout", function(event) {
      const state=getState();
      if(event.relatedTarget===button && state.editor?.root.contains(event.target)) pending=snapshot(state,lastSelection?.editor===state.editor?lastSelection.value:null);
    },true);
    button.addEventListener("keydown",function(event) {
      if((event.key==="Enter"||event.key===" ") && !pending && getState().editor) pending=snapshot(getState());
    });
    button.addEventListener("click", function () {
      if (!getState().editor) return;
      report = pending && pending.contextId===getState().contextId && pending.markdown===getState().editor.getValue()
        ? pending : snapshot(getState());
      pending = null;
      note.value = "";
      errorLabel.textContent = "";
      submit.textContent = "Save report";
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
        document.getElementById("status").textContent = "Report saved: " + path;
      } catch (error) {
        submit.textContent="Retry";
        errorLabel.textContent = typeof error === "string" ? error : error.message;
      } finally { submit.disabled = false; cancel.disabled = false; }
    });
    dialog.addEventListener("cancel", function (event) { if (submit.disabled) event.preventDefault(); });
  }
  window.AmoristDebugReport = { init: init };
})();
