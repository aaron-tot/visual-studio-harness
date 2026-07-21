# Agent Switch Test — User Flow (DO NOT EDIT)

This file documents the exact flow for the agent-switch test.
**Never change this flow without explicit direction from the user.**

## Pre-req

- Agents `playwritetest1` and `playwritetest2` exist in config
- playwritetest1: provider=Test, model=model-mixed, temp=low
- playwritetest2: provider=Test, model=model5000, temp=high
- Use Test provider + simple test models

## Flow

```
1. Archive all

2. Open Settings → Agents tab
   ├─ Click playwritetest1 → read provider/model/temp → store as P1/M1/T1
   ├─ Click playwritetest2 → read provider/model/temp → store as P2/M2/T2
   └─ Close settings

3. New chat (empty)
   ├─ Verify on default agent (not playwritetest1/2)
   ├─ Verify default model, default temp
   ├─ Change model to something ≠ M1, verify pill updated
   ├─ Change temp to something ≠ T1, verify pill updated
   ├─ Open agent dropdown → select playwritetest1
   ├─ Verify agent pill = "playwritetest1"
   ├─ Verify model pill changed TO M1 (not the different one)
   ├─ Verify temp pill changed TO T1

4. Type "1" → Enter → wait for response

5. Verify session dropdowns still = playwritetest1's settings
   ├─ Agent = "playwritetest1", Model = M1, Temp = T1

6. Check first assistant bubble metadata
   ├─ Top of bubble: agent name = "playwritetest1"
   ├─ Bottom of bubble: agent name = "playwritetest1"
   ├─ Bottom: model = M1, provider = P1

7. In current session (WITHOUT new chat):
   ├─ Change agent to playwritetest2 via the agent dropdown
   ├─ Verify agent pill = "playwritetest2"
   ├─ Verify model pill changed TO M2 (was M1)
   ├─ Verify temp pill changed TO T2 (was T1)

8. Type "1b" → Enter → wait for response

9. Verify session dropdowns now = playwritetest2's settings
   ├─ Agent = "playwritetest2", Model = M2, Temp = T2

10. Check NEW (second) assistant bubble metadata
    ├─ Top of bubble: agent name = "playwritetest2"
    ├─ Bottom of bubble: agent name = "playwritetest2"
    ├─ Bottom: model = M2, provider = P2

11. Check FIRST assistant bubble still shows playwritetest1 metadata
    ├─ Top of bubble: agent name = "playwritetest1" (unchanged)
    ├─ Bottom: model = M1, provider = P1 (unchanged)

12. Archive session
```

## Metadata locations

Assistant bubble:
  Top:    agent badge (letter) + agent name text
  Bottom: provider name, model name, duration
  Both turns are visible in the same scroll area.
