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

  const INLINE_TAGS = new Set(["A", "B", "STRONG", "I", "EM", "CODE", "BR", "SUB", "SUP"]);

  function sanitize(root) {
    // Depth-first; mutate as we go. Work on a static list to avoid live-collection surprises.
    Array.from(root.childNodes).forEach((node) => {
      if (node.nodeType === 8 /* comment */) {
        node.remove();
        return;
      }
      if (node.nodeType !== 1 /* element */) return; // keep text nodes

      const tag = node.tagName;
      if (isStripped(tag)) {
        node.remove();
        return;
      }
      sanitize(node); // recurse first so children are clean before we unwrap

      if (isUnwrapped(tag)) {
        node.replaceWith(...node.childNodes);
        return;
      }

      // Strip every attribute except href on anchors.
      Array.from(node.attributes || []).forEach((attr) => {
        if (!(tag === "A" && attr.name === "href")) {
          node.removeAttribute(attr.name);
        }
      });
    });
  }

  // serializeBlocks only iterates element children, so loose top-level text /
  // inline runs must be wrapped in <p> or they would be dropped.
  function wrapLooseInline(root, doc) {
    let para = null;
    Array.from(root.childNodes).forEach((node) => {
      const loose =
        node.nodeType === 3 || (node.nodeType === 1 && INLINE_TAGS.has(node.tagName));
      if (loose) {
        if (!para) {
          para = doc.createElement("p");
          root.insertBefore(para, node);
        }
        para.appendChild(node);
      } else {
        para = null;
      }
    });
  }

  function convert(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.body;
    sanitize(body);
    wrapLooseInline(body, doc);
    const md = MarkdownCodec.serializeBlocks(body);
    return cleanupMarkdown(md);
  }

  Internals.HtmlToMarkdown = {
    convert,
    _isStripped: isStripped,
    _isUnwrapped: isUnwrapped,
    _cleanupMarkdown: cleanupMarkdown,
  };
})();
