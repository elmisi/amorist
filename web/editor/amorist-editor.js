(function () {
  const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "BLOCKQUOTE", "LI", "PRE"]);
  const GRAPHEME_SEGMENTER = typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

  function create(container, options) {
    return new AmoristEditor(container, options || {});
  }

  class AmoristEditor {
    constructor(container, options) {
      this.container = container;
      this.options = options;
      this.markdown = normalize(options.value || "");
      this.mode = "wysiwyg";
      this.isSyncing = false;
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

      this.root.append(this.toolbar, this.surface, this.source);
      this.container.replaceChildren(this.root);
      this.buildToolbar();
      this.bind();
      this.setMarkdown(this.markdown, { silent: true });
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
        this.markdown = normalize(this.source.value);
        this.emitChange();
      });
    }

    destroy() {
      this.container.replaceChildren();
    }

    focus() {
      if (this.mode === "source") this.source.focus();
      else this.surface.focus();
    }

    getMarkdown() {
      if (this.mode === "source") {
        this.markdown = normalize(this.source.value);
      } else {
        this.markdown = serializeBlocks(this.surface);
      }
      return this.markdown;
    }

    getValue() {
      return this.getMarkdown();
    }

    setMarkdown(markdown, options) {
      this.markdown = normalize(markdown || "");
      this.isSyncing = true;
      this.surface.innerHTML = renderMarkdown(this.markdown);
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

      this.surface.focus();
      switch (action) {
        case "bold":
          document.execCommand("bold");
          break;
        case "italic":
          document.execCommand("italic");
          break;
        case "code":
          this.wrapInline("code");
          break;
        case "link":
          this.createLink();
          break;
        case "h1":
        case "h2":
        case "h3":
          document.execCommand("formatBlock", false, action);
          break;
        case "bullet":
          document.execCommand("insertUnorderedList");
          break;
        case "ordered":
          document.execCommand("insertOrderedList");
          break;
        case "task":
          this.insertTask();
          break;
        case "quote":
          document.execCommand("formatBlock", false, "blockquote");
          break;
        case "codeblock":
          this.insertCodeBlock();
          break;
      }
      this.handleWysiwygInput();
    }

    wrapInline(tagName) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (range.collapsed) return;
      const wrapper = document.createElement(tagName);
      wrapper.append(range.extractContents());
      range.insertNode(wrapper);
      selection.removeAllRanges();
      const nextRange = document.createRange();
      nextRange.selectNodeContents(wrapper);
      selection.addRange(nextRange);
    }

    createLink() {
      const href = window.prompt("URL");
      if (!href) return;
      document.execCommand("createLink", false, href);
      this.surface.querySelectorAll("a").forEach((link) => {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      });
    }

    insertTask() {
      document.execCommand(
        "insertHTML",
        false,
        '<ul class="amorist-task-list"><li class="amorist-task-item" data-checked="false"><span class="amorist-task-checkbox" contenteditable="false"></span><span class="amorist-task-content">Task</span></li></ul>',
      );
    }

    insertCodeBlock() {
      document.execCommand("insertHTML", false, "<pre><code>code</code></pre><p><br></p>");
    }

    handleEditorKeyDown(event) {
      if (this.mode !== "wysiwyg" || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
        return;
      }
      if (event.key === " ") {
        this.applySpaceMarkdownShortcut(event);
      } else if (event.key === "Enter") {
        this.applyEnterMarkdownShortcut(event);
      }
    }

    applySpaceMarkdownShortcut(event) {
      const block = currentSelectionBlock(this.surface);
      if (!block || block.tagName === "PRE" || closestElement(block, "CODE")) return;

      const before = textBeforeCaret(block).replace(/\u00a0/g, " ");
      const after = textAfterCaret(block).replace(/\u00a0/g, " ");
      const marker = before.trim();

      if (block.tagName === "LI" && /^\[[ xX]\]$/.test(marker)) {
        event.preventDefault();
        this.convertListItemToTask(block, /x/i.test(marker), after.trimStart());
        return;
      }

      if (!isPlainTextBlock(block) || before !== marker) return;

      const heading = marker.match(/^(#{1,3})$/);
      if (heading) {
        event.preventDefault();
        const replacement = replaceBlockWithTag(block, `h${heading[1].length}`, after.trimStart());
        placeCaretAtEnd(replacement);
        this.handleWysiwygInput();
        return;
      }

      if (/^[-*+]$/.test(marker)) {
        event.preventDefault();
        const item = replaceBlockWithList(block, "ul", after.trimStart());
        placeCaretAtEnd(item);
        this.handleWysiwygInput();
        return;
      }

      if (/^\d+\.$/.test(marker)) {
        event.preventDefault();
        const item = replaceBlockWithList(block, "ol", after.trimStart());
        placeCaretAtEnd(item);
        this.handleWysiwygInput();
        return;
      }

      if (marker === ">") {
        event.preventDefault();
        const replacement = replaceBlockWithTag(block, "blockquote", after.trimStart());
        placeCaretAtEnd(replacement);
        this.handleWysiwygInput();
      }
    }

    applyEnterMarkdownShortcut(event) {
      const block = currentSelectionBlock(this.surface);
      if (!block || !isPlainTextBlock(block)) return;

      const before = textBeforeCaret(block).trim();
      const after = textAfterCaret(block).trim();
      if (after || !/^(`{3,}|~{3,})$/.test(before)) return;

      event.preventDefault();
      const code = document.createElement("code");
      code.append(document.createElement("br"));
      const pre = document.createElement("pre");
      pre.append(code);
      block.replaceWith(pre);
      placeCaretAtEnd(code);
      this.handleWysiwygInput();
    }

    convertListItemToTask(item, checked, text) {
      const list = item.closest("ul");
      if (list) list.classList.add("amorist-task-list");
      item.className = "amorist-task-item";
      item.dataset.checked = String(checked);

      const checkbox = document.createElement("span");
      checkbox.className = "amorist-task-checkbox";
      checkbox.contentEditable = "false";

      const content = document.createElement("span");
      content.className = "amorist-task-content";
      setPlainContent(content, text);

      item.replaceChildren(checkbox, content);
      placeCaretAtEnd(content);
      this.handleWysiwygInput();
    }

    handleWysiwygInput() {
      if (this.isSyncing) return;
      this.applyInlineCodeShortcut();
      this.markdown = serializeBlocks(this.surface);
      this.source.value = this.markdown;
      this.emitChange();
    }

    applyInlineCodeShortcut() {
      const selection = window.getSelection();
      if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return;
      const node = selection.anchorNode;
      if (!node || node.nodeType !== Node.TEXT_NODE || !this.surface.contains(node)) return;
      if (closestElement(node, "CODE") || closestElement(node, "PRE")) return;

      const offset = selection.anchorOffset;
      const text = node.textContent || "";
      const before = text.slice(0, offset);
      const match = before.match(/`([^`\n]+)`$/);
      if (!match) return;

      const start = offset - match[0].length;
      const beforeNodeText = text.slice(0, start);
      const afterNodeText = text.slice(offset);
      const code = document.createElement("code");
      code.textContent = match[1];

      const replacements = [];
      if (beforeNodeText) replacements.push(document.createTextNode(beforeNodeText));
      replacements.push(code);
      if (afterNodeText) replacements.push(document.createTextNode(afterNodeText));
      node.replaceWith(...replacements);
      placeCaretAfter(code);
    }

    handlePaste(event) {
      const text = event.clipboardData && event.clipboardData.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      document.execCommand("insertText", false, text);
    }

    handleClick(event) {
      const checkbox = event.target.closest(".amorist-task-checkbox");
      if (!checkbox) return;
      const item = checkbox.closest(".amorist-task-item");
      if (!item) return;
      item.dataset.checked = item.dataset.checked === "true" ? "false" : "true";
      this.handleWysiwygInput();
    }

    emitChange() {
      if (typeof this.options.onChange === "function") {
        this.options.onChange(this.markdown);
      }
    }

    updateSourceButton() {
      const button = this.toolbar.querySelector('[data-action="source"]');
      if (button) button.setAttribute("aria-pressed", String(this.mode === "source"));
    }

    captureScrollPosition() {
      if (this.mode === "source") {
        const lineHeight = sourceLineHeight(this.source);
        const maxScroll = Math.max(0, this.source.scrollHeight - this.source.clientHeight);
        return {
          line: Math.max(0, Math.floor(this.source.scrollTop / lineHeight)),
          progress: maxScroll > 0 ? this.source.scrollTop / maxScroll : 0,
        };
      }

      const visibleTop = viewportContentTop(this.toolbar);
      const visibleBlock = Array.from(this.surface.children).find((child) => {
        const rect = child.getBoundingClientRect();
        return rect.bottom > visibleTop;
      });
      const surfaceRect = this.surface.getBoundingClientRect();
      const progress = clamp(
        (visibleTop - surfaceRect.top) / Math.max(1, this.surface.scrollHeight),
        0,
        1,
      );

      return {
        line: visibleBlock ? Number(visibleBlock.dataset.sourceLine || 0) : 0,
        progress,
      };
    }

    restoreScrollPosition(position) {
      if (!position) return;

      const restore = () => {
        if (this.mode === "source") {
          const maxScroll = Math.max(0, this.source.scrollHeight - this.source.clientHeight);
          const lineTop = position.line * sourceLineHeight(this.source);
          this.source.scrollTop = clamp(lineTop, 0, maxScroll);
          window.scrollTo({ top: Math.max(0, documentTop(this.root) - topbarHeight()) });
          return;
        }

        const target = blockForSourceLine(this.surface, position.line);
        if (target) {
          window.scrollTo({
            top: Math.max(0, documentTop(target) - viewportContentTop(this.toolbar)),
          });
          return;
        }

        const surfaceTop = documentTop(this.surface);
        const y = surfaceTop + (this.surface.scrollHeight * position.progress) - viewportContentTop(this.toolbar);
        window.scrollTo({ top: Math.max(0, y) });
      };

      restore();
      window.requestAnimationFrame(restore);
    }
  }

  function renderMarkdown(markdown) {
    const blocks = parseBlocks(markdown);
    if (blocks.length === 0) return '<p><br></p>';
    return blocks.map(renderBlock).join("");
  }

  function parseBlocks(markdown) {
    const lines = normalize(markdown).split("\n");
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }
      const sourceLine = index;

      const fence = line.match(/^ {0,3}(`{3,}|~{3,}).*$/);
      if (fence) {
        const fenceMarker = fence[1][0];
        const fenceLength = fence[1].length;
        const closingFence = new RegExp(`^ {0,3}\\${fenceMarker}{${fenceLength},}\\s*$`);
        const code = [];
        index += 1;
        while (index < lines.length && !closingFence.test(lines[index])) {
          code.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        blocks.push({ type: "code", text: code.join("\n"), sourceLine });
        continue;
      }

      if (isTableStart(lines, index)) {
        const tableLines = [lines[index], lines[index + 1]];
        const tableColumnCount = splitTableRow(lines[index + 1]).length;
        index += 2;
        while (index < lines.length) {
          if (looksLikeTableRow(lines[index], tableColumnCount)) {
            tableLines.push(lines[index]);
            index += 1;
            continue;
          }

          if (!lines[index].trim()) {
            const nextTableRow = nextNonEmptyTableRow(lines, index + 1, tableColumnCount);
            if (nextTableRow > index) {
              index = nextTableRow;
              continue;
            }
          }

          break;
        }
        blocks.push({ type: "table", text: formatMarkdownTable(tableLines.join("\n")), sourceLine });
        continue;
      }

      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        blocks.push({ type: "heading", level: heading[1].length, text: heading[2], sourceLine });
        index += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          quote.push(lines[index].replace(/^>\s?/, ""));
          index += 1;
        }
        blocks.push({ type: "quote", text: quote.join(" "), sourceLine });
        continue;
      }

      if (/^[-*+]\s+\[[ xX]\]\s+/.test(line)) {
        const items = [];
        while (index < lines.length) {
          const task = lines[index].match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
          if (!task) break;
          items.push({ checked: task[1].trim().toLowerCase() === "x", text: task[2] });
          index += 1;
        }
        blocks.push({ type: "taskList", items, sourceLine });
        continue;
      }

      if (/^[-*+]\s+/.test(line)) {
        const items = [];
        while (index < lines.length) {
          const bullet = lines[index].match(/^[-*+]\s+(.*)$/);
          if (!bullet || /^[-*+]\s+\[[ xX]\]\s+/.test(lines[index])) break;
          items.push(bullet[1]);
          index += 1;
        }
        blocks.push({ type: "bulletList", items, sourceLine });
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        const items = [];
        while (index < lines.length) {
          const ordered = lines[index].match(/^\d+\.\s+(.*)$/);
          if (!ordered) break;
          items.push(ordered[1]);
          index += 1;
        }
        blocks.push({ type: "orderedList", items, sourceLine });
        continue;
      }

      const paragraph = [line];
      index += 1;
      while (
        index < lines.length &&
        lines[index].trim() &&
        !isBlockStart(lines, index)
      ) {
        paragraph.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "paragraph", text: paragraph.join(" "), sourceLine });
    }

    return blocks;
  }

  function isBlockStart(lines, index) {
    const line = Array.isArray(lines) ? lines[index] : lines;
    return /^(#{1,3})\s+/.test(line) ||
      /^ {0,3}(`{3,}|~{3,})/.test(line) ||
      /^>\s?/.test(line) ||
      /^[-*+]\s+/.test(line) ||
      /^\d+\.\s+/.test(line) ||
      (Array.isArray(lines) && isTableStart(lines, index));
  }

  function renderBlock(block) {
    const attrs = sourceLineAttr(block);
    switch (block.type) {
      case "heading":
        return `<h${block.level}${attrs}>${renderInline(block.text)}</h${block.level}>`;
      case "quote":
        return `<blockquote${attrs}>${renderInline(block.text)}</blockquote>`;
      case "code":
        return `<pre${attrs}><code>${escapeHtml(block.text)}</code></pre>`;
      case "table":
        return `<pre class="amorist-markdown-table" data-block-type="table"${attrs}><code>${escapeHtml(block.text)}</code></pre>`;
      case "taskList":
        return `<ul class="amorist-task-list"${attrs}>${block.items.map((item) =>
          `<li class="amorist-task-item" data-checked="${item.checked}"><span class="amorist-task-checkbox" contenteditable="false"></span><span class="amorist-task-content">${renderInline(item.text)}</span></li>`,
        ).join("")}</ul>`;
      case "bulletList":
        return `<ul${attrs}>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`;
      case "orderedList":
        return `<ol${attrs}>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`;
      default:
        return `<p${attrs}>${renderInline(block.text)}</p>`;
    }
  }

  function sourceLineAttr(block) {
    return ` data-source-line="${Number(block.sourceLine || 0)}"`;
  }

  function renderInline(text) {
    const tokens = [];
    let source = escapeHtml(text);
    source = source.replace(/`([^`]+)`/g, (_, code) => token(tokens, `<code>${code}</code>`));
    source = source.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) =>
      token(tokens, `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`),
    );
    source = source.replace(/\*\*([^*]+)\*\*/g, (_, value) => token(tokens, `<strong>${value}</strong>`));
    source = source.replace(/\*([^*]+)\*/g, (_, value) => token(tokens, `<em>${value}</em>`));
    tokens.forEach((value, index) => {
      source = source.replace(`\u0000${index}\u0000`, value);
    });
    return source || "<br>";
  }

  function token(tokens, html) {
    const index = tokens.push(html) - 1;
    return `\u0000${index}\u0000`;
  }

  function serializeBlocks(surface) {
    const lines = [];
    Array.from(surface.children).forEach((child) => {
      serializeBlock(child, lines);
    });
    return lines.join("\n\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  }

  function serializeBlock(element, lines) {
    const tag = element.tagName;
    if (tag === "H1" || tag === "H2" || tag === "H3") {
      lines.push(`${"#".repeat(Number(tag.slice(1)))} ${inlineMarkdown(element)}`);
      return;
    }
    if (tag === "BLOCKQUOTE") {
      lines.push(`> ${inlineMarkdown(element)}`);
      return;
    }
    if (tag === "PRE") {
      if (element.dataset.blockType === "table" || element.classList.contains("amorist-markdown-table")) {
        lines.push(formatMarkdownTable(element.textContent));
        return;
      }
      lines.push(`\`\`\`\n${element.textContent.replace(/\n$/, "")}\n\`\`\``);
      return;
    }
    if (tag === "UL") {
      Array.from(element.children).forEach((item) => {
        if (item.classList.contains("amorist-task-item")) {
          const checked = item.dataset.checked === "true" ? "x" : " ";
          lines.push(`- [${checked}] ${inlineMarkdown(item.querySelector(".amorist-task-content") || item)}`);
        } else {
          lines.push(`- ${inlineMarkdown(item)}`);
        }
      });
      return;
    }
    if (tag === "OL") {
      Array.from(element.children).forEach((item, index) => {
        lines.push(`${index + 1}. ${inlineMarkdown(item)}`);
      });
      return;
    }
    if (tag === "DIV" && BLOCK_TAGS.has(element.firstElementChild?.tagName || "")) {
      Array.from(element.children).forEach((child) => serializeBlock(child, lines));
      return;
    }
    lines.push(inlineMarkdown(element));
  }

  function inlineMarkdown(node) {
    let output = "";
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        output += child.textContent;
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const element = child;
      if (element.classList.contains("amorist-task-checkbox")) return;
      switch (element.tagName) {
        case "STRONG":
        case "B":
          output += `**${inlineMarkdown(element)}**`;
          break;
        case "EM":
        case "I":
          output += `*${inlineMarkdown(element)}*`;
          break;
        case "CODE":
          output += `\`${element.textContent}\``;
          break;
        case "A":
          output += `[${inlineMarkdown(element)}](${element.getAttribute("href") || ""})`;
          break;
        case "BR":
          output += "\n";
          break;
        default:
          output += inlineMarkdown(element);
      }
    });
    return output.replace(/\u00a0/g, " ").trim();
  }

  function currentSelectionBlock(surface) {
    const selection = window.getSelection();
    if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null;
    let node = selection.anchorNode;
    while (node && node !== surface) {
      if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName)) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function textBeforeCaret(block) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return "";
    const range = selection.getRangeAt(0).cloneRange();
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.endContainer, range.endOffset);
    return before.toString();
  }

  function textAfterCaret(block) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return "";
    const range = selection.getRangeAt(0).cloneRange();
    const after = document.createRange();
    after.selectNodeContents(block);
    after.setStart(range.endContainer, range.endOffset);
    return after.toString();
  }

  function isPlainTextBlock(block) {
    return block.tagName === "P" || block.tagName === "DIV" ||
      block.tagName === "H1" || block.tagName === "H2" || block.tagName === "H3";
  }

  function replaceBlockWithTag(block, tagName, text) {
    const replacement = document.createElement(tagName);
    setPlainContent(replacement, text);
    block.replaceWith(replacement);
    return replacement;
  }

  function replaceBlockWithList(block, tagName, text) {
    const list = document.createElement(tagName);
    const item = document.createElement("li");
    setPlainContent(item, text);
    list.append(item);
    block.replaceWith(list);
    return item;
  }

  function setPlainContent(element, text) {
    element.replaceChildren();
    if (text) {
      element.textContent = text;
    } else {
      element.append(document.createElement("br"));
    }
  }

  function placeCaretAtEnd(element) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function placeCaretAfter(element) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStartAfter(element);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function closestElement(node, tagName) {
    let current = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (current) {
      if (current.tagName === tagName) return current;
      current = current.parentElement;
    }
    return null;
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

  function normalize(markdown) {
    return String(markdown).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function isTableStart(lines, index) {
    return looksLikeTableRow(lines[index]) && isTableSeparator(lines[index + 1] || "");
  }

  function looksLikeTableRow(line, expectedColumnCount) {
    if (typeof line !== "string" || !line.includes("|")) return false;
    const cells = splitTableRow(line);
    const minimumColumns = expectedColumnCount || 2;
    return cells.length >= minimumColumns;
  }

  function nextNonEmptyTableRow(lines, index, expectedColumnCount) {
    let next = index;
    while (next < lines.length && !lines[next].trim()) {
      next += 1;
    }
    return looksLikeTableRow(lines[next], expectedColumnCount) ? next : -1;
  }

  function isTableSeparator(line) {
    const cells = splitTableRow(line);
    return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
  }

  function splitTableRow(line, expectedColumnCount) {
    let value = String(line || "").trim();
    if (value.startsWith("|")) value = value.slice(1);
    if (value.endsWith("|")) value = value.slice(0, -1);

    const cells = [];
    let cell = "";
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (char === "\\") {
        const next = value[index + 1];
        if (next === "|") {
          cell += "|";
          index += 1;
        } else {
          cell += char;
        }
        continue;
      }
      if (char === "|") {
        cells.push(cell.trim());
        cell = "";
        continue;
      }
      cell += char;
    }
    cells.push(cell.trim());

    if (expectedColumnCount && cells.length > expectedColumnCount) {
      return [
        ...cells.slice(0, expectedColumnCount - 1),
        cells.slice(expectedColumnCount - 1).join(" | ").trim(),
      ];
    }

    return cells;
  }

  function formatMarkdownTable(markdown) {
    const sourceLines = normalize(markdown)
      .split("\n")
      .filter((line) => line.trim());
    if (sourceLines.length < 2) return normalize(markdown).trim();

    const headerRow = splitTableRow(sourceLines[0] || "");
    const separatorRow = splitTableRow(sourceLines[1] || "");
    const columnCount = separatorRow.length || headerRow.length;
    const sourceRows = [
      normalizeTableRow(headerRow, columnCount),
      normalizeTableRow(separatorRow, columnCount),
      ...sourceLines.slice(2).map((line) => normalizeTableRow(splitTableRow(line), columnCount, headerRow)),
    ];
    if (sourceRows.length < 2) return normalize(markdown).trim();

    const rows = sourceRows;
    const alignments = rows[1].map(tableAlignment);
    const contentRows = [rows[0], ...rows.slice(2)];
    const widths = Array.from({ length: columnCount }, (_, index) => {
      const contentWidth = Math.max(...contentRows.map((row) => tableCellWidth(escapeTableCell(row[index]))));
      return Math.max(3, contentWidth);
    });

    const header = formatTableRow(rows[0], widths);
    const separator = formatTableSeparator(widths, alignments);
    const body = rows.slice(2).map((row) => formatTableRow(row, widths));
    return [header, separator, ...body].join("\n");
  }

  function tableAlignment(cell) {
    const trimmed = String(cell || "").trim();
    if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
    if (trimmed.endsWith(":")) return "right";
    return "left";
  }

  function formatTableRow(row, widths) {
    return `| ${row.map((cell, index) => padTableCell(escapeTableCell(cell), widths[index])).join(" | ")} |`;
  }

  function formatTableSeparator(widths, alignments) {
    return `| ${widths.map((width, index) => {
      const dashes = "-".repeat(width);
      if (alignments[index] === "center") return `:${dashes.slice(1, -1)}:`;
      if (alignments[index] === "right") return `${dashes.slice(0, -1)}:`;
      return dashes;
    }).join(" | ")} |`;
  }

  function padTableCell(cell, width) {
    const value = String(cell || "").trim();
    return value + " ".repeat(Math.max(0, width - tableCellWidth(value)));
  }

  function normalizeTableRow(row, columnCount, headerRow) {
    const repaired = repairApiMethodRow(row, columnCount, headerRow);
    const cells = repaired.slice(0, columnCount);
    while (cells.length < columnCount) cells.push("");
    return cells;
  }

  function repairApiMethodRow(row, columnCount, headerRow) {
    if (!headerRow || row.length <= columnCount) return row;

    const methodIndex = headerRow.findIndex((cell) => /^(metodo|method)$/i.test(stripMarkdownCode(cell)));
    const mergeIndex = methodIndex - 1;
    if (methodIndex < 1 || mergeIndex < 0) {
      return mergeExtraTableCells(row, columnCount);
    }

    const actualMethodIndex = row.findIndex((cell, index) =>
      index > methodIndex && isHttpMethodCell(cell),
    );
    if (actualMethodIndex <= methodIndex) {
      return mergeExtraTableCells(row, columnCount);
    }

    const repaired = [
      ...row.slice(0, mergeIndex),
      row.slice(mergeIndex, actualMethodIndex).join(" | ").trim(),
      row[actualMethodIndex],
      ...row.slice(actualMethodIndex + 1),
    ];
    return mergeExtraTableCells(repaired, columnCount);
  }

  function mergeExtraTableCells(row, columnCount) {
    if (row.length <= columnCount) return row;
    return [
      ...row.slice(0, columnCount - 1),
      row.slice(columnCount - 1).join(" | ").trim(),
    ];
  }

  function isHttpMethodCell(cell) {
    return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(stripMarkdownCode(cell));
  }

  function stripMarkdownCode(value) {
    return String(value || "").trim().replace(/^`+|`+$/g, "");
  }

  function escapeTableCell(cell) {
    return String(cell || "").replace(/\\?\|/g, "\\|");
  }

  function tableCellWidth(value) {
    const text = String(value || "").normalize("NFC");
    if (!text) return 0;

    const graphemes = GRAPHEME_SEGMENTER
      ? Array.from(GRAPHEME_SEGMENTER.segment(text), (part) => part.segment)
      : Array.from(text);

    return graphemes.reduce((width, grapheme) => width + graphemeWidth(grapheme), 0);
  }

  function graphemeWidth(grapheme) {
    let width = 0;
    let hasEmoji = false;

    for (const char of grapheme) {
      const codePoint = char.codePointAt(0);
      if (isZeroWidthCodePoint(codePoint) || isCombiningCodePoint(codePoint)) {
        continue;
      }
      if (isEmojiCodePoint(codePoint)) {
        hasEmoji = true;
      }
      width += isWideCodePoint(codePoint) ? 2 : 1;
    }

    return hasEmoji ? 2 : width;
  }

  function isZeroWidthCodePoint(codePoint) {
    return codePoint === 0x200d ||
      codePoint === 0xfe0e ||
      codePoint === 0xfe0f;
  }

  function isCombiningCodePoint(codePoint) {
    return (codePoint >= 0x0300 && codePoint <= 0x036f) ||
      (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
      (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
      (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
      (codePoint >= 0xfe20 && codePoint <= 0xfe2f);
  }

  function isEmojiCodePoint(codePoint) {
    return (codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
      (codePoint >= 0x2300 && codePoint <= 0x23ff) ||
      (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
      (codePoint >= 0x2b00 && codePoint <= 0x2bff);
  }

  function isWideCodePoint(codePoint) {
    return (codePoint >= 0x1100 && codePoint <= 0x115f) ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  window.AmoristEditor = { create };
})();
