# Research Workflow

Systematic research methodology using agent tools and the Research tab's `ResearchDoc` + `ResearchPoint` data model.

## Data Model

```
ResearchDoc
├── goal: string                     ← high-level research goal/question
├── initialQueryPoints: ResearchPoint[]  ← planned at creation time
├── discoveredQueryPoints: ResearchPoint[]  ← added during research as new questions emerge
├── createdAt: string (ISO)
└── updatedAt: string (ISO)

ResearchPoint
├── question: string                 ← what you want to find out
├── answer: string                   ← synthesized finding after investigation
├── sourceUrl?: string               ← URL where information was found
├── sourcePath?: string              ← local file path where information was found
├── verbatimQuotes: string[]         ← direct quotes from sources
├── summary: string                  ← concise summary of the finding
├── searchedAt: string (ISO)         ← when the search was performed
├── confidence: "high"|"medium"|"low"|"speculative"  ← how reliable is this finding
```

## REST API

All endpoints accept scope via query param: `?scope=global|project|session`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/research` | List all research docs for a scope |
| `POST` | `/api/research` | Create new research doc |
| `GET` | `/api/research/:id` | Get single doc with all points |
| `PUT` | `/api/research/:id` | Update doc (goal, initial/discovered points) |
| `DELETE` | `/api/research/:id` | Delete doc |

## Workflow Steps

### 1. Create a ResearchDoc

When a non-trivial question needs investigation, create a new doc with the goal and planned initial query points. Use the `POST /api/research` endpoint.

```
POST /api/research?scope=project
{
  "goal": "Understand how the agent tool registry works",
  "initialQueryPoints": [
    {
      "question": "How are tool definitions registered and discovered?",
      "answer": "",
      "verbatimQuotes": [],
      "summary": "",
      "searchedAt": "",
      "confidence": "speculative"
    }
  ]
}
```

### 2. Investigate Each Point

For each ResearchPoint with an empty answer:

1. **Formulate search terms** from the question
2. Use `websearch` for web-based research, `grep`/`read` for codebase research
3. Read relevant files with `read` to get verbatim quotes
4. **Update the point** via `PUT /api/research/:id` with findings

### 3. Track Discovered Questions

During research, new unanswered questions often emerge. Add them to `discoveredQueryPoints` so they aren't lost. Update the doc:

```
PUT /api/research/:id?scope=project
{
  "discoveredQueryPoints": [
    {
      "question": "How does createDefaultRegistry filter excluded tools?",
      "answer": "",
      "verbatimQuotes": [],
      "summary": "Needs investigation — the exclude parameter filters the default tool list",
      "searchedAt": "",
      "confidence": "speculative"
    }
  ]
}
```

### 4. Iterate

Switch between investigating initial points and discovered points until all are answered or the goal is met. Mark confidence as research progresses.

## Tool Usage Guide

| Research Phase | Agent Tools |
|---|---|
| Formulate questions | `read` current code/docs to identify unknowns |
| Find code | `grep` + `read` + `graph_search` / `graph_imports` |
| Find web sources | `websearch` by query, then `webfetch` to read URLs |
| Capture finding | `read` verbatim lines, then `PUT /api/research/:id` to store |
| Discover new questions | During reading, append to `discoveredQueryPoints` |

## Confidence Guide

| Confidence | When to use |
|---|---|
| `high` | Multiple independent sources agree, or reading authoritative source code directly |
| `medium` | Single credible source, or code reading that is likely but not certain |
| `low` | Partial evidence, inference, or stale source |
| `speculative` | Unverified assumption, placeholder before investigation |

## Scope Semantics

| Scope | When to use |
|---|---|
| `global` | Research that applies across all projects (e.g., framework docs, general architecture concepts) |
| `project` | Research specific to the current workspace/codebase |
| `session` | Ephemeral research for the current turn — replaced each session |

## Example: Complete Flow

```json
POST /api/research?scope=project
{
  "goal": "How does the MCP tool integration work?",
  "initialQueryPoints": [
    {
      "question": "What types of tools does MCP support?",
      "answer": "MCP supports tools, resources, and prompts. Each is registered via the MCP manager.",
      "sourceUrl": "https://modelcontextprotocol.io/docs",
      "verbatimQuotes": ["Tools are the primary way MCP servers expose executable functionality"],
      "summary": "MCP has three primitives: tools (callable), resources (readable), prompts (templated)",
      "searchedAt": "2026-07-30T08:00:00.000Z",
      "confidence": "high"
    },
    {
      "question": "How are MCP tools merged with built-in tools?",
      "answer": "",
      "verbatimQuotes": [],
      "summary": "",
      "searchedAt": "",
      "confidence": "speculative"
    }
  ],
  "discoveredQueryPoints": []
}
```
