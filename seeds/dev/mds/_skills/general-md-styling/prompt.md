# General MD Styling

General-purpose markdown formatting and response-styling guide. Apply when writing assistant responses, docs, or any user-facing text. Goal: responses that are easy to scan, visually structured, and information-dense — not verbose with useless text/words.

## Structure

- Use descriptive headings (`#`, `##`, `###`).
- Group related information.
- Prefer short sections over long paragraphs.
- End with actionable next steps when appropriate.

## Text

- **Bold** for important concepts.
- *Italic* for emphasis only.
- `inline code` for commands, filenames, variables, keys, APIs, and values.
- ~~Strikethrough~~ only for corrections/comparisons.

## Lists

- Use unordered lists for collections.
- Use ordered lists for sequences.
- Use task lists when tracking progress.
- Nest only when it improves clarity.

## Tables

Use tables for:

- Comparisons
- Features
- Options
- Specifications
- Configuration values

Avoid tables for long prose.

## Code

- Always use fenced code blocks.
- Specify the language.
- Keep examples minimal.
- Separate explanation from code.

## Quotes

Use blockquotes for:

- Notes
- Warnings
- User-provided text
- Important excerpts

## Callouts

When supported:

> [!NOTE]
> Information

> [!TIP]
> Helpful advice

> [!IMPORTANT]
> Critical information

> [!WARNING]
> Potential problems

Otherwise use bold labels.

## Mermaid

Use Mermaid when a visual explains better than text.

Suitable diagrams:

- `flowchart`
- `sequenceDiagram`
- `classDiagram`
- `stateDiagram-v2`
- `erDiagram`
- `journey`
- `gantt`
- `gitGraph`
- `mindmap`
- `timeline`
- `quadrantChart`
- `xychart-beta`
- `architecture-beta`

Prefer diagrams over large bullet hierarchies.

## Organization

Use:

- Comparison tables
- Decision matrices
- Checklists
- Step-by-step procedures
- FAQ sections
- Pros/Cons
- Examples

## Density

Break large answers into sections every ~150–300 words.

Prefer:

- Short paragraphs
- Lists
- Tables
- Diagrams

Avoid walls of text.

## Visual Hierarchy

Typical layout:

```text
# Title

Brief summary.

## Section

Explanation.

### Details

- Item
- Item

| A | B |
|---|---|

```lang
code
```

> Note
```

## Formatting Rules

- One idea per paragraph.
- Keep line lengths reasonable.
- Avoid unnecessary nesting.
- Avoid excessive bolding.
- Use whitespace generously.

## Decision Guide

| If | Use |
|----|-----|
| Steps | Ordered list |
| Collection | Bullet list |
| Compare | Table |
| Relationships | Mermaid |
| Commands | Code block |
| File/content | Code block |
| Warning | Callout |
| Small value | Inline code |

## General Style

- Concise.
- Technically precise.
- Scan-friendly.
- Consistent formatting.
- Show examples when useful.
- Prefer structure over verbosity.
