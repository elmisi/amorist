(function () {
  const params = new URLSearchParams(window.location.search);
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

  let noticeSource = null;

  function errorMessage(error, fallback) {
    if (typeof error === "string") return error;
    if (error && error.message) return error.message;
    return fallback;
  }

  function createBackend() {
    if (window.__TAURI__) return createTauriBackend();
    return createHttpBackend();
  }

  function createTauriBackend() {
    const { invoke } = window.__TAURI__.core;

    function getAppWindow() {
      try {
        if (window.__TAURI__.webviewWindow) return window.__TAURI__.webviewWindow.getCurrentWebviewWindow();
        if (window.__TAURI__.window) return window.__TAURI__.window.getCurrentWindow();
      } catch (e) {}
      return null;
    }

    return {
      async loadDocument() {
        return invoke("read_document");
      },
      async saveDocument(markdown, lineEnding) {
        return invoke("save_document", { markdown, lineEnding });
      },
      async getVersion() {
        return invoke("get_version");
      },
      registerCloseGuard(isDirty) {
        var appWindow = getAppWindow();
        if (appWindow && appWindow.onCloseRequested) {
          appWindow.onCloseRequested(function (event) {
            if (isDirty() && !window.confirm("You have unsaved changes. Close anyway?")) {
              event.preventDefault();
            }
          });
        } else {
          window.addEventListener("beforeunload", function (event) {
            if (!isDirty()) return;
            event.preventDefault();
            event.returnValue = "";
          });
        }
      },
      async setWindowTitle(name) {
        try {
          var appWindow = getAppWindow();
          if (name && appWindow) await appWindow.setTitle("amorist — " + name);
        } catch (e) {}
      },
      startHeartbeat() {},
      notifyClose() {},
    };
  }

  function createHttpBackend() {
    const token = params.get("token") || "";

    async function fetchWithTimeout(url, opts, timeoutMs) {
      timeoutMs = timeoutMs || 10000;
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      try {
        return await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
      } finally {
        clearTimeout(timer);
      }
    }

    async function extractErrorDetail(response) {
      try {
        var body = await response.json();
        if (body.error) return body.error;
      } catch (_ignored) {}
      var STATUS_MESSAGES = {
        413: "File is too large (max 10 MB)",
        403: "Session expired — relaunch amorist from the terminal",
      };
      return STATUS_MESSAGES[response.status] || "HTTP " + response.status;
    }

    return {
      async loadDocument() {
        var response = await fetchWithTimeout("/api/document?token=" + encodeURIComponent(token));
        if (!response.ok) {
          var detail = await extractErrorDetail(response);
          throw new Error("Load failed: " + detail);
        }
        return response.json();
      },
      async saveDocument(markdown, lineEnding) {
        var url = "/api/document?token=" + encodeURIComponent(token);
        var opts = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markdown: markdown, lineEnding: lineEnding }),
        };

        async function attemptSave() {
          var response = await fetchWithTimeout(url, opts);
          if (!response.ok) {
            var detail = await extractErrorDetail(response);
            throw new Error("Save failed: " + detail);
          }
          return response;
        }

        try {
          await attemptSave();
        } catch (firstError) {
          if (firstError instanceof TypeError || firstError.name === "AbortError") {
            elements.status.textContent = "Retrying save…";
            await new Promise(function (r) { setTimeout(r, 2000); });
            await attemptSave();
          } else {
            throw firstError;
          }
        }
      },
      async getVersion() {
        var response = await fetch("/api/version");
        if (!response.ok) return "";
        var payload = await response.json();
        return payload.version || "";
      },
      registerCloseGuard(isDirty) {
        window.addEventListener("beforeunload", function (event) {
          if (!isDirty()) return;
          event.preventDefault();
          event.returnValue = "";
        });
      },
      async setWindowTitle(_name) {},
      startHeartbeat() {
        var pingFailures = 0;
        var ping = function () {
          fetch("/api/ping?token=" + encodeURIComponent(token), { method: "POST" })
            .then(function () {
              if (pingFailures > 0 && noticeSource === "heartbeat") { hideNotice(); }
              pingFailures = 0;
            })
            .catch(function () {
              pingFailures += 1;
              if (pingFailures >= 3) {
                showWarning("Connection to server lost. Save is unavailable.");
              }
            });
        };
        ping();
        window.setInterval(ping, 3000);
      },
      notifyClose() {
        if (!token) return;
        var url = "/api/close?token=" + encodeURIComponent(token);
        if (navigator.sendBeacon) {
          navigator.sendBeacon(url);
          return;
        }
        fetch(url, { method: "POST", keepalive: true }).catch(function () {});
      },
      isHttpMode: true,
    };
  }

  const backend = createBackend();

  const demoMarkdown = "# Draft Notes\n\n## Today\n\nThis document shows **Markdown** with inline code, blockquotes, lists, and task items.\n\n> A compact editor for local Markdown files.\n\n- Fast startup\n- Browser-native close behavior\n- Plain Markdown as the source of truth\n\n- [ ] Review draft\n- [x] Save locally\n\n| Project   | Status | Notes       |\n|-----------|--------|-------------|\n| amorist   | ready  | local-first |\n| ambiguous | later  | embeddable  |\n";

  document.addEventListener("DOMContentLoaded", function () {
    updateTopbarHeight();
    window.addEventListener("resize", updateTopbarHeight);
    if (window.ResizeObserver) {
      new ResizeObserver(updateTopbarHeight).observe(document.querySelector(".topbar"));
    }

    elements.save.addEventListener("click", function () { saveDocument(); });
    elements.reload.addEventListener("click", function () { reloadDocument(); });
    window.addEventListener("keydown", handleKeyDown);

    backend.registerCloseGuard(function () { return state.dirty; });

    if (!backend.isHttpMode) {
      window.addEventListener("pagehide", function () { backend.notifyClose(); });
    } else {
      window.addEventListener("pagehide", function () { backend.notifyClose(); });
    }

    loadVersion();

    if (state.demo) {
      loadDemo();
      return;
    }

    if (backend.isHttpMode && !params.get("token")) {
      showError("Missing local access token. Launch amorist from the command line.", "init");
      return;
    }

    backend.startHeartbeat();
    reloadDocument();
  });

  async function reloadDocument() {
    if (state.dirty && !window.confirm("Discard unsaved changes and reload the file?")) {
      return;
    }

    setBusy("Loading");
    try {
      var doc = await backend.loadDocument();
      state.lineEnding = doc.lineEnding || "lf";
      state.savedMarkdown = doc.markdown || "";
      setDocumentLabel(doc);
      mountEditor(state.savedMarkdown);
      setDirty(false);
      setStatus(doc.exists ? "Loaded" : "New file");
      hideNotice();
      backend.setWindowTitle(doc.name || "");
    } catch (error) {
      if (error && error.name === "AbortError") {
        showError("Load timed out — the server may be unreachable.", "reload");
      } else {
        showError(errorMessage(error, "The document could not be loaded."), "reload");
      }
    }
  }

  async function loadVersion() {
    try {
      var version = await backend.getVersion();
      if (version) {
        elements.appVersion.textContent = "v" + version;
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
    var markdown = state.editor.getValue();

    try {
      await backend.saveDocument(markdown, state.lineEnding);
      state.savedMarkdown = markdown;
      setDirty(false);
      setStatus("Saved");
      hideNotice();
    } catch (error) {
      var msg = errorMessage(error, "The document could not be saved.");
      if (msg.indexOf("modified outside") !== -1) {
        showWarning(msg);
      } else if (error && error.name === "AbortError") {
        showError("Save timed out — the server may be unreachable. Your changes are still in the editor.", "save");
      } else {
        showError(msg, "save");
      }
      setDirty(true);
    }
  }

  function loadDemo() {
    var sourceMode = screenshotMode === "source";
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
      onChange: function (value) {
        setDirty(value !== state.savedMarkdown);
      },
    });
  }

  function handleKeyDown(event) {
    var command = event.ctrlKey || event.metaKey;
    if (!command || event.key.toLowerCase() !== "s") {
      return;
    }
    event.preventDefault();
    saveDocument();
  }

  function setDocumentLabel(doc) {
    elements.fileName.textContent = doc.name || "Untitled";
    elements.filePath.textContent = doc.path || "";
  }

  function updateTopbarHeight() {
    var topbar = document.querySelector(".topbar");
    if (!topbar) return;
    document.documentElement.style.setProperty("--topbar-height", topbar.offsetHeight + "px");
  }

  function setBusy(label) {
    elements.save.disabled = true;
    elements.reload.disabled = true;
    elements.status.textContent = label;
  }

  function setStatus(label) {
    elements.status.textContent = state.dirty ? label + " - modified" : label;
    elements.save.disabled = state.demo || !state.dirty;
    elements.reload.disabled = state.demo;
  }

  function setDirty(dirty) {
    state.dirty = dirty;
    document.body.classList.toggle("is-dirty", dirty);
    setStatus(dirty ? "Modified" : "Saved");
  }

  function showError(message, source) {
    elements.notice.hidden = false;
    elements.notice.classList.remove("warning");
    elements.notice.classList.add("error");
    elements.notice.textContent = message;
    elements.status.textContent = "Error";
    elements.save.disabled = false;
    elements.reload.disabled = false;
    noticeSource = source || null;
  }

  function showWarning(message) {
    elements.notice.hidden = false;
    elements.notice.classList.remove("error");
    elements.notice.classList.add("warning");
    elements.notice.textContent = message;
    noticeSource = "heartbeat";
  }

  function hideNotice() {
    elements.notice.hidden = true;
    elements.notice.classList.remove("error", "warning");
    elements.notice.textContent = "";
    noticeSource = null;
  }
})();
