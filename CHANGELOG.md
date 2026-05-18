# Changelog

All notable changes to amorist are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-18

### Changed
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
