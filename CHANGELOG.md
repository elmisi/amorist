# Changelog

All notable changes to amorist are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-05-19

### Fixed
- Save fails with "Failed to fetch" after browser tab is idle for several minutes.
  Server heartbeat timeout increased from 12 s to 120 s to tolerate browser
  throttling; client shows a warning banner after 3 consecutive ping failures.
- Lists gain empty blank lines when switching to source mode. List items are now
  serialized as a single block instead of separate entries joined by double
  newlines.
- `---` (and `***`, `___`) not rendered as horizontal rule. Added full `hr` block
  type: parser, renderer, serializer, Enter shortcut, and editor CSS.

### Changed
- Save and reload use a 10-second fetch timeout (AbortController) instead of
  waiting for the browser default.
- Save automatically retries once on network error or timeout before showing
  an error.
- Server returns structured JSON errors on file-write failures (disk full,
  permission denied) and cleans up orphaned temp files.
- Notice banner distinguishes warnings (amber) from errors (red) so ping-loss
  warnings don't mask save/reload errors.

## [0.2.0] - 2026-05-18

### Changed
- Installer runs without a confirmation prompt and prints a shorter action/result
  summary.
- Installer no longer escalates privileges or invokes a package manager.
  Scope is chosen from `EUID`: root installs system-wide to `/opt/amorist`
  + `/usr/local/bin/amorist`; non-root installs user-locally to
  `$XDG_DATA_HOME/amorist` (default `~/.local/share/amorist`) +
  `~/.local/bin/amorist`.
- Uninstaller mirrors the same scope rule.

### Removed
- `apt-get` invocation and Ubuntu/Debian-only `/etc/os-release` detection from
  `scripts/install.sh`.
- Automatic installation of `python3` and `xdg-utils`. `python3` is now a
  hard prerequisite the installer checks for; `xdg-open` remains optional
  (the launcher already prints the URL when `xdg-open` is absent, see
  `bin/amorist:258-267`).
