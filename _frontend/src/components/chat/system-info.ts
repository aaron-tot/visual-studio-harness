import type { MessagePartType } from "../../../_shared/types";

/** True for a persisted `additional_system_info` injection (context, not a tool). */
export function isAdditionalSystemInfoPart(part: MessagePartType): boolean {
  if (part.type !== "tool") return false;
  const p = part as any;
  return p.toolName === "additional_system_info" || p.additionalSystemInfo === true || p.kind === "system-info";
}

/** Extracts the verbatim volatile content from an additional_system_info part. */
export function extractSystemInfoContent(part: MessagePartType): string {
  const p = part as any;
  if (typeof p.content === "string") return p.content;
  if (typeof p.result === "string") return p.result;
  if (p.result && typeof p.result === "object") {
    const v = (p.result as any).value;
    if (typeof v === "string") return v;
  }
  return "";
}
