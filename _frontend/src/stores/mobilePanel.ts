import { create } from "zustand";

export type PanelSide = "left" | "right";

/**
 * Single-open drawer controller for mobile/tablet (< lg).
 * The edge toggle buttons in App dispatch here; each panel subscribes to
 * whether its own side is the currently-open drawer. Opening one side closes
 * the other (single-open invariant).
 */
interface MobilePanelState {
  openPanel: PanelSide | null;
  open: (side: PanelSide) => void;
  close: (side: PanelSide) => void;
  toggle: (side: PanelSide) => void;
}

export const useMobilePanelStore = create<MobilePanelState>((set) => ({
  openPanel: null,
  open: (side) => set({ openPanel: side }),
  close: (side) =>
    set((s) => (s.openPanel === side ? { openPanel: null } : {})),
  toggle: (side) =>
    set((s) => ({ openPanel: s.openPanel === side ? null : side })),
}));
