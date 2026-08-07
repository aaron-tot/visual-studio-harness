# design_edit — patch semantics (RFC 7396 JSON Merge Patch)

`design_edit` updates a spec/plan in two modes:

1. **`document`** — full replacement of the whole document JSON.
2. **`patch`** — surgical merge per RFC 7396 (JSON Merge Patch).

## Merge rules (patch mode)

- Plain objects: **deep-merge** (recurse into existing keys).
- Arrays and primitives: **fully replaced**.
- `null` in the patch: **deletes** the key from the target.
- Fields present in the destination but not the patch are unchanged.

Whether `document` or `patch` is used, the tool auto-updates `meta.updatedAt` and `meta.updatedBy`.

## Example

Target `meta`:
```json
{ "id": "specV1", "title": "X", "status": "draft" }
```
Patch:
```json
{ "meta": { "status": "approved" } }
```
Result meta:
```json
{ "id": "specV1", "title": "X", "status": "approved" }
```
