import { useState } from "react";
import { putSessionContextConfig, summarizeRange } from "../../lib/api";
import { useChatStore } from "../../stores/chat";
import type { Message } from "../../../../_shared/types";

interface TurnContextMenuProps {
  sessionId: string;
  turnId: number;
  messages: Message[];
  x: number;
  y: number;
  onClose: () => void;
}

/**
 * Right-click context menu for a turn (opened on the empty space of any turn).
 * Offers:
 *  - Set context start to this turn
 *  - Create a summary through this turn (up to but NOT including it), starting
 *    from after the last summary (or session start if none).
 * The summary item shows gating text about the range it would cover and is
 * disabled with a reason when there is nothing to summarize.
 */
export function TurnContextMenu({ sessionId, turnId, messages, x, y, onClose }: TurnContextMenuProps) {
  const setCtxTn = useChatStore((s) => s.setContextFirstTurnNumber);
  const bumpContextConfigVersion = useChatStore((s) => s.bumpContextConfigVersion);
  const [summarizing, setSummarizing] = useState(false);

  // Last summary that ends strictly before this turn. Determines the range start.
  const lastSummaryEnd = messages.reduce<number>((max, m) => {
    if (m.isSummary && m.summaryEndTurn != null && m.summaryEndTurn < turnId) {
      return Math.max(max, m.summaryEndTurn);
    }
    return max;
  }, 0);

  // Summary covering turns (lastSummaryEnd+1 .. turnId-1).
  const rangeStart = lastSummaryEnd + 1;
  const rangeEnd = turnId - 1;
  const canSummarize = rangeStart <= rangeEnd;

  // Match the backend's idempotency rules so the menu only offers a summary when
  // clicking would actually create something new:
  //  - atEnd: a summary already ends AT turnId (the slider position) -> no-op.
  //  - alreadyCovered: a summary already ends at rangeEnd -> exact range exists.
  const atEndCovered = messages.some(
    (m) => m.isSummary && m.summaryEndTurn != null && m.summaryEndTurn === turnId,
  );
  const alreadyCovered = messages.some(
    (m) => m.isSummary && m.summaryEndTurn != null && m.summaryEndTurn === rangeEnd,
  );

  const isDisabled = !canSummarize || atEndCovered || alreadyCovered;

  const summaryReason = !canSummarize
    ? lastSummaryEnd > 0
      ? `Already summarized through turn ${lastSummaryEnd}`
      : "No turns to summarize"
    : atEndCovered
      ? `A summary already ends at turn ${turnId}`
      : alreadyCovered
        ? `Already summarized turns ${rangeStart}–${rangeEnd}`
        : null;

  const doSetContext = () => {
    const tn = turnId >= 2 ? turnId : null;
    setCtxTn(tn);
    putSessionContextConfig(sessionId, {
      firstTurnNumber: tn,
      mode: "manual",
      manualMode: "pinned",
      enabled: true,
    })
      .then(() => bumpContextConfigVersion())
      .catch(() => {});
    onClose();
  };

  const doSummarize = async () => {
    if (isDisabled || summarizing) return;
    setSummarizing(true);
    try {
      await summarizeRange({
        sessionId,
        endTurnNum: turnId,
        includePriorSummary: true,
      });
      // backend pushes session_state; bump version to refresh the line
      bumpContextConfigVersion();
    } catch (e) {
      console.error("[summary context menu] failed", e);
    } finally {
      setSummarizing(false);
    }
    onClose();
  };

  return (
    <div
      className="fixed z-50 bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl py-1 min-w-[240px]"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        className="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors"
        onClick={doSetContext}
      >
        Set context start to turn #{turnId}
      </button>

      <button
        type="button"
        disabled={isDisabled || summarizing}
        className="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors disabled:text-zinc-500 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        onClick={doSummarize}
      >
        {summarizing ? "Summarizing…" : "Create summary through turn #" + turnId}
        <span className="block text-[10px] text-zinc-500 mt-0.5">
          {summarizing
            ? "Generating summary…"
            : !canSummarize
              ? (summaryReason ??
                (lastSummaryEnd > 0 ? `Already summarized through turn ${lastSummaryEnd}` : "No turns to summarize"))
              : `Will summarize turns ${rangeStart}–${rangeEnd}${summaryReason ? ` · ${summaryReason}` : ""}`}
        </span>
      </button>
    </div>
  );
}
