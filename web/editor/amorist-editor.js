(function () {
  const Internals = window.AmoristInternals || {};
  const DocumentModel = Internals.DocumentModel;
  const TransactionJournal = Internals.TransactionJournal;
  const HtmlToMarkdown = Internals.HtmlToMarkdown;
  const MarkdownCodec = Internals.MarkdownCodec;
  const TableCodec = Internals.TableCodec;
  const CARET_SENTINEL = "\u200b";
  if (!HtmlToMarkdown) throw new Error("AmoristHtmlToMarkdown must load before AmoristEditor.");
  if (!MarkdownCodec) throw new Error("AmoristMarkdownCodec must load before AmoristEditor.");

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

  // The Markdown renderer owns only the view.  The source model remains the
  // edit authority, so selection offsets are aligned back to its raw bytes.
  function sourceOffsetForVisibleText(raw, visible, offset) {
    const target = String(visible || "").slice(0, Math.max(0, Number(offset) || 0));
    if (!target) {
      const first = String(visible || "")[0];
      if (!first) return 0;
      const found = raw.search(new RegExp(first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return found < 0 ? 0 : found;
    }
    let rawIndex = 0;
    let visibleIndex = 0;
    while (rawIndex < raw.length && visibleIndex < target.length) {
      const rawChar = raw[rawIndex];
      const visibleChar = target[visibleIndex];
      const same = rawChar === visibleChar || ((rawChar === "\n" || rawChar === "\r") && visibleChar === " ");
      rawIndex += 1;
      if (same) visibleIndex += 1;
    }
    return rawIndex;
  }

  function visibleOffsetForSourcePrefix(raw, visible) {
    let rawIndex = 0;
    let visibleIndex = 0;
    while (rawIndex < raw.length && visibleIndex < visible.length) {
      const rawChar = raw[rawIndex];
      const visibleChar = visible[visibleIndex];
      const same = rawChar === visibleChar || ((rawChar === "\n" || rawChar === "\r") && visibleChar === " ");
      rawIndex += 1;
      if (same) visibleIndex += 1;
    }
    return visibleIndex;
  }

  function inlineClosingDelimiterBefore(node, boundary) {
    let current = node;
    while (current && current !== boundary) {
      const previous = current.previousSibling;
      if (previous && previous.nodeType === Node.ELEMENT_NODE) {
        if (previous.tagName === "STRONG") return "**";
        if (previous.tagName === "EM") return "*";
        if (previous.tagName === "CODE") return "`";
      }
      current = current.parentElement;
    }
    return "";
  }

  function alignedScrollTop(currentScrollTop, caretTop, targetCaretTop) {
    return Math.max(0, currentScrollTop + caretTop - targetCaretTop);
  }

  function clampedLine(number, lineCount) {
    return Math.max(0, Math.min(Math.max(0, lineCount - 1), number));
  }

  function projectionLine(raw) {
    const heading = raw.match(/^ {0,3}(#{1,6})\s+/);
    if (heading) return { prefix: heading[0].length, text: raw.slice(heading[0].length), tag: `h${heading[1].length}` };
    const quote = raw.match(/^>\s?/);
    if (quote) return { prefix: quote[0].length, text: raw.slice(quote[0].length), tag: "blockquote" };
    const list = raw.match(/^(\s*)([-*+]|\d+[.)])\s+/);
    if (list) {
      const task = raw.slice(list[0].length).match(/^\[([ xX])\]\s+/);
      return {
        prefix: list[0].length + (task ? task[0].length : 0),
        text: raw.slice(list[0].length + (task ? task[0].length : 0)),
        tag: "div",
        list: /\d/.test(list[2]) ? "ordered" : "bullet",
        marker: list[2],
        indent: list[1].length,
        checked: task ? /x/i.test(task[1]) : null,
      };
    }
    if (/^ {0,3}(`{3,}|~{3,}).*$/.test(raw)) return { prefix: raw.length, text: "", tag: "pre", fence: true };
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) return { prefix: raw.length, text: "", tag: "hr", rule: true };
    return { prefix: 0, text: raw, tag: "div" };
  }

  function listContextAt(source, offset) {
    const start = lineStart(source, offset);
    const end = lineEnd(source, offset);
    const text = source.slice(start, end);
    const match = text.match(/^(\s*)([-*+]|\d+[.)])([ \t]+)(?:\[([ xX])\]([ \t]+))?/);
    if (!match) return null;
    return {
      kind: "list",
      start,
      end,
      indent: match[1],
      marker: match[2],
      spacing: match[3],
      task: match[4] !== undefined,
      taskSpacing: match[5] || " ",
      markerStart: start + match[1].length,
      contentStart: start + match[0].length,
    };
  }

  function structuralContextAt(source, offset) {
    const list = listContextAt(source, offset);
    if (list) return list;
    const start = lineStart(source, offset);
    const end = lineEnd(source, offset);
    const text = source.slice(start, end);
    const heading = text.match(/^( {0,3})(#{1,6})([ \t]+)/);
    const quote = text.match(/^(\s*)(>)([ \t]?)/);
    const match = heading || quote;
    if (!match) return null;
    return {
      kind: heading ? "heading" : "quote",
      start,
      end,
      indent: match[1],
      marker: match[2],
      spacing: match[3],
      markerStart: start + match[1].length,
      contentStart: start + match[0].length,
    };
  }

  function continuedListPrefix(context) {
    let marker = context.marker;
    const ordered = marker.match(/^(\d+)([.)])$/);
    if (ordered) marker = String(Number(ordered[1]) + 1) + ordered[2];
    return context.indent + marker + context.spacing
      + (context.task ? "[ ]" + context.taskSpacing : "");
  }

  function continuedStructuralPrefix(context) {
    if (context.kind === "quote") return context.indent + context.marker + context.spacing;
    return continuedListPrefix(context);
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
      this.inlineMode = null;
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
      // C2 is defined over physical Markdown lines, not soft-wrapped display
      // fragments.  Horizontal scrolling is preferable to changing the line
      // identity used while comparing Source with WYSIWYG.
      this.source.wrap = "off";
      this.findBar = document.createElement("div");
      this.findBar.className = "amorist-editor-findbar";
      this.findBar.hidden = true;
      this.findInput = document.createElement("input");
      this.findInput.type = "text";
      this.findInput.className = "amorist-editor-findbar-input";
      this.findInput.placeholder = "Find...";
      this.findCount = document.createElement("span");
      this.findCount.className = "amorist-editor-findbar-count";
      const closeFind = document.createElement("button");
      closeFind.type = "button";
      closeFind.className = "amorist-editor-findbar-close";
      closeFind.textContent = "×";
      closeFind.title = "Close";
      closeFind.addEventListener("click", () => this.closeFindBar());
      this.findBar.append(this.findInput, this.findCount, closeFind);
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
      this.findInput.addEventListener("keydown", (event) => this.handleFindKeyDown(event));
    }

    destroy() { this.container.replaceChildren(); }
    focus() { (this.mode === "source" ? this.source : this.surface).focus(); }
    getMarkdown() { return this.model.source; }
    getValue() { return this.model.source; }

    setMarkdown(markdown, options) {
      this.model = new DocumentModel(markdown || "");
      this.history = new TransactionJournal(100);
      this.inlineMode = null;
      this.render();
      if (!options || !options.silent) this.emitChange();
    }

    render(rawSelection) {
      this.isRendering = true;
      this.source.value = this.model.display;
      const lines = sourceLines(this.model.source);
      const rawLines = lines.map((line) => this.model.source.slice(line.start, line.end));
      let tableUntil = -1;
      let fence = null;
      this.surface.replaceChildren();
      lines.forEach((line, index) => {
        const raw = this.model.source.slice(line.start, line.end);
        const projection = projectionLine(raw);
        const row = document.createElement("span");
        row.className = "amorist-source-line";
        row.dataset.sourceStart = String(line.start);
        row.dataset.sourceEnd = String(line.end);
        row.dataset.prefix = String(projection.prefix);
        row.dataset.line = String(index);
        row.dataset.endingLength = String(line.ending.length);
        if (projection.list) {
          row.classList.add("amorist-wysiwyg-list-item", `amorist-wysiwyg-${projection.list}`);
          row.dataset.marker = projection.list === "ordered" ? projection.marker : "•";
          row.style.paddingInlineStart = `${projection.indent * 0.6 + 1.4}em`;
        } else if (/^h[1-6]$/.test(projection.tag)) {
          row.classList.add(`amorist-wysiwyg-${projection.tag}`);
        } else if (projection.tag === "blockquote") {
          row.classList.add("amorist-wysiwyg-quote");
        } else if (projection.fence) {
          row.classList.add("amorist-wysiwyg-fence");
        } else if (projection.rule) {
          row.classList.add("amorist-wysiwyg-rule");
        }
        const fenceMatch = raw.match(/^ {0,3}(`{3,}|~{3,}).*$/);
        const closesFence = fence && new RegExp(`^ {0,3}\\${fence.marker}{${fence.length},}\\s*$`).test(raw);
        if (!fence && fenceMatch) fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
        else if (closesFence) fence = null;
        const codeContent = Boolean(fence) && !fenceMatch;
        if (TableCodec && TableCodec.isTableStart(rawLines, index)) tableUntil = index + 1;
        if (tableUntil >= index) {
          row.classList.add("amorist-wysiwyg-table");
          if (index === tableUntil) {
            let next = index + 1;
            const columns = TableCodec.splitTableRow(rawLines[index]).length;
            while (next < rawLines.length && TableCodec.looksLikeTableRow(rawLines[next], columns)) next += 1;
            tableUntil = next - 1;
          }
        }
        if (codeContent) {
          row.classList.add("amorist-wysiwyg-code");
          row.textContent = raw || "\u200b";
        } else if (row.classList.contains("amorist-wysiwyg-table")) {
          this.renderTableRow(row, raw);
        } else if (typeof projection.checked === "boolean") {
          row.classList.add("amorist-wysiwyg-task");
          row.dataset.checked = String(projection.checked);
          row.innerHTML = `<span class="amorist-task-checkbox" contenteditable="false"></span><span class="amorist-task-content">${MarkdownCodec.renderInline(projection.text)}</span>`;
          if (!projection.text) {
            const content = row.querySelector(".amorist-task-content");
            content.classList.add("amorist-empty-caret");
            content.textContent = CARET_SENTINEL;
          }
        } else if (projection.rule || projection.fence) {
          row.setAttribute("aria-label", projection.rule ? "Horizontal rule" : "Code fence");
        } else if (projection.text) {
          row.innerHTML = MarkdownCodec.renderInline(projection.text);
        } else if (projection.prefix) {
          // An empty rendered construct still needs a real DOM position after
          // its hidden Markdown marker.  Without it WebKit/Chromium place the
          // caret before the pseudo-marker and the next character is inserted
          // before "- ", "# ", "> ", and similar prefixes.
          const caret = document.createElement("span");
          caret.className = "amorist-empty-caret";
          caret.textContent = CARET_SENTINEL;
          row.append(caret);
          if (!line.ending) row.append(document.createElement("br"));
        } else if (!line.ending) {
          row.append(document.createElement("br"));
        }
        // Keep the editable text stream aligned with physical source lines.
        // Block layout alone is invisible to TreeWalker-based selection APIs.
        if (line.ending) row.append(document.createTextNode("\n"));
        this.surface.append(row);
      });
      this.layoutTables();
      this.isRendering = false;
      if (rawSelection) this.setSurfaceSelection(rawSelection.start, rawSelection.end);
    }

    renderTableRow(row, raw) {
      // Keep every source character in the editable text stream.  The visual
      // columns below are CSS layout only: unlike the former table formatter,
      // they never manufacture padding in the Markdown model.
      let cellStart = 0;
      let escaped = false;
      const appendCell = (text) => {
        const cell = document.createElement("span");
        cell.className = "amorist-wysiwyg-table-cell";
        if (text) cell.innerHTML = MarkdownCodec.renderInline(text);
        row.append(cell);
      };
      for (let index = 0; index < raw.length; index += 1) {
        const char = raw[index];
        if (char === "|" && !escaped) {
          appendCell(raw.slice(cellStart, index));
          const marker = document.createElement("span");
          marker.className = "amorist-wysiwyg-table-marker";
          marker.textContent = "|";
          row.append(marker);
          cellStart = index + 1;
        }
        escaped = char === "\\" && !escaped;
        if (char !== "\\") escaped = false;
      }
      appendCell(raw.slice(cellStart));
    }

    layoutTables() {
      let rows = [];
      const align = () => {
        if (!rows.length) return;
        const widths = [];
        rows.forEach((row) => {
          row.querySelectorAll(".amorist-wysiwyg-table-cell").forEach((cell, index) => {
            widths[index] = Math.max(widths[index] || 0, cell.getBoundingClientRect().width);
          });
        });
        rows.forEach((row) => {
          row.querySelectorAll(".amorist-wysiwyg-table-cell").forEach((cell, index) => {
            cell.style.paddingInlineEnd = `${Math.max(0, widths[index] - cell.getBoundingClientRect().width)}px`;
          });
        });
        rows = [];
      };
      Array.from(this.surface.querySelectorAll(".amorist-source-line")).forEach((row) => {
        if (row.classList.contains("amorist-wysiwyg-table")) rows.push(row);
        else align();
      });
      align();
    }

    selectionRaw() {
      if (this.mode === "source") return { start: this.model.rawOffset(this.source.selectionStart), end: this.model.rawOffset(this.source.selectionEnd) };
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return { start: 0, end: 0 };
      const range = selection.getRangeAt(0);
      if (!this.surface.contains(range.startContainer) || !this.surface.contains(range.endContainer)) {
        return { start: 0, end: 0 };
      }
      return { start: this.rawPoint(range.startContainer, range.startOffset), end: this.rawPoint(range.endContainer, range.endOffset) };
    }

    rawPoint(node, offset) {
      let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      while (element && !element.classList.contains("amorist-source-line")) element = element.parentElement;
      if (!element) return this.model.source.length;
      const start = Number(element.dataset.sourceStart);
      const visible = (element.textContent || "").replaceAll(CARET_SENTINEL, "");
      if (!visible.replace(/\n$/, "") && Number(element.dataset.prefix)) {
        return start + Number(element.dataset.prefix);
      }
      const prefix = document.createRange();
      prefix.setStart(element, 0);
      prefix.setEnd(node, offset);
      // Harnesses and browsers may represent a caret at a source-line boundary
      // as the end of the preceding text node.  Its terminal display newline
      // maps to the real line terminator, not to the preceding character.
      const prefixLength = prefix.toString().replaceAll(CARET_SENTINEL, "").length;
      if (visible.endsWith("\n") && prefixLength >= visible.length) {
        return Number(element.dataset.sourceEnd) + Number(element.dataset.endingLength);
      }
      let rawOffset = start + sourceOffsetForVisibleText(this.model.source.slice(start, Number(element.dataset.sourceEnd)), visible, prefixLength);
      if (offset === 0) {
        const closing = inlineClosingDelimiterBefore(node, element);
        if (closing && this.model.source.slice(rawOffset, rawOffset + closing.length) === closing) rawOffset += closing.length;
      }
      return rawOffset;
    }

    setSurfaceSelection(start, end) {
      const point = (rawOffset) => {
        const blocks = Array.from(this.surface.querySelectorAll(".amorist-source-line"));
        const block = blocks.find((candidate) => rawOffset >= Number(candidate.dataset.sourceStart) && rawOffset <= Number(candidate.dataset.sourceEnd)) || blocks[blocks.length - 1];
        const visible = block.textContent || "";
        const rawPrefix = this.model.source.slice(Number(block.dataset.sourceStart), rawOffset);
        const emptyCaret = block.querySelector(".amorist-empty-caret");
        if (emptyCaret && rawOffset >= Number(block.dataset.sourceStart) + Number(block.dataset.prefix)) {
          const sentinel = emptyCaret.firstChild;
          return sentinel
            ? { node: sentinel, offset: sentinel.textContent.length }
            : { node: emptyCaret, offset: 0 };
        }
        const visibleOffset = visibleOffsetForSourcePrefix(rawPrefix, visible);
        const afterInlineDelimiter = /(?:\*\*|\*|`)$/.test(rawPrefix);
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let textNode = walker.nextNode() || block;
        let remaining = visibleOffset;
        while (textNode && (remaining > textNode.textContent.length || (afterInlineDelimiter && remaining === textNode.textContent.length))) {
          remaining -= textNode.textContent.length; textNode = walker.nextNode();
        }
        return { node: textNode || block, offset: Math.max(0, Math.min(remaining, (textNode || block).textContent.length)) };
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
        event.preventDefault();
        const text = event.data || "";
        if (this.inlineMode && selection.start === selection.end) {
          const [open, close] = this.inlineMode.marks;
          if (this.model.source.slice(selection.start, selection.start + close.length) === close) {
            this.apply(selection.start, selection.end, text, "insert");
          } else {
            this.apply(selection.start, selection.end, open + text + close, `insert-${this.inlineMode.action}`);
            const caret = selection.start + open.length + text.length;
            this.setSurfaceSelection(caret, caret);
          }
        } else this.apply(selection.start, selection.end, text, "insert");
        return;
      }
      if (type === "insertParagraph" || type === "insertLineBreak") {
        const context = selection.start === selection.end
          ? structuralContextAt(this.model.source, selection.start)
          : null;
        if (context && selection.start >= context.contentStart && selection.start <= context.end) {
          event.preventDefault();
          if (context.contentStart === context.end) {
            this.apply(context.markerStart, context.contentStart, "", context.kind === "list" ? "list-exit" : "block-exit");
          } else if (context.kind === "heading") {
            this.apply(selection.start, selection.end, "\n", "block-enter");
          } else {
            this.apply(selection.start, selection.end, "\n" + continuedStructuralPrefix(context), context.kind === "list" ? "list-enter" : "block-enter");
          }
          return;
        }
        // REQ-B3 defines ordinary prose Enter as one bare LF. Existing
        // terminators stay verbatim; only the new boundary is LF.
        event.preventDefault(); this.apply(selection.start, selection.end, "\n", "enter"); return;
      }
      if (type === "deleteContentBackward") {
        const context = selection.start === selection.end
          ? structuralContextAt(this.model.source, selection.start)
          : null;
        if (context && selection.start === context.contentStart) {
          event.preventDefault();
          this.apply(context.markerStart, context.contentStart, "", context.kind === "list" ? "list-backspace" : "block-backspace");
          return;
        }
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
      if (this.mode === "wysiwyg" && event.key === "Backspace") {
        const selection = this.selectionRaw();
        const context = selection.start === selection.end
          ? structuralContextAt(this.model.source, selection.start)
          : null;
        // WebKitGTK does not consistently follow this boundary keydown with a
        // deleteContentBackward beforeinput. Own the structural shortcut here;
        // ordinary Backspace is still handled by beforeinput on every engine.
        if (context && selection.start === context.contentStart) {
          event.preventDefault();
          this.apply(context.markerStart, context.contentStart, "", context.kind === "list" ? "list-backspace" : "block-backspace");
          return;
        }
      }
      if (this.mode === "wysiwyg" && event.key === "Tab") {
        event.preventDefault(); const sel = this.selectionRaw(); const line = this.model.source.lastIndexOf("\n", sel.start - 1) + 1;
        const indent = this.model.source.slice(line).match(/^ {1,2}/);
        if (event.shiftKey) {
          if (indent) this.apply(line, line + indent[0].length, "", "outdent");
        } else this.apply(line, line, "  ", "indent");
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
      else if (wraps[action]) this.toggleInlineMode(action, wraps[action], sel);
      else if (action === "link" && selected) {
        const href = window.prompt("URL");
        if (!href) return;
        const label = selected.replace(/]/g, "\\]");
        this.apply(sel.start, sel.end, `[${label}](${String(href).trim().replace(/\)/g, "%29")})`, action);
      }
      else if (/^h[1-6]$/.test(action)) {
        const requested = "#".repeat(Number(action[1])) + " ";
        this.applyLineTransform(sel, action, (lines) => {
          const allRequested = lines.every((text) => new RegExp(`^(\\s*)#{${Number(action[1])}}\\s+`).test(text));
          return lines.map((text) => {
            const heading = text.match(/^(\s*)(#{1,6})\s+/);
            const indent = heading ? heading[1] : (text.match(/^\s*/) || [""])[0];
            const body = heading ? text.slice(heading[0].length) : text.slice(indent.length);
            return indent + (allRequested ? "" : requested) + body;
          });
        });
      }
      else if (action === "bullet" || action === "ordered" || action === "task" || action === "quote") {
        const prefix = action === "ordered" ? "1. " : action === "task" ? "- [ ] " : action === "quote" ? "> " : "- ";
        const markerPattern = action === "quote" ? /^(\s*)>\s?/ : /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
        const requestedPattern = action === "bullet" ? /^(\s*)[-*+]\s+(?!\[[ xX]\]\s+)/
          : action === "ordered" ? /^(\s*)\d+[.)]\s+/
            : action === "task" ? /^(\s*)[-*+]\s+\[[ xX]\]\s+/
              : /^(\s*)>\s?/;
        this.applyLineTransform(sel, action, (lines) => {
          const allRequested = lines.every((text) => requestedPattern.test(text));
          return lines.map((text) => {
            const current = text.match(markerPattern);
            const indent = current ? current[1] : (text.match(/^\s*/) || [""])[0];
            const body = current ? text.slice(current[0].length) : text.slice(indent.length);
            return indent + (allRequested ? "" : prefix) + body;
          });
        });
      }
      else if (action === "codeblock") {
        const { start, end } = selectedLineRange(this.model.source, sel.start, sel.end);
        const body = this.model.source.slice(start, end);
        const ending = this.model.lineEndingAt(start);
        this.apply(start, end, "```" + ending + body + ending + "```", action);
      }
    }

    handleClick(event) {
      const checkbox = event.target.closest(".amorist-task-checkbox");
      if (!checkbox) return;
      const block = checkbox.closest(".amorist-source-line"); if (!block) return;
      const start = Number(block.dataset.sourceStart);
      const match = this.model.source.slice(start, Number(block.dataset.sourceEnd)).match(/\[([ xX])\]/);
      if (match) this.apply(start + match.index + 1, start + match.index + 2, /x/i.test(match[1]) ? " " : "x", "task-checkbox");
    }

    toggleInlineMode(action, marks, selection) {
      if (this.inlineMode && this.inlineMode.action === action) {
        const close = marks[1];
        this.inlineMode = null;
        const closeAt = this.model.source.indexOf(close, selection.start);
        if (selection.start === selection.end && closeAt >= selection.start && closeAt - selection.start <= close.length) {
          this.setSurfaceSelection(closeAt + close.length, closeAt + close.length);
        }
      } else this.inlineMode = { action, marks };
    }

    applyLineTransform(selection, gesture, transform) {
      const range = selectedLineRange(this.model.source, selection.start, selection.end);
      const replacement = transformPhysicalLines(this.model.source.slice(range.start, range.end), transform);
      this.apply(range.start, range.end, replacement, gesture);
    }

    showSourceMode() {
      if (this.mode === "source") return;
      const selection = this.selectionRaw();
      const anchor = this.wysiwygViewportAnchor();
      this.source.style.paddingTop = "";
      this.source.style.paddingBottom = "";
      this.source.value = this.model.display; this.surface.hidden = true; this.source.hidden = false; this.mode = "source";
      const at = this.model.displayOffset(selection.start); this.source.focus(); this.source.setSelectionRange(at, this.model.displayOffset(selection.end));
      this.restoreSourceViewportAnchor(anchor); this.updateSourceButton(); this.performFind();
    }

    showWysiwygMode() {
      if (this.mode === "wysiwyg") return;
      const start = this.model.rawOffset(this.source.selectionStart); const end = this.model.rawOffset(this.source.selectionEnd);
      const anchor = this.sourceViewportAnchor();
      this.source.style.paddingTop = "";
      this.source.style.paddingBottom = "";
      this.surface.style.paddingTop = "";
      this.surface.style.paddingBottom = "";
      try {
        // Render the arriving view before hiding the safe source view.  A view
        // failure must be an explicit fallback, never an empty editor.
        this.surface.hidden = false;
        this.render({ start, end });
        this.source.hidden = true;
        this.mode = "wysiwyg";
        this.restoreWysiwygViewportAnchor(anchor);
        this.updateSourceButton(); this.performFind();
      } catch (error) {
        this.isRendering = false;
        this.surface.hidden = true;
        this.source.hidden = false;
        this.mode = "source";
        this.source.value = this.model.display;
        const displayStart = this.model.displayOffset(start);
        this.source.focus(); this.source.setSelectionRange(displayStart, this.model.displayOffset(end));
        this.updateSourceButton();
        if (typeof this.options.onWarning === "function") {
          this.options.onWarning("WYSIWYG could not be rendered. Source view remains available; your text is unchanged.");
        }
        console.error("Amorist WYSIWYG render failed; Source view was kept visible.", error);
      }
    }

    sourceViewportAnchor() {
      const style = window.getComputedStyle(this.source);
      const lineHeight = parseFloat(style.lineHeight) || 21;
      const contentY = this.source.scrollTop + this.source.clientHeight / 2 - (parseFloat(style.paddingTop) || 0);
      const maximum = Math.max(0, this.source.scrollHeight - this.source.clientHeight);
      return {
        line: clampedLine(Math.floor(contentY / lineHeight), sourceLines(this.model.source).length),
        edge: maximum <= 1 ? "both" : (this.source.scrollTop <= 1 ? "start" : (this.source.scrollTop >= maximum - 1 ? "end" : null)),
      };
    }
    wysiwygViewportAnchor() {
      const scroller = scrollViewportFor(this.surface);
      const middle = scrollViewportMiddle(scroller);
      const rows = Array.from(this.surface.querySelectorAll(".amorist-source-line"));
      const row = rows.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.top <= middle && rect.bottom >= middle;
      }) || rows.reduce((nearest, candidate) => {
        if (!nearest) return candidate;
        const distance = (rect) => Math.abs((rect.top + rect.bottom) / 2 - middle);
        return distance(candidate.getBoundingClientRect()) < distance(nearest.getBoundingClientRect()) ? candidate : nearest;
      }, null);
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      return {
        line: row ? Number(row.dataset.line) : 0,
        edge: maximum <= 1 ? "both" : (scroller.scrollTop <= 1 ? "start" : (scroller.scrollTop >= maximum - 1 ? "end" : null)),
      };
    }
    restoreSourceViewportAnchor(anchor) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const style = window.getComputedStyle(this.source);
          const lineHeight = parseFloat(style.lineHeight) || 21;
          const padding = parseFloat(style.paddingTop) || 0;
          const wanted = padding + anchor.line * lineHeight + lineHeight / 2 - this.source.clientHeight / 2;
          const maximum = Math.max(0, this.source.scrollHeight - this.source.clientHeight);
          // The first and last viewport have no space on one side. Preserve the
          // edge in that case; never invent blank document padding to fake C2.
          this.source.scrollTop = anchor.edge === "start" ? 0
            : (anchor.edge === "end" ? maximum : Math.max(0, Math.min(maximum, wanted)));
        });
      });
    }
    restoreWysiwygViewportAnchor(anchor) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const row = this.surface.querySelector(`.amorist-source-line[data-line="${anchor.line}"]`);
          if (!row) return;
          const scroller = scrollViewportFor(this.surface);
          const targetY = scrollViewportMiddle(scroller);
          const rect = row.getBoundingClientRect();
          const wanted = scroller.scrollTop + (rect.top + rect.bottom) / 2 - targetY;
          const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          scroller.scrollTop = anchor.edge === "start" ? 0
            : (anchor.edge === "end" ? maximum : Math.max(0, Math.min(maximum, wanted)));
        });
      });
    }
    updateSourceButton() { const button = this.toolbar.querySelector('[data-action="source"]'); if (button) button.setAttribute("aria-pressed", String(this.mode === "source")); }
    undo() { const entry = this.history.undo(this.model); if (entry) { this.render({ start: entry.forward.start, end: entry.forward.start }); this.emitChange(); } }
    redo() { const entry = this.history.redo(this.model); if (entry) { const at = entry.forward.start + entry.forward.replacement.length; this.render({ start: at, end: at }); this.emitChange(); } }
    emitChange() { if (typeof this.options.onChange === "function") this.options.onChange(this.model.source); }
    openFindBar() { this.findBar.hidden = false; this.findInput.focus(); this.findInput.select(); this.performFind(); }
    closeFindBar() { this.findBar.hidden = true; this.findMatches = []; this.findIndex = -1; this.findCount.textContent = ""; this.focus(); }
    performFind() {
      const query = this.findInput.value.toLocaleLowerCase();
      this.findMatches = [];
      this.findIndex = -1;
      if (!query) { this.findCount.textContent = ""; return; }
      const haystack = this.model.display.toLocaleLowerCase();
      let at = 0;
      while ((at = haystack.indexOf(query, at)) >= 0) { this.findMatches.push(at); at += Math.max(1, query.length); }
      this.findIndex = this.findMatches.length ? 0 : -1;
      this.updateFindCount();
    }
    handleFindKeyDown(event) {
      if (event.key === "Escape") { event.preventDefault(); this.closeFindBar(); }
      else if (event.key === "Enter") { event.preventDefault(); this.findMove(event.shiftKey ? -1 : 1); }
    }
    findMove(step) {
      if (!this.findMatches.length) return;
      this.findIndex = (this.findIndex + step + this.findMatches.length) % this.findMatches.length;
      const start = this.findMatches[this.findIndex];
      const end = start + this.findInput.value.length;
      this.updateFindCount();
      if (this.mode === "source") { this.source.focus(); this.source.setSelectionRange(start, end); }
      else this.setSurfaceSelection(this.model.rawOffset(start), this.model.rawOffset(end));
    }
    updateFindCount() { this.findCount.textContent = this.findMatches.length ? `${this.findIndex + 1} of ${this.findMatches.length}` : "0 of 0"; }
  }

  function previousCodeUnit(source, at) { if (!at) return 0; if (source[at - 1] === "\n" && source[at - 2] === "\r") return at - 2; return at > 1 && source.charCodeAt(at - 1) >= 0xdc00 && source.charCodeAt(at - 1) <= 0xdfff ? at - 2 : at - 1; }
  function nextCodeUnit(source, at) { if (at >= source.length) return at; return source.charCodeAt(at) >= 0xd800 && source.charCodeAt(at) <= 0xdbff ? at + 2 : at + 1; }
  function lineStart(source, at) { return Math.max(source.lastIndexOf("\n", Math.max(0, at - 1)), source.lastIndexOf("\r", Math.max(0, at - 1))) + 1; }
  function lineEnd(source, at) { const match = source.slice(Math.max(0, at)).search(/\r\n|\r|\n/); return match < 0 ? source.length : Math.max(0, at) + match; }
  function selectedLineRange(source, start, end) {
    const first = lineStart(source, start);
    const anchor = end > start ? Math.max(start, end - 1) : start;
    return { start: first, end: lineEnd(source, anchor) };
  }
  function transformPhysicalLines(source, transform) {
    const lines = [];
    const endings = [];
    let cursor = 0;
    while (cursor < source.length) {
      const found = source.slice(cursor).match(/\r\n|\r|\n/);
      if (!found) { lines.push(source.slice(cursor)); endings.push(""); break; }
      const at = cursor + found.index;
      lines.push(source.slice(cursor, at)); endings.push(found[0]); cursor = at + found[0].length;
    }
    if (!lines.length) { lines.push(""); endings.push(""); }
    return transform(lines).map((line, index) => line + endings[index]).join("");
  }
  function midViewportLine(scrollTop, clientHeight, lineHeight) { return lineHeight > 0 ? Math.floor((scrollTop + clientHeight / 2) / lineHeight) : 0; }
  function centerScroll(anchorTop, clientHeight, scrollHeight) { return Math.max(0, Math.min(Math.max(0, scrollHeight - clientHeight), anchorTop - clientHeight / 2)); }
  function scrollViewportFor(element) {
    let candidate = element;
    while (candidate && candidate !== document.body && candidate !== document.documentElement) {
      const overflow = window.getComputedStyle(candidate).overflowY;
      if ((overflow === "auto" || overflow === "scroll")
        && candidate.scrollHeight > candidate.clientHeight + 1) return candidate;
      candidate = candidate.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }
  function scrollViewportMiddle(scroller) {
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
      return window.innerHeight / 2;
    }
    const box = scroller.getBoundingClientRect();
    return box.top + scroller.clientHeight / 2;
  }
  Internals.MarkdownHistory = TransactionJournal;
  window.__editorTestHelpers = { midViewportLine, centerScroll, sourceOffsetForVisibleText, visibleOffsetForSourcePrefix, alignedScrollTop, clampedLine, projectionLine, selectedLineRange, transformPhysicalLines };
  window.AmoristEditor = { create };
})();
