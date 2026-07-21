import type { Message } from "../../../_shared/types";

interface MessageBubbleProps {
  message: Message;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[70%] rounded-lg px-4 py-2 text-sm ${
          isUser
            ? "bg-zinc-700 text-zinc-100"
            : "bg-zinc-800 text-zinc-300"
        }`}
      >
        {message.content}
      </div>
      <span className="text-xs text-zinc-600 mt-0.5 px-1">
        {formatTime(message.timestamp)}
      </span>
    </div>
  );
}
