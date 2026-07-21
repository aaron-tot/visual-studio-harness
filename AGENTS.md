IMPORTANT: This is a public repo. Therefore put nothing personal goes in this dir. no reaserch docs, audits, specs, plans, keys, passwords, personal dir etc. Instead put them one fodler up in personalFiles/. aka ../personalFiles/

# Visual Studio Harness — AI Agent Coding Harness

Monorepo with Bun workspaces. Runtime data lives in the sibling `data/` directory:

```
Visual Studio Harness/
  repoSorce/           # code only (backend, frontend, shared, scripts)
    start.sh           # dev entry point (sources .env for BUN_PATH)
  data/
    dev/               # dev runtime: config.json, sessions/, logs/
    prod/              # prod runtime: config.json, sessions/, logs/
    package/           # compiled binaries: VSH_vX.X.X-linux-x64, etc.
```

Commands (from repo root):
- `bun run dev` — run from source with hot reload (ports 3001 + 5173)
- `bun run build` — build single-file prod binary
- `bun run prod` — build + run the prod binary (port 3002)

Key rules:
- Never write runtime data into the repo dir
- No frontend storage; backend is source of truth
- Config is live-editable (fs.watch)
- MODE env var: dev or prod
- Prod is one executable with embedded frontend; data dir is next to the binary

Tools (V1):
- Native tools via AI SDK multi-step (plan: docs/superpowers/plans/2026-07-11-native-tools-implementation.md)
- Builtins: read, write, edit, apply_patch, grep, glob, bash, todowrite, todoread, skill, find_symbol, read_symbol, task
- Host deps (Fedora): `sudo dnf install ripgrep fd-find` (glob falls back to rg --files if fd missing)
- Env: `visual-studio-harness_WORKSPACE`, `visual-studio-harness_TOOLS_ENABLED=0`, `visual-studio-harness_TOOLS_TRUSTED=1` (auto-allow write/edit/bash/task)
- Skills dirs: `.visual-studio-harness/skills/`, `source/skills/`, `data/{mode}/skills/`

