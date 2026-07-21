# Mixed Part Types — Full Test Spec

## Test Name

`session-mixed-parts.spec.ts`

## Model: `model-alltools`

Letter-prefixed counting (a, b, c phases) with 14 tools + 2 thinking blocks interleaved.

### Phases

```
Phase a (tools 1-5):
  a1 a2 ... a20 → bash
  a21 a22 ... a40 → write
  a41 a42 ... a60 → todoread
  a61 a62 ... a80 → todowrite
  a81 a82 ... a100 → read

Phase b (tools 6-9):
  b1 b2 ... b20 → edit
  b21 b22 ... b40 → grep
  b41 b42 ... b60 → glob
  b61 b62 ... b80 → apply_patch

Phase c (tools 10-14 + thinking):
  c1 c2 ... c20 → find_symbol
  c21 c22 ... c40 → read_symbol
  c41 c42 ... c60 → [thinking1 "Let me reconsider..."]
  c61 c62 ... c80 → webfetch
  c81 c82 ... c100 → websearch
  c101 c102 ... c120 → [thinking2 "Finalizing..."]
  c121 c122 ... c140 → skill
```

### Tool Definitions (in order)

| # | Pos | Tool | Args | Expected Result |
|---|-----|------|------|----------------|
| 1 | after a20 | bash | `{ command: "echo hello from test model" }` | `"hello from test model\n"` |
| 2 | after a40 | write | `{ path: "newfile.txt", content: "created by agent" }` | file created |
| 3 | after a60 | todoread | `{}` | empty or existing todos |
| 4 | after a80 | todowrite | `{ todos: [{ id: "1", content: "test task", status: "pending", priority: "high" }] }` | todos set |
| 5 | after a100 | read | `{ path: "data/hello.txt" }` | `"Hello world!\nThis is a test file."` |
| 6 | after b20 | edit | `{ path: "editthis.txt", old_string: "original content", new_string: "edited content" }` | file updated |
| 7 | after b40 | grep | `{ pattern: "Hello", path: "data/" }` | match in data/hello.txt |
| 8 | after b60 | glob | `{ pattern: "**/*.txt" }` | matches fixture files |
| 9 | after b80 | apply_patch | `{ patchText: "*** Update File: editthis.txt\nSEARCH:\nedited content\nREPLACE:\npatched content\n" }` | file patched |
| 10 | after c20 | find_symbol | `{ query: "greet", path: "src" }` | `src/index.ts` with line |
| 11 | after c40 | read_symbol | `{ name: "greet", path: "src/index.ts" }` | function source |
| 12 | after c80 | webfetch | `{ url: "https://example.com", format: "text" }` | example.com content |
| 13 | after c100 | websearch | `{ query: "playwright test 2026", numResults: 1, type: "fast" }` | search results |
| 14 | after c140 | skill | `{ name: "test-skill" }` | skill loaded |

### Thinking Blocks

| Pos | Content |
|-----|---------|
| after c60 | `"Let me reconsider..."` |
| after c120 | `"Finalizing..."` |

## Workspace Setup

Per-test-run isolated workspace created by the test:

```
tests/{YYYY-MM-DD_HH-MM-SS}_{random}/
├── src/
│   └── index.ts              ← function greet(name) + class Calculator
├── data/
│   └── hello.txt             ← "Hello world!\nThis is a test file."
├── editthis.txt              ← "original content"
├── .VISUAL STUDIO HARNESS/
│   └── skills/
│       └── test-skill.md     ← valid markdown skill file
└── tools.perms.json          ← { "*": "allow" }
```

Created before any session starts. Workspace root = this directory.

## Test Flow

```
Settings:
  ├─ agent: "test"
  ├─ model: "model-alltools"
  ├─ speed: 30 t/s
  └─ close

1. Archive all

2. Create Session A (label "1"):
   ├─ START monitors: checkStart, checkEnd, snippetMatch, toolPresent, thinkingPresent
   ├─ Check A1: "a1 a2 a3" exists, read end, snippet match
   └─ wait 2s

3. Switch to Session B (label "2"):
   ├─ STOP monitors → sidebar → item "2" → click → wait 500ms
   ├─ START monitors
   ├─ Check B1: "a1 a2 a3" exists, read end, snippet match
   └─ wait 2s

4. Switch to Session A:
   ├─ STOP monitors → sidebar → item "1" → click → wait 500ms
   ├─ START monitors
   ├─ Check A2: start exists, read end, snippet match
   ├─ If past tool1: verify bash tool card visible with correct args/output
   ├─ If past tool2: verify write tool card visible
   └─ wait 2s

5. Switch to Session B:
   ├─ STOP monitors → sidebar → item "2" → click → wait 500ms
   ├─ START monitors
   ├─ Check B2: start exists, read end, snippet match
   └─ wait 2s

6..N. Repeat every 2s until both sessions finish streaming

N+1. Switch to Session A:
   ├─ STOP monitors → switch → START monitors
   ├─ Full reference text match
   ├─ All 14 tool cards present with correct name/args/output
   ├─ Both thinking <details> present
   ├─ Parts in correct order
   └─ STOP monitors

N+2. Switch to Session B:
   ├─ Identical final checks
   └─ STOP monitors

N+3. Archive all
```

## Reference File

A JSON file committed alongside the test that captures the complete expected output:

```json
{
  "text": "a1 a2 a3 ... a20 a21 a22 ... a40 a41 a42 ... a60 a61 a62 ... a80 a81 a82 ... a100 b1 b2 b3 ... b20 b21 b22 ... b40 b41 b42 ... b60 b61 b62 ... b80 c1 c2 c3 ... c20 c21 c22 ... c40 c41 c42 ... c60 c61 c62 ... c80 c81 c82 ... c100 c101 c102 ... c120 c121 c122 ... c140",
  "parts": [
    { "type": "text", "from": "a1", "to": "a20" },
    { "type": "tool", "toolName": "bash" },
    { "type": "text", "from": "a21", "to": "a40" },
    { "type": "tool", "toolName": "write" },
    { "type": "text", "from": "a41", "to": "a60" },
    { "type": "tool", "toolName": "todoread" },
    { "type": "text", "from": "a61", "to": "a80" },
    { "type": "tool", "toolName": "todowrite" },
    { "type": "text", "from": "a81", "to": "a100" },
    { "type": "tool", "toolName": "read" },
    { "type": "text", "from": "b1", "to": "b20" },
    { "type": "tool", "toolName": "edit" },
    { "type": "text", "from": "b21", "to": "b40" },
    { "type": "tool", "toolName": "grep" },
    { "type": "text", "from": "b41", "to": "b60" },
    { "type": "tool", "toolName": "glob" },
    { "type": "text", "from": "b61", "to": "b80" },
    { "type": "tool", "toolName": "apply_patch" },
    { "type": "text", "from": "c1", "to": "c20" },
    { "type": "tool", "toolName": "find_symbol" },
    { "type": "text", "from": "c21", "to": "c40" },
    { "type": "tool", "toolName": "read_symbol" },
    { "type": "text", "from": "c41", "to": "c60" },
    { "type": "reasoning" },
    { "type": "text", "from": "c61", "to": "c80" },
    { "type": "tool", "toolName": "webfetch" },
    { "type": "text", "from": "c81", "to": "c100" },
    { "type": "tool", "toolName": "websearch" },
    { "type": "text", "from": "c101", "to": "c120" },
    { "type": "reasoning" },
    { "type": "text", "from": "c121", "to": "c140" },
    { "type": "tool", "toolName": "skill" }
  ]
}
```

The test extracts a snippet from `"text"` based on the current stream position and does an **exact string match** against the actual DOM text content. It also cross-references `"parts"` to know which non-text parts should be visible at that point.

## Monitor Checks

Each runs every 50ms, toggled on/off during session switches:

| Check | What it verifies |
|-------|-----------------|
| `checkStart` | `"a1 a2 a3"` present at bubble start |
| `snippetMatch` | DOM text exactly matches `reference.text.substring(0, currentPos)` |
| `toolPresent` | Each tool card that should be visible (based on `reference.parts` up to `currentPos`) is actually rendered with correct name |
| `thinkingPresent` | Each thinking `<details>` that should be visible is actually rendered |

## Timing Estimate

At 30 t/s:
- 260 text tokens: ~8.7s
- 14 tools × ~150ms: ~2.1s
- 2 thinking blocks: ~0.4s
- Total streaming: ~11s
- 2s swap intervals: ~5-6 swaps per session
- Total test time (2 sessions): ~45-60s
