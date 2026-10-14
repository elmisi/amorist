(function () {
  const Internals = window.AmoristInternals || (window.AmoristInternals = {});

  // The model deliberately keeps the string received from the backend.  Browser
  // text controls normalise newlines, therefore `display` is only a projection
  // and must never become the value written to disk.
  class DocumentModel {
    constructor(source) {
      this.source = String(source || "");
      this.revision = 0;
      this.automaticBreaks = [];
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
      const offset = Math.max(0, Math.min(rawOffset, this.source.length));
      const endings = /\r\n|\r|\n/g;
      let previous = "\n", match;
      while ((match = endings.exec(this.source))) {
        if (offset < match.index + match[0].length) return match[0];
        previous = match[0];
      }
      return previous;
    }

    boundaryState() {
      return { schemaVersion: 1, offsetEncoding: "utf16", automaticBreaks: this.automaticBreaks.map(record => ({ marker: record.marker, escapes: [...record.escapes] })) };
    }

    restoreBoundaryState(state) {
      const records = validatedBoundaries(this.source, state);
      if (!records) return false;
      this.automaticBreaks = records;
      return true;
    }

    transaction(start, end, replacement, gesture, boundaryState) {
      start = Math.max(0, Math.min(start, this.source.length));
      end = Math.max(start, Math.min(end, this.source.length));
      replacement = String(replacement);
      const removed = this.source.slice(start, end);
      const beforeBoundaries = this.boundaryState();
      const nextSource = this.source.slice(0, start) + replacement + this.source.slice(end);
      const shift = replacement.length - (end - start);
      const position = (at) => at < start ? at : at >= end ? at + shift : null;
      const surviving = [];
      for (const record of this.automaticBreaks) {
        const terminatorEnd = record.marker + 1 + (this.source.slice(record.marker + 1, record.marker + 3) === "\r\n" ? 2 : 1);
        if ((start < terminatorEnd && end > record.marker)
            || (start === end && start > record.marker && start < terminatorEnd)) continue;
        const marker = position(record.marker), escapes = record.escapes.map(position).filter(at => at !== null);
        if (marker === null) continue;
        const candidate = { schemaVersion: 1, offsetEncoding: "utf16", automaticBreaks: [{ marker, escapes }] };
        const valid = validatedBoundaries(nextSource, candidate);
        if (valid) surviving.push(...valid);
      }
      const afterBoundaries = boundaryState === undefined ? { schemaVersion: 1, offsetEncoding: "utf16", automaticBreaks: surviving } : boundaryState;
      const validated = validatedBoundaries(nextSource, afterBoundaries);
      if (!validated) throw new Error("Invalid automatic boundary state for transaction");
      const forward = { start, end, replacement, gesture: gesture || "edit", revision: this.revision,
        boundaryState: { schemaVersion: 1, offsetEncoding: "utf16", automaticBreaks: validated.map(record => ({ marker: record.marker, escapes: [...record.escapes] })) } };
      const inverse = {
        start,
        end: start + replacement.length,
        replacement: removed,
        gesture: "undo:" + forward.gesture,
        revision: this.revision + 1,
        boundaryState: beforeBoundaries,
      };
      this.source = nextSource;
      this.automaticBreaks = validated;
      this.revision += 1;
      this.rebuildProjection();
      return { forward, inverse, revision: this.revision };
    }

    apply(transaction) {
      return this.transaction(transaction.start, transaction.end, transaction.replacement, transaction.gesture, transaction.boundaryState);
    }
  }

  function validatedBoundaries(source, state) {
    if (!state || state.schemaVersion !== 1 || state.offsetEncoding !== "utf16" || !Array.isArray(state.automaticBreaks)) return null;
    const result = [], seen = new Set();
    for (const record of state.automaticBreaks) {
      if (!record || !Number.isInteger(record.marker) || record.marker < 0 || record.marker >= source.length
          || source[record.marker] !== "\\" || !/[\r\n]/.test(source[record.marker + 1] || "") || seen.has(record.marker)
          || !Array.isArray(record.escapes)) return null;
      let runStart = record.marker;
      while (source[runStart - 1] === "\\") runStart -= 1;
      if ((record.marker - runStart + 1) % 2 === 0) return null;
      const escapes = new Set();
      for (const at of record.escapes) {
        if (!Number.isInteger(at) || at < runStart || at >= record.marker || escapes.has(at)) return null;
        escapes.add(at);
      }
      result.push({ marker: record.marker, escapes: [...escapes].sort((a,b) => a-b) });
      seen.add(record.marker);
    }
    return result.sort((a,b) => a.marker-b.marker);
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
      const entry = this.entries[this.index - 1];
      model.apply(entry.inverse);
      this.index -= 1;
      return entry;
    }

    redo(model) {
      if (this.index >= this.entries.length) return null;
      const entry = this.entries[this.index];
      model.apply(entry.forward);
      this.index += 1;
      return entry;
    }
  }

  Internals.DocumentModel = DocumentModel;
  Internals.TransactionJournal = TransactionJournal;
})();
