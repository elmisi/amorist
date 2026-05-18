(function () {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const screenshotMode = params.get("screenshot");

  const elements = {
    editor: document.getElementById("editor"),
    appVersion: document.getElementById("app-version"),
    fileName: document.getElementById("file-name"),
    filePath: document.getElementById("file-path"),
    notice: document.getElementById("notice"),
    reload: document.getElementById("reload-button"),
    save: document.getElementById("save-button"),
    status: document.getElementById("status"),
  };

  const state = {
    editor: null,
    savedMarkdown: "",
    lineEnding: "lf",
    dirty: false,
    demo: Boolean(screenshotMode),
  };

  const demoMarkdown = `# Draft Notes

## Today

This document shows **Markdown** with inline code, blockquotes, lists, and task items.

> A compact editor for local Markdown files.

- Fast startup
- Browser-native close behavior
- Plain Markdown as the source of truth

- [ ] Review draft
- [x] Save locally

| Project   | Status | Notes       |
|-----------|--------|-------------|
| amorist   | ready  | local-first |
| ambiguous | later  | embeddable  |
`;

  document.addEventListener("DOMContentLoaded", () => {
    updateTopbarHeight();
    window.addEventListener("resize", updateTopbarHeight);
    if (window.ResizeObserver) {
      new ResizeObserver(updateTopbarHeight).observe(document.querySelector(".topbar"));
    }

    elements.save.addEventListener("click", () => saveDocument());
    elements.reload.addEventListener("click", () => reloadDocument());
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", notifyTabClosing);
    loadVersion();

    if (state.demo) {
      loadDemo();
      return;
    }

    if (!token) {
      showError("Missing local access token. Launch amorist from the command line.");
      return;
    }

    startHeartbeat();
    reloadDocument();
  });

  async function reloadDocument() {
    if (state.dirty && !window.confirm("Discard unsaved changes and reload the file?")) {
      return;
    }

    setBusy("Loading");
    try {
      const response = await fetch(`/api/document?token=${encodeURIComponent(token)}`);
      if (!response.ok) {
        throw new Error(`Load failed: HTTP ${response.status}`);
      }
      const document = await response.json();
      state.lineEnding = document.lineEnding || "lf";
      state.savedMarkdown = document.markdown || "";
      setDocumentLabel(document);
      mountEditor(state.savedMarkdown);
      setDirty(false);
      setStatus(document.exists ? "Loaded" : "New file");
      hideNotice();
    } catch (error) {
      showError(error.message || "The document could not be loaded.");
    }
  }

  async function loadVersion() {
    try {
      const response = await fetch("/api/version");
      if (!response.ok) return;
      const payload = await response.json();
      if (payload.version) {
        elements.appVersion.textContent = `v${payload.version}`;
      }
    } catch (_error) {
      elements.appVersion.textContent = "";
    }
  }

  async function saveDocument() {
    if (state.demo || !state.editor) {
      return;
    }

    setBusy("Saving");
    const markdown = state.editor.getValue();
    try {
      const response = await fetch(`/api/document?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown, lineEnding: state.lineEnding }),
      });
      if (!response.ok) {
        throw new Error(`Save failed: HTTP ${response.status}`);
      }
      state.savedMarkdown = markdown;
      setDirty(false);
      setStatus("Saved");
      hideNotice();
    } catch (error) {
      showError(error.message || "The document could not be saved.");
      setDirty(true);
    }
  }

  function loadDemo() {
    const sourceMode = screenshotMode === "source";
    setDocumentLabel({
      name: sourceMode ? "source-demo.md" : "draft-notes.md",
      path: "/tmp/amorist-demo.md",
      exists: true,
    });
    state.savedMarkdown = demoMarkdown;
    mountEditor(demoMarkdown);
    if (sourceMode) {
      state.editor.showSourceMode();
    }
    if (screenshotMode === "empty") {
      elements.editor.innerHTML = '<section class="empty-state">Open a Markdown file with <code>amorist file.md</code></section>';
    }
    elements.save.disabled = true;
    elements.reload.disabled = true;
    setStatus("Demo");
  }

  function mountEditor(markdown) {
    if (state.editor) {
      state.editor.destroy();
      state.editor = null;
    }
    elements.editor.innerHTML = "";

    state.editor = window.AmoristEditor.create(elements.editor, {
      value: markdown,
      spellcheck: true,
      onChange: (value) => {
        setDirty(value !== state.savedMarkdown);
      },
    });
  }

  function handleKeyDown(event) {
    const command = event.ctrlKey || event.metaKey;
    if (!command || event.key.toLowerCase() !== "s") {
      return;
    }
    event.preventDefault();
    saveDocument();
  }

  function handleBeforeUnload(event) {
    if (!state.dirty) {
      return;
    }
    event.preventDefault();
    event.returnValue = "";
  }

  function startHeartbeat() {
    const ping = () => {
      fetch(`/api/ping?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
    };
    ping();
    window.setInterval(ping, 3000);
  }

  function notifyTabClosing() {
    if (state.demo || !token) return;
    const url = `/api/close?token=${encodeURIComponent(token)}`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url);
      return;
    }
    fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  }

  function setDocumentLabel(document) {
    elements.fileName.textContent = document.name || "Untitled";
    elements.filePath.textContent = document.path || "";
  }

  function updateTopbarHeight() {
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;
    document.documentElement.style.setProperty("--topbar-height", `${topbar.offsetHeight}px`);
  }

  function setBusy(label) {
    elements.save.disabled = true;
    elements.reload.disabled = true;
    elements.status.textContent = label;
  }

  function setStatus(label) {
    elements.status.textContent = state.dirty ? `${label} - modified` : label;
    elements.save.disabled = state.demo || !state.dirty;
    elements.reload.disabled = state.demo;
  }

  function setDirty(dirty) {
    state.dirty = dirty;
    document.body.classList.toggle("is-dirty", dirty);
    setStatus(dirty ? "Modified" : "Saved");
  }

  function showError(message) {
    elements.notice.hidden = false;
    elements.notice.textContent = message;
    elements.status.textContent = "Error";
    elements.save.disabled = false;
    elements.reload.disabled = false;
  }

  function hideNotice() {
    elements.notice.hidden = true;
    elements.notice.textContent = "";
  }
})();
