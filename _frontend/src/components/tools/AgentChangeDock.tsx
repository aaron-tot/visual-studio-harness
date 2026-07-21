import { useState } from "react";
import { useChatStore } from "../../stores/chat";

export function AgentChangeDock() {
  const prompt = useChatStore((s) => s.agentChangePrompt);
  const respond = useChatStore((s) => s.respondAgentChange);

  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  if (!prompt) return null;

  const target = selectedAgent ?? prompt.suggestedAgent;

  const doSwitch = (action: "switch" | "switch_continue") => {
    if (action === "switch") {
      respond({
        requestId: prompt.requestId,
        sessionId: prompt.sessionId,
        action: "switch",
        agentName: target,
      });
    } else {
      respond({
        requestId: prompt.requestId,
        sessionId: prompt.sessionId,
        action: "switch_continue",
        agentName: target,
        continueMessage: {
          content: `<system>User switched agent from current to ${target}. Read your agent system prompt, follow its instructions, rules, and notes, and now CONTINUE the task.</system>`,
          agentName: target,
        },
      });
    }
  };

  const submit = (action: "continue" | "stop") => {
    respond({
      requestId: prompt.requestId,
      sessionId: prompt.sessionId,
      action,
    });
  };

  const suggestedContinue = prompt.suggestedAction === "continue";

  return (
    <div className="mx-3 mb-2 rounded-lg border border-cyan-700/50 bg-cyan-950/40 px-3 py-2 text-xs text-cyan-100">
      <div className="text-sm font-medium text-cyan-50">
        Agent change suggested
      </div>
      <div className="mt-1 text-cyan-200/80 leading-relaxed">
        {prompt.reason}
      </div>

      <div className="mt-3 space-y-1">
        {prompt.agents.map((agent) => (
          <button
            key={agent.name}
            type="button"
            role="radio"
            aria-checked={agent.name === target}
            className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-xs text-left transition-colors ${
              agent.name === target
                ? "border-cyan-600 bg-cyan-800/30 text-cyan-50"
                : "border-zinc-700/60 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/40"
            }`}
            onClick={() => setSelectedAgent(agent.name)}
          >
            <span
              className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                agent.name === target
                  ? "border-cyan-500 bg-cyan-700"
                  : "border-zinc-600"
              }`}
            >
              {agent.name === target && (
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
              )}
            </span>
            <span className="flex-1">{agent.name}</span>
            {agent.isCurrent && (
              <span className="text-zinc-500">current</span>
            )}
            {agent.name === prompt.suggestedAgent && !agent.isCurrent && (
              <span className="text-cyan-400">suggested</span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-cyan-800/30 pt-3">
        <button
          type="button"
          className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
          onClick={() => doSwitch("switch")}
        >
          Switch to {target} & end turn
        </button>
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${
            suggestedContinue
              ? "bg-cyan-700 text-white hover:bg-cyan-600"
              : "border border-cyan-700/60 text-cyan-200 hover:bg-cyan-900/40"
          }`}
          onClick={() => doSwitch("switch_continue")}
        >
          Switch to {target} & continue
        </button>
        <button
          type="button"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          onClick={() => submit("continue")}
        >
          Decline, continue
        </button>
        <button
          type="button"
          className="rounded-md border border-red-900/60 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950/50"
          onClick={() => submit("stop")}
        >
          Stop turn
        </button>
      </div>
    </div>
  );
}
