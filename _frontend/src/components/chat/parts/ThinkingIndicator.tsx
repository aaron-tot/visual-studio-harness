/**
 * ThinkingIndicator
 *
 * "Thinking..." shimmer shown while waiting for the first response token.
 * Also extracts the first line of reasoning as a revealed heading.
 */

import { useState, useEffect } from "react";

interface ThinkingIndicatorProps {
  reasoning?: string;
}

export function ThinkingIndicator({ reasoning }: ThinkingIndicatorProps) {
  const [dots, setDots] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  const heading = reasoning ? reasoning.split("\n")[0] : null;

  return (
    <div className="flex items-center gap-2 px-1 py-1.5 text-sm text-zinc-400">
      {heading ? (
        <span className="animate-in fade-in slide-in-from-top-0.5 duration-300 text-zinc-300 font-medium">
          {heading}
        </span>
      ) : (
        <>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-500 animate-pulse" />
          <span>Thinking{dots}</span>
        </>
      )}
    </div>
  );
}
