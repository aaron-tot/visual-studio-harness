import { useEffect, useRef, type DependencyList } from "react";
import { useConfigStore } from "../stores/config";

const SHORTCUT_DEFAULTS: Record<string, string> = {
  "sidebar.toggle": "Alt+ArrowLeft",
  "sidebar.pin": "Alt+Shift+ArrowLeft",
  "infoPanel.toggle": "Alt+ArrowRight",
  "infoPanel.pin": "Alt+Shift+ArrowRight",
};

export function getShortcutKeys(id: string, overrides?: Record<string, string>): string {
  return overrides?.[id] ?? SHORTCUT_DEFAULTS[id] ?? "";
}

export function getShortcutLabel(id: string): string {
  return SHORTCUT_DEFAULTS[id] ?? "";
}

export function useShortcut(
  id: string,
  onKey: (e: KeyboardEvent) => void,
  deps: DependencyList = []
): void {
  const keybindings = useConfigStore((s) => s.config.keybindings);
  const handlerRef = useRef(onKey);
  handlerRef.current = onKey;
  const keys = getShortcutKeys(id, keybindings);

  useEffect(() => {
    if (!keys) return;
    const parts = keys.split("+");
    const mainKey = parts[parts.length - 1];
    const mods = parts.slice(0, -1);
    const listener = (e: KeyboardEvent) => {
      if (e.key !== mainKey) return;
      if (e.repeat) return;
      if (mods.includes("Alt") !== e.altKey) return;
      if (mods.includes("Shift") !== e.shiftKey) return;
      if (mods.includes("Control") !== e.ctrlKey) return;
      if (mods.includes("Meta") !== e.metaKey) return;
      e.preventDefault();
      handlerRef.current(e);
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [id, keys, ...deps]);
}

export interface ShortcutDef {
  id: string;
  label: string;
  category: string;
  defaultKeys: string;
  currentKeys: string;
}

export const ALL_SHORTCUT_DEFS: ShortcutDef[] = [
  { id: "sidebar.toggle", label: "Toggle sidebar open/close", category: "Layout", defaultKeys: "Alt+ArrowLeft", currentKeys: "Alt+ArrowLeft" },
  { id: "sidebar.pin", label: "Toggle sidebar pinned", category: "Layout", defaultKeys: "Alt+Shift+ArrowLeft", currentKeys: "Alt+Shift+ArrowLeft" },
  { id: "infoPanel.toggle", label: "Toggle info panel open/close", category: "Layout", defaultKeys: "Alt+ArrowRight", currentKeys: "Alt+ArrowRight" },
  { id: "infoPanel.pin", label: "Toggle info panel pinned", category: "Layout", defaultKeys: "Alt+Shift+ArrowRight", currentKeys: "Alt+Shift+ArrowRight" },
];
