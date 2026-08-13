(function () {
  const Internals = window.AmoristInternals || {};
  const DocumentModel = Internals.DocumentModel;
  const TransactionJournal = Internals.TransactionJournal;
  const HtmlToMarkdown = Internals.HtmlToMarkdown;
  if (!HtmlToMarkdown) throw new Error("AmoristHtmlToMarkdown must load before AmoristEditor.");

  function create(container, options) { return new AmoristEditor(container, options || {}); }

  function sourceLines(source) {
    const lines = [];
    let start = 0;
    const re = /\r\n|\r|\n/g;
    let match;
    while ((match = re.exec(source))) {
      lines.push({ start, end: match.index, ending: match[0] });
      start = re.lastIndex;
    }
    lines.push({ start, end: source.length, ending: "" });
    return lines;
  }

  // A projection line has an exact source range.  We only hide syntactic
  // prefixes, never rebuild their body; unsupported input stays readable.
  function projectionLine(raw) {
    let prefix = 0;
    let text = raw;
    const heading = text.match(/^ {0,3}#{1,6}\s+/);
    const list = text.match(/^(\s*)(?:[-*+]|\d+[.)])\s+/);
    const quote = text.match(/^>\s?/);
    if (heading) prefix = heading[0].length;
    else if (list) {
      prefix = list[0].length;
      const task = text.slice(prefix).match(/^\[[ xX]\]\s+/);
      if (task) prefix += task[0].length;
    } else if (quote) prefix = quote[0].length;
    return { prefix, text: text.slice(prefix) };
  }

  class AmoristEditor {
    constructor(container, options) {
      if (!DocumentModel || !TransactionJournal) {
        throw new Error("AmoristDocumentModel must load before creating AmoristEditor.");
      }
      this.container = container;
      this.options = options;
      this.model = new DocumentModel(options.value || "");
      this.history = new TransactionJournal(100);
      this.mode = "wysiwyg";
      this.isRendering = false;
      this.root = document.createElement("div");
      this.root.className = "amorist-editor";
      this.toolbar = document.createElement("div");
      this.toolbar.className = "amorist-editor-toolbar";
      this.surface = document.createElement("div");
      this.surface.className = "amorist-editor-surface";
      this.surface.contentEditable = "true";
      this.surface.spellcheck = options.spellcheck !== false;
      this.source = document.createElement("textarea");
      this.source.className = "amorist-editor-source";
      this.source.hidden = true;
      this.source.spellcheck = false;
      this.findBar = document.createElement("div");
      this.findBar.className = "amorist-editor-findbar";
      this.findBar.hidden = true;
      this.findInput = document.createElement("input");
      this.findInput.type = "text";
      this.findInput.placeholder = "Find...";
      this.findCount = document.createElement("span");
      this.findBar.append(this.findInput, this.findCount);
      this.root.append(this.toolbar, this.findBar, this.surface, this.source);
      container.replaceChildren(this.root);
      this.buildToolbar();
      this.bind();
      this.render();
    }

    buildToolbar() {
      const actions = [["bold", "B"], ["italic", "I"], ["code", "</>"], ["link", "↗"],
        ["h1", "H1"], ["h2", "H2"], ["h3", "H3"], ["bullet", "•"],
        ["ordered", "1."], ["task", "☐"], ["quote", "❝"], ["codeblock", "{ }"], ["source", "Source"]];
      actions.forEach(([action, label]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.action = action;
        button.textContent = label;
        button.addEventListener("click", () => this.runAction(action));
        this.toolbar.append(button);
      });
    }

    bind() {
      this.surface.addEventListener("beforeinput", (event) => this.handleBeforeInput(event));
      this.surface.addEventListener("paste", (event) => this.handlePaste(event));
      this.surface.addEventListener("keydown", (event) => this.handleKeyDown(event));
      this.surface.addEventListener("click", (event) => this.handleClick(event));
      this.source.addEventListener("input", () => this.handleSourceInput());
      this.source.addEventListener("keydown", (event) => this.handleKeyDown(event));
      this.findInput.addEventListener("input", () => this.performFind());
    }

    destroy() { this.container.replaceChildren(); }
    focus() { (this.mode === "source" ? this.source : this.surface).focus(); }
    getMarkdown() { return this.model.source; }
    getValue() { return this.model.source; }

    setMarkdown(markdown, options) {
      this.model = new DocumentModel(markdown || "");
      this.history = new TransactionJournal(100);
      this.render();
      if (!options || !options.silent) this.emitChange();
    }

    render(rawSelection) {
      this.isRendering = true;
      this.source.value = this.model.display;
      this.surface.replaceChildren();
      sourceLines(this.model.source).forEach((line, index) => {
        const raw = this.model.source.slice(line.start, line.end);
        const projection = projectionLine(raw);
        const row = document.createElement("span");
        row.className = "amorist-source-line";
        row.dataset.sourceStart = String(line.start);
        row.dataset.sourceEnd = String(line.end);
        row.dataset.prefix = String(projection.prefix);
        row.dataset.line = String(index);
        row.dataset.endingLength = String(line.ending.length);
        // Empty text nodes give a measurable, editable caret on blank lines.
        row.textContent = (projection.text || "\u200b") + (line.ending ? "\n" : "");
        this.surface.append(row);
      });
      this.isRendering = false;
      if (rawSelection) this.setSurfaceSelection(rawSelection.start, rawSelection.end);
    }

    selectionRaw() {
      if (this.mode === "source") return { start: this.model.rawOffset(this.source.selectionStart), end: this.model.rawOffset(this.source.selectionEnd) };
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return { start: 0, end: 0 };
      const range = selection.getRangeAt(0);
      return { start: this.rawPoint(range.startContainer, range.startOffset), end: this.rawPoint(range.endContainer, range.endOffset) };
    }

    rawPoint(node, offset) {
      let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      while (element && !element.classList.contains("amorist-source-line")) element = element.parentElement;
      if (!element) return this.model.source.length;
      const start = Number(element.dataset.sourceStart);
      const prefix = Number(element.dataset.prefix);
      const allText = element.textContent || "";
      const text = allText.replace(/\n$/, "") === "\u200b" ? "" : allText.replace(/\n$/, "");
      let visibleOffset = offset;
      if (node.nodeType === Node.ELEMENT_NODE) visibleOffset = offset ? text.length : 0;
      if (visibleOffset > text.length) return Number(element.dataset.sourceEnd) + Number(element.dataset.endingLength);
      return Math.max(start + prefix, Math.min(start + prefix + visibleOffset, start + prefix + text.length));
    }

    setSurfaceSelection(start, end) {
      const point = (rawOffset) => {
        const rows = Array.from(this.surface.querySelectorAll(".amorist-source-line"));
        const row = rows.find((candidate) => rawOffset >= Number(candidate.dataset.sourceStart) && rawOffset <= Number(candidate.dataset.sourceEnd)) || rows[rows.length - 1];
        const rowStart = Number(row.dataset.sourceStart);
        const prefix = Number(row.dataset.prefix);
        const allText = row.textContent || "";
        const text = allText.replace(/\n$/, "") === "\u200b" ? "" : allText.replace(/\n$/, "");
        return { node: row.firstChild, offset: Math.max(0, Math.min(text.length, rawOffset - rowStart - prefix)) };
      };
      const from = point(start); const to = point(end);
      const range = document.createRange();
      range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      this.surface.focus();
    }

    apply(start, end, replacement, gesture) {
      const entry = this.model.transaction(start, end, replacement, gesture);
      this.history.push(entry);
      const caret = start + replacement.length;
      this.render({ start: caret, end: caret });
      this.emitChange();
    }

    handleBeforeInput(event) {
      if (this.isRendering || this.mode !== "wysiwyg") return;
      const selection = this.selectionRaw();
      const type = event.inputType;
      if (type === "insertText" || type === "insertCompositionText") {
        event.preventDefault(); this.apply(selection.start, selection.end, event.data || "", "insert"); return;
      }
      if (type === "insertParagraph" || type === "insertLineBreak") {
        // Browser editing semantics and REQ-B3 define Enter as one bare LF.
        // Existing terminators are preserved verbatim; only this new boundary is LF.
        event.preventDefault(); this.apply(selection.start, selection.end, "\n", "enter"); return;
      }
      if (type === "deleteContentBackward") {
        event.preventDefault(); const start = selection.start === selection.end ? previousCodeUnit(this.model.source, selection.start) : selection.start;
        this.apply(start, selection.end, "", "backspace"); return;
      }
      if (type === "deleteContentForward") {
        event.preventDefault(); const end = selection.start === selection.end ? nextCodeUnit(this.model.source, selection.end) : selection.end;
        this.apply(selection.start, end, "", "delete");
      }
    }

    handleKeyDown(event) {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.shiftKey && event.key.toLowerCase() === "z") { event.preventDefault(); this.undo(); return; }
      if (mod && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) { event.preventDefault(); this.redo(); return; }
      if (mod && event.key.toLowerCase() === "f") { event.preventDefault(); this.openFindBar(); return; }
      if (this.mode === "wysiwyg" && event.key === "Tab") {
        event.preventDefault(); const sel = this.selectionRaw(); const line = this.model.source.lastIndexOf("\n", sel.start - 1) + 1;
        this.apply(line, line, event.shiftKey ? "" : "  ", event.shiftKey ? "outdent" : "indent");
      }
    }

    handleSourceInput() {
      // textarea has already converted CRLF to LF.  Map just the display range
      // it changed back to raw rather than accepting its value as authority.
      const old = this.model.display; const next = this.source.value;
      let start = 0; while (start < old.length && old[start] === next[start]) start += 1;
      let oldEnd = old.length; let nextEnd = next.length;
      while (oldEnd > start && nextEnd > start && old[oldEnd - 1] === next[nextEnd - 1]) { oldEnd--; nextEnd--; }
      const rawStart = this.model.rawOffset(start); const rawEnd = this.model.rawOffset(oldEnd);
      const replacement = next.slice(start, nextEnd).replace(/\n/g, this.model.lineEndingAt(rawStart));
      this.apply(rawStart, rawEnd, replacement, "source");
      const caret = this.model.displayOffset(rawStart + replacement.length);
      this.source.focus(); this.source.setSelectionRange(caret, caret);
    }

    handlePaste(event) {
      const clipboard = event.clipboardData; if (!clipboard) return;
      event.preventDefault();
      const selection = this.selectionRaw();
      const raw = this.model.source;
      const inCode = raw.lastIndexOf("`", selection.start) > raw.lastIndexOf("\n", selection.start);
      const html = clipboard.getData("text/html");
      let replacement = inCode ? clipboard.getData("text/plain") : (html ? HtmlToMarkdown.convert(html) : clipboard.getData("text/plain"));
      replacement = String(replacement || "").replace(/\r\n|\r|\n/g, this.model.lineEndingAt(selection.start));
      this.apply(selection.start, selection.end, replacement, "paste");
    }

    runAction(action) {
      if (action === "source") return this.mode === "source" ? this.showWysiwygMode() : this.showSourceMode();
      if (this.mode === "source") this.showWysiwygMode();
      const sel = this.selectionRaw();
      const selected = this.model.source.slice(sel.start, sel.end);
      const wraps = { bold: ["**", "**"], italic: ["*", "*"], code: ["`", "`"] };
      if (wraps[action] && selected) this.apply(sel.start, sel.end, wraps[action][0] + selected + wraps[action][1], action);
      else if (/^h[1-6]$/.test(action)) { const line = this.model.source.lastIndexOf("\n", sel.start - 1) + 1; this.apply(line, line, "#".repeat(Number(action[1])) + " ", action); }
      else if (action === "bullet" || action === "ordered" || action === "task" || action === "quote") { const line = this.model.source.lastIndexOf("\n", sel.start - 1) + 1; const prefix = action === "ordered" ? "1. " : action === "task" ? "- [ ] " : action === "quote" ? "> " : "- "; this.apply(line, line, prefix, action); }
      else if (action === "codeblock") this.apply(sel.start, sel.end, "```\n" + selected + "\n```", action);
    }

    handleClick(event) {
      const checkbox = event.target.closest(".amorist-task-checkbox");
      if (!checkbox) return;
      const row = checkbox.closest(".amorist-source-line"); if (!row) return;
      const start = Number(row.dataset.sourceStart); const match = this.model.source.slice(start, Number(row.dataset.sourceEnd)).match(/\[([ xX])\]/);
      if (match) this.apply(start + match.index + 1, start + match.index + 2, /x/i.test(match[1]) ? " " : "x", "task-checkbox");
    }

    showSourceMode() {
      if (this.mode === "source") return;
      const selection = this.selectionRaw(); const y = this.caretY();
      this.source.value = this.model.display; this.surface.hidden = true; this.source.hidden = false; this.mode = "source";
      const at = this.model.displayOffset(selection.start); this.source.focus(); this.source.setSelectionRange(at, this.model.displayOffset(selection.end));
      this.restoreSourceCaretY(at, y); this.updateSourceButton(); this.performFind();
    }

    showWysiwygMode() {
      if (this.mode === "wysiwyg") return;
      const start = this.model.rawOffset(this.source.selectionStart); const end = this.model.rawOffset(this.source.selectionEnd); const y = this.caretY();
      this.source.hidden = true; this.surface.hidden = false; this.mode = "wysiwyg"; this.render({ start, end }); this.restoreCaretY(y); this.updateSourceButton(); this.performFind();
    }

    caretY() { const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null; return range ? range.getBoundingClientRect().top : 0; }
    restoreSourceCaretY(displayOffset, targetY) {
      requestAnimationFrame(() => {
        const style = window.getComputedStyle(this.source);
        const lineHeight = parseFloat(style.lineHeight) || 21;
        const line = this.source.value.slice(0, displayOffset).split("\n").length - 1;
        const box = this.source.getBoundingClientRect();
        const padding = parseFloat(style.paddingTop) || 0;
        this.source.scrollTop = Math.max(0, line * lineHeight + box.top + padding - targetY);
      });
    }
    restoreCaretY(y) { if (!y) return; requestAnimationFrame(() => { const selection = window.getSelection(); if (selection && selection.rangeCount) selection.getRangeAt(0).startContainer.parentElement?.scrollIntoView({ block: "center" }); }); }
    updateSourceButton() { const button = this.toolbar.querySelector('[data-action="source"]'); if (button) button.setAttribute("aria-pressed", String(this.mode === "source")); }
    undo() { const entry = this.history.undo(this.model); if (entry) { this.render({ start: entry.forward.start, end: entry.forward.start }); this.emitChange(); } }
    redo() { const entry = this.history.redo(this.model); if (entry) { const at = entry.forward.start + entry.forward.replacement.length; this.render({ start: at, end: at }); this.emitChange(); } }
    emitChange() { if (typeof this.options.onChange === "function") this.options.onChange(this.model.source); }
    openFindBar() { this.findBar.hidden = false; this.findInput.focus(); this.findInput.select(); }
    closeFindBar() { this.findBar.hidden = true; this.findCount.textContent = ""; this.focus(); }
    performFind() { const query = this.findInput.value; if (!query) { this.findCount.textContent = ""; return; } const haystack = this.mode === "source" ? this.source.value : this.surface.innerText; const count = haystack.toLowerCase().split(query.toLowerCase()).length - 1; this.findCount.textContent = count ? `1 of ${count}` : ""; }
  }

  function previousCodeUnit(source, at) { if (!at) return 0; if (source[at - 1] === "\n" && source[at - 2] === "\r") return at - 2; return at > 1 && source.charCodeAt(at - 1) >= 0xdc00 && source.charCodeAt(at - 1) <= 0xdfff ? at - 2 : at - 1; }
  function nextCodeUnit(source, at) { if (at >= source.length) return at; return source.charCodeAt(at) >= 0xd800 && source.charCodeAt(at) <= 0xdbff ? at + 2 : at + 1; }
  function midViewportLine(scrollTop, clientHeight, lineHeight) { return lineHeight > 0 ? Math.floor((scrollTop + clientHeight / 2) / lineHeight) : 0; }
  function centerScroll(anchorTop, clientHeight, scrollHeight) { return Math.max(0, Math.min(Math.max(0, scrollHeight - clientHeight), anchorTop - clientHeight / 2)); }
  Internals.MarkdownHistory = TransactionJournal;
  window.__editorTestHelpers = { midViewportLine, centerScroll };
  window.AmoristEditor = { create };
})();
