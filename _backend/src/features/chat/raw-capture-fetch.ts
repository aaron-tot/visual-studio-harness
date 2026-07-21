export function parseCapturedBody(rawText: string): Record<string, unknown> {
  try {
    return JSON.parse(rawText);
  } catch {
    const sseChunks: unknown[] = [];
    let lastUsage: Record<string, unknown> | null = null;
    let lastMeta: Record<string, unknown> = {};
    for (const line of rawText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        if (parsed.model) lastMeta.model = parsed.model;
        if (parsed.provider) lastMeta.provider = parsed.provider;
        if (parsed.id) lastMeta.id = parsed.id;
        if (parsed.usage) lastUsage = parsed.usage;
        if (parsed.choices?.length) sseChunks.push(parsed);
      } catch {}
    }
    return {
      ...lastMeta,
      object: "chat.completion (streamed)",
      stream_chunks: sseChunks,
      ...(lastUsage ? { usage: lastUsage } : {}),
    };
  }
}

export function createVerboseFetch(): { fetch: typeof fetch; captureDone: Promise<void>; getResponse: () => Record<string, unknown> | undefined } {
  let rawResponse: Record<string, unknown> | undefined;
  let resolveCapture!: () => void;
  let settled = false;
  const captureDone = new Promise<void>((r) => { resolveCapture = () => { if (!settled) { settled = true; r(); } }; });

  const verboseFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, { ...init, verbose: true } as RequestInit & { verbose: boolean });
    if (!res.body) return res;

    const chunks: Uint8Array[] = [];

    const finishCapture = () => {
      try {
        const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
        const combined = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) { combined.set(c, offset); offset += c.length; }
        rawResponse = parseCapturedBody(new TextDecoder().decode(combined));
      } catch {} finally { resolveCapture(); }
    };

    const capture = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (chunk?.byteLength) chunks.push(chunk);
        controller.enqueue(chunk);
      },
      flush() { finishCapture(); },
      cancel() { finishCapture(); },
    });

    return new Response(res.body.pipeThrough(capture), {
      status: res.status, statusText: res.statusText, headers: res.headers,
    });
  };

  return { fetch: verboseFetch, captureDone, getResponse: () => rawResponse };
}
