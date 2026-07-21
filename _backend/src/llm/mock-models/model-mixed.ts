import { mockCountStream } from "./shared";
import type { AsyncGenerator } from "../../../../_shared/types";

export async function* stream(speed: number, signal?: AbortSignal): AsyncGenerator<any> {
  yield* mockCountStream(200, speed, signal);
  yield* mockCountStream(200, speed, signal, { toolAfter: 50 });
  yield* mockCountStream(200, speed, signal, { thinkingAfter: 50, finalAfter: 150 });
}
