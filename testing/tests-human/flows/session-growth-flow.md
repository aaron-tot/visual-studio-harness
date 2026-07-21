# Session Growth Test — User Flow (DO NOT EDIT)

This file documents the exact flow for the session-growth test.
**Never change this flow without explicit direction from the user.**

## Flow

```
1. Archive all sessions (clean slate)

2. New session (default model1000)
   ├─ type "1" → Enter
   ├─ wait 1s
   ├─ Read session ID → store as sessionA
   ├─ START monitor
   ├─ Monitor: 1 user msg, ==1 assistant msg
   ├─ STOP monitor

3. New session (default model1000)
   ├─ type "2" → Enter
   ├─ wait 1s
   ├─ Read session ID → store as sessionB
   ├─ START monitor
   ├─ Monitor: 1 user msg, ==1 assistant msg
   ├─ STOP monitor

4. LOOP: switch every 3s, max 3 min total
   │  Track: previousA=0, previousB=0
   │
   ├─ Switch to sessionA → confirm header
   │  ├─ START monitor
   │  ├─ Read last number in bubble → currentA
   │  ├─ Verify currentA > previousA (grew while away)
   │  ├─ Verify numbers 1..currentA all exist
   │  ├─ Monitor: 1 user msg ("1"), ==1 assistant msg
   │  ├─ wait 3s
   │  ├─ Read last number → newA
   │  ├─ Verify newA > currentA (grew during this visit)
   │  ├─ Verify numbers 1..newA all exist
   │  ├─ Set previousA = newA
   │  ├─ Monitor: 1 user msg ("1"), ==1 assistant msg
   │  ├─ STOP monitor
   │  ├─ If previousA == 1000 → mark A done
   │
   ├─ Switch to sessionB → confirm header
   │  ├─ START monitor
   │  ├─ Read last number → currentB
   │  ├─ Verify currentB > previousB
   │  ├─ Verify numbers 1..currentB all exist
   │  ├─ Monitor: 1 user msg ("2"), ==1 assistant msg
   │  ├─ wait 3s
   │  ├─ Read last number → newB
   │  ├─ Verify newB > currentB
   │  ├─ Verify numbers 1..newB all exist
   │  ├─ Set previousB = newB
   │  ├─ Monitor: 1 user msg ("2"), ==1 assistant msg
   │  ├─ STOP monitor
   │  ├─ If previousB == 1000 → mark B done
   │
   ├─ Both done → break

5. FINAL (both at 1000 or timeout)
   ├─ Switch to sessionA → verify 1 user msg=="1", 1 assistant msg "1 2 3...1000"
   ├─ Switch to sessionB → verify 1 user msg=="2", 1 assistant msg "1 2 3...1000"

6. Archive both
```

## Timing

- Per-session wait: 3s
- Global timeout: 3 min
- model1000 at 20 t/s takes 50s to reach 1000
- At ~6s per loop iteration (2×3s), ~9 iterations needed per session = ~54s total
