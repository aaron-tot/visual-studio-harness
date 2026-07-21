# Multi-Tab Testing — Rough Idea (ASK USER FIRST)

## The Core Idea

The 5 existing tests (`session-round-trip`, `session-round-trip-v2`, `session-growth`, `session-growth-v2`, `agent-switch`) all verify session-correctness within a **single tab** using the sidebar to switch sessions.

Multi-tab testing applies the **same logical scenarios** but switches sessions by opening/closing tabs instead of using the sidebar. This exercises WebSocket reconnection, state re-hydration from the backend, and concurrent tab state.

## Proposed Approach

- Each existing test accepts a `multitab` boolean (default `false`)
- `multitab=false` (default): sidebar switching — unchanged
- `multitab=true`: every "switch to session X" becomes:
  1. Open a new browser tab/page
  2. Navigate to the app URL
  3. Open sidebar → click session X
  4. Confirm session header matches
  5. Run assertions (same as single-tab)
  6. Close the old tab
  7. Continue with the new tab as the active page
- A separate `multi-tab.spec.ts` orchestrator calls all 5 tests with `multitab=true`

## Edge Cases to Think About

1. **Tab lifecycle**: Do we close the old tab before or after asserting? If after, two tabs view the same session simultaneously for a moment — good for catching race conditions but adds complexity.

2. **Session identification**: The session ID from the header must match after each tab open. Opening a fresh tab means a new WebSocket connects, `loadSession` fires, backend sends `session_state` — good coverage of the re-hydration path.

3. **Mid-stream switching**: If a session is actively streaming and we open it in a new tab, does the fresh tab pick up the stream mid-way? The `session_state` handler reconstructs from parts; the `token` WS events after that continue streaming. This is the exact path that had the fragmentation bug.

4. **Concurrent writes**: Two tabs open on the same session, one sends a message. Does the other tab see the update? Backend broadcasts `session_updated` but doesn't re-send `session_state` on turn completion. The other tab would need to poll or the backend needs to broadcast.

5. **Test timeout**: Each tab open adds latency (page load + WS connect + state fetch). For N=10 × 3 cycles, that's 30 tab opens. With ~2s per open, adds 60s. May need higher timeouts.

6. **Archive cleanup**: Archives happen in the active tab. If multi-tab, archives only affect the current tab's state; the other tab's sidebar goes stale. Need to re-fetch after archive.

7. **Agent-switch special case**: Agent switching involves a permission dialog. In a fresh tab, does the permission state persist? Need to verify.

8. **State isolation**: Playwright pages (`page` objects) are isolated contexts. Opening a second `page` gives a fresh browser context (no shared cookies/storage) unless using `browser.newPage()` on the same context. Which one do we want? Same context = shared auth/session storage; different context = fully isolated (closer to real multi-tab).

## Implementation Sketch

```ts
// Helper: switch session via tab instead of sidebar
async function switchToSessionViaTab(
  oldPage: Page,
  browser: Browser,
  label: string,
): Promise<Page> {
  const newPage = await browser.newPage();
  await newPage.goto("/");
  await newPage.locator("[data-testid='session-list']").waitFor();
  // reuse existing sidebar helpers
  const newSidebar = new SidePanel(newPage);
  await newSidebar.reveal();
  await newSidebar.sessionItem(label).click();
  await newPage.waitForTimeout(500);
  await oldPage.close();
  return newPage;
}
```

## Questions for User

1. Same browser context or isolated? (Same context = shared storage, isolated = true multi-tab simulation)
2. Overlap tabs during assertions? (Keep old tab open until assertions pass, then close)
3. Should the multi-tab run be CI-gated (blocking) or informational?
4. Any scenarios from the existing 5 that DON'T make sense with multi-tab?
