#!/usr/bin/env bash
# Hide host AV1 plugins only inside this test process's mount namespace.
set -euo pipefail
command -v bwrap >/dev/null || { echo 'bwrap is required for isolated AV1 QA' >&2; exit 2; }
: "${AMORIST_CODEC_QA_BINARY:?Specify the native application to test}"
[[ "$AMORIST_CODEC_QA_BINARY" = /* && -x "$AMORIST_CODEC_QA_BINARY" ]] || {
  echo 'AMORIST_CODEC_QA_BINARY must be an absolute executable path' >&2; exit 2;
}
mount_args=(--die-with-parent --unshare-pid --ro-bind / / --proc /proc --dev-bind /dev /dev --bind /tmp /tmp)
found=false
for directory in "/usr/lib/$(uname -m)-linux-gnu/libheif/plugins" /usr/lib64/libheif/plugins /usr/lib/libheif/plugins; do
  if [[ -d "$directory" ]]; then
    mount_args+=(--tmpfs "$directory")
    found=true
  fi
done
$found || { echo 'No host libheif plugin directory found; absence cannot be simulated' >&2; exit 2; }
exec bwrap "${mount_args[@]}" -- "$AMORIST_CODEC_QA_BINARY" "$@"
