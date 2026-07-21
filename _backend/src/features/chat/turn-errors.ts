import type { Message, MessagePartType } from "../../../../_shared/types";
import type { LlmErrorInfo } from "../../llm/errors";

export function buildErrorAssistantMessage(
  errInfo: LlmErrorInfo,
  meta: {
    modelName?: string;
    providerName?: string;
    durationMs?: number;
    turnId?: number;
    priorContent?: string;
  }
): Message {
  const errPart: MessagePartType = {
    type: "error",
    message: errInfo.message,
    raw: errInfo.isCustom ? errInfo.raw : undefined,
    isCustom: errInfo.isCustom,
  } as MessagePartType;
  const content = meta.priorContent
    ? `${meta.priorContent}\n\n[Error: ${errInfo.message}]`
    : `[Error: ${errInfo.message}]`;
  return {
    role: "assistant",
    content,
    parts: [errPart],
    timestamp: new Date().toISOString(),
    turnId: meta.turnId,
    modelName: meta.modelName,
    providerName: meta.providerName,
    durationMs: meta.durationMs,
    success: false,
    errorDetail: {
      message: errInfo.message,
      raw: errInfo.isCustom ? errInfo.raw : undefined,
      isCustom: errInfo.isCustom,
    },
  } as Message;
}
