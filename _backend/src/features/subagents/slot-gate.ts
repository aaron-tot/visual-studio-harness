import type { ProviderConfig, SlotBusyPolicy } from "../../../../_shared/types";
import {
  probeServerSlots,
  sleep,
  type SlotProbeResult,
} from "../../llm/slots";
import type { SlotBusyResponse } from "./slot-busy-wait";
import {
  registerSlotWaitForce,
  unregisterSlotWaitForce,
} from "./slot-wait-control";

export interface SlotGateSettings {
  policy: SlotBusyPolicy;
  pollIntervalSec: number;
  waitTimeoutSec: number;
}

export interface SlotGateContext {
  provider: ProviderConfig;
  signal?: AbortSignal;
  settings: SlotGateSettings;
  /** Parent tool call id for UI */
  toolCallId?: string;
  requestId: string;
  /**
   * Ask user: wait / fail / cancel.
   * Required when policy is "ask".
   */
  askUser?: (info: {
    requestId: string;
    toolCallId?: string;
    probe: SlotProbeResult;
    baseUrl: string;
  }) => Promise<SlotBusyResponse>;
  onStatus?: (info: { requestId: string; message: string }) => void;
  /** Fired when enter wait/poll loop (UI can show Force timeout). */
  onWaitStart?: (info: {
    requestId: string;
    toolCallId?: string;
    detail: string;
    free: number;
    total: number;
    modelAlias?: string;
    pollIntervalSec: number;
    waitTimeoutSec: number;
  }) => void;
  /** Fired when leave wait loop (success, fail, or force). */
  onWaitEnd?: (info: { requestId: string }) => void;
}

function noSlotsError(probe: SlotProbeResult | null): string {
  const detail = probe?.detail ?? "no free slots";
  return (
    `LLM server has no free slots (${detail}). ` +
    `Try again later when a slot is free.`
  );
}

export type SlotGateOutcome =
  | { ok: true; probe: SlotProbeResult | null; waitedMs: number }
  | { ok: false; error: string; probe: SlotProbeResult | null };

const DEFAULT_POLL_SEC = 5;
const DEFAULT_WAIT_TIMEOUT_SEC = 300;

export function normalizeSlotGateSettings(input?: {
  slotBusyPolicy?: SlotBusyPolicy;
  slotPollIntervalSec?: number;
  slotWaitTimeoutSec?: number;
}): SlotGateSettings {
  const policy = input?.slotBusyPolicy ?? "ask";
  const pollIntervalSec = Math.max(
    1,
    input?.slotPollIntervalSec ?? DEFAULT_POLL_SEC
  );
  const waitTimeoutSec = Math.max(
    0,
    input?.slotWaitTimeoutSec ?? DEFAULT_WAIT_TIMEOUT_SEC
  );
  return { policy, pollIntervalSec, waitTimeoutSec };
}

/**
 * Ensure a free LLM slot exists before starting a subagent turn.
 * Skips when the provider has no /slots API.
 */
export async function ensureLlmSlotAvailable(
  ctx: SlotGateContext
): Promise<SlotGateOutcome> {
  const baseUrl = ctx.provider.baseUrl;
  let probe = await probeServerSlots(baseUrl, ctx.signal);

  // No slots API (cloud etc.) -> do not block
  if (!probe.supported && !probe.error) {
    return { ok: true, probe, waitedMs: 0 };
  }

  // Server unreachable: surface as busy/fail based on policy
  if (probe.error && probe.free === 0 && probe.total === 0) {
    return handleBusy(ctx, probe, 0);
  }

  if (probe.free > 0) {
    return { ok: true, probe, waitedMs: 0 };
  }

  return handleBusy(ctx, probe, 0);
}

async function handleBusy(
  ctx: SlotGateContext,
  probe: SlotProbeResult,
  alreadyWaitedMs: number
): Promise<SlotGateOutcome> {
  let policy = ctx.settings.policy;
  let pollSec = ctx.settings.pollIntervalSec;
  let timeoutSec = ctx.settings.waitTimeoutSec;

  if (policy === "ask") {
    if (!ctx.askUser) {
      return {
        ok: false,
        probe,
        error:
          `LLM server has no free slots (${probe.detail}). ` +
          `Subagent cannot start (no UI to ask). Set Agents > Subagent slot policy to wait or fail, or free a slot.`,
      };
    }
    ctx.onStatus?.({
      requestId: ctx.requestId,
      message: `Waiting for user: LLM slots busy (${probe.detail})`,
    });
    const decision = await ctx.askUser({
      requestId: ctx.requestId,
      toolCallId: ctx.toolCallId,
      probe,
      baseUrl: ctx.provider.baseUrl,
    });
    if (decision.action === "cancel" || decision.action === "fail") {
      return {
        ok: false,
        probe,
        error:
          decision.action === "cancel"
            ? `Subagent cancelled: ${noSlotsError(probe)}`
            : noSlotsError(probe),
      };
    }
    // wait
    if (decision.pollIntervalSec && decision.pollIntervalSec > 0) {
      pollSec = decision.pollIntervalSec;
    }
    if (decision.waitTimeoutSec !== undefined && decision.waitTimeoutSec >= 0) {
      timeoutSec = decision.waitTimeoutSec;
    }
    policy = "wait";
  }

  if (policy === "fail") {
    return {
      ok: false,
      probe,
      error: noSlotsError(probe),
    };
  }

  // wait + poll
  return waitForFreeSlot(ctx, pollSec, timeoutSec, alreadyWaitedMs, probe);
}

async function waitForFreeSlot(
  ctx: SlotGateContext,
  pollSec: number,
  timeoutSec: number,
  alreadyWaitedMs: number,
  initialProbe: SlotProbeResult
): Promise<SlotGateOutcome> {
  const started = Date.now() - alreadyWaitedMs;
  const deadline =
    timeoutSec > 0 ? started + timeoutSec * 1000 : Number.POSITIVE_INFINITY;

  let lastProbe: SlotProbeResult = initialProbe;
  let forceTimedOut = false;
  const waitAbort = new AbortController();

  const onParentAbort = () => waitAbort.abort();
  ctx.signal?.addEventListener("abort", onParentAbort);

  registerSlotWaitForce(ctx.requestId, () => {
    forceTimedOut = true;
    waitAbort.abort();
  });

  ctx.onWaitStart?.({
    requestId: ctx.requestId,
    toolCallId: ctx.toolCallId,
    detail: initialProbe.detail,
    free: initialProbe.free,
    total: initialProbe.total,
    modelAlias: initialProbe.modelAlias,
    pollIntervalSec: pollSec,
    waitTimeoutSec: timeoutSec,
  });

  ctx.onStatus?.({
    requestId: ctx.requestId,
    message:
      `Waiting for free LLM slot (poll every ${pollSec}s` +
      (timeoutSec > 0 ? `, timeout ${timeoutSec}s` : "") +
      `)...`,
  });

  try {
    while (true) {
      if (forceTimedOut) {
        return { ok: false, probe: lastProbe, error: noSlotsError(lastProbe) };
      }
      if (ctx.signal?.aborted || waitAbort.signal.aborted) {
        if (forceTimedOut) {
          return { ok: false, probe: lastProbe, error: noSlotsError(lastProbe) };
        }
        return {
          ok: false,
          probe: lastProbe,
          error: "Waiting for LLM slot was cancelled",
        };
      }

      const probe = await probeServerSlots(
        ctx.provider.baseUrl,
        waitAbort.signal
      );
      lastProbe = probe;

      if (probe.supported && probe.free > 0) {
        return { ok: true, probe, waitedMs: Date.now() - started };
      }
      // unsupported mid-wait (weird) -> proceed
      if (!probe.supported && !probe.error) {
        return { ok: true, probe, waitedMs: Date.now() - started };
      }

      if (Date.now() >= deadline) {
        return {
          ok: false,
          probe,
          error: noSlotsError(probe),
        };
      }

      ctx.onStatus?.({
        requestId: ctx.requestId,
        message: `LLM slots still busy (${probe.detail}); retrying in ${pollSec}s...`,
      });
      try {
        await sleep(pollSec * 1000, waitAbort.signal);
      } catch {
        if (forceTimedOut) {
          return { ok: false, probe: lastProbe, error: noSlotsError(lastProbe) };
        }
        return {
          ok: false,
          probe: lastProbe,
          error: "Waiting for LLM slot was cancelled",
        };
      }
    }
  } finally {
    unregisterSlotWaitForce(ctx.requestId);
    ctx.signal?.removeEventListener("abort", onParentAbort);
    ctx.onWaitEnd?.({ requestId: ctx.requestId });
  }
}
