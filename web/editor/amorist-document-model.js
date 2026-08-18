(function () {
  const Internals = window.AmoristInternals || (window.AmoristInternals = {});

  // The model deliberately keeps the string received from the backend.  Browser
  // text controls normalise newlines, therefore `display` is only a projection
  // and must never become the value written to disk.
  class DocumentModel {
    constructor(source) {
      this.source = String(source || "");
      this.revision = 0;
      this.rebuildProjection();
    }

    rebuildProjection() {
      this.rawToDisplay = new Array(this.source.length + 1);
      this.displayToRaw = [];
      let display = "";
      let raw = 0;
      while (raw < this.source.length) {
        this.rawToDisplay[raw] = display.length;
        const char = this.source[raw];
        if (char === "\r") {
          const next = this.source[raw + 1] === "\n" ? raw + 2 : raw + 1;
          for (let at = raw; at < next; at += 1) this.rawToDisplay[at] = display.length;
          this.displayToRaw[display.length] = raw;
          display += "\n";
          raw = next;
          continue;
        }
        this.displayToRaw[display.length] = raw;
        display += char;
        raw += 1;
      }
      this.rawToDisplay[this.source.length] = display.length;
      this.displayToRaw[display.length] = this.source.length;
      this.display = display;
    }

    rawOffset(displayOffset) {
      const offset = Math.max(0, Math.min(Number(displayOffset) || 0, this.display.length));
      return this.displayToRaw[offset] === undefined ? this.source.length : this.displayToRaw[offset];
    }

    displayOffset(rawOffset) {
      const offset = Math.max(0, Math.min(Number(rawOffset) || 0, this.source.length));
      return this.rawToDisplay[offset] === undefined ? this.display.length : this.rawToDisplay[offset];
    }

    lineEndingAt(rawOffset) {
      const before = this.source.slice(0, Math.max(0, rawOffset));
      const lineStart = Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r")) + 1;
      const remainder = this.source.slice(lineStart);
      const match = remainder.match(/\r\n|\r|\n/);
      return match ? match[0] : "\n";
    }

    transaction(start, end, replacement, gesture) {
      start = Math.max(0, Math.min(start, this.source.length));
      end = Math.max(start, Math.min(end, this.source.length));
      replacement = String(replacement);
      const removed = this.source.slice(start, end);
      const forward = { start, end, replacement, gesture: gesture || "edit", revision: this.revision };
      const inverse = {
        start,
        end: start + replacement.length,
        replacement: removed,
        gesture: "undo:" + forward.gesture,
        revision: this.revision + 1,
      };
      this.source = this.source.slice(0, start) + replacement + this.source.slice(end);
      this.revision += 1;
      this.rebuildProjection();
      return { forward, inverse, revision: this.revision };
    }

    apply(transaction) {
      return this.transaction(transaction.start, transaction.end, transaction.replacement, transaction.gesture);
    }
  }

  class TransactionJournal {
    constructor(maxEntries) {
      this.entries = [];
      this.index = 0;
      this.maxEntries = maxEntries || 100;
    }

    push(entry) {
      this.entries.splice(this.index);
      this.entries.push(entry);
      if (this.entries.length > this.maxEntries) this.entries.shift();
      this.index = this.entries.length;
    }

    undo(model) {
      if (!this.index) return null;
      const entry = this.entries[--this.index];
      model.apply(entry.inverse);
      return entry;
    }

    redo(model) {
      if (this.index >= this.entries.length) return null;
      const entry = this.entries[this.index++];
      model.apply(entry.forward);
      return entry;
    }
  }

  Internals.DocumentModel = DocumentModel;
  Internals.TransactionJournal = TransactionJournal;
})();
