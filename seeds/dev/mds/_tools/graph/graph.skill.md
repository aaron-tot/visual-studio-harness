# graph — workspace symbol & file index

The `graph` tool exposes workspace-wide symbol and file information via an `action`.

## Actions

- `search` — Search workspace symbols by name (uses the **indexed graph**).
- `files` — List indexed source files (optionally by subdirectory).
- `info` — Get a file's imports, exports, and symbols.
- `imports` — List import statements for a file.
- `exports` — List export statements for a file.
- `manifest` — Get the workspace tree as structured text.
- `status` — Check the graph status (files/folders/symbols, last indexed).
- `symbol_find` — Find symbol definitions by name substring (**regex scan**, no index needed).
- `symbol_read` — Read the source region for a named symbol (with optional context lines).

## Two backends

- **Indexed graph** (`search`, `files`, `info`, `imports`, `exports`, `manifest`, `status`): rich but may be
  unavailable while the index is disabled or still initializing.
- **Regex scanner** (`symbol_find`, `symbol_read`): always works even when the index is down.

When you need a symbol's location, prefer `symbol_find`/`symbol_read` for resilience; use `search` when you
want the richer indexed result (signatures, exported/async flags).
