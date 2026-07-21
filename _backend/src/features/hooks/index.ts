export type {
  HookContext,
  HookHandlerResult,
  HookRegisterOptions,
  EmitInterceptOutcome,
  HookKind,
  HookStatus,
  HookSource,
} from "./types";
export { DEFAULT_HOOK_PRIORITY } from "./types";

export type { HookName, HookPayloadMap } from "./events";
export type {
  MessageReceivedPayload,
  MessageUserPersistedPayload,
  TurnStartPayload,
  TurnCompletePayload,
  TurnErrorPayload,
  StreamStartPayload,
  StreamChunkPayload,
  StreamEndPayload,
  ToolBeforePayload,
  ToolAfterPayload,
  ToolErrorPayload,
  SessionAbortPayload,
} from "./events";

export {
  HOOK_CATALOG,
  getCatalogEntry,
  isActiveHook,
  isInterceptHook,
  listActiveHooks,
  listReservedHooks,
} from "./catalog";

export { buildHookContext, withHookContext } from "./context";
export type { BuildHookContextInput } from "./context";

export { HookBus, createHookBus } from "./bus";
export type { HookHandler } from "./bus";

export { registerBuiltInHandlers } from "./handlers";
export { registerLoggingHandler } from "./handlers/logging";

export {
  createHooksSystem,
  setHooksSystem,
  getHooksSystem,
  requireHooks,
} from "./system";
export type { HooksSystem } from "./system";

export { getBus } from "./get-bus";
