# Scripts

## Installer

Install amorist:

```bash
./scripts/install.sh
```

The installer prints a summary, asks for confirmation, and **never escalates
privileges**. The install scope is chosen from your effective UID:

- Normal user → installs under `~/.local/share/amorist` and links the command
  at `~/.local/bin/amorist`. The installer creates `~/.local/bin` if missing
  and prints a `PATH` hint if it is not yet on `PATH`.
- Root → installs under `/opt/amorist` and links `/usr/local/bin/amorist`.

`python3` must already be installed; `xdg-open` is optional (the launcher
prints the URL when `xdg-open` is absent).

## Uninstaller

Remove the installed files:

```bash
./scripts/uninstall.sh
```

The uninstaller mirrors the installer's scope rule — run as your normal user
to remove a user install, or as root to remove a system install. It only
removes a `*/bin/amorist` symlink if that symlink points at the managed
amorist target.

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

## Optional Browser Smoke Test

Run the app-shell save/reload smoke test with:

```bash
AMORIST_RUN_BROWSER_SMOKE=1 node tests/app-shell-smoke.test.js
```

The test starts the local launcher against a temporary Markdown file and uses
the first Chromium-compatible browser it finds. Set `BROWSER=/path/to/browser`
to choose one explicitly.
