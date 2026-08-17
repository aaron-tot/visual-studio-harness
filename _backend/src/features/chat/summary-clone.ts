/**
 * Shared helper: clone the summarizer's covered context turns into a child
 * (subagent) session so opening the child shows the real context the summarizer
 * consumed. Used by both the manual summarize-range flow and auto compaction so
 * they produce identical child sessions.
 */
import { getDbForDataDir } from "../../db/client";
import { turns, steps, stepParts } from "../../db/schema";

/**
 * Marker provider/model for cloned context turns — they are NOT real LLM
 * calls (0 tokens, no usage), and the chat/usage UI should show that clearly
 * instead of attributing them to the summarizer's provider.
 */
export const CLONE_PROVIDER = "clone";
export const CLONE_MODEL = "cloned-context";

export function cloneRangeTurnsToChild(
  dataDir: string,
  childSessionId: string,
  groups: { userContent: string; assistantContents: string[] }[],
  now: string,
  priorSummaryGroup?: { userContent: string; assistantContents: string[] } | null,
): void {
  const db = getDbForDataDir(dataDir);
  let turnNumber = 1;
  // The previous chain summary (if included) is cloned as a NORMAL turn — its
  // real user message (the prior summarization prompt) + its agent message (the
  // summary text) — exactly like any other turn in the child, not a label.
  const seedGroups = priorSummaryGroup
    ? [priorSummaryGroup, ...groups]
    : groups;
  for (const g of seedGroups) {
    const turn = db
      .insert(turns)
      .values({
        sessionId: childSessionId,
        turnNumber: turnNumber++,
        userContent: g.userContent,
        userTimestamp: now,
        status: "success",
        success: true,
        providerName: CLONE_PROVIDER,
        modelName: CLONE_MODEL,
        startedAt: now,
        completedAt: now,
        stepCount: g.assistantContents.length > 0 ? 1 : 0,
        kind: "turn",
      })
      .returning({ id: turns.id })
      .get();
    if (!turn || g.assistantContents.length === 0) continue;
    const step = db
      .insert(steps)
      .values({
        sessionId: childSessionId,
        turnId: turn.id,
        stepIndex: 0,
        status: "completed",
        providerName: CLONE_PROVIDER,
        modelId: CLONE_MODEL,
        startedAt: now,
        completedAt: now,
      })
      .returning({ id: steps.id })
      .get();
    if (!step) continue;
    let seq = 0;
    for (const content of g.assistantContents) {
      db.insert(stepParts)
        .values({
          sessionId: childSessionId,
          turnId: turn.id,
          stepId: step.id,
          type: "text",
          seq: seq++,
          status: "completed",
          data: JSON.stringify({ content }),
          createdAt: now,
        })
        .run();
    }
  }
}
