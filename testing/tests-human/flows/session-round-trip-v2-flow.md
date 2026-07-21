# Session Round-Trip v2 — Configurable N Sessions (DO NOT EDIT)

This file documents the exact flow for the session-round-trip-v2 test.
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

3. For cycle = 1..3:
     For i = 1..N:
       Switch to sessions[i] → confirm header
       ├─ START monitor
       ├─ Monitor: 1 user msg == "{i}", ==1 assistant msg
       ├─ wait 2s
       ├─ Monitor: 1 user msg == "{i}", ==1 assistant msg
       ├─ STOP monitor

4. For i = 1..N:
     Switch to sessions[i] → confirm header
     ├─ Verify 1 user msg == "{i}"
     ├─ Verify ==1 assistant msg

5. Archive all N sessions
```

## Timing

- Per-session wait: 2s
- N=10: ~6 min total (10 × (1s + 1s + 3 × (2s + 2s)) = 10 × 13s = 130s)
