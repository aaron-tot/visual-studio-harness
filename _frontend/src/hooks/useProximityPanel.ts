import { useCallback, useEffect, useRef, useState } from "react";
import { useShortcut } from "./useShortcut";

export type ProximitySide = "left" | "right";

export interface UseProximityPanelOptions {
  side: ProximitySide;
  /** Expanded panel width in px */
  width: number;
  /** Distance from screen edge that reveals the panel (default 20) */
  threshold?: number;
  /** Delay before auto-hide after mouse leave (default 300ms) */
  hideDelayMs?: number;
  /** Collapsed rail width in px (default 5) */
  collapsedWidth?: number;
  toggleShortcut?: string;
  pinShortcut?: string;
  /** Called when panel auto-hides or is closed via shortcut (not on pin-only changes) */
  onClose?: () => void;
}

export interface ProximityPanelState {
  visible: boolean;
  pinned: boolean;
  isOpen: boolean;
  pin: () => void;
  unpin: () => void;
  open: () => void;
  close: () => void;
  togglePin: () => void;
  toggleOpen: () => void;
  /** Outer rail props: width transition + enter/leave handlers */
  railProps: {
    style: { width: number };
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  /** Click-to-pin on unpinned panel chrome */
  contentProps: {
    onClick: () => void;
  };
}

/**
 * Shared open / pin / proximity-reveal behavior for edge sidebars.
 * Fixes: cancel hide timer on re-enter; shortcuts toggle without form wipe races.
 */
const STORAGE_KEY = (side: string) => `visual-studio-harness:panel:${side}:pinned`;

function loadPinned(side: string): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY(side)) === "true";
  } catch {
    return false;
  }
}

function savePinned(side: string, pinned: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY(side), pinned ? "true" : "false");
  } catch {}
}

export function useProximityPanel(options: UseProximityPanelOptions): ProximityPanelState {
  const {
    side,
    width,
    threshold = 20,
    hideDelayMs = 300,
    collapsedWidth = 5,
    toggleShortcut,
    pinShortcut,
    onClose,
  } = options;

  const [visible, setVisible] = useState(false);
  const [pinned, setPinned] = useState(() => loadPinned(side));
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const isOpen = visible || pinned;
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = undefined;
    }
  }, []);

  const open = useCallback(() => {
    clearHideTimer();
    setVisible(true);
  }, [clearHideTimer]);

  const close = useCallback(() => {
    clearHideTimer();
    setVisible(false);
    setPinned(false);
    onCloseRef.current?.();
  }, [clearHideTimer]);

  const pin = useCallback(() => {
    clearHideTimer();
    setPinned(true);
    setVisible(true);
    savePinned(side, true);
  }, [clearHideTimer, side]);

  const unpin = useCallback(() => {
    setPinned(false);
    savePinned(side, false);
  }, [side]);

  const togglePin = useCallback(() => {
    if (pinnedRef.current) unpin();
    else pin();
  }, [pin, unpin]);

  const toggleOpen = useCallback(() => {
    if (isOpenRef.current) close();
    else open();
  }, [close, open]);

  // Always call hooks; empty id is a no-op inside useShortcut (no keys).
  useShortcut(pinShortcut || "__noop.pin", () => {
    if (!pinShortcut) return;
    if (isOpenRef.current) close();
    else pin();
  }, [pinShortcut, close, pin]);

  useShortcut(toggleShortcut || "__noop.toggle", () => {
    if (!toggleShortcut) return;
    toggleOpen();
  }, [toggleShortcut, toggleOpen]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (pinnedRef.current) return;
      const nearEdge =
        side === "left"
          ? e.clientX <= threshold
          : e.clientX >= window.innerWidth - threshold;
      if (nearEdge) {
        clearHideTimer();
        setVisible(true);
      }
    };
    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, [side, threshold, clearHideTimer]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  const onMouseEnter = useCallback(() => {
    clearHideTimer();
    if (!pinnedRef.current) setVisible(true);
  }, [clearHideTimer]);

  const onMouseLeave = useCallback(() => {
    if (pinnedRef.current) return;
    clearHideTimer();
    hideTimer.current = setTimeout(() => {
      setVisible(false);
    }, hideDelayMs);
  }, [clearHideTimer, hideDelayMs]);

  return {
    visible,
    pinned,
    isOpen,
    pin,
    unpin,
    open,
    close,
    togglePin,
    toggleOpen,
    railProps: {
      style: { width: isOpen ? width : collapsedWidth },
      onMouseEnter,
      onMouseLeave,
    },
    contentProps: {
      onClick: () => {
        if (!pinnedRef.current) pin();
      },
    },
  };
}
