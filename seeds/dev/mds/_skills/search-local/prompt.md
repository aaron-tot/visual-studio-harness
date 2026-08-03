# searchLocal — local filesystem search

The `searchLocal` tool finds things in the local workspace via an `action`.

## Actions

- `grep` — Regex search file **contents** via ripgrep (respects .gitignore). Params: `pattern` (regex), optional `path`, `glob` (file filter, e.g. "*.ts"), `case_insensitive`, `head_limit`.
- `glob` — Find files by **name/glob pattern** (fd, with rg fallback). Params: `pattern` (glob, e.g. "**/*.ts"), optional `path`, `head_limit`.

## Guidance

- Use `grep` when you know part of the content you're looking for; use `glob` when you know the file name/pattern.
- Prefer grep before reading many files to locate the relevant region.
- Both respect `.gitignore`. Results are truncated by `head_limit`.
