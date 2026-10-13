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

  const Internals = window.AmoristInternals || (window.AmoristInternals = {});
  Internals.TextUtils = {
    normalize,
    escapeHtml,
    escapeAttr,
    codeFenceFor,
  };
})();
