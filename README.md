# amorist

Fast local Markdown editing.

amorist is a small Tauri desktop app for opening, editing, and saving one Markdown file at a time. It has a WYSIWYG editor for everyday writing and a source mode when exact Markdown control matters.

![amorist WYSIWYG editor](docs/screenshots/wysiwyg-mode.png)

## Features

- Native open and save dialogs for `.md`, `.markdown`, and `.mdown` files.
- Startup file support: `amorist path/to/file.md`.
- WYSIWYG Markdown editing with headings, emphasis, links, code, lists, blockquotes, fenced code blocks, and task lists.
- Source mode for exact Markdown edits.
- Existing `LF` or `CRLF` line endings are preserved on save.
- Files larger than 10 MB are rejected before reading.

Markdown table editing is not supported in v1.

## Ubuntu Install

Build and install the local `.deb` package:

```bash
npm run install:ubuntu
```

The installer prints the packages and commands it will run, asks for confirmation, builds the Debian package, installs it, and verifies that `amorist` is available in `PATH`.

Open a Markdown file from the shell:

```bash
amorist file.md
```

The command also accepts `.markdown` and `.mdown` files. If more than one path is passed, amorist opens the first one and shows a warning.

## Development

Install JavaScript dependencies:

```bash
npm install
```

Run the web frontend:

```bash
npm run dev
```

Run the desktop app in development:

```bash
npm run tauri:dev
```

Run checks:

```bash
npm run typecheck
npm run test
npm run build
```

Build the desktop bundle:

```bash
npm run tauri:build
```

On Ubuntu 24.04, Tauri also needs native WebKit/libsoup development packages:

```bash
sudo apt-get install build-essential libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev patchelf pkg-config
```

## Manual QA

Use a temporary copy when testing save behavior.

Checklist:

- Open a Markdown file under 2 MB.
- Start the app with a Markdown path from the Linux command line.
- Edit heading text in WYSIWYG mode.
- Add text in source mode.
- Save and reopen the file.
- Verify an existing `CRLF` file remains `CRLF` after saving.
- Try opening a `.txt` file and confirm it is rejected.
- Try opening a file larger than 10 MB and confirm the current document is unchanged.
