/**
 * TextPart
 *
 * Renders text content. During live streaming, content is shown immediately
 * (no artificial typewriter lag). A previous paced-reveal path reset its
 * clock on every token and made new segments feel delayed.
 *
 * Markdown is still used for completed text; while streaming we render plain
 * text to avoid re-parsing markdown on every delta (another source of hitch).
 */

import { useState, useEffect, useRef } from "react";
import { cn } from "../../../lib/utils";
import { Markdown } from "../markdown/Markdown";

interface TextPartProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

export function TextPart({
  content,
  isStreaming,
  className,
}: TextPartProps) {
  const CURSOR_DELAY_MS = 1000;

  // Cursor delay: only show after 1s of no new tokens
  const [cursorVisible, setCursorVisible] = useState(false);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastContentLenRef = useRef(content.length);

  useEffect(() => {
    if (!isStreaming) {
      setCursorVisible(false);
      if (cursorTimerRef.current != null) {
        clearTimeout(cursorTimerRef.current);
        cursorTimerRef.current = null;
      }
      lastContentLenRef.current = content.length;
      return;
    }

    if (content.length > lastContentLenRef.current) {
      setCursorVisible(false);
      lastContentLenRef.current = content.length;
      if (cursorTimerRef.current != null) clearTimeout(cursorTimerRef.current);
      cursorTimerRef.current = setTimeout(() => {
        cursorTimerRef.current = null;
        setCursorVisible(true);
      }, CURSOR_DELAY_MS);
    }

    return () => {
      if (cursorTimerRef.current != null) {
        clearTimeout(cursorTimerRef.current);
        cursorTimerRef.current = null;
      }
    };
  }, [content, isStreaming]);

  if (!content && !isStreaming) return null;

  const showCursor = isStreaming && cursorVisible;

  return (
    <div
      className={cn(
        "text-sm leading-relaxed text-zinc-200 whitespace-pre-wrap break-words",
        className
      )}
    >
      {content ? (
        isStreaming ? (
          // Plain text during streaming to avoid re-parsing markdown on every delta
          <span className="whitespace-pre-wrap break-words">{content}</span>
        ) : (
          // Markdown for completed text (re-parsed once on stream end)
          <Markdown content={content} />
        )
      ) : isStreaming ? (
        "\u200B"
      ) : null}
      {showCursor && (
        <span className="inline-block w-[2px] h-[1em] bg-zinc-400 ml-0.5 animate-pulse align-middle" />
      )}
    </div>
  );
}
