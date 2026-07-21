// FAKE DATA ONLY — not connected to backend. Replace later with real session usage.

export type FAKE_UsageStatus = "success" | "error" | "streaming" | "pending";

export interface FAKE_SubagentRef {
  childSessionId: string;
  taskLabel: string;
  kind: "spawn" | "resume";
  childTurnNumber: number;
  session: FAKE_UsageSession;
}

export interface FAKE_UsageStep {
  stepIndex: number;
  status: FAKE_UsageStatus;
  finishReason: string;
  rawFinishReason: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inclusiveTotalTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  noCacheInputTokens: number;
  stepTimeMs: number;
  responseTimeMs: number;
  timeToFirstOutputMs: number;
  outputTps: number;
  inputTps: number;
  effectiveOutputTps: number;
  modelId: string;
  responseModelId: string;
  providerName: string;
  responseId: string;
  subagent?: FAKE_SubagentRef;
}

export interface FAKE_UsageTurn {
  /** Stable turn id (maps to turns.id in live data). FAKE string/number. */
  turnId: string;
  turnNumber: number;
  status: FAKE_UsageStatus;
  userContentPreview: string;
  modelName: string;
  providerName: string;
  agentName: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inclusiveTotalTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  stepCount: number;
  success: boolean;
  finishReason: string;
  /** Prior turn numbers in this session fed as model input (turn_context). */
  contextTurnNumbers: number[];
  errorMessage: string | null;
  steps: FAKE_UsageStep[];
}

export interface FAKE_UsageSession {
  sessionId: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inclusiveTotalTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  turnCount: number;
  stepCount: number;
  durationMs: number;
  turns: FAKE_UsageTurn[];
}

const FAKE_CHILD_SESSION_B: FAKE_UsageSession = {
  sessionId: "FAKE-session-child-code",
  label: "FAKE Code Agent",
  inputTokens: 200,
  outputTokens: 100,
  totalTokens: 300,
  inclusiveTotalTokens: 300,
  reasoningTokens: 5,
  cacheReadTokens: 40,
  cacheWriteTokens: 0,
  turnCount: 1,
  stepCount: 1,
  durationMs: 3750,
  turns: [
    {
      turnId: "FAKE-turn-child-code-1",
      turnNumber: 1,
      status: "success",
      userContentPreview: "FAKE: implement the code change",
      modelName: "FAKE-model-2000",
      providerName: "FAKE-Other",
      agentName: "FAKE-Agent-Beta",
      durationMs: 3750,
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
      inclusiveTotalTokens: 300,
      reasoningTokens: 5,
      cacheReadTokens: 40,
      cacheWriteTokens: 0,
      stepCount: 1,
      success: true,
      finishReason: "stop",
      contextTurnNumbers: [],
      errorMessage: null,
      steps: [
        {
          stepIndex: 0,
          status: "success",
          finishReason: "stop",
          rawFinishReason: "stop",
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
          inclusiveTotalTokens: 300,
          reasoningTokens: 5,
          cacheReadTokens: 40,
          cacheWriteTokens: 0,
          noCacheInputTokens: 160,
          stepTimeMs: 3700,
          responseTimeMs: 3750,
          timeToFirstOutputMs: 500,
          outputTps: 27.0,
          inputTps: 54.1,
          effectiveOutputTps: 26.7,
          modelId: "FAKE-model-2000",
          responseModelId: "FAKE-model-2000",
          providerName: "FAKE-Other",
          responseId: "FAKE-response-child-b-step0",
        },
      ],
    },
  ],
};

const FAKE_CHILD_SESSION_A: FAKE_UsageSession = {
  sessionId: "FAKE-session-child-research",
  label: "FAKE Research Agent",
  inputTokens: 300,
  outputTokens: 200,
  totalTokens: 500,
  inclusiveTotalTokens: 800,
  reasoningTokens: 20,
  cacheReadTokens: 60,
  cacheWriteTokens: 40,
  turnCount: 1,
  stepCount: 2,
  durationMs: 12182,
  turns: [
    {
      turnId: "FAKE-turn-child-research-1",
      turnNumber: 1,
      status: "success",
      userContentPreview: "FAKE: research the topic deeply",
      modelName: "FAKE-model-1000",
      providerName: "FAKE-Test",
      agentName: "FAKE-Agent-Alpha",
      durationMs: 12182,
      inputTokens: 300,
      outputTokens: 200,
      totalTokens: 500,
      inclusiveTotalTokens: 800,
      reasoningTokens: 20,
      cacheReadTokens: 60,
      cacheWriteTokens: 40,
      stepCount: 2,
      success: true,
      finishReason: "tool_calls",
      contextTurnNumbers: [],
      errorMessage: null,
      steps: [
        {
          stepIndex: 0,
          status: "success",
          finishReason: "stop",
          rawFinishReason: "stop",
          inputTokens: 150,
          outputTokens: 100,
          totalTokens: 250,
          inclusiveTotalTokens: 250,
          reasoningTokens: 10,
          cacheReadTokens: 20,
          cacheWriteTokens: 20,
          noCacheInputTokens: 130,
          stepTimeMs: 3200,
          responseTimeMs: 3450,
          timeToFirstOutputMs: 600,
          outputTps: 31.2,
          inputTps: 46.9,
          effectiveOutputTps: 29.0,
          modelId: "FAKE-model-1000",
          responseModelId: "FAKE-model-1000",
          providerName: "FAKE-Test",
          responseId: "FAKE-response-child-a-step0",
        },
        {
          stepIndex: 1,
          status: "success",
          finishReason: "tool_calls",
          rawFinishReason: "tool_calls",
          inputTokens: 150,
          outputTokens: 100,
          totalTokens: 250,
          inclusiveTotalTokens: 550,
          reasoningTokens: 10,
          cacheReadTokens: 40,
          cacheWriteTokens: 20,
          noCacheInputTokens: 110,
          stepTimeMs: 4900,
          responseTimeMs: 4982,
          timeToFirstOutputMs: 800,
          outputTps: 20.4,
          inputTps: 30.6,
          effectiveOutputTps: 20.1,
          modelId: "FAKE-model-1000",
          responseModelId: "FAKE-model-1000",
          providerName: "FAKE-Test",
          responseId: "FAKE-response-child-a-step1",
          subagent: {
            childSessionId: "FAKE-session-child-code",
            taskLabel: "FAKE: Implement the code",
            kind: "spawn",
            childTurnNumber: 1,
            session: FAKE_CHILD_SESSION_B,
          },
        },
      ],
    },
  ],
};

export const FAKE_USAGE_TREE: FAKE_UsageSession = {
  sessionId: "FAKE-session-2026-07-18",
  label: "FAKE Session",
  inputTokens: 1050,
  outputTokens: 280,
  totalTokens: 1330,
  inclusiveTotalTokens: 2130,
  reasoningTokens: 40,
  cacheReadTokens: 320,
  cacheWriteTokens: 90,
  turnCount: 3,
  stepCount: 5,
  durationMs: 49371,
  turns: [
    {
      turnId: "FAKE-turn-main-1",
      turnNumber: 1,
      status: "success",
      userContentPreview: "FAKE: hi there",
      modelName: "FAKE-model-1000",
      providerName: "FAKE-Test",
      agentName: "FAKE-Agent-Alpha",
      durationMs: 1273,
      inputTokens: 50,
      outputTokens: 20,
      totalTokens: 70,
      inclusiveTotalTokens: 70,
      reasoningTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 15,
      stepCount: 1,
      success: true,
      finishReason: "stop",
      contextTurnNumbers: [],
      errorMessage: null,
      steps: [
        {
          stepIndex: 0,
          status: "success",
          finishReason: "stop",
          rawFinishReason: "stop",
          inputTokens: 50,
          outputTokens: 20,
          totalTokens: 70,
          inclusiveTotalTokens: 70,
          reasoningTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 15,
          noCacheInputTokens: 50,
          stepTimeMs: 1200,
          responseTimeMs: 1273,
          timeToFirstOutputMs: 340,
          outputTps: 16.7,
          inputTps: 41.7,
          effectiveOutputTps: 15.7,
          modelId: "FAKE-model-1000",
          responseModelId: "FAKE-model-1000",
          providerName: "FAKE-Test",
          responseId: "FAKE-response-abc123",
        },
      ],
    },
    {
      turnId: "FAKE-turn-main-2",
      turnNumber: 2,
      status: "success",
      userContentPreview: "FAKE: use the tools to build the thing",
      modelName: "FAKE-model-2000",
      providerName: "FAKE-Test",
      agentName: "FAKE-Agent-Beta",
      durationMs: 4823,
      inputTokens: 400,
      outputTokens: 160,
      totalTokens: 560,
      inclusiveTotalTokens: 1360,
      reasoningTokens: 35,
      cacheReadTokens: 90,
      cacheWriteTokens: 80,
      stepCount: 3,
      success: true,
      finishReason: "tool_calls",
      contextTurnNumbers: [1],
      errorMessage: null,
      steps: [
        {
          stepIndex: 0,
          status: "success",
          finishReason: "stop",
          rawFinishReason: "stop",
          inputTokens: 100,
          outputTokens: 40,
          totalTokens: 140,
          inclusiveTotalTokens: 140,
          reasoningTokens: 10,
          cacheReadTokens: 20,
          cacheWriteTokens: 25,
          noCacheInputTokens: 80,
          stepTimeMs: 1800,
          responseTimeMs: 1850,
          timeToFirstOutputMs: 420,
          outputTps: 22.2,
          inputTps: 55.6,
          effectiveOutputTps: 21.6,
          modelId: "FAKE-model-2000",
          responseModelId: "FAKE-model-2000",
          providerName: "FAKE-Test",
          responseId: "FAKE-response-def456",
        },
        {
          stepIndex: 1,
          status: "success",
          finishReason: "tool_calls",
          rawFinishReason: "tool_calls",
          inputTokens: 160,
          outputTokens: 80,
          totalTokens: 240,
          inclusiveTotalTokens: 1040,
          reasoningTokens: 15,
          cacheReadTokens: 30,
          cacheWriteTokens: 35,
          noCacheInputTokens: 130,
          stepTimeMs: 1200,
          responseTimeMs: 1250,
          timeToFirstOutputMs: 280,
          outputTps: 66.7,
          inputTps: 133.3,
          effectiveOutputTps: 64.0,
          modelId: "FAKE-model-2000",
          responseModelId: "FAKE-model-2000",
          providerName: "FAKE-Test",
          responseId: "FAKE-response-ghi789",
          subagent: {
            childSessionId: "FAKE-session-child-research",
            taskLabel: "FAKE: Research the topic",
            kind: "spawn",
            childTurnNumber: 1,
            session: FAKE_CHILD_SESSION_A,
          },
        },
        {
          stepIndex: 2,
          status: "success",
          finishReason: "stop",
          rawFinishReason: "stop",
          inputTokens: 140,
          outputTokens: 40,
          totalTokens: 180,
          inclusiveTotalTokens: 180,
          reasoningTokens: 10,
          cacheReadTokens: 40,
          cacheWriteTokens: 20,
          noCacheInputTokens: 100,
          stepTimeMs: 1600,
          responseTimeMs: 1723,
          timeToFirstOutputMs: 510,
          outputTps: 25.0,
          inputTps: 87.5,
          effectiveOutputTps: 23.2,
          modelId: "FAKE-model-2000",
          responseModelId: "FAKE-model-2000",
          providerName: "FAKE-Test",
          responseId: "FAKE-response-jkl012",
        },
      ],
    },
    {
      turnId: "FAKE-turn-main-3",
      turnNumber: 3,
      status: "error",
      userContentPreview: "FAKE: run the deployment script",
      modelName: "FAKE-model-1000",
      providerName: "FAKE-Test",
      agentName: "FAKE-Agent-Alpha",
      durationMs: 43275,
      inputTokens: 600,
      outputTokens: 100,
      totalTokens: 700,
      inclusiveTotalTokens: 700,
      reasoningTokens: 0,
      cacheReadTokens: 230,
      cacheWriteTokens: 20,
      stepCount: 1,
      success: false,
      finishReason: "error",
      contextTurnNumbers: [1, 2],
      errorMessage: "FAKE-error: deployment script timed out after 43s",
      steps: [
        {
          stepIndex: 0,
          status: "error",
          finishReason: "error",
          rawFinishReason: "content_filter",
          inputTokens: 600,
          outputTokens: 100,
          totalTokens: 700,
          inclusiveTotalTokens: 700,
          reasoningTokens: 0,
          cacheReadTokens: 230,
          cacheWriteTokens: 20,
          noCacheInputTokens: 370,
          stepTimeMs: 43200,
          responseTimeMs: 43275,
          timeToFirstOutputMs: 3200,
          outputTps: 2.3,
          inputTps: 13.9,
          effectiveOutputTps: 2.3,
          modelId: "FAKE-model-1000",
          responseModelId: "FAKE-model-1000",
          providerName: "FAKE-Test",
          responseId: "FAKE-response-mno345",
        },
      ],
    },
  ],
};
