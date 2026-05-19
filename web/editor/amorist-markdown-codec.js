(function () {
  const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "BLOCKQUOTE", "LI", "PRE"]);
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
      (Array.isArray(lines) && TableCodec.isTableStart(lines, index));
  }

  function renderBlock(block) {
    const attrs = sourceLineAttr(block);
    switch (block.type) {
      case "heading":
        return `<h${block.level}${attrs}>${renderInline(block.text)}</h${block.level}>`;
      case "quote":
        return `<blockquote${attrs}>${renderInline(block.text)}</blockquote>`;
      case "code":
        return `<pre${attrs}><code>${TextUtils.escapeHtml(block.text)}</code></pre>`;
      case "table":
        return `<pre class="amorist-markdown-table" data-block-type="table"${attrs}><code>${TextUtils.escapeHtml(block.text)}</code></pre>`;
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
    let source = TextUtils.escapeHtml(text);
    source = source.replace(/`([^`]+)`/g, (_, code) => token(tokens, `<code>${code}</code>`));
    source = source.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) =>
      token(tokens, `<a href="${TextUtils.escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`),
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
        lines.push(TableCodec.formatMarkdownTable(element.textContent));
        return;
      }
      lines.push(`\`\`\`\n${element.textContent.replace(/\n$/, "")}\n\`\`\``);
      return;
    }
    if (tag === "UL") {
      const items = [];
      Array.from(element.children).forEach((item) => {
        if (item.classList.contains("amorist-task-item")) {
          const checked = item.dataset.checked === "true" ? "x" : " ";
          items.push(`- [${checked}] ${inlineMarkdown(item.querySelector(".amorist-task-content") || item)}`);
        } else {
          items.push(`- ${inlineMarkdown(item)}`);
        }
      });
      lines.push(items.join("\n"));
      return;
    }
    if (tag === "OL") {
      const items = [];
      Array.from(element.children).forEach((item, index) => {
        items.push(`${index + 1}. ${inlineMarkdown(item)}`);
      });
      lines.push(items.join("\n"));
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
