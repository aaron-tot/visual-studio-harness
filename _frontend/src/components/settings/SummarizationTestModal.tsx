import { useEffect, useRef, useState, useMemo } from "react";
import { X, Play, Loader2, Eye, EyeOff, Edit3 } from "lucide-react";
import { streamSummarizationTest, readMd } from "../../lib/api";

const STORAGE_KEY = "vsh:summarization-test-messages";

function loadSaved(): { userMessage: string; agentMessage: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { userMessage: "", agentMessage: "" };
}

function saveMessages(userMessage: string, agentMessage: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ userMessage, agentMessage }));
  } catch { /* ignore */ }
}

function countTokens(text: string): number {
  // Rough approximation: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

interface SummarizationTestModalProps {
  sessionId?: string;
  workspaceRoot?: string;
  model?: string;
  fallbackModel?: string;
  promptMd?: string;
  onClose: () => void;
}

export function SummarizationTestModal({
  sessionId,
  workspaceRoot,
  model,
  fallbackModel,
  promptMd,
  onClose,
}: SummarizationTestModalProps) {
  const saved = loadSaved();
  const [userMessage, setUserMessage] = useState(saved.userMessage);
  const [agentMessage, setAgentMessage] = useState(saved.agentMessage);
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [promptEditorContent, setPromptEditorContent] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const loadPromptContent = async () => {
    if (promptMd && !promptEditorContent) {
      try {
        const result = await readMd(sessionId || "", promptMd);
        setPromptEditorContent(result.content);
      } catch {
        setPromptEditorContent(promptMd);
      }
    }
  };

  useEffect(() => {
    loadPromptContent();
  }, [showPromptEditor, promptMd, sessionId, workspaceRoot]);

  useEffect(() => {
    saveMessages(userMessage, agentMessage);
  }, [userMessage, agentMessage]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const run = async () => {
    if (running) {
      abortRef.current?.abort();
      setRunning(false);
      return;
    }
    setOutput("");
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamSummarizationTest(
        {
          sessionId,
          workspaceRoot,
          userMessage: userMessage || undefined,
          agentMessage: agentMessage || undefined,
          model,
          fallbackModel,
          promptMd: promptEditorContent || promptMd,
        },
        (chunk) => setOutput((prev) => prev + chunk),
        controller.signal,
      );
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setOutput((prev) => prev + `\n[Error: ${err instanceof Error ? err.message : String(err)}]`);
      }
    } finally {
      setRunning(false);
    }
  };

  const userChars = userMessage.length;
  const userTokens = countTokens(userMessage);
  const agentChars = agentMessage.length;
  const agentTokens = countTokens(agentMessage);
  const totalChars = userChars + agentChars;
  const totalTokens = userTokens + agentTokens;

  const outputChars = output.length;
  const outputTokens = countTokens(output);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={onClose}
    >
      <div
        className="flex h-full w-full max-w-3xl flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
          <div>
            <div className="text-sm font-medium text-zinc-100">Test Summarization</div>
            <div className="text-[10px] text-zinc-500">
              Preview how a summary would turn out with your current settings
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={(!userMessage.trim() && !agentMessage.trim()) || running}
              className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-3 py-1.5 text-[11px] text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
            >
              {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {running ? "Stop" : "Summarize"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 p-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-300">User message</label>
            <textarea
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              placeholder="Enter a fake user message…"
              className="w-full min-h-[80px] rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600"
            />
            <div className="flex items-center gap-3 text-[10px] text-zinc-500">
              <span>{userChars} chars / {userTokens} tokens</span>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-300">Agent (assistant) message</label>
            <textarea
              value={agentMessage}
              onChange={(e) => setAgentMessage(e.target.value)}
              placeholder="Enter a fake agent response…"
              className="w-full min-h-[80px] rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600"
            />
            <div className="flex items-center gap-3 text-[10px] text-zinc-500">
              <span>{agentChars} chars / {agentTokens} tokens</span>
            </div>
          </div>

          {/* Model summary */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
            <span className="rounded bg-zinc-800 px-2 py-0.5">{model ? `Model: ${model}` : "Model: none"}</span>
            {fallbackModel && (
              <span className="rounded bg-zinc-800 px-2 py-0.5">Fallback: {fallbackModel}</span>
            )}
            {promptEditorContent && (
              <span className="rounded bg-zinc-800 px-2 py-0.5 cursor-help" title={promptEditorContent}>
                {promptEditorContent.length > 60 ? promptEditorContent.slice(0, 57) + "…" : promptEditorContent}
              </span>
            )}
            {!promptEditorContent && promptMd && (
              <span className="rounded bg-zinc-800 px-2 py-0.5">Prompt file set (click View)</span>
            )}
            <span className="ml-auto rounded bg-zinc-800 px-2 py-0.5">Total: {totalChars} chars / {totalTokens} tokens</span>
          </div>

          {/* Prompt view/edit */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300">Summarization prompt</label>
              <div className="flex items-center gap-1.5">
                {promptMd && (
                  <button
                    type="button"
                    onClick={() => setShowPromptEditor(!showPromptEditor)}
                    className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
                    title={showPromptEditor ? "View prompt" : "Edit prompt"}
                  >
                    {showPromptEditor ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {showPromptEditor ? "Hide" : "View"}
                  </button>
                )}
                {promptMd && (
                  <button
                    type="button"
                    onClick={() => setShowPromptEditor(true)}
                    className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
                    title="Edit prompt"
                  >
                    <Edit3 className="h-3 w-3" />
                    Edit
                  </button>
                )}
              </div>
            </div>
            {showPromptEditor && (
              <div className="space-y-1">
                <textarea
                  value={promptEditorContent}
                  onChange={(e) => setPromptEditorContent(e.target.value)}
                  placeholder="Enter custom summarization prompt…"
                  className="w-full min-h-[100px] rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPromptEditor(false);
                      setPromptEditorContent("");
                    }}
                    className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPromptEditor(false)}
                    className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-600"
                  >
                    Use for this test
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Streaming output */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300">Result</label>
              <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                <span>{outputChars} chars / {outputTokens} tokens</span>
              </div>
            </div>
            <pre className="max-h-64 w-full overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-200 whitespace-pre-wrap">
              {output || (running ? "Streaming…" : "Run a summary to see the result here.")}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
