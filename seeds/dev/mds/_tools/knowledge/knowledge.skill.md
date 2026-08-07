# knowledge — scopes and documents

`knowledge` manages documents in the Knowledge Base. Use the `search`, `open`, `ingest`, `doc_create`, `doc_edit`, `doc_delete` actions.

## Scope

`global`, `project`, or `session` (default `global`).

## Search

- `query`: natural language or exact term.
- `mode`: `general` | `code` | `research` | `documentation` — adjusts chunk count, ranking weights, metadata priority.
- `limit`: max results (defaults to the mode's chunk count).
- `filters`: optional `{ extension, createdBy }`.

## Open

`documentId` accepts either a **UUID** or a **filename.ext**. `maxChars` clamps returned content.

## Doc CRUD

- `doc_create`: writes a file (prefixed `agentCreate_`), auto-ingests, gets a scope. Params: `filename` (.md/.txt), `content`, `tags`, `scope`.
- `doc_edit`: replaces content and re-ingests. Params: `documentId` (UUID), `content`, `scope`.
- `doc_delete`: removes a document and its chunks/embeddings. Params: `documentId`, `scope`, `confirmed` (must be `true` for user-created docs).

## Ingest

`ingest` rescans sources for new/modified/deleted files.
