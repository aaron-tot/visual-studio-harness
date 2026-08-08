#!/usr/bin/env bash
# Pre-commit hook to check for .md and .txt files in root directory (one level up from repoSource)
# Allowed files: AGENTS.md, STYLE.md

set -e

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ALLOWED_FILES=("AGENTS.md" "STYLE.md")

# Get list of .md and .txt files in root (not in subdirectories)
ROOT_FILES=$(find "$ROOT_DIR" -maxdepth 1 -type f \( -name "*.md" -o -name "*.txt" \) | sed 's|.*/||' | sort)

if [ -z "$ROOT_FILES" ]; then
    exit 0
fi

# Check each file against allow list
UNAUTHORIZED_FILES=()
while IFS= read -r file; do
    if [ -n "$file" ]; then
        ALLOWED=false
        for allowed in "${ALLOWED_FILES[@]}"; do
            if [ "$file" = "$allowed" ]; then
                ALLOWED=true
                break
            fi
        done
        if [ "$ALLOWED" = false ]; then
            UNAUTHORIZED_FILES+=("$file")
        fi
    fi
done <<< "$ROOT_FILES"

if [ ${#UNAUTHORIZED_FILES[@]} -eq 0 ]; then
    exit 0
fi

echo ""
echo "⚠️  Unauthorized .md/.txt files found in root directory ($ROOT_DIR):"
for file in "${UNAUTHORIZED_FILES[@]}"; do
    echo "   - $file"
done
echo ""
echo "Allowed files: ${ALLOWED_FILES[*]}"
echo ""
echo "Move unauthorized files to personalFiles/ or add them to the allow list."
echo ""

# Ask user if they want to add these files to the allow list (for this commit only)
# Note: pre-commit runs in non-interactive mode by default, so we'll just fail
# User can run with --verbose or manually allow
exit 1
