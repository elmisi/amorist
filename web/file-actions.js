(function () {
  "use strict";

  function askUnsaved(name) {
    return new Promise(function (resolve) {
      var dialog = document.createElement("dialog");
      dialog.id = "file-decision-dialog";
      dialog.setAttribute("aria-labelledby", "file-decision-title");
      var title = document.createElement("h2");
      title.id = "file-decision-title";
      title.textContent = "Save changes to " + name + "?";
      var actions = document.createElement("div");
      actions.className = "actions";
      function finish(choice) { dialog.close(); dialog.remove(); resolve(choice); }
      ["Cancel", "Discard", "Save"].forEach(function (choice) {
        var button = document.createElement("button");
        button.type = "button";
        button.id = "file-decision-" + choice.toLowerCase();
        button.textContent = choice;
        button.addEventListener("click", function () { finish(choice.toLowerCase()); });
        actions.appendChild(button);
      });
      dialog.append(title, actions);
      dialog.addEventListener("cancel", function (event) { event.preventDefault(); finish("cancel"); });
      document.body.appendChild(dialog);
      dialog.showModal();
      document.getElementById("file-decision-cancel").focus();
    });
  }

  function install(options) {
    var busy = false;
    var buttons = Array.from(document.querySelectorAll("[data-file-action]"));
    var menu = document.getElementById("file-menu");
    menu.hidden = false;
    async function run(action) {
      if (busy || options.isSaving() || document.querySelector("dialog[open]")) return false;
      if (action === "reload") { menu.open = false; await options.reload(); return true; }
      busy = true;
      menu.open = false;
      buttons.forEach(function (button) { button.disabled = true; });
      try {
        var path = null;
        if (action === "open") {
          path = await options.backend.chooseOpen(options.getPath());
          if (!path) return false;
        }
        var discard = false;
        if (options.isDirty()) {
          var decision = await askUnsaved(options.getName());
          if (decision === "cancel") return false;
          if (decision === "save" && !(await options.save())) return false;
          discard = decision === "discard";
        }
        options.suspend(true);
        var recovery = null;
        var warnings = [];
        if (action === "open") {
          var inspection = await options.backend.inspectOpen(path);
          warnings = inspection.warnings || [];
          if (inspection.copies.length > 1) {
            recovery = await options.chooseRecovery(inspection.copies, true);
            if (recovery === undefined) return false;
          } else if (inspection.copies.length === 1) {
            recovery = inspection.copies[0].sessionId;
          }
        }
        options.pauseRecovery();
        var doc = action === "new"
          ? await options.backend.createDocument(discard)
          : await options.backend.openDocument(path, discard, recovery);
        doc.recoveryWarnings = (doc.recoveryWarnings || []).concat(warnings);
        await options.adopt(doc);
        return true;
      } catch (error) {
        options.error(error);
        options.resumeRecovery();
        return false;
      } finally {
        options.suspend(false);
        busy = false;
        buttons.forEach(function (button) { button.disabled = false; });
        options.focusEditor();
      }
    }
    buttons.forEach(function (button) {
      button.addEventListener("click", function () { run(button.dataset.fileAction); });
    });
    window.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && menu.open && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        menu.open = false;
        menu.querySelector("summary").focus();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      var action = event.key.toLowerCase() === "n" ? "new" : event.key.toLowerCase() === "o" ? "open" : null;
      if (action) { event.preventDefault(); run(action); }
    });
    return { run: run, isBusy: function () { return busy; } };
  }

  window.AmoristFileActions = { install: install };
})();
