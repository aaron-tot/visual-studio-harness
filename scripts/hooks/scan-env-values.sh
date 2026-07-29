#!/usr/bin/env bash
# Pre-commit hook: ensure env-var-sensitive values aren't hardcoded as strings
# Scans for "should-be-env-var" names appearing without process.env wrapper
# Part of .pre-commit-config.yaml local hook: no-env-value-hardcode
# Reads files from args (pre-commit --all-files) or falls back to git diff --cached
set -uo pipefail

RED='\033[0;31m'
NC='\033[0m'
status=0

env_vars=(
  "EXA_API_KEY"
  "PARALLEL_API_KEY"
  "ANTHROPIC_API_KEY"
  "OPENAI_API_KEY"
  "GITHUB_PERSONAL_ACCESS_TOKEN"
  "HF_TOKEN"
  "HUGGINGFACE_TOKEN"
)

# Accept files from args (pre-commit) or git diff (standalone)
if [ $# -gt 0 ]; then
  files=("$@")
else
  mapfile -t files < <(git diff --cached --name-only)
fi

for file in "${files[@]}"; do
  [ -f "$file" ] || continue

  for var in "${env_vars[@]}"; do
    # Skip lines that reference process.env, \${, env:, or are comments
    matches=$(grep -Pn "(?i)$var" "$file" 2>/dev/null \
      | grep -vP '(process\.env|\$\{|env:)' \
      | grep -vP '^\s*(//|#|\*|<!--|/\*|\*)' \
      | grep -vP '(keys?|token|secrets?|options?|config|set(ting)?|variable|env(ironment)?)\s*:' \
      || true)

    if [ -n "$matches" ]; then
      status=1
      echo -e "${RED}[ENV-VALUE]${NC} $file references '$var' without process.env wrapper"
      echo "$matches"
    fi
  done
done

if [ $status -ne 0 ]; then
  echo -e "${RED}*** Hardcoded env variable values detected. Use process.env.VAR_NAME instead. ***${NC}"
fi

exit $status
