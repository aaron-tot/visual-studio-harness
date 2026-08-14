import type { MessagePartType } from "../../../../../_shared/types";
import { isAdditionalSystemInfoPart } from "../system-info";

export type GroupedParts = MessagePartType[] | MessagePartType;

/**
 * Groups tool parts by stepIndex (the same parallel step) into batch arrays.
 * Tools with the same stepIndex are grouped together regardless of what
 * other parts appear between them. Items without stepIndex or single tools
 * pass through unchanged. `additional_system_info` injections are context,
 * not tools — they are never batched (they attach to their step's tool(s) in
 * MessageRow instead).
 */
export function groupByStep(parts: MessagePartType[]): GroupedParts[] {
  const out: GroupedParts[] = [];
  const stepBuffers = new Map<number, MessagePartType[]>();

  // First pass: collect all tools by stepIndex
  for (const p of parts) {
    if (p.type === "tool" && p.stepIndex != null && !isAdditionalSystemInfoPart(p)) {
      const buffer = stepBuffers.get(p.stepIndex) || [];
      buffer.push(p);
      stepBuffers.set(p.stepIndex, buffer);
    }
  }

  // Second pass: rebuild output preserving original order
  const seenSteps = new Set<number>();
  for (const p of parts) {
    if (p.type === "tool" && p.stepIndex != null && !isAdditionalSystemInfoPart(p)) {
      if (seenSteps.has(p.stepIndex)) continue;
      seenSteps.add(p.stepIndex);
      const buffer = stepBuffers.get(p.stepIndex)!;
      if (buffer.length > 1) out.push(buffer);
      else out.push(buffer[0]);
    } else {
      out.push(p);
    }
  }
  return out;
}
