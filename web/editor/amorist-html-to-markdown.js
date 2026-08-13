(function () {
  const Internals = window.AmoristInternals || (window.AmoristInternals = {});

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
    // Trailing whitespace is noise except in one case: two spaces after text are
    // a hard line break. Stripping indiscriminately would erase every <br> that
    // serializeBlocks just wrote, which is the whole point of the paste path.
    return md
      .split("\n")
      .map((line) => (/\S {2,}$/.test(line) ? line.replace(/[ \t]*$/, "  ") : line.replace(/[ \t]+$/, "")))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
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

      // Keep the only Markdown-representable attributes.  In particular an
      // image without alt/src is a silent paste loss.
      Array.from(node.attributes || []).forEach((attr) => {
        const allowed = (tag === "A" && attr.name === "href")
          || (tag === "IMG" && (attr.name === "src" || attr.name === "alt"));
        if (!allowed) {
          node.removeAttribute(attr.name);
        }
      });
    });
  }

  // This converter owns its source output.  It must not route through the
  // editor renderer/serializer: a paste is a local replacement transaction,
  // not a temporary DOM document that can reformat the open file.
  function nodeToSource(node) {
    if (node.nodeType === 3) return node.textContent || "";
    if (node.nodeType !== 1) return "";
    const tag = node.tagName;
    const children = () => Array.from(node.childNodes).map(nodeToSource).join("");
    if (tag === "BR") return "\n";
    if (tag === "STRONG" || tag === "B") return `**${children()}**`;
    if (tag === "EM" || tag === "I") return `*${children()}*`;
    if (tag === "CODE") return `\`${children()}\``;
    if (tag === "A") return `[${children()}](${node.getAttribute("href") || ""})`;
    if (tag === "IMG") return `![${node.getAttribute("alt") || ""}](${node.getAttribute("src") || ""})`;
    if (tag === "LI") return `- ${children().trim()}\n`;
    if (tag === "TD" || tag === "TH") return children().trim();
    if (tag === "TR") return Array.from(node.children).map(nodeToSource).join(" | ") + "\n";
    if (tag === "TABLE") return Array.from(node.querySelectorAll("tr")).map(nodeToSource).join("");
    const block = new Set(["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "UL", "OL", "PRE"]);
    const text = children();
    return block.has(tag) ? text + "\n\n" : text;
  }

  function convert(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.body;
    sanitize(body);
    const md = Array.from(body.childNodes).map(nodeToSource).join("");
    return cleanupMarkdown(md);
  }

  Internals.HtmlToMarkdown = {
    convert,
    _isStripped: isStripped,
    _isUnwrapped: isUnwrapped,
    _cleanupMarkdown: cleanupMarkdown,
    _nodeToSource: nodeToSource,
  };
})();
