(function () {
  const Internals = window.AmoristInternals || (window.AmoristInternals = {});
  const MarkdownCodec = Internals.MarkdownCodec;
  if (!MarkdownCodec) {
    throw new Error("AmoristMarkdownCodec must be loaded before AmoristHtmlToMarkdown.");
  }

  // Elements removed entirely (content discarded).
  const STRIPPED = new Set(["SCRIPT", "STYLE", "HEAD", "META", "LINK", "TITLE", "NOSCRIPT"]);
  // Inline wrappers with no Markdown meaning: replace with their children.
  const UNWRAPPED = new Set(["SPAN", "FONT", "U", "S", "SMALL", "ABBR", "TIME", "MARK"]);

  function isStripped(tag) {
    return STRIPPED.has(tag);
  }
  function isUnwrapped(tag) {
    return UNWRAPPED.has(tag);
  }

  function cleanupMarkdown(md) {
    return md.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  }

  Internals.HtmlToMarkdown = {
    // convert() added in Task 2
    _isStripped: isStripped,
    _isUnwrapped: isUnwrapped,
    _cleanupMarkdown: cleanupMarkdown,
  };
})();
