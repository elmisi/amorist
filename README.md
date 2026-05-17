# amorist

Fast local Markdown editing for plan-cycle documents.

amorist is a small Tauri desktop app for opening, editing, and saving one Markdown file at a time. It uses a WYSIWYG editor for ordinary notes and switches plan-cycle files to source mode by default so annotation lines such as `> **NOTE**:` stay grep-detectable after saving.

![amorist WYSIWYG editor](docs/screenshots/wysiwyg-mode.png)

## Features

- Native open and save dialogs for `.md`, `.markdown`, and `.mdown` files.
- Optional startup file: `amorist path/to/file.md`.
- WYSIWYG Markdown editing with headings, emphasis, links, code, lists, blockquotes, fenced code blocks, and task lists.
- Source mode for exact Markdown edits and plan-cycle note preservation.
- Existing `LF` or `CRLF` line endings are preserved on save.
- Files larger than 10 MB are rejected before reading.

Markdown table editing is not supported in v1.

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

On Ubuntu 24.04, Tauri also needs the native WebKit/libsoup development packages:

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

## Screenshots

Screenshots are generated from deterministic demo routes in the Vite app:

```bash
npm run screenshots
```

The command writes:

- `docs/screenshots/empty-state.png`
- `docs/screenshots/source-mode.png`
- `docs/screenshots/wysiwyg-mode.png`

## Manual QA

Use a temporary copy when testing save behavior.

```bash
cp docs/plan-tauri-markdown-editor-20260517-1654.md /tmp/amorist-plan.md
npm run tauri:dev -- -- /tmp/amorist-plan.md
```

Checklist:

- Open a Markdown file under 2 MB.
- Start the app with a Markdown path from the Linux command line.
- Edit heading text in WYSIWYG mode.
- Add a plan-cycle note in source mode.
- Save and reopen the file.
- Verify note preservation with `rg '^> \*\*NOTE\*\*:' /tmp/amorist-plan.md`.
- Verify an existing `CRLF` file remains `CRLF` after saving.
- Try opening a `.txt` file and confirm it is rejected.
- Try opening a file larger than 10 MB and confirm the current document is unchanged.

![amorist source mode](docs/screenshots/source-mode.png)
