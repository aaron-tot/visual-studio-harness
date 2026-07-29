#!/usr/bin/env bash
# Pre-commit hook: scan files for hardcoded API keys, tokens, passwords
# Part of .pre-commit-config.yaml local hook: no-hardcoded-api-keys
# Reads files from args (pre-commit --all-files) or falls back to git diff --cached
set -uo pipefail

RED='\033[0;31m'
NC='\033[0m'
status=0

patterns=(
  # OpenAI
  '(sk-proj-[A-Za-z0-9_-]+)'          # OpenAI project API keys
  '(sk-[A-Za-z0-9]{20,})'             # OpenAI legacy API keys
  '(sk-ant-api[0-9]+-[A-Za-z0-9_-]+)' # Anthropic API keys
  '(sess-[A-Za-z0-9_-]{12,})'         # Anthropic session keys (min 12 chars to avoid sess-1 etc)

  # Google / Gemini
  '(AIza[0-9A-Za-z_-]{35})'           # Google API keys

  # GitHub tokens
  '(ghp_[0-9A-Za-z]{36,})'            # GitHub personal access tokens
  '(gho_[0-9A-Za-z]{36,})'            # GitHub OAuth access tokens
  '(ghu_[0-9A-Za-z]{36,})'            # GitHub user-to-server tokens
  '(ghs_[0-9A-Za-z]{36,})'            # GitHub server-to-server tokens
  '(ghr_[0-9A-Za-z]{36,})'            # GitHub refresh tokens
  '(github_pat_[0-9A-Za-z]{50,})'     # GitHub fine-grained PATs

  # GitLab tokens
  '(glpat-[0-9A-Za-z_-]{20,})'        # GitLab personal access tokens

  # Discord tokens
  '([MN][A-Za-z0-9_-]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27})'

  # Slack tokens
  '(xox[baprs]-[0-9A-Za-z-]{10,})'    # Slack tokens

  # Generic AWS
  '(AKIA[0-9A-Z]{16})'                # AWS access key ID

  # Stripe
  '(sk_live_[0-9A-Za-z]{20,})'        # Stripe live secret keys
  '(rk_live_[0-9A-Za-z]{20,})'        # Stripe live restricted keys

  # Twilio
  '(SK[0-9A-Za-z]{32})'               # Twilio auth tokens
  '(AC[0-9A-Za-z]{32})'               # Twilio account SIDs

  # Heroku
  '(h[ru][0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})'

  # JWT tokens
  '(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{10,})'

  # RSA / SSH / DSA private keys (inline)
  '(-{5}BEGIN (RSA|OPENSSH|DSA|EC) PRIVATE KEY-{5})'

  # Generic password/secret/token assignments (value >= 8 chars)
  '(password\s*[:=]\s*["'"'"']?[A-Za-z0-9!@#$%^&*()_+\-=\[\]{}|;:,.<>?]{8,})'
  '(secret\s*[:=]\s*["'"'"']?[A-Za-z0-9!@#$%^&*()_+\-=\[\]{}|;:,.<>?]{8,})'
  '(token\s*[:=]\s*["'"'"']?[A-Za-z0-9!@#$%^&*()_+\-=\[\]{}|;:,.<>?]{12,})'
)

# Accept files from args (pre-commit) or git diff (standalone)
if [ $# -gt 0 ]; then
  files=("$@")
else
  mapfile -t files < <(git diff --cached --name-only)
fi

# Skip binary/image/lock files to avoid base64 false positives
skip_extensions=('\.png' '\.jpg' '\.jpeg' '\.gif' '\.ico' '\.svg' '\.woff' '\.woff2' '\.ttf' '\.eot' '\.pdf' '\.lock')
skip_match=""
for ext in "${skip_extensions[@]}"; do
  skip_match="${skip_match:+${skip_match}|}${ext}"
done

for file in "${files[@]}"; do
  [ -f "$file" ] || continue

  # Skip binary/image files
  if echo "$file" | grep -qE "($skip_match)$"; then
    continue
  fi

  for pattern in "${patterns[@]}"; do
    matches=$(grep -Pn "$pattern" "$file" 2>/dev/null) || continue
    status=1
    echo -e "${RED}[SECRET]${NC} $file"
    echo "$matches"
  done
done

if [ $status -ne 0 ]; then
  echo -e "${RED}*** Hardcoded secrets detected. Remove them and try again. ***${NC}"
fi

exit $status
