# Audit documents

An audit is a standardized analysis report. Use `audit` with the `create`, `read`, `edit`, `delete`, or `prompt_*` actions.

## Audit types (auditType)

- `implementation_completed` — compares code vs a spec/plan (uses `assessments`, `overallStatus`, attachments).
- `general_audit` — free-form named audit with an `endGoal` (what was being examined).
- Plus specific categories: `code_review`, `security_audit`, `performance_audit`, `architecture_review`, `dependency_audit`, `style_consistency`, `config_audit`, `memory_leak`, `race_condition`, `magic_numbers`, `dead_code`, `back_compat`, `custom`.

## Scope

`global`, `project`, or `session` (default `global`).

## Findings

Each finding:
```json
{
  "severity": "critical | high | medium | low | info",
  "file": "relative/path$",
  "line": 12,
  "title": "short one-liner",
  "description": "detail",
  "recommendation": "suggested fix",
  "category": "e.g. memory_leak, hardcoded_secret",
  "effort": "quick | moderate | significant"
}
```

## implementation_completed extras

- `assessments`: array of `{ aspectName, expectedBehavior, status (implemented_as_expected | implemented_differently | not_implemented), actualImplementation, fileReferences }`
- `overallStatus`: `pass | partial | fail`
- `overallAssessment`: human-readable verdict
- `attachments`: links to `designName`, `specName`, `planName`, `label`

## Audit prompts

`prompt_create`, `prompt_list`, `prompt_read`, `prompt_edit`, `prompt_delete` manage reusable presets with `category` (`general` | `implementation`), `auditType`, `endGoal`, and `templateInstructions`.

## Move

`move` relocates an audit between scopes: `{ "action": "move", "name": "<slug>", "toScope": "<target>", "fromScope": "<source, optional>" }`. `fromScope` resolves automatically (session → project → global) when omitted. The target scope must be available (workspace for `project`, session id for `session`) and must not already contain the same audit name.
