# Scripts

## Ubuntu Installer

Install amorist on Ubuntu:

```bash
./scripts/install-ubuntu.sh
```

The installer prints a summary, asks for confirmation, installs the small runtime prerequisites, copies the app to `/opt/amorist`, and links `/usr/local/bin/amorist`.

## Screenshots

Screenshots use the static demo routes served by the local launcher:

```bash
./scripts/capture-screenshots.sh
```

The script writes:

- `docs/screenshots/empty-state.png`
- `docs/screenshots/source-mode.png`
- `docs/screenshots/wysiwyg-mode.png`

`source-mode.png` intentionally shows raw Markdown because it captures source mode. Use `wysiwyg-mode.png` when you want a rendered editor screenshot.
