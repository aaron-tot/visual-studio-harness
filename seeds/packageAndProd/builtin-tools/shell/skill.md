# shell — shared interactive terminals

The `shell` tool manages the session's live terminals. You can create **multiple shells** and act on whichever one you want, so use a separate shell per task or concern rather than reusing a single terminal for everything. Each shell is a real PTY (a `/bin/bash` process) that is **shared with the user and rendered live in their GUI** (a VSCode-style integrated terminal). Both the agent and the user can type into the **same** terminal, so use these for anything the user should see happening (edits, commands, long-running builds). All actions are scoped to the current conversation's session; the agent can only ever touch shells in its own session, never another session's terminals.

## ALWAYS pass the specific shell `id`

Every per-shell action (`sendText`, `sendCommand`, `readOutput`, `resize`, `close`) targets the shell whose `id` you pass. Never act on a shell without knowing its id.

- First call `list` (or `listOutput`) to get each shell's `id`, `name`, and status.
- Then pass the exact `id` of the shell you want to act on.
- Pick the right shell from `list` — not just the first one. If the user created shells or you created several, each is a distinct terminal; act on the specific one you intend.

## Creating multiple shells

- Create as many shells as you need — one per task, tool, or concern (e.g. one shell running a dev server, another for git, another for a build).
- Each `create` returns a new `id`. Reuse that `id` for subsequent actions on that shell.
- `list` shows every shell you (or the user) created for the session, so you can track and target each one.

## Actions

- `create` — Start a new shell for the session. Optional `name` (display label) and `cwd` (working directory; defaults to the backend cwd). Returns the new shell `id`. `cwd` must be an existing directory; if it doesn't exist the action fails loudly (the shell is never registered). Use `bash`/`read` or the workspace path if you're unsure a directory exists.
- `list` — List this session's shells (id, name, status, cwd, createdAt).
- `listOutput` — Return the current output buffer for every shell in the session.
- `sendText` — Write raw text to a shell (`id`, `text`). No newline is appended.
- `sendCommand` — Write a command line to a shell (`id`, `command`); a newline is appended automatically.
- `readOutput` — Read a single shell's output buffer (`id`).
- `resize` — Resize the PTY (`id`, `cols`, `rows`).
- `close` — Close one shell (`id`).
- `closeAll` — Close every shell in the session.

`id` is **required** for `sendText`, `sendCommand`, `readOutput`, `resize`, and `close` — always obtain it from `list`/`listOutput` first.

## Targeted actions example

1. `create` a shell → note the returned `id` (e.g. `shell-...`).
2. `sendCommand { id, command: "npm run build" }` on that shell.
3. `sendCommand { id, command: "git status" }` on a different shell if you made one.
4. `readOutput { id, lines: 25 }` to see just the tail of the target shell.
5. `close { id }` when done with that shell.

Every action operates on the shell you identified by id — confirm the id before acting.

## Reading output — read only what you need

By default `readOutput` / `listOutput` return the **entire** rolling buffer (capped at 2 MB per shell). For long transcripts that is a lot of tokens, so both actions accept optional partial-read filters:

- `limit` — Max characters to return. Without `tail`, this returns the LAST `limit` chars (the tail).
- `tail` — When `limit` is set: `true` (default) keeps the last `limit` chars; `false` keeps the first `limit` chars.
- `lines` — Return only the last N lines (newline-delimited). Overrides the char-based `limit`/`tail` slicing when both are present.

Guidance:
- Want the newest output after sending a command? Use `readOutput` with a `limit` (e.g. `2000`) to grab just the tail.
- Need the entire transcript? Omit all three filters.
- Checking whether a long build finished? `readOutput` with a small `lines` value (e.g. `25`) to see the most recent lines.

## Session scoping

Every shell is bound to the session that created it. `list` and `listOutput` only return this session's shells, and looking up a shell id that belongs to another session fails with `Shell <id> not found in this session`. `closeAll` only closes this session's shells.
