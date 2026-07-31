# Prompt System & .md System — Architecture Audit

**Date**: 2026-07-31  
**Scope**: Backend source under `_backend/src/` and seed files under `seeds/`  
**Purpose**: Map all subsystems, identify naming collisions, boundary leaks, structural debt, and scope-coverage gaps

---

## 1. System Prompt Builder

**Location**: `_backend/src/features/system-prompt/`  
**Architecture**: Section-based orchestrator

### File Layout

```
system-prompt/
  builder.ts           ← Orchestrator: iterate 8 sections, wrap-with-joiners
  constants.ts         ← BuildSystemBlockInput, SystemPromptJoiners defaults, TAG_PRE/TAG_POST maps
  sections/
    types.ts           ← SectionContext interface
    global.section.ts  ← reads data/{mode}/mds/systemPromptBase.md
    agent-md.section.ts  ← reads agentMd (inline | existing path)
    skills.section.ts  ← reads skillMds[]
    project.section.ts ← reads {workspaceRoot}/{agents,AGENTS}.md
    runtime.section.ts ← formatRuntimeInfo (mode, workspace_root, session_id, datetime)
    todo-list.section.ts ← formatTodoList from session_todos
    workspace-manifest.section.ts ← graph service -> tree
    extras.section.ts  ← joins extras[] from config
```

### Data Flow

```
run-turn/index.ts
  → buildSystemBlock(BuildSystemBlockInput)
    → ensureGlobalAgentsFile()    [idempotent: seeds file if missing]
    → for each section:
        → build(ctx) → string | null
        → wrapWithJoiners(content, tag, joiners)
    → join blocks with "\n\n"
  → messagesForModel(sessionMessages, systemBlock)
  → assertExactlyOneSystemMessage(messages)
```

### Seed Chain for `systemPromptBase.md`

```
1. data/{mode}/mds/systemPromptBase.md exists? → return
2. Legacy mds/global/agents.md exists? → copy to systemPromptBase.md
3. seeds/{subdir}/mds/systemPromptBase.md exists? → copy from seed
4. Fallback to hardcoded buildDefaultGlobalAgentsMarkdown()
```

**Two seed files exist** (identical content):
- `seeds/dev/mds/systemPromptBase.md`
- `seeds/packageAndProd/mds/systemPromptBase.md`

---

## 2. Agents System (Legacy & Active)

### Barrel Layers

```
_shared/types/config.ts   ← AgentSettings, AgentMdConfig, SkillMdConfig
  ↓
_backend/src/features/agents/  ← real implementation
  system-prompt.ts  ← re-exports + ensureGlobalAgentsFile + messagesForModel + assertExactlyOneSystemMessage
  md-utils.ts       ← readAgentsFile, listAgentsMdAtRoot, resolveAgentMd, resolveSkillMds
  paths.ts          ← globalAgentsPath, legacyGlobalAgentsPath, seedsDir, projectAgentsPath, seedConfigPath, seedJoinersDefaultsPath
  constants.ts      ← AGENTS_MD_NAMES = ["agents.md", "AGENTS.md"]
  agents.default.ts ← buildDefaultGlobalAgentsMarkdown() — hardcoded fallback
  format.ts         ← formatRuntimeInfo
  todo-list-format.ts ← formatTodoList
  runtime-settings.ts  ← getAgentSettings, resolveRuntimeFromSettings, resolveSessionRuntime
  rest.ts           ← listAgents, readAgent, writeAgent, deleteAgentFile
  ↓
_backend/src/agent/  ← re-export barrel (NO new logic)
  system-prompt.ts   → re-exports from features/agents/system-prompt and features/system-prompt/builder
  agents.default.ts  → re-exports (but also has an independent copy!)
  runtime-settings.ts → re-exports from features/agents/runtime-settings
  turn.ts            → re-exports
```

> **Finding**: `_backend/src/agent/agents.default.ts` is a near-duplicate of `_backend/src/features/agents/agents.default.ts` with a different comment. Only `features/agents/` one is imported. The barrel file in `_backend/src/agent/` re-exports with zero added logic — every consumer must go through this barrel for no benefit.

---

## 3. The "MDS" REST System

**File**: `_backend/src/rest/mds.ts` (340 lines)

### What it manages

All `.md` files in two locations:

| Key | Location | Scan Mode | Example |
|---|---|---|---|
| `data.{mode}` | `data/{mode}/mds/` | Recursive (subdirectories) | `systemPromptBase.md`, `global/agents.md` |
| `workspace` | `{workspaceRoot}/` | Flat (root only) | `AGENTS.md`, `PLAN.md` |

### API Endpoints

| Method | Path | Action |
|---|---|---|
| GET | `/api/mds` | List + reconcile on-disk with metadata |
| GET | `/api/mds/read?path=` | Read file content |
| POST | `/api/mds/create` | Write file + update `mdMeta.json` |
| PUT | `/api/mds/update` | Edit/rename + update metadata |
| DELETE | `/api/mds/delete?path=` | Delete file + clean metadata |

### Metadata

`data/{mode}/mds/mdMeta.json` stores tags, `lastEdited`, compute stats (chars, words, lines, tokens) per entry.

### Problems

- **Brittle scope detection**: `const mode = resolve(dataDir).split("/").pop()` — assumes path structure, fragile
- **No scope filtering**: All files mixed into one flat list, no `global`/`project`/`session` distinction
- **No validation**: No schema validation for uploaded `.md` content
- **Stats computed inline**: `calculateStats()` is duplicated knowledge (tokens = chars/4 is an LLM-ism)
- **Hardcoded tag**: `global/agents.md` gets auto-tagged `"global"` — but this is the old legacy path name
- **Name is misleading**: "mds" describes file format (.md), not purpose. Everything in `dataDir/mds/` is prompt-related: `systemPromptBase.md` (base system prompt), `skill/` (skill definitions), `global/agents.md` (legacy), `system/` (agent configs). The name obscures that this is a **prompt file** management system.

---

## 4. Skill System

**File**: `_backend/src/features/tools/builtins/skill.ts` (94 lines)

### Load Order

```
skillRoots = [
  .visual-studio-harness/skills/,
  source/skills/,
  data/{mode}/skills/
]
```

Resolution: directory with `SKILL.md` → name is directory name; flat `*.md` → name is basename without `.md`

### Problems

- **Duplicate listing logic**: `listSkillNames()` and `registerSkillsRoutes` both scan for skill discovery, but scan **different directories**:
  - `rest/skills.ts` → scans `data/{mode}/mds/skill/` for the frontend
  - `builtins/skill.ts` → scans `skillRoots` from runtime config for the agent
  - These sets are **non-overlapping**. Skills in `dataDir/skills/` are invisible to the frontend. Skills in `dataDir/mds/skill/` are invisible to the agent tool unless also in `skillRoots`.
- **No `/api/skills/read` endpoint** — frontend can't fetch skill content
- **32KB max**: Hardcoded constant `MAX_SKILL_BYTES`

---

## 5. Knowledge Base System

**Location**: `_backend/src/features/knowledge-base/`

### Data Flow

```
KnowledgeBaseService
  → ingestion pipeline (watcher)
  → chunking + embedding
  → hybrid search (FTS5 + vector)
  → CRUD tools: knowledge_document_create, _edit, _delete, knowledge_search, knowledge_ingest, knowledge_list, knowledge_open
```

### Scope Support

Knowledge base has its own scope enum (`KbScope`) but **only global scope is implemented**. Project and session scopes are defined in the type but have no storage paths or resolution logic.

### Problems

- **Has its own ingest/watcher pipeline** that overlaps with `mds/` REST system. Both ingest `.md` files but KB does it with chunking+embeddings while MDS just tracks metadata. No cross-reference between them.
- **`CONFIG_FILENAME_PREFIX = "agentCreate_"`** — agent-created docs get this prefix, but there's no mechanism to prevent conflicts or display it cleanly.

---

## 6. Notes System

**File**: `_backend/src/rest/notes.ts` (307 lines) — CRUD REST + 5 builtin tool wrappers

### Storage

Each note = a directory with `note.json`:

```
data/{mode}/notes/{name}/note.json                ← global scope
{workspace}/.agentHarness/notes/{name}/note.json  ← project scope
data/{mode}/session/{sessionId}/notes/{name}/note.json  ← session scope
```

### Problems

- **Same scope pattern redefined** (third copy of `"global" | "project" | "session"`)
- **`.agentHarness` directory** in workspace root is a side-effect for project-scoped data — no cleanup mechanism
- **Notes cannot be edited by agent tool** — only created, archived, listed. `notes_update` tool exists but modifies metadata (archived flag) not content

---

## 7. Audit System

**Location**: `_backend/src/features/tools/builtins/audit_*.ts` (8 files), `rest/audits.ts`, `rest/audit-prompts.ts`

### Storage

```
data/{mode}/audits/{name}/audit.json                  ← global
{workspace}/.agentHarness/audits/{name}/audit.json    ← project
data/{mode}/session/{sid}/audits/{name}/audit.json    ← session
```

**Audit prompts** are separate and **global-only**:
```
data/{mode}/audit-prompts/{id}/prompt.json
```

### Problems

- **Eight tool files** for one domain, each ~20-40 lines of boilerplate wrapping REST calls
- **`.agentHarness` directory** appears again for project-scoped audits
- **Audit prompts seeded from code** (`audit-prompt-seeds.ts`) — 12 hardcoded prompts, cannot be customized without code changes
- **No dedup with Notes** — both store structured JSON with metadata, yet have completely separate implementations
- **Audit prompts have no scope support** — only global, no project or session

---

## 8. Design (Spec/Plan) System

**Location**: `_backend/src/features/tools/builtins/design_*.ts` (5 files), `rest/plans.ts` (429 lines)

### Storage

```
data/{mode}/designs/{name}/specV1.json, planV1.json        ← global
{workspace}/.agentHarness/designs/{name}/...                ← project
data/{mode}/session/{sid}/designs/{name}/...                ← session
```

### Problems

- **Largest REST file** at 429 lines — does too much (create, read, edit, list, abandon)
- **`.agentHarness`** directory again
- **Duplicate scope resolution pattern** (4th copy)

---

## 9. Cross-Cutting Issues

### 9.1 Naming Collision: "agents.md" Means Two Things

| File | Purpose |
|---|---|
| `data/{mode}/mds/systemPromptBase.md` | Global prompt base (formerly `mds/global/agents.md`) |
| `{workspaceRoot}/agents.md` | Project-level rules for the LLM agent |

The global file has migrated **from** `agents.md` **to** `systemPromptBase.md`, but the migration is incomplete:
- `_backend/src/agent/agents.default.ts` still says "# agents" in comments
- `ensureGlobalAgentsFile` method name references "agents"
- `AGENTS_MD_NAMES = ["agents.md", "AGENTS.md"]` still used for both global and project

### 9.2 Scope Enum is Copy-Pasted 5 Times

Each system redefines `"global" | "project" | "session"` as a local type:

| File | Type Name |
|---|---|
| `rest/audits.ts` | `AuditScope` |
| `rest/notes.ts` | `NotesScope` |
| `rest/plans.ts` | `DesignsScope` |
| `rest/research.ts` | `ResearchScope` |
| `features/knowledge-base/db.ts` | `KbScope` |

### 9.3 `.agentHarness` Directory Proliferation

Project-scoped data for notes, audits, and designs all write to `{workspaceRoot}/.agentHarness/{type}/`. No single manager or cleanup mechanism.

### 9.4 SystemPromptJoiners Has 20 Fields

`SystemPromptJoiners` in `_shared/types/config.ts` has 20 mandatory string fields (`preGlobal`, `postGlobal`, `preAgent`, etc.). Any schema change requires updating:
- Type definition
- Default constants
- Seed JSON
- `loadSeedJoinersDefaults` parser
- `TAG_PRE` / `TAG_POST` maps
- Joiner key type

### 9.5 Tool Prefix Inconsistency

| System | Prefix | Count |
|---|---|---|
| Knowledge | `knowledge_` | 7 |
| Audit (docs) | `audit_` | 5 |
| Audit (prompts) | `audit_prompt_` | 5 |
| Notes | `notes_` | 5 |
| Design | `design_` | 5 |

### 9.6 Agent Settings Have Two Storage Layers

- JSON files at `data/{mode}/agents/{key}.json` — source of truth for agent presets
- Session metadata stores ephemeral overrides (model, provider, thinking effort)
- Agent settings carry `agentMd` and `skillMds` (nested MD configs), but these are not propagated through the session → runtime path cleanly

### 9.7 No Centralized Path Resolution

Each REST module has its own `resolve*Dir` function. There is no shared path mapping.

### 9.8 Two `agents.default.ts` Files

| File | Used? |
|---|---|
| `_backend/src/agent/agents.default.ts` | **NOT imported anywhere** |
| `_backend/src/features/agents/agents.default.ts` | **IS imported** from `features/agents/system-prompt.ts` |

---

## 10. Scope Resolution Analysis: Which Systems Actually Support the 3-Scope Pattern

The established scope resolution pattern is:

| Scope | Base Dir | Resolver Logic |
|---|---|---|
| `global` | `{dataDir}/` | `join(dataDir, "<subsystem>")` |
| `project` | `{workspaceRoot}/.agentHarness/` | `join(resolve(workspaceRoot), ".agentHarness", "<subsystem>")` |
| `session` | `{dataDir}/session/{id}/` | `join(dataDir, "session", sessionId, "<subsystem>")` |

### Scope Coverage by System

| System | Global | Project | Session | Storage Format |
|--------|--------|---------|---------|---------------|
| Notes | ✅ | ✅ | ✅ | `note.json` |
| Audits | ✅ | ✅ | ✅ | `audit.json` |
| Research | ✅ | ✅ | ✅ | JSON |
| Designs | ✅ | ✅ | ✅ | `specV1.json`, `planV1.json` |
| Knowledge Base | ✅ (only) | ❌ defined but dead | ❌ defined but dead | SQLite + source files |
| **Prompts (mds/)** | ✅ `dataDir/mds/` | ❌ | ❌ | `.md` files |
| **Skills** | ✅ `dataDir/mds/skill/` | ❌ | ❌ | `.md` files |
| **Agents (presets)** | ✅ `dataDir/agents/` | ❌ | ❌ | `.json` files |
| **Audit Prompts** | ✅ `dataDir/audit-prompts/` | ❌ | ❌ | `prompt.json` |

Three prompt-related subsystems (mds, skills, agents) lack project and session scope entirely — they are global-only, which is inconsistent with the rest of the system.

### Section-Level Scope Gaps in the Prompt Builder

The `SectionContext` passed to each section builder carries `dataDir`, `workspaceRoot`, `sessionId`, and `mode` — all the necessary info for scope resolution. But each section resolves differently:

| Section | What It Reads | Scope Used |
|---------|--------------|------------|
| `global.section.ts` | `dataDir/mds/systemPromptBase.md` | global only |
| `project.section.ts` | `{workspaceRoot}/{agents,AGENTS}.md` | workspace root only (semi-project) |
| `agent-md.section.ts` | `agentSettings.agentMd` (path or inline) | caller-dependent |
| `skills.section.ts` | `agentSettings.skillMds` (path array) | caller-dependent |

The "project" section reads from the workspace root directly (`agents.md`), not from `.agentHarness/mds/`. There is no `.agentHarness/mds/` concept at all today.

---

## 11. Three Competing Skills Directories

| Directory | Scanned By | Status |
|-----------|-----------|--------|
| `dataDir/mds/skill/` | REST API (`rest/skills.ts`) → frontend listing | ✅ Live |
| `dataDir/skills/` | Agent tool (`builtins/skill.ts`) via `skillRoots` from runtime config | ❌ Orphaned — no system writes here, no seed mechanism targets it |
| `seeds/dev/skills/` | Seed source only (one skill: `testing/SKILL.md`) | ✅ Seed only |

The agent tool and the REST API scan **non-overlapping** directories:
- Agent searches `skillRoots` → includes `dataDir/skills/`, `.visual-studio-harness/skills/`, `source/skills/`
- REST scans `dataDir/mds/skill/`
- Skills in one are invisible to the other

The `seeds/dev/skills/testing/SKILL.md` shows intent to seed skills, but no seeding mechanism copies from `seeds/` to either skills target directory. The only seeding that runs is `ensureGlobalAgentsFile()` for `systemPromptBase.md`.

---

## 12. Seeds Directory Structure vs. What 3-Scope Support Would Require

### Current Seeds

```
seeds/dev/
  config/joinerDefaults.json
  mcp/default.json
  mds/systemPromptBase.md
  skills/testing/SKILL.md
seeds/packageAndProd/
  config/joinerDefaults.json
  mcp/default.json
  mds/systemPromptBase.md
```

### Current Seed Mechanism

The only seeding logic is `ensureGlobalAgentsFile()`:
1. Checks `dataDir/mds/systemPromptBase.md` exists → return
2. Legacy migration from `dataDir/mds/global/agents.md`
3. Copy from `seeds/{modeSubdir}/mds/systemPromptBase.md`
4. Hardcoded fallback

Skills are NOT seeded. The `skills/testing/SKILL.md` directory under `seeds/dev/` exists but has no ingestion path into either `dataDir/mds/skill/` or `dataDir/skills/`.

There is no seed structure for project-level or session-level prompts.

---

## 13. Directory Map of All Subsystems

```
data/{mode}/
├── mds/                        ← Raw .md files (MDS REST system)
│   ├── systemPromptBase.md     ← Global prompt base
│   ├── skill/                  ← Skills discovered by frontend REST
│   ├── global/agents.md        ← Legacy (migration target → systemPromptBase.md)
│   └── system/                 ← System agent configs
├── agents/                     ← Agent presets (*.json)
├── sessions/
├── notes/                      ← Notes (JSON) — has 3-scope
├── audits/                     ← Audit documents (JSON) — has 3-scope
├── audit-prompts/              ← Audit prompt presets (JSON) — global only
├── designs/                    ← Specs & plans (JSON) — has 3-scope
├── research/                   ← Research documents (JSON) — has 3-scope
├── knowledge/                  ← KB with embeddings — global only
└── skills/                     ← Skills (scanned by agent tool) — global only, orphaned

{workspace}/
└── .agentHarness/              ← Project-scoped data (notes, audits, designs)
    ├── notes/
    ├── audits/
    └── designs/
```

### Key Observations

1. **Six subsystems write to `dataDir/` directly** (mds, agents, notes, audits, designs, knowledge) — three have scope support, three don't
2. **Three subsystems write to `.agentHarness/`** (notes, audits, designs) — all with the same scope pattern copy-pasted
3. **Only ONE subsystem uses session scope** (notes, audits, designs) — mds/prompts/skills don't
4. **`dataDir/skills/` is orphaned** — no seeding into it, no REST visibility from it, yet it's in `skillRoots`
5. **Seeds directory has a skill that never gets copied anywhere**
6. **The MDS REST system is the only UI for managing prompt files** — and it only sees `dataDir/mds/` and `{workspaceRoot}/`, not `.agentHarness/mds/` or session-level mds
