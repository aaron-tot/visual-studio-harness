# apply_patch — multi-file patch format

`apply_patch` applies a multi-file patch to the workspace. Use it instead of rewriting whole files.

## Markers

```
*** Add File: relative/path
file contents

*** Update File: relative/path
<<<<<<< SEARCH
exact old text (must match once)
=======
new text
>>>>>>> REPLACE

*** Delete File: relative/path
```

## Rules

- `*** Add File:` creates a new file with the content that follows.
- `*** Update File:` replaces `SEARCH` (which must match exactly once) with `REPLACE`.
- `*** Delete File:` deletes the file.
- Paths are relative to the workspace.
- Prefer this over rewriting whole files, especially for multi-hunk edits.
