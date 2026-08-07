# todo — session task list

The `todo` tool manages the session's todo list via an `action`.

## Actions

- `write` — Replace the session todo list (send the full list each call).
- `read` — Read the current session todo list.

## Item model

Each todo item:
```json
{
  "id": "string",
  "content": "string",
  "status": "pending | in_progress | completed | cancelled",
  "priority": "high | medium | low"   // optional
}
```

## Guidance

- `write` replaces the ENTIRE list — always send the complete updated list, not just changes.
- Keep exactly one item `in_progress` at a time; update immediately when a step completes.
- Statuses: `pending`, `in_progress`, `completed`, `cancelled`.
