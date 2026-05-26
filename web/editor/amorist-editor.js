(function () {
  const Internals = window.AmoristInternals || {};
  const TextUtils = Internals.TextUtils;
  const MarkdownCodec = Internals.MarkdownCodec;
  const EditingPolicy = Internals.EditingPolicy;
  const HtmlToMarkdown = Internals.HtmlToMarkdown;

  if (!TextUtils) {
    throw new Error("AmoristTextUtils must be loaded before AmoristEditor.");
  }
  if (!MarkdownCodec) {
    throw new Error("AmoristMarkdownCodec must be loaded before AmoristEditor.");
  }
  if (!EditingPolicy) {
    throw new Error("AmoristEditingPolicy must be loaded before AmoristEditor.");
  }
  if (!HtmlToMarkdown) {
    throw new Error("AmoristHtmlToMarkdown must be loaded before AmoristEditor.");
  }

  class MarkdownHistory {
    constructor(maxEntries, maxCodeUnits) {
      this.entries = [];
      this.index = -1;
      this.maxEntries = maxEntries;
      this.maxCodeUnits = maxCodeUnits;
      this.totalCodeUnits = 0;
    }

    push(markdown) {
      if (this.index >= 0 && this.entries[this.index] === markdown) return;
      while (this.entries.length > this.index + 1) {
        this.totalCodeUnits -= this.entries.pop().length;
      }
      while (this.totalCodeUnits + markdown.length > this.maxCodeUnits && this.entries.length > 0) {
        this.totalCodeUnits -= this.entries.shift().length;
        this.index--;
      }
      while (this.entries.length >= this.maxEntries) {
        this.totalCodeUnits -= this.entries.shift().length;
        this.index--;
      }
      this.entries.push(markdown);
      this.totalCodeUnits += markdown.length;
      this.index = this.entries.length - 1;
    }

    undo() {
      if (this.index <= 0) return null;
      this.index--;
      return this.entries[this.index];
    }

    redo() {
      if (this.index >= this.entries.length - 1) return null;
      this.index++;
      return this.entries[this.index];
    }
  }

  Internals.MarkdownHistory = MarkdownHistory;

  function create(container, options) {
    return new AmoristEditor(container, options || {});
  }

  class AmoristEditor {
    constructor(container, options) {
      this.container = container;
      this.options = options;
      this.markdown = TextUtils.normalize(options.value || "");
      this.mode = "wysiwyg";
      this.isSyncing = false;
      this.history = new MarkdownHistory(100, 50 * 1024 * 1024);
      this.historyTimer = null;
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
      this.findInput.className = "amorist-editor-findbar-input";
      this.findInput.placeholder = "Find...";
      this.findInput.setAttribute("aria-label", "Find in document");

      this.findCount = document.createElement("span");
      this.findCount.className = "amorist-editor-findbar-count";

      var closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "amorist-editor-findbar-close";
      closeBtn.textContent = "×";
      closeBtn.title = "Close";
      closeBtn.addEventListener("click", () => this.closeFindBar());

      this.findBar.append(this.findInput, this.findCount, closeBtn);

      this.findMatches = [];
      this.findIndex = -1;
      this.sourceMatches = [];

      this.root.append(this.toolbar, this.findBar, this.surface, this.source);
      this.container.replaceChildren(this.root);
      this.editing = EditingPolicy.create({
        surface: this.surface,
        onChanged: () => this.syncWysiwygInput(),
      });
      this.buildToolbar();
      this.bind();
      this.setMarkdown(this.markdown, { silent: true });
      this.history.push(this.markdown);
    }

    buildToolbar() {
      const groups = [
        [
          ["bold", "B", "Bold"],
          ["italic", "I", "Italic"],
          ["code", "</>", "Inline code"],
          ["link", "↗", "Link"],
        ],
        [
          ["h1", "H1", "Heading 1"],
          ["h2", "H2", "Heading 2"],
          ["h3", "H3", "Heading 3"],
        ],
        [
          ["bullet", "•", "Bullet list"],
          ["ordered", "1.", "Numbered list"],
          ["task", "☐", "Task item"],
          ["quote", "❝", "Quote"],
          ["codeblock", "{ }", "Code block"],
        ],
        [["source", "Source", "Source mode"]],
      ];

      groups.forEach((group, groupIndex) => {
        if (groupIndex > 0) {
          const separator = document.createElement("span");
          separator.className = "amorist-editor-toolbar-separator";
          this.toolbar.append(separator);
        }
        group.forEach(([action, label, title]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.action = action;
          button.title = title;
          button.textContent = label;
          button.addEventListener("click", () => this.runAction(action));
          this.toolbar.append(button);
        });
      });
    }

    bind() {
      this.surface.addEventListener("keydown", (event) => this.handleEditorKeyDown(event));
      this.surface.addEventListener("input", () => this.handleWysiwygInput());
      this.surface.addEventListener("paste", (event) => this.handlePaste(event));
      this.surface.addEventListener("click", (event) => this.handleClick(event));
      this.source.addEventListener("input", () => {
        this.markdown = TextUtils.normalize(this.source.value);
        this.emitChange();
      });
      this.source.addEventListener("keydown", (event) => this.handleSourceKeyDown(event));
      this.findInput.addEventListener("input", () => this.performFind());
      this.findInput.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          this.closeFindBar();
        } else if (event.key === "Enter" && event.shiftKey) {
          event.preventDefault();
          this.findPrevious();
        } else if (event.key === "Enter") {
          event.preventDefault();
          this.findNext();
        }
      });
    }

    destroy() {
      clearTimeout(this.historyTimer);
      this.container.replaceChildren();
    }

    focus() {
      if (this.mode === "source") this.source.focus();
      else this.surface.focus();
    }

    getMarkdown() {
      if (this.mode === "source") {
        this.markdown = TextUtils.normalize(this.source.value);
      } else {
        this.stripFindMarks();
        this.markdown = MarkdownCodec.serializeBlocks(this.surface);
        if (this.findBar && !this.findBar.hidden && this.findInput.value) {
          Promise.resolve().then(() => this.performFind());
        }
      }
      return this.markdown;
    }

    getValue() {
      return this.getMarkdown();
    }

    setMarkdown(markdown, options) {
      this.markdown = TextUtils.normalize(markdown || "");
      this.isSyncing = true;
      this.surface.innerHTML = MarkdownCodec.renderMarkdown(this.markdown);
      this.source.value = this.markdown;
      this.isSyncing = false;
      if (!options || !options.silent) this.emitChange();
    }

    showSourceMode() {
      if (this.mode === "source") return;
      const scrollPosition = this.captureScrollPosition();
      this.source.value = this.markdown;
      this.surface.hidden = true;
      this.source.hidden = false;
      this.mode = "source";
      this.updateSourceButton();
      this.restoreScrollPosition(scrollPosition);
      if (this.findBar && !this.findBar.hidden) {
        this.performFind();
      }
    }

    showWysiwygMode() {
      if (this.mode === "wysiwyg") return;
      const scrollPosition = this.captureScrollPosition();
      this.setMarkdown(this.source.value, { silent: true });
      this.source.hidden = true;
      this.surface.hidden = false;
      this.mode = "wysiwyg";
      this.updateSourceButton();
      this.restoreScrollPosition(scrollPosition);
      if (this.findBar && !this.findBar.hidden) {
        this.performFind();
      }
    }

    showPlainTextarea() {
      this.showSourceMode();
    }

    showStats() {}

    runAction(action) {
      if (action === "source") {
        if (this.mode === "source") this.showWysiwygMode();
        else this.showSourceMode();
        return;
      }

      if (this.mode === "source") {
        this.showWysiwygMode();
      }

      this.editing.runAction(action);
    }

    handleEditorKeyDown(event) {
      if (this.handleEditorShortcut(event)) return;
      if (this.mode !== "wysiwyg" || event.altKey || event.isComposing || event.ctrlKey || event.metaKey) {
        return;
      }
      if (event.key === " ") {
        this.editing.applySpaceMarkdownShortcut(event);
      } else if (event.key === "Enter") {
        this.editing.applyEnterMarkdownShortcut(event);
      }
    }

    handleSourceKeyDown(event) {
      this.handleEditorShortcut(event);
    }

    handleEditorShortcut(event) {
      var mod = event.ctrlKey || event.metaKey;
      if (!mod || event.altKey || event.isComposing) return false;
      if (!event.shiftKey && event.key === "z") {
        event.preventDefault();
        this.undo();
        return true;
      }
      var isRedo = event.key === "y" || (event.shiftKey && (event.key === "z" || event.key === "Z"));
      if (isRedo) {
        event.preventDefault();
        this.redo();
        return true;
      }
      if (!event.shiftKey && event.key === "f") {
        event.preventDefault();
        this.openFindBar();
        return true;
      }
      return false;
    }

    handleWysiwygInput() {
      if (this.isSyncing) return;
      if (this.editing.applyInlineMarkdownShortcut()) return;
      this.syncWysiwygInput();
    }

    syncWysiwygInput() {
      if (this.isSyncing) return;
      this.stripFindMarks();
      this.markdown = MarkdownCodec.serializeBlocks(this.surface);
      this.source.value = this.markdown;
      this.emitChange();
      if (this.findBar && !this.findBar.hidden && this.findInput.value) {
        Promise.resolve().then(() => this.performFind());
      }
    }

    handlePaste(event) {
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      // Inside a code block / inline code: never parse, paste literally.
      if (this.isInCodeContext()) {
        const literal = clipboard.getData("text/plain");
        if (!literal) return;
        event.preventDefault();
        this.editing.insertPlainText(literal);
        return;
      }

      const html = clipboard.getData("text/html");
      let markdown;
      if (html && html.trim()) {
        markdown = HtmlToMarkdown.convert(html);
      } else {
        // Plain text is treated as Markdown source (EL-172 decision).
        markdown = TextUtils.normalize(clipboard.getData("text/plain") || "");
      }
      if (!markdown) return;
      event.preventDefault();
      this.insertMarkdownAtCaret(markdown);
    }

    isInCodeContext() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return false;
      const endpoints = selection.isCollapsed
        ? [selection.anchorNode]
        : [selection.anchorNode, selection.focusNode];
      return endpoints.every((start) => {
        let node = start;
        while (node && node !== this.surface) {
          if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === "PRE" || node.tagName === "CODE")) {
            return true;
          }
          node = node.parentNode;
        }
        return false;
      });
    }

    insertMarkdownAtCaret(markdown) {
      const html = MarkdownCodec.renderMarkdown(markdown);
      // execCommand splits the current block when inserting block-level HTML,
      // which is the desired behavior for multi-block pastes.
      const inserted = document.execCommand("insertHTML", false, html);
      if (inserted) this.syncWysiwygInput();
    }

    handleClick(event) {
      const checkbox = event.target.closest(".amorist-task-checkbox");
      if (!checkbox) return;
      const item = checkbox.closest(".amorist-task-item");
      if (!item) return;
      item.dataset.checked = item.dataset.checked === "true" ? "false" : "true";
      this.syncWysiwygInput();
    }

    emitChange() {
      if (typeof this.options.onChange === "function") {
        this.options.onChange(this.markdown);
      }
      clearTimeout(this.historyTimer);
      this.historyTimer = setTimeout(() => {
        this.history.push(this.markdown);
      }, 500);
    }

    undo() {
      clearTimeout(this.historyTimer);
      this.history.push(this.markdown);
      var previous = this.history.undo();
      if (previous === null) return;
      this.restoreHistoryMarkdown(previous);
    }

    redo() {
      clearTimeout(this.historyTimer);
      var next = this.history.redo();
      if (next === null) return;
      this.restoreHistoryMarkdown(next);
    }

    restoreHistoryMarkdown(markdown) {
      this.isSyncing = true;
      this.surface.innerHTML = MarkdownCodec.renderMarkdown(markdown);
      this.source.value = markdown;
      this.markdown = markdown;
      this.isSyncing = false;
      if (this.findBar && !this.findBar.hidden) {
        this.performFind();
      }
      if (typeof this.options.onChange === "function") {
        this.options.onChange(this.markdown);
      }
    }

    openFindBar() {
      this.findBar.hidden = false;
      this.findInput.focus();
      this.findInput.select();
      this.performFind();
    }

    closeFindBar() {
      this.findBar.hidden = true;
      this.clearHighlights();
      this.focus();
    }

    clearHighlights() {
      this.stripFindMarks();
      this.findMatches = [];
      this.sourceMatches = [];
      this.findIndex = -1;
      this.findCount.textContent = "";
    }

    stripFindMarks() {
      this.surface.querySelectorAll("mark.amorist-find-match").forEach(function (mark) {
        mark.replaceWith.apply(mark, Array.from(mark.childNodes));
      });
      this.surface.normalize();
    }

    performFind() {
      var query = this.findInput.value;
      if (!query) { this.clearHighlights(); return; }

      if (this.mode === "source") {
        this.performSourceFind(query);
        return;
      }

      this.isSyncing = true;
      this.stripFindMarks();
      var matches = collectTextMatches(this.surface, query);
      wrapMatchesReverse(matches);
      this.isSyncing = false;

      this.findMatches = Array.from(this.surface.querySelectorAll("mark.amorist-find-match"));
      this.findIndex = this.findMatches.length > 0 ? 0 : -1;
      this.updateFindHighlight();
    }

    findNext() {
      if (this.mode === "source") {
        if (this.sourceMatches.length === 0) return;
        this.findIndex = (this.findIndex + 1) % this.sourceMatches.length;
        this.updateSourceFindHighlight();
        return;
      }
      if (!this.findMatches || this.findMatches.length === 0) return;
      this.findIndex = (this.findIndex + 1) % this.findMatches.length;
      this.updateFindHighlight();
    }

    findPrevious() {
      if (this.mode === "source") {
        if (this.sourceMatches.length === 0) return;
        this.findIndex = (this.findIndex - 1 + this.sourceMatches.length) % this.sourceMatches.length;
        this.updateSourceFindHighlight();
        return;
      }
      if (!this.findMatches || this.findMatches.length === 0) return;
      this.findIndex = (this.findIndex - 1 + this.findMatches.length) % this.findMatches.length;
      this.updateFindHighlight();
    }

    updateFindHighlight() {
      this.findMatches.forEach(function (m) { m.classList.remove("amorist-find-current"); });
      if (this.findIndex >= 0 && this.findIndex < this.findMatches.length) {
        this.findMatches[this.findIndex].classList.add("amorist-find-current");
        this.findMatches[this.findIndex].scrollIntoView({ block: "nearest" });
      }
      this.updateFindCount();
    }

    updateFindCount() {
      var total = this.mode === "source" ? this.sourceMatches.length : (this.findMatches ? this.findMatches.length : 0);
      this.findCount.textContent = total > 0 ? (this.findIndex + 1) + " of " + total : "";
    }

    performSourceFind(query) {
      var text = this.source.value.toLowerCase();
      var lowerQuery = query.toLowerCase();
      this.sourceMatches = [];
      var start = 0;
      var idx;
      while ((idx = text.indexOf(lowerQuery, start)) !== -1) {
        this.sourceMatches.push([idx, idx + query.length]);
        start = idx + 1;
      }
      this.findIndex = this.sourceMatches.length > 0 ? 0 : -1;
      this.updateSourceFindHighlight();
    }

    updateSourceFindHighlight() {
      if (this.findIndex >= 0 && this.findIndex < this.sourceMatches.length) {
        var match = this.sourceMatches[this.findIndex];
        this.source.setSelectionRange(match[0], match[1]);
        var linesBefore = this.source.value.substring(0, match[0]).split("\n").length - 1;
        var lineHeight = sourceLineHeight(this.source);
        this.source.scrollTop = lineHeight * Math.max(0, linesBefore - 3);
      }
      this.updateFindCount();
    }

    updateSourceButton() {
      const button = this.toolbar.querySelector('[data-action="source"]');
      if (button) button.setAttribute("aria-pressed", String(this.mode === "source"));
    }

    captureScrollPosition() {
      if (this.mode === "source") {
        var lineHeight = sourceLineHeight(this.source);
        return {
          line: Math.max(0, Math.floor(this.source.scrollTop / lineHeight)),
          progress: this.source.scrollHeight > 0 ? this.source.scrollTop / this.source.scrollHeight : 0,
        };
      }

      var surfaceTop = this.surface.getBoundingClientRect().top;
      var visibleBlock = Array.from(this.surface.children).find(function (child) {
        return child.getBoundingClientRect().bottom > surfaceTop;
      });

      return {
        line: visibleBlock ? Number(visibleBlock.dataset.sourceLine || 0) : 0,
        progress: this.surface.scrollHeight > 0 ? this.surface.scrollTop / this.surface.scrollHeight : 0,
      };
    }

    restoreScrollPosition(position) {
      if (!position) return;
      var self = this;

      var restore = function () {
        if (self.mode === "source") {
          var lineTop = position.line * sourceLineHeight(self.source);
          self.source.scrollTop = lineTop;
          return;
        }

        var target = blockForSourceLine(self.surface, position.line);
        if (target) {
          self.surface.scrollTop = target.offsetTop;
          return;
        }

        self.surface.scrollTop = self.surface.scrollHeight * position.progress;
      };

      restore();
      window.requestAnimationFrame(restore);
    }
  }

  function collectTextMatches(root, query) {
    var lowerQuery = query.toLowerCase();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var matches = [];
    var node;
    while ((node = walker.nextNode())) {
      var text = node.textContent.toLowerCase();
      var start = 0;
      var idx;
      while ((idx = text.indexOf(lowerQuery, start)) !== -1) {
        matches.push({ node: node, start: idx, end: idx + query.length });
        start = idx + 1;
      }
    }
    return matches;
  }

  function wrapMatchesReverse(matches) {
    var groups = new Map();
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      if (!groups.has(m.node)) groups.set(m.node, []);
      groups.get(m.node).push(m);
    }
    var nodes = Array.from(groups.keys()).reverse();
    for (var n = 0; n < nodes.length; n++) {
      var nodeMatches = groups.get(nodes[n]);
      for (var j = nodeMatches.length - 1; j >= 0; j--) {
        var match = nodeMatches[j];
        var range = document.createRange();
        range.setStart(match.node, match.start);
        range.setEnd(match.node, match.end);
        var mark = document.createElement("mark");
        mark.className = "amorist-find-match";
        range.surroundContents(mark);
      }
    }
  }

  function sourceLineHeight(source) {
    const style = window.getComputedStyle(source);
    const lineHeight = Number.parseFloat(style.lineHeight);
    if (Number.isFinite(lineHeight)) return lineHeight;
    const fontSize = Number.parseFloat(style.fontSize);
    return Number.isFinite(fontSize) ? fontSize * 1.6 : 24;
  }

  function viewportContentTop(toolbar) {
    return Math.max(0, toolbar.getBoundingClientRect().bottom) + 1;
  }

  function topbarHeight() {
    const topbar = document.querySelector(".topbar");
    return topbar ? topbar.getBoundingClientRect().height : 0;
  }

  function documentTop(element) {
    return element.getBoundingClientRect().top + window.scrollY;
  }

  function blockForSourceLine(surface, line) {
    const blocks = Array.from(surface.children)
      .map((element) => ({
        element,
        line: Number(element.dataset.sourceLine || 0),
      }))
      .filter((block) => Number.isFinite(block.line))
      .sort((a, b) => a.line - b.line);

    if (blocks.length === 0) return null;

    let target = blocks[0].element;
    for (const block of blocks) {
      if (block.line > line) break;
      target = block.element;
    }
    return target;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  window.AmoristEditor = { create };
})();
