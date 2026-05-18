(function () {
  const Internals = window.AmoristInternals || {};
  const TextUtils = Internals.TextUtils;
  const MarkdownCodec = Internals.MarkdownCodec;
  const EditingPolicy = Internals.EditingPolicy;

  if (!TextUtils) {
    throw new Error("AmoristTextUtils must be loaded before AmoristEditor.");
  }
  if (!MarkdownCodec) {
    throw new Error("AmoristMarkdownCodec must be loaded before AmoristEditor.");
  }
  if (!EditingPolicy) {
    throw new Error("AmoristEditingPolicy must be loaded before AmoristEditor.");
  }

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
      this.editing = EditingPolicy.create({
        surface: this.surface,
        onChanged: () => this.syncWysiwygInput(),
      });
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
        this.markdown = TextUtils.normalize(this.source.value);
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
        this.markdown = TextUtils.normalize(this.source.value);
      } else {
        this.markdown = MarkdownCodec.serializeBlocks(this.surface);
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

      this.editing.runAction(action);
    }

    handleEditorKeyDown(event) {
      if (this.mode !== "wysiwyg" || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
        return;
      }
      if (event.key === " ") {
        this.editing.applySpaceMarkdownShortcut(event);
      } else if (event.key === "Enter") {
        this.editing.applyEnterMarkdownShortcut(event);
      }
    }

    handleWysiwygInput() {
      if (this.isSyncing) return;
      if (this.editing.applyInlineMarkdownShortcut()) return;
      this.syncWysiwygInput();
    }

    syncWysiwygInput() {
      if (this.isSyncing) return;
      this.markdown = MarkdownCodec.serializeBlocks(this.surface);
      this.source.value = this.markdown;
      this.emitChange();
    }

    handlePaste(event) {
      const text = event.clipboardData && event.clipboardData.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      this.editing.insertPlainText(text);
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
