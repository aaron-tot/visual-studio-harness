import type { AsyncGenerator } from "../../../../_shared/types";

const FAIL_MSG = "Streaming response failed";

/**
 * Streams a partial token then THROWS — simulates a genuine SDK stream
 * failure where the underlying stream errors and the fullStream iterator throws.
 */
export async function* stream(): AsyncGenerator<any> {
  yield { type: "text-delta", text: "partial " };
  throw new Error(FAIL_MSG);
}

/**
 * Yields an `error` event instead of throwing — some SDK surfaces report
 * mid-stream failures as a stream part rather than throwing out of the iterator.
 */
export async function* streamEvent(): AsyncGenerator<any> {
  yield { type: "text-delta", text: "partial " };
  yield { type: "error", error: new Error(FAIL_MSG) };
}
