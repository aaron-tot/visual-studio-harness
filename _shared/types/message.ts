import type { ToolCallStatus } from "./tools";

export type MessagePartType =
  | { type: "text"; content: string; _seq?: number }
  | { type: "tool"; toolCallId: string; toolName: string; status: ToolCallStatus; args: unknown; result?: unknown; error?: string; parentToolCallId?: string; stepIndex?: number; _seq?: number }
  | { type: "reasoning"; content: string; _seq?: number }
  | { type: "snapshot"; hash: string; _seq?: number }
  | { type: "agent"; name: string; _seq?: number }
  | { type: "step-finish"; cost?: number; tokens?: number; _seq?: number }
  | { type: "file"; filename: string; _seq?: number }
  | { type: "retry"; attempt: number; error?: string; _seq?: number }
  | { type: "subtask"; label: string; _seq?: number }
  | { type: "patch"; files: string[]; hash: string; _seq?: number }
  | { type: "question"; questions: string[]; _seq?: number }
  | { type: "error"; message: string; raw?: string; isCustom?: boolean; _seq?: number };

export interface Message {
  id?: number;
  role: "user" | "assistant" | "system";
  content: string;
  parts?: MessagePartType[];
  timestamp: string;
  agentName?: string;
  providerName?: string;
  modelName?: string;
  durationMs?: number;
  contextTokens?: { used: number; max: number };
  /**
   * Turn identifier for display/context anchoring.
   * - Normal turns: equals the DB turn_number.
   * - Summary turns: set to the summary's END turn (the circle anchor), NOT its
   *   DB turn_number. Kept separate so the UI can anchor the summary between
   *   covered turns while the backend still looks up rows by real turn_number.
   */
  turnId?: number;
  /**
   * The row's REAL DB turn_number. Always set for summary turns so that
   * inspection ({ }), tool-cache lookups etc. resolve to the summary's own DB
   * row instead of misreading turnId (the end-turn anchor) as a turn_number.
   */
  turnNumber?: number;
  success?: boolean;
  status?: string;
  errorDetail?: { message: string; raw?: string; isCustom?: boolean };
}

export interface TurnDebugInfo {
  url: string;
  providerName: string;
  model: string;
  temperature?: number;
  thinkingEffort?: string;
  maxSteps?: number;
  requestBody: Record<string, unknown>;
}

export interface TurnData {
  systemMessage: string;
  messages: Message[];
  success?: boolean;
  debugInfo?: TurnDebugInfo;
}

export type TurnsFile = Record<string, TurnData>;
