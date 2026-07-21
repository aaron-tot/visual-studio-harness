import { TEST_RESPONSE } from "./shared";
import type { AsyncGenerator } from "../../../../_shared/types";

export async function* stream(speed: number, signal?: AbortSignal): AsyncGenerator<any> {
  const words = TEST_RESPONSE.split(" ");
  for (let i = 0; i < words.length; i++) {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const chunk = i === 0 ? words[i] : " " + words[i];
    yield { type: "text-delta", text: chunk, delta: chunk };
    await new Promise((r) => setTimeout(r, speed * 2));
  }
}
