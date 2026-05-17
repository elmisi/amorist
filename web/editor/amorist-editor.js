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

    handleWysiwygInput() {
      if (this.isSyncing) return;
      this.markdown = serializeBlocks(this.surface);
      this.source.value = this.markdown;
      this.emitChange();
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
        index += 2;
        while (index < lines.length && looksLikeTableRow(lines[index])) {
          tableLines.push(lines[index]);
          index += 1;
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

  function looksLikeTableRow(line) {
    return typeof line === "string" && line.includes("|") && splitTableRow(line).length >= 2;
  }

  function isTableSeparator(line) {
    const cells = splitTableRow(line);
    return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
  }

  function splitTableRow(line) {
    let value = String(line || "").trim();
    if (value.startsWith("|")) value = value.slice(1);
    if (value.endsWith("|")) value = value.slice(0, -1);
    return value.split("|").map((cell) => cell.trim());
  }

  function formatMarkdownTable(markdown) {
    const sourceRows = normalize(markdown)
      .split("\n")
      .filter((line) => line.trim())
      .map(splitTableRow);
    if (sourceRows.length < 2) return normalize(markdown).trim();

    const columnCount = Math.max(...sourceRows.map((row) => row.length));
    const rows = sourceRows.map((row) => {
      const cells = row.slice(0, columnCount);
      while (cells.length < columnCount) cells.push("");
      return cells;
    });
    const alignments = rows[1].map(tableAlignment);
    const contentRows = [rows[0], ...rows.slice(2)];
    const widths = Array.from({ length: columnCount }, (_, index) => {
      const contentWidth = Math.max(...contentRows.map((row) => tableCellWidth(row[index])));
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
    return `| ${row.map((cell, index) => padTableCell(cell, widths[index])).join(" | ")} |`;
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
