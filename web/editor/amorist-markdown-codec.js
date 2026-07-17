(function () {
  const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "LI", "PRE", "HR"]);
  const HR_PATTERN = /^(-{3,}|\*{3,}|_{3,})\s*$/;
  // Sentinel framing inline-render placeholders (see createInlineTokenizer).
  // A Private Use Area code point: it never occurs in real prose, survives the
  // HTML parser intact (unlike NUL, which the parser silently strips — the root
  // of the bold-wrapping-inline-code corruption bug), and stays readable in
  // editors and grep. Defined once here and derived into the matching pattern.
  const PLACEHOLDER_MARK = String.fromCodePoint(0xe000);
  const PLACEHOLDER_PATTERN = new RegExp(`${PLACEHOLDER_MARK}(\\d+)${PLACEHOLDER_MARK}`, "g");
  const Internals = window.AmoristInternals || (window.AmoristInternals = {});
  const TextUtils = Internals.TextUtils;
  const TableCodec = Internals.TableCodec;
  if (!TextUtils) {
    throw new Error("AmoristTextUtils must be loaded before AmoristMarkdownCodec.");
  }
  if (!TableCodec) {
    throw new Error("AmoristTableCodec must be loaded before AmoristMarkdownCodec.");
  }

  function renderMarkdown(markdown) {
    const blocks = parseBlocks(markdown);
    if (blocks.length === 0) return "<p><br></p>";
    return blocks.map(renderBlock).join("");
  }

  function parseBlocks(markdown) {
    const lines = TextUtils.normalize(markdown).split("\n");
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

      if (TableCodec.isTableStart(lines, index)) {
        const tableLines = [lines[index], lines[index + 1]];
        const tableColumnCount = TableCodec.splitTableRow(lines[index + 1]).length;
        index += 2;
        while (index < lines.length) {
          if (TableCodec.looksLikeTableRow(lines[index], tableColumnCount)) {
            tableLines.push(lines[index]);
            index += 1;
            continue;
          }

          if (!lines[index].trim()) {
            const nextTableRow = TableCodec.nextNonEmptyTableRow(lines, index + 1, tableColumnCount);
            if (nextTableRow > index) {
              index = nextTableRow;
              continue;
            }
          }

          break;
        }
        blocks.push({ type: "table", text: TableCodec.formatMarkdownTable(tableLines.join("\n")), sourceLine });
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
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
        blocks.push({ type: "quote", text: joinTextLines(quote), sourceLine });
        continue;
      }

      if (matchListItem(line)) {
        const list = parseList(lines, index);
        blocks.push(list.block);
        index = list.nextIndex;
        continue;
      }

      if (HR_PATTERN.test(line)) {
        blocks.push({ type: "hr", sourceLine });
        index += 1;
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
      blocks.push({ type: "paragraph", text: joinTextLines(paragraph), sourceLine });
    }

    return blocks;
  }

  // Joins the lines of one block. A newline between them is a soft break, i.e. a
  // space — that is what lets prose be wrapped in the source without the wrap
  // reaching the reader. Only an explicit CommonMark marker (two trailing spaces
  // or a trailing backslash) is a hard break, carried as "\n" in the block text
  // and rendered as <br>.
  function joinTextLines(lines) {
    const parts = lines.map(splitHardBreak);
    return parts.reduce((text, part, index) => (
      index === 0 ? part.text : text + (parts[index - 1].hardBreak ? "\n" : " ") + part.text
    ), "");
  }

  function splitHardBreak(line) {
    const backslash = line.match(/^(.*)\\$/);
    if (backslash) return { text: backslash[1], hardBreak: true };
    const spaces = line.match(/^(.*\S) {2,}$/);
    if (spaces) return { text: spaces[1], hardBreak: true };
    return { text: line, hardBreak: false };
  }

  // A list line: leading indent, a marker, and the item's own text. The indent
  // is what makes nesting work — it is the only thing distinguishing a sublist
  // from a sibling item, so it must be captured rather than anchored away.
  function matchListItem(line) {
    const match = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (!match) return null;
    const bullet = match[2] !== "" && !/\d/.test(match[2]);
    const task = bullet ? match[3].match(/^\[([ xX])\]\s+(.*)$/) : null;
    return {
      indent: match[1].length,
      type: task ? "taskList" : (bullet ? "bulletList" : "orderedList"),
      checked: Boolean(task) && task[1].toLowerCase() === "x",
      text: task ? task[2] : match[3],
    };
  }

  // Consumes one list, recursing into sublists. Items are collected while the
  // marker stays at the list's own indent; anything deeper becomes a child of
  // the item above it, anything shallower (or a different marker type) ends the
  // list and is left for the caller.
  function parseList(lines, start) {
    const first = matchListItem(lines[start]);
    const listIndent = first.indent;
    const block = { type: first.type, items: [], sourceLine: start };
    let index = start;

    while (index < lines.length) {
      let probe = index;
      while (probe < lines.length && !lines[probe].trim()) probe += 1;
      if (probe >= lines.length) break;

      const item = matchListItem(lines[probe]);
      if (!item || item.indent < listIndent) break;

      if (item.indent > listIndent) {
        if (block.items.length === 0) break;
        const nested = parseList(lines, probe);
        block.items[block.items.length - 1].children.push(nested.block);
        index = nested.nextIndex;
        continue;
      }

      if (item.type !== block.type) break;
      block.items.push(makeListItem(block.type, item));
      index = probe + 1;
    }

    return { block, nextIndex: index };
  }

  function makeListItem(type, item) {
    return type === "taskList"
      ? { checked: item.checked, text: item.text, children: [] }
      : { text: item.text, children: [] };
  }

  function isBlockStart(lines, index) {
    const line = Array.isArray(lines) ? lines[index] : lines;
    return /^(#{1,6})\s+/.test(line) ||
      /^ {0,3}(`{3,}|~{3,})/.test(line) ||
      /^>\s?/.test(line) ||
      Boolean(matchListItem(line)) ||
      HR_PATTERN.test(line) ||
      (Array.isArray(lines) && TableCodec.isTableStart(lines, index));
  }

  function renderBlock(block) {
    const attrs = sourceLineAttr(block);
    switch (block.type) {
      case "heading":
        return `<h${block.level}${attrs}>${renderInline(block.text)}</h${block.level}>`;
      case "quote":
        return `<blockquote${attrs}>${renderInline(block.text)}</blockquote>`;
      case "hr":
        return `<hr${attrs}>`;
      case "code":
        return `<pre${attrs}><code>${TextUtils.escapeHtml(block.text)}</code></pre>`;
      case "table":
        return `<pre class="amorist-markdown-table" data-block-type="table"${attrs}><code>${TextUtils.escapeHtml(block.text)}</code></pre>`;
      case "taskList":
        return `<ul class="amorist-task-list"${attrs}>${block.items.map((item) =>
          `<li class="amorist-task-item" data-checked="${item.checked}"><span class="amorist-task-checkbox" contenteditable="false"></span><span class="amorist-task-content">${renderInline(item.text)}</span>${renderSublists(item)}</li>`,
        ).join("")}</ul>`;
      case "bulletList":
        return `<ul${attrs}>${block.items.map(renderListItem).join("")}</ul>`;
      case "orderedList":
        return `<ol${attrs}>${block.items.map(renderListItem).join("")}</ol>`;
      default:
        return `<p${attrs}>${renderInline(block.text)}</p>`;
    }
  }

  function renderListItem(item) {
    return `<li>${renderInline(item.text)}${renderSublists(item)}</li>`;
  }

  function renderSublists(item) {
    return (item.children || []).map(renderBlock).join("");
  }

  function sourceLineAttr(block) {
    return ` data-source-line="${Number(block.sourceLine || 0)}"`;
  }

  function createInlineTokenizer() {
    const tokens = [];
    return {
      // Stash rendered HTML, returning an opaque placeholder to leave in the source.
      hold(html) {
        const index = tokens.push(html) - 1;
        return `${PLACEHOLDER_MARK}${index}${PLACEHOLDER_MARK}`;
      },
      // Restore placeholders, repeating until none remain so that nested ones
      // (e.g. a code span inside bold) are fully resolved rather than left dangling.
      restore(source) {
        let previous;
        do {
          previous = source;
          source = source.replace(PLACEHOLDER_PATTERN, (match, index) => {
            const value = tokens[Number(index)];
            return value === undefined ? match : value;
          });
        } while (source !== previous);
        return source;
      },
    };
  }

  function renderInline(text) {
    const tokenizer = createInlineTokenizer();
    let source = TextUtils.escapeHtml(text);
    // Held before the inline passes so the constructs around a break match across
    // it, and so the tag itself never reaches those regexes as raw text.
    source = source.replace(/\n/g, () => tokenizer.hold("<br>"));
    source = source.replace(/`([^`]+)`/g, (_, code) => tokenizer.hold(`<code>${code}</code>`));
    source = source.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) =>
      tokenizer.hold(`<a href="${TextUtils.escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`),
    );
    source = source.replace(/\*\*([^*]+)\*\*/g, (_, value) => tokenizer.hold(`<strong>${value}</strong>`));
    source = source.replace(/\*([^*]+)\*/g, (_, value) => tokenizer.hold(`<em>${value}</em>`));
    return tokenizer.restore(source) || "<br>";
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
    if (/^H[1-6]$/.test(tag)) {
      lines.push(`${"#".repeat(Number(tag.slice(1)))} ${withoutHardBreaks(inlineMarkdown(element))}`);
      return;
    }
    if (tag === "HR") {
      lines.push("---");
      return;
    }
    if (tag === "BLOCKQUOTE") {
      lines.push(withHardBreaks(inlineMarkdown(element), "> "));
      return;
    }
    if (tag === "PRE") {
      if (element.dataset.blockType === "table" || element.classList.contains("amorist-markdown-table")) {
        lines.push(TableCodec.formatMarkdownTable(element.textContent));
        return;
      }
      lines.push(`\`\`\`\n${element.textContent.replace(/\n$/, "")}\n\`\`\``);
      return;
    }
    if (tag === "UL" || tag === "OL") {
      lines.push(serializeList(element, "").join("\n"));
      return;
    }
    if (tag === "DIV" && BLOCK_TAGS.has(element.firstElementChild?.tagName || "")) {
      Array.from(element.children).forEach((child) => serializeBlock(child, lines));
      return;
    }
    lines.push(withHardBreaks(inlineMarkdown(element), ""));
  }

  // Markdown writes a hard break as two trailing spaces. Block text carries breaks
  // as "\n", and each block re-applies its own prefix to the continuation: a bare
  // newline would drop the continuation out of the block — an unquoted second line
  // stops being part of the quote — instead of breaking the line inside it.
  function withHardBreaks(text, prefix, continuation = prefix) {
    return text
      .split("\n")
      .map((line, index) => (index === 0 ? prefix : continuation) + line)
      .join("  \n");
  }

  // Blocks that are a single line by construction. A heading has no second line,
  // and a list item's continuation would need lazy-continuation parsing that this
  // codec does not have — writing one would come back as a separate paragraph and
  // tear the item apart, so the break degrades to a space instead.
  function withoutHardBreaks(text) {
    return text.replace(/\n/g, " ");
  }

  // Returns the list's lines rather than pushing them as a block, so a sublist
  // stays glued to its parent item instead of being separated by a blank line.
  // Children indent to the parent marker's content column, which is what keeps
  // them nested (and not siblings) when the Markdown is parsed back.
  function serializeList(element, indent) {
    const ordered = element.tagName === "OL";
    const lines = [];
    let number = 0;
    Array.from(element.children).forEach((item) => {
      if (item.tagName !== "LI") return;
      number += 1;
      const marker = ordered ? `${number}. ` : "- ";
      lines.push(`${indent}${marker}${withoutHardBreaks(listItemMarkdown(item))}`);
      Array.from(item.children).forEach((child) => {
        if (child.tagName === "UL" || child.tagName === "OL") {
          lines.push(...serializeList(child, indent + " ".repeat(marker.length)));
        }
      });
    });
    return lines;
  }

  function listItemMarkdown(item) {
    if (!item.classList.contains("amorist-task-item")) return inlineMarkdown(item);
    const checked = item.dataset.checked === "true" ? "x" : " ";
    return `[${checked}] ${inlineMarkdown(item.querySelector(".amorist-task-content") || item)}`;
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
        case "UL":
        case "OL":
          // A sublist inside a list item is a block, not inline content:
          // serializeList emits it with its own indent. Falling through to the
          // default here would splice its text into the parent item's line.
          break;
        default:
          output += inlineMarkdown(element);
      }
    });
    return output.replace(/\u00a0/g, " ").replace(/\u200b/g, "").trim();
  }

  Internals.MarkdownCodec = {
    parseBlocks,
    renderMarkdown,
    serializeBlocks,
    renderInline,
    inlineMarkdown,
  };
})();
