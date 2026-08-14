import { mockCountStream } from "./shared";

export async function* stream(speed: number, signal?: AbortSignal): AsyncGenerator<any> {
  yield* mockCountStream(5000, speed, signal);
}
