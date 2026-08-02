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

export interface CapturedExchange {
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
}

export function createVerboseFetch(): {
  fetch: typeof fetch;
  captureDone: Promise<void>;
  getResponse: () => Record<string, unknown> | undefined;
  getRequest: () => Record<string, unknown> | undefined;
  getExchanges: () => CapturedExchange[];
} {
  const MAX_CAPTURE_SIZE_BYTES = 500 * 1024; // 500 KB (reduced from 10 MB to lower memory per turn)
  let rawRequest: Record<string, unknown> | undefined;
  let rawResponse: Record<string, unknown> | undefined;
  const exchanges: CapturedExchange[] = [];
  let resolveCapture!: () => void;
  let settled = false;
  let captureSizeBytes = 0;
  let captureOversized = false;
  const captureDone = new Promise<void>((r) => { resolveCapture = () => { if (!settled) { settled = true; r(); } }; });

  const verboseFetch: typeof fetch = async (input, init) => {
    // Capture the exact HTTP request body the SDK sends
    const exchange: CapturedExchange = {};
    if (init && typeof init.body === "string") {
      try {
        exchange.request = JSON.parse(init.body);
      } catch {}
    }
    const res = await fetch(input, { ...init, verbose: true } as RequestInit & { verbose: boolean });
    if (!res.body) return res;

    const chunks: Uint8Array[] = [];

    const finishCapture = () => {
      if (captureOversized) {
        exchange.response = { object: "chat.completion", _capture: "truncated (exceeded 500 KB)" } as Record<string, unknown>;
      } else {
        try {
          const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
          const combined = new Uint8Array(totalLen);
          let offset = 0;
          for (const c of chunks) { combined.set(c, offset); offset += c.length; }
          exchange.response = parseCapturedBody(new TextDecoder().decode(combined));
        } catch {}
      }
      if (exchange.request !== undefined) rawRequest = exchange.request;
      if (exchange.response !== undefined) rawResponse = exchange.response;
      exchanges.push(exchange);
      resolveCapture();
    };

    const capture = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (chunk?.byteLength) {
          captureSizeBytes += chunk.byteLength;
          if (!captureOversized && captureSizeBytes <= MAX_CAPTURE_SIZE_BYTES) {
            chunks.push(chunk);
          } else {
            captureOversized = true;
          }
        }
        controller.enqueue(chunk);
      },
      flush() { finishCapture(); },
      cancel() { finishCapture(); },
    });

    return new Response(res.body.pipeThrough(capture), {
      status: res.status, statusText: res.statusText, headers: res.headers,
    });
  };

  return { fetch: verboseFetch, captureDone, getResponse: () => rawResponse, getRequest: () => rawRequest, getExchanges: () => exchanges };
}
