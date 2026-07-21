import { useState, useRef, useCallback, useEffect } from "react";

const LAST_USED_KEY = "VISUAL STUDIO HARNESS:snippet-last-used";

function loadLastUsed(): number {
  try {
    return Number(sessionStorage.getItem(LAST_USED_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveLastUsed(idx: number) {
  try {
    sessionStorage.setItem(LAST_USED_KEY, String(idx));
  } catch {}
}

interface UseSnippetMenuOptions {
  onInsert: (idx: number) => void;
  snippetCount: number;
}

export function useSnippetMenu({ onInsert, snippetCount }: UseSnippetMenuOptions) {
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const openRef = useRef(false);
  const scrollAccum = useRef(0);
  const insertRef = useRef(onInsert);
  insertRef.current = onInsert;
  const countRef = useRef(snippetCount);
  countRef.current = snippetCount;
  const lastUsedRef = useRef(loadLastUsed());

  const doOpen = useCallback((x: number, y: number) => {
    const idx = Math.min(lastUsedRef.current, Math.max(0, countRef.current - 1));
    setSelectedIdx(idx);
    setMenuPos({ x, y });
    setOpen(true);
    openRef.current = true;
  }, []);

  const doClose = useCallback(() => {
    setOpen(false);
    setMenuPos(null);
    openRef.current = false;
  }, []);

  const doCommit = useCallback(() => {
    const idx = selectedIdx;
    doClose();
    lastUsedRef.current = idx;
    saveLastUsed(idx);
    insertRef.current(idx);
  }, [selectedIdx, doClose]);

  useEffect(() => {
    const onGlobalKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        console.log("[snippet] keyup Alt, open:", openRef.current);
        if (openRef.current) {
          doCommit();
        }
      }
    };
    document.addEventListener("keyup", onGlobalKeyUp);
    return () => document.removeEventListener("keyup", onGlobalKeyUp);
  }, [doCommit]);

  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        console.log("[snippet] keydown Alt");
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) {
        console.log("[snippet] wheel no alt");
        if (openRef.current) doClose();
        return;
      }
      console.log("[snippet] wheel+alt, open:", openRef.current, "count:", countRef.current, "pos:", e.clientX, e.clientY);
      e.preventDefault();

      if (!openRef.current) {
        if (countRef.current > 0) {
          doOpen(e.clientX, e.clientY);
        }
        return;
      }

      scrollAccum.current += e.deltaY;
      if (Math.abs(scrollAccum.current) >= 24) {
        const dir = scrollAccum.current > 0 ? 1 : -1;
        setSelectedIdx((prev) => {
          const n = countRef.current;
          if (n === 0) return 0;
          const next = prev + dir;
          if (next < 0) return n - 1;
          if (next >= n) return 0;
          return next;
        });
        scrollAccum.current = 0;
      }
    };

    document.addEventListener("keydown", onGlobalKeyDown);
    document.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      document.removeEventListener("keydown", onGlobalKeyDown);
      document.removeEventListener("wheel", onWheel);
    };
  }, [doOpen, doClose]);

  return { open, selectedIdx, menuPos };
}
