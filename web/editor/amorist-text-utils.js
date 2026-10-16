(function () {
  function normalize(markdown) {
    return String(markdown).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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

  function codeFenceFor(value) {
    const text = String(value);
    const runs = /`+|~+/g;
    let width = 3;
    let match;
    while ((match = runs.exec(text))) width = Math.max(width, match[0].length + 1);
    return "`".repeat(width);
  }

  // Exact-width closing runs; a longer run cannot close a shorter code span.
  // Offsets stay in the original source, ready for the inline projection map.
  function codeSpanAt(text, start) {
    if (text[start] !== "`") return null;
    let contentStart = start;
    while (text[contentStart] === "`") contentStart += 1;
    const width = contentStart - start;
    let cursor = contentStart;
    while (cursor < text.length) {
      const closing = text.indexOf("`", cursor);
      if (closing < 0) return null;
      cursor = closing;
      while (text[cursor] === "`") cursor += 1;
      if (cursor - closing === width) return { start, contentStart, contentEnd: closing, end: cursor };
    }
    return null;
  }

  const Internals = window.AmoristInternals || (window.AmoristInternals = {});
  Internals.TextUtils = {
    normalize,
    escapeHtml,
    escapeAttr,
    codeFenceFor,
    codeSpanAt,
  };
})();
