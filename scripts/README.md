# Scripts

## Ubuntu Installer

Build and install amorist on Ubuntu:

```bash
npm run install:ubuntu
```

The script prints a summary, asks for confirmation, installs build prerequisites, builds the `.deb`, installs it, and verifies that `amorist` is available in `PATH`.

## Screenshots

Screenshots are generated from deterministic demo routes in the Vite app:

```bash
npm run screenshots
```

The command writes:

- `docs/screenshots/empty-state.png`
- `docs/screenshots/source-mode.png`
- `docs/screenshots/wysiwyg-mode.png`

`source-mode.png` intentionally shows raw Markdown because it captures source mode. Use `wysiwyg-mode.png` when you want a rendered editor screenshot.
