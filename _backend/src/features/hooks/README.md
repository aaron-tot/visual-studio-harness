# Hooks (`features/hooks`)

Typed event bus for Momiji chat / agent lifecycle. **Server-side only.**

Plan: `source/docs/superpowers/plans/2026-07-12-hooks-implementation.md`

## Layout

| Path | Role |
|------|------|
| `bus.ts` | register / emit / emitIntercept |
| `catalog.ts` | active vs reserved names |
| `types.ts` / `context.ts` | shared types |
| `events/*` | payload contracts |
| `handlers/*` | product behavior (logging, future audit, …) |
| `system.ts` | boot: `createHooksSystem` + app singleton |

Call sites (`agent/turn`, `llm/client`, `tools/registry`, `ws/chat`) **emit only**. Logic goes in `handlers/`.

## Add a handler

```ts
import type { HookBus } from "../bus";

export function registerMyHandler(bus: HookBus): void {
  bus.on(
    "tool.after",
    async (ctx, payload) => {
      // ...
    },
    { id: "my.feature.tool.after", priority: 100 }
  );
}
```

Wire it in `handlers/index.ts` via `registerBuiltInHandlers`.

- **priority:** lower runs first (default `100`; built-ins use `0–50`).
- **id:** unique per event; same id replaces previous registration.

## Add a new event

1. Payload type in `events/<area>.ts`
2. Entry on `HookPayloadMap` in `events/index.ts`
3. Catalog row in `catalog.ts` (`active` or `reserved`)
4. One `bus.emit` / `bus.emitIntercept` at the real call site
5. Optional handler under `handlers/`

## Observe vs intercept

- **observe** (`emit`): fire-and-forget; return values ignored; throws isolated.
- **intercept** (`emitIntercept`): may `{ cancel: true, cancelReason }` or `{ patch }`. Fail-open on throw.

V1 intercept: `tool.before` only (after permission gate, before execute).

## Reserved hooks

Names frozen but **not emitted** until the feature exists:

- `message.edit`
- `history.truncated`
- `security.prompt_injection`
- `export.before`
- `limits.rate_approach`

## Boot

```ts
import { createHooksSystem, setHooksSystem } from "./features/hooks";

setHooksSystem(createHooksSystem());
```

Phase A: bus exists, no emit sites yet.  
Phase B: call sites use `getHooksSystem()?.bus` or `requireHooks().bus`.
