# Design Documents (spec / plan)

A design is a versioned folder with `spec*.json` and `plan*.json` documents. Use `design_create` / `design_read` / `design_edit` to manage them. Set `scope` to `global`, `project`, or `session`.

## Document types

- **spec** — WHAT to build: goal, requirements, constraints, assumptions, acceptanceCriteria, parts.
- **plan** — HOW to build it: endGoal, tags, parts.

## `content` field structure (design_create)

`content` is optional. When omitted you get a bare skeleton. Keys:

- **specs:** `goal` (string), `requirements` (string[]), `constraints` (string[]), `assumptions` (string[]), `acceptanceCriteria` (string[]), `parts` (SpecPlanPart[]).
- **plans:** `endGoal` (string), `tags` (string[]), `parts` (SpecPlanPart[]).
- The `meta` key is ignored and auto-generated.

## Parts (recursive nesting)

```json
{
  "id": "...",
  "name": "...",
  "type": "spec | plan | phase | task | milestone",
  "description": "...",
  "status": "...",
  "dependencies": ["<other part id>"],
  "parts": [ /* nested sub-parts */ ]
}
```

Parts support arbitrary nested depth. Each part can itself contain `parts`.
