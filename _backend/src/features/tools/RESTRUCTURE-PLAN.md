# Tools & Permissions System — Spec + Plan

> **Status:** Spec + Plan — ready for implementation
> **Created:** 2026-07-21
> **Last verified:** 2026-07-21 — every line reference checked against source
> **Scope:** Bug fixes + structural improvements to tools and permissions subsystems
> **Policy:** No backward compatibility. Only new interfaces. Old names are removed.

---

## Executive Summary

Four changes, ordered by priority:

| # | Change | Type | Risk | Effort |
|---|--------|------|------|--------|
| 1 | **Fix deny-leak:** denied tools must not appear in ToolSet sent to LLM. Replace `toAiSdkTools` with `toFilteredAiSdkTools` as the only method. | 🔴 Bug fix | Low | Low |
| 2 | **Unify defaults:** use `ToolDef.permissionDefault` as single source of truth. Remove `DEFAULT_GLOBAL_TOOLS` entirely. Fix 6-tool drift. | 🔴 Bug fix | Low | Low |
| 3 | **Split ToolContext:** rename to `BaseToolContext` (common fields only). New `ExtendedToolContext` for task. **No alias.** All references updated. | 🟢 Refactor | None | Medium |
| 4 | **Extract ToolExecutor:** standalone class for permission→hook→execute lifecycle. Both methods delegate to it. | 🟢 Refactor | None | Medium |

---

## Current Structure

```
features/tools/
├── registry.ts              # ToolRegistry class + toAiSdkTools() [152 lines]
├── types.ts                 # ToolDef, ToolContext (132 lines), ToolResult
├── index.ts                 # createDefaultRegistry(), re-exports [96 lines]
├── permissions.ts           # toolsEnabled(), toolsTrusted() — env flags only [13 lines]
├── schema.ts                # extractToolFields() — Zod introspection
├── sandbox.ts               # SandboxError, getWorkspaceRoot, path classification
├── path-access.ts           # resolveAccessiblePath (external directory perms)
├── format.ts                # Text truncation/numbering utilities
├── builtins/                # 21 tool definition files (read, write, bash, task, etc.)
├── host/                    # Platform utilities (atomic-write, pty, ripgrep, fd, which, symbols)
└── perms/
    ├── defaults.ts          # Hardcoded DEFAULT_GLOBAL_TOOLS map + buildDefaultGlobalFile()
    ├── resolve.ts           # 3-layer resolution (session → workspace → global)
    ├── resolve.test.ts      # Tests for resolve + store
    └── store.ts             # File/SQLite read/write for 3 layers [241 lines]
```

---

## Current Flow

```
createDefaultRegistry()                    [index.ts:57-80]
  ├── Registers ALL 21 tools from ALL_TOOLS  [index.ts:25-47]
  ├── Only excludes by name (e.g. "task" for subagents)
  └── Returns ToolRegistry instance

registry.toAiSdkTools(ctxFactory)          [registry.ts:26-130]
  └── For EVERY registered tool:
      ├── Builds AI SDK tool({ name, description, inputSchema, execute })
      └── execute closure:
          ├── resolveToolPermission()       [registry.ts:37-41]
          ├── deny → return error string    [registry.ts:42-48]
          ├── ask  → ctx.askPermission()    [registry.ts:49-58]
          ├── hook before → execute → hook after  [registry.ts:60-99]
          └── catch → error string          [registry.ts:102-125]

Called from: run-turn/index.ts:210-247
  └── registry.toAiSdkTools((callId) => ({ ...full context... }))
```

### Permission Resolution

```
resolveToolPermission(toolName, ctx)        [resolve.ts:64-70]
  └── resolveToolPermissionDetailed()       [resolve.ts:28-62]
      ├── toolsTrusted() → force "allow"    [resolve.ts:32-34]
      ├── 1. sessionPerms.json (SQLite)     [resolve.ts:37-43]
      ├── 2. workspacePerms.json            [resolve.ts:46-52]
      ├── 3. globalPerms.json               [resolve.ts:55-59]
      │   └── ensureGlobal() → if missing:  [store.ts:88-105]
      │       ├── buildDefaultGlobalFile()  [defaults.ts:29-34]
      │       │   └── uses DEFAULT_GLOBAL_TOOLS (hardcoded)
      │       ├── write to disk
      │       └── read back
      └── unknown → "ask"                   [resolve.ts:61]
```

---

## Problem 1: Denied Tools Leak to the LLM

### Severity: 🔴 BUG — Active in production

### Description

`toAiSdkTools()` at `registry.ts:26` includes **every registered tool** in the `ToolSet` returned to the AI SDK, regardless of permission mode. The deny check happens **inside `execute()`** at line 42 — after the model has already received the tool's name, description, and input schema.

### Data flow showing the leak

```
1. User sets tool "bash" to deny in globalPerms.json
2. toAiSdkTools() iterates all tools [registry.ts:28]
3. bash added to out{} with description + inputSchema [registry.ts:29-31]
4. ToolSet sent to AI SDK / model
5. Model sees bash: "Run shell commands...", sees { command, timeout_ms, ... }
6. Model decides to call bash
7. execute() fires → resolveToolPermission("bash") → "deny" [registry.ts:37-42]
8. Returns: "ERROR permission: tool 'bash' is denied" [registry.ts:43-47]
9. Model wasted: tool description tokens + tool call + got error response
```

### Impact

- **Token waste:** Every denied tool's name + description + schema is sent to the model on every turn. For large toolsets this adds up.
- **Confusion:** The model sees a tool, tries to use it, gets denied. May retry or complain about broken tools.
- **No opt-out without code change:** There's no way to prevent a denied tool from appearing in the ToolSet today.

### Spec: Deny Pre-Filter

Denied tools must be **excluded from the ToolSet entirely**. The model must never see a tool that is in deny mode.

The old `toAiSdkTools()` method is **removed entirely**. `toFilteredAiSdkTools()` becomes the **only** method — it handles both filtering and building. If you need unfiltered tools (tests), you set all tools to allow.

```
registry.toFilteredAiSdkTools(ctxFactory, resolveCtx)
  ↓
  For each registered tool:
    resolveToolPermissionDetailed(toolName, resolveCtx)
    ├── deny → SKIP — not added to ToolSet
    ├── ask  → include — execute prompts user via askPermission()
    └── allow → include — execute runs directly
```

**Important:** The inner permission check in `execute()` must remain — `ask` mode tools still need the interactive prompt path. But `deny` can be pre-filtered because it never needs to reach `execute()`.

**Special case:** `toolsTrusted()` env var forces all tools to `allow`. In this mode, zero tools are filtered — this is already handled inside `resolveToolPermissionDetailed()` at `resolve.ts:32-34`.

### Plan: Deny Pre-Filter

#### Step 1: Extract ToolExecutor first (see Problem 4)

Do Problem 4's extraction first. Both `toFilteredAiSdkTools` and any test helpers delegate to `ToolExecutor.run()`.

#### Step 2: Remove `toAiSdkTools`, add `toFilteredAiSdkTools`

**File:** `registry.ts`

**Delete** the existing `toAiSdkTools()` method entirely (lines 26–130).

**Replace** with:

```typescript
import { resolveToolPermissionDetailed, type ResolveContext } from "./perms/resolve";

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(def: ToolDef): void {
    this.tools.set(def.name, def);
  }

  list(): ToolDef[] {
    return [...this.tools.values()];
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  /**
   * Build AI SDK tool set, pre-filtering denied tools.
   * The model never sees tools whose effective permission is "deny".
   * resolveCtx provides the session/workspace/global context for permission resolution.
   *
   * Execution lifecycle (inside ToolExecutor.run):
   *   permission resolve → ask UI → tool.before → execute → tool.after | tool.error
   */
  async toFilteredAiSdkTools(
    ctxFactory: (callId: string) => ToolContext,
    resolveCtx: ResolveContext
  ): Promise<ToolSet> {
    const executor = new ToolExecutor();
    const out: ToolSet = {};
    for (const def of this.tools.values()) {
      const resolved = await resolveToolPermissionDetailed(def.name, resolveCtx);
      if (resolved.mode === "deny") continue;

      out[def.name] = tool({
        description: def.description,
        inputSchema: def.inputSchema,
        execute: async (args, options) => {
          const callId = options.toolCallId;
          const ctx = ctxFactory(callId);
          return executor.run(def, args, ctx);
        },
      });
    }
    return out;
  }
}
```

**Key differences from old method:**
- `async` — returns `Promise<ToolSet>` (permission resolution is async)
- Takes `ResolveContext` as second parameter (needed to call `resolveToolPermissionDetailed`)
- Pre-filters denied tools before building the AI SDK tool wrapper
- Delegates execution to `ToolExecutor` (no inline closure)

#### Step 3: Update call site

**File:** `chat/run-turn/index.ts:210-247`

Currently:
```typescript
const tools = registry
  ? registry.toAiSdkTools((callId) => ({ ... }))
  : undefined;
```

Change to:
```typescript
const tools = registry
  ? await registry.toFilteredAiSdkTools(
      (callId) => ({ ...full context... }),
      { dataDir, sessionId, workspaceRoot }
    )
  : undefined;
```

The `ResolveContext` is `{ dataDir, sessionId, workspaceRoot }` — all three are already in scope at the call site. `runTurn` is already async, so the `await` is safe.

#### Step 4: Update exports

**File:** `index.ts:89-93`

Remove `resolveToolPermission` and `resolveToolPermissionDetailed` re-exports if they're only used internally now. Keep if the REST API uses them. Check:

- `resolveToolPermission` — used by REST API routes → **keep**
- `resolveToolPermissionDetailed` — used by REST API and now by registry → **keep**

No export changes needed. `ResolveContext` must be importable from `./perms/resolve` by `registry.ts`.

#### Step 5: Update test file

**File:** `hooks/wire.test.ts:60, 105, 152`

All three test sites call `reg.toAiSdkTools(...)`. Replace with:

```typescript
const tools = await reg.toFilteredAiSdkTools(
  (callId) => ({ ...same context... }),
  { dataDir: "/tmp/test-data", sessionId: "test-session", workspaceRoot: "/tmp/test-ws" }
);
```

Tests must set up a valid `globalPerms.json` (or use `toolsTrusted()`) so all tools resolve to `"allow"` and pass the pre-filter.

#### Step 6: Tests

**File:** `registry.test.ts` (new — see Problem 4 for full test list)

```
test: denied tool absent from ToolSet keys
  - Register a tool with permissionDefault: "allow"
  - Write globalPerms.json with that tool set to "deny"
  - Call toFilteredAiSdkTools()
  - Assert tool name NOT in Object.keys(result)

test: allowed tool present and executes normally
  - Register tool, set to "allow"
  - Call toFilteredAiSdkTools()
  - Assert tool IS in keys, execute runs

test: ask-mode tool present in ToolSet
  - Register tool, set to "ask"
  - Call toFilteredAiSdkTools()
  - Assert tool IS in keys (will prompt on execute)

test: toolsTrusted forces all tools through
  - Set env VISUAL_STUDIO_HARNESS_TOOLS_TRUSTED=1
  - Set tool to "deny" in globalPerms
  - Call toFilteredAiSdkTools()
  - Assert tool IS in keys (trusted overrides)
```

---

## Problem 2: Dual Default Source — 6 Tools Missing

### Severity: 🔴 BUG — Active drift

### Description

Tool defaults are defined in **two places** that can drift apart:

| Source | Location | Used by |
|--------|----------|---------|
| `ToolDef.permissionDefault` | Each builtin tool file (e.g. `bash.ts:19`) | **Nothing at runtime** — just metadata |
| `DEFAULT_GLOBAL_TOOLS` | `perms/defaults.ts:10-26` | `buildDefaultGlobalFile()` — seeds `globalPerms.json` on first run |

### Actual Drift Bug

**6 tools** are registered in `ALL_TOOLS` (`index.ts:25-47`) but **missing from `DEFAULT_GLOBAL_TOOLS`** (`defaults.ts:10-26`):

| Tool | `permissionDefault` in source | In `DEFAULT_GLOBAL_TOOLS`? | Consequence |
|------|------|------|------|
| `agent_change` | `"ask"` | ❌ **NO** | Falls through to `resolve.ts:61` → `"ask"` (happens to match, but only by accident) |
| `design_create` | `"allow"` | ❌ **NO** | Falls through to `resolve.ts:61` → **`"ask"`** (should be allow) |
| `design_read` | `"allow"` | ❌ **NO** | Falls through to `resolve.ts:61` → **`"ask"`** (should be allow) |
| `design_edit` | `"allow"` | ❌ **NO** | Falls through to `resolve.ts:61` → **`"ask"`** (should be allow) |
| `designs_list` | `"allow"` | ❌ **NO** | Falls through to `resolve.ts:61` → **`"ask"`** (should be allow) |
| `design_abandon` | `"allow"` | ❌ **NO** | Falls through to `resolve.ts:61` → **`"ask"`** (should be allow) |

The 5 design tools that should default to `"allow"` are defaulting to `"ask"` because:
1. They're not in `DEFAULT_GLOBAL_TOOLS`
2. `ensureGlobal()` writes a `globalPerms.json` that doesn't include them
3. `resolveToolPermissionDetailed()` doesn't find them in any layer → returns `"ask"` at `resolve.ts:61`

**User-visible effect:** Design tools (`design_create`, `design_read`, `design_edit`, `designs_list`, `design_abandon`) prompt for permission on every call, even though their `permissionDefault` says `"allow"`.

### Spec: Unified Defaults

`DEFAULT_GLOBAL_TOOLS` is **deleted entirely**. `buildDefaultGlobalFile()` reads `permissionDefault` from each registered `ToolDef` and produces the default `globalPerms.json` from that single source of truth. There is no hardcoded fallback — the registry is always available when this function is called.

### Plan: Unified Defaults

#### Step 1: Rewrite `defaults.ts`

**File:** `perms/defaults.ts`

```typescript
import type { ToolDef } from "../types";
import type { PermissionMode, PermsFile } from "../../../../../_shared/types";

/**
 * Build default permission map from registered ToolDef[].
 * Single source of truth: each tool's permissionDefault field.
 */
export function getDefaultsFromTools(tools: ToolDef[]): Record<string, PermissionMode> {
  const out: Record<string, PermissionMode> = {};
  for (const t of tools) {
    out[t.name] = t.permissionDefault;
  }
  return out;
}

/**
 * Module-level registry reference. Set once at startup by createDefaultRegistry().
 * buildDefaultGlobalFile() reads permissionDefault from these tools.
 */
let registeredTools: ToolDef[] | undefined;

/**
 * Register tools for default generation. Called once at startup.
 * Must be called before any call to buildDefaultGlobalFile().
 */
export function setDefaultTools(tools: ToolDef[]): void {
  registeredTools = tools;
}

/**
 * Build default globalPerms.json content.
 * Uses permissionDefault from each registered ToolDef (single source of truth).
 * Throws if no tools registered — this is a programming error, not a runtime condition.
 */
export function buildDefaultGlobalFile(): PermsFile {
  if (!registeredTools) {
    throw new Error(
      "buildDefaultGlobalFile() called before setDefaultTools(). " +
      "Call setDefaultTools(tools) in createDefaultRegistry() first."
    );
  }
  return {
    version: 1,
    tools: getDefaultsFromTools(registeredTools),
  };
}
```

**What's removed:**
- `DEFAULT_GLOBAL_TOOLS` — the entire hardcoded map is deleted
- No fallback path — if tools aren't registered, it throws (fail-fast, no silent drift)

#### Step 2: Call `setDefaultTools` at startup

**File:** `index.ts:57-80`

```typescript
import { setDefaultTools } from "./perms/defaults";

export function createDefaultRegistry(
  opts?: CreateRegistryOptions,
  agents?: Record<string, AgentSettings>
): ToolRegistry {
  setDefaultTools(ALL_TOOLS);  // ← new line — must come before any perms resolution
  const registry = createRegistry();
  const exclude = new Set(opts?.exclude ?? []);
  for (const t of ALL_TOOLS) {
    if (!exclude.has(t.name)) {
      if (t.name === "task") {
        registry.register(makeTaskTool(agents));
      } else {
        registry.register(t);
      }
    }
  }
  if (opts?.extraTools) {
    for (const t of opts.extraTools) {
      if (!exclude.has(t.name)) {
        registry.register(t);
      }
    }
  }
  return registry;
}
```

**Timing:** `setDefaultTools` is called **before** any tool execution, permission resolution, or REST API access. The first `ensureGlobal()` call happens lazily on the first permission check, which is always after registry creation.

#### Step 3: Update `ensureGlobal` and `resetGlobal` signatures

**File:** `perms/store.ts`

These functions currently call `buildDefaultGlobalFile()` with no arguments. The new version also takes no arguments (it reads the module-level `registeredTools`). **No signature change needed** — just verify the import still works.

```typescript
// store.ts — no changes needed to ensureGlobal or resetGlobal
// buildDefaultGlobalFile() is called the same way, but now reads from registeredTools
```

#### Step 4: Update tests

**File:** `perms/resolve.test.ts` (update existing + add)

Tests that currently call `buildDefaultGlobalFile()` must first call `setDefaultTools()`:

```typescript
import { setDefaultTools, buildDefaultGlobalFile, getDefaultsFromTools } from "./defaults";
import { readTool } from "../builtins/read";
import { bashTool } from "../builtins/bash";
import { designCreateTool } from "../builtins/design_create";
import { agentChangeTool } from "../builtins/agent_change";

// In beforeEach or beforeAll:
setDefaultTools([readTool, bashTool, designCreateTool, agentChangeTool, /* ...all tools... */]);
```

New tests:

```
test: getDefaultsFromTools() returns correct map
  - Pass mixed ToolDef[] with allow/deny/ask defaults
  - Assert map matches each tool's permissionDefault

test: buildDefaultGlobalFile() uses permissionDefault, not hardcoded
  - setDefaultTools with bash.permissionDefault = "ask"
  - Assert result.tools.bash === "ask"
  - (Old hardcoded map also had "ask" — but the point is it reads from ToolDef)

test: buildDefaultGlobalFile() includes all registered tools
  - setDefaultTools with ALL_TOOLS
  - Assert every tool name is present in result.tools

test: buildDefaultGlobalFile() throws if no tools registered
  - Don't call setDefaultTools
  - Assert throws with descriptive error

test: design tools get correct defaults from ToolDef
  - setDefaultTools with ALL_TOOLS
  - Assert design_create === "allow" (was "ask" due to drift)
  - Assert design_read === "allow"
  - Assert design_edit === "allow"
  - Assert designs_list === "allow"
  - Assert design_abandon === "allow"

test: agent_change defaults to "ask"
  - setDefaultTools with ALL_TOOLS
  - Assert agent_change === "ask"
```

---

## Problem 3: Bloated ToolContext

### Severity: 🟢 Code quality — no runtime impact

### Description

`ToolContext` at `types.ts:51-132` has **~20 fields**. Only 9 are used by 19 of 21 tools. The remaining 11 callback fields (`bridgePermission`, `bridgeToolCall`, `bridgeToolResult`, `bridgeToolUpdate`, `requestSubagentConfig`, `requestSlotBusyDecision`, `requestAgentChange`, `abortTurn`, `onSlotWaitStart`, `onSlotWaitStatus`, `onSlotWaitEnd`) are only used by `task.ts`.

### Field Usage Analysis

| Field | Used by tools | Count |
|-------|---------------|-------|
| `sessionId` | All | 21 |
| `turnId` | All | 21 |
| `workspaceRoot` | All | 21 |
| `dataDir` | All | 21 |
| `abortSignal` | All | 21 |
| `callId` | All | 21 |
| `toolName` | All (set by registry) | 21 |
| `askPermission` | All (gated by registry) | 21 |
| `hookCtx` | All (optional) | 21 |
| `messageId` | Few | ~3 |
| `bridgePermission` | task only | 1 |
| `bridgeToolCall` | task only | 1 |
| `bridgeToolResult` | task only | 1 |
| `bridgeToolUpdate` | task only | 1 |
| `requestSubagentConfig` | task only | 1 |
| `requestSlotBusyDecision` | task only | 1 |
| `requestAgentChange` | task only | 1 |
| `abortTurn` | task only | 1 |
| `onSlotWaitStart` | task only | 1 |
| `onSlotWaitStatus` | task only | 1 |
| `onSlotWaitEnd` | task only | 1 |

### Spec: Split ToolContext

**No backward compatibility.** The old `ToolContext` name is removed. All references updated to the new names.

```typescript
// Base context used by all 21 tools + MCP + path-access
export interface BaseToolContext {
  sessionId: string;
  turnId: number;
  workspaceRoot: string;
  dataDir: string;
  abortSignal: AbortSignal;
  callId: string;
  messageId?: string;
  toolName?: string;
  askPermission: (toolName: string, args: unknown) => Promise<boolean>;
  hookCtx?: HookContext;
}

// Extended context used only by task.ts — adds subagent/slot/agent callbacks
export interface ExtendedToolContext extends BaseToolContext {
  bridgePermission?: (
    toolName: string,
    args: unknown,
    callId: string
  ) => Promise<boolean>;
  bridgeToolCall?: (e: {
    toolCallId: string;
    toolName: string;
    args: unknown;
  }) => void;
  bridgeToolResult?: (e: {
    toolCallId: string;
    toolName: string;
    output: unknown;
    isError?: boolean;
  }) => void;
  bridgeToolUpdate?: (e: { toolCallId: string; status: string }) => void;
  requestSubagentConfig?: (
    req: SubagentConfigRequest
  ) => Promise<SubagentConfigReply>;
  requestSlotBusyDecision?: (req: {
    requestId: string;
    toolCallId?: string;
    detail: string;
    free: number;
    total: number;
    modelAlias?: string;
    baseUrl: string;
    defaultPollIntervalSec: number;
    defaultWaitTimeoutSec: number;
  }) => Promise<{
    action: "wait" | "fail" | "cancel";
    pollIntervalSec?: number;
    waitTimeoutSec?: number;
  }>;
  requestAgentChange?: (
    req: AgentChangeRequest
  ) => Promise<AgentChangeReply>;
  abortTurn?: () => void;
  onSlotWaitStart?: (info: {
    requestId: string;
    toolCallId?: string;
    detail: string;
    free: number;
    total: number;
    modelAlias?: string;
    pollIntervalSec: number;
    waitTimeoutSec: number;
  }) => void;
  onSlotWaitStatus?: (info: { requestId: string; message: string }) => void;
  onSlotWaitEnd?: (info: { requestId: string }) => void;
}
```

**Design decisions:**
- `ToolContext` is **not aliased** — every file must be updated to the correct name
- `ToolDef.execute` stays typed with `BaseToolContext` — task.ts casts internally (see below)
- `SubagentSpawnContext.parent` uses `ExtendedToolContext` (parent always has full context)
- `chat/types.ts` references use `ExtendedToolContext` for the callback types it extracts

### Plan: Split ToolContext

#### Step 1: Rename and split the interface

**File:** `types.ts:51-132`

- Rename `ToolContext` → `BaseToolContext` (keep only 10 common fields: 9 + `messageId`)
- Create `ExtendedToolContext extends BaseToolContext` with the 11 task callbacks
- **No alias.** The name `ToolContext` ceases to exist.

#### Step 2: Update `ToolDef.execute` signature

**File:** `types.ts:147`

The `execute` field keeps using `BaseToolContext`:

```typescript
export interface ToolDef<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TSchema;
  permissionDefault: PermissionMode;
  outputFields?: ToolFieldDef[];
  execute: (args: z.infer<TSchema>, ctx: BaseToolContext) => Promise<ToolResult>;
}
```

This means all 21 tool definitions compile without changes — they only use `BaseToolContext` fields.

#### Step 3: Update task.ts to use ExtendedToolContext

**File:** `builtins/task.ts:42`

The `execute` function receives `BaseToolContext` (from `ToolDef.execute` type) but needs `ExtendedToolContext` fields. Cast inside the function:

```typescript
execute: async (args, ctx) => {
  const tctx = ctx as ExtendedToolContext;
  // Use tctx.bridgePermission, tctx.requestSubagentConfig, etc.
  // ...rest of implementation unchanged
}
```

**Why cast instead of generic:** Making `ToolDef` generic (`ToolDef<Ctx = BaseToolContext>`) would require updating all 21 tool definitions to `ToolDef<BaseToolContext>` (explicitly), and the registry's `Map<string, ToolDef>` would need to become `Map<string, ToolDef<BaseToolContext>>`. The cast is localized to one file and is safe — `task.ts` is the only tool that needs the extended context, and the registry always provides it.

#### Step 4: Update all references (no alias — every file updated)

**Files to update and their new type:**

| File | Old import/type | New type | Reason |
|------|----------------|----------|--------|
| `types.ts:147` | `ToolContext` in `ToolDef.execute` | `BaseToolContext` | Interface renamed |
| `registry.ts:2` | `import { ToolContext, ... }` | `import { BaseToolContext, ... }` | Interface renamed |
| `registry.ts:26` | `ctxFactory: (callId: string) => ToolContext` | `ctxFactory: (callId: string) => BaseToolContext` | Signature updated |
| `path-access.ts:1,14` | `import { ToolContext }` / `ctx: ToolContext` | `BaseToolContext` | Only uses common fields |
| `path-access.test.ts:7,29` | `import { ToolContext }` / `Partial<ToolContext>` | `BaseToolContext` | Test fixture |
| `mcp/manager.ts:2,170` | `import { ToolContext }` / `ctx: ToolContext` | `BaseToolContext` | MCP tools only use common fields |
| `subagents/types.ts:1,27` | `import { ToolContext }` / `parent: ToolContext` | `ExtendedToolContext` | Parent has full context including all callbacks |
| `chat/types.ts:42-47` | `ToolContext["requestSlotBusyDecision"]` etc. | `ExtendedToolContext["requestSlotBusyDecision"]` etc. | These are task-only callbacks |
| `index.ts:84` | `export type { ..., ToolContext, ... }` | `export type { ..., BaseToolContext, ExtendedToolContext, ... }` | Re-exports updated |
| `executor.ts` (new) | Will import `BaseToolContext` | — | Created in Problem 4 |

#### Step 5: Tests

- TypeScript compilation: all files must compile with the new names
- `path-access.test.ts`: update `Partial<ToolContext>` → `Partial<BaseToolContext>`
- No runtime tests needed — this is a type-only change

---

## Problem 4: Monolithic Execute Closure

### Severity: 🟢 Code quality — impacts testability

### Description

`toAiSdkTools()` at `registry.ts:26-130` contains a **~95-line closure** (lines 32-127) that handles the entire permission → hook → execute → error lifecycle inline. This makes it impossible to test the lifecycle without going through the AI SDK `tool()` wrapper.

### Spec: Extract ToolExecutor

A `ToolExecutor` class encapsulates the permission → ask → hook before → execute → hook after/error → catch lifecycle as a plain `async run(): Promise<ToolResult>` method. `toFilteredAiSdkTools()` becomes a thin adapter that calls `executor.run()`.

### Plan: Extract ToolExecutor

#### Step 1: Create `executor.ts`

**File:** `executor.ts` (new, in `features/tools/`)

```typescript
import type { BaseToolContext, ToolDef, ToolResult } from "./types";
import { toolResultForSdk } from "./registry";
import { SandboxError } from "./sandbox";
import { getBus } from "../hooks/get-bus";
import { resolveToolPermission } from "./perms/resolve";

/**
 * Encapsulates the tool execution lifecycle:
 *   permission resolve → ask UI → tool.before → execute → tool.after | tool.error
 *
 * Used by ToolRegistry.toFilteredAiSdkTools() and test helpers.
 */
export class ToolExecutor {
  async run(
    def: ToolDef,
    args: unknown,
    ctx: BaseToolContext
  ): Promise<ToolResult> {
    let toolArgs: unknown = args;
    try {
      // 1. Permission resolve
      const mode = await resolveToolPermission(def.name, {
        dataDir: ctx.dataDir,
        sessionId: ctx.sessionId,
        workspaceRoot: ctx.workspaceRoot,
      });
      if (mode === "deny") {
        return toolResultForSdk({
          title: def.name,
          output: `ERROR permission: tool '${def.name}' is denied`,
          isError: true,
        });
      }

      // 2. Interactive ask
      if (mode === "ask") {
        const ok = await ctx.askPermission(def.name, toolArgs);
        if (!ok) {
          return toolResultForSdk({
            title: def.name,
            output: `ERROR permission: tool '${def.name}' was denied by user`,
            isError: true,
          });
        }
      }

      // 3. Hook before
      const bus = ctx.hookCtx ? getBus() : null;
      if (bus && ctx.hookCtx) {
        const outcome = await bus.emitIntercept("tool.before", ctx.hookCtx, {
          toolName: def.name,
          toolCallId: ctx.callId,
          args: toolArgs,
        });
        if (outcome.cancelled) {
          return toolResultForSdk({
            title: def.name,
            output: `ERROR hook: tool '${def.name}' cancelled: ${outcome.reason ?? "cancelled by hook"}`,
            isError: true,
          });
        }
        if (outcome.patch.args !== undefined) {
          toolArgs = outcome.patch.args;
        }
      }

      // 4. Execute
      const result = await def.execute(toolArgs as never, { ...ctx, toolName: def.name });
      const output = toolResultForSdk(result);

      // 5. Hook after / error
      if (bus && ctx.hookCtx) {
        await bus.emit("tool.after", ctx.hookCtx, {
          toolName: def.name,
          toolCallId: ctx.callId,
          args: toolArgs,
          output,
          isError: result.isError,
        });
        if (result.isError) {
          await bus.emit("tool.error", ctx.hookCtx, {
            toolName: def.name,
            toolCallId: ctx.callId,
            args: toolArgs,
            error: result.output,
          });
        }
      }

      return output;
    } catch (err: unknown) {
      const message =
        err instanceof SandboxError
          ? err.message
          : err instanceof Error
            ? `ERROR ${def.name}: ${err.message}`
            : `ERROR ${def.name}: unknown error`;

      const bus = ctx.hookCtx ? getBus() : null;
      if (bus && ctx.hookCtx) {
        await bus.emit("tool.error", ctx.hookCtx, {
          toolName: def.name,
          toolCallId: ctx.callId,
          args: toolArgs,
          error: message,
        });
      }

      return toolResultForSdk({
        title: def.name,
        output: message,
        isError: true,
      });
    }
  }
}
```

#### Step 2: Simplify `registry.ts`

**File:** `registry.ts`

After extraction, `registry.ts` is ~50 lines:

```typescript
import { tool, type ToolSet } from "ai";
import type { BaseToolContext, ToolDef } from "./types";
import { ToolExecutor } from "./executor";
import { resolveToolPermissionDetailed, type ResolveContext } from "./perms/resolve";

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(def: ToolDef): void {
    this.tools.set(def.name, def);
  }

  list(): ToolDef[] {
    return [...this.tools.values()];
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  /**
   * Build AI SDK tool set, pre-filtering denied tools.
   * The model never sees tools whose effective permission is "deny".
   */
  async toFilteredAiSdkTools(
    ctxFactory: (callId: string) => BaseToolContext,
    resolveCtx: ResolveContext
  ): Promise<ToolSet> {
    const executor = new ToolExecutor();
    const out: ToolSet = {};
    for (const def of this.tools.values()) {
      const resolved = await resolveToolPermissionDetailed(def.name, resolveCtx);
      if (resolved.mode === "deny") continue;

      out[def.name] = tool({
        description: def.description,
        inputSchema: def.inputSchema,
        execute: async (args, options) => {
          const ctx = ctxFactory(options.toolCallId);
          return executor.run(def, args, ctx);
        },
      });
    }
    return out;
  }
}

/**
 * Prepare a ToolResult for return to the AI SDK.
 *
 * When `_stopTurn` is set, the full ToolResult object must reach the SDK
 * so the flag survives in the tool-result event.  For normal results,
 * return just the output string.
 */
export function toolResultForSdk(result: ToolResult): string | ToolResult {
  if (result._stopTurn) return result;
  return result.output;
}

export function createRegistry(): ToolRegistry {
  return new ToolRegistry();
}
```

Note: `toolResultForSdk` is now used by both `executor.ts` and potentially external callers — it stays in `registry.ts` and is imported by `executor.ts`.

#### Step 3: Tests

**File:** `executor.test.ts` (new)

```
test: executor denies tool and returns error
  - Set up ToolDef + globalPerms with deny
  - executor.run() returns isError with deny message

test: executor allows tool and calls execute
  - Set up ToolDef + globalPerms with allow
  - executor.run() calls def.execute, returns its result

test: executor ask mode calls askPermission and user approves
  - Set up ToolDef + globalPerms with ask
  - ctx.askPermission resolves true
  - executor.run() calls def.execute

test: executor ask mode calls askPermission and user denies
  - Set up ToolDef + globalPerms with ask
  - ctx.askPermission resolves false
  - executor.run() returns isError with "denied by user" message

test: executor fires hook before and after
  - Register hook listeners
  - executor.run() triggers tool.before → execute → tool.after

test: executor handles hook cancellation
  - Register tool.before that cancels
  - executor.run() returns cancelled error, never calls execute

test: executor handles hook arg patching
  - Register tool.before that patches args
  - executor.run() calls def.execute with patched args

test: executor handles execute error and fires tool.error
  - def.execute throws
  - executor.run() catches, returns isError
  - tool.error hook fired with error message

test: executor handles SandboxError without ERROR prefix
  - def.execute throws SandboxError
  - executor.run() returns error with SandboxError message (no "ERROR" prefix)

test: executor handles non-Error throw
  - def.execute throws "something"
  - executor.run() returns "ERROR <tool>: unknown error"
```

**File:** `registry.test.ts` (new)

```
test: denied tool absent from ToolSet
  - Register tool, write globalPerms with deny
  - Call toFilteredAiSdkTools()
  - Assert tool NOT in Object.keys(result)

test: allowed tool present in ToolSet
  - Register tool, set to "allow"
  - Call toFilteredAiSdkTools()
  - Assert tool IS in keys

test: ask-mode tool present in ToolSet
  - Register tool, set to "ask"
  - Call toFilteredAiSdkTools()
  - Assert tool IS in keys

test: toolsTrusted overrides deny
  - Set env VISUAL_STUDIO_HARNESS_TOOLS_TRUSTED=1
  - Set tool to "deny" in globalPerms
  - Call toFilteredAiSdkTools()
  - Assert tool IS in keys

test: multiple tools, mixed permissions
  - Register 3 tools: allow, ask, deny
  - Call toFilteredAiSdkTools()
  - Assert 2 tools in keys, 1 absent
```

---

## Implementation Order

```
Step 1: Extract ToolExecutor          [foundation — enables step 2]
  ├── Create executor.ts
  ├── Update registry.ts to use it
  └── Write executor.test.ts
  ↓
Step 2: Fix deny-leak                  [uses executor]
  ├── Remove toAiSdkTools, add toFilteredAiSdkTools
  ├── Update run-turn call site
  ├── Update wire.test.ts
  └── Write registry.test.ts
  ↓
Step 3: Unify defaults                 [independent, can parallel with 1-2]
  ├── Delete DEFAULT_GLOBAL_TOOLS from defaults.ts
  ├── Add getDefaultsFromTools() + setDefaultTools()
  ├── Update buildDefaultGlobalFile() to read from registry
  ├── Update createDefaultRegistry() to call setDefaultTools()
  └── Update resolve.test.ts
  ↓
Step 4: Split ToolContext              [independent, can parallel with 1-3]
  ├── Rename ToolContext → BaseToolContext in types.ts
  ├── Create ExtendedToolContext in types.ts
  ├── Update ToolDef.execute type
  ├── Update all references across codebase
  ├── Update task.ts to use ExtendedToolContext
  └── Compile check
  ↓
Step 5: Run all tests → verify no regressions
```

### Dependency Graph

```
Step 1 (ToolExecutor)  ──→ Step 2 (Deny filter)
                                ↓
Step 3 (Defaults)      ────────→ Step 5 (Full test suite)
                                ↑
Step 4 (ToolContext)   ────────┘
```

Steps 3 and 4 are fully independent of steps 1 and 2. They can be done in parallel or in any order.

---

## File Change Summary

| File | Action | Change Description | Lines (est.) |
|------|--------|--------------------|-------------|
| `executor.ts` | **Create** | `ToolExecutor` class | ~95 |
| `registry.ts` | **Rewrite** | Remove `toAiSdkTools`, add `toFilteredAiSdkTools`, delegate to executor | ~50 (down from 152) |
| `types.ts` | **Modify** | Rename `ToolContext` → `BaseToolContext`, add `ExtendedToolContext`, update `ToolDef.execute` type | ~190 (up from 151) |
| `perms/defaults.ts` | **Rewrite** | Delete `DEFAULT_GLOBAL_TOOLS`, add `getDefaultsFromTools()`, `setDefaultTools()`, rewrite `buildDefaultGlobalFile()` | ~35 (up from 35) |
| `index.ts` | **Modify** | Add `setDefaultTools(ALL_TOOLS)` call, update exports | +3, -1 |
| `builtins/task.ts` | **Modify** | Import `ExtendedToolContext`, cast `ctx as ExtendedToolContext` | +2, -0 |
| `chat/run-turn/index.ts` | **Modify** | Switch `toAiSdkTools` → `toFilteredAiSdkTools` with `ResolveContext` | +5, -2 |
| `chat/types.ts` | **Modify** | `ToolContext["..."]` → `ExtendedToolContext["..."]` (4 references) | +0, -4 |
| `subagents/types.ts` | **Modify** | `parent: ToolContext` → `parent: ExtendedToolContext` | +0, -1 |
| `mcp/manager.ts` | **Modify** | `ToolContext` → `BaseToolContext` | +0, -1 |
| `path-access.ts` | **Modify** | `ToolContext` → `BaseToolContext` | +0, -1 |
| `path-access.test.ts` | **Modify** | `ToolContext` → `BaseToolContext` | +0, -2 |
| `hooks/wire.test.ts` | **Modify** | `toAiSdkTools` → `toFilteredAiSdkTools` (3 sites) | +6, -3 |
| `executor.test.ts` | **Create** | Tests for ToolExecutor lifecycle | ~130 |
| `registry.test.ts` | **Create** | Tests for deny-filter, allow-pass, ask-prompt, trusted-override | ~80 |
| `perms/resolve.test.ts` | **Update** | Add tests for unified defaults, design tool drift fix | +40 |
| **Total** | | ~430 new lines, ~75 modified | |

---

## What NOT to Change

- **REST API contracts** — `/api/tools/permissions/*` endpoints unchanged
- **Frontend UI** — `ToolsPanel.tsx` unchanged
- **On-disk file formats** — `globalPerms.json`, `workspacePerms.json`, session SQLite schema unchanged
- **Folder structure** — `builtins/`, `host/`, `perms/` remain as-is
- **`host/` naming** — cosmetic rename not worth the churn
- **3-layer permission design** — session > workspace > global, allow/ask/deny — unchanged and solid

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Deny pre-filter breaks ask-mode tools | Low | High | Only filters `"deny"`; `"ask"`/`"allow"` pass through unchanged. Inner permission check in executor remains as safety net for race conditions. |
| Default unification overwrites existing perms files | None | High | `ensureGlobal()` only seeds when file is MISSING; existing files are never overwritten. `setDefaultTools()` only affects what gets written to a NEW file. |
| ToolContext rename misses a reference | Low | Medium | TypeScript compiler catches all misses — any file still importing `ToolContext` will fail to compile. |
| `buildDefaultGlobalFile()` called before `setDefaultTools()` | Low | High | Throws immediately with descriptive error. Only possible if `createDefaultRegistry()` is skipped — a programming error, not a runtime condition. |
| ToolExecutor extraction breaks hooks | Low | Medium | Hook lifecycle logic is copied verbatim from the closure. `wire.test.ts` validates hook behavior end-to-end. |
| `toFilteredAiSdkTools` async changes break call site | Low | Low | `runTurn()` is already async. Adding `await` on the tool build is safe. |
| task.ts cast `ctx as ExtendedToolContext` is unsafe | Very Low | Low | The registry always provides full context (run-turn builds the complete context object). Cast is provably safe by construction. |

---

## Acceptance Checklist

### Bug Fixes
- [ ] Tool with mode `"deny"` does **NOT** appear in AI SDK ToolSet
- [ ] Tool with mode `"ask"` **DOES** appear; execute prompts user
- [ ] Tool with mode `"allow"` **DOES** appear; execute runs directly
- [ ] `buildDefaultGlobalFile()` reads `permissionDefault` from each `ToolDef`
- [ ] `DEFAULT_GLOBAL_TOOLS` is deleted — no hardcoded map exists
- [ ] Design tools (`design_create`, `design_read`, `design_edit`, `designs_list`, `design_abandon`) default to `"allow"` in seeded `globalPerms.json`
- [ ] `agent_change` defaults to `"ask"` in seeded `globalPerms.json`
- [ ] `ensureGlobal()` with tools produces file containing all 21 tool defaults
- [ ] Existing `globalPerms.json` files are never overwritten by new code
- [ ] `buildDefaultGlobalFile()` throws if called before `setDefaultTools()`

### Structural
- [ ] `ToolContext` name no longer exists anywhere in the codebase
- [ ] `BaseToolContext` contains only the 10 common fields (9 + `messageId`)
- [ ] `ExtendedToolContext` extends `BaseToolContext` with 11 task callbacks
- [ ] `SubagentSpawnContext.parent` is typed as `ExtendedToolContext`
- [ ] `chat/types.ts` references use `ExtendedToolContext` for callback extraction
- [ ] `ToolExecutor.run()` handles: deny → error, ask → prompt, allow → execute, hooks, error catch
- [ ] `toAiSdkTools()` method no longer exists — deleted, not renamed
- [ ] `toFilteredAiSdkTools()` is the only method on `ToolRegistry` for building tool sets
- [ ] `toFilteredAiSdkTools()` pre-filters denied tools, delegates to `ToolExecutor`
- [ ] `executor.ts` is ~95 lines, `registry.ts` is ~50 lines (down from 152)

### Tests
- [ ] All existing tests pass (updated `resolve.test.ts`, `wire.test.ts`, all `builtins/*.test.ts`)
- [ ] New `executor.test.ts` covers deny/allow/ask lifecycle, hooks, errors (10 cases)
- [ ] New `registry.test.ts` covers deny-filter absent, allow-pass, ask-present, trusted-override (5 cases)
- [ ] Updated `resolve.test.ts` covers `getDefaultsFromTools()`, design tool defaults, fallback behavior (6 cases)
