#!/usr/bin/env bash
#
# git push wrapper — auto version bump on push.
#
# Intercepts `git push` (via a shell function installed in the user's rc by
# scripts/hooks/install-push-bump.sh) and:
#   1. increments the patch version in package.json (0.0.1 -> 0.0.2 -> ..., no max)
#   2. commits it ("chore: bump version to X", only package.json, hooks skipped)
#   3. runs the REAL git push — so the version bump rides in the same push
#
# Why not a pre-push hook or a git alias?
#   - A commit created inside a pre-push hook is NOT included in that push
#     (git captures ref oids before invoking the hook) — verified empirically.
#   - git ignores aliases that shadow existing commands (e.g. `push`) — also
#     verified empirically (git 2.55).
#
# Runs only from this repo: it is discovered via $root/scripts/hooks/... and
# cd's to its own repo root, so it never touches other repositories.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# --- Pass-through cases: nothing to version ---

# Branch deletions, dry runs, detached HEAD
for arg in "$@"; do
  case "$arg" in
    --delete|-d|--dry-run|-n) exec git push "$@" ;;
  esac
done
if ! git symbolic-ref -q HEAD >/dev/null 2>&1; then
  exec git push "$@"
fi

# Fresh repo with no commits yet
if ! git rev-parse -q --verify HEAD >/dev/null 2>&1; then
  exec git push "$@"
fi

# --- Resolve bun (same convention as start.sh) ---
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
BUN="${BUN:-${BUN_PATH:-}}"
if [ -z "$BUN" ] || ! command -v "$BUN" >/dev/null 2>&1; then
  for candidate in "$HOME/.bun/bin/bun" /usr/local/bin/bun /opt/homebrew/bin/bun; do
    if [ -x "$candidate" ]; then
      BUN="$candidate"
      break
    fi
  done
fi
if [ -z "$BUN" ] || ! command -v "$BUN" >/dev/null 2>&1; then
  echo "version-bump: ERROR bun not found. Install it or set BUN_PATH in .env" >&2
  exit 1
fi

PKG="package.json"
INCREMENT_SCRIPT="scripts/hooks/increment-version.ts"
if [ ! -f "$PKG" ] || [ ! -f "$INCREMENT_SCRIPT" ]; then
  echo "version-bump: ERROR $PKG or $INCREMENT_SCRIPT missing" >&2
  exit 1
fi

# --- Bump version, commit only package.json (leave user's staged files alone) ---
old_version="$(sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$PKG" | head -1)"
new_version="$("$BUN" run "$INCREMENT_SCRIPT" "$PKG")"
git add "$PKG"
git commit -q -o "$PKG" --no-verify -m "chore: bump version to $new_version"
echo "version-bump: ${old_version:-<none>} -> $new_version"

# --- Real push: the bump commit is included in this push ---
exec git push "$@"
