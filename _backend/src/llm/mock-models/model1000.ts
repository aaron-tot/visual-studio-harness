import { mockCountStream } from "./shared";
import type { AsyncGenerator } from "../../../../_shared/types";

export async function* stream(speed: number, signal?: AbortSignal): AsyncGenerator<any> {
  yield* mockCountStream(1000, speed, signal);
}
