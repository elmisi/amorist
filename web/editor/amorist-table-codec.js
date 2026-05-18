(function () {
  const Internals = window.AmoristInternals || (window.AmoristInternals = {});
  const TextUtils = Internals.TextUtils;
  if (!TextUtils) {
    throw new Error("AmoristTextUtils must be loaded before AmoristTableCodec.");
  }

  const GRAPHEME_SEGMENTER = typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

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
    const sourceLines = TextUtils.normalize(markdown)
      .split("\n")
      .filter((line) => line.trim());
    if (sourceLines.length < 2) return TextUtils.normalize(markdown).trim();

    const headerRow = splitTableRow(sourceLines[0] || "");
    const separatorRow = splitTableRow(sourceLines[1] || "");
    const columnCount = separatorRow.length || headerRow.length;
    const sourceRows = [
      normalizeTableRow(headerRow, columnCount),
      normalizeTableRow(separatorRow, columnCount),
      ...sourceLines.slice(2).map((line) => normalizeTableRow(splitTableRow(line), columnCount)),
    ];
    if (sourceRows.length < 2) return TextUtils.normalize(markdown).trim();

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

  function normalizeTableRow(row, columnCount) {
    const cells = mergeExtraTableCells(row, columnCount).slice(0, columnCount);
    while (cells.length < columnCount) cells.push("");
    return cells;
  }

  function mergeExtraTableCells(row, columnCount) {
    if (row.length <= columnCount) return row;
    return [
      ...row.slice(0, columnCount - 1),
      row.slice(columnCount - 1).join(" | ").trim(),
    ];
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

  Internals.TableCodec = {
    splitTableRow,
    formatMarkdownTable,
    isTableStart,
    looksLikeTableRow,
    nextNonEmptyTableRow,
    tableCellWidth,
  };
})();
