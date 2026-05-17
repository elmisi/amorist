# Scripts

## Installer

Install amorist:

```bash
./scripts/install.sh
```

The installer prints a summary, asks for confirmation, installs the small runtime prerequisites, copies the app to `/opt/amorist`, and links `/usr/local/bin/amorist`. It currently supports Ubuntu/Debian systems.

## Uninstaller

Remove the installed files:

```bash
./scripts/uninstall.sh
```

The uninstaller removes `/opt/amorist` and the `/usr/local/bin/amorist` command link. It does not remove system packages such as `python3` or `xdg-utils`.

## Screenshots

Screenshots use the static demo routes served by the local launcher:

```bash
./scripts/capture-screenshots.sh
```

The script uses the first Chromium-compatible browser it finds. Set `BROWSER=/path/to/browser` to choose one explicitly.

The script writes:

- `docs/screenshots/empty-state.png`
- `docs/screenshots/source-mode.png`
- `docs/screenshots/wysiwyg-mode.png`

`source-mode.png` intentionally shows raw Markdown because it captures source mode. Use `wysiwyg-mode.png` when you want a rendered editor screenshot.
