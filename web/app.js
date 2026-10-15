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
    dirty: false,
    contextId: 0,
    documentPath: "",
    documentName: "Untitled",
    demo: Boolean(screenshotMode),
  };

  let noticeSource = null;
  let saving = false;
  let fileChanging = false;
  let fileActions = null;
  let nativeOpen = null;
  const settings = window.__TAURI__ && window.AmoristSettings ? window.AmoristSettings.create({
    invoke: (...args) => window.__TAURI__.core.invoke(...args),
    getEditor: () => state.editor,
    warning: message => showWarning(message, "settings"),
  }) : null;

  function errorMessage(error, fallback) {
    if (typeof error === "string") return error;
    if (error && error.message) return error.message;
    return fallback;
  }

  // Cross-platform confirm. In Tauri 2 on macOS the WKWebView silently
  // drops `window.confirm/alert/prompt`, so we prefer the native dialog
  // plugin when available. Falls back to `window.confirm` for HTTP mode
  // (which runs in a real browser tab where confirm works).
  async function confirmDialog(message) {
    if (window.__TAURI__ && window.__TAURI__.dialog && typeof window.__TAURI__.dialog.confirm === "function") {
      try {
        return await window.__TAURI__.dialog.confirm(message);
      } catch (e) {
        console.error("dialog.confirm failed:", e);
      }
    }
    return window.confirm(message);
  }

  function createBackend() {
    if (window.__TAURI__) return createTauriBackend();
    return createHttpBackend();
  }

  function createTauriBackend() {
    const { invoke } = window.__TAURI__.core;
    var contextId = 0;

    function getAppWindow() {
      try {
        if (window.__TAURI__.webviewWindow) return window.__TAURI__.webviewWindow.getCurrentWebviewWindow();
        if (window.__TAURI__.window) return window.__TAURI__.window.getCurrentWindow();
      } catch (e) {}
      return null;
    }

    return {
      async loadDocument() {
        var doc = await invoke("read_document");
        contextId = doc.contextId;
        return doc;
      },
      async createDocument(discard) {
        var doc = await invoke("create_document", { contextId: contextId, discard: discard });
        contextId = doc.contextId;
        return doc;
      },
      async inspectOpen(path) { return invoke("inspect_open_document", { path: path, contextId: contextId }); },
      async recoverStartupDocument(sessionId) {
        var doc=await invoke("recover_startup_document", {sessionId:sessionId,contextId:contextId});
        contextId=doc.contextId;
        return doc;
      },
      spawnInstance(path) { return invoke("spawn_document_instance", { path: path || null }); },
      takeNativeOpenRequests() { return invoke("take_native_open_requests"); },
      listenNativeOpen(handler) { return window.__TAURI__.event.listen("native-open-available", handler); },
      async openDocument(path, discard, recovery, expectedSavedSource) {
        var doc = await invoke("open_document", { path: path, discard: discard, recoveryChoice: recovery, expectedSavedSource: expectedSavedSource, contextId: contextId });
        contextId = doc.contextId;
        return doc;
      },
      chooseOpen(defaultPath) {
        return window.__TAURI__.dialog.open({ title: "Open Markdown", multiple: false, directory: false,
          defaultPath: defaultPath || undefined, filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown"] }] });
      },
      chooseSave(defaultPath) {
        return window.__TAURI__.dialog.save({ title: "Save Markdown As", defaultPath: defaultPath,
          filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown"] }] });
      },
      prepareSaveAs(path) { return invoke("prepare_save_as", { path: path, contextId: contextId }); },
      async saveAs(token, markdown, revision) {
        var result = await invoke("save_as_document", { token: token, markdown: markdown, revision: revision, contextId: contextId });
        if (result.contextId != null) contextId = result.contextId;
        return result;
      },
      async saveDocument(markdown, force, revision) {
        return invoke("save_document", { markdown: markdown, force: force || false, contextId: contextId, revision: revision });
      },
      async getVersion() {
        return invoke("get_version");
      },
      registerCloseGuard(isDirty) {
        var handler = async function () {
          if (await confirmDialog("You have unsaved changes. Close anyway?")) {
            invoke("force_close");
          }
        };
        // The global event API is the path that was validated on Linux.
        // Keep it primary so Linux behavior is unchanged; fall back to the
        // webview window's own listen for builds where the global event
        // namespace is not exposed (observed in macOS release builds).
        if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === "function") {
          Promise.resolve(window.__TAURI__.event.listen("confirm-close", handler)).catch(function (err) {
            console.error("confirm-close listen failed:", err);
          });
          return;
        }
        var appWindow = getAppWindow();
        if (appWindow && typeof appWindow.listen === "function") {
          Promise.resolve(appWindow.listen("confirm-close", handler)).catch(function (err) {
            console.error("confirm-close listen failed:", err);
          });
          return;
        }
        console.error("confirm-close: no listen API available");
      },
      syncDirty(dirty) {
        invoke("set_dirty", { dirty: dirty, contextId: contextId });
      },
      getContextId() { return contextId; },
      persistWorkingCopy(savedSource, unsavedSource, revision, boundaryState, capturedContext) {
        return invoke("persist_working_copy", { savedSource: savedSource, unsavedSource: unsavedSource, revision: revision, boundaryState: boundaryState, contextId: capturedContext });
      },
      discardWorkingCopy(capturedContext) { return invoke("discard_working_copy", { contextId: capturedContext == null ? contextId : capturedContext }); },
      selectRecovery(sessionId) { return invoke("select_recovery", { sessionId: sessionId, contextId: contextId }); },
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
      async saveDocument(markdown, force) {
        var url = "/api/document?token=" + encodeURIComponent(token);
        var opts = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markdown: markdown }),
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
      syncDirty(dirty) {},
      persistWorkingCopy() { return Promise.resolve(); },
      discardWorkingCopy() { return Promise.resolve(); },
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
                showWarning("Connection to server lost. Save is unavailable.", "heartbeat");
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
    if (window.__TAURI__) {
      window.AmoristDebugReport.init(function () { return state; });
    }

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

    if (window.__TAURI__) fileActions = window.AmoristFileActions.install({
      claimDocument: function () { if (nativeOpen) nativeOpen.claim(); },
      backend: backend, isSaving: function () { return saving || !state.editor || elements.editor.inert; }, isDirty: function () { return state.dirty; },
      getName: function () { return state.documentName; }, getPath: function () { return state.documentPath; },
      save: function () { return saveDocument(true); }, reload: reloadDocument, adopt: adoptDocument, chooseRecovery: chooseRecovery,
      snapshot: function () { return { editor: state.editor, markdown: state.editor.getValue(), revision: state.editor.model.revision }; },
      confirmReplace: function (path) { return confirmDialog("Replace the existing file at " + path + "?"); },
      finishSaveAs: function (snapshot, result) {
        if (state.editor !== snapshot.editor || result.contextId == null) {
          if (result.recoveryWarning) showWarning(result.recoveryWarning);
          return false;
        }
        state.contextId = result.contextId;
        setDocumentLabel(result);
        snapshot.editor.refreshLocalImages();
        backend.setWindowTitle(result.name);
        return finishSave(snapshot.editor, snapshot.markdown, result);
      },
      savedStatus: function () { setStatus("Saved"); },
      suspend: function (value) {
        fileChanging = value;
        elements.editor.inert = value;
        setStatus(value ? "Loading" : state.dirty ? "Modified" : "Loaded");
      },
      pauseRecovery: function () { workingCopy.cancel(); },
      resumeRecovery: function () { if (state.dirty && state.editor) scheduleWorkingCopy(state.editor.getValue()); },
      error: function (error) { showError(errorMessage(error, "The file action could not be completed."), "file"); },
      focusEditor: function () {
        var source = elements.editor.querySelector('.amorist-editor-source');
        var surface = elements.editor.querySelector('.amorist-editor-surface');
        if (source && !source.hidden) source.focus(); else if (surface) surface.focus();
      }
    });
    backend.startHeartbeat();
    if (window.__TAURI__) {
      window.AmoristNativeOpen.install({
        listen: backend.listenNativeOpen, take: backend.takeNativeOpenRequests, spawn: backend.spawnInstance,
        isBusy: function () { return saving || fileChanging || elements.editor.inert || fileActions.isBusy() || !!document.querySelector('dialog[open]'); },
        canUseInitial: function () { return !!state.editor && !state.documentPath && !state.dirty && state.editor.model.revision === 0; },
        openInitial: function (path) { return fileActions.run("open", path); },
        error: function (error) { showError(errorMessage(error, "Finder could not open the document."), "native-open"); },
      }).then(async function (controller) {
        nativeOpen = controller;
        await reloadDocument();
        await nativeOpen.ready();
      }).catch(function (error) {
        reloadDocument().then(function () { showError(errorMessage(error, "Finder event handling could not start."), "native-open"); });
      });
    } else reloadDocument();
  });

  async function reloadDocument() {
    if (saving) return;
    if (state.dirty && !(await confirmDialog("Discard unsaved changes and reload the file?"))) {
      return;
    }

    if (state.dirty) {
      workingCopy.cancel();
      try {
        await backend.discardWorkingCopy();
      } catch (error) {
        showError(errorMessage(error, "Could not discard recovered work."), "reload");
        return;
      }
    }

    setBusy("Loading");
    var previousFocus = document.activeElement;
    elements.editor.inert = true;
    try {
      var doc = await backend.loadDocument();
      await adoptDocument(doc);
    } catch (error) {
      if (error && error.name === "AbortError") {
        showError("Load timed out — the server may be unreachable.", "reload");
      } else {
        showError(errorMessage(error, "The document could not be loaded."), "reload");
      }
      if (state.dirty && state.editor) scheduleWorkingCopy(state.editor.getValue());
    } finally {
      elements.editor.inert = false;
      if (previousFocus && previousFocus.isConnected && elements.editor.contains(previousFocus)) previousFocus.focus();
    }
  }

  async function adoptDocument(doc) {
      if (nativeOpen && (doc.path || doc.recoveryMarkdown != null || (doc.recoveryCandidates || []).length)) nativeOpen.claim();
      if (doc.recoveryCandidates && doc.recoveryCandidates.length) {
        var selected = await chooseRecovery(doc.recoveryCandidates, false, doc.markdown || "", doc.path || null);
        if (selected) {
          var selectedCopy=doc.recoveryCandidates.find(function(copy){return copy.sessionId===selected;});
          if(selectedCopy && selectedCopy.path && selectedCopy.path!==doc.path) {
            doc=await backend.recoverStartupDocument(selected);
            if(selectedCopy.savedSource!==doc.markdown) doc.recoveryWarnings=(doc.recoveryWarnings||[]).concat(
              "The saved file changed since this recovery copy was made. Recovery does not merge those changes. Use Save As to keep both versions.");
          } else {
            var recoveredCopy = await backend.selectRecovery(selected);
            doc.recoveryMarkdown = recoveredCopy.unsavedSource;
            doc.recoveryBoundaryState = recoveredCopy.boundaryState;
            if (recoveredCopy.savedSource !== (doc.markdown || "")) {
              doc.recoveryWarnings = (doc.recoveryWarnings || []).concat(
                "The saved file changed since this recovery copy was made. Recovery does not merge those changes. Use Save As to keep both versions.");
            }
          }
        }
      }
      state.savedMarkdown = doc.markdown || "";
      state.contextId = doc.contextId || 0;
      setDocumentLabel(doc);
      mountEditor(doc.recoveryMarkdown == null ? state.savedMarkdown : doc.recoveryMarkdown);
      var recoveryMetadataRestored = doc.recoveryBoundaryState == null || state.editor.model.restoreBoundaryState(doc.recoveryBoundaryState);
      setDirty(false);
      hideNotice();
      if (settings) await settings.refresh();
      if (doc.recoveryMarkdown != null && doc.recoveryMarkdown !== state.savedMarkdown) {
        setDirty(true);
        showWarning((elements.notice.hidden ? "" : elements.notice.textContent + " ")
          + "Recovered unsaved work. Save to apply it to the file, or Reload to discard it."
          + (recoveryMetadataRestored ? "" : " Recovery metadata was invalid; text was recovered unchanged."));
      }
      if (doc.recoveryWarnings && doc.recoveryWarnings.length) {
        showWarning((elements.notice.hidden ? "" : elements.notice.textContent + " ")
          + doc.recoveryWarnings.join(" "));
      }
      if(window.__TAURI__) {
        const anchorEditor=state.editor,anchorContext=state.contextId;
        const startupAnchor=await window.__TAURI__.core.invoke("take_startup_anchor");
        if(startupAnchor!==null && startupAnchor!==undefined) {
          requestAnimationFrame(function() {
            if(state.editor===anchorEditor && state.contextId===anchorContext && !anchorEditor.navigateHeading(startupAnchor)) {
              showWarning("Heading not found: "+startupAnchor,"link");
            }
          });
        }
      }
      setStatus(doc.exists ? "Loaded" : "New file");
      backend.setWindowTitle(doc.name || "");
  }

  function chooseRecovery(copies, cancellable, savedSource, currentPath) {
    return new Promise(function (resolve) {
      var dialog = document.createElement("dialog");
      dialog.id = "recovery-dialog";
      dialog.setAttribute("aria-labelledby", "recovery-title");
      var title = document.createElement("h2");
      title.id = "recovery-title";
      title.textContent = "Choose unsaved work to recover";
      var description = document.createElement("p");
      var changedBase = savedSource !== undefined && copies.some(function(copy) { return (currentPath===undefined || copy.path===currentPath) && copy.savedSource !== savedSource; });
      description.textContent = changedBase
        ? "The saved file changed since the recovery copy was made. Recovering does not merge those changes or write the file. Use Save As to keep both versions. Other copies will be kept."
        : "Choose a recovery copy. The other copies will be kept.";
      var select = document.createElement("select");
      select.id = "recovery-choice";
      select.setAttribute("aria-label", "Available recovery copies");
      copies.forEach(function (copy, index) {
        var option = document.createElement("option");
        option.value = copy.sessionId;
        option.textContent = "Copy " + (index + 1)
          + (copy.path ? " — "+copy.path : " — Untitled")
          + (savedSource !== undefined && (currentPath===undefined || copy.path===currentPath) && copy.savedSource !== savedSource ? " (saved file changed)" : "")
          + ": " + copy.unsavedSource.slice(0, 120).replace(/\s+/g, " ");
        select.appendChild(option);
      });
      var actions = document.createElement("div");
      actions.className = "actions";
      var recover = document.createElement("button");
      recover.id = "recover-selected";
      recover.textContent = "Recover selected copy";
      var saved = document.createElement("button");
      saved.textContent = currentPath===null ? "Continue without recovery" : "Open saved file";
      if (cancellable) {
        var cancel = document.createElement("button");
        cancel.id = "recovery-cancel";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", function () { finish(undefined); });
        actions.appendChild(cancel);
      }
      actions.append(saved, recover);
      dialog.append(title, description, select, actions);
      function finish(id) { dialog.close(); dialog.remove(); resolve(id); }
      recover.addEventListener("click", function () { finish(select.value); });
      saved.addEventListener("click", function () { finish(null); });
      dialog.addEventListener("cancel", function (event) { event.preventDefault(); finish(cancellable ? undefined : null); });
      document.body.appendChild(dialog);
      dialog.showModal();
      select.focus();
    });
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

  function finishSave(editor, markdown, result) {
    if (state.editor !== editor) return false;
    workingCopy.cancel();
    state.savedMarkdown = markdown;
    var latest = editor.getValue();
    setDirty(latest !== markdown);
    hideNotice();
    if (result && result.recoveryWarning) showWarning("File saved, but its recovery copy could not be removed: " + result.recoveryWarning);
    if (state.dirty) scheduleWorkingCopy(latest);
    return !state.dirty;
  }

  async function saveDocument(fromFileAction) {
    if (state.demo || !state.editor || saving || fileChanging || elements.save.disabled) return false;
    if (!state.documentPath && fileActions) {
      return fromFileAction ? fileActions.saveForTransition() : fileActions.run("save-as");
    }
    saving = true;
    var editor = state.editor;
    var markdown = editor.getValue();
    var revision = editor.model ? editor.model.revision : 0;
    setBusy("Saving");
    workingCopy.cancel();
    try {
      try {
        return finishSave(editor, markdown, await backend.saveDocument(markdown, false, revision));
      } catch (error) {
        if (state.editor !== editor) return false;
        var msg = errorMessage(error, "The document could not be saved.");
        if (msg === "CONFLICT") {
          if (await confirmDialog("The file was modified outside amorist.\n\nOverwrite with your version?")) {
            if (state.editor !== editor) return false;
            try {
              return finishSave(editor, markdown, await backend.saveDocument(markdown, true, revision));
            } catch (retryError) {
              if (state.editor !== editor) return false;
              showError(errorMessage(retryError, "The document could not be saved."), "save");
            }
          } else {
            showWarning("File changed on disk. Use Reload to load the latest version.");
          }
        } else if (error && error.name === "AbortError") {
          showError("Save timed out — the server may be unreachable. Your changes are still in the editor.", "save");
        } else {
          showError(msg, "save");
        }
        setDirty(editor.getValue() !== state.savedMarkdown);
        scheduleWorkingCopy(editor.getValue());
        return false;
      }
    } finally {
      saving = false;
      if (state.editor === editor) setStatus(state.dirty ? "Modified" : "Saved");
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
    if (screenshotMode === "find") {
      state.editor.openFindBar();
      state.editor.findInput.value = "markdown";
      state.editor.performFind();
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

    var editor = window.AmoristEditor.create(elements.editor, {
      value: markdown,
      spellcheck: true,
      documentPath: function () { return state.documentPath; },
      onActivateLink: window.__TAURI__ ? async function(reference) {
        const contextId=state.contextId;
        const destination=await window.__TAURI__.core.invoke("resolve_link",{reference:reference,contextId:contextId});
        if(state.contextId!==contextId || state.editor!==editor) return;
        if(destination.kind==="anchor") {
          if(!editor.navigateHeading(destination.value)) throw new Error("Heading not found: "+destination.value);
        } else if(destination.kind==="markdown") {
          await window.__TAURI__.core.invoke("spawn_document_instance",{path:destination.value.path,anchor:destination.value.anchor,contextId:contextId});
        } else {
          await window.__TAURI__.core.invoke("open_external_link",{reference:reference,contextId:contextId});
        }
      } : undefined,
      resolveImage: window.__TAURI__ ? async function(reference) {
        const contextId=state.contextId;
        const id=await window.__TAURI__.core.invoke("register_image",{reference:reference,contextId:contextId});
        if(state.contextId!==contextId) return null;
        return window.__TAURI__.core.convertFileSrc(id,"amorist-image");
      } : undefined,
      onChange: function (value) {
        if (state.editor !== editor) return;
        if (nativeOpen) nativeOpen.claim();
        setDirty(value !== state.savedMarkdown);
        scheduleWorkingCopy(value);
      },
      onWarning: function (message) {
        showWarning(message, "editor");
      },
    });
    state.editor = editor;
    if (settings) settings.applyTo(editor);
  }

  function handleKeyDown(event) {
    var command = event.ctrlKey || event.metaKey;
    if (!command || event.shiftKey || event.key.toLowerCase() !== "s") {
      return;
    }
    event.preventDefault();
    if (document.querySelector("dialog[open]")) return;
    saveDocument();
  }

  function setDocumentLabel(doc) {
    state.documentName = doc.name || "Untitled";
    state.documentPath = doc.path || "";
    elements.fileName.textContent = state.documentName;
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
    if (saving) label = "Saving";
    else if (fileChanging) label = "Loading";
    elements.status.textContent = state.dirty ? label + " - modified" : label;
    elements.save.disabled = saving || fileChanging || state.demo || (!state.dirty && !!state.documentPath);
    elements.reload.disabled = saving || fileChanging || state.demo;
  }

  function setDirty(dirty) {
    var changed = state.dirty !== dirty;
    state.dirty = dirty;
    document.body.classList.toggle("is-dirty", dirty);
    if (changed) backend.syncDirty(dirty);
    setStatus(dirty ? "Modified" : "Saved");
  }

  const workingCopy = window.AmoristWorkingCopy.create({
    isCurrent: snapshot => state.editor === snapshot.editor
      && (!backend.getContextId || backend.getContextId() === snapshot.context),
    persist: snapshot => backend.persistWorkingCopy(snapshot.savedSource, snapshot.value,
      snapshot.revision, snapshot.boundaries, snapshot.context),
    discard: snapshot => backend.discardWorkingCopy(snapshot.context),
    onError: (_error, clean) => showWarning(clean ? "Could not remove the recovery copy."
      : "Could not persist recovery copy. Your file was not changed."),
  });
  function scheduleWorkingCopy(value) {
    if (state.demo) return;
    const editor=state.editor;
    workingCopy.schedule({editor, value, savedSource:state.savedMarkdown,
      revision:editor?.model?.revision||0, boundaries:editor?.model?.boundaryState()||null,
      context:backend.getContextId?backend.getContextId():0});
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

  function showWarning(message, source) {
    elements.notice.hidden = false;
    elements.notice.classList.remove("error");
    elements.notice.classList.add("warning");
    elements.notice.textContent = message;
    noticeSource = source || "warning";
  }

  function hideNotice() {
    elements.notice.hidden = true;
    elements.notice.classList.remove("error", "warning");
    elements.notice.textContent = "";
    noticeSource = null;
  }
})();
