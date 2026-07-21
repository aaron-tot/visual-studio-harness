# Session Growth v2 — Configurable N Sessions (DO NOT EDIT)

This file documents the exact flow for the session-growth-v2 test.
**Never change this flow without explicit direction from the user.**

## Input

`N` = number of sessions (configurable: 2, 5, or 10)

## Flow

```
Input: N (number of sessions)

1. Archive all

2. For i = 1..N:
     New session (default model1000)
     ├─ type "{i}" → Enter
     ├─ wait 1s
     ├─ Read session ID → store as sessions[i]
     ├─ START monitor
     ├─ Monitor: 1 user msg, ==1 assistant msg
     ├─ STOP monitor
     ├─ Set previous[i] = 0, done[i] = false

3. LOOP: switch every 3s per session, max 5 min total
     For i = 1..N:
       Skip if done[i]
       Switch to sessions[i] → confirm header
       ├─ START monitor
       ├─ Read last number → current
       ├─ If previous[i] > 0: verify current > previous[i]
       ├─ Verify visible sequence no-gaps up to current
       ├─ Monitor: 1 user msg == "{i}", ==1 assistant msg
       ├─ wait 3s
       ├─ Read last number → new
       ├─ Verify new > current
       ├─ Verify visible sequence no-gaps up to new
       ├─ Set previous[i] = new
       ├─ Monitor: 1 user msg == "{i}", ==1 assistant msg
       ├─ STOP monitor
       ├─ If previous[i] >= 1000 → done[i] = true
     If all done → break

4. For i = 1..N:
     Switch to sessions[i] → confirm header
     ├─ Verify 1 user msg == "{i}"
     ├─ Verify 1 assistant msg full "1 2 3...1000"

5. Archive all N sessions
```

## Timing

- Per-session wait: 3s
- Per loop iteration: N × ~8s (including switches and checks)
- N=10: ~80s per loop, ~3-4 loops needed for all to reach 1000 = ~5 min
- Global timeout: 5 min
