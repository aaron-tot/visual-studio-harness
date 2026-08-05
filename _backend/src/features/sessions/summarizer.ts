import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { loadConfig } from "../../storage/config";
import type { Provider } from "../../storage/config";

const DEFAULT_SUMMARIZATION_PROMPT = [
  "You are a meticulous summarizer. Read the user and agent turns below and produce a concise, faithful",
  "summary that preserves key decisions, findings, and open questions. Keep it tight and skimmable.",
].join(" ");

// Split a stored "Provider/Model" string into { providerName, modelName }.
export const splitModelRef = (ref?: string | null): { providerName: string; modelName: string } | null => {
  if (!ref) return null;
  const idx = ref.indexOf("/");
  if (idx <= 0 || idx === ref.length - 1) return null;
  return { providerName: ref.slice(0, idx), modelName: ref.slice(idx + 1) };
};

// Try to read a summarization prompt. The value is either a file path (the
// stored promptPath) or inline content (when the user edits it in the test
// modal). If a file exists at the path, read its contents; otherwise treat
// the value as inline prompt content.
export async function readSummarizationPrompt(promptRef?: string | null): Promise<string | null> {
  if (!promptRef) return null;
  try {
    const info = await stat(promptRef);
    const target = info.isDirectory() ? join(promptRef, "prompt.md") : promptRef;
    const raw = await readFile(target, "utf-8");
    return raw.trim() || null;
  } catch {
    // Not a readable file path → treat as inline prompt content.
    const inline = promptRef.trim();
    return inline || null;
  }
}

export interface SummarizerModel {
  provider: Provider;
  model: Provider["models"][0];
}

export interface SummarizerResult {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    reasoningTokens?: number;
  } | null;
}

export async function runSummarizer(
  dataDir: string,
  opts: {
    promptMd?: string | null;
    modelRef?: string | null;
    fallbackModelRef?: string | null;
    messages: { role: "user" | "assistant"; content: string }[];
    sessionId?: string;
    workspaceRoot?: string;
  }
): Promise<SummarizerResult> {
  const config = await loadConfig(dataDir);
  const providers = config.providers ?? [];

  const modelRef = splitModelRef(opts.modelRef);
  const fallbackRef = splitModelRef(opts.fallbackModelRef);
  const promptContent = (await readSummarizationPrompt(opts.promptMd)) ?? DEFAULT_SUMMARIZATION_PROMPT;

  const resolveRef = (ref: { providerName: string; modelName: string } | null): SummarizerModel | null => {
    if (!ref) return null;
    const provider = providers.find((p) => p.displayName === ref.providerName && p.enabled !== false) ??
      providers.find((p) => p.enabled !== false);
    if (!provider) return null;
    const model = provider.models.find(
      (m) => m.displayName === ref.modelName && m.enabled !== false,
    ) ?? provider.models.find((m) => m.enabled !== false);
    if (!model) return null;
    return { provider, model };
  };

  const primary = resolveRef(modelRef);
  const fallback = resolveRef(fallbackRef);
  if (!primary) {
    throw new Error("No summarization model configured");
  }

  const instructions = promptContent + "\n\n" +
    "You are summarizing a past conversation. You have no tools. Output only a plain-text summary.";

  const makeSdkProvider = (p: Provider) => {
    if (p.displayName === "Test") return null;
    return createOpenAICompatible({
      baseURL: p.baseUrl,
      apiKey: p.apiKey || "no-key",
      headers: p.headers,
      name: p.displayName,
    });
  };

  const streamFrom = async (prov: Provider, mdl: Provider["models"][0]): Promise<{ text: string; usage: SummarizerResult["usage"] }> => {
    const sdk = makeSdkProvider(prov);
    if (!sdk) {
      return { text: "[Test model — no streaming preview applicable]", usage: null };
    }

    let fullText = "";
    let finalUsage: SummarizerResult["usage"] = null;

    const result = streamText({
      model: sdk(mdl.modelName),
      instructions,
      messages: opts.messages,
      maxRetries: 0,
    });

    for await (const event of result.fullStream) {
      if (event.type === "text-delta") {
        const text = "text" in event ? (event as { text?: string }).text : "";
        if (text) fullText += text;
      } else if (event.type === "error") {
        const err = "error" in event ? (event as { error?: unknown }).error : undefined;
        throw err instanceof Error ? err : new Error(String(err));
      } else if (event.type === "finish") {
        finalUsage = event.usage
          ? {
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              totalTokens: event.usage.totalTokens,
              reasoningTokens: event.usage.reasoningTokens,
            }
          : null;
      }
    }

    return { text: fullText, usage: finalUsage };
  };

  try {
    return await streamFrom(primary.provider, primary.model);
  } catch (primaryErr) {
    if (fallback) {
      const fbSdk = makeSdkProvider(fallback.provider);
      if (fbSdk) {
        console.warn(`[summarizer] Primary model failed, falling back: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}`);
        return await streamFrom(fallback.provider, fallback.model);
      }
      throw primaryErr;
    }
    throw primaryErr;
  }
}

export function buildSummarizationMessages(
  priorSummary: string | null,
  turns: { role: "user" | "assistant"; content: string }[]
): { role: "user" | "assistant"; content: string }[] {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  if (priorSummary) {
    messages.push({ role: "user", content: `Previous summary:\n${priorSummary}` });
  }
  messages.push(...turns);
  return messages;
}
