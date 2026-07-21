// ---------------------------------------------------------------------------
// Reusable Tailwind class constants for the Visual Studio Harness UI design system.
// Import these instead of duplicating class strings across components.
// ---------------------------------------------------------------------------

// --- Trigger / Pill Buttons ---

/** Subtle transparent trigger with border reveal on hover (rounded-md, used in NewChat toolbar) */
export const triggerPill =
  "flex items-center gap-1.5 text-sm text-zinc-500 px-2 py-1 rounded-md border border-transparent " +
  "hover:text-zinc-500 hover:opacity-100 hover:border-zinc-700/30 transition-colors";

/** Compact transparent trigger with visible border (rounded-full, used in PromptInput toolbar) */
export const triggerPillCompact =
  "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs transition-colors " +
  "border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 bg-transparent";

// --- Dropdowns ---

/** Outer dropdown panel */
export const dropdownPanel =
  "absolute bottom-full left-0 mb-1 z-50 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl overflow-hidden";

/** Base dropdown item (unselected) */
export const dropdownItem =
  "w-full text-left px-2 py-1.5 rounded text-xs transition-colors text-zinc-300 hover:bg-zinc-800";

/** Selected dropdown item */
export const dropdownItemSelected = "bg-zinc-800 text-zinc-200";

/** Active (highlighted) dropdown item */
export const dropdownItemActive = "bg-zinc-800 text-white";

/** Dropdown section header */
export const dropdownHeader =
  "px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-600 font-medium";

/** Dropdown search input */
export const dropdownSearch =
  "flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800";

/** Dropdown search input field */
export const dropdownSearchInput =
  "bg-transparent text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none w-full";

/** Dropdown search bar container */
export const dropdownSearchBar = "p-2 border-b border-zinc-800";

// --- Cards / Containers ---

/** Frosted glass card with subtle border and backdrop blur */
export const glassCard =
  "rounded-2xl border border-zinc-700/20 bg-zinc-950 transition-shadow duration-200 ease-out";

/** Subtle top highlight rim on a glass card */
export const glassCardRim =
  "absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent";

/** Toolbar bar inside a glass card */
export const cardToolbar =
  "flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-5 pt-4 pb-3 border-b border-white/[0.04]";

// --- Inputs ---

/** Transparent auto-resize textarea for chat input */
export const chatTextarea =
  "w-full bg-transparent px-2 py-2.5 text-sm text-zinc-300 placeholder-zinc-600 " +
  "focus:outline-none resize-none min-h-[44px] max-h-[160px] overflow-y-auto [overscroll-behavior:contain] leading-relaxed";

// --- Buttons ---

/** Ghost send button (NewChat style) */
export const sendButton =
  "shrink-0 mb-[7px] p-2 rounded-xl bg-transparent hover:bg-white/10 " +
  "text-zinc-500 hover:text-zinc-300 transition-all duration-200 hover:scale-105 active:scale-95 " +
  "disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-zinc-500 disabled:hover:scale-100";

/** Stop streaming button */
export const stopButton =
  "shrink-0 mb-[7px] p-2 rounded-xl bg-red-600/60 hover:bg-red-500 text-white transition-all active:scale-95";

/** Send button (PromptInput / InputActions style) */
export const sendButtonSolid =
  "px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white " +
  "text-sm transition-colors disabled:opacity-40 disabled:cursor-default shrink-0";

/** Stop button (PromptInput / InputActions style) */
export const stopButtonSolid =
  "px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm flex items-center gap-1.5 transition-colors shrink-0";

// --- Background Effects ---

/** Dot grid background pattern (place inside a relative/absolute container) */
export const dotGrid =
  "absolute inset-0 opacity-[0.045] pointer-events-none";

export const dotGridStyle = {
  backgroundImage: "radial-gradient(rgba(255,255,255,0.65) 1.25px, transparent 1.25px)",
  backgroundSize: "26px 26px",
} as const;

/** Box shadow for the glass card (idle state) */
export const glassCardShadow =
  "0 0 56px rgba(59,130,246,0.17), 0 0 42px rgba(255,255,255,0.08), 0 25px 50px -12px rgba(0,0,0,0.4)";

/** Box shadow for the glass card (hovered state) */
export const glassCardShadowHover =
  "0 0 80px rgba(59,130,246,0.24), 0 0 60px rgba(255,255,255,0.12), 0 25px 50px -12px rgba(0,0,0,0.4)";

/** Half-intensity glow for existing session (idle) */
export const glassCardShadowHalf =
  "0 0 56px rgba(59,130,246,0.0425), 0 0 42px rgba(255,255,255,0.02), 0 25px 50px -12px rgba(0,0,0,0.4)";

/** Half-intensity glow for existing session (hovered) */
export const glassCardShadowHoverHalf =
  "0 0 80px rgba(59,130,246,0.06), 0 0 60px rgba(255,255,255,0.03), 0 25px 50px -12px rgba(0,0,0,0.4)";

// --- Utility ---

/** Section divider */
export const divider = "border-t border-zinc-800";

/** Disconnected banner */
export const disconnectedBanner =
  "absolute top-0 left-0 right-0 bg-red-600 text-white text-xs text-center py-1 z-10";

/** Active todo indicator row */
export const todoRow =
  "flex items-center gap-2 px-4 py-1.5 border-b border-zinc-800/50 bg-zinc-900/30";
