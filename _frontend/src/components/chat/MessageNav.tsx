import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp } from "lucide-react";
import { useChatStore } from "../../stores/chat";

const ANCHOR = 90;
const OFFSET = 80;
const EPS = 4;

function fmtDist(px: number): string {
  if (px >= 1000) return `${(px / 1000).toFixed(1)}k`;
  return `${Math.round(px)}`;
}

interface NavState {
  closestIndex: number;
  atTop: boolean;
  atBottom: boolean;
  distAbove: number;
  distBelow: number;
  distFirst: number;
  distLast: number;
}

const EMPTY_STATE: NavState = {
  closestIndex: 0,
  atTop: true,
  atBottom: true,
  distAbove: 0,
  distBelow: 0,
  distFirst: 0,
  distLast: 0,
};

function getScroller() {
  return document.querySelector("[data-scroll]");
}

function getMsgEls() {
  const scroller = getScroller();
  if (!scroller) return [];
  return Array.from(scroller.querySelectorAll<HTMLElement>("[data-user-msg]"));
}

function anchorY() {
  const scroller = getScroller();
  if (!scroller) return 0;
  return scroller.getBoundingClientRect().top + ANCHOR;
}

function getCurrentIndex() {
  const els = getMsgEls();
  if (!els.length) return 0;
  const aY = anchorY();
  let current = 0;
  for (let i = 0; i < els.length; i++) {
    const top = els[i].getBoundingClientRect().top;
    if (top <= aY + EPS) current = i;
    else break;
  }
  return current;
}

function scrollTargetTop(el: HTMLElement) {
  const scroller = getScroller();
  if (!scroller) return 0;
  const isWindow = scroller === (document.scrollingElement || document.documentElement);
  const scrollTop = isWindow ? window.scrollY : scroller.scrollTop;
  const containerTop = isWindow ? 0 : scroller.getBoundingClientRect().top;
  return scrollTop + el.getBoundingClientRect().top - containerTop - OFFSET;
}

function computeNavState() {
  const els = getMsgEls();
  if (!els.length) return EMPTY_STATE;

  const aY = anchorY();
  const current = getCurrentIndex();

  let aboveClosest = Infinity;
  let aboveFurthest = -Infinity;
  let belowClosest = Infinity;
  let belowFurthest = -Infinity;

  for (let i = 0; i < els.length; i++) {
    const rect = els[i].getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const d = center - aY;

    if (d < -10) {
      const dist = Math.abs(d);
      if (dist < aboveClosest) aboveClosest = dist;
      if (dist > aboveFurthest) aboveFurthest = dist;
    } else if (d > 10) {
      if (d < belowClosest) belowClosest = d;
      if (d > belowFurthest) belowFurthest = d;
    }
  }

  return {
    closestIndex: current,
    atTop: current === 0,
    atBottom: current === els.length - 1,
    distAbove: aboveClosest === Infinity ? 0 : Math.round(aboveClosest),
    distBelow: belowClosest === Infinity ? 0 : Math.round(belowClosest),
    distFirst: aboveFurthest === -Infinity ? 0 : Math.round(aboveFurthest),
    distLast: belowFurthest === -Infinity ? 0 : Math.round(belowFurthest),
  };
}

function scrollToMsg(index: number) {
  const els = getMsgEls();
  if (index < 0 || index >= els.length) return;
  const scroller = getScroller();
  if (!scroller) return;
  scroller.scrollTo({ top: scrollTargetTop(els[index]), behavior: "smooth" });
}

export function MessageNav() {
  const messages = useChatStore((s) => s.messages);
  const userMsgs = messages.filter((m) => m.role === "user");
  const [, forceUpdate] = useState(0);
  const state = useRef<NavState>(EMPTY_STATE);
  const lastVisualUpdate = useRef(0);

  useEffect(() => {
    const el = document.querySelector("[data-scroll]");
    if (!el) return;
    let rafId: number;

    const handler = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const s = computeNavState();

        const now = Date.now();
        if (now - lastVisualUpdate.current >= 1000) {
          lastVisualUpdate.current = now;
          state.current = s;
          forceUpdate(n => n + 1);
        } else {
          const prev = state.current;
          if (prev.closestIndex !== s.closestIndex || prev.atTop !== s.atTop || prev.atBottom !== s.atBottom) {
            state.current = { ...s, distAbove: prev.distAbove, distBelow: prev.distBelow, distFirst: prev.distFirst, distLast: prev.distLast };
            forceUpdate(n => n + 1);
          }
        }
      });
    };

    el.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => {
      el.removeEventListener("scroll", handler);
      cancelAnimationFrame(rafId);
    };
  }, [userMsgs.length]);

  const go = useCallback((dir: "prev" | "next") => {
    const s = computeNavState();
    const targetIdx = dir === "prev" ? s.closestIndex - 1 : s.closestIndex + 1;
    scrollToMsg(targetIdx);
  }, []);

  const jumpToFirst = useCallback(() => scrollToMsg(0), []);
  const jumpToLast = useCallback(() => {
    const els = getMsgEls();
    if (els.length > 0) scrollToMsg(els.length - 1);
  }, []);

  if (userMsgs.length === 0) return null;

  const s = state.current;

  return (
    <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-1 items-end">
      <button type="button" disabled={s.atTop} onClick={jumpToFirst}
        className="p-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-700/80 text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-25 disabled:cursor-default flex items-center justify-center gap-1">
        <ChevronsUp size={14} />
        {s.distFirst > 0 && <span className="text-[10px] tabular-nums text-zinc-500">{fmtDist(s.distFirst)}</span>}
      </button>
      <button type="button" disabled={s.atTop} onClick={() => go("prev")}
        className="p-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-700/80 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-30 disabled:cursor-default flex items-center justify-center gap-1">
        <ChevronUp size={14} />
        {s.distAbove > 0 && <span className="text-[10px] tabular-nums text-zinc-400">{fmtDist(s.distAbove)}</span>}
      </button>
      <button type="button" disabled={s.atBottom} onClick={() => go("next")}
        className="p-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-700/80 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-30 disabled:cursor-default flex items-center justify-center gap-1">
        <ChevronDown size={14} />
        {s.distBelow > 0 && <span className="text-[10px] tabular-nums text-zinc-400">{fmtDist(s.distBelow)}</span>}
      </button>
      <button type="button" disabled={s.atBottom} onClick={jumpToLast}
        className="p-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-700/80 text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-25 disabled:cursor-default flex items-center justify-center gap-1">
        <ChevronsDown size={14} />
        {s.distLast > 0 && <span className="text-[10px] tabular-nums text-zinc-500">{fmtDist(s.distLast)}</span>}
      </button>
    </div>
  );
}
