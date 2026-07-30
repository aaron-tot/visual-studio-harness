# Research Workflow (Agent)

Systematic research procedure using the ResearchDoc REST API. Use this whenever you need to investigate a question, track findings with provenance, and produce verifiable sourced answers.

## Data Model

### ResearchDoc

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` | UUID, generated server-side on creation |
| `goal` | `string` | The high-level question or decision being investigated |
| `initialQueryPoints` | `ResearchPoint[]` | Planned lines of inquiry — set up front |
| `discoveredQueryPoints` | `ResearchPoint[]` | Questions that emerged during research |
| `createdAt` | `string` (ISO) | Server timestamp |
| `updatedAt` | `string` (ISO) | Updated on every PUT |

### ResearchPoint

| Field | Type | Purpose |
|---|---|---|
| `question` | `string` | Exact question being investigated |
| `answer` | `string` | Concise factual finding |
| `sourceUrl?` | `string` | URL where evidence was found |
| `sourcePath?` | `string` | Local file path for evidence |
| `verbatimQuotes` | `string[]` | Direct quotes from source |
| `summary` | `string` | Your interpretation of the evidence |
| `searchedAt` | `string` (ISO) | When the search was performed |
| `confidence` | `"high"\| "medium" \| "low" \| "speculative"` | Source quality rating |

### Initial vs Discovered

- **Initial Query Points**: Planned at doc creation — what you set out to answer
- **Discovered Query Points**: New questions that arose from findings — capture serendipitous paths

## REST API

Base: `/api/research`

| Method | Path | Action |
|---|---|---|
| `GET` | `/api/research?scope=...&workspaceRoot=...&sessionId=...` | List all docs for scope |
| `POST` | `/api/research` | Create doc (body: `scope`, `goal`, `initialQueryPoints[]`) |
| `GET` | `/api/research/:id?scope=...` | Get single doc |
| `PUT` | `/api/research/:id` | Update doc (replace entire doc) |
| `DELETE` | `/api/research/:id?scope=...` | Delete doc |

**Scope params** (query for GET/DELETE, body for POST/PUT):

```
scope: "global" | "project" | "session"
workspaceRoot: string   // required when scope="project"
sessionId: string       // required when scope="session"
```

## Workflow

### 1. Create a Research Doc

```
POST /api/research
{
  "scope": "global" | "project" | "session",
  "workspaceRoot": "...",     // if project
  "sessionId": "...",         // if session
  "goal": "Can we compile Rust to WASM and load it inside a web worker?",
  "initialQueryPoints": [ ... ]
}
```

Set `initialQueryPoints` to the questions you plan to investigate. The server generates `id`, `createdAt`, `updatedAt`.

### 2. Investigate Each Point

For each query point:

1. **Search** — use `websearch` to discover URLs, `grep`/`read` for local files
2. **Fetch** — use `webfetch` to read each URL as markdown/text
3. **Extract** — copy verbatim quotes into `verbatimQuotes[]`
4. **Answer** — write a concise answer in `answer`
5. **Summarize** — brief interpretation in `summary`
6. **Tag** — set `confidence` based on source quality
7. **Update** — `PUT /api/research/:id` with the full updated doc

### 3. Track Discovered Questions

When findings reveal new questions:

1. Append them to `discoveredQueryPoints[]`
2. Investigate using the same procedure
3. `PUT /api/research/:id` to save

### 4. Iterate

Continue until the `goal` is answered to sufficient confidence. The doc accumulates all findings and provenance in one place.

## Tool Usage

| Tool | When |
|---|---|
| `websearch` | Need to discover URLs by query — start here |
| `webfetch` | Have a URL, need its content as markdown/text |
| `grep` / `read` | Need to search or read local files |
| `graph_files` / `graph_search` | Need workspace structure/symbols |
| `skill` | Load this file or other skill docs |

## Confidence Guide

| Tag | When |
|---|---|
| `high` | Multiple reliable sources agree; official docs; direct evidence |
| `medium` | Single good source; reasonable inference |
| `low` | One weak source; forum post; indirect evidence |
| `speculative` | No direct evidence; extrapolation; best guess |

## Scope Semantics

| Scope | Visibility | Storage |
|---|---|---|
| `global` | All workspaces and sessions | `data/{mode}/research/global/` |
| `project` | Current workspace only | `data/{mode}/research/project/{workspaceRootHash}/` |
| `session` | Current chat session only | `data/{mode}/research/session/{sessionId}/` |

Use `global` for reusable knowledge that applies everywhere. Use `project` for codebase-specific research. Use `session` for transient one-off investigations.

## Example

```typescript
// Create a research doc
const doc = await fetch("/api/research", {
  method: "POST",
  body: JSON.stringify({
    scope: "project",
    workspaceRoot: "/home/user/project",
    goal: "Can we compile Rust to WASM for web worker use?",
    initialQueryPoints: [{
      question: "Does Vite support WASM in web workers?",
      answer: "Yes, with ?worker&url suffix.",
      sourceUrl: "https://vite.dev/guide/features.html",
      verbatimQuotes: ["Web Workers can import WASM via ?worker&url import syntax."],
      summary: "Vite fully supports WASM in workers",
      searchedAt: new Date().toISOString(),
      confidence: "high"
    }]
  })
});

// Later, add discovered questions
doc.discoveredQueryPoints.push({
  question: "Does wasm-pack support targeting web workers?",
  // ... filled after investigation
});
await fetch(`/api/research/${doc.id}`, {
  method: "PUT",
  body: JSON.stringify({ ...doc, scope: "project", workspaceRoot: "/home/user/project" })
});
```
