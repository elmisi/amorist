# Plan: Revise installation procedure — remove apt, drop sudo by default

## Context

The current installer (`scripts/install.sh`) and uninstaller (`scripts/uninstall.sh`) target Ubuntu/Debian only and rely on `sudo apt-get` to install `python3` and `xdg-utils` before copying the app to `/opt/amorist` and linking `/usr/local/bin/amorist`.

Verified by reading the relevant files (commit `f35e615`, branch `main`):

- `scripts/install.sh:10-34` — detects `/etc/os-release` and refuses anything that is not `ID=ubuntu|debian` or `ID_LIKE=*debian*`.
- `scripts/install.sh:22,27` — installs `python3` and `xdg-utils` via apt.
- `scripts/install.sh:36-41` — requires `sudo`, `install`, and `apt-get` on PATH.
- `scripts/install.sh:82-92` — runs `sudo apt-get update`, `sudo apt-get install -y …`, then `sudo cp -a`, `sudo install -d`, `sudo ln -sfn`, `sudo chmod`.
- `scripts/uninstall.sh:4-12` — hardcodes `/opt/amorist` and `/usr/local/bin/amorist`, requires `sudo` on PATH, then `sudo rm -rf` / `sudo rm -f` (`scripts/uninstall.sh:49-54`).
- `bin/amorist:258-267` — `open_browser()` already degrades gracefully when `xdg-open` is missing: it catches `FileNotFoundError` and prints "xdg-open is not installed; open the URL above manually." while still printing the URL via `main()` (`bin/amorist:70`). No code change is needed for the xdg fallback; the installer just needs to stop trying to install it.
- `bin/amorist:1` — shebang is `#!/usr/bin/env python3`, so a working `python3` on PATH is a hard runtime requirement.
- `README.md:46-67`, `scripts/README.md:1-21` — both describe the apt/sudo flow that this plan removes.

The user's goals for this change (verbatim summary of the request):

1. Assume `python3` is present; do not install it via apt.
2. Do not install `xdg-utils` either; if `xdg-open` is on PATH amorist uses it, otherwise the launcher already prints the URL for the user to open manually (already true in `bin/amorist:266-267`).
3. Remove the apt path entirely.
4. Do not require `sudo`. If we can install for everyone without prompting for credentials (i.e. the operator is already root), do so; otherwise install only for the current user under a local `bin` directory if one exists.

## How to work with this plan

Read the entire plan before acting. Context, approach, edge cases, and open questions are all load-bearing.

For operational instructions (how to annotate, review, analyze impact, check quality): see the companion file `plan-revise-install-procedure-20260518-0953.ops.md` in the same directory.

## Approach

Replace the OS-detect-and-apt flow with a sudo-free, scope-aware installer that picks the install mode from the effective UID:

- **Root (`EUID == 0`)** → system install: copy app to `/opt/amorist`, link `/usr/local/bin/amorist`. Same destinations as today; no `sudo` ever spawned, since the script itself is already root.
- **Non-root** → user install: copy app to `$XDG_DATA_HOME/amorist` (default `$HOME/.local/share/amorist`), link `$HOME/.local/bin/amorist`. No privilege escalation.

The installer no longer touches package managers and no longer detects distro. It checks that `python3` is on PATH (hard prerequisite — the launcher's shebang needs it) and otherwise prints a clear error and exits non-zero. `xdg-utils` is not touched: the launcher already prints the URL when `xdg-open` is missing, so the operator can paste it into a browser.

`~/.local/bin` may or may not exist on the user's system. Decision rule:

- If it exists → use it directly.
- If it does not exist → create it during install (after the user has confirmed the summary). `install -d` is idempotent and matches the XDG Base Directory practice followed by `pip install --user`, `cargo install`, and similar tools.
- If `$HOME/.local/bin` is not on `PATH` after install, print a clear hint with the exact line to add to the shell rc, but do not modify any rc file automatically.

`ensure_writable_parent` runs **before** the confirmation prompt and is strictly read-only: it walks up from the target path to the first existing ancestor and tests it with `[[ -w … ]]`. It never calls `mkdir`/`install -d`, never writes a probe file, and never mutates the filesystem. The actual directory creation (`install -d "$INSTALL_DIR"`, `install -d "$BIN_DIR"`) happens **after** the user has answered `Continue?`. This keeps the fail-fast UX (the user is not asked to confirm an install that cannot finish) while preserving the rule that no directory is created until consent has been given.

Uninstall mirrors install symmetrically: root → remove `/opt/amorist` + `/usr/local/bin/amorist`; non-root → remove `$HOME/.local/share/amorist` + `$HOME/.local/bin/amorist`. Cross-scope cleanup (e.g. a user trying to remove a previous root install) is not attempted automatically; the script prints what it found and what it left untouched, matching the existing "left in place" behavior at `scripts/uninstall.sh:55-72`.

### Why this approach over alternatives

- **Why not a `--user` / `--system` flag pair?** The user's stated rule maps cleanly onto "are we root or not" — there is no scenario where a non-root user has uncontested write access to `/opt` and `/usr/local/bin`. A flag would add surface area for unsupported combinations (e.g. `--system` as non-root, which would have to either spawn `sudo` — disallowed — or fail). EUID-driven mode keeps one path per role and zero `sudo` calls.
- **Why not detect writability of `/opt` and `/usr/local/bin` directly?** It is essentially equivalent to checking `EUID == 0` on every supported system, and obscures intent. We keep the EUID check and document it.
- **Why keep `/opt/amorist` for system mode instead of `/usr/local/share/amorist` (FHS-purist) or `/usr/local/lib/amorist`?** The current install already uses `/opt/amorist` and downstream packagers / users have no reason to expect a path change. The diff stays minimal for the root path.

## Detailed Changes

### `scripts/install.sh` — full rewrite

Target shape (structure only, not full source):

```
#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Hard prerequisite: python3 must already be installed. No package manager invoked.
if ! command -v python3 >/dev/null 2>&1; then
  echo "amorist requires python3 on PATH. Install it with your package manager and re-run." >&2
  exit 1
fi

# Pick scope from EUID. No sudo is ever invoked from this script.
if [[ "$(id -u)" -eq 0 ]]; then
  SCOPE="system"
  INSTALL_DIR="/opt/amorist"
  BIN_DIR="/usr/local/bin"
else
  SCOPE="user"
  INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/amorist"
  BIN_DIR="$HOME/.local/bin"
fi
BIN_PATH="$BIN_DIR/amorist"

# Sanity (read-only, no mutation): we must be able to write the destinations.
# If not, fail with a clear message (do NOT escalate, do NOT create directories yet).
ensure_writable_parent "$INSTALL_DIR"
ensure_writable_parent "$BIN_DIR"

# Refuse to proceed if $BIN_PATH exists but is not a managed symlink. Protects against
# clobbering an unrelated 'amorist' file someone placed in $BIN_DIR by hand.
guard_bin_path "$BIN_PATH" "$INSTALL_DIR/bin/amorist"

VERSION="$(tr -d '[:space:]' < VERSION)"

# Summary + confirmation. Mention that BIN_DIR will be created if missing,
# and that the user must restart shell / add to PATH if BIN_DIR is not on PATH.
cat <<SUMMARY
amorist installer

Scope: $SCOPE  (no sudo will be used)
Project path: $ROOT_DIR
Version: $VERSION

This script will:
  1. Verify python3 is available
  2. Stage the launcher and web assets into a sibling directory, then
     atomically swap it into: $INSTALL_DIR
  3. Create or update the command symlink at: $BIN_PATH
     (only replaces an existing symlink already managed by amorist;
      refuses to overwrite an unrelated file)
  4. (If missing) create the directory: $BIN_DIR
  5. Report whether $BIN_DIR is on your PATH

After installation you should be able to run:
  amorist file.md

SUMMARY

read -r -p "Continue? [y/N] " CONFIRM
case "$CONFIRM" in
  y|Y|yes|YES) ;;
  *) echo "Installation cancelled."; exit 0 ;;
esac

echo "Installing amorist into $INSTALL_DIR..."

# Stage into a sibling temp dir, then swap. Keeps the live $INSTALL_DIR intact
# until the new copy is fully on disk — protects against disk-full, read errors,
# permission issues on source files, or an interrupted run.
STAGE_DIR="$INSTALL_DIR.amorist-stage.$$"
guard_destructive_path "$STAGE_DIR"
rm -rf "$STAGE_DIR"                       # paranoia: leftover from an interrupted run
install -d "$STAGE_DIR"
cp -a bin web VERSION README.md "$STAGE_DIR/"
chmod +x "$STAGE_DIR/bin/amorist"

# Swap. mv on the same filesystem is atomic for the rename; the brief window
# between the two mv calls is when $INSTALL_DIR does not exist. The symlink
# update at the end is the only state the operator's PATH cares about.
guard_destructive_path "$INSTALL_DIR"
OLD_DIR=""
if [[ -e "$INSTALL_DIR" ]]; then
  OLD_DIR="$INSTALL_DIR.amorist-old.$$"
  guard_destructive_path "$OLD_DIR"
  mv "$INSTALL_DIR" "$OLD_DIR"
fi
mv "$STAGE_DIR" "$INSTALL_DIR"
if [[ -n "$OLD_DIR" ]]; then
  rm -rf "$OLD_DIR"
fi

install -d "$BIN_DIR"
ln -sfn "$INSTALL_DIR/bin/amorist" "$BIN_PATH"

# Final visibility check. Verify the new install is what gets resolved, not an
# older install earlier on PATH. Do NOT exit non-zero just because PATH lacks
# $BIN_DIR in user scope — print a hint so the user can add it.
RESOLVED="$(command -v amorist 2>/dev/null || true)"
if [[ -z "$RESOLVED" ]]; then
  case ":$PATH:" in
    *":$BIN_DIR:"*)
      echo "amorist was installed at $BIN_PATH, but is still not visible on PATH." >&2
      echo "This usually means the shell has cached an older PATH lookup. Try: hash -r" >&2
      exit 1 ;;
    *)
      echo "Installed: $BIN_PATH"
      echo "Version: $("$BIN_PATH" --version)"
      echo "Note: $BIN_DIR is not on PATH yet."
      echo "Add this to your shell rc (~/.bashrc or ~/.zshrc) and restart the shell:"
      echo "  export PATH=\"$BIN_DIR:\$PATH\""
      ;;
  esac
elif [[ "$RESOLVED" != "$BIN_PATH" ]]; then
  echo "Installed: $BIN_PATH" >&2
  echo "Warning: 'amorist' on PATH currently resolves to $RESOLVED (earlier on PATH)." >&2
  echo "Either remove the older install or move $BIN_DIR earlier in PATH." >&2
  echo "Version of the new install: $("$BIN_PATH" --version)"
else
  echo "Installed: $RESOLVED"
  echo "Version: $(amorist --version)"
  echo "Usage: amorist file.md"
fi
```

Helpers used by the snippet — defined inline at the top of the script (place these between the shebang/`set` line and the python3 check). Target shape:

```
# Walks up from <path> to the first existing ancestor and verifies it is writable.
# Read-only: never creates directories, never writes probe files. Aborts on failure.
ensure_writable_parent() {
  local target="$1" ancestor
  ancestor="$(dirname -- "$target")"
  while [[ ! -e "$ancestor" ]]; do
    ancestor="$(dirname -- "$ancestor")"
    [[ "$ancestor" == "/" ]] && break
  done
  if [[ ! -w "$ancestor" ]]; then
    echo "amorist: cannot write to $ancestor (needed to create $target)." >&2
    echo "Fix the permission and re-run (do not re-run with sudo from this script)." >&2
    exit 1
  fi
}

# Refuses to proceed if <path> matches a hardcoded denylist. Catches malformed
# environments where INSTALL_DIR could expand to a wide-blast-radius path.
guard_destructive_path() {
  local p="$1"
  case "$p" in
    ""|"/"|"$HOME"|"$HOME/"|"$HOME/.local"|"$HOME/.local/"|"$HOME/.local/share"|"$HOME/.local/share/"|"$HOME/.local/bin"|"$HOME/.local/bin/"|"/opt"|"/opt/"|"/usr"|"/usr/"|"/usr/local"|"/usr/local/"|"/usr/local/bin"|"/usr/local/bin/")
      echo "amorist: refusing destructive operation on protected path: $p" >&2
      exit 1 ;;
  esac
}

# Refuses to overwrite $BIN_PATH if it exists but is not a symlink whose target
# is exactly $expected (the managed bin path for the current scope).
guard_bin_path() {
  local bin_path="$1" expected="$2" current
  [[ ! -e "$bin_path" && ! -L "$bin_path" ]] && return 0
  if [[ ! -L "$bin_path" ]]; then
    echo "amorist: $bin_path exists and is not a symlink. Refusing to overwrite." >&2
    echo "Remove it manually if you want amorist to manage this path." >&2
    exit 1
  fi
  current="$(readlink -- "$bin_path")"
  if [[ "$current" != "$expected" ]]; then
    echo "amorist: $bin_path is a symlink to $current, not a managed amorist target." >&2
    echo "Remove it manually if you want amorist to manage this path." >&2
    exit 1
  fi
}
```

The denylist in `guard_destructive_path` covers every parent directory the installer/uninstaller can produce, so a malformed `XDG_DATA_HOME` cannot make a destructive call land on a wide-blast-radius path. Worked examples:

- `XDG_DATA_HOME` unset **or** empty string → `${XDG_DATA_HOME:-$HOME/.local/share}` expands to `$HOME/.local/share` (bash's `:-` operator falls back on both unset and null values), so `INSTALL_DIR=$HOME/.local/share/amorist`. Safe.
- `XDG_DATA_HOME="/"` → `INSTALL_DIR=/amorist`, `STAGE_DIR=/amorist.amorist-stage.$$`. None match the denylist, so `guard_destructive_path` passes. The script will then try to `install -d /amorist` and either succeed (root) or fail at `ensure_writable_parent` (non-root) — both safe outcomes; nothing destructive runs at `/`.
- `XDG_DATA_HOME="/usr/local"` → `INSTALL_DIR=/usr/local/amorist`. Not in the denylist either; protected instead by `ensure_writable_parent "/usr/local/amorist"` failing for non-root operators.

The guard explicitly **does not** try to validate that the path is "amorist-shaped"; that protection comes from `guard_bin_path` for the symlink target and from naming the stage/old dirs with `.amorist-stage.$$` / `.amorist-old.$$` suffixes (which are unique to amorist and to the current PID).

### Stale system-install hint (user scope only)

After `guard_bin_path` passes in user scope, the installer checks for a leftover system install and, if found, prints a courtesy hint **before** the summary so the operator sees it before answering `Continue?`:

```
if [[ "$SCOPE" == "user" && -L /usr/local/bin/amorist ]]; then
  legacy_target="$(readlink -- /usr/local/bin/amorist)"
  if [[ "$legacy_target" == /opt/amorist/bin/amorist ]]; then
    echo "Note: a previous system-wide install is present at /opt/amorist." >&2
    echo "      Run 'sudo ./scripts/uninstall.sh' from the project to remove it." >&2
    echo "      This installer will not touch it." >&2
    echo "" >&2
  fi
fi
```

### `scripts/uninstall.sh` — full rewrite

Target shape:

```
#!/usr/bin/env bash
set -Eeuo pipefail

# Copy guard_destructive_path inline from scripts/install.sh so the uninstaller
# is self-contained (same body as the "Helpers used by the snippet" code block
# earlier in this plan — do not factor it into a shared file).
guard_destructive_path() {
  local p="$1"
  case "$p" in
    ""|"/"|"$HOME"|"$HOME/"|"$HOME/.local"|"$HOME/.local/"|"$HOME/.local/share"|"$HOME/.local/share/"|"$HOME/.local/bin"|"$HOME/.local/bin/"|"/opt"|"/opt/"|"/usr"|"/usr/"|"/usr/local"|"/usr/local/"|"/usr/local/bin"|"/usr/local/bin/")
      echo "amorist: refusing destructive operation on protected path: $p" >&2
      exit 1 ;;
  esac
}

if [[ "$(id -u)" -eq 0 ]]; then
  SCOPE="system"
  INSTALL_DIR="/opt/amorist"
  BIN_PATH="/usr/local/bin/amorist"
else
  SCOPE="user"
  INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/amorist"
  BIN_PATH="$HOME/.local/bin/amorist"
fi
EXPECTED_BIN_TARGET="$INSTALL_DIR/bin/amorist"

# "Left in place" diagnostics — mirrors today's scripts/uninstall.sh:14-24 logic,
# but without sudo and without referencing apt packages.
BIN_STATUS="not present"
if [[ -L "$BIN_PATH" ]]; then
  BIN_TARGET="$(readlink -f "$BIN_PATH" || true)"
  if [[ "$BIN_TARGET" == "$EXPECTED_BIN_TARGET" ]]; then
    BIN_STATUS="symlink to $BIN_TARGET"
  else
    BIN_STATUS="symlink to $BIN_TARGET (will not remove automatically)"
  fi
elif [[ -e "$BIN_PATH" ]]; then
  BIN_STATUS="exists but is not a symlink (will not remove automatically)"
fi

cat <<SUMMARY
amorist uninstaller

Scope: $SCOPE  (no sudo will be used)

This script will:
  1. Remove the installed app directory: $INSTALL_DIR
  2. Remove the command link: $BIN_PATH

Current command status: $BIN_STATUS

It does not touch python3 or xdg-utils on your system.

SUMMARY

read -r -p "Continue? [y/N] " CONFIRM
case "$CONFIRM" in
  y|Y|yes|YES) ;;
  *) echo "Uninstall cancelled."; exit 0 ;;
esac

echo "Removing amorist files..."
guard_destructive_path "$INSTALL_DIR"
rm -rf "$INSTALL_DIR"

# Only remove $BIN_PATH if it is a symlink to the managed amorist target
# (mirror current safety at scripts/uninstall.sh:51-57).
if [[ -L "$BIN_PATH" ]]; then
  BIN_TARGET="$(readlink -f "$BIN_PATH" || true)"
  if [[ "$BIN_TARGET" == "$EXPECTED_BIN_TARGET" || -z "$BIN_TARGET" ]]; then
    rm -f "$BIN_PATH"
  else
    echo "Left $BIN_PATH in place because it points to: $BIN_TARGET" >&2
  fi
elif [[ -e "$BIN_PATH" ]]; then
  echo "Left $BIN_PATH in place because it is not an amorist symlink." >&2
fi

# Post-conditions: same as today's scripts/uninstall.sh:62-73.
if [[ -e "$INSTALL_DIR" ]]; then
  echo "Could not fully remove $INSTALL_DIR." >&2
  exit 1
fi
if [[ -L "$BIN_PATH" ]]; then
  BIN_TARGET="$(readlink -f "$BIN_PATH" || true)"
  if [[ "$BIN_TARGET" == "$EXPECTED_BIN_TARGET" || -z "$BIN_TARGET" ]]; then
    echo "Could not remove $BIN_PATH." >&2
    exit 1
  fi
fi

echo "Uninstalled amorist."
```

Cross-scope note: the user-scope uninstaller targets only `$HOME/.local/share/amorist` and `$HOME/.local/bin/amorist`. If a previous **root** install exists at `/opt/amorist` + `/usr/local/bin/amorist`, the user-scope script does not touch it: its `INSTALL_DIR` and `BIN_PATH` variables never point at the system paths, and the `BIN_STATUS` line in the summary will report `not present` (or whatever exists at `$HOME/.local/bin/amorist`, which is independent of the system install). To remove the system install the operator must re-run the uninstaller with `sudo` or as root. We do not silently jump scope.

Portability note: the uninstaller continues to use `readlink -f` (as today at `scripts/uninstall.sh:16,53,68`), which is GNU coreutils-specific. This is intentional — the rewrite stays **Linux-targeted**. macOS/BSD are not supported targets, only "not actively rejected by an OS-id check"; see the matching Open Question. If macOS/BSD support is later in scope, replace `readlink -f` with a portable read (e.g. compare `readlink` output without `-f` to the literal `$INSTALL_DIR/bin/amorist`, since the link is created with that exact target string and does not need full canonicalization).

### `bin/amorist` — no change needed

`open_browser()` already handles missing `xdg-open` (`bin/amorist:258-267`). The user already sees the URL via `main()` (`bin/amorist:70`). Verified by reading the file end-to-end. **No edits required.**

### `README.md` — update install section

Replace lines 45-67 (the entire `## Install` heading through the closing paragraph about uninstall) with the following target content. Keep the empty line that precedes `## Development` at line 69.

```
## Install

amorist requires `python3` to be already installed (the launcher is a Python
script). `xdg-open` is optional: if present the launcher opens the editor in
your default browser automatically; otherwise it prints the URL for you to
open manually.

Install from the repo checkout:

```bash
./scripts/install.sh
```

The installer asks for confirmation and chooses the install scope from your effective UID — **no `sudo` is invoked from the script**:

- Run as a normal user → installs under `~/.local/share/amorist` and links

the command at `~/.local/bin/amorist`. If `~/.local/bin` is not on your   `PATH`, the installer prints the exact `export` line to add to your shell   rc.

- Run as root (`sudo ./scripts/install.sh`) → installs under `/opt/amorist`

and links `/usr/local/bin/amorist`.

After installation:

```
amorist file.md
```

If `file.md` does not exist yet, amorist creates it on the first save.

To remove the installed files (same scope rule applies — run with `sudo` to remove a system-wide install, run as your normal user to remove a user install):

```
./scripts/uninstall.sh
```

```

No other README sections need changes (Development at lines 69-88 uses `./bin/amorist` from the checkout and is independent of install scope).

### `scripts/README.md` — update installer/uninstaller sections

Replace the content at lines 1-21 (everything from the file heading through the end of the `## Uninstaller` section) with the following target content. The blank line and the `## Screenshots` heading that currently start at line 23 are unchanged.

```markdown
# Scripts

## Installer

Install amorist:

```bash
./scripts/install.sh
```

The installer prints a summary, asks for confirmation, and does **not** use `sudo`. The install scope is chosen from your effective UID:

- Normal user → installs under `~/.local/share/amorist` and links the command

at `~/.local/bin/amorist`. The installer creates `~/.local/bin` if missing   and prints a `PATH` hint if it is not yet on `PATH`.

- Root (`sudo ./scripts/install.sh`) → installs under `/opt/amorist` and links

`/usr/local/bin/amorist`.

`python3` must already be installed; `xdg-open` is optional (the launcher prints the URL when `xdg-open` is absent).

## Uninstaller

Remove the installed files:

```
./scripts/uninstall.sh
```

The uninstaller mirrors the installer's scope rule — run as your normal user to remove a user install, or with `sudo` to remove a system install. It only removes a `*/bin/amorist` symlink if that symlink points at the managed amorist target.

```

The "Screenshots" section at lines 23-39 is unchanged.

## Edge Cases and Risks

- **`~/.local/bin` not on PATH after user install.**
  - Likelihood: medium. On Ubuntu 22.04+/Debian 12+ default `~/.profile` adds it when `~/.local/bin` exists at login, so a fresh install can take effect only after the next shell. Older shells, custom dotfiles, and non-login shells will miss it.
  - Impact: command unavailable until PATH is fixed. Low severity (single clear hint).
  - Mitigation: post-install check (shown in the snippet above) explicitly prints the line to add and the rc files to consider. We never edit rc files automatically.
  - Exit clause: none needed — install still succeeded; only PATH discovery is incomplete.

- **`python3` not on PATH.**
  - Likelihood: low on modern Linux desktops; the project is Linux-targeted (see `scripts/install.sh:10-34` for the prior assumption set).
  - Impact: launcher cannot run at all (shebang fails).
  - Mitigation: installer fails fast with the exact remediation ("install python3 with your package manager and re-run"). No attempt to install it.
  - Exit clause: this is a hard prerequisite — there is no plan B.

- **Destination unwritable in the chosen scope** (e.g. `/opt/amorist` owned by another user during a root install, or `~/.local/share` symlinked to a read-only path).
  - Likelihood: low.
  - Impact: install fails. With the staging strategy described in `scripts/install.sh`, the previous `$INSTALL_DIR` is preserved; only the sibling stage dir was written.
  - Mitigation: two-layer defense. (1) Read-only `ensure_writable_parent` precheck for both `$INSTALL_DIR` and `$BIN_DIR` before asking for confirmation, so the operator is told up front. (2) Stage into `$INSTALL_DIR.amorist-stage.$$` then swap with `mv`. If the staged copy fails (disk full, read error from source, interrupted process, permission issue on a source file), the live install is untouched and the operator can `rm -rf "$INSTALL_DIR.amorist-stage.$$"` to clean up.
  - Exit clause: do not attempt to switch scope; print the path and let the operator decide.

- **User runs `./scripts/install.sh` as their normal user, then later runs it as root** (or vice versa).
  - Likelihood: medium during testing or when a user changes their mind.
  - Impact: two parallel installs exist (`~/.local/share/amorist` + `/opt/amorist`, two `amorist` symlinks in different PATH directories). Whichever PATH entry comes first wins.
  - Mitigation: install summary always prints the scope and the exact destination. Both uninstallers print their scope on the summary too. Document the symmetry in `scripts/README.md`.
  - Exit clause: not a code problem — operator intent issue. Surface it via clear summaries; do not auto-cross-scope.

- **`xdg-open` truly missing on a headless box.**
  - Likelihood: low for the desktop-editor use case, but possible (server SSH session).
  - Impact: launcher still works; user copies the printed URL.
  - Mitigation: already handled (`bin/amorist:258-267`).
  - Exit clause: n/a.

- **Existing system install left behind by older versions of the installer.**
  - Likelihood: medium for current users upgrading.
  - Impact: a stale `/opt/amorist` and `/usr/local/bin/amorist` may coexist with a new user install.
  - Mitigation: in user scope only, **before** printing the install summary, the script detects `/usr/local/bin/amorist` → `/opt/amorist/bin/amorist` and prints a courtesy three-line hint. The exact code lives in the "Stale system-install hint (user scope only)" subsection of "Detailed Changes". The hint must be visible before the operator answers `Continue?`, so it cannot be merged into the summary heredoc itself. This is a courtesy heads-up, not a required cleanup step.
  - Exit clause: install continues regardless.

## Failure Modes and Degradation

- **`python3` missing**: installer exits with code `1` before touching the filesystem; prints `amorist requires python3 on PATH. Install it with your package manager and re-run.` No partial state.
- **`ensure_writable_parent` aborts**: installer exits with code `1` after printing the unwritable ancestor path. No filesystem mutation. Operator must fix permissions and re-run.
- **`guard_bin_path` aborts**: installer exits with code `1` because `$BIN_PATH` exists as a non-managed file or a symlink to an unmanaged target. No filesystem mutation. Operator must remove `$BIN_PATH` manually and re-run.
- **`guard_destructive_path` aborts**: installer exits with code `1`. This should never trigger in well-formed environments; if it does, the operator's `$HOME` or `$XDG_DATA_HOME` is set to a path the installer refuses to operate on. No filesystem mutation.
- **`rm -rf "$STAGE_DIR"` paranoia step fails** (e.g. a leftover stage dir owned by a different user from a prior root run): `set -Eeuo pipefail` aborts. The live `$INSTALL_DIR` is untouched. Operator must manually remove the conflicting stage directory and re-run.
- **`cp -a` into `$STAGE_DIR` fails** (disk full, source read error, interrupted): `set -Eeuo pipefail` aborts the script. The live `$INSTALL_DIR` is **unchanged** (the swap has not happened yet). The staged tree at `$INSTALL_DIR.amorist-stage.$$` is left for the operator to inspect/remove; the installer exits non-zero with the failing command's stderr visible.
- **`mv "$INSTALL_DIR" "$OLD_DIR"` fails** (e.g. another process holds the directory open in a way that blocks rename, or filesystem quota issue): live install untouched, stage tree left behind, installer aborts. Same recovery: remove the stage tree and re-run.
- **`mv "$STAGE_DIR" "$INSTALL_DIR"` fails after the old directory was renamed away**: this is the only window where the live install is briefly absent. If this `mv` fails, `$OLD_DIR` still exists alongside `$STAGE_DIR` and contains the previous install. Recovery: `mv "$OLD_DIR" "$INSTALL_DIR"` to restore the previous version. The plan accepts this rare failure mode rather than wrapping it in further atomic primitives (e.g. `renameat2` is not available from shell).
- **`install -d "$BIN_DIR"` fails** (e.g. `$HOME/.local` is a read-only symlink): app files have been swapped in successfully but the command is not linked. Installer exits non-zero. Operator can rerun after fixing the permission issue; the existing `$INSTALL_DIR` is the new copy, so a re-run will simply update the link.
- **`ln -sfn` fails for `$BIN_PATH`**: same as above — app files in place, command not linked. Installer exits non-zero. No automatic rollback.
- **PATH lookup after install fails**: as detailed above — non-fatal, hint printed.
- **`amorist` resolves to an older install on PATH**: the final visibility check warns explicitly and prints the version of the newly-installed binary via `"$BIN_PATH" --version`. Installer exits `0`; the operator decides how to disambiguate PATH.
- **Uninstall with nothing to remove** (e.g. running user-mode uninstall after no user install ever happened): the script reports `BIN_STATUS=not present`, the `rm -rf "$INSTALL_DIR"` is a no-op on a non-existent path (and is gated by `guard_destructive_path "$INSTALL_DIR"` first, which still passes because the path is well-formed even if missing), and the script exits `0`. This matches current behavior for the equivalent system path.

Concrete thresholds:
- No timeouts (everything is local filesystem work).
- Confirmation prompt blocks until the user answers; non-interactive runs can be supported later if needed (out of scope here — see Open Questions).

## Open Questions

- **Should the installer support a non-interactive `--yes` / env-driven mode?** Today's installer is always interactive (`read -r -p` at `scripts/install.sh:72`). This plan keeps the same interactive prompt for symmetry. Non-interactive mode is **out of scope** for this change. *Unverified*: whether downstream users / CI rely on automated installs. If yes, add `AMORIST_INSTALL_YES=1` in a follow-up.
- **Should the installer print a hint when an older system-wide install is detected during a user install?** Listed as a courtesy in "Edge Cases" above. *Open*: confirm whether this should be a hint or a hard "please uninstall first" stop. Default in this plan: hint only.
- **Naming for the user-scope install root.** Plan uses `$XDG_DATA_HOME/amorist` (`$HOME/.local/share/amorist` by default). Alternative is `$HOME/.amorist`. XDG matches the look of `pipx`/`cargo` user installs and is the convention this plan picks. *Open*: confirm the user has no preference for a dotted home directory instead.
- **macOS / BSD support.** The current installer is Linux-only (`scripts/install.sh:10-34`). This rewrite is much closer to portable POSIX but still uses GNU-flavored `install -d` (also fine on BSD `install`). *Unverified*: no claim is made that macOS or BSD are now supported — only that this rewrite no longer actively rejects them. Adding explicit cross-OS support is out of scope.
- **What does "system install" mean when `EUID == 0` but `$HOME` points at `/root` and the operator actually wanted a per-user install for `/root`?** Edge case for direct root shells. *Open*: acceptable to keep "root → system" without an override flag? Default in this plan: yes.

## Task Breakdown

- [ ] Rewrite `scripts/install.sh` per the "Detailed Changes" section. Includes:
   - Drop apt/distro detection (everything between `scripts/install.sh:10-41`) and every `sudo` call.
   - Pick scope from EUID: root → `/opt/amorist` + `/usr/local/bin/amorist`; non-root → `${XDG_DATA_HOME:-$HOME/.local/share}/amorist` + `$HOME/.local/bin/amorist`.
   - Define the three helpers `ensure_writable_parent`, `guard_destructive_path`, and `guard_bin_path` inline using the exact target bodies shown in the "Helpers used by the snippet" code block, and call them at the points shown in the install snippet.
   - Keep the interactive summary + `Continue? [y/N]` confirmation. No directory is created before the user confirms.
   - Install via stage-and-swap: copy into `$INSTALL_DIR.amorist-stage.$$`, then `mv` previous to `$INSTALL_DIR.amorist-old.$$`, `mv` stage into `$INSTALL_DIR`, then `rm -rf` the old directory.
   - In user scope only: if `/usr/local/bin/amorist` is a symlink to `/opt/amorist/bin/amorist`, print the stale-system-install hint shown in the "Stale system-install hint" subsection of "Detailed Changes" **before** the summary block (so the operator sees it before answering `Continue?`).
   - Final visibility check that compares `command -v amorist` with `$BIN_PATH` and prints the version via `"$BIN_PATH" --version` when the resolution mismatches.
   - Pass `bash -n scripts/install.sh`.
- [ ] Rewrite `scripts/uninstall.sh` mirroring the scope rule: same EUID branch, same destinations as install, copy `guard_destructive_path` inline (same body as the installer) and call it before `rm -rf "$INSTALL_DIR"`, keep the symlink-safety logic shown in the uninstall snippet (which mirrors `scripts/uninstall.sh:14-24, 51-72`), drop the "It will not remove system packages such as python3 or xdg-utils" sentence and the `sudo` requirement check. Keep `readlink -f` (Linux-targeted, per Portability note). Pass `bash -n scripts/uninstall.sh`.
- [ ] Confirm `bin/amorist` needs no edits (re-read `bin/amorist:258-267` and `bin/amorist:65-75`). Document in the PR description that the xdg-open fallback was already in place.
- [ ] Update `README.md` install section by replacing the existing `## Install` heading through the closing uninstall paragraph (currently `README.md:45-67`) with the target markdown block shown verbatim in the "`### README.md` — update install section" subsection of "Detailed Changes". Do not paraphrase or shorten — paste the block as-is. Keep the empty line that precedes `## Development` (currently `README.md:69`).
- [ ] Update `scripts/README.md` by replacing the file heading through the end of `## Uninstaller` (currently `scripts/README.md:1-21`) with the target markdown block shown verbatim in the "`### scripts/README.md` — update installer/uninstaller sections" subsection of "Detailed Changes". Leave the `## Screenshots` section (currently `scripts/README.md:23-39`) untouched.
- [ ] Verify end-to-end on a **real PTY** (the installer is interactive — `read -r -p` will not behave the same under a piped stdin, and the global rule in `~/.claude/CLAUDE.md` requires PTY-based verification before declaring success). Concretely, run each of the following under `script -qec '<cmd>' /dev/null` so a real PTY is allocated, and confirm the script blocks on the `Continue? [y/N]` prompt, accepts `y`, and completes:
   - User scope, fresh state (remove `~/.local/share/amorist` and `~/.local/bin/amorist` first): `script -qec './scripts/install.sh' /dev/null` then `script -qec './scripts/uninstall.sh' /dev/null`. Expect `~/.local/share/amorist` + `~/.local/bin/amorist`.
   - User scope with `~/.local/bin` missing (back it up first): same commands; expect the installer to create it after confirmation and to print the PATH hint if `~/.local/bin` is not yet on `PATH`.
   - User scope with a stale system install present (touch `/opt/amorist/.marker` first if root is available locally): expect the "previous system-wide install present" hint.
   - User scope with `$BIN_PATH` pre-occupied by a non-symlink (`touch ~/.local/bin/amorist`): expect `guard_bin_path` to abort with the clear message.
   - Root scope: `sudo script -qec './scripts/install.sh' /dev/null` then `sudo script -qec './scripts/uninstall.sh' /dev/null`. Expect `/opt/amorist` + `/usr/local/bin/amorist`.
   - Capture stdout/stderr from each run and attach to the PR description.
- [ ] Bump `VERSION` per global semver policy from `0.1.0` → `0.2.0` (behavior change to the installer; users running on an old install will not get equivalent behavior — MINOR is the right level).
- [ ] **Create** `CHANGELOG.md` at repo root (the file does not exist today — verified via `ls /home/alessandro/elmisi/amorist/`). Use the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format with these initial sections:
  ```markdown
  # Changelog

  All notable changes to amorist are documented in this file. The format is based on
  [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
  to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

  ## [0.2.0] - 2026-05-18

  ### Changed
  - Installer no longer uses `apt-get` or `sudo`. Scope is chosen from `EUID`:
    root installs system-wide to `/opt/amorist` + `/usr/local/bin/amorist`;
    non-root installs user-locally to `$XDG_DATA_HOME/amorist` (default
    `~/.local/share/amorist`) + `~/.local/bin/amorist`.
  - Uninstaller mirrors the same scope rule.

  ### Removed
  - `apt-get` invocation and Ubuntu/Debian-only `/etc/os-release` detection from
    `scripts/install.sh`.
  - Automatic installation of `python3` and `xdg-utils`. `python3` is now a
    hard prerequisite the installer checks for; `xdg-open` remains optional
    (the launcher already prints the URL when `xdg-open` is absent, see
    `bin/amorist:258-267`).
```

The `[0.1.0]` line is intentionally omitted from this first changelog (no   retro entry for the prior version — the changelog starts at 0.2.0).