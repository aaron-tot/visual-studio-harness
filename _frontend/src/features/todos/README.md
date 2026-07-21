# Session todos (`features/todos`)

Modular todo UI aligned with agent tools (`todowrite` / `todoread`).

**Spec:** `docs/superpowers/specs/2026-07-12-session-todo-ui.md`

## Layout

| Path | Role |
|------|------|
| `types.ts` | `TodoItem` = disk/agent schema |
| `adapters/disk.ts` | parse/serialize `todos.json` (+ legacy fields) |
| `model/` | pure filter + status helpers |
| `store/todoStore.ts` | Zustand keyed by `sessionId` |
| `api/todosApi.ts` | REST stubs for later |
| `components/` | panel, list, item, input, filter |

## Use

```tsx
import { SessionTodoPanel, useTodoStore, fetchSessionTodos } from "../features/todos";

// On session load:
useTodoStore.getState().setActiveSession(id);
const items = await fetchSessionTodos(id);
useTodoStore.getState().hydrate(id, items);

// In active chat chrome:
<SessionTodoPanel sessionId={id} />
```

## Upgrade path

1. Add `GET/PUT /api/sessions/:id/todos` (same file as tools).
2. Hydrate in `loadSession`.
3. On `tool_end` for `todowrite`, re-fetch and hydrate.
4. Optional: debounced save when `dirty`.

## Do not

- Invent a second `{ text, completed }` model for storage.
- Put business logic only in components — use `model/` and `store/`.
