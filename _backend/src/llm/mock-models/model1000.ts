import { mockCountStream } from "./shared";

export async function* stream(speed: number, signal?: AbortSignal): AsyncGenerator<any> {
  yield* mockCountStream(1000, speed, signal);
}
