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

  const Internals = window.AmoristInternals || (window.AmoristInternals = {});
  Internals.TextUtils = {
    normalize,
    escapeHtml,
    escapeAttr,
  };
})();
