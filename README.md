# amorist

Fast local Markdown editing with a small browser-based runtime.

amorist opens one Markdown file at a time from the shell:

```bash
amorist file.md
```

The command starts a private server on `127.0.0.1`, opens the editor in your browser, and saves directly back to the file you passed in. The editor is a small vanilla JavaScript component built for this project, so Markdown stays the source of truth and the runtime has no Node, Rust, WebKitGTK, or Electron dependency chain.

![amorist WYSIWYG editor](docs/screenshots/wysiwyg-mode.png)

## Features

- Opens `.md`, `.markdown`, and `.mdown` files from the command line.
- Saves directly to the same local file with `Ctrl+S` or the Save button.
- Keeps existing `LF` or `CRLF` line endings when saving.
- Shows a browser-native warning before closing with unsaved changes.
- Stops the local server automatically after the browser tab is closed.
- Supports headings, emphasis, links, code, lists, blockquotes, fenced code blocks, task lists, and readable Markdown tables.
- Converts common WYSIWYG Markdown shortcuts while typing: `#`, `##`, `###`, `-`, `1.`, `>`, code fences, task markers, inline code like `` `name` ``, and bold text like `**name**`.
- Keeps wide tables and fenced code blocks inside horizontally scrollable blocks.
- Rejects files larger than 10 MB before reading.

## WYSIWYG Shortcuts

In WYSIWYG mode, amorist converts common Markdown markers as you type:

- `# `, `## `, `### ` for headings.
- `- ` and `1. ` for lists.
- `- [ ] ` and `- [x] ` for task lists.
- `> ` for blockquotes.
- Triple backticks followed by Enter for fenced code blocks.
- `` `code` `` for inline code.
- `**bold**` for bold text.

## Tables

Pipe tables are shown as editable monospace Markdown blocks. amorist aligns columns when rendering or saving, counts emoji and other wide glyphs by visual width, preserves escaped pipes like `\|`, and keeps blank lines inside a table when the following non-empty line is still a table row.

Very wide tables scroll horizontally inside their block, so the rest of the document stays readable.

## Install

amorist requires `python3` to be already installed (the launcher is a Python
script). `xdg-open` is optional: if present the launcher opens the editor in
your default browser automatically; otherwise it prints the URL for you to
open manually.

Install from the repo checkout:

```bash
./scripts/install.sh
```

The installer asks for confirmation and chooses the install scope from your
effective UID — **the script never escalates privileges**:

- Run as a normal user → installs under `~/.local/share/amorist` and links
  the command at `~/.local/bin/amorist`. If `~/.local/bin` is not on your
  `PATH`, the installer prints the exact `export` line to add to your shell
  rc.
- Run as root → installs under `/opt/amorist` and links
  `/usr/local/bin/amorist`.

After installation:

```bash
amorist file.md
```

If `file.md` does not exist yet, amorist creates it on the first save.

To remove the installed files (same scope rule applies — run as root to
remove a system-wide install, run as your normal user to remove a user
install):

```bash
./scripts/uninstall.sh
```

## Development

Run from the checkout without installing:

```bash
./bin/amorist --no-open file.md
```

Open the printed local URL in a browser. Omit `--no-open` to let amorist call `xdg-open`.

Useful checks:

```bash
python3 -m py_compile bin/amorist
node --check web/editor/amorist-editor.js
node --check web/app.js
bash -n scripts/install.sh
bash -n scripts/uninstall.sh
bash -n scripts/capture-screenshots.sh
```

## Embedded Editor

The editor lives in `web/editor/amorist-editor.js` and `web/editor/amorist-editor.css`. It is plain browser JavaScript and can be embedded in another vanilla app without a build step:

```html
<link rel="stylesheet" href="amorist-editor.css">
<div id="description-editor"></div>
<script src="amorist-editor.js"></script>
<script>
  const editor = AmoristEditor.create(document.getElementById("description-editor"), {
    value: "# Notes",
    onChange(markdown) {
      console.log(markdown);
    },
  });

  editor.getMarkdown();
  editor.setMarkdown("Updated **Markdown**");
  editor.showSourceMode();
  editor.showWysiwygMode();
  editor.destroy();
</script>
```

The editor intentionally supports a small Markdown subset: headings, paragraphs, emphasis, inline code, links, blockquotes, bullet lists, numbered lists, task lists, fenced code blocks, and pipe tables. In WYSIWYG mode, common shortcuts are converted as you type; tables are automatically aligned on serialization. Use source mode when exact text control matters.
