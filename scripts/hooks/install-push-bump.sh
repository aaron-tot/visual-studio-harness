#!/usr/bin/env bash
#
# Installs the `git push` interception function into the user's shell rc
# (~/.bashrc or ~/.zshrc). Idempotent: re-running does nothing.
#
# The function only intercepts `git push` in repositories that contain
# scripts/hooks/git-push-wrapper.sh; every other git command and every other
# repo behaves exactly as before.
#
# After installing, restart the shell or run: source "$RC"
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

case "${SHELL:-/bin/bash}" in
  *zsh) RC="$HOME/.zshrc" ;;
  *)    RC="$HOME/.bashrc" ;;
esac

MARKER_START="# >>> VSH auto version bump on push >>>"
MARKER_END="# <<< VSH auto version bump on push <<<"

if grep -qF "$MARKER_START" "$RC" 2>/dev/null; then
  echo "Already installed in $RC"
  exit 0
fi

if [ ! -x "$REPO_ROOT/scripts/hooks/git-push-wrapper.sh" ]; then
  echo "ERROR: $REPO_ROOT/scripts/hooks/git-push-wrapper.sh not executable" >&2
  exit 1
fi

cat >> "$RC" <<EOF

$MARKER_START
git() {
  if [ "\$1" = "push" ]; then
    shift
    local root
    root="\$(command git rev-parse --show-toplevel 2>/dev/null)"
    if [ -n "\$root" ] && [ -x "\$root/scripts/hooks/git-push-wrapper.sh" ]; then
      "\$root/scripts/hooks/git-push-wrapper.sh" "\$@"
    else
      command git push "\$@"
    fi
  else
    command git "\$@"
  fi
}
$MARKER_END
EOF

echo "Installed into $RC"
echo "Restart your shell or run: source $RC"
