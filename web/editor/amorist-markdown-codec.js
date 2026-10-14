(function () {
  const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "LI", "PRE", "HR"]);
  const HR_PATTERN = /^(-{3,}|\*{3,}|_{3,})\s*$/;
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

  function safeLinkHref(value) {
    const href = String(value);
    const scheme = href.replace(/[\u0000-\u0020\u007f]/g, "").match(/^([a-z][a-z0-9+.-]*):/i);
    return !scheme || /^(?:https?|mailto)$/i.test(scheme[1]) ? href : null;
  }

  function tokenizeInline(value, start = 0, end = String(value).length, depth = 0, inLink = false) {
    const source = String(value);
    const tokens = [];
    const plain = (from, to, text = source.slice(from, to)) => {
      const previous = tokens[tokens.length - 1];
      if (previous && previous.type === "text" && !previous.escaped && from === previous.end && text === source.slice(from, to)) {
        previous.end = to; previous.text += text;
      } else tokens.push({ type: "text", start: from, end: to, text, escaped: text !== source.slice(from, to) });
    };
    if (depth > 64) return [{ type: "text", start, end, text: source.slice(start, end) }];
    for (let cursor = start; cursor < end;) {
      const char = source[cursor];
      if (char === "\\" && cursor + 1 < end && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(source[cursor + 1])) {
        plain(cursor, cursor + 2, source[cursor + 1]); cursor += 2; continue;
      }
      if (char === "`") {
        const code = TextUtils.codeSpanAt(source, cursor);
        if (code && code.end <= end) {
          let text = source.slice(code.contentStart, code.contentEnd).replace(/\r\n|\r|\n/g, " ");
          let contentStart = code.contentStart, contentEnd = code.contentEnd;
          if (text.startsWith(" ") && text.endsWith(" ") && /[^ ]/.test(text)) {
            text = text.slice(1, -1); contentStart += 1; contentEnd -= 1;
          }
          tokens.push({ type: "code", ...code, contentStart, contentEnd, text }); cursor = code.end; continue;
        }
        let runEnd = cursor + 1;
        while (runEnd < end && source[runEnd] === "`") runEnd += 1;
        plain(cursor, runEnd); cursor = runEnd; continue;
      }
      if (char === "\n") { tokens.push({ type: "break", start: cursor, end: cursor + 1 }); cursor += 1; continue; }
      if (!inLink && char === "<") {
        const closing = source.indexOf(">", cursor + 1);
        if (closing >= 0 && closing < end) {
          const label = source.slice(cursor + 1, closing);
          const uri = /^[a-z][a-z0-9+.-]{1,31}:[^\u0000-\u0020<>]*$/i.test(label);
          const email = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i.test(label);
          if (uri || email) {
            tokens.push({ type: "link", start: cursor, end: closing + 1,
              contentStart: cursor + 1, contentEnd: closing, href: email ? "mailto:" + label : label,
              autolink: true, children: [{type: "text", start: cursor + 1, end: closing, text: label}] });
            cursor = closing + 1; continue;
          }
        }
      }
      if (!inLink && (cursor === start || /[\s([{>]/.test(source[cursor - 1]))) {
        const rest = source.slice(cursor, end);
        const url = rest.match(/^(?:https?:\/\/|www\.)[^\s<>\u0000-\u001f]+/i);
        const email = !url && rest.match(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/i);
        if (url || email) {
          let label = (url || email)[0];
          if (url) {
            let previous;
            do {
              previous = label; label = label.replace(/[.,!?;:]+$/, "");
              for (const [left, right] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
                while (label.endsWith(right) && label.split(right).length > label.split(left).length) label = label.slice(0, -1);
              }
            } while (label !== previous);
          } else label = label.replace(/[.,!?;:]+$/, "");
          if (email || /^(?:https?:\/\/|www\.)[^/?#]+/i.test(label)) {
            const finish = cursor + label.length;
            tokens.push({type: "link", start: cursor, end: finish, contentStart: cursor, contentEnd: finish,
              href: email ? "mailto:" + label : /^www\./i.test(label) ? "https://" + label : label,
              autolink: true, children: [{type: "text", start: cursor, end: finish, text: label}]});
            cursor = finish; continue;
          }
        }
      }
      if (!inLink && char === "[") {
        let closing = cursor + 1, level = 1;
        for (; closing < end; closing += 1) {
          if (source[closing] === "\\") { closing += 1; continue; }
          const code = TextUtils.codeSpanAt(source, closing);
          if (code && code.end <= end) { closing = code.end - 1; continue; }
          if (source[closing] === "[") level += 1;
          if (source[closing] === "]" && --level === 0) break;
        }
        if (closing < end && source[closing + 1] === "(") {
          let destinationEnd = closing + 2, parentheses = 1;
          for (; destinationEnd < end; destinationEnd += 1) {
            if (source[destinationEnd] === "\\") { destinationEnd += 1; continue; }
            if (source[destinationEnd] === "(") parentheses += 1;
            if (source[destinationEnd] === ")" && --parentheses === 0) break;
          }
          if (destinationEnd < end) {
            const href = source.slice(closing + 2, destinationEnd);
            tokens.push({ type: "link", start: cursor, end: destinationEnd + 1,
              contentStart: cursor + 1, contentEnd: closing, href,
              children: tokenizeInline(source, cursor + 1, closing, depth + 1, true) });
            cursor = destinationEnd + 1; continue;
          }
        }
      }
      if (char === "*" || char === "_" || char === "~") {
        let runEnd = cursor + 1;
        while (runEnd < end && source[runEnd] === char) runEnd += 1;
        const width = runEnd - cursor;
        const word = /[\p{L}\p{N}]/u;
        const allowed = (char !== "~" || width === 2) && width <= 3
          && runEnd < end && !/\s/.test(source[runEnd])
          && !(char === "_" && word.test(source[cursor - 1] || "") && word.test(source[runEnd]));
        if (allowed) {
          let closing = runEnd;
          while (closing < end) {
            if (source[closing] === "\\") { closing += 2; continue; }
            const code = TextUtils.codeSpanAt(source, closing);
            if (code && code.end <= end) { closing = code.end; continue; }
            if (source[closing] === char) {
              let after = closing + 1;
              while (after < end && source[after] === char) after += 1;
              if (after - closing === width && !/\s/.test(source[closing - 1])
                  && !(char === "_" && word.test(source[closing - 1]) && word.test(source[after] || ""))) {
                tokens.push({ type: char === "~" ? "delete" : width === 1 ? "em" : width === 2 ? "strong" : "strong-em",
                  start: cursor, end: after, contentStart: runEnd, contentEnd: closing,
                  children: tokenizeInline(source, runEnd, closing, depth + 1, inLink) });
                cursor = after; break;
              }
              closing = after;
            } else closing += 1;
          }
          if (cursor >= runEnd) continue;
        }
        plain(cursor, runEnd); cursor = runEnd; continue;
      }
      plain(cursor, cursor + 1); cursor += 1;
    }
    return tokens;
  }

  function renderInlineTokens(tokens) {
    return tokens.map(token => {
      if (token.type === "text") return TextUtils.escapeHtml(token.text);
      if (token.type === "break") return "<br>";
      if (token.type === "code") return `<code>${TextUtils.escapeHtml(token.text)}</code>`;
      const content = renderInlineTokens(token.children);
      if (token.type === "link") {
        const href = safeLinkHref(token.href);
        return `<a${href == null ? "" : ` href="${TextUtils.escapeAttr(href)}"`} target="_blank" rel="noopener noreferrer">${content}</a>`;
      }
      if (token.type === "strong-em") return `<em><strong>${content}</strong></em>`;
      const tag = { em: "em", strong: "strong", delete: "del" }[token.type];
      return `<${tag}>${content}</${tag}>`;
    }).join("");
  }

  function renderInline(text) {
    return renderInlineTokens(tokenizeInline(text)) || "<br>";
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
    tokenizeInline,
    safeLinkHref,
    inlineMarkdown,
  };
})();
