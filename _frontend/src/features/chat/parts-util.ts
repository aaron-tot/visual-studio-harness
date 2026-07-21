/**
 * Pure helpers for ordered message parts (stream apply + session hydrate).
 * Backend owns durable _seq; these only sort/consolidate for render.
 */
import type { MessagePartType } from "../../../_shared/types";

export function sortParts(parts: MessagePartType[]): MessagePartType[] {
  return [...parts].sort((a, b) => {
    const sa = (a as { _seq?: number })._seq ?? 0;
    const sb = (b as { _seq?: number })._seq ?? 0;
    return sa - sb;
  });
}

export function textContentFromParts(parts: MessagePartType[]): string {
  return parts
    .filter((p): p is MessagePartType & { type: "text"; content: string } => p.type === "text")
    .map((p) => p.content || "")
    .join("");
}

export function maxSeqOf(parts: MessagePartType[]): number {
  let max = 0;
  for (const p of parts) {
    const s = (p as { _seq?: number })._seq;
    if (typeof s === "number" && s > max) max = s;
  }
  return max;
}

/**
 * Merge consecutive text (and consecutive reasoning) parts while preserving
 * interleaving with tools.
 */
export function consolidateTextParts(parts: MessagePartType[]): MessagePartType[] {
  if (!parts.length) return parts;
  const result: MessagePartType[] = [];
  for (const part of parts) {
    const prev = result[result.length - 1];
    if (
      prev &&
      part.type === prev.type &&
      (part.type === "text" || part.type === "reasoning")
    ) {
      result[result.length - 1] = {
        ...prev,
        content: (prev.content || "") + ((part as { content?: string }).content || ""),
      } as MessagePartType;
    } else {
      result.push(part);
    }
  }
  return result;
}

/** Snapshot → ordered streamingParts (backend is source of truth). */
export function partsFromSnapshot(rawParts: MessagePartType[]): {
  streamingParts: MessagePartType[];
  streamingContent: string;
  partSeq: number;
} {
  if (!rawParts.length) {
    return { streamingParts: [], streamingContent: "", partSeq: 0 };
  }
  const ordered = [...rawParts]
    .map((p, i) => ({
      ...p,
      _seq: (p as { _seq?: number })._seq ?? i + 1,
    }))
    .sort((a, b) => (a._seq as number) - (b._seq as number));
  const streamingParts = consolidateTextParts(ordered);
  return {
    streamingParts,
    streamingContent: textContentFromParts(streamingParts),
    partSeq: maxSeqOf(streamingParts),
  };
}
