# Visual Studio Harness

> A local-first AI development environment focused on transparent agent workflows, persistent project knowledge, and complete customization of AI-assisted development.

> [!WARNING]
> **Developer Preview**
>
> Visual Studio Harness is under active development and **is not yet considered stable**.
>
> APIs, configuration, prompts, database schema, UI structure, and internal systems may change without backward compatibility. Features may be incomplete, redesigned, or removed.
>
> If you are looking for a stable daily driver, this project is not there yet.

---

## Why This Exists

Current AI coding tools have structural problems:

- **Conversations are ephemeral** — Project knowledge gets buried in chat history and disappears when the session ends.
- **Agent behavior is opaque** — You can't easily see what prompts were used, which tools ran, what files changed, or why a decision was made.
- **Tools and permissions are often all-or-nothing** — Fine-grained control over what an agent can do doesn't exist.
- **Customization is fragmented** — Changing providers, models, prompts, or workflows often requires editing source code or maintaining forks.
- **Multi-agent workflows lack visibility** — Delegating work to subagents provides no insight into their execution or resource consumption.

**Visual Studio Harness exists to make those things persistent, configurable, and inspectable.**

---

## What It Is

Visual Studio Harness is an AI development environment built around three principles:

1. **Transparency** — Agent prompts, tool calls, file changes, token usage, and costs are visible and auditable.
2. **Persistent Knowledge** — Specifications, plans, research, and audits live as structured documents (MDS), not chat messages.
3. **Customization** — Providers, models, agents, prompts, tools, permissions, and workflows are configurable without modifying source code.

It runs locally (Bun + React), stores data in SQLite + JSON next to the binary, and exposes a REST API + SSE streaming for integration.

---

## Core Capabilities

| Capability | Status | Description |
|------------|--------|-------------|
| [Multi-Agent Orchestration](docs/features/agents.md) | 🚧 non-Functional | Delegate work to isolated subagents with configurable concurrency and runtime controls. |
| [Structured Design Docs (MDS)](docs/features/mds.md) | ✅ Functional | Versioned specs, plans, research, audits, notes — scoped global/workspace/session. |
| [Knowledge Base](docs/features/knowledge-base.md) | ✅ Functional | Local semantic search via sqlite-vec embeddings with ingestion, versioning, metadata extraction. |
| [Web Interface](docs/features/web-interface.md) | ✅ Functional | Chat, file explorer, design manager, knowledge tab, research, sessions, settings. |
| [Workflow Observability](docs/features/observability.md) | ✅ Functional | Per-turn token/cost tracking, tool execution visibility, session analytics. |
| [Tooling & Permissions](docs/features/tools.md) | ✅ Functional | 18 built-in tools, 4-mode permission system (allow/ask/deny/inherit), custom tools. |
| [Configuration System](docs/features/configuration.md) | ✅ Functional | 3-scope live-editable config (global/workspace/session), SQLite + JSON persistence. |
| [MCP Client](docs/features/mcp.md) | ✅ Functional | Connect external MCP servers (stdio/HTTP/SSE), tools prefixed as `server_tool`. |
| [MCP Server](docs/features/mcp.md#mcp-server-planned) | 🚧 Planned | Toggleable server exposing harness tools as `vsh_<tool>` for external control. |
| [Hooks System](docs/features/hooks.md) | ✅ Functional | Event-driven lifecycle hooks for session, turn, tool, delegation, file, config events. |
| [Session Management](docs/features/sessions.md) | 🚧 Incomplete | JSON+SQLite persistence, summarization, context windows, streaming, usage tracking. |
| [Workspace Intelligence](docs/features/workspace-intelligence.md) | ✅ Functional | Symbol index, references, file watcher, TypeScript parsing, manifest generation. |

---

## How It Works

```
┌─────────────┐     REST + SSE      ┌─────────────┐
│   Browser   │ ◄──────────────────► │   Backend   │
│  (React)    │                     │  (Bun/TS)   │
└─────────────┘                     └──────┬──────┘
                                            │
         ┌──────────────────────────────────┼──────────────────────────────────┐
         ▼                                  ▼                                  ▼
┌─────────────────────┐          ┌─────────────────────┐          ┌─────────────────────┐
│   Agent Runtime     │          │     Tools (18)      │          │   Knowledge Base    │
│  - System prompts   │          │  - read, write,     │          │  - sqlite-vec       │
│  - Subagents        │          │  - edit, bash,      │          │  - Chunking         │
│  - Slot gating      │          │  - searchLocal,     │          │  - Ingestion        │
│  - Per-step prompts │          │  - searchOnline,    │          │  - Search           │
│                     │          │  - todo, design,    │          │                     │
│                     │          │  - notes, audit,    │          │                     │
│                     │          │  - graph, knowledge │          │                     │
└─────────────────────┘          └─────────────────────┘          └─────────────────────┘
         │                                  │                                  │
         ▼                                  ▼                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Data Layer (SQLite + JSON)                             │
│  Scopes: Global / Workspace / Session  │  Config  │  Sessions  │  MDS  │  Knowledge  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Tech Stack:** Backend: Bun, Express, TypeScript · Frontend: React, TypeScript, Vite · State: Zustand · Storage: SQLite + JSON · Transport: REST + SSE

---

## Screenshots

| Agent Session | Design Manager | Usage Metrics |
|---------------|----------------|---------------|
| ![Agent session](github/images/toolCalls-thinking.png) | ![Design docs](github/images/designGlobal.png) | ![Usage dashboard](github/images/usage.png) |

*Left: Tool calls and workflow state · Middle: Global design documents · Right: Usage and cost tracking*

---

## Getting Started

### Option 1: Download a Release (Recommended)

Prebuilt releases available through [GitHub Releases](https://github.com/your-org/visual-studio-harness/releases).

### Option 2: Build From Source

Requires Bun.

```bash
cd repoSource
bun install
bun run dev
```

- Backend: `http://localhost:3001`
- Frontend: `http://localhost:5173` (hot reload)
- Config loaded from `data/{dev,prod}/config.json`
- Tool execution mode: `toolExecutionMode` in `config.json` (`"sequential"` default | `"concurrent"`) — also editable in General settings; step batches render `Tool Call Batch: Sequential | Parallel`
- Provider credentials via environment variables

---

## Philosophy

| Principle | Meaning |
|-----------|---------|
| **Knowledge outlives conversations** | Important project information exists independently from agent sessions. |
| **Users control their AI environment** | Prompts, models, providers, permissions, workflows are configurable. |
| **AI should be inspectable** | Developers understand what happened, what changed, and why. |
| **Local-first where practical** | Projects remain under user control unless external services are intentionally used. |

---

## Current Status

### Known Limitations

- APIs remain unstable; database schema may change
- Multi-tab usage not extensively tested
- Subagent workflows require broader real-world testing
- Some metrics and analytics incomplete
- Automated test coverage incomplete
- Documentation may lag behind development
- Memory leaks under sustained load (see PLAN.md)

### Roadmap Priorities

1. **Stability** — Bug fixes, performance, error handling, test coverage, release packaging
2. **Observability** — Token attribution, cost breakdowns, tool-level analytics, cache visibility, code diff view
3. **Knowledge Systems** — Persistent memory, configurable providers, context compaction, improved design system
4. **Agent Improvements** — Better subagent workflows, coordination, configurable behavior, more providers
5. **Extensibility** — Plugin architecture, frontend/backend plugins, custom hooks, memory plugins
6. **Interface** — Dockable panels, custom layouts, keyboard shortcuts, UI customization

---

## Technical Documentation

Looking for implementation details, APIs, configuration schemas, tool specifications, or architecture documentation? See the **[Technical Reference](docs/TECHNICAL_REFERENCE.md)**.

---

## Source Availability

Visual Studio Harness is **source available**.

You may:
- Review the source code
- Learn from the implementation
- Run it locally
- Modify it for personal use
- Submit improvements and bug reports

**Not open source** — Commercial redistribution, competing hosted services, and public forks not permitted without permission.

See [LICENSE](../LICENSE) for complete terms.
