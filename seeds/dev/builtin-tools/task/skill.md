# task — subagent delegation

The `task` tool delegates work to a subagent running in its own session. You (the caller) act as the user of that session.

## Behavior

- Provide a detailed `prompt`; the subagent runs the normal agent pipeline (tools, multi-step).
- You receive only the subagent's **final assistant message text** (not its full tool traces).
- The result includes a `task_id`. Pass the same `task_id` on a later call to **resume that subagent session** with another user message.
- Wait for the result before continuing dependent work.
- Do not nest `task` calls from within a subagent.

## Params

- `agent_name` (required): name of the agent config to use.
- `description` (required): short 3-5 word label for the UI.
- `prompt` (required): the full task; becomes the subagent's user message.
- `task_id` (optional): pass a prior task_id to resume that session instead of creating a new one.
