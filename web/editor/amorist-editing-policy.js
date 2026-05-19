(function () {
  const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "LI", "PRE"]);

  function create({ surface, onChanged }) {
    if (!surface) {
      throw new Error("AmoristEditingPolicy requires an editable surface.");
    }

    function notifyChanged() {
      if (typeof onChanged === "function") onChanged();
    }

    function runAction(action) {
      surface.focus();
      let changed = true;
      switch (action) {
        case "bold":
          document.execCommand("bold");
          break;
        case "italic":
          document.execCommand("italic");
          break;
        case "code":
          changed = wrapInline("code");
          break;
        case "link":
          changed = createLink(surface);
          break;
        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6":
          document.execCommand("formatBlock", false, action);
          break;
        case "bullet":
          document.execCommand("insertUnorderedList");
          break;
        case "ordered":
          document.execCommand("insertOrderedList");
          break;
        case "task":
          insertTask();
          break;
        case "quote":
          document.execCommand("formatBlock", false, "blockquote");
          break;
        case "codeblock":
          insertCodeBlock();
          break;
        default:
          changed = false;
      }
      if (changed) notifyChanged();
      return changed;
    }

    function applySpaceMarkdownShortcut(event) {
      const block = currentSelectionBlock(surface);
      if (!block || block.tagName === "PRE" || closestElement(block, "CODE")) return false;

      const before = normalizeShortcutText(textBeforeCaret(block));
      const after = normalizeShortcutText(textAfterCaret(block));
      const lineBefore = currentShortcutLine(before);
      const lineMarker = lineBefore.trim();

      if (block.tagName === "LI" && /^\[[ xX]\]$/.test(lineMarker)) {
        event.preventDefault();
        convertListItemToTask(block, /x/i.test(lineMarker), after.trimStart());
        notifyChanged();
        return true;
      }

      if (block.tagName === "LI" && lineMarker === ">" && isShortcutAtLineStart(before)) {
        event.preventDefault();
        const replacement = replaceListItemWithTag(block, "blockquote", after.trimStart());
        placeCaretAtEnd(replacement);
        notifyChanged();
        return true;
      }

      if (!isPlainTextBlock(block) || !isShortcutAtLineStart(before)) return false;

      const heading = lineMarker.match(/^(#{1,6})$/);
      if (heading) {
        event.preventDefault();
        const replacement = replaceBlockWithTag(block, `h${heading[1].length}`, after.trimStart());
        placeCaretAtEnd(replacement);
        notifyChanged();
        return true;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(lineMarker)) {
        event.preventDefault();
        const hr = document.createElement("hr");
        const p = document.createElement("p");
        p.append(document.createElement("br"));
        block.replaceWith(hr);
        hr.after(p);
        placeCaretAtEnd(p);
        notifyChanged();
        return true;
      }

      if (/^[-*+]$/.test(lineMarker)) {
        event.preventDefault();
        const item = replaceBlockWithList(block, "ul", after.trimStart());
        placeCaretAtEnd(item);
        notifyChanged();
        return true;
      }

      if (/^\d+\.$/.test(lineMarker)) {
        event.preventDefault();
        const item = replaceBlockWithList(block, "ol", after.trimStart());
        placeCaretAtEnd(item);
        notifyChanged();
        return true;
      }

      if (lineMarker === ">") {
        event.preventDefault();
        const replacement = replaceBlockWithTag(block, "blockquote", after.trimStart());
        placeCaretAtEnd(replacement);
        notifyChanged();
        return true;
      }

      return false;
    }

    function applyEnterMarkdownShortcut(event) {
      const block = currentSelectionBlock(surface);
      if (!block || !isPlainTextBlock(block)) return false;

      const before = textBeforeCaret(block).trim();
      const after = textAfterCaret(block).trim();
      if (after) return false;

      if (/^(`{3,}|~{3,})$/.test(before)) {
        event.preventDefault();
        const code = document.createElement("code");
        code.append(document.createElement("br"));
        const pre = document.createElement("pre");
        pre.append(code);
        block.replaceWith(pre);
        placeCaretAtEnd(code);
        notifyChanged();
        return true;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(before)) {
        event.preventDefault();
        const hr = document.createElement("hr");
        const p = document.createElement("p");
        p.append(document.createElement("br"));
        block.replaceWith(hr);
        hr.after(p);
        placeCaretAtEnd(p);
        notifyChanged();
        return true;
      }

      return false;
    }

    function applyInlineMarkdownShortcut() {
      const selection = window.getSelection();
      if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return false;
      const node = selection.anchorNode;
      if (!node || node.nodeType !== Node.TEXT_NODE || !surface.contains(node)) return false;
      if (closestElement(node, "CODE") || closestElement(node, "PRE")) return false;

      const offset = selection.anchorOffset;
      const text = node.textContent || "";
      const before = text.slice(0, offset);

      const codeMatch = before.match(/`([^`\n]+)`$/);
      if (codeMatch) {
        replaceTextShortcut(node, offset, codeMatch, "code");
        notifyChanged();
        return true;
      }

      const boldMatch = !hasOpenInlineCode(before) && before.match(/\*\*([^*\n]+)\*\*$/);
      if (boldMatch) {
        replaceTextShortcut(node, offset, boldMatch, "strong");
        notifyChanged();
        return true;
      }

      return false;
    }

    function insertPlainText(text) {
      document.execCommand("insertText", false, text);
      notifyChanged();
    }

    return {
      runAction,
      applySpaceMarkdownShortcut,
      applyEnterMarkdownShortcut,
      applyInlineMarkdownShortcut,
      insertPlainText,
    };
  }

  function wrapInline(tagName) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (range.collapsed) return false;
    const wrapper = document.createElement(tagName);
    wrapper.append(range.extractContents());
    range.insertNode(wrapper);
    selection.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(wrapper);
    selection.addRange(nextRange);
    return true;
  }

  function createLink(surface) {
    const href = window.prompt("URL");
    if (!href) return false;
    document.execCommand("createLink", false, href);
    surface.querySelectorAll("a").forEach((link) => {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
    return true;
  }

  function insertTask() {
    document.execCommand(
      "insertHTML",
      false,
      '<ul class="amorist-task-list"><li class="amorist-task-item" data-checked="false"><span class="amorist-task-checkbox" contenteditable="false"></span><span class="amorist-task-content">Task</span></li></ul>',
    );
  }

  function insertCodeBlock() {
    document.execCommand("insertHTML", false, "<pre><code>code</code></pre><p><br></p>");
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

  function normalizeShortcutText(text) {
    return String(text || "").replace(/\u00a0/g, " ").replace(/\u200b/g, "");
  }

  function currentShortcutLine(text) {
    const lines = normalizeShortcutText(text).split("\n");
    return lines[lines.length - 1] || "";
  }

  function isShortcutAtLineStart(text) {
    const line = currentShortcutLine(text);
    return /^[ \t]{0,3}\S*$/.test(line);
  }

  function isPlainTextBlock(block) {
    return block.tagName === "P" || block.tagName === "DIV" ||
      /^H[1-6]$/.test(block.tagName);
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

  function replaceListItemWithTag(item, tagName, text) {
    const list = item.parentElement;
    const replacement = document.createElement(tagName);
    setPlainContent(replacement, text);

    if (!list || (list.tagName !== "UL" && list.tagName !== "OL")) {
      item.replaceWith(replacement);
      return replacement;
    }

    const beforeList = cloneListShell(list);
    while (list.firstElementChild && list.firstElementChild !== item) {
      beforeList.append(list.firstElementChild);
    }

    const afterList = cloneListShell(list);
    while (item.nextElementSibling) {
      afterList.append(item.nextElementSibling);
    }

    const nodes = [];
    if (beforeList.children.length) nodes.push(beforeList);
    nodes.push(replacement);
    if (afterList.children.length) nodes.push(afterList);
    list.replaceWith(...nodes);
    return replacement;
  }

  function cloneListShell(list) {
    const clone = document.createElement(list.tagName.toLowerCase());
    clone.className = list.className;
    return clone;
  }

  function convertListItemToTask(item, checked, text) {
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

  function replaceTextShortcut(node, offset, match, tagName) {
    const text = node.textContent || "";
    const start = offset - match[0].length;
    const beforeNodeText = text.slice(0, start);
    const afterNodeText = text.slice(offset);
    const element = document.createElement(tagName);
    element.textContent = match[1];
    const afterNode = document.createTextNode(afterNodeText || "\u200b");

    const replacements = [];
    if (beforeNodeText) replacements.push(document.createTextNode(beforeNodeText));
    replacements.push(element);
    replacements.push(afterNode);
    node.replaceWith(...replacements);
    placeCaretInTextNode(afterNode, afterNodeText ? 0 : 1);
  }

  function hasOpenInlineCode(text) {
    return (text.match(/`/g) || []).length % 2 === 1;
  }

  function placeCaretInTextNode(node, offset) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStart(node, offset);
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

  const Internals = window.AmoristInternals || (window.AmoristInternals = {});
  Internals.EditingPolicy = { create };
})();
